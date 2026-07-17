const tauriAPI = {
    isTauri: () => typeof window.__TAURI__ !== 'undefined',

    // Invoke a Tauri command with improved error extraction
    invoke: async (command, args = {}) => {
        if (!tauriAPI.isTauri()) {
            console.warn(`Tauri not available, cannot call ${command}`);
            return null;
        }
        try {
            const { invoke } = window.__TAURI__.core;
            return await invoke(command, args);
        } catch (error) {
            // Tauri 2 wraps command errors. Extract the human-readable message.
            let message = error.message || String(error);
            if (error.data && typeof error.data === 'string') {
                message = error.data;
            } else if (error.data && error.data.message) {
                message = error.data.message;
            }
            console.error(`Tauri command ${command} failed:`, message);
            throw new Error(message);
        }
    },

    analyzeChart: async (path) => tauriAPI.invoke('analyze_chart', { path }),
    loadChart: async (md5) => tauriAPI.invoke('load_chart', { md5 }),
    toggleFavorite: async (md5) => tauriAPI.invoke('toggle_favorite', { md5 }),
    deleteHistory: async (md5) => tauriAPI.invoke('delete_history', { md5 }),
    clearHistory: async () => tauriAPI.invoke('clear_history', {}),
    openFileDialog: async () => tauriAPI.invoke('open_file_dialog', {}),
    openSongDbDialog: async () => tauriAPI.invoke('open_song_db_dialog', {}),
    exportJson: async (md5) => tauriAPI.invoke('export_json', { md5 }),
    copyAnalysis: async (md5) => tauriAPI.invoke('copy_analysis', { md5 }),
    getSettings: async () => tauriAPI.invoke('get_settings', {}),
    saveSettings: async (settings) => tauriAPI.invoke('save_settings', { settings }),
    getRecentAnalyses: async (limit = 20) => tauriAPI.invoke('get_recent_analyses', { limit }),
    saveAnalysis: async (result) => tauriAPI.invoke('save_analysis', { result }),
    dragDropAnalyze: async (paths) => tauriAPI.invoke('drag_drop_analyze', { paths }),
    // Song database commands
    loadSongDatabase: async (dbPath) => tauriAPI.invoke('load_song_database', { dbPath }),
    removeSongDatabase: async (dbPath) => tauriAPI.invoke('remove_song_database', { dbPath }),
    getSongDatabases: async () => tauriAPI.invoke('get_song_databases', {}),
    search: async (query) => tauriAPI.invoke('search', { query }),
};

window.tauriAPI = tauriAPI;
