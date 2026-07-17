use itertools::Itertools;

#[derive(Clone, Copy)]
struct MaskInfo {
    count: u8,
    lane_sum: u8,
    min_lane: u8,
    max_lane: u8,
}

const MASK_TABLE: [MaskInfo; 128] = {
    let mut table = [MaskInfo { count: 0, lane_sum: 0, min_lane: 0, max_lane: 0 }; 128];
    let mut m = 0usize;
    while m < 128 {
        let mut count = 0u8;
        let mut lane_sum = 0u8;
        let mut min_lane = 7u8;
        let mut max_lane = 0u8;
        let mut x = m as u8;
        let mut bit = 1u8;
        while x != 0 {
            if x & 1 != 0 {
                count += 1;
                lane_sum += bit;
                if bit < min_lane { min_lane = bit; }
                if bit > max_lane { max_lane = bit; }
            }
            x >>= 1;
            bit += 1;
        }
        if count == 0 {
            min_lane = 0;
            max_lane = 0;
        }
        table[m] = MaskInfo { count, lane_sum, min_lane, max_lane };
        m += 1;
    }
    table
};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PermRow {
    pub perm: String,
    pub smooth: f64,
    pub tight: f64,
    pub base: f64,
    pub spike: f64,
    pub anchors: [f64; 7],
    pub trills: [u32; 21],
}

fn compute_weights(times: &[f64]) -> Vec<f64> {
    if times.is_empty() {
        return vec![];
    }
    if times.len() == 1 {
        return vec![0.0];
    }
    let mut gaps: Vec<f64> = times.windows(2).map(|w| w[1] - w[0]).collect();
    gaps.push(0.0);
    let min_gap = gaps.iter().cloned().filter(|&g| g > 0.0).fold(f64::INFINITY, f64::min);
    if min_gap.is_infinite() {
        return gaps.iter().map(|_| 0.0).collect();
    }
    gaps.iter()
    .map(|&g| if g == 0.0 { 0.0 } else { (min_gap / g).min(1.0) })
    .collect()
}

fn build_mask_map(perm: &[u8; 7]) -> [u8; 128] {
    let mut key_to_lane = [0u8; 8];
    for (key, &lane) in perm.iter().enumerate() {
        key_to_lane[lane as usize] = (key + 1) as u8;
    }
    let mut map = [0u8; 128];
    for (orig, mapped) in map.iter_mut().enumerate() {
        let mut new_mask = 0u8;
        let mut bits = orig as u8;
        while bits != 0 {
            let lsb = bits & (!bits + 1);
            let lane = (lsb.trailing_zeros() + 1) as u8;
            let new_key = key_to_lane[lane as usize];
            if new_key != 0 {
                new_mask |= 1 << (new_key - 1);
            }
            bits &= bits - 1;
        }
        *mapped = new_mask;
    }
    map
}

fn count_weighted_alternations(masks: &[u8], weights: &[f64], lane_a: u8, lane_b: u8) -> u32 {
    let bit_a = 1u8 << (lane_a - 1);
    let bit_b = 1u8 << (lane_b - 1);
    let mut total = 0.0f64;
    let mut prev_state = 0u8;
    let mut streak = 0u8;
    for (idx, &mask) in masks.iter().enumerate() {
        let has_a = (mask & bit_a) != 0;
        let has_b = (mask & bit_b) != 0;
        let state = if has_a && has_b { 3 } else if has_a { 1 } else if has_b { 2 } else { 0 };
        if state == 0 || state == 3 {
            prev_state = 0;
            streak = 0;
            continue;
        }
        if prev_state == 0 {
            prev_state = state;
            streak = 1;
        } else if prev_state == state {
            streak = 1;
        } else {
            streak += 1;
            prev_state = state;
            if streak >= 3 {
                total += weights[idx];
            }
        }
    }
    total.round() as u32
}

