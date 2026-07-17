use std::collections::HashMap;
use std::fs;
use std::path::Path;
use regex_lite::Regex;
use crate::{ChartMetadata, PanchiraError, Result};

// ---------- domain types ----------

#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum EventKind { Bpm, Stop, Note }

enum BpmSource { Direct(f64), Indexed(u32) }

/// Musical beat position stored as an integer (scaled for deterministic ordering).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Beat(i64);

impl Beat {
    fn from_beats(beats: f64) -> Self {
        Self((beats * 1_000_000_000.0).round() as i64)
    }

    fn to_beats(self) -> f64 {
        self.0 as f64 / 1_000_000_000.0
    }
}

struct RawEvent {
    meas: u32,
    slot: u32,
    resolution: u32,
    kind: EventKind,
    bpm_source: Option<BpmSource>,
    duration: u32,
    lane: u8,
}

struct Event {
    beat: Beat,
    kind: EventKind,
    bpm_source: Option<BpmSource>,
    duration: u32,
    lane: u8,
}

struct TsBoundary {
    measure: u32,
    cumulative_beats: f64,
    multiplier: f64,
}

struct TimingState {
    bpm: f64,
    multiplier: f64,
    beat: f64,
    time: f64,
    ts_idx: usize,
}

// ---------- channel classification ----------

enum ChannelGroup {
    TimeSig,
    BpmDirect,
    BpmIndexed,
    Stop,
    Note { lane: u8 },
    Ignored,
}

fn classify_channel(chan: u32) -> ChannelGroup {
    match chan {
        2 => ChannelGroup::TimeSig,
        3 => ChannelGroup::BpmDirect,
        8 => ChannelGroup::BpmIndexed,
        9 => ChannelGroup::Stop,
        _ => {
            let group = (chan / 10) as u8;
            let lane_code = (chan % 10) as u8;
            if (1..=6).contains(&group) && matches!(lane_code, 1..=5 | 8 | 9) {
                let lane = match lane_code { 8 => 6, 9 => 7, l => l };
                ChannelGroup::Note { lane }
            } else {
                ChannelGroup::Ignored
            }
        }
    }
}

// ---------- metadata extraction ----------

fn extract_metadata(lines: &[&str]) -> ChartMetadata {
    let mut meta = ChartMetadata {
        title: "Unknown".to_string(),
        subtitle: String::new(),
        artist: "Unknown".to_string(),
        mode: "7k".to_string(),
        difficulty: String::new(),
        level: None,
        bpm: None,
    };

    let title_re = Regex::new(r"^#TITLE\s*(.*)$").ok();
    let subtitle_re = Regex::new(r"^#SUBTITLE\s*(.*)$").ok();
    let artist_re = Regex::new(r"^#ARTIST\s*(.*)$").ok();
    let genre_re = Regex::new(r"^#GENRE\s*(.*)$").ok();
    let bpm_re = Regex::new(r"^#BPM\s+([\d.]+)$").ok();
    let playlevel_re = Regex::new(r"^#PLAYLEVEL\s+(\d+)$").ok();
    let mode_re = Regex::new(r"^#MODE\s+(\w+)$").ok();
    let difficulty_re = Regex::new(r"^#DIFFICULTY\s+(\d+)$").ok();
    let level_re = Regex::new(r"^#LEVEL\s+(\d+)$").ok();

    for line in lines {
        let line = line.trim();
        if line.is_empty() || line.starts_with('*') { continue; }

        if let Some(re) = &title_re {
            if let Some(caps) = re.captures(line) {
                meta.title = caps[1].trim().to_string();
                continue;
            }
        }
        if let Some(re) = &subtitle_re {
            if let Some(caps) = re.captures(line) {
                meta.subtitle = caps[1].trim().to_string();
                continue;
            }
        }
        if let Some(re) = &artist_re {
            if let Some(caps) = re.captures(line) {
                meta.artist = caps[1].trim().to_string();
                continue;
            }
        }
        if let Some(re) = &genre_re {
            if let Some(_caps) = re.captures(line) {
                // genre can be used as fallback for mode/difficulty
                continue;
            }
        }
        if let Some(re) = &bpm_re {
            if let Some(caps) = re.captures(line) {
                if let Ok(val) = caps[1].parse::<f64>() {
                    meta.bpm = Some(val);
                }
                continue;
            }
        }
        if let Some(re) = &playlevel_re {
            if let Some(caps) = re.captures(line) {
                if let Ok(val) = caps[1].parse::<i32>() {
                    meta.level = Some(val);
                    meta.difficulty = val.to_string();
                }
                continue;
            }
        }
        if let Some(re) = &mode_re {
            if let Some(caps) = re.captures(line) {
                meta.mode = caps[1].trim().to_string();
                continue;
            }
        }
        if let Some(re) = &difficulty_re {
            if let Some(caps) = re.captures(line) {
                if let Ok(val) = caps[1].parse::<i32>() {
                    meta.difficulty = val.to_string();
                }
                continue;
            }
        }
        if let Some(re) = &level_re {
            if let Some(caps) = re.captures(line) {
                if let Ok(val) = caps[1].parse::<i32>() {
                    meta.level = Some(val);
                    if meta.difficulty.is_empty() {
                        meta.difficulty = val.to_string();
                    }
                }
                continue;
            }
        }
    }

    meta
}

