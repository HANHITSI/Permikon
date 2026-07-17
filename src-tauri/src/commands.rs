use crate::error::{PermikonError, Result};
use crate::storage::{get_history_db_path, get_settings_path};
use crate::songdb;
use panchira_cli::{analyze_chart as panchira_analyze_chart, ChartAnalysis};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use md5::{Digest, Md5};
use chrono::Utc;



#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AnalysisResult {
    pub md5: String,
    pub path: String,
    pub title: String,
    pub subtitle: String,
    pub artist: String,
    pub mode: String,
    pub difficulty: String,
    pub analyzed_at: i64,
    pub json: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HistoryEntry {
    pub id: i64,
    pub md5: String,
    pub path: String,
    pub title: String,
    pub subtitle: String,
    pub artist: String,
    pub mode: String,
    pub difficulty: String,
    pub analyzed_at: i64,
    pub favorite: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub entries: Vec<HistoryEntry>,
    pub total: usize,
}



fn chart_analysis_to_result(analysis: ChartAnalysis, md5: String, path: String) -> Result<AnalysisResult> {
    let ChartAnalysis { metadata, permutations } = analysis;
    let json = serde_json::to_value(&permutations)?;
    Ok(AnalysisResult {
        md5,
       path,
       title: metadata.title,
       subtitle: metadata.subtitle,
       artist: metadata.artist,
       mode: metadata.mode,
       difficulty: metadata.difficulty,
       analyzed_at: Utc::now().timestamp(),
       json,
    })
}

fn compute_md5(path: &Path) -> Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Md5::new();
    let mut buffer = [0; 8192];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

const INSERT_CHART_SQL: &str =
    "INSERT OR REPLACE INTO charts (md5, path, title, subtitle, artist, mode, difficulty, analyzed_at, favorite, json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)";

const SELECT_CHART_SQL: &str =
    "SELECT md5, path, title, subtitle, artist, mode, difficulty, analyzed_at, json
     FROM charts WHERE md5 = ?1";

const SELECT_HISTORY_SQL: &str =
    "SELECT id, md5, path, title, subtitle, artist, mode, difficulty, analyzed_at, favorite
     FROM charts";

fn row_to_analysis_result(row: &rusqlite::Row) -> rusqlite::Result<AnalysisResult> {
    Ok(AnalysisResult {
        md5: row.get(0)?,
        path: row.get(1)?,
        title: row.get(2)?,
        subtitle: row.get(3)?,
        artist: row.get(4)?,
        mode: row.get(5)?,
        difficulty: row.get(6)?,
        analyzed_at: row.get(7)?,
        json: serde_json::from_str(&row.get::<_, String>(8)?).unwrap_or_default(),
    })
}

fn row_to_history_entry(row: &rusqlite::Row) -> rusqlite::Result<HistoryEntry> {
    Ok(HistoryEntry {
        id: row.get(0)?,
        md5: row.get(1)?,
        path: row.get(2)?,
        title: row.get(3)?,
        subtitle: row.get(4)?,
        artist: row.get(5)?,
        mode: row.get(6)?,
        difficulty: row.get(7)?,
        analyzed_at: row.get(8)?,
        favorite: row.get(9)?,
    })
}

#[command]
pub async fn analyze_chart(_app: AppHandle, path: String) -> Result<AnalysisResult> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err(PermikonError::NotFound(path.display().to_string()));
    }

    // Validate file format
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()) {
        Some(ref ext) if ["bms", "bme", "bmson", "bml"].contains(&ext.as_str()) => {}
        _ => {
            return Err(PermikonError::InvalidFormat(
                path.display().to_string()
            ));
        }
    }

    let md5 = compute_md5(&path)?;
    let path_str = path.display().to_string();

    // 1. Check cache
    let db_path = get_history_db_path()?;
    if db_path.exists() {
        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            let result = conn.query_row(SELECT_CHART_SQL, [&md5], row_to_analysis_result);
            if let Ok(result) = result {
                eprintln!("Cache hit for MD5: {} ({})", md5, result.title);
                return Ok(result);
            }
        }
    }
    eprintln!("Cache miss for MD5: {} -- analyzing {}", md5, path_str);

    // 2. Run analysis
    let analysis = panchira_analyze_chart(&path)?;
    let result = chart_analysis_to_result(analysis, md5, path_str)?;

    // 3. Save to cache
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = conn.execute(
            INSERT_CHART_SQL,
            rusqlite::params![
                result.md5,
                result.path,
                result.title,
                result.subtitle,
                result.artist,
                result.mode,
                result.difficulty,
                result.analyzed_at,
                serde_json::to_string(&result.json)?,
            ],
        );
    }

    Ok(result)
}

