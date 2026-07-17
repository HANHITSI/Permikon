mod parser;
mod bmson;
mod evaluator;
mod db;

use std::path::Path;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PanchiraError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Parse error: {0}")]
    Parse(String),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("File not found: {0}")]
    NotFound(String),
    #[error("Analysis error: {0}")]
    Analysis(String),
}

pub type Result<T> = std::result::Result<T, PanchiraError>;

pub use parser::parse_bms;
pub use bmson::parse_bmson;
pub use evaluator::{evaluate_all, PermRow};
pub use db::{create_table, create_table_in_conn, insert_rows, merge_db, find_file};

/// Metadata extracted from a chart file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartMetadata {
    pub title: String,
    pub subtitle: String,
    pub artist: String,
    pub mode: String,
    pub difficulty: String,
    pub level: Option<i32>,
    pub bpm: Option<f64>,
}

/// Complete analysis result for a chart
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartAnalysis {
    pub metadata: ChartMetadata,
    pub permutations: Vec<PermRow>,
}

/// Parse a BMS/BME/BMSON file and return both notes and metadata
pub fn parse_chart(filepath: &Path) -> Result<(Vec<(f64, u8)>, ChartMetadata)> {
    let ext = filepath.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    match ext.as_str() {
        "bmson" => {
            let (notes, metadata) = parse_bmson(filepath)?;
            Ok((notes, metadata))
        }
        "bms" | "bme" | _ => {
            let (notes, metadata) = parse_bms(filepath)?;
            Ok((notes, metadata))
        }
    }
}

/// Analyze a chart file and return typed analysis result
pub fn analyze_chart(filepath: &Path) -> Result<ChartAnalysis> {
    let (notes, metadata) = parse_chart(filepath)?;
    if notes.is_empty() {
        return Err(PanchiraError::Analysis("No notes found in chart".to_string()));
    }
    let permutations = evaluate_all(&notes);
    Ok(ChartAnalysis { metadata, permutations })
}

/// Analyze a chart file and return permutations only (for internal use)
pub fn analyze_chart_rows(filepath: &Path) -> Result<Vec<PermRow>> {
    let (notes, _metadata) = parse_chart(filepath)?;
    if notes.is_empty() {
        return Err(PanchiraError::Analysis("No notes found in chart".to_string()));
    }
    Ok(evaluate_all(&notes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_chart_not_found() {
        let result = parse_chart(Path::new("/nonexistent.bms"));
        assert!(result.is_err());
    }

    #[test]
    fn test_analyze_chart_not_found() {
        let result = analyze_chart(Path::new("/nonexistent.bms"));
        assert!(result.is_err());
    }
}