fn evaluate_permutation(
    events: &[(f64, u8, f64)],
                        mask_map: &[u8; 128],
                        weights: &[f64],
) -> (f64, f64, f64, f64, [f64; 7], [u32; 21]) {
    let n = events.len();
    if n == 0 {
        return (0.0, 0.0, 0.0, 0.0, [0.0; 7], [0; 21]);
    }

    let mut visual_masks = Vec::with_capacity(n);
    let mut avg_lanes = Vec::with_capacity(n);
    let mut spans = Vec::with_capacity(n);
    let mut anchor_sums = [0.0f64; 7];
    let mut total_weight = 0.0f64;

    for (_time, orig_mask, w) in events.iter() {
        let mapped = mask_map[*orig_mask as usize];
        visual_masks.push(mapped);
        let info = &MASK_TABLE[mapped as usize];
        let avg = if info.count > 0 { info.lane_sum as f64 / info.count as f64 } else { 0.0 };
        avg_lanes.push(avg);
        let span = if info.count > 1 { (info.max_lane - info.min_lane) as f64 } else { 0.0 };
        spans.push(span);

        let mut bits = mapped;
        while bits != 0 {
            let lsb = bits & (!bits + 1);
            let lane = (lsb.trailing_zeros() + 1) as usize;
            anchor_sums[lane - 1] += w;
            bits &= bits - 1;
        }
        total_weight += w;
    }
    let anchors = anchor_sums;

    let (mut w_sum, mut wx, mut wy, mut wxx, mut wxy) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for (i, (&avg, &w)) in avg_lanes.iter().zip(weights.iter()).enumerate() {
        let x = i as f64;
        w_sum += w; wx += w * x; wy += w * avg; wxx += w * x * x; wxy += w * x * avg;
    }
    let smooth = if w_sum > 0.0 {
        let denom = wxx - (wx * wx) / w_sum;
        if denom > 0.0 {
            let slope = (wxy - (wx * wy) / w_sum) / denom;
            let intercept = (wy - slope * wx) / w_sum;
            let residual_var: f64 = avg_lanes.iter().zip(weights.iter())
            .enumerate()
            .map(|(i, (&avg, &w))| {
                let pred = slope * i as f64 + intercept;
                w * (avg - pred).powi(2)
            })
            .sum::<f64>() / w_sum;
            residual_var.sqrt()
        } else { 0.0 }
    } else { 0.0 };

    let tight = if total_weight > 0.0 {
        let weighted_span: f64 = spans.iter().zip(weights.iter()).map(|(&s, &w)| s * w).sum();
        weighted_span / total_weight
    } else { 0.0 };

    let mut variabilities = Vec::with_capacity(n);
    if n > 0 {
        variabilities.push(spans[0]);
        for i in 1..n {
            let delta_avg = (avg_lanes[i] - avg_lanes[i - 1]).abs();
            variabilities.push(delta_avg + spans[i]);
        }
    }
    let base = if total_weight > 0.0 {
        let weighted_sum: f64 = variabilities.iter().zip(weights.iter()).map(|(&v, &w)| v * w).sum();
        weighted_sum / total_weight
    } else { 0.0 };

    let spike = if total_weight > 0.0 && n > 0 {
        let mut indexed: Vec<(f64, f64)> = variabilities.iter().zip(weights.iter())
        .map(|(&v, &w)| (v, w)).collect();
        indexed.sort_unstable_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        let cum_weights: Vec<f64> = indexed.iter()
        .scan(0.0, |acc, &(_, w)| { *acc += w; Some(*acc) }).collect();
        let total_w = cum_weights.last().copied().unwrap_or(1.0);
        let target = 0.9 * total_w;
        let pos = cum_weights.iter().position(|&c| c >= target).unwrap_or(n - 1);
        if pos == 0 { indexed[0].0 }
        else {
            let prev_cum = cum_weights[pos - 1];
            let next_cum = cum_weights[pos];
            let prev_val = indexed[pos - 1].0;
            let next_val = indexed[pos].0;
            let frac = (target - prev_cum) / (next_cum - prev_cum);
            prev_val + frac * (next_val - prev_val)
        }
    } else { 0.0 };

    let mut trills = [0u32; 21];
    let mut idx = 0;
    for a in 1..=7u8 {
        for b in (a + 1)..=7u8 {
            trills[idx] = count_weighted_alternations(&visual_masks, weights, a, b);
            idx += 1;
        }
    }

    (smooth, tight, base, spike, anchors, trills)
}