async fn search_history(query: String) -> Result<SearchResult> {
    let db_path = get_history_db_path()?;
    if !db_path.exists() {
        return Ok(SearchResult { entries: vec![], total: 0 });
    }

    let conn = rusqlite::Connection::open(&db_path)?;
    let sql = format!(
        "{} WHERE title LIKE ?1 OR subtitle LIKE ?1 OR artist LIKE ?1 OR md5 LIKE ?1
        ORDER BY analyzed_at DESC
        LIMIT 100",
        SELECT_HISTORY_SQL
    );
    let mut stmt = conn.prepare(&sql)?;

    let pattern = format!("%{}%", query);
    let entries = stmt.query_map([pattern], row_to_history_entry)?.filter_map(|r| r.ok()).collect::<Vec<_>>();

    let total = entries.len();
    Ok(SearchResult { entries, total })
}

#[command]
pub async fn load_chart(_app: AppHandle, md5: String) -> Result<AnalysisResult> {
    let db_path = get_history_db_path()?;
    if !db_path.exists() {
        return Err(PermikonError::NotFound("History database not found".into()));
    }

    let conn = rusqlite::Connection::open(&db_path)?;
    let mut stmt = conn.prepare(SELECT_CHART_SQL)?;
    let mut rows = stmt.query([md5])?;
    if let Some(row) = rows.next()? {
        Ok(row_to_analysis_result(row)?)
    } else {
        Err(PermikonError::NotFound("Chart not found".into()))
    }
}

#[command]
pub async fn toggle_favorite(_app: AppHandle, md5: String) -> Result<bool> {
    let db_path = get_history_db_path()?;
    let conn = rusqlite::Connection::open(&db_path)?;
    let current: bool = conn.query_row(
        "SELECT favorite FROM charts WHERE md5 = ?1",
        [&md5],
        |row| row.get(0)
    )?;
    let new_value = !current;
    conn.execute("UPDATE charts SET favorite = ?1 WHERE md5 = ?2", rusqlite::params![new_value, md5])?;
    Ok(new_value)
}

#[command]
pub async fn delete_history(_app: AppHandle, md5: String) -> Result<()> {
    let db_path = get_history_db_path()?;
    let conn = rusqlite::Connection::open(&db_path)?;
    conn.execute("DELETE FROM charts WHERE md5 = ?1", rusqlite::params![md5])?;
    Ok(())
}

#[command]
pub async fn clear_history(_app: AppHandle) -> Result<()> {
    let db_path = get_history_db_path()?;
    let conn = rusqlite::Connection::open(&db_path)?;
    conn.execute("DELETE FROM charts", rusqlite::params![])?;
    Ok(())
}

#[command]
pub async fn open_file_dialog(app: AppHandle) -> Result<Option<String>> {
    let file = app.dialog().file()
    .add_filter("BMS Charts", &["bms", "bme", "bmson"])
    .blocking_pick_file();
    Ok(file.map(|p| p.to_string()))
}

#[command]
pub async fn open_song_db_dialog(app: AppHandle) -> Result<Option<String>> {
    let file = app.dialog().file()
    .add_filter("SQLite Databases", &["db"])
    .blocking_pick_file();
    Ok(file.map(|p| p.to_string()))
}

#[command]
pub async fn export_json(app: AppHandle, md5: String) -> Result<String> {
    let result = load_chart(app, md5).await?;
    Ok(serde_json::to_string_pretty(&result.json)?)
}

#[command]
pub async fn copy_analysis(app: AppHandle, md5: String) -> Result<()> {
    let result = load_chart(app.clone(), md5).await?;
    let json = serde_json::to_string_pretty(&result.json)?;
    app.clipboard().write_text(json)?;
    Ok(())
}

#[command]
pub async fn get_settings(_app: AppHandle) -> Result<serde_json::Value> {
    let path = get_settings_path()?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&content)?)
}

