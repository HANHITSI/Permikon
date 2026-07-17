# ![Permikon](permikon_header.png)

Offline desktop workstation for analyzing BMS/BME/BMSON chart permutations.

Permikon wraps the Permidex UI and panchira analysis engine in a native desktop app via Tauri 2.

## Features

- Drag and drop `.bms`, `.bme`, `.bmson` files
- Search past files and your BMS player song database.
- Analyzes all 5040 permutations with configurable scoring weights
- Instant cache: second drop of the same chart is instant
- History with search across analyzed charts
- Import external song databases (beatoraja, LR2, or any SQLite database with md5 + path + title)
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
