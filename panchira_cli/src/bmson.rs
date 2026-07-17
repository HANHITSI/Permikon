use crate::{ChartMetadata, PanchiraError, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

pub fn parse_bmson(filepath: &Path) -> Result<(Vec<(f64, u8)>, ChartMetadata)> {
    let content = fs::read_to_string(filepath)?;
    let data: Value = serde_json::from_str(&content)?;

    let info = data.get("info").ok_or_else(|| PanchiraError::Parse("Missing info".to_string()))?;
    let init_bpm = info.get("init_bpm").and_then(|v| v.as_f64()).unwrap_or(150.0);
    let resolution = info.get("resolution").and_then(|v| v.as_u64()).unwrap_or(240) as f64;

    let metadata = ChartMetadata {
        title: info.get("title").and_then(|v| v.as_str()).unwrap_or("Unknown").to_string(),
        subtitle: info.get("sub_title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        artist: info.get("artist").and_then(|v| v.as_str()).unwrap_or("Unknown").to_string(),
        mode: info.get("mode_hint").and_then(|v| v.as_str()).unwrap_or("7k").to_string(),
        difficulty: info.get("difficulty").and_then(|v| v.as_i64()).map(|d| d.to_string()).unwrap_or("".to_string()),
        level: info.get("level").and_then(|v| v.as_i64()).map(|l| l as i32),
        bpm: Some(init_bpm),
    };

    let bpm_events: Vec<(u64, f64)> = data
        .get("bpm_events")
        .map(|arr| arr.as_array().map(|a| a.iter()
        .filter_map(|ev| {
            let y = ev.get("y")?.as_u64()?;
            let bpm = ev.get("bpm")?.as_f64()?;
            Some((y, bpm))
        }).collect::<Vec<_>>()).unwrap_or_default())
        .unwrap_or_default();

    let stop_events: Vec<(u64, u64)> = data
        .get("stop_events")
        .map(|arr| arr.as_array().map(|a| a.iter()
        .filter_map(|ev| {
            let y = ev.get("y")?.as_u64()?;
            let dur = ev.get("duration")?.as_u64()?;
            Some((y, dur))
        }).collect::<Vec<_>>()).unwrap_or_default())
        .unwrap_or_default();

    let mut notes_raw: Vec<(u64, u8)> = Vec::new();
    if let Some(channels) = data.get("sound_channels").and_then(|v| v.as_array()) {
        for ch in channels {
            if let Some(notes_arr) = ch.get("notes").and_then(|v| v.as_array()) {
                for note in notes_arr {
                    let x = note.get("x").and_then(|v| v.as_u64()).unwrap_or(0);
                    if x == 0 { continue; }
                    let lane = x as u8;
                    if lane < 1 || lane > 7 { continue; }
                    let y = note.get("y").and_then(|v| v.as_u64()).unwrap_or(0);
                    let l = note.get("l").and_then(|v| v.as_u64()).unwrap_or(0);
                    if l > 0 { continue; }
                    notes_raw.push((y, lane));
                }
            }
        }
    }

    if notes_raw.is_empty() {
        return Ok((Vec::new(), metadata));
    }

    let mut pulses_set: Vec<u64> = notes_raw.iter().map(|(y, _)| *y).collect();
    pulses_set.extend(bpm_events.iter().map(|(y, _)| *y));
    pulses_set.extend(stop_events.iter().map(|(y, _)| *y));
    pulses_set.sort();
    pulses_set.dedup();

    let mut time_at_pulse: HashMap<u64, f64> = HashMap::new();
    let mut current_time = 0.0;
    let mut current_bpm = init_bpm;
    let mut prev_pulse = 0u64;

    for pulse in pulses_set {
        let pulse_diff = pulse - prev_pulse;
        if pulse_diff > 0 {
            current_time += pulse_diff as f64 * (60.0 / current_bpm) / resolution;
        }

        if let Some(last_bpm) = bpm_events.iter().rev().find(|(y, _)| *y == pulse) {
            current_bpm = last_bpm.1;
        }

        let total_stop: u64 = stop_events.iter().filter(|(y, _)| *y == pulse).map(|(_, d)| d).sum();
        if total_stop > 0 {
            current_time += total_stop as f64 * (60.0 / current_bpm) / resolution;
        }

        time_at_pulse.insert(pulse, current_time);
        prev_pulse = pulse;
    }

    let mut out_notes: Vec<(f64, u8)> = notes_raw.iter()
        .map(|(y, lane)| (*time_at_pulse.get(y).unwrap_or(&0.0), *lane))
        .collect();
    out_notes.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    Ok((out_notes, metadata))
}
