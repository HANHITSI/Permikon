use panchira_cli::{analyze_chart, PanchiraError, Result};
use clap::{Parser, Subcommand};
use log::{info, warn};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};
use std::thread;
use rayon::prelude::*;
use rusqlite;
use tempfile;

const OUTPUT_DIR: &str = "/home/eetu/permdex/panchira/processed";
const DEFAULT_LOG_FILE: &str = "/home/eetu/permdex/panchira/panchira_batch.log";

#[derive(Parser)]
#[command(name = "panchira")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Chart {
        md5: String,
        #[arg(long)]
        out: PathBuf,
        #[arg(long, default_value = "chart")]
        table: String,
    },
    Batch {
        #[arg(long, default_value_t = 6)]
        workers: usize,
        #[arg(long, default_value_t = 30)]
        timeout: u64,
        #[arg(long, default_value = DEFAULT_LOG_FILE)]
        log_file: PathBuf,
        files: Vec<String>,
    },
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Commands::Chart { md5, out, table } => {
            if let Err(e) = process_single_chart(&md5, &out, &table) {
                eprintln!("Error processing {}: {}", md5, e);
                std::process::exit(1);
            }
        }
        Commands::Batch { workers, timeout, log_file, files } => {
            simple_logger::SimpleLogger::new()
                .with_level(log::LevelFilter::Info)
                .env()
                .init()
                .ok();
            run_batch(workers, timeout, files, &log_file);
        }
    }
}

fn log_warn(msg: &str, log_path: &Path) {
    warn!("{}", msg);
    if let Ok(mut f) = fs::OpenOptions::new().append(true).create(true).open(log_path) {
        let _ = writeln!(f, "{}", msg);
    }
}

fn run_batch(workers: usize, timeout_secs: u64, files: Vec<String>, log_path: &Path) {
    let txt_files: Vec<PathBuf> = if files.is_empty() {
        let base = expand_tilde("~/permdex/panchira");
        fs::read_dir(&base)
            .expect("cannot read base directory")
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map_or(false, |e| e == "txt"))
            .collect()
    } else {
        files.into_iter().map(PathBuf::from).collect()
    };

    if txt_files.is_empty() {
        eprintln!("No .txt files found.");
        return;
    }

    fs::create_dir_all(OUTPUT_DIR).unwrap();

    for txt_file in &txt_files {
        let table_name = txt_file.file_stem().unwrap().to_str().unwrap();
        let db_path = Path::new(OUTPUT_DIR).join(format!("{}.db", table_name));

        let file = fs::File::open(txt_file).expect("Failed to open MD5 list");
        let md5s: Vec<String> = BufReader::new(file)
            .lines()
            .filter_map(|l| l.ok())
            .filter(|l| !l.is_empty())
            .collect();

        if md5s.is_empty() {
            log_warn(&format!("{} is empty, skipping.", table_name), log_path);
            continue;
        }

        println!(
            "Processing {} ({} charts) -> {}",
            table_name,
            md5s.len(),
            db_path.display()
        );
        info!("Starting {} with {} charts", table_name, md5s.len());

        if let Err(e) = panchira_cli::db::create_table(&db_path, table_name) {
            log_warn(&format!("Failed to create table {}: {}", table_name, e), log_path);
            continue;
        }

        let total = md5s.len();
        let processed = AtomicUsize::new(0);
        let start = Instant::now();

        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(workers)
            .build()
            .unwrap();

        pool.install(|| {
            md5s.par_iter().for_each(|md5| {
                let tmp_dir = tempfile::tempdir().unwrap();
                let tmp_db = tmp_dir.path().join("chart.db");
                let status = process_chart_subprocess(md5, &tmp_db, table_name, timeout_secs, log_path);
                if status {
                    if let Err(e) = panchira_cli::db::merge_db(&db_path, &tmp_db, table_name) {
                        log_warn(&format!("Merge failed for {}: {}", md5, e), log_path);
                    }
                } else {
                    log_warn(&format!("Chart {} skipped", md5), log_path);
                }
                let count = processed.fetch_add(1, Ordering::SeqCst) + 1;
                eprint!("\r   {}/{} charts done", count, total);
            });
        });

        let elapsed = start.elapsed();
        println!("\nDone in {:.2} seconds", elapsed.as_secs_f64());
        info!("Finished {} in {:.2}s", table_name, elapsed.as_secs_f64());
    }
}

fn process_chart_subprocess(md5: &str, out_db: &Path, table_name: &str, timeout_secs: u64, log_path: &Path) -> bool {
    let exe = std::env::current_exe().expect("Cannot get current exe path");
    let child = Command::new(exe)
        .arg("chart")
        .arg(md5)
        .arg("--out")
        .arg(out_db)
        .arg("--table")
        .arg(table_name)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn();

    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            log_warn(&format!("{} failed to spawn: {}", md5, e), log_path);
            return false;
        }
    };

    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    let mut err = String::new();
                    if let Some(stderr) = child.stderr.as_mut() {
                        use std::io::Read;
                        stderr.read_to_string(&mut err).ok();
                    }
                    log_warn(&format!("{} error: {}", md5, err.trim()), log_path);
                    return false;
                }
                return true;
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    log_warn(&format!("{} timed out after {}s", md5, timeout_secs), log_path);
                    return false;
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                log_warn(&format!("{} wait error: {}", md5, e), log_path);
                return false;
            }
        }
    }
}

fn process_single_chart(md5: &str, out_db: &Path, table_name: &str) -> Result<()> {
    let filepath = panchira_cli::db::find_file(md5)?;
    let analysis = panchira_cli::analyze_chart(&filepath)?;

    if analysis.permutations.is_empty() {
        return Ok(());
    }

    let conn = rusqlite::Connection::open(out_db)?;
    conn.execute_batch(
        "PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA cache_size=-2000;",
    )?;
    panchira_cli::db::create_table_in_conn(&conn, table_name)?;

    // Insert with metadata
    for row in &analysis.permutations {
        // Use the existing insert_rows which takes a slice
    }
    panchira_cli::db::insert_rows(&conn, table_name, md5, &analysis.permutations)?;
    Ok(())
}

fn expand_tilde(path: &str) -> PathBuf {
    if path.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(&path[2..]);
        }
    }
    PathBuf::from(path)
}
