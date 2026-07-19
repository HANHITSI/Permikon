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
    searchResultsData: [],
    selectedIndex: -1,
    updateTimeout: null,
    dom: {},
    searchOnlyTables: true,
    searchPool: [],

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
        if (window.tauriAPI) {
            window.tauriAPI.saveSettings(state).catch(e => {
                console.error('Tauri saveSettings failed:', e);
            });
        }
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

    async init() {
        Object.assign(this, window.PermSearch, window.PermRanker, window.PermUI);

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
        dom.chartTitle = document.getElementById('chartTitle');
        dom.permCounter = document.getElementById('permCounter');
        dom.permTooltip = document.getElementById('permTooltip');
        dom.sText = dom.texts.smooth;
        dom.tText = dom.texts.tight;
        dom.bText = dom.texts.base;
        dom.spText = dom.texts.spike;
        dom.aText = dom.texts.anchor;
        dom.trText = dom.texts.trill;

        dom.configureTablesBtn = document.getElementById('configureTablesBtn');
        dom.configureTablesBtn.addEventListener('click', () => this.openTablesModal());

        document.getElementById('tablesModalClose').addEventListener('click', () => this.closeTablesModal());
        document.getElementById('tablesModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) this.closeTablesModal(); });
        document.getElementById('tblAddBtn').addEventListener('click', () => this.addTableConfig());
        document.getElementById('rebuildRegistryBtn').addEventListener('click', () => this.rebuildRegistry());
        document.getElementById('pasteGoBtn').addEventListener('click', () => this.pasteAndGo());

        document.getElementById('loadChartBtn').addEventListener('click', async () => {
            try {
                const path = await window.tauriAPI.openFileDialog();
                if (path) {
                    const fileName = path.split('/').pop() || path.split('\\').pop() || path;
                    await this.handleDrop([{name: fileName, path, size: 0, type: ''}]);
                }
            } catch (error) {
                console.error('File dialog error:', error);
            }
        });

        document.getElementById('loadDbBtn').addEventListener('click', async () => {
            try {
                const path = await window.tauriAPI.openSongDbDialog();
                if (path) {
                    const fileName = path.split('/').pop() || path.split('\\').pop() || path;
                    this.showToast('Loading database: ' + fileName + '...', 3000);
                    const config = await window.tauriAPI.loadSongDatabase(path);
                    if (config) {
                        this.showToast(
                            'Loaded ' + fileName + ' (' + config.entry_count + ' entries, ' + config.mappings.length + ' tables)',
                            5000
                        );
                        await this.loadRegistry();
                    }
                }
            } catch (error) {
                console.error('Load DB error:', error);
                this.showToast('Failed to load database: ' + error.message, 5000);
            }
        });

        dom.searchOnlyTables.addEventListener('change', () => {
            this.searchOnlyTables = dom.searchOnlyTables.checked;
            this.filterAndShow(this.dom.chartSearch.value);
            this.updateRank();
            this.save();
        });

        try {
            await this.loadRegistry();
        } catch (e) {
            console.error('[init] failed to load registry:', e);
        }
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
            if (entry.path && entry.analyzed !== true) {
                await this.loadFromSongDb(entry);
            } else {
                await this.loadChart(saved.md5);
            }
            setTimeout(() => {
                const wrap = dom.result.querySelector('.table-wrap');
                if (wrap && saved.scrollTop) wrap.scrollTop = saved.scrollTop;
            }, 150);
        } else if (this.registryList.length) {
            const first = this.registryList[0];
            this.selectChart(first.md5, first);
        } else {
            dom.chartTitle.textContent = 'No charts in registry.';
        }

        const panchiraEl = document.querySelector('.panchira-text');
        if (panchiraEl) {
            panchiraEl.removeAttribute('title');
            panchiraEl.addEventListener('mouseenter', e => {
                dom.permTooltip.innerHTML = 'density\u2011wave aware rust implementation of<br>github.com/HANHITSI/pantsu';
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

        const pasteBtn = document.getElementById('pasteGoBtn');
        if (pasteBtn) {
            pasteBtn.removeAttribute('title');
            pasteBtn.addEventListener('mouseenter', e => {
                dom.permTooltip.textContent = 'Paste MD5 from clipboard';
                dom.permTooltip.style.display = 'block';
                dom.permTooltip.style.left = (e.clientX + 12) + 'px';
                dom.permTooltip.style.top  = (e.clientY + 12) + 'px';
            });
            pasteBtn.addEventListener('mousemove', e => {
                dom.permTooltip.style.left = (e.clientX + 12) + 'px';
                dom.permTooltip.style.top  = (e.clientY + 12) + 'px';
            });
            pasteBtn.addEventListener('mouseleave', () => {
                dom.permTooltip.style.display = 'none';
            });
        }

        // Sync Tauri settings to localStorage.
        setTimeout(() => {
            if (window.tauriAPI) {
                window.tauriAPI.getSettings().then(tauriSettings => {
                    if (tauriSettings && typeof tauriSettings === 'object' && Object.keys(tauriSettings).length > 0) {
                        localStorage.setItem('permidex_settings', JSON.stringify(tauriSettings));
                    }
                }).catch(e => {
                    console.error('Failed to sync settings:', e);
                });
            }
        }, 2000);
    }
};

window.app = app;
window.addEventListener('DOMContentLoaded', () => app.init());