#[command]
pub async fn save_settings(_app: AppHandle, settings: serde_json::Value) -> Result<()> {
    let path = get_settings_path()?;

    // Merge with existing file to preserve keys managed by the backend
    // (e.g. songDatabases) that the frontend never sends.
    let mut existing: serde_json::Value = if path.exists() {
        let content = std::fs::read_to_string(&path)?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if let (Some(existing_obj), Some(incoming_obj)) =
        (existing.as_object_mut(), settings.as_object())
    {
        for (key, value) in incoming_obj {
            existing_obj.insert(key.clone(), value.clone());
        }
    }

    let content = serde_json::to_string_pretty(&existing)?;
    std::fs::write(path, content)?;
    Ok(())
}

#[command]
pub async fn get_recent_analyses(_app: AppHandle, limit: Option<usize>) -> Result<SearchResult> {
    let db_path = get_history_db_path()?;
    if !db_path.exists() {
        return Ok(SearchResult { entries: vec![], total: 0 });
    }

    let conn = rusqlite::Connection::open(&db_path)?;
    let limit = limit.unwrap_or(20);
    let sql = format!("{} ORDER BY analyzed_at DESC LIMIT ?1", SELECT_HISTORY_SQL);
    let mut stmt = conn.prepare(&sql)?;
    let entries = stmt.query_map([limit], row_to_history_entry)?.filter_map(|r| r.ok()).collect::<Vec<_>>();

    let total = entries.len();
    Ok(SearchResult { entries, total })
}

#[command]
pub async fn init_database(_app: AppHandle) -> Result<()> {
    let db_path = get_history_db_path()?;
    let conn = rusqlite::Connection::open(&db_path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS charts (
            id INTEGER PRIMARY KEY,
            md5 TEXT UNIQUE,
            path TEXT,
            title TEXT,
            subtitle TEXT,
            artist TEXT,
            mode TEXT,
            difficulty TEXT,
            analyzed_at INTEGER,
            favorite INTEGER DEFAULT 0,
            json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_md5 ON charts(md5);
    CREATE INDEX IF NOT EXISTS idx_analyzed_at ON charts(analyzed_at);
    CREATE INDEX IF NOT EXISTS idx_title ON charts(title);
    CREATE INDEX IF NOT EXISTS idx_artist ON charts(artist);"
    )?;
    Ok(())
}

#[command]
pub async fn save_analysis(_app: AppHandle, result: AnalysisResult) -> Result<()> {
    let db_path = get_history_db_path()?;
    let conn = rusqlite::Connection::open(&db_path)?;
    conn.execute(
        INSERT_CHART_SQL,
        rusqlite::params![
            result.md5,
            result.path,
            result.title,
            result.subtitle,
            result.artist,
            result.mode,
            result.difficulty,
            result.analyzed_at,
            serde_json::to_string(&result.json)?,
        ],
    )?;
    Ok(())
}

#[command]
pub async fn drag_drop_analyze(app: AppHandle, paths: Vec<String>) -> Result<Vec<AnalysisResult>> {
    let mut results = Vec::new();
    for path in paths {
        if let Ok(result) = analyze_chart(app.clone(), path).await {
            results.push(result);
        }
    }
    Ok(results)
}

// ---- Song Database commands ----

/// Configuration for a loaded song database, stored in settings.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongDbConfig {
    pub path: String,
    pub mappings: Vec<songdb::TableMapping>,
    pub entry_count: usize,
}

/// Load (register) a song database.
/// Validates it, discovers compatible tables, caches the schema, saves to settings.
#[command]
pub async fn load_song_database(_app: AppHandle, db_path: String) -> Result<SongDbConfig> {
    let path = std::path::PathBuf::from(&db_path);

    // Validate and discover schema
    let mappings = songdb::validate_database(&path)?;
    let entry_count = songdb::count_entries(&path, &mappings);

    eprintln!(
        "Loaded song database: {} ({} compatible tables, {} entries)",
        db_path, mappings.len(), entry_count
    );

    let config = SongDbConfig {
        path: db_path,
        mappings,
        entry_count,
    };

    // Persist to settings
    let settings_path = get_settings_path()?;
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let dbs = settings
        .as_object_mut()
        .ok_or_else(|| PermikonError::Analysis("Settings is not a JSON object".into()))?;

    let song_dbs = dbs
        .entry("songDatabases")
        .or_insert_with(|| serde_json::json!([]))
        .as_array_mut()
        .ok_or_else(|| PermikonError::Analysis("songDatabases is not an array".into()))?;

    // Avoid duplicates by path
    let already_exists = song_dbs.iter().any(|existing| {
        existing
            .get("path")
            .and_then(|p| p.as_str())
            == Some(&config.path)
    });

    if !already_exists {
        song_dbs.push(serde_json::to_value(&config)?);
    }

    let content = serde_json::to_string_pretty(&settings)?;
    std::fs::write(&settings_path, content)?;

    Ok(config)
}

/// Remove a song database from settings.
#[command]
pub async fn remove_song_database(_app: AppHandle, db_path: String) -> Result<()> {
    let settings_path = get_settings_path()?;
    if !settings_path.exists() {
        return Ok(());
    }

    let mut settings: serde_json::Value = {
        let content = std::fs::read_to_string(&settings_path)?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    };

    if let Some(obj) = settings.as_object_mut() {
        if let Some(dbs) = obj.get_mut("songDatabases").and_then(|v| v.as_array_mut()) {
            dbs.retain(|entry| {
                entry
                    .get("path")
                    .and_then(|p| p.as_str())
                    != Some(&db_path)
            });
        }
    }

    let content = serde_json::to_string_pretty(&settings)?;
    std::fs::write(&settings_path, content)?;
    Ok(())
}

/// Get the list of configured song databases.
#[command]
pub async fn get_song_databases(_app: AppHandle) -> Result<Vec<SongDbConfig>> {
    let settings_path = get_settings_path()?;
    if !settings_path.exists() {
        return Ok(vec![]);
    }

    let mut settings: serde_json::Value = {
        let content = std::fs::read_to_string(&settings_path)?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    };

    let song_dbs = settings
        .get("songDatabases")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| serde_json::from_value(v.clone()).ok())
                .collect::<Vec<SongDbConfig>>()
        })
        .unwrap_or_default();

    // Re-discover schemas for databases where col_mode is missing.
    // This runs once per startup to migrate old cached mappings.
    let mut dirty = false;
    let mut configs: Vec<SongDbConfig> = Vec::new();
    for config in &song_dbs {
        let needs_rediscovery = config
            .mappings
            .iter()
            .any(|m| m.col_mode.is_none());
        if needs_rediscovery {
            let path = std::path::PathBuf::from(&config.path);
            if path.exists() {
                if let Ok(new_mappings) = songdb::discover_schema(&path) {
                    let count = songdb::count_entries(&path, &new_mappings);
                    configs.push(SongDbConfig {
                        path: config.path.clone(),
                        mappings: new_mappings,
                        entry_count: count,
                    });
                    dirty = true;
                    continue;
                }
            }
        }
        configs.push(config.clone());
    }

    if dirty {
        if let Some(obj) = settings.as_object_mut() {
            if let Some(dbs) = obj.get_mut("songDatabases").and_then(|v| v.as_array_mut()) {
                dbs.clear();
                for c in &configs {
                    if let Ok(v) = serde_json::to_value(c) {
                        dbs.push(v);
                    }
                }
            }
        }
        if let Ok(updated) = serde_json::to_string_pretty(&settings) {
            let _ = std::fs::write(&settings_path, updated);
        }
    }

    Ok(configs)
}

