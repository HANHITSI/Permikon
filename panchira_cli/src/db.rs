use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use crate::evaluator::PermRow;

const SONGDB_PATH: &str = "/opt/beatoraja/songdata.db";

pub fn find_file(md5: &str) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let conn = Connection::open(SONGDB_PATH)?;
    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'")?;
    let tables: Vec<String> = stmt
    .query_map([], |row| row.get(0))?
    .filter_map(|r| r.ok())
    .collect();

    for tbl in tables {
        let columns: Vec<String> = conn
        .prepare(&format!("PRAGMA table_info({})", tbl))?
        .query_map([], |row| row.get(1))?
        .filter_map(|r| r.ok())
        .collect();

        let md5_col = columns.iter().find(|c| c.to_lowercase() == "md5");
        let path_col = columns.iter().find(|c| {
            let c = c.to_lowercase();
            c == "path" || c == "filepath" || c == "filename"
        });

        if let (Some(md5_col), Some(path_col)) = (md5_col, path_col) {
            let query = format!(
                "SELECT {} FROM {} WHERE {} = ?1",
                path_col, tbl, md5_col
            );
            let mut stmt = conn.prepare(&query)?;
            let path: Option<String> = stmt
            .query_row(params![md5.to_lowercase()], |row| row.get(0))
            .ok();
            if let Some(path) = path {
                let full_path = Path::new(&path);
                if full_path.exists() {
                    return Ok(full_path.to_path_buf());
                }
            }
        }
    }
    Err(format!("No suitable table found in songdata.db for MD5 {}", md5).into())
}

pub fn create_table(db_path: &Path, table_name: &str) -> Result<(), Box<dyn std::error::Error>> {
    let conn = Connection::open(db_path)?;
    create_table_in_conn(&conn, table_name)
}

pub fn create_table_in_conn(conn: &Connection, table_name: &str) -> Result<(), Box<dyn std::error::Error>> {
    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS {} (
            md5 TEXT,
            perm TEXT,
            smooth REAL,
            tight REAL,
            base REAL,
            spike REAL,
            a1 REAL, a2 REAL, a3 REAL, a4 REAL, a5 REAL, a6 REAL, a7 REAL,
            trill_12 INTEGER, trill_13 INTEGER, trill_14 INTEGER, trill_15 INTEGER, trill_16 INTEGER, trill_17 INTEGER,
            trill_23 INTEGER, trill_24 INTEGER, trill_25 INTEGER, trill_26 INTEGER, trill_27 INTEGER,
            trill_34 INTEGER, trill_35 INTEGER, trill_36 INTEGER, trill_37 INTEGER,
            trill_45 INTEGER, trill_46 INTEGER, trill_47 INTEGER,
            trill_56 INTEGER, trill_57 INTEGER,
            trill_67 INTEGER,
            PRIMARY KEY (md5, perm)
    );",
    table_name
    ))?;
    Ok(())
}

pub fn insert_rows(
    conn: &Connection,
    table_name: &str,
    md5: &str,
    rows: &[PermRow],
) -> Result<(), Box<dyn std::error::Error>> {
    let placeholders: Vec<String> = (1..=34).map(|i| format!("?{}", i)).collect();
    let sql = format!(
        "INSERT OR REPLACE INTO {} (md5, perm, smooth, tight, base, spike, a1,a2,a3,a4,a5,a6,a7,
                      trill_12,trill_13,trill_14,trill_15,trill_16,trill_17,
                      trill_23,trill_24,trill_25,trill_26,trill_27,
                      trill_34,trill_35,trill_36,trill_37,
                      trill_45,trill_46,trill_47,
                      trill_56,trill_57,trill_67) VALUES ({})",
                      table_name,
                      placeholders.join(",")
    );

    conn.execute("BEGIN TRANSACTION", [])?;
    for row in rows {
        let trills = &row.trills;
        conn.execute(
            &sql,
            params![
                md5,
                row.perm,
                row.smooth,
                row.tight,
                row.base,
                row.spike,
                row.anchors[0],
                row.anchors[1],
                row.anchors[2],
                row.anchors[3],
                row.anchors[4],
                row.anchors[5],
                row.anchors[6],
                trills[0], trills[1], trills[2], trills[3], trills[4], trills[5],
                trills[6], trills[7], trills[8], trills[9], trills[10],
                trills[11], trills[12], trills[13], trills[14],
                trills[15], trills[16], trills[17],
                trills[18], trills[19],
                trills[20],
            ],
        )?;
    }
    conn.execute("COMMIT", [])?;
    Ok(())
}

pub fn merge_db(
    main_db: &Path,
    temp_db: &Path,
    table_name: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let dst_conn = Connection::open(main_db)?;
    let sql = format!(
        "ATTACH DATABASE '{}' AS src;
        INSERT OR REPLACE INTO {t} SELECT * FROM src.{t};
        DETACH DATABASE src;",
        temp_db.display(),
                      t = table_name
    );
    dst_conn.execute_batch(&sql)?;
    Ok(())
}
