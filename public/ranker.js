window.PermRanker = {
    LANE_PAIRS: [],
    PAIR_KEYS: [],
    PRESETS: {
        P2: { reward: ['2,4', '5,6'], penalty: ['1,2', '6,7'] },
        P1: { reward: ['2,3', '4,6'], penalty: ['1,2', '6,7'] }
    },

    initConstants() {
        for (let a = 1; a <= 7; a++)
            for (let b = a + 1; b <= 7; b++)
                this.LANE_PAIRS.push([a, b]);
        this.PAIR_KEYS = this.LANE_PAIRS.map(([a, b]) => `${a},${b}`);
    },

    setPairs(mode) {
        if (mode === 'CUSTOM') {
            this.PAIR_KEYS.forEach(k => this.pairStates[k] = 'off');
            return;
        }
        const p = this.PRESETS[mode] || this.PRESETS.P2;
        this.pairStates = {};
        this.PAIR_KEYS.forEach(k => {
            if (p.reward.includes(k)) this.pairStates[k] = 'reward';
            else if (p.penalty.includes(k)) this.pairStates[k] = 'penalty';
            else this.pairStates[k] = 'off';
        });
    },

    setAnchors(mode) {
        for (let i = 1; i <= 7; i++) this.anchorStates[i] = 'off';
    },

    setPreset(m) {
        this.preset = m;
        this.dom.p1.classList.toggle('active', m === 'P1');
        this.dom.p2.classList.toggle('active', m === 'P2');
        this.dom.cBtn.classList.toggle('active', m === 'CUSTOM');
    },

    detectPreset() {
        const get = mode => {
            const s = {};
            this.PAIR_KEYS.forEach(k => {
                if (this.PRESETS[mode].reward.includes(k)) s[k] = 'reward';
                else if (this.PRESETS[mode].penalty.includes(k)) s[k] = 'penalty';
                else s[k] = 'off';
            });
            return s;
        };
        const p2 = get('P2'), p1 = get('P1');
        if (JSON.stringify(this.pairStates) === JSON.stringify(p2)) this.setPreset('P2');
        else if (JSON.stringify(this.pairStates) === JSON.stringify(p1)) this.setPreset('P1');
        else this.setPreset('CUSTOM');
    },

    renderPairs(best = this.bestPerm) {
        let html = '';
        for (let a = 1; a <= 6; a++) {
            html += `<div class="pair-row"><span class="label">${a}-</span><div class="buttons">`;
            for (let b = a + 1; b <= 7; b++) {
                const key = `${a},${b}`;
                const state = this.pairStates[key] || 'off';
                const cls = state === 'reward' ? 'reward' : state === 'penalty' ? 'penalty' : 'off';
                const label = state === 'reward' ? 'R' : state === 'penalty' ? 'P' : '•';
                const count = best ? (best[`trill_${a}${b}`] ?? '') : '';
                html += `<div class="trill-btn ${cls}" data-pair="${key}">${a}-${b}<span style="font-size:0.6rem;">${label}</span>${count !== '' ? `<span class="count">${count}</span>` : ''}</div>`;
            }
            html += `</div></div>`;
        }
        this.dom.pairC.innerHTML = html;
        this.dom.pairC.querySelectorAll('.trill-btn').forEach(b => {
            b.addEventListener('click', e => {
                const key = e.currentTarget.dataset.pair;
                const cur = this.pairStates[key] || 'off';
                const next = cur === 'off' ? 'reward' : cur === 'reward' ? 'penalty' : 'off';
                this.pairStates[key] = next;
                this.renderPairs();
                this.detectPreset();
                this.updateRank();
                this.save();
            });
        });
    },

    renderAnchors() {
        let html = '';
        for (let i = 1; i <= 7; i++) {
            const state = this.anchorStates[i] || 'off';
            const cls = state === 'reward' ? 'reward' : state === 'penalty' ? 'penalty' : 'off';
            const label = state === 'reward' ? 'R' : state === 'penalty' ? 'P' : '•';
            html += `<div class="trill-btn ${cls}" data-lane="${i}">${i}<span style="font-size:0.6rem;">${label}</span></div>`;
        }
        this.dom.anchorC.innerHTML = html;
        this.dom.anchorC.querySelectorAll('.trill-btn').forEach(b => {
            b.addEventListener('click', e => {
                const lane = parseInt(e.currentTarget.dataset.lane);
                const cur = this.anchorStates[lane] || 'off';
                const next = cur === 'off' ? 'reward' : cur === 'reward' ? 'penalty' : 'off';
                this.anchorStates[lane] = next;
                this.renderAnchors();
                this.updateRank();
                this.save();
            });
        });
    },

    updateBypass(name) {
        const w = this.dom.wraps[name];
        const s = this.dom.sliders[name];
        const t = this.dom.texts[name];
        const val = parseFloat(t.value);
        if (isNaN(val)) {
            w.classList.remove('bypassed');
            s.disabled = false;
            s.value = this.lastExponents[name];
            return;
        }
        if (val >= 0 && val <= 2) {
            w.classList.remove('bypassed');
            s.disabled = false;
            s.value = val;
            this.lastExponents[name] = val;
        } else {
            w.classList.add('bypassed');
            s.disabled = true;
            s.value = val < 0 ? 0 : 2;
        }
    },

    syncSlider(slider, text, name) {
        slider.addEventListener('input', () => {
            const val = parseFloat(slider.value);
            if (!isNaN(val) && val >= 0 && val <= 2) {
                text.value = val.toFixed(2);
                this.lastExponents[name] = val;
                this.dom.wraps[name].classList.remove('bypassed');
                slider.disabled = false;
                this.updateRank();
                this.save();
            }
        });
        text.addEventListener('input', () => {
            const val = parseFloat(text.value);
            if (!isNaN(val)) {
                if (val >= 0 && val <= 2) {
                    slider.value = val;
                    this.dom.wraps[name].classList.remove('bypassed');
                    slider.disabled = false;
                    this.lastExponents[name] = val;
                } else {
                    this.dom.wraps[name].classList.add('bypassed');
                    slider.disabled = true;
                    slider.value = val < 0 ? 0 : 2;
                }
                this.updateRank();
                this.save();
            } else {
                this.dom.wraps[name].classList.remove('bypassed');
                slider.disabled = false;
                slider.value = this.lastExponents[name];
            }
        });
    },

    getExponents() {
        return {
            smooth: parseFloat(this.dom.sText.value) || 0,
            tight: parseFloat(this.dom.tText.value) || 0,
            base: parseFloat(this.dom.bText.value) || 0,
            spike: parseFloat(this.dom.spText.value) || 0,
            anchor: parseFloat(this.dom.aText.value) || 0,
            trill: parseFloat(this.dom.trText.value) || 0
        };
    },

    renderFromAnalysis(analysisJson) {
        if (!analysisJson || !Array.isArray(analysisJson)) {
            console.error('Invalid analysis JSON');
            return;
        }

        const lanePairs = [];
        for (let a = 1; a <= 7; a++) {
            for (let b = a + 1; b <= 7; b++) {
                lanePairs.push([a, b]);
            }
        }

        this.allPerms = analysisJson.map(row => {
            const expanded = {
                perm: row.perm,
                smooth: row.smooth,
                tight: row.tight,
                base: row.base,
                spike: row.spike
            };
            for (let i = 0; i < 7; i++) {
                expanded['a' + (i + 1)] = row.anchors ? row.anchors[i] : 0;
            }
            for (let i = 0; i < lanePairs.length; i++) {
                const pair = lanePairs[i];
                expanded['trill_' + pair[0] + pair[1]] = row.trills ? row.trills[i] : 0;
            }
            return expanded;
        });
        this.updateRank();
    },

    updateRank() {
        clearTimeout(this.updateTimeout);
        this.updateTimeout = setTimeout(() => this._updateRank(), 20);
    },

    _updateRank() {
        if (!this.allPerms.length) {
            this.dom.result.innerHTML = '<p class="loading">No chart loaded.</p>';
            return;
        }
        const exp = this.getExponents();
        const trillRatio = parseFloat(this.dom.trillRatio.value) || 1;
        const anchorRatio = parseFloat(this.dom.anchorRatio.value) || 1;
        const top = parseInt(this.dom.topN.value);

        const scored = this.allPerms.map(p => {
            let trillR = 0, trillP = 0;
            for (const [a, b] of this.LANE_PAIRS) {
                const key = `${a},${b}`;
                const state = this.pairStates[key] || 'off';
                const count = parseFloat(p[`trill_${a}${b}`]) || 0;
                if (state === 'reward') trillR += count;
                else if (state === 'penalty') trillP += count;
            }
            const trillNet = trillP - trillRatio * trillR;

            let anchorR = 0, anchorP = 0;
            for (let i = 1; i <= 7; i++) {
                const state = this.anchorStates[i] || 'off';
                const load = parseFloat(p[`a${i}`]) || 0;
                if (state === 'reward') anchorR += load;
                else if (state === 'penalty') anchorP += load;
            }
            const anchorNet = anchorP - anchorRatio * anchorR;

            return {
                ...p,
                _trillNet: trillNet,
                _anchorNet: anchorNet,
                _smooth: p.smooth || 0,
                _tight: p.tight || 0,
                _base: p.base || 0,
                _spike: p.spike || 0
            };
        });

        const trillNets = scored.map(p => p._trillNet);
        const trillMean = trillNets.reduce((s, v) => s + v, 0) / trillNets.length;
        const trillVar = trillNets.reduce((s, v) => s + (v - trillMean) ** 2, 0) / trillNets.length;
        const trillStd = Math.sqrt(trillVar) || 1;

        const anchorNets = scored.map(p => p._anchorNet);
        const anchorMean = anchorNets.reduce((s, v) => s + v, 0) / anchorNets.length;
        const anchorVar = anchorNets.reduce((s, v) => s + (v - anchorMean) ** 2, 0) / anchorNets.length;
        const anchorStd = Math.sqrt(anchorVar) || 1;

        scored.forEach(p => {
            p._normTrillNet = p._trillNet / trillStd;
            p._normAnchorNet = p._anchorNet / anchorStd;
        });

        const metrics = [
            { key: '_smooth', out: 'smooth_pct' },
            { key: '_tight', out: 'tight_pct' },
            { key: '_base', out: 'base_pct' },
            { key: '_spike', out: 'spike_pct' },
            { key: '_normAnchorNet', out: 'anchor_pct' },
            { key: '_normTrillNet', out: 'trill_pct' }
        ];

        metrics.forEach(({ key, out }) => {
            const values = scored.map(p => p[key]);
            const min = Math.min(...values);
            const max = Math.max(...values);
            if (max === min) {
                scored.forEach(p => { p[out] = 100; });
            } else {
                scored.forEach(p => {
                    p[out] = 100 * (max - p[key]) / (max - min);
                    if (p[out] < 0.001) p[out] = 0.001;
                });
            }
        });

        const sumExp = exp.smooth + exp.tight + exp.base + exp.spike + exp.anchor + exp.trill;
        scored.forEach(p => {
            if (sumExp === 0) {
                p.total_score = 100;
            } else {
                const product = Math.pow(p.smooth_pct / 100, exp.smooth) *
                Math.pow(p.tight_pct / 100, exp.tight) *
                Math.pow(p.base_pct / 100, exp.base) *
                Math.pow(p.spike_pct / 100, exp.spike) *
                Math.pow(p.anchor_pct / 100, exp.anchor) *
                Math.pow(p.trill_pct / 100, exp.trill);
                p.total_score = Math.pow(product, 1 / sumExp) * 100;
            }
        });

        const colMap = {
            total_score: 'total_score',
            smooth: 'smooth_pct',
            tight: 'tight_pct',
            base: 'base_pct',
            spike: 'spike_pct',
            anchor: 'anchor_pct',
            trill: 'trill_pct'
        };
        const key = colMap[this.sortCol] || 'total_score';
        const descPerm = this.preset === 'P1' ? 1 : -1;

        scored.sort((a, b) => {
            let cmp = (b[key] || 0) - (a[key] || 0);
            if (this.sortAsc) cmp = -cmp;
            if (cmp !== 0) return cmp;
            return descPerm * a.perm.localeCompare(b.perm);
        });

        this.bestPerm = scored[0] || null;
        this.renderPairs();
        this.renderAnchors();

        const display = scored.map((p, i) => {
            const prev = this.prevRankMap[p.perm];
            const delta = prev !== undefined && prev !== i ? prev - i : 0;
            return { ...p, perm_display: p.perm, rank: i + 1, delta };
        });
        display.forEach(p => this.prevRankMap[p.perm] = p.rank - 1);

        let shown;
        if (this.searchPerm) {
            const found = display.find(p => p.perm === this.searchPerm);
            if (found) {
                const idx = display.indexOf(found);
                const start = Math.max(0, idx - 4);
                const end = Math.min(display.length, idx + 5);
                shown = display.slice(start, end);
            } else {
                shown = display.slice(0, top > 0 ? top : display.length);
                this.showToast(`Perm "${this.searchPerm}" not found.`);
                this.searchPerm = null;
                this.dom.clearBtn.style.display = 'none';
            }
        } else if (this.permFilter) {
            shown = display.filter(p => this.permToBW(p.perm) === this.permFilter);
        } else {
            shown = top > 0 ? display.slice(0, top) : display;
        }

        const best = display[0];
        if (best) {
            this.dom.bestInfo.innerHTML = `#1: <span style="color:#FF79C6">${best.perm_display}</span> &nbsp;|&nbsp; Score: ${best.total_score.toFixed(1)}% &nbsp;|&nbsp; Smooth: ${best.smooth_pct.toFixed(1)}% &nbsp;|&nbsp; Tight: ${best.tight_pct.toFixed(1)}% &nbsp;|&nbsp; Base: ${best.base_pct.toFixed(1)}% &nbsp;|&nbsp; Spike: ${best.spike_pct.toFixed(1)}% &nbsp;|&nbsp; Anchor: ${best.anchor_pct.toFixed(1)}% &nbsp;|&nbsp; Trill: ${best.trill_pct.toFixed(1)}%`;
            this.dom.stats.style.display = 'block';
        } else {
            this.dom.stats.style.display = 'none';
        }

        if (!shown.length) {
            this.dom.result.innerHTML = '<p class="loading">No results.</p>';
            return;
        }

        this.buildTable(shown, display.length);
    },

    buildTable(shown, total) {
        let html = `<div class="table-wrap"><table><thead><tr>
                <th data-col="rank">Rank</th><th data-col="perm_display">Perm</th><th data-col="total_score">Score</th>
                <th data-col="smooth">Smooth</th><th data-col="tight">Tight</th><th data-col="base">Base</th><th data-col="spike">Spike</th>
                <th data-col="anchor">Anchor</th><th data-col="trill">Trill</th><th data-col="delta">Delta</th></tr></thead><tbody>`;

        for (const p of shown) {
            const rank = p.rank;
            const cls = rank === 1 ? 'class="rank-1"' : '';
            const deltaHtml = p.delta === 0 ? '<span class="rank-move same">=</span>' :
            p.delta > 0 ? `<span class="rank-move up">▲+${p.delta}</span>` : `<span class="rank-move down">▼${p.delta}</span>`;

            const colorForPct = v => {
                const t = Math.max(0, Math.min(1, v / 100));
                if (t >= 0.75) {
                    const s = (t - 0.75) / 0.25;
                    const r = Math.round(80 * s + 255 * (1 - s));
                    const g = Math.round(250 * s + 215 * (1 - s));
                    const b = Math.round(123 * s + 0 * (1 - s));
                    return `rgb(${r},${g},${b})`;
                } else if (t >= 0.5) {
                    const s = (t - 0.5) / 0.25;
                    const r = 255;
                    const g = Math.round(215 * s + 140 * (1 - s));
                    const b = Math.round(0 * s + 0 * (1 - s));
                    return `rgb(${r},${g},${b})`;
                } else if (t >= 0.25) {
                    const s = (t - 0.25) / 0.25;
                    const r = Math.round(255 * s + 255 * (1 - s));
                    const g = Math.round(140 * s + 51 * (1 - s));
                    const b = Math.round(0 * s + 51 * (1 - s));
                    return `rgb(${r},${g},${b})`;
                } else {
                    const s = t / 0.25;
                    const r = Math.round(255 * s + 255 * (1 - s));
                    const g = Math.round(51 * s + 121 * (1 - s));
                    const b = Math.round(51 * s + 198 * (1 - s));
                    return `rgb(${r},${g},${b})`;
                }
            };

            html += `<tr ${cls}>
            <td>${rank}</td><td><span class="perm-cell">${this.colorPermHtml(p.perm_display)}</span></td>
            <td style="color:${colorForPct(p.total_score)}">${p.total_score.toFixed(1)}%</td>
            <td style="color:${colorForPct(p.smooth_pct)}">${p.smooth_pct.toFixed(1)}%</td>
            <td style="color:${colorForPct(p.tight_pct)}">${p.tight_pct.toFixed(1)}%</td>
            <td style="color:${colorForPct(p.base_pct)}">${p.base_pct.toFixed(1)}%</td>
            <td style="color:${colorForPct(p.spike_pct)}">${p.spike_pct.toFixed(1)}%</td>
            <td style="color:${colorForPct(p.anchor_pct)}">${p.anchor_pct.toFixed(1)}%</td>
            <td style="color:${colorForPct(p.trill_pct)}">${p.trill_pct.toFixed(1)}%</td>
            <td>${deltaHtml}</td></tr>`;
        }
        html += `</tbody></table></div>`;
        if (!this.searchPerm && this.permFilter && shown.length < total)
            html += `<p style="color:#6272A4;font-size:0.75rem;margin-top:0.5rem;">Showing ${shown.length} of ${total} perms matching pattern ${this.permFilter}.</p>`;
        else if (!this.searchPerm && shown.length < total)
            html += `<p style="color:#6272A4;font-size:0.75rem;margin-top:0.5rem;">Showing top ${shown.length} of ${total} perms.</p>`;
        else if (this.searchPerm)
            html += `<p style="color:#6272A4;font-size:0.75rem;margin-top:0.5rem;">Showing perm ${this.searchPerm} with context.</p>`;

        const oldWrap = this.dom.result.querySelector('.table-wrap');
        const oldRects = new Map();
        if (oldWrap) {
            oldWrap.style.opacity = '0';
            oldWrap.querySelectorAll('tbody tr').forEach(row => {
                const cell = row.querySelector('.perm-cell');
                if (cell) oldRects.set(cell.textContent, row.getBoundingClientRect());
            });
        }

        this.dom.result.innerHTML = html;
        const newWrap = this.dom.result.querySelector('.table-wrap');
        if (newWrap) {
            newWrap.style.opacity = '0';
            requestAnimationFrame(() => { newWrap.style.opacity = '1'; });
        }

        if (newWrap && oldRects.size) {
            const newRows = newWrap.querySelectorAll('tbody tr');
            for (const row of newRows) {
                const cell = row.querySelector('.perm-cell');
                if (!cell) continue;
                const oldRect = oldRects.get(cell.textContent);
                if (!oldRect) continue;
                const newRect = row.getBoundingClientRect();
                const dx = oldRect.left - newRect.left;
                const dy = oldRect.top - newRect.top;
                if (dx !== 0 || dy !== 0) {
                    row.style.transform = `translate(${dx}px, ${dy}px)`;
                    row.style.transition = 'none';
                    requestAnimationFrame(() => {
                        row.style.transition = 'transform 0.2s ease-out';
                        row.style.transform = 'translate(0, 0)';
                    });
                }
            }
        }

        this.dom.result.querySelectorAll('.perm-cell').forEach(cell => {
            cell.addEventListener('mouseenter', e => {
                const mirror = cell.textContent.split('').reverse().join('');
                const tip = this.dom.permTooltip;
                tip.textContent = `Mirror: ${mirror}`;
                tip.style.display = 'block';
                tip.style.left = (e.clientX + 12) + 'px';
                tip.style.top = (e.clientY + 12) + 'px';
            });
            cell.addEventListener('mousemove', e => {
                this.dom.permTooltip.style.left = (e.clientX + 12) + 'px';
                this.dom.permTooltip.style.top = (e.clientY + 12) + 'px';
            });
            cell.addEventListener('mouseleave', () => {
                this.dom.permTooltip.style.display = 'none';
            });
            cell.addEventListener('dblclick', () => {
                const perm = cell.textContent;
                navigator.clipboard.writeText(perm).then(() => {
                    this.showToast(`✔ Copied! <span style="font-family:'JetBrains Mono',monospace;">${this.colorPermHtml(perm)}</span>`, 3000);
                }).catch(() => {});
            });
        });

        this.dom.result.querySelectorAll('th[data-col]').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.col;
                if (['rank', 'perm_display', 'delta'].includes(col)) return;
                if (this.sortCol === col) this.sortAsc = !this.sortAsc;
                else { this.sortCol = col; this.sortAsc = false; }
                this.searchPerm = null;
                this.dom.clearBtn.style.display = 'none';
                this.dom.permSearch.value = '';
                this.updateRank();
                this.save();
            });
        });
    },

    applyPreset(mode) {
        this.setPairs(mode);
        this.setAnchors(mode);
        this.setPreset(mode);
        this.renderPairs();
        this.renderAnchors();
        this.updateRank();
        this.save();
    },

    searchPermAction() {
        const q = this.dom.permSearch.value.trim();
        if (!q) return;
        if (!/^\d{7}$/.test(q)) {
            this.showToast('Enter a 7‑digit permutation (e.g. 3162457)');
            return;
        }
        this.searchPerm = q;
        this.dom.clearBtn.style.display = 'inline-block';
        this.updateRank();
        this.save();
    },

    clearPermSearch() {
        this.searchPerm = null;
        this.dom.clearBtn.style.display = 'none';
        this.dom.permSearch.value = '';
        this.updateRank();
        this.save();
    },

    updateTrillRatioTrack() {
        const slider = this.dom.trillRatio;
        const pct = ((parseFloat(slider.value) - parseFloat(slider.min)) / (parseFloat(slider.max) - parseFloat(slider.min))) * 100;
        slider.style.background = `linear-gradient(to right, #50FA7B ${pct}%, #FF5555 ${pct}%)`;
    },

    updateAnchorRatioTrack() {
        const slider = this.dom.anchorRatio;
        const pct = ((parseFloat(slider.value) - parseFloat(slider.min)) / (parseFloat(slider.max) - parseFloat(slider.min))) * 100;
        slider.style.background = `linear-gradient(to right, #50FA7B ${pct}%, #FF5555 ${pct}%)`;
    },
};
