window.PermSearch = {
    async loadRegistry() {
        try {
            const pool = await window.tauriAPI.getSearchPool();
            if (pool) {
                this.searchPool = pool;
                this.registry = {};
                for (let i = 0; i < pool.length; i++) {
                    this.registry[pool[i].md5] = pool[i];
                }
                this.registryList = Object.values(this.registry);
                this.searchResultsData = this.registryList;
                this.animateCounter(this.registryList.filter(e => e.analyzed).length);
            }
        } catch (error) {
            console.error('Failed to load search pool:', error);
            this.searchPool = [];
            this.registry = {};
            this.registryList = [];
            this.searchResultsData = [];
        }
    },

    filterAndShow(query) {
        const q = (query || '').trim();
        let pool = this.searchPool || [];

        if (this.searchOnlyTables) {
            pool = pool.filter(e => e.levels && e.levels.length > 0);
        }

        if (!q) {
            this.renderSearchResults(pool);
            return;
        }

        const tokens = q.toLowerCase().split(/\s+/);
        const results = pool.filter(entry => {
            const title = (entry.title || '').toLowerCase();
            const subtitle = (entry.subtitle || '').toLowerCase();
            const artist = (entry.artist || '').toLowerCase();
            const levelStr = (entry.levels || []).join(' ').toLowerCase();
            return tokens.every(token =>
                title.includes(token) ||
                subtitle.includes(token) ||
                artist.includes(token) ||
                levelStr.includes(token)
            );
        });
        this.renderSearchResults(results);
    },

    renderSearchResults(results) {
        const shown = (results || []).slice(0, 96);
        this.searchResultsData = shown;
        this.selectedIndex = -1;

        if (shown.length === 0) {
            this.dom.searchResults.innerHTML = '<div class="search-empty">No matches</div>';
        } else {
            let html = '';
            shown.forEach((entry, idx) => {
                const titleLine = entry.title || '';
                const levelStr = (entry.levels && entry.levels.length) ? entry.levels.join(', ') : '';
                const artist = entry.artist || '';
                const checkmark = entry.analyzed ? '<span class="search-card-check">✓</span>' : '';

                html += `<div class="search-card" data-index="${idx}">`;
                html += `<div class="search-card-title">${titleLine}</div>`;
                html += `<div class="search-card-levels">${levelStr}</div>`;
                html += `<div class="search-card-artist">${artist}</div>`;
                html += checkmark;
                html += `</div>`;
            });
            this.dom.searchResults.innerHTML = html;
        }

        this.dom.searchResults.classList.remove('hidden-state');
        if (shown.length <= 24) {
            this.dom.searchResults.style.maxHeight = 'none';
            const naturalHeight = this.dom.searchResults.scrollHeight;
            this.dom.searchResults.style.maxHeight = naturalHeight + 'px';
        } else {
            this.dom.searchResults.style.maxHeight = '18.6rem';
        }

        if (shown.length > 0) {
            this.dom.searchResults.querySelectorAll('.search-card').forEach(card => {
                card.addEventListener('click', () => {
                    const idx = parseInt(card.dataset.index);
                    const entry = this.searchResultsData[idx];
                    if (entry) this.selectChart(entry.md5, entry);
                });
                card.addEventListener('mouseenter', () => {
                    this.highlightCard(parseInt(card.dataset.index));
                });
            });
        }
    },

    highlightCard(idx, keyboard = false) {
        const cards = this.dom.searchResults.querySelectorAll('.search-card');
        cards.forEach((c, i) => c.classList.toggle('selected', i === idx));
        this.selectedIndex = idx;
    },

    hideSearchResults() {
        this.dom.searchResults.style.maxHeight = '0px';
        this.dom.searchResults.classList.add('hidden-state');
    },

    selectChart(md5, entry) {
        this.updateChartHeader(md5);
        this.hideSearchResults();
        this.dom.chartSearch.value = '';
        this.dom.chartSearch.blur();

        if (entry && entry.path && entry.analyzed !== true) {
            this.loadFromSongDb(entry);
        } else {
            this.loadChart(md5);
        }
    },

    async loadFromSongDb(entry) {
        this.showToast('Analyzing: ' + entry.title, 3000);
        try {
            const result = await window.tauriAPI.analyzeChart(entry.path);
            if (result) {
                await window.tauriAPI.saveAnalysis(result);
                await this.loadRegistry();
                await this.loadChart(result.md5);
            }
        } catch (error) {
            console.error('Failed to analyze from song DB:', error);
            this.showToast('Analysis failed: ' + error.message, 5000);
        }
    },
};
