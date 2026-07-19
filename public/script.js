const app = {
    registry: {},
    registryList: [],
    cache: {},
    allPerms: [],
    pairStates: {},
    anchorStates: {},
    prevRankMap: {},
    bestPerm: null,
    currentMd5: '',
    title: '',
    loading: false,
    sortCol: 'total_score',
    sortAsc: false,
    searchPerm: null,
    permFilter: null,
    preset: 'P2',
    lastExponents: { smooth: 1, tight: 1, base: 1, spike: 1, anchor: 1, trill: 1 },
    inflightPrefetch: new Set(),
    searchResultsData: [],
    selectedIndex: -1,
    prefetchTimer: null,
    updateTimeout: null,
    dom: {},
    tableEntries: [],      // full array from backend
    tableMap: {},            // md5 → [{title, artist, levels}]
    searchOnlyTables: true,
    searchPool: [],          // merged search pool (one entry per MD5)

    buildTableMap() {
        this.tableMap = {};
        for (const e of this.tableEntries) {
            this.tableMap[e.md5] = e;
        }
    },

    getSearchPool() {
        if (this.searchOnlyTables) {
            return this.tableEntries || [];
        }
        const seen = new Set();
        const pool = [];
        for (const t of this.tableEntries) {
            seen.add(t.md5);
            pool.push(t);
        }
        for (const e of this.registryList) {
            if (!seen.has(e.md5)) {
                seen.add(e.md5);
                pool.push(e);
            }
        }
        return pool;
    },

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

    showToast(msg, duration = 3000) {
        const t = document.createElement('div');
        t.className = 'toast';
        t.innerHTML = msg;
        this.dom.toastContainer.appendChild(t);
        setTimeout(() => {
            t.classList.add('exiting');
            setTimeout(() => t.remove(), 250);
        }, duration);
    },

    // ─── Difficulty Tables Modal ─────────────────────────────────
    async openTablesModal() {
        try {
            this._tablesConfigs = await window.tauriAPI.getCustomTables();
        } catch(e) {
            this._tablesConfigs = [];
        }
        this.renderTablesModal();
        document.getElementById('tablesModal').style.display = 'flex';
    },

    closeTablesModal() {
        document.getElementById('tablesModal').style.display = 'none';
    },

    renderTablesModal() {
        const list = document.getElementById('tablesList');
        const configs = this._tablesConfigs || [];
        if (!configs.length) {
            list.innerHTML = '<div style="color:#6272A4;text-align:center;padding:1rem;">No tables configured.</div>';
            return;
        }
        let html = '';
        configs.forEach((c, i) => {
            const cls = c.enabled ? '' : ' disabled';
            html += '<div class="table-row' + cls + '" data-idx="' + i + '" id="tableRow' + i + '">';
            html += '<input type="checkbox" class="tbl-toggle" data-idx="' + i + '"' + (c.enabled ? ' checked' : '') + '>';
            html += '<span class="tbl-prefix">' + (c.prefix || '—') + '</span>';
            html += '<span class="tbl-url" title="' + (c.name || c.url) + '">' + (c.name || c.url) + '</span>';
            html += '<button class="tbl-edit" data-idx="' + i + '">Edit</button>';
            html += '<button class="tbl-delete" data-idx="' + i + '">Delete</button>';
            html += '</div>';
        });
        list.innerHTML = html;

        list.querySelectorAll('.tbl-toggle').forEach(btn => {
            btn.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.idx);
                this._tablesConfigs[idx].enabled = e.target.checked;
                this.saveTableConfigs();
                this.renderTablesModal();
            });
        });
        list.querySelectorAll('.tbl-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.idx);
                this.editTableConfig(idx);
            });
        });
        list.querySelectorAll('.tbl-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.idx);
                this._tablesConfigs.splice(idx, 1);
                this.saveTableConfigs();
                this.renderTablesModal();
            });
        });
    },

    editTableConfig(idx) {
        const c = this._tablesConfigs[idx];
        const row = document.getElementById('tableRow' + idx);
        if (!row) return;
        row.classList.add('editing');
        row.innerHTML =
            '<div class="table-edit-form">' +
            '<input type="text" class="edit-name" placeholder="Name" value="' + (c.name || '').replace(/"/g, '&quot;') + '">' +
            '<input type="text" class="edit-prefix" placeholder="Prefix" value="' + (c.prefix || '').replace(/"/g, '&quot;') + '">' +
            '<input type="text" class="edit-url" placeholder="URL" value="' + (c.url || '').replace(/"/g, '&quot;') + '">' +
            '<input type="text" class="edit-strip" placeholder="Strip Prefix" value="' + (c.strip_prefix || '').replace(/"/g, '&quot;') + '">' +
            '<div class="tbl-edit-actions">' +
            '<button class="tbl-save">Save</button>' +
            '<button class="tbl-cancel">Cancel</button>' +
            '</div>' +
            '</div>';

        row.querySelector('.edit-url').focus();
        row.querySelector('.edit-url').select();

        const save = () => {
            const name = row.querySelector('.edit-name').value.trim();
            const prefix = row.querySelector('.edit-prefix').value.trim();
            const url = row.querySelector('.edit-url').value.trim();
            const strip_prefix = row.querySelector('.edit-strip').value.trim();
            if (!url) { this.showToast('URL is required'); return; }
            if (!prefix) { this.showToast('Prefix is required'); return; }
            this._tablesConfigs[idx] = { name: name, prefix: prefix, url: url, enabled: c.enabled, strip_prefix: strip_prefix };
            this.saveTableConfigs();
            this.renderTablesModal();
        };

        row.querySelector('.tbl-save').addEventListener('click', save);
        row.querySelector('.tbl-cancel').addEventListener('click', () => this.renderTablesModal());
        row.querySelector('.edit-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
        row.querySelector('.edit-prefix').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    },

    async saveTableConfigs() {
        try {
            await window.tauriAPI.saveCustomTables(this._tablesConfigs);
        } catch(e) {
            this.showToast('Failed to save: ' + e.message, 5000);
        }
    },

    async rebuildRegistry() {
        const btn = document.getElementById('rebuildRegistryBtn');
        btn.disabled = true;
        btn.textContent = 'Downloading...';
        let unlisten = null;
        try {
            if (window.__TAURI__ && window.__TAURI__.event) {
                unlisten = await window.__TAURI__.event.listen('registry-progress', (e) => {
                    this.showToast(e.payload, 4000);
                });
            }
            const loaded = await window.tauriAPI.rebuildRegistry();
            this.tableEntries = await window.tauriAPI.getTableEntries();
            this.buildTableMap();
            await this.loadRegistry();
            if (this.currentMd5) this.updateChartHeader(this.currentMd5);
            this.filterAndShow(this.dom.chartSearch.value);
            this.showToast('Registry rebuilt: ' + loaded.join(', '));
            this.closeTablesModal();
        } catch(e) {
            this.showToast('Rebuild failed: ' + e.message, 5000);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Rebuild Registry';
            if (unlisten) unlisten();
        }
    },

    async addTableConfig() {
        const name = (document.getElementById('tblName').value || '').trim();
        const prefix = (document.getElementById('tblPrefix').value || '').trim();
        const url = (document.getElementById('tblUrl').value || '').trim();
        const strip_prefix = (document.getElementById('tblStrip').value || '').trim();
        if (!url) { this.showToast('URL is required'); return; }
        if (!prefix) { this.showToast('Prefix is required'); return; }
        this._tablesConfigs.push({ name, prefix, url, enabled: true, strip_prefix });
        await this.saveTableConfigs();
        this.renderTablesModal();
        document.getElementById('tblName').value = '';
        document.getElementById('tblPrefix').value = '';
        document.getElementById('tblUrl').value = '';
        document.getElementById('tblStrip').value = '';
    },

    // ─── Paste & Go ──────────────────────────────────────────────
    async pasteAndGo() {
        try {
            const text = await window.tauriAPI.readClipboard();
            const md5match = (text || '').trim().match(/^[a-fA-F0-9]{32}$/);
            if (!md5match) {
                this.showToast('Clipboard does not contain a valid MD5 hash');
                return;
            }
            const md5 = md5match[0].toLowerCase();
            const entry = this.registry[md5];
            if (entry) {
                this.selectChart(md5, entry);
            } else {
                this.showToast('No chart found for MD5: ' + md5);
            }
        } catch(e) {
            this.showToast('Failed to read clipboard');
        }
    },

    colorPermHtml(perm) {
        return perm.split('').map(digit => {
            const cls = "246".includes(digit) ? "perm-digit-blue" : "perm-digit-white";
            return `<span class="${cls}">${digit}</span>`;
        }).join('');
    },

    permToBW(perm) {
        return perm.split('').map(d => "246".includes(d) ? 'B' : 'W').join('');
    },

    setPairs(mode) {
        if (mode === 'CUSTOM') { this.PAIR_KEYS.forEach(k => this.pairStates[k] = 'off'); return; }
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

    async loadRegistry() {
        try {
            const resp = await fetch('/registry');
            if (!resp.ok) throw new Error('Registry fetch failed');
            const data = await resp.json();
            this.registry = {};
            data.forEach(e => this.registry[e.md5] = e);
            this.registryList = Object.values(this.registry);
        } catch (e) {
            this.registry = {};
            this.registryList = [];
        }
    },

    updateChartHeader(md5) {
        const entry = this.registry[md5];
        if (!entry) { this.dom.chartTitle.textContent = 'Awaiting your first query…'; return; }
        const artist = entry.artist ? ' – ' + entry.artist : '';
        const levels = entry.levels || [];
        const subtitle = entry.subtitle || '';
        const levelStr = levels.length ? ' [' + levels.join(', ') + ']' : '';
        this.dom.chartTitle.textContent = (entry.title + ' ' + subtitle + levelStr + artist).trim();
    },

    async loadChartData(md5) {
        if (this.cache[md5]) return this.cache[md5];
        const resp = await fetch(`/chart/${md5}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
        const json = await resp.json();
        this.cache[md5] = json;
        const keys = Object.keys(this.cache);
        if (keys.length > 5) delete this.cache[keys[0]];
        return json;
    },

    async loadChart(md5) {
        if (this.loading) return;
        this.loading = true;
        this.dom.result.innerHTML = '<p class="loading">Loading chart data…</p>';
        this.dom.stats.style.display = 'none';
        try {
            const data = await this.loadChartData(md5);
            if (!data?.length || !data[0].perm) throw new Error('Invalid chart data');
            this.allPerms = data;
            this.currentMd5 = md5;
            this.title = this.registry[md5]?.title || md5;
            this.prevRankMap = {};
            this.searchPerm = null;
            this.dom.clearBtn.style.display = 'none';
            this.dom.permSearch.value = '';
            this.dom.stats.style.display = 'block';
            this.dom.result.innerHTML = '';
            this.loading = false;
            this.updateRank();
            this.save();
            this.showToast(`Loaded: ${this.title}`);
            this.updateChartHeader(md5);
        } catch (e) {
            this.loading = false;
            const entry = this.registry[md5];
            const isRegistry404 = entry && e.message && e.message.includes('404');
            if (isRegistry404) {
                this.dom.result.innerHTML = `
                <div style="color:#FF79C6;padding:1rem;border-left:3px solid #FF79C6;">
                <strong>${entry.title}</strong>
                ${entry.levels ? `(${entry.levels.join(', ')})` : ''}
                <span style="color:#6272A4;">– ${entry.artist || 'Unknown artist'}</span>
                <br><br>
                <span style="color:#F8F8F2;">This chart is in the registry but the data isn't available yet.</span>
                <br>
                <span style="color:#6272A4;font-size:0.8rem;">
                It may have been added after the last dataset update.
                If you have the .bms file, you can help by sending it to @hanhitsi on Discord 💜
                </span>
                </div>`;
            } else {
                this.dom.result.innerHTML = `<div style="color:#FF5555;padding:1rem;">Error: ${e.message}</div>`;
                this.showToast(`Error: ${e.message}`, 5000);
            }
        }
    },

    prefetchChart(md5, immediate = false) {
        if (!md5 || this.cache[md5] || this.inflightPrefetch.has(md5)) return;
        this.inflightPrefetch.add(md5);
        const doFetch = () => {
            fetch(`/chart/${md5}`)
            .then(r => r.json())
            .then(data => {
                this.cache[md5] = data;
                this.inflightPrefetch.delete(md5);
            })
            .catch(() => this.inflightPrefetch.delete(md5));
        };
        if (immediate) { doFetch(); } else { setTimeout(doFetch, 200); }
    },

    highlightCard(idx, keyboard = false) {
        const cards = this.dom.searchResults.querySelectorAll('.search-card');
        cards.forEach((c, i) => c.classList.toggle('selected', i === idx));
        this.selectedIndex = idx;
        const entry = this.searchResultsData[idx];
        if (entry) this.prefetchChart(entry.md5, keyboard);
    },

    startStaggeredPrefetch(entries) {
        (async () => {
            for (const e of entries) {
                this.prefetchChart(e.md5, true);
                await new Promise(r => setTimeout(r, 200));
            }
        })();
    },

    renderSearchResults(results) {
        const shown = results?.slice(0, 96) || [];
        this.searchResultsData = shown;
        this.selectedIndex = -1;

        if (shown.length === 0) {
            this.dom.searchResults.innerHTML = '<div class="search-empty">No matches</div>';
            this.dom.searchResults.classList.remove('hidden-state');
            this.dom.searchResults.style.maxHeight = 'none';
            return;
        }

        let html = '';
        for (const entry of shown) {
            const levels = this.tableMap[entry.md5]?.levels || entry.levels || [];
            const levelStr = levels.length ? levels.join(', ') : '';

            html += `<div class="search-card" data-md5="${entry.md5}">
                <div class="search-card-title">${entry.title}</div>
                <div class="search-card-levels">${levelStr}</div>
                <div class="search-card-artist">${entry.artist || ''}</div>
            </div>`;
        }

        this.dom.searchResults.innerHTML = html;
        this.dom.searchResults.classList.remove('hidden-state');
        this.dom.searchResults.style.maxHeight = 'none';

        this.dom.searchResults.querySelectorAll('.search-card').forEach(card => {
            card.addEventListener('click', () => {
                const md5 = card.dataset.md5;
                const entry = this.registry[md5] || this.tableMap[md5];
                if (entry) this.selectChart(md5, entry);
            });
        });
    },

    hideSearchResults() {
        this.dom.searchResults.style.maxHeight = '0px';
        this.dom.searchResults.classList.add('hidden-state');
    },

    selectChart(md5, entry) {
        this.updateChartHeader(md5);
        this.hideSearchResults();
        this.dom.chartSearch.value = '';
        this.dom.chartSearch.focus();
        this.loadChart(md5);
    },

    filterAndShow(query) {
        const q = (query || '').trim();
        const pool = this.getSearchPool();
        if (!q) {
            this.renderSearchResults(pool.slice(0, 96));
            return;
        }
        const tokens = q.toLowerCase().split(/\s+/);
        const results = pool.filter(entry => {
            const title = (entry.title || '').toLowerCase();
            const artist = (entry.artist || '').toLowerCase();
            const levels = this.tableMap[entry.md5]?.levels || entry.levels || [];
            const levelStr = levels.join(' ').toLowerCase();
            return tokens.every(token =>
                title.includes(token) ||
                artist.includes(token) ||
                levelStr.includes(token)
            );
        }).slice(0, 96);
        this.renderSearchResults(results);
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
        } else this.dom.stats.style.display = 'none';

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

    save() {
        const state = {
            preset: this.preset,
            smooth: parseFloat(this.dom.sText.value) || 0,
            tight: parseFloat(this.dom.tText.value) || 0,
            base: parseFloat(this.dom.bText.value) || 0,
            spike: parseFloat(this.dom.spText.value) || 0,
            anchor: parseFloat(this.dom.aText.value) || 0,
            trill: parseFloat(this.dom.trText.value) || 0,
            trillRatio: parseFloat(this.dom.trillRatio.value) || 1,
            anchorRatio: parseFloat(this.dom.anchorRatio.value) || 1,
            topN: this.dom.topN.value,
            pairStates: this.pairStates,
            anchorStates: this.anchorStates,
            sortColumn: this.sortCol,
            sortAscending: this.sortAsc,
            md5: this.currentMd5,
            scrollTop: this.dom.result.querySelector('.table-wrap')?.scrollTop || 0,
            permFilter: this.permFilter,
            searchOnlyTables: this.searchOnlyTables
        };
        localStorage.setItem('permidex_settings', JSON.stringify(state));
    },

    loadSettings() {
        try {
            return JSON.parse(localStorage.getItem('permidex_settings'));
        } catch { return null; }
    },

    applySettings(s) {
        if (!s) return;
        if (s.preset) { this.setPairs(s.preset); this.setAnchors(s.preset); this.setPreset(s.preset); }
        for (const n of ['smooth', 'tight', 'base', 'spike', 'anchor', 'trill']) {
            if (s[n] !== undefined) {
                this.dom.texts[n].value = s[n];
                this.dom.sliders[n].value = Math.min(2, Math.max(0, s[n]));
                this.lastExponents[n] = this.dom.sliders[n].value;
                this.updateBypass(n);
            }
        }
        if (s.trillRatio !== undefined) this.dom.trillRatio.value = s.trillRatio;
        if (s.anchorRatio !== undefined) this.dom.anchorRatio.value = s.anchorRatio;
        if (s.topN) this.dom.topN.value = s.topN;
        if (s.sortColumn) this.sortCol = s.sortColumn;
        if (s.sortAscending !== undefined) this.sortAsc = s.sortAscending;
        if (s.permFilter !== undefined) {
            this.permFilter = s.permFilter || null;
            this.dom.permPatternFilter.value = s.permFilter || '';
        }
        if (s.searchOnlyTables !== undefined) {
            this.searchOnlyTables = s.searchOnlyTables;
            this.dom.searchOnlyTables.checked = s.searchOnlyTables;
        }
        if (s.pairStates) { this.pairStates = s.pairStates; this.detectPreset(); }
        else { this.setPairs(this.preset); this.setPreset(this.preset); }
        if (s.anchorStates) { this.anchorStates = s.anchorStates; }
        else { this.setAnchors(this.preset); }
        this.renderPairs();
        this.renderAnchors();
        this.updateTrillRatioTrack();
        this.updateAnchorRatioTrack();
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

    animateCounter(totalCharts) {
        const counter = this.dom.permCounter;
        counter.classList.remove('final');
        const total = totalCharts * 5040;
        const duration = 1500;
        // Read current value to animate from it
        const match = counter.textContent.match(/([\d,]+)/);
        const fromTotal = match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
        const start = performance.now();
        const easeOutExpo = t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
        let lastTotal = -1;
        const frame = now => {
            const elapsed = Math.min(now - start, duration);
            const t = elapsed / duration;
            const current = Math.round(fromTotal + (total - fromTotal) * easeOutExpo(t));
            if (current !== lastTotal) {
                lastTotal = current;
                counter.textContent = `${current.toLocaleString()} permutations and counting...`;
            }
            if (elapsed < duration) requestAnimationFrame(frame);
            else {
                counter.textContent = `${total.toLocaleString()} permutations and counting...`;
                counter.classList.add('final');
            }
        };
        requestAnimationFrame(frame);
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

    async init() {
        this.initConstants();

        const dom = this.dom;
        dom.chartSearch = document.getElementById('chartSearch');
        dom.searchResults = document.getElementById('searchResults');
        dom.searchOnlyTables = document.getElementById('searchOnlyTables');
        dom.sliders = {
            smooth: document.getElementById('smoothWeight'),
            tight: document.getElementById('tightWeight'),
            base: document.getElementById('baseWeight'),
            spike: document.getElementById('spikeWeight'),
            anchor: document.getElementById('anchorWeight'),
            trill: document.getElementById('trillWeight')
        };
        dom.texts = {
            smooth: document.getElementById('smoothText'),
            tight: document.getElementById('tightText'),
            base: document.getElementById('baseText'),
            spike: document.getElementById('spikeText'),
            anchor: document.getElementById('anchorText'),
            trill: document.getElementById('trillText')
        };
        dom.wraps = {
            smooth: document.getElementById('smoothWrapper'),
            tight: document.getElementById('tightWrapper'),
            base: document.getElementById('baseWrapper'),
            spike: document.getElementById('spikeWrapper'),
            anchor: document.getElementById('anchorWrapper'),
            trill: document.getElementById('trillWrapper')
        };
        dom.trillRatio = document.getElementById('trillRatio');
        dom.anchorRatio = document.getElementById('anchorRatio');
        dom.p1 = document.getElementById('p1Btn');
        dom.p2 = document.getElementById('p2Btn');
        dom.cBtn = document.getElementById('customBtn');
        dom.topN = document.getElementById('topNSelector');
        dom.pairC = document.getElementById('pairContainer');
        dom.anchorC = document.getElementById('anchorContainer');
        dom.stats = document.getElementById('stats');
        dom.bestInfo = document.getElementById('bestInfo');
        dom.result = document.getElementById('resultArea');
        dom.toastContainer = document.getElementById('toastContainer');
        dom.permSearch = document.getElementById('permSearch');
        dom.searchBtn = document.getElementById('permSearchBtn');
        dom.clearBtn = document.getElementById('clearSearchBtn');
        dom.permPatternFilter = document.getElementById('permPatternFilter');
        dom.chartSearch = document.getElementById('chartSearch');
        dom.searchResults = document.getElementById('searchResults');
        dom.chartTitle = document.getElementById('chartTitle');
        dom.permCounter = document.getElementById('permCounter');
        dom.permTooltip = document.getElementById('permTooltip');
        dom.sText = dom.texts.smooth;
        dom.tText = dom.texts.tight;
        dom.bText = dom.texts.base;
        dom.spText = dom.texts.spike;
        dom.aText = dom.texts.anchor;
        dom.trText = dom.texts.trill;

        // Difficulty tables
        dom.configureTablesBtn = document.getElementById('configureTablesBtn');
        dom.searchOnlyTables = document.getElementById('searchOnlyTables');

        dom.configureTablesBtn.addEventListener('click', () => this.openTablesModal());

        // Modal listeners
        document.getElementById('tablesModalClose').addEventListener('click', () => this.closeTablesModal());
        document.getElementById('tablesModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) this.closeTablesModal(); });
        document.getElementById('tblAddBtn').addEventListener('click', () => this.addTableConfig());
        document.getElementById('rebuildRegistryBtn').addEventListener('click', () => this.rebuildRegistry());

        // Paste & Go
        document.getElementById('pasteGoBtn').addEventListener('click', () => this.pasteAndGo());

        dom.searchOnlyTables.addEventListener('change', () => {
            this.searchOnlyTables = dom.searchOnlyTables.checked;
            this.filterAndShow(this.dom.chartSearch.value);
            this.updateRank();
            this.save();
        });

        try {
            this.tableEntries = await window.tauriAPI.getTableEntries();
            this.buildTableMap();
        } catch (e) {
            console.error('[INIT] failed to load tableEntries:', e);
        }

        await this.loadRegistry();
        this.animateCounter(this.registryList.filter(e => e.analyzed).length);

        dom.chartSearch.addEventListener('focus', () => {
            this.filterAndShow(dom.chartSearch.value);
        });
            dom.chartSearch.addEventListener('input', () => {
                this.filterAndShow(dom.chartSearch.value);
            });
            dom.chartSearch.addEventListener('blur', () => {
                setTimeout(() => this.hideSearchResults(), 150);
            });
            dom.chartSearch.addEventListener('keydown', e => {
                const cards = dom.searchResults.querySelectorAll('.search-card');
                if (!cards.length) return;
                if (e.key.startsWith('Arrow')) {
                    e.preventDefault();
                    if (this.selectedIndex === -1) return this.highlightCard(0, true);
                    let newIdx = this.selectedIndex;
                    const cols = 4, total = this.searchResultsData.length;
                    switch (e.key) {
                        case 'ArrowDown': newIdx = Math.min(newIdx + cols, total - 1); break;
                        case 'ArrowUp': newIdx = Math.max(newIdx - cols, 0); break;
                        case 'ArrowRight': newIdx = Math.min(newIdx + 1, total - 1); break;
                        case 'ArrowLeft': newIdx = Math.max(newIdx - 1, 0); break;
                    }
                    if (newIdx !== this.selectedIndex) {
                        this.highlightCard(newIdx, true);
                        const card = cards[newIdx];
                        if (card) card.scrollIntoView({ block: 'nearest' });
                    }
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (this.selectedIndex >= 0 && this.selectedIndex < this.searchResultsData.length) {
                        const entry = this.searchResultsData[this.selectedIndex];
                        this.selectChart(entry.md5, entry);
                    }
                } else if (e.key === 'Escape') {
                    this.hideSearchResults();
                    dom.chartSearch.blur();
                }
            });

            document.addEventListener('keydown', e => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                if (e.key === 'Backspace') {
                    e.preventDefault();
                    dom.chartSearch.focus();
                    dom.chartSearch.select();
                    this.filterAndShow(dom.chartSearch.value);
                }
            });
            document.addEventListener('click', e => {
                if (!e.target.closest('.search-container')) this.hideSearchResults();
            });

                dom.p1.addEventListener('click', () => { if (this.preset !== 'P1') this.applyPreset('P1'); });
                dom.p2.addEventListener('click', () => { if (this.preset !== 'P2') this.applyPreset('P2'); });
                dom.cBtn.addEventListener('click', () => {
                    if (this.preset !== 'CUSTOM') this.applyPreset('CUSTOM');
                    document.getElementById('pairControls').open = true;
                });

                dom.topN.addEventListener('change', () => {
                    this.searchPerm = null;
                    dom.clearBtn.style.display = 'none';
                    dom.permSearch.value = '';
                    this.updateRank();
                    this.save();
                });

                ['smooth', 'tight', 'base', 'spike', 'anchor', 'trill'].forEach(n =>
                this.syncSlider(dom.sliders[n], dom.texts[n], n)
                );

                dom.trillRatio.addEventListener('input', () => {
                    this.updateTrillRatioTrack();
                    this.updateRank();
                    this.save();
                });
                dom.anchorRatio.addEventListener('input', () => {
                    this.updateAnchorRatioTrack();
                    this.updateRank();
                    this.save();
                });

                dom.permSearch.addEventListener('keydown', e => { if (e.key === 'Enter') this.searchPermAction(); });
                dom.searchBtn.addEventListener('click', () => this.searchPermAction());
                dom.clearBtn.addEventListener('click', () => this.clearPermSearch());

                dom.permPatternFilter.addEventListener('change', () => {
                    const val = dom.permPatternFilter.value;
                    this.permFilter = val || null;
                    this.searchPerm = null;
                    dom.clearBtn.style.display = 'none';
                    dom.permSearch.value = '';
                    this.updateRank();
                    this.save();
                });

                window.addEventListener('pagehide', () => {
                    if (this.currentMd5) {
                        const state = JSON.parse(localStorage.getItem('permidex_settings') || '{}');
                        state.scrollTop = dom.result.querySelector('.table-wrap')?.scrollTop || 0;
                        state.md5 = this.currentMd5;
                        localStorage.setItem('permidex_settings', JSON.stringify(state));
                    }
                });

                const saved = this.loadSettings();
                if (saved) {
                    this.applySettings(saved);
                } else {
                    this.setPairs('P2');
                    this.setAnchors('P2');
                    this.setPreset('P2');
                    this.renderPairs(null);
                    this.renderAnchors();
                    for (const n of ['smooth', 'tight', 'base', 'spike', 'anchor', 'trill']) {
                        dom.texts[n].value = 1;
                        dom.sliders[n].value = 1;
                        this.lastExponents[n] = 1;
                    }
                    dom.trillRatio.value = 0.25;
                    dom.anchorRatio.value = 0.25;
                    this.updateTrillRatioTrack();
                    this.updateAnchorRatioTrack();
                }

                if (saved?.md5 && this.registry[saved.md5]) {
                    const entry = this.registry[saved.md5];
                    this.updateChartHeader(saved.md5);
                    await this.loadChart(saved.md5);
                    setTimeout(() => {
                        const wrap = dom.result.querySelector('.table-wrap');
                        if (wrap && saved.scrollTop) wrap.scrollTop = saved.scrollTop;
                    }, 150);
                } else if (this.registryList.length) {
                    const first = this.registryList[0];
                    this.updateChartHeader(first.md5);
                    this.loadChart(first.md5);
                } else {
                    dom.chartTitle.textContent = 'No charts in registry.';
                }

                const panchiraEl = document.querySelector('.panchira-text');
                if (panchiraEl) {
                    panchiraEl.removeAttribute('title');
                    panchiraEl.addEventListener('mouseenter', e => {
                        dom.permTooltip.innerHTML = 'density‑wave aware rust implementation of<br>github.com/HANHITSI/pantsu';
                        dom.permTooltip.style.display = 'block';
                        dom.permTooltip.style.left = (e.clientX + 12) + 'px';
                        dom.permTooltip.style.top  = (e.clientY + 12) + 'px';
                    });
                    panchiraEl.addEventListener('mousemove', e => {
                        dom.permTooltip.style.left = (e.clientX + 12) + 'px';
                        dom.permTooltip.style.top  = (e.clientY + 12) + 'px';
                    });
                    panchiraEl.addEventListener('mouseleave', () => {
                        dom.permTooltip.style.display = 'none';
                    });
                }
    }
};

window.app = app;
window.addEventListener('DOMContentLoaded', () => app.init());
