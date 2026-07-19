use serde::{Deserialize, Serialize};

use crate::storage::get_custom_tables_path;

/// A user-configured difficulty table entry.
/// Stored in custom_tables.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTableConfig {
    pub name: String,
    pub url: String,
    pub prefix: String,
    pub enabled: bool,
    pub strip_prefix: String,
}

/// A merged entry in registry.json: one per MD5, with combined levels.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableEntry {
    pub md5: String,
    pub title: String,
    pub artist: String,
    pub levels: Vec<String>,
}

/// Returns the curated set of default difficulty tables.
pub fn get_default_tables() -> Vec<CustomTableConfig> {
    vec![
        CustomTableConfig {
            name: "Satellite".into(),
            url: "https://stellabms.xyz/sl/score.json".into(),
            prefix: "sl".into(),
            enabled: true,
            strip_prefix: "★".into(),
        },
        CustomTableConfig {
            name: "Stella".into(),
            url: "https://stellabms.xyz/st/score.json".into(),
            prefix: "st".into(),
            enabled: true,
            strip_prefix: "★".into(),
        },
        CustomTableConfig {
            name: "Insane".into(),
            url: "https://darksabun.club/table/archive/insane1/data.json".into(),
            prefix: "in".into(),
            enabled: true,
            strip_prefix: "★".into(),
        },
        CustomTableConfig {
            name: "Codestream".into(),
            url: "https://script.googleusercontent.com/macros/echo?user_content_key=AUkAhnTda-rIKHbwlgJ9KGK-vZEGM9HUVNSkyjdrLrj-I9CkFSGsMqsW1rdlVFBI67LvIrJrsxeHakvP8-rvExJCIyFsYDjPxTXEZXC6tSlcTrKCXq88ePz5KhSGf5L2rPSYAYBqeoCBGsw9WYNgXpJxHcMnVdMAYIr4mCwBrHN0MapRU_g3u3xOXZPiHKwfTQBk61MFmAdX43VJIU-PelRNGKF89fJLrycN-LotfakHXxiC9Jbtyl-2IUY73gBlvIsNdLrYfELrM_tH_CmVeC8J6aZ0yA-tDQ&lib=MaCuaL_B-6BIjPIN6-LoGkpXvWRuAoVU2".into(),
            prefix: "cs, css, subcs, subcss, csr, csp".into(),
            enabled: true,
            strip_prefix: "乱打, 重発狂, sub乱打, sub重発狂, 査定中, 保留".into(),
        },
        CustomTableConfig {
            name: "NG Insane".into(),
            url: "https://rattoto10.github.io/second_table/insane_data.json".into(),
            prefix: "ngin".into(),
            enabled: true,
            strip_prefix: "★".into(),
        },
        CustomTableConfig {
            name: "NG Overjoy".into(),
            url: "https://rattoto10.github.io/second_table/overjoy_score.json".into(),
            prefix: "ngoj".into(),
            enabled: true,
            strip_prefix: "".into(),
        },
        CustomTableConfig {
            name: "Overjoy".into(),
            url: "https://lr2.sakura.ne.jp/data/score.json".into(),
            prefix: "oj".into(),
            enabled: true,
            strip_prefix: "".into(),
        },
        CustomTableConfig {
            name: "UDE".into(),
            url: "https://script.googleusercontent.com/macros/echo?user_content_key=AUkAhnTwRmhAFXyft2I8XoWEolIC9AhvJtrsTOMHd7DwPY8oh356xFcwanf3MrFjv7bWBmG6rLI3RPG-x8A07NX-kwcXLMaEHJSApkZ1bfR3I5AnkjUTdEQvB0axnj98Re4c9eUsjLcnqV9X_KnyKlQz2dlcy8wykKo-K3LW_sHPF_W5bjiAd1VaxBX13YsR-Zmx3FLJh5UH81PpVo_22QMYAPm9yjru_FhFVxtR7cQ0ybV7PIuDz25Cj3iv28EeyZMZaElszmyS8qADdWv5QohuuzNwmwBdsA&lib=MqZaTueNTaM_gNijgAs79ggcsk8TLdWHb".into(),
            prefix: "".into(),
            enabled: true,
            strip_prefix: "".into(),
        },
    ]
}

