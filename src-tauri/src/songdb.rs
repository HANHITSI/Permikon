use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::error::{PermikonError, Result};

/// Column mapping for a compatible table, cached after initial discovery.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableMapping {
    pub table_name: String,
    pub col_md5: String,
    pub col_path: String,
    pub col_title: String,
    pub col_subtitle: Option<String>,
    pub col_artist: Option<String>,
    pub col_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongDbEntry {
    pub md5: String,
    pub path: String,
    pub title: String,
    pub subtitle: String,
    pub artist: String,
    pub source_db: String,
}

/// Case-insensitive column name matching.
fn find_column(available: &[String], target: &str) -> Option<String> {
    let lower = target.to_lowercase();
    available.iter().find(|c| c.to_lowercase() == lower).cloned()
}

/// Inspect all tables and return compatible column mappings.
pub fn discover_schema(db_path: &Path) -> Result<Vec<TableMapping>> {
    let conn = Connection::open(db_path)?;

    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")?;

    let table_names: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    let mut mappings = Vec::new();

    for table in &table_names {
        let pragma_query = format!("PRAGMA table_info(\"{}\")", table.replace('"', "\"\""));
        let mut pragma_stmt = match conn.prepare(&pragma_query) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let columns: Vec<String> = match pragma_stmt.query_map([], |row| {
            let name: String = row.get(1)?;
            Ok(name)
        }) {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(_) => continue,
        };

        if columns.is_empty() {
            continue;
        }

        // Required: md5
        let col_md5 = match find_column(&columns, "md5") {
            Some(c) => c,
            None => continue,
        };

        // Required: path (or equivalent)
        let path_names = ["path", "filepath", "filename", "file", "fullpath", "location"];
        let col_path = match path_names.iter().find_map(|name| find_column(&columns, name)) {
            Some(c) => c,
            None => continue,
        };

        // Required: title
        let col_title = match find_column(&columns, "title") {
            Some(c) => c,
            None => continue,
        };

        // Optional: subtitle, artist
        let col_subtitle = find_column(&columns, "subtitle");
        let col_artist = find_column(&columns, "artist");
        let col_mode = find_column(&columns, "mode");

        mappings.push(TableMapping {
            table_name: table.clone(),
            col_md5,
            col_path,
            col_title,
            col_subtitle,
            col_artist,
            col_mode,
        });
    }

    Ok(mappings)
}

/// Validate a SQLite database and return compatible table mappings.
pub fn validate_database(db_path: &Path) -> Result<Vec<TableMapping>> {
    if !db_path.exists() {
        return Err(PermikonError::NotFound(db_path.display().to_string()));
    }

    let conn = Connection::open(db_path)?;

    let is_valid: bool = conn
        .query_row("SELECT 1", [], |row| row.get::<_, i32>(0))
        .map(|v| v == 1)
        .unwrap_or(false);

    if !is_valid {
        return Err(PermikonError::Parse(format!(
            "'{}' is not a valid SQLite database",
            db_path.display()
        )));
    }

    let mappings = discover_schema(db_path)?;
    if mappings.is_empty() {
        return Err(PermikonError::Analysis(format!(
            "No compatible song table found in '{}'. \
             Expected tables with columns: md5, path, title.",
            db_path.display()
        )));
    }

    Ok(mappings)
}

/// Search using pre-cached table mappings.
pub fn search_with_mappings(
    db_path: &Path,
    mappings: &[TableMapping],
    query: &str,
    limit: usize,
) -> Result<Vec<SongDbEntry>> {
    let conn = Connection::open(db_path)?;

    let mut all_entries = Vec::new();
    let pattern = format!("%{}%", query);

    for mapping in mappings {
        let subtitle_expr = match &mapping.col_subtitle {
            Some(col) => format!("\"{}\"", col.replace('"', "\"\"")),
            None => "''".to_string(),
        };
        let artist_expr = match &mapping.col_artist {
            Some(col) => format!("\"{}\"", col.replace('"', "\"\"")),
            None => "''".to_string(),
        };

        let mode_filter = match &mapping.col_mode {
            Some(col) => format!(" AND \"{}\" = 7", col.replace('"', "\"\"")),
            None => String::new(),
        };

        let sql = format!(
            "SELECT \"{md5}\", \"{path}\", \"{title}\", {subtitle}, {artist}
             FROM \"{table}\"
             WHERE (\"{md5}\" LIKE ?1
                OR \"{path}\" LIKE ?1
                OR \"{title}\" LIKE ?1
                OR {subtitle} LIKE ?1
                OR {artist} LIKE ?1)
             {mode_filter}
             LIMIT ?2",
            md5 = mapping.col_md5.replace('"', "\"\""),
            path = mapping.col_path.replace('"', "\"\""),
            title = mapping.col_title.replace('"', "\"\""),
            subtitle = subtitle_expr,
            artist = artist_expr,
            table = mapping.table_name.replace('"', "\"\""),
            mode_filter = mode_filter,
        );

        if let Ok(mut stmt) = conn.prepare(&sql) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![pattern, limit], |row| {
                let md5: String = row.get(0)?;
                let path: String = row.get(1)?;
                let title: String = row.get(2)?;
                let subtitle: String = row.get(3).unwrap_or_default();
                let artist: String = row.get(4).unwrap_or_default();
                Ok(SongDbEntry {
                    md5,
                    path,
                    title,
                    subtitle,
                    artist,
                    source_db: String::new(), // filled in by caller
                })
            }) {
                for entry in rows.filter_map(|r| r.ok()) {
                    all_entries.push(entry);
                }
            }
        }

        if all_entries.len() >= limit {
            break;
        }
    }

    all_entries.truncate(limit);
    Ok(all_entries)
}

/// Get total row count across all compatible tables.
pub fn count_entries(db_path: &Path, mappings: &[TableMapping]) -> usize {
    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(_) => return 0,
    };

    let mut total = 0;
    for mapping in mappings {
        let sql = format!(
            "SELECT COUNT(*) FROM \"{}\"",
            mapping.table_name.replace('"', "\"\"")
        );
        if let Ok(count) = conn.query_row(&sql, [], |row| row.get::<_, usize>(0)) {
            total += count;
        }
    }
    total
}
