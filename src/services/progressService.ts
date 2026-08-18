// Progresso de reprodução (continuar assistindo) — localStorage.
// Port simplificado do watchProgress/movieProgress do NeoStream desktop:
// filmes guardam a posição por id; séries guardam o ÚLTIMO episódio visto
// por série (suficiente pra fileira "Continuar Assistindo" e pro auto-resume).

const MOVIE_KEY = 'neostream_movie_progress';
const SERIES_KEY = 'neostream_series_progress';
const MAX_ENTRIES = 50;
const COMPLETED_RATIO = 0.95;
const MIN_SECONDS = 30; // abaixo disso não vale salvar

export interface MovieProgress {
    id: string;
    name: string;
    poster?: string;
    container?: string;
    time: number;
    duration: number;
    completed: boolean;
    updatedAt: number;
}

export interface SeriesProgress {
    seriesId: string;
    seriesName: string;
    poster?: string;
    season: number;
    episode: number;
    episodeId: string;
    container?: string;
    time: number;
    duration: number;
    completed: boolean;
    updatedAt: number;
}

function readMap<T>(key: string): Record<string, T> {
    try {
        return JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
        return {};
    }
}

function writeMap<T extends { updatedAt: number }>(key: string, map: Record<string, T>): void {
    const entries = Object.entries(map);
    if (entries.length > MAX_ENTRIES) {
        entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
        map = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
    }
    try {
        localStorage.setItem(key, JSON.stringify(map));
    } catch {
        // Quota cheia numa TV antiga: descarta o mais velho e tenta 1x.
        const trimmed = Object.fromEntries(entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 20));
        try { localStorage.setItem(key, JSON.stringify(trimmed)); } catch { /* desiste */ }
    }
}

export const progressService = {
    saveMovie(item: Omit<MovieProgress, 'completed' | 'updatedAt'>): void {
        if (!item.duration || item.time < MIN_SECONDS) return;
        const map = readMap<MovieProgress>(MOVIE_KEY);
        const completed = item.time / item.duration >= COMPLETED_RATIO;
        map[item.id] = { ...item, completed, updatedAt: Date.now() };
        writeMap(MOVIE_KEY, map);
    },

    getMovie(id: string): MovieProgress | null {
        return readMap<MovieProgress>(MOVIE_KEY)[id] || null;
    },

    /** Tempo de retomada (null se não há progresso útil ou já concluiu). */
    getMovieResumeTime(id: string): number | null {
        const p = this.getMovie(id);
        if (!p || p.completed || p.time < MIN_SECONDS) return null;
        return p.time;
    },

    removeMovie(id: string): void {
        const map = readMap<MovieProgress>(MOVIE_KEY);
        delete map[id];
        writeMap(MOVIE_KEY, map);
    },

    saveSeries(item: Omit<SeriesProgress, 'completed' | 'updatedAt'>): void {
        if (!item.duration || item.time < MIN_SECONDS) return;
        const map = readMap<SeriesProgress>(SERIES_KEY);
        const completed = item.time / item.duration >= COMPLETED_RATIO;
        map[item.seriesId] = { ...item, completed, updatedAt: Date.now() };
        writeMap(SERIES_KEY, map);
    },

    getSeries(seriesId: string): SeriesProgress | null {
        return readMap<SeriesProgress>(SERIES_KEY)[seriesId] || null;
    },

    getSeriesResumeTime(seriesId: string, season: number, episode: number): number | null {
        const p = this.getSeries(seriesId);
        if (!p || p.season !== season || p.episode !== episode) return null;
        if (p.completed || p.time < MIN_SECONDS) return null;
        return p.time;
    },

    removeSeries(seriesId: string): void {
        const map = readMap<SeriesProgress>(SERIES_KEY);
        delete map[seriesId];
        writeMap(SERIES_KEY, map);
    },

    /** Itens pra fileira "Continuar Assistindo", mais recentes primeiro. */
    getContinueWatching(): Array<
        | { kind: 'movie'; progress: MovieProgress }
        | { kind: 'series'; progress: SeriesProgress }
    > {
        const movies = Object.values(readMap<MovieProgress>(MOVIE_KEY))
            .filter(p => !p.completed && p.time >= MIN_SECONDS)
            .map(progress => ({ kind: 'movie' as const, progress }));
        // Série concluída no meio da temporada ainda é "continuável" (próximo ep),
        // mas sem saber o total de episódios aqui, só mostramos as não-concluídas.
        const series = Object.values(readMap<SeriesProgress>(SERIES_KEY))
            .filter(p => !p.completed && p.time >= MIN_SECONDS)
            .map(progress => ({ kind: 'series' as const, progress }));
        return [...movies, ...series].sort((a, b) => b.progress.updatedAt - a.progress.updatedAt);
    },
};