/// Load custom table configurations from disk.
/// On first launch, writes the default tables to the config file.
pub fn load_custom_tables() -> Result<Vec<CustomTableConfig>, crate::error::PermikonError> {
    let path = get_custom_tables_path()?;

    if path.exists() {
        let content = std::fs::read_to_string(&path)?;
        let tables: Vec<CustomTableConfig> = serde_json::from_str(&content)?;
        return Ok(tables);
    }

    // First launch: write defaults
    let defaults = get_default_tables();
    let content = serde_json::to_string_pretty(&defaults)?;
    std::fs::write(&path, content)?;
    Ok(defaults)
}

/// Save custom table configurations to disk.
pub fn save_custom_tables(tables: &[CustomTableConfig]) -> Result<(), crate::error::PermikonError> {
    let path = get_custom_tables_path()?;
    let content = serde_json::to_string_pretty(tables)?;
    std::fs::write(path, content)?;
    Ok(())
}

/// Process a raw level string according to the table's strip/prefix config.
///
/// 1. If strip_prefix is configured and matches the beginning, remove it.
/// 2. Normalize whitespace.
/// 3. Prepend the configured prefix.
pub fn process_level(raw: &str, config: &CustomTableConfig) -> Option<String> {
    let mut level = raw.to_string();

    // Strip prefix and prepend paired prefix.
    // Comma-separated values map positionally, e.g.:
    //   strip_prefix: "乱打, 重発狂"
    //   prefix: "cs, css"
    //   "乱打-FOO" → "cs-FOO", "重発狂-BAR" → "css-BAR"
    let strip_parts: Vec<&str> = if config.strip_prefix.is_empty() {
        vec![]
    } else {
        config.strip_prefix.split(',').collect()
    };
    let prefix_parts: Vec<&str> = if config.prefix.is_empty() {
        vec![]
    } else {
        config.prefix.split(',').collect()
    };

    if !strip_parts.is_empty() {
        for (i, sp) in strip_parts.iter().enumerate() {
            let sp = sp.trim();
            if !sp.is_empty() && level.starts_with(sp) {
                level = level[sp.len()..].trim().to_string();
                if let Some(p) = prefix_parts.get(i) {
                    let p = p.trim();
                    if !p.is_empty() {
                        level = format!("{}{}", p, level);
                    }
                } else if let Some(p) = prefix_parts.last() {
                    let p = p.trim();
                    if !p.is_empty() {
                        level = format!("{}{}", p, level);
                    }
                }
                return if level.is_empty() { None } else { Some(level) };
            }
        }
    }

    // No strip matched: just prepend prefix (first entry or single)
    level = level.trim().to_string();
    if let Some(p) = prefix_parts.first() {
        let p = p.trim();
        if !p.is_empty() {
            level = format!("{}{}", p, level);
        }
    }

    if level.is_empty() { None } else { Some(level) }
}

/// Download a table and return its entries with processed levels.
pub async fn download_table(
    config: &CustomTableConfig,
) -> anyhow::Result<Vec<TableEntry>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;

    let response = client.get(&config.url).send().await?.error_for_status()?;
    let data: serde_json::Value = response.json().await?;

    let entries: Vec<TableEntry> = data
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("Expected JSON array for table {}", config.name))?
        .iter()
        .filter_map(|entry| {
            let md5 = entry.get("md5")?.as_str()?;
            let title = entry.get("title")?.as_str()?;
            let artist = entry.get("artist").and_then(|v| v.as_str()).unwrap_or("");
            let level_raw = entry.get("level")?.as_str()?;

            let level_str = process_level(level_raw, config)?;
            Some(TableEntry {
                md5: md5.to_string(),
                title: title.to_string(),
                artist: artist.to_string(),
                levels: vec![level_str],
            })
        })
        .collect();

    Ok(entries)
}