// ---------- public entry point ----------

pub fn parse_bms(filepath: &Path) -> Result<(Vec<(f64, u8)>, ChartMetadata)> {
    let bytes = fs::read(filepath)?;

    let content = String::from_utf8_lossy(&bytes);
    let content = if content.contains('\u{FFFD}') {
        let (sjis, _, had_errors) = encoding_rs::SHIFT_JIS.decode(&bytes);
        if had_errors {
            return Err(PanchiraError::Parse("File is neither valid UTF-8 nor Shift-JIS".to_string()));
        }
        sjis.into_owned()
    } else {
        content.into_owned()
    };
    let lines: Vec<&str> = content.lines().collect();

    // Extract metadata first
    let metadata = extract_metadata(&lines);

    let mut bpm_table: HashMap<u32, f64> = HashMap::new();
    let mut stop_defs: HashMap<u32, u32> = HashMap::new();
    let mut ts_map: HashMap<u32, f64> = HashMap::new();

    let bpm_line_re = Regex::new(r"^#BPM\s+([\d.]+)$").map_err(|e| PanchiraError::Parse(e.to_string()))?;
    let bpm_idx_re = Regex::new(r"^#BPM\s+(\d+)\s+([\d.]+)$").map_err(|e| PanchiraError::Parse(e.to_string()))?;
    let stop_idx_re = Regex::new(r"^#STOP\s+(\d+)\s+(\d+)$").map_err(|e| PanchiraError::Parse(e.to_string()))?;
    let data_line_re = Regex::new(r"^#(\d+)([0-9A-Z]{2}):(.+)$").map_err(|e| PanchiraError::Parse(e.to_string()))?;

    // ---- first pass: collect all definitions ----
    for line in &lines {
        let line = line.trim();
        if line.is_empty() || line.starts_with('*') { continue; }

        if let Some(caps) = bpm_line_re.captures(line) {
            if let Ok(val) = caps[1].parse::<f64>() {
                if val.abs() > 0.001 { bpm_table.insert(0, val); }
            }
        } else if let Some(caps) = bpm_idx_re.captures(line) {
            if let (Ok(idx), Ok(val)) = (caps[1].parse::<u32>(), caps[2].parse::<f64>()) {
                if val.abs() > 0.001 { bpm_table.insert(idx, val); }
            }
        } else if let Some(caps) = stop_idx_re.captures(line) {
            if let (Ok(idx), Ok(val)) = (caps[1].parse::<u32>(), caps[2].parse::<u32>()) {
                stop_defs.insert(idx, val);
            }
        } else if let Some(caps) = data_line_re.captures(line) {
            let meas_str = &caps[1];
            let chan_str = &caps[2];
            let data = &caps[3];

            let meas = meas_str.parse::<u32>().map_err(|e| PanchiraError::Parse(e.to_string()))?;
            let chan = u32::from_str_radix(chan_str, 36).map_err(|e| PanchiraError::Parse(e.to_string()))?;

            if chan == 2 {
                if let Ok(val) = data.parse::<f64>() {
                    if val > 0.0 { ts_map.insert(meas, val); }
                }
            }
        }
    }

    // ---- second pass: collect raw events with all definitions known ----
    let mut raw_events: Vec<RawEvent> = Vec::new();

    fn for_each_slot(data: &str, mut cb: impl FnMut(usize, &str)) {
        let b = data.as_bytes();
        let slots = b.len() / 2;
        for slot in 0..slots {
            let start = slot * 2;
            let hex = std::str::from_utf8(&b[start..start + 2]).unwrap_or("00");
            cb(slot, hex);
        }
    }

    for line in &lines {
        let line = line.trim();
        if line.is_empty() || line.starts_with('*') { continue; }

        if let Some(caps) = data_line_re.captures(line) {
            let meas_str = &caps[1];
            let chan_str = &caps[2];
            let data = &caps[3];

            let meas = meas_str.parse::<u32>().map_err(|e| PanchiraError::Parse(e.to_string()))?;
            let chan = u32::from_str_radix(chan_str, 36).map_err(|e| PanchiraError::Parse(e.to_string()))?;
            let resolution = (data.len() / 2) as u32;

            let group = classify_channel(chan);
            match group {
                ChannelGroup::BpmDirect => {
                    for_each_slot(data, |slot, hex| {
                        if let Ok(raw) = u32::from_str_radix(hex, 16) {
                            let bpm = raw as f64;
                            if bpm.abs() > 0.001 {
                                raw_events.push(RawEvent {
                                    meas, slot: slot as u32, resolution,
                                    kind: EventKind::Bpm,
                                    bpm_source: Some(BpmSource::Direct(bpm)),
                                                duration: 0, lane: 0,
                                });
                            }
                        }
                    });
                }
                ChannelGroup::BpmIndexed => {
                    for_each_slot(data, |slot, hex| {
                        if let Ok(idx) = u32::from_str_radix(hex, 16) {
                            // Table is fully populated from first pass, always valid.
                            raw_events.push(RawEvent {
                                meas, slot: slot as u32, resolution,
                                kind: EventKind::Bpm,
                                bpm_source: Some(BpmSource::Indexed(idx)),
                                            duration: 0, lane: 0,
                            });
                        }
                    });
                }
                ChannelGroup::Stop => {
                    for_each_slot(data, |slot, hex| {
                        if let Ok(raw) = u32::from_str_radix(hex, 16) {
                            let dur = stop_defs.get(&raw).copied().unwrap_or(raw);
                            raw_events.push(RawEvent {
                                meas, slot: slot as u32, resolution,
                                kind: EventKind::Stop,
                                bpm_source: None,
                                duration: dur, lane: 0,
                            });
                        }
                    });
                }
                ChannelGroup::Note { lane } => {
                    for_each_slot(data, |slot, hex| {
                        if hex != "00" {
                            raw_events.push(RawEvent {
                                meas, slot: slot as u32, resolution,
                                kind: EventKind::Note,
                                bpm_source: None,
                                duration: 0, lane,
                            });
                        }
                    });
                }
                _ => {}  // time sig, ignored
            }
        }
    }

    if bpm_table.is_empty() { bpm_table.insert(0, 150.0); }

    // ---- time-signature boundary table ----
    let mut boundaries: Vec<TsBoundary> = Vec::new();
    {
        let mut sorted_ts: Vec<(u32, f64)> = ts_map.iter().map(|(&m, &v)| (m, v)).collect();
        sorted_ts.sort_by_key(|(m, _)| *m);
        let mult0 = ts_map.get(&0).copied().unwrap_or(1.0);
        if sorted_ts.first().map(|(m, _)| *m) != Some(0) {
            sorted_ts.insert(0, (0, mult0));
        }
        let mut cumul = 0.0;
        let mut prev_m = 0u32;
        let mut cur_mult = mult0;
        for (m, mult) in sorted_ts {
            let span = m - prev_m;
            cumul += span as f64 * 4.0 * cur_mult;
            boundaries.push(TsBoundary { measure: m, cumulative_beats: cumul, multiplier: mult });
            prev_m = m;
            cur_mult = mult;
        }
    }

    let measure_to_beats = |meas: u32| -> f64 {
        let pos = boundaries.partition_point(|b| b.measure <= meas);
        if pos == 0 {
            let mult0 = ts_map.get(&0).copied().unwrap_or(1.0);
            return meas as f64 * 4.0 * mult0;
        }
        let prev = &boundaries[pos - 1];
        let beats_at_prev = prev.cumulative_beats;
        let mult_after = prev.multiplier;
        let delta = meas - prev.measure;
        beats_at_prev + delta as f64 * 4.0 * mult_after
    };

    let mut events: Vec<Event> = raw_events.into_iter().map(|r| {
        let beat = measure_to_beats(r.meas) + (r.slot as f64 / r.resolution as f64) * 4.0;
        Event {
            beat: Beat::from_beats(beat),
                                                            kind: r.kind,
                                                            bpm_source: r.bpm_source,
                                                            duration: r.duration,
                                                            lane: r.lane,
        }
    }).collect();

    events.sort_by(|a, b| {
        a.beat.cmp(&b.beat)
        .then(a.kind.cmp(&b.kind))
    });

    let initial_bpm = bpm_table.get(&0).copied().unwrap_or(150.0);
    let first_mult = ts_map.get(&0).copied().unwrap_or(1.0);
    let mut state = TimingState {
        bpm: initial_bpm,
        multiplier: first_mult,
        beat: 0.0,
        time: 0.0,
        ts_idx: 0,
    };
    while state.ts_idx < boundaries.len() && boundaries[state.ts_idx].cumulative_beats <= 0.0 {
        state.ts_idx += 1;
    }

    let mut output_notes: Vec<(f64, u8)> = Vec::new();

    let seconds_per_beat = |bpm: f64, mult: f64| -> f64 {
        (60.0 / bpm.abs().max(0.001)) * mult
    };

    for event in &events {
        let to_beat = event.beat.to_beats();
        let delta_beats = to_beat - state.beat;
        if delta_beats > 0.0 {
            let mut cur_beat = state.beat;
            let mut cur_mult = state.multiplier;
            while state.ts_idx < boundaries.len() {
                let boundary = &boundaries[state.ts_idx];
                let boundary_beat = boundary.cumulative_beats;
                if boundary_beat > to_beat { break; }
                let seg = boundary_beat - cur_beat;
                if seg > 0.0 {
                    state.time += seg * seconds_per_beat(state.bpm, cur_mult);
                }
                cur_beat = boundary_beat;
                cur_mult = boundary.multiplier;
                state.ts_idx += 1;
            }
            let remaining = to_beat - cur_beat;
            if remaining > 0.0 {
                state.time += remaining * seconds_per_beat(state.bpm, cur_mult);
            }
            state.multiplier = cur_mult;
        }
        state.beat = to_beat;

        match event.kind {
            EventKind::Bpm => {
                if let Some(ref src) = event.bpm_source {
                    match *src {
                        BpmSource::Direct(bpm) => state.bpm = bpm,
                        BpmSource::Indexed(idx) => {
                            if let Some(&bpm) = bpm_table.get(&idx) { state.bpm = bpm; }
                        }
                    }
                }
            }
            EventKind::Stop => {
                let bpm_abs = state.bpm.abs().max(0.001);
                let stop_sec = event.duration as f64 * (60.0 / bpm_abs) * (4.0 / 192.0);
                state.time += stop_sec;
            }
            EventKind::Note => {
                output_notes.push((state.time, event.lane));
            }
        }
    }

    output_notes.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

    for &(t, _) in &output_notes {
        if t.is_nan() || t.is_infinite() {
            return Err(PanchiraError::Parse("Chart produced NaN or infinite timestamps".to_string()));
        }
    }

    Ok((output_notes, metadata))
}
