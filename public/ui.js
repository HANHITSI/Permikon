window.PermUI = {
    showToast(msg, duration = 3000) {
        const t = document.createElement('div');
        t.className = 'toast';
        t.innerHTML = msg;
        this.dom.toastContainer.appendChild(t);
        setTimeout(() => {
            t.classList.add('exiting');
            t.addEventListener('transitionend', () => t.remove(), { once: true });
            setTimeout(() => t.remove(), 400);
        }, duration);
    },

    animateCounter(totalCharts) {
        const counter = this.dom.permCounter;
        counter.classList.remove('final');
        const total = totalCharts * 5040;
        const duration = 1500;
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

    colorPermHtml(perm) {
        return perm.split('').map(digit => {
            const cls = "246".includes(digit) ? "perm-digit-blue" : "perm-digit-white";
            return `<span class="${cls}">${digit}</span>`;
        }).join('');
    },

    permToBW(perm) {
        return perm.split('').map(d => "246".includes(d) ? 'B' : 'W').join('');
    },

    updateChartHeader(md5) {
        const entry = this.registry[md5];
        if (!entry) {
            this.dom.chartTitle.textContent = 'Awaiting your first query…';
            return;
        }
        const artist = entry.artist ? ' – ' + entry.artist : '';
        const levels = entry.levels || [];
        const subtitle = entry.subtitle || '';
        const levelStr = levels.length ? ' [' + levels.join(', ') + ']' : '';
        this.dom.chartTitle.textContent = (entry.title + ' ' + subtitle + levelStr + artist).trim();
    },

    async openTablesModal() {
        try {
            this._tablesConfigs = await window.tauriAPI.getCustomTables();
        } catch (e) {
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
            this._tablesConfigs[idx] = { name, prefix, url, enabled: c.enabled, strip_prefix };
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
        } catch (e) {
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
            await this.loadRegistry();
            if (this.currentMd5) this.updateChartHeader(this.currentMd5);
            this.filterAndShow(this.dom.chartSearch.value);
            this.showToast('Registry rebuilt: ' + loaded.join(', '));
            this.closeTablesModal();
        } catch (e) {
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
        } catch (e) {
            this.showToast('Failed to read clipboard');
        }
    },

    async handleDrop(files) {
        const chartFiles = Array.from(files).filter(f =>
            ['.bms', '.bme', '.bmson', '.bml'].some(ext =>
                f.name.toLowerCase().endsWith(ext)
            )
        );

        if (chartFiles.length === 0) {
            this.showToast('No valid BMS/BME/BMSON files dropped', 4000);
            return;
        }

        this.hideSearchResults();
        this.dom.chartSearch.blur();
        this.showToast('Analyzing ' + chartFiles.length + ' chart(s)...', 3000);

        try {
            const paths = chartFiles.map(f => f.path);
            const results = await window.tauriAPI.dragDropAnalyze(paths);

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

                for (let i = 0; i < results.length; i++) {
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
    },

    async loadChart(md5) {
        if (this.loading) return;
        this.loading = true;
        this.dom.result.innerHTML = '<p class="loading">Loading chart data\u2026</p>';
        this.currentMd5 = md5;

        try {
            const result = await window.tauriAPI.loadChart(md5);
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
            this.loading = false;
            const entry = this.registry[md5] || (this.searchPool || []).find(e => e.md5 === md5);
            if (entry && entry.path) {
                await this.loadFromSongDb(entry);
                return;
            }
            console.error('Failed to load chart:', error);
            this.dom.result.innerHTML = `<div style="color:#FF5555;padding:1rem;">Error: ${error.message}</div>`;
            this.showToast('Failed to load chart: ' + error.message, 5000);
            return;
        }
        this.loading = false;
    },
};
