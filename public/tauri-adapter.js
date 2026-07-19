(function() {
    'use strict';

    function patchApp() {
        if (!window.app) {
            setTimeout(patchApp, 100);
            return;
        }

        var app = window.app;

        app.loadRegistry = async function() {
            try {
                var pool = await window.tauriAPI.getSearchPool();
                if (pool) {
                    this.searchPool = pool;
                    this.registry = {};
                    for (var i = 0; i < pool.length; i++) {
                        this.registry[pool[i].md5] = pool[i];
                    }
                    this.registryList = Object.values(this.registry);
                    this.searchResultsData = this.registryList;
                    this.animateCounter(this.registryList.filter(function(e) { return e.analyzed; }).length);
                }
            } catch (error) {
                console.error('Failed to load search pool:', error);
                this.searchPool = [];
                this.registry = {};
                this.registryList = [];
                this.searchResultsData = [];
            }
        };

        app.loadChart = async function(md5) {
            if (this.loading) return;
            this.loading = true;
            this.dom.result.innerHTML = '<p class="loading">Loading chart data\u2026</p>';
            this.currentMd5 = md5;

            try {
                var result = await window.tauriAPI.loadChart(md5);
                if (result) {
                    this.currentAnalysis = result.json;
                    this.renderFromAnalysis(result.json);
                    this.title = result.title;
                    this.prevRankMap = {};
                    this.searchPerm = null;
                    this.dom.clearBtn.style.display = 'none';
                    this.dom.permSearch.value = '';
                    this.dom.result.innerHTML = '';
                    this.updateChartHeader(result.md5);
                    this.save();
                    this.showToast('Loaded: ' + this.title);
                }
            } catch (error) {
                console.error('Failed to load chart:', error);
                this.dom.result.innerHTML = '<div style="color:#FF5555;padding:1rem;">Error: ' + error.message + '</div>';
                this.showToast('Failed to load chart: ' + error.message, 5000);
            } finally {
                this.loading = false;
            }
        };

        app.selectChart = function(md5, entry) {
            this.updateChartHeader(md5);
            this.hideSearchResults();
            this.dom.chartSearch.value = '';
            this.dom.chartSearch.blur();

            if (entry && entry.path && !entry.analyzed) {
                this.loadFromSongDb(entry);
            } else {
                this.loadChart(md5);
            }
        };

        // Analyzes a chart from an external song database, saves it to history,
        // then loads it. Registry is refreshed before loading so the chart
        // header shows metadata immediately.
        app.loadFromSongDb = async function(entry) {
            this.showToast('Analyzing: ' + entry.title, 3000);
            try {
                var result = await window.tauriAPI.analyzeChart(entry.path);
                if (result) {
                    await window.tauriAPI.saveAnalysis(result);
                    await this.loadRegistry();
                    await this.loadChart(result.md5);
                }
            } catch (error) {
                console.error('Failed to analyze from song DB:', error);
                this.showToast('Analysis failed: ' + error.message, 5000);
            }
        };

        app.filterAndShow = function(query) {
            var q = (query || '').trim();
            var pool = this.searchPool || [];

            if (this.searchOnlyTables) {
                pool = pool.filter(function(e) { return e.levels && e.levels.length > 0; });
            }

            if (!q) {
                this.renderSearchResults(pool);
                return;
            }

            var tokens = q.toLowerCase().split(/\s+/);
            var results = pool.filter(function(entry) {
                var title = (entry.title || '').toLowerCase();
                var subtitle = (entry.subtitle || '').toLowerCase();
                var artist = (entry.artist || '').toLowerCase();
                return tokens.every(function(token) {
                    return title.includes(token) || subtitle.includes(token) || artist.includes(token);
                });
            });
            this.renderSearchResults(results);
        };

        // searchUnified is no longer needed; filtering is client-side.

        // save() persists to both localStorage (instant) and Tauri (persistent).
        app.save = function() {
            var state = {
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
                searchOnlyTables: this.searchOnlyTables
            };
            localStorage.setItem('permidex_settings', JSON.stringify(state));
            if (window.tauriAPI) {
                window.tauriAPI.saveSettings(state).catch(function(e) {
                    console.error('Tauri saveSettings failed:', e);
                });
            }
        };

        // loadSettings() is synchronous: reads from localStorage for instant startup.
        app.loadSettings = function() {
            try {
                return JSON.parse(localStorage.getItem('permidex_settings'));
            } catch (e) { return null; }
        };

        // Sync Tauri settings to localStorage in the background (after init)
        setTimeout(function() {
            if (window.tauriAPI) {
                window.tauriAPI.getSettings().then(function(tauriSettings) {
                    if (tauriSettings && typeof tauriSettings === 'object' && Object.keys(tauriSettings).length > 0) {
                        localStorage.setItem('permidex_settings', JSON.stringify(tauriSettings));
                    }
                }).catch(function(e) {
                    console.error('Failed to sync settings:', e);
                });
            }
        }, 2000);

        // Overrides script.js: spec-compliant card layout.
        // Top: title + subtitle, Middle: levels, Bottom: artist, Bottom-right: ✓
        app.renderSearchResults = function(results) {
            var shown = (results || []).slice(0, 96);
            this.searchResultsData = shown;
            this.selectedIndex = -1;

            if (shown.length === 0) {
                this.dom.searchResults.innerHTML = '<div class="search-empty">No matches</div>';
            } else {
                var html = '';
                shown.forEach(function(entry, idx) {
                    // Top: title + subtitle (space-separated)
                    var titleLine = entry.title || '';
                    if (entry.subtitle) titleLine += ' ' + entry.subtitle;

                    // Middle: difficulty levels from registry.json (comma-separated)
                    var levelStr = (entry.levels && entry.levels.length) ? entry.levels.join(', ') : '';

                    // Bottom: artist
                    var artist = entry.artist || '';

                    // Bottom-right: ✓ only if chart exists in history.db
                    var checkmark = entry.analyzed ? '<span class="search-card-check">✓</span>' : '';

                    html += '<div class="search-card" data-index="' + idx + '">';
                    html += '<div class="search-card-title">' + titleLine + '</div>';
                    html += '<div class="search-card-levels">' + levelStr + '</div>';
                    html += '<div class="search-card-artist">' + artist + '</div>';
                    html += checkmark;
                    html += '</div>';
                });
                this.dom.searchResults.innerHTML = html;
            }

            this.dom.searchResults.classList.remove('hidden-state');
            if (shown.length <= 24) {
                this.dom.searchResults.style.maxHeight = 'none';
                var naturalHeight = this.dom.searchResults.scrollHeight;
                this.dom.searchResults.style.maxHeight = naturalHeight + 'px';
            } else {
                this.dom.searchResults.style.maxHeight = '18.6rem';
            }

            if (shown.length > 0) {
                var self = this;
                this.dom.searchResults.querySelectorAll('.search-card').forEach(function(card) {
                    card.addEventListener('click', function() {
                        var idx = parseInt(card.dataset.index);
                        var entry = self.searchResultsData[idx];
                        if (entry) self.selectChart(entry.md5, entry);
                    });
                    card.addEventListener('mouseenter', function() {
                        self.highlightCard(parseInt(card.dataset.index));
                    });
                });
            }
        };

        // Expands backend array format (anchors: [...], trills: [...])
        // to named properties (a1..a7, trill_12..trill_67) that _updateRank reads.
        app.renderFromAnalysis = function(analysisJson) {
            if (!analysisJson || !Array.isArray(analysisJson)) {
                console.error('Invalid analysis JSON');
                return;
            }

            var lanePairs = [];
            for (var a = 1; a <= 7; a++) {
                for (var b = a + 1; b <= 7; b++) {
                    lanePairs.push([a, b]);
                }
            }

            this.allPerms = analysisJson.map(function(row) {
                var expanded = {
                    perm: row.perm,
                    smooth: row.smooth,
                    tight: row.tight,
                    base: row.base,
                    spike: row.spike
                };
                for (var i = 0; i < 7; i++) {
                    expanded['a' + (i + 1)] = row.anchors ? row.anchors[i] : 0;
                }
                for (var i = 0; i < lanePairs.length; i++) {
                    var pair = lanePairs[i];
                    expanded['trill_' + pair[0] + pair[1]] = row.trills ? row.trills[i] : 0;
                }
                return expanded;
            });
            this.updateRank();
        };

        app.handleDrop = async function(files) {
            var chartFiles = Array.from(files).filter(function(f) {
                return ['.bms', '.bme', '.bmson', '.bml'].some(function(ext) {
                    return f.name.toLowerCase().endsWith(ext);
                });
            });

            if (chartFiles.length === 0) {
                this.showToast('No valid BMS/BME/BMSON files dropped', 4000);
                return;
            }

            this.hideSearchResults();
            this.dom.chartSearch.blur();
            this.showToast('Analyzing ' + chartFiles.length + ' chart(s)...', 3000);

            try {
                var paths = chartFiles.map(function(f) { return f.path; });
                var results = await window.tauriAPI.dragDropAnalyze(paths);

                if (results && results.length > 0) {
                    this.currentAnalysis = results[0].json;
                    this.currentMd5 = results[0].md5;
                    this.title = results[0].title;

                    this.registry[results[0].md5] = {
                        md5: results[0].md5,
                        title: results[0].title,
                        subtitle: results[0].subtitle,
                        artist: results[0].artist,
                        levels: results[0].difficulty ? [results[0].difficulty] : [],
                        analyzed: true,
                        path: results[0].path
                    };

                    this.updateChartHeader(results[0].md5);
                    this.renderFromAnalysis(results[0].json);

                    for (var i = 0; i < results.length; i++) {
                        await window.tauriAPI.saveAnalysis(results[i]);
                    }

                    this.showToast('Analyzed ' + results.length + ' chart(s)', 3000);
                    this.hideSearchResults();
                    this.dom.chartSearch.blur();
                    await this.loadRegistry();
                } else {
                    this.showToast('No charts could be analyzed', 4000);
                }
            } catch (error) {
                console.error('Drop analysis error:', error);
                this.showToast('Analysis failed: ' + error.message, 5000);
            }
        };

        var loadChartBtn = document.getElementById('loadChartBtn');
        if (loadChartBtn) {
            loadChartBtn.addEventListener('click', async function() {
                try {
                    var path = await window.tauriAPI.openFileDialog();
                    if (path) {
                        var fileName = path.split('/').pop() || path.split('\\').pop() || path;
                        await app.handleDrop([{name: fileName, path: path, size: 0, type: ''}]);
                    }
                } catch (error) {
                    console.error('File dialog error:', error);
                }
            });
        }

        var loadDbBtn = document.getElementById('loadDbBtn');
        if (loadDbBtn) {
            loadDbBtn.addEventListener('click', async function() {
                try {
                    var path = await window.tauriAPI.openSongDbDialog();
                    if (path) {
                        var fileName = path.split('/').pop() || path.split('\\').pop() || path;
                        app.showToast('Loading database: ' + fileName + '...', 3000);
                        var config = await window.tauriAPI.loadSongDatabase(path);
                        if (config) {
                            app.showToast(
                                'Loaded ' + fileName + ' (' + config.entry_count + ' entries, ' + config.mappings.length + ' tables)',
                                5000
                            );
                            await app.loadRegistry();
                        }
                    }
                } catch (error) {
                    console.error('Load DB error:', error);
                    app.showToast('Failed to load database: ' + error.message, 5000);
                }
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', patchApp);
    } else {
        patchApp();
    }
})();
