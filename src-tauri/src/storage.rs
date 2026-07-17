use std::path::PathBuf;

use crate::error::{PermikonError, Result};

/// Returns the platform-specific application data directory.
///
/// Linux:   ~/.permikon/
/// Windows: %APPDATA%/Permikon/
/// macOS:   ~/Library/Application Support/Permikon/
pub fn get_app_data_dir() -> Result<PathBuf> {
    let base = if cfg!(target_os = "windows") {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .map_err(|_| {
                PermikonError::Io(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "APPDATA not set",
                ))
            })?
            .join("Permikon")
    } else if cfg!(target_os = "macos") {
        dirs::home_dir()
            .ok_or_else(|| {
                PermikonError::Io(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "Home directory not found",
                ))
            })?
            .join("Library/Application Support/Permikon")
    } else {
        dirs::home_dir()
            .ok_or_else(|| {
                PermikonError::Io(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "Home directory not found",
                ))
            })?
            .join(".permikon")
    };

    std::fs::create_dir_all(&base)?;
    Ok(base)
}

pub fn get_history_db_path() -> Result<PathBuf> {
    Ok(get_app_data_dir()?.join("history.db"))
}

pub fn get_settings_path() -> Result<PathBuf> {
    Ok(get_app_data_dir()?.join("settings.json"))
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_app_data_dir() {
        let dir = get_app_data_dir().unwrap();
        assert!(dir.exists());
        let path_str = dir.to_string_lossy();
        assert!(path_str.contains("Permikon") || path_str.contains("permikon"));
    }
}