pub fn evaluate_all(notes: &[(f64, u8)]) -> Vec<PermRow> {
    let mut time_mask: Vec<(f64, u8)> = Vec::new();
    if !notes.is_empty() {
        let mut sorted = notes.to_vec();
        sorted.sort_unstable_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        let mut iter = sorted.into_iter().peekable();
        while let Some((t, _)) = iter.peek() {
            let current_t = *t;
            let mut mask = 0u8;
            while let Some((time, lane)) = iter.peek() {
                if (*time - current_t).abs() < 1e-9 {
                    mask |= 1u8 << (lane - 1);
                    iter.next();
                } else { break; }
            }
            time_mask.push((current_t, mask));
        }
    }

    let timestamps: Vec<f64> = time_mask.iter().map(|(t, _)| *t).collect();
    let weights = compute_weights(&timestamps);
    let events: Vec<(f64, u8, f64)> = time_mask.iter()
    .zip(weights.iter())
    .map(|((t, m), &w)| (*t, *m, w))
    .collect();

    let all_perms: Vec<[u8; 7]> = (1..=7u8).permutations(7)
    .map(|v| {
        let mut arr = [0u8; 7];
        for (i, &val) in v.iter().enumerate() { arr[i] = val; }
        arr
    })
    .collect();
    let mask_maps: Vec<[u8; 128]> = all_perms.iter().map(|perm| build_mask_map(perm)).collect();

    let mut rows = Vec::with_capacity(5040);
    for idx in 0..5040 {
        let perm = &all_perms[idx];
        let map = &mask_maps[idx];
        let (smooth, tight, base, spike, anchors, trills) =
        evaluate_permutation(&events, map, &weights);
        let perm_str: String = perm.iter().map(|d| d.to_string()).collect();
        rows.push(PermRow {
            perm: perm_str,
            smooth,
            tight,
            base,
            spike,
            anchors,
            trills,
        });
    }

    let (mut min_s, mut max_s) = (f64::MAX, f64::MIN);
    let (mut min_t, mut max_t) = (f64::MAX, f64::MIN);
    let (mut min_b, mut max_b) = (f64::MAX, f64::MIN);
    let (mut min_p, mut max_p) = (f64::MAX, f64::MIN);
    for row in &rows {
        min_s = min_s.min(row.smooth); max_s = max_s.max(row.smooth);
        min_t = min_t.min(row.tight);  max_t = max_t.max(row.tight);
        min_b = min_b.min(row.base);   max_b = max_b.max(row.base);
        min_p = min_p.min(row.spike);  max_p = max_p.max(row.spike);
    }
    let range_s = max_s - min_s;
    let range_t = max_t - min_t;
    let range_b = max_b - min_b;
    let range_p = max_p - min_p;

    for row in &mut rows {
        if range_s > 0.0 { row.smooth = (row.smooth - min_s) / range_s; }
        else { row.smooth = 0.0; }
        if range_t > 0.0 { row.tight = (row.tight - min_t) / range_t; }
        else { row.tight = 0.0; }
        if range_b > 0.0 { row.base = (row.base - min_b) / range_b; }
        else { row.base = 0.0; }
        if range_p > 0.0 { row.spike = (row.spike - min_p) / range_p; }
        else { row.spike = 0.0; }
    }

    rows
}