/// Unified search: queries history.db + all configured song databases.
/// Returns a single merged result list. The frontend never knows the source.
#[command]
pub async fn search(app: AppHandle, query: String) -> Result<SearchResult> {
    let mut entries = Vec::new();

    // 1. Search history.db
    let history_result = search_history(query.clone()).await?;
    entries.extend(history_result.entries);

    let history_md5s: std::collections::HashSet<String> =
        entries.iter().map(|e| e.md5.clone()).collect();

    // 2. Search song databases (skip entries already in history)
    let song_dbs = get_song_databases(app).await?;
    let limit_per_db = 100;

    for db_config in &song_dbs {
        let db_path = std::path::PathBuf::from(&db_config.path);
        if !db_path.exists() {
            continue;
        }

        match songdb::search_with_mappings(&db_path, &db_config.mappings, &query, limit_per_db) {
            Ok(song_entries) => {
                for entry in song_entries {
                    // Skip if already in history (history is authoritative)
                    if history_md5s.contains(&entry.md5) {
                        continue;
                    }
                    entries.push(HistoryEntry {
                        id: 0,
                        md5: entry.md5,
                        path: entry.path,
                        title: entry.title,
                        subtitle: entry.subtitle,
                        artist: entry.artist,
                        mode: String::new(),
                        difficulty: String::new(),
                        analyzed_at: 0,
                        favorite: false,
                    });
                }
            }
            Err(e) => {
                eprintln!(
                    "Warning: failed to search {}: {}",
                    db_config.path, e
                );
            }
        }
    }

    let total = entries.len();
    Ok(SearchResult { entries, total })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_analysis_result_serialization() {
        let result = AnalysisResult {
            md5: "abc123".into(),
            path: "/test/chart.bms".into(),
            title: "Test Chart".into(),
            subtitle: "Sub".into(),
            artist: "Artist".into(),
            mode: "7KEY".into(),
            difficulty: "Normal".into(),
            analyzed_at: 1700000000,
            json: serde_json::json!([{"perm": "1234567"}]),
        };
        let serialized = serde_json::to_string(&result).unwrap();
        assert!(serialized.contains("abc123"));
        assert!(serialized.contains("Test Chart"));
    }

    #[test]
    fn test_search_result_serialization() {
        let result = SearchResult {
            entries: vec![],
            total: 0,
        };
        let serialized = serde_json::to_string(&result).unwrap();
        assert!(serialized.contains("entries"));
        assert!(serialized.contains("total"));
    }
}
