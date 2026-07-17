// Tauri Adapter - Overrides online registry functions with local Tauri commands
// This file should be loaded AFTER script.js

(function() {
    'use strict';

    function patchApp() {
        if (!window.app) {
            setTimeout(patchApp, 100);
            return;
        }

        var app = window.app;

        // -------- loadRegistry --------
        app.loadRegistry = async function() {
            try {
                var result = await window.tauriAPI.getRecentAnalyses(50);
                if (result && result.entries) {
                    this.registry = {};
                    result.entries.forEach(function(entry) {
                        this.registry[entry.md5] = {
                            md5: entry.md5,
                            title: entry.title,
                            subtitle: entry.subtitle,
                            artist: entry.artist,
                            levels: entry.difficulty ? [entry.difficulty] : [],
                            _analyzedAt: entry.analyzed_at,
                            _favorite: entry.favorite,
                            path: entry.path
                        };
                    }.bind(this));
                    this.registryList = Object.values(this.registry);
                    this.searchResultsData = this.registryList;
                }
            } catch (error) {
                console.error('Failed to load history:', error);
                this.registry = {};
                this.registryList = [];
                this.searchResultsData = [];
            }
        };

        // -------- loadChart --------
        app.loadChart = async function(md5) {
            if (this.loading) return;
            this.loading = true;
            this.dom.result.innerHTML = '<p class="loading">Loading chart data\u2026</p>';
            this.currentMd5 = md5;

            try {
                var result = await window.tauriAPI.loadChart(md5);
                if (result) {
                    this.currentAnalysis = result.json;
                    this.allPerms = result.json;
                    this.title = result.title;
                    this.prevRankMap = {};
                    this.searchPerm = null;
                    this.dom.clearBtn.style.display = 'none';
                    this.dom.permSearch.value = '';
                    this.dom.result.innerHTML = '';
                    this.updateChartHeader(result.md5);
                    this.updateRank();
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

        // -------- selectChart --------
        app.selectChart = function(md5, entry) {
            // Ensure the entry is in the registry so updateChartHeader can find it.
            // This matters for song database entries that haven't been analyzed yet.
            if (entry && !this.registry[md5]) {
                this.registry[md5] = {
                    md5: entry.md5,
                    title: entry.title,
                    subtitle: entry.subtitle || '',
                    artist: entry.artist || '',
                    levels: entry.difficulty ? [entry.difficulty] : [],
                    _analyzedAt: entry._analyzedAt,
                    _favorite: false,
                    path: entry.path
                };
            }
            this.updateChartHeader(md5);
            this.hideSearchResults();
            this.dom.chartSearch.value = '';
            this.dom.chartSearch.blur();

            if (entry && entry.path && (!entry._analyzedAt || entry._analyzedAt === 0)) {
                this.loadFromSongDb(entry);
            } else {
                this.loadChart(md5);
            }
        };

        // -------- loadFromSongDb --------
        // Analyzes a chart from an external song database, saves it to history,
        // then loads it. The registry is refreshed before loading so the chart
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

        // -------- filterAndShow --------
        // Always uses the unified backend search so song databases are included.
        app.filterAndShow = async function() {
            var q = this.dom.chartSearch.value.trim();
            if (!q) {
                this.hideSearchResults();
                return;
            }
            await this.searchUnified(q);
        };

        // -------- searchUnified: single search across history + song databases --------
        app.searchUnified = async function(query) {
            try {
                var result = await window.tauriAPI.search(query);
                if (result && result.entries) {
                    this.searchResultsData = result.entries.map(function(entry) {
                        return {
                            md5: entry.md5,
                            title: entry.title,
                            subtitle: entry.subtitle,
                            artist: entry.artist,
                            levels: entry.difficulty ? [entry.difficulty] : [],
                            _analyzedAt: entry.analyzed_at,
                            _favorite: entry.favorite,
                            path: entry.path
                        };
                    });
                    this.renderSearchResults(this.searchResultsData);
                }
            } catch (error) {
                console.error('Search failed:', error);
                this.showToast('Search failed: ' + error.message, 5000);
                this.searchResultsData = [];
                this.renderSearchResults([]);
            }
        };

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
                scrollTop: this.dom.result.querySelector('.table-wrap')?.scrollTop || 0
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

        // -------- renderSearchResults --------
        // Overrides script.js to fix click handling for song database entries.
        // The original looks up this.registry[md5], which misses entries from
        // external databases that haven't been analyzed yet.
        app.renderSearchResults = function(results) {
            var shown = (results || []).slice(0, 96);
            this.searchResultsData = shown;
            this.selectedIndex = -1;

            if (shown.length === 0) {
                this.dom.searchResults.innerHTML = '<div class="search-empty">No matches</div>';
            } else {
                var html = '';
                shown.forEach(function(entry, idx) {
                    var subtitleOrLevels = '';
                    if (entry.subtitle) {
                        subtitleOrLevels = entry.subtitle;
                    } else if (entry.levels && entry.levels.length) {
                        subtitleOrLevels = '(' + entry.levels.join(', ') + ')';
                    }
                    html += '<div class="search-card" data-index="' + idx + '" data-md5="' + entry.md5 + '">';
                    html += '<div class="search-card-title">' + entry.title + '</div>';
                    html += '<div class="search-card-levels">' + subtitleOrLevels + '</div>';
                    html += '<div class="search-card-artist">' + (entry.artist || '') + '</div>';
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

        // -------- renderFromAnalysis --------
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

        // -------- handleDrop --------
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
                        _analyzedAt: results[0].analyzed_at,
                        _favorite: false
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

        // -------- Load Chart button --------
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

        // -------- Load DB button --------
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
