use thiserror::Error;

#[derive(Error, Debug)]
pub enum PermikonError {
    #[error("File error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("File not found: {0}")]
    NotFound(String),

    #[error("Parse error: {0}")]
    Parse(String),

    #[error("Analysis error: {0}")]
    Analysis(String),

    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("Chart analysis failed: {0}")]
    Panchira(#[from] panchira_cli::PanchiraError),

    #[error("Clipboard error: {0}")]
    Clipboard(#[from] tauri_plugin_clipboard_manager::Error),

    #[error("Invalid file format '{0}'. Supported formats: .bms, .bme, .bmson, .bml")]
    InvalidFormat(String),
}

pub type Result<T> = std::result::Result<T, PermikonError>;

impl serde::Serialize for PermikonError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
    S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
