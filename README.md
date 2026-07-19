# ![Permikon](public/permikon_header.png)

Offline desktop workstation for analyzing BMS/BME/BMSON chart permutations.

Permikon wraps the [Permidex](https://permidex.app) UI and panchira analysis engine in a native desktop app via Tauri 2.

## Features

- Drag and drop `.bms`, `.bme`, `.bmson` files
- Analyzes all 5040 permutations with configurable scoring weights
- Instant cache: second drop of the same chart is instant
- History with search across analyzed charts
- Import external song databases (beatoraja, LR2, or any SQLite database with md5 + path + title)
- Difficulty table integration with configurable tables.
- Paste and Go: paste an MD5 hash from clipboard to instantly load a chart
- Search over analyzed charts, song databases, and difficulty tables
- Search result cards with title, difficulty levels from tables, artist, and analyzed indicator
- Search only tables mode to narrow results to charts in difficulty tables
- Registry rebuild with per-table download progress
- Configurable difficulty tables: add, edit, delete, enable/disable with custom prefix and strip-prefix rules
- Cross-platform: Linux, macOS, Windows

## Building

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- System dependencies for Tauri 2: https://v2.tauri.app/start/prerequisites/


### Build

```sh
cd src-tauri
cargo tauri build
```

Output: `src-tauri/target/release/bundle/`

## Project structure

```
permikon/
  src-tauri/          Rust backend
  panchira_cli/       Analysis engine
  public/             Frontend
```
