// TMDB API Service for NeoStream TV
import { storage } from './storage';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

// Cache settings
// 7 dias (item 19): metadados de filme mudam pouco e a ficha precisa abrir
// instantânea na 2ª visita — poupa rede e RAM da TV
const CACHE_EXPIRY_HOURS = 24 * 7;
// O sufixo _v2 é o bump que acompanha a PROJEÇÃO do payload (ver projetarFilme
// / projetarSerie). Sem trocar a chave, quem tem cache quente ficaria até 7
// dias com o formato antigo — sem trailer, sem elenco, sem coleção — e o
// sintoma seria "a novidade não apareceu pra mim", que é impossível de
// diagnosticar de longe. Um bump só, para todas as novidades de uma vez.
const CACHE_KEYS = {
    MOVIE_DETAILS: 'tmdb_movie_details_v2',
    SERIES_DETAILS: 'tmdb_series_details_v2',
    MOVIE_SEARCH: 'tmdb_movie_search',
    SERIES_SEARCH: 'tmdb_series_search'
};

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

interface CacheStore<T> {
    [key: string]: CacheEntry<T>;
}

interface TMDBReleaseCountry {
    iso_3166_1: string;
    release_dates?: Array<{ certification?: string }>;
}

interface TMDBContentRating {
    iso_3166_1: string;
    rating?: string;
}

// In-memory cache
const memoryCache: {
    movieDetails: CacheStore<TMDBMovieDetails>;
    seriesDetails: CacheStore<TMDBSeriesDetails>;
    movieSearch: CacheStore<string | null>;
    seriesSearch: CacheStore<string | null>;
} = {
    movieDetails: {},
    seriesDetails: {},
    movieSearch: {},
    seriesSearch: {}
};

// Load cache from localStorage
function loadCacheFromStorage<T>(key: string): CacheStore<T> {
    try {
        const stored = localStorage.getItem(key);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {
        console.warn(`Failed to load cache ${key}:`, e);
    }
    return {};
}

// Save cache to localStorage
function saveCacheToStorage<T>(key: string, cache: CacheStore<T>): void {
    try {
        const cleaned: CacheStore<T> = {};
        const now = Date.now();
        const expiryMs = CACHE_EXPIRY_HOURS * 60 * 60 * 1000;

        for (const [k, entry] of Object.entries(cache)) {
            if (now - entry.timestamp < expiryMs) {
                cleaned[k] = entry;
            }
        }

        localStorage.setItem(key, JSON.stringify(cleaned));
    } catch (e) {
        console.warn(`Failed to save cache ${key}:`, e);
    }
}

// Check if cache entry is valid
function isCacheValid<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
    if (!entry) return false;
    const expiryMs = CACHE_EXPIRY_HOURS * 60 * 60 * 1000;
    return Date.now() - entry.timestamp < expiryMs;
}

// Initialize cache from localStorage
function initCache(): void {
    memoryCache.movieDetails = loadCacheFromStorage(CACHE_KEYS.MOVIE_DETAILS);
    memoryCache.seriesDetails = loadCacheFromStorage(CACHE_KEYS.SERIES_DETAILS);
    memoryCache.movieSearch = loadCacheFromStorage(CACHE_KEYS.MOVIE_SEARCH);
    memoryCache.seriesSearch = loadCacheFromStorage(CACHE_KEYS.SERIES_SEARCH);
}

initCache();

// Generic cache operations
function getCached<T>(store: CacheStore<T>, key: string): T | null {
    const entry = store[key];
    if (isCacheValid(entry)) {
        return entry.data;
    }
    return null;
}

/** Mantém só as N entradas mais recentes da loja (LRU por timestamp). */
function pruneStore<T>(store: CacheStore<T>, max = MAX_CACHE_ENTRIES): void {
    const chaves = Object.keys(store);
    if (chaves.length <= max) return;
    chaves
        .sort((a, b) => (store[b]?.timestamp || 0) - (store[a]?.timestamp || 0))
        .slice(max)
        .forEach(chave => { delete store[chave]; });
}

// Teto de entradas por loja. Sem isto o cache passava de 2 MB e cada ficha
// nova reserializava tudo na main thread (200-400 ms de UI travada na TV) —
// além de ser ele quem enchia a quota que derrubava os outros serviços.
const MAX_CACHE_ENTRIES = 120;
// Regravar a cada item aberto é o que custa caro. Agrupa as gravações.
const SAVE_DEBOUNCE_MS = 1500;
const saveTimers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};

function setCache<T>(store: CacheStore<T>, key: string, data: T, storageKey: string, max?: number): void {
    store[key] = { data, timestamp: Date.now() };
    pruneStore(store, max);
    // Gravação agrupada: navegar por 10 fichas seguidas reserializava a loja
    // inteira 10 vezes na main thread. Agora é uma vez só, no fim.
    if (saveTimers[storageKey]) clearTimeout(saveTimers[storageKey]);
    saveTimers[storageKey] = setTimeout(() => {
        saveTimers[storageKey] = undefined;
        saveCacheToStorage(storageKey, store);
    }, SAVE_DEBOUNCE_MS);
}

// Normalize search query
function normalizeSearchKey(name: string, year?: string): string {
    const cleanName = name.toLowerCase().trim().replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ');
    return year ? `${cleanName}:${year}` : cleanName;
}

function getTmdbApiKey(): string {
    return storage.getTmdbApiKey();
}

function buildTmdbUrl(path: string, params: Record<string, string>): string | null {
    const apiKey = getTmdbApiKey();
    if (!apiKey) return null;

    const url = new URL(`${TMDB_BASE_URL}${path}`);
    url.searchParams.set('api_key', apiKey);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
}

// TMDB Types
/** Uma pessoa do elenco, já podada pro que a ficha mostra. */
export interface TMDBAtor {
    id: number;
    name: string;
    character: string;
    profile_path: string | null;
}

/** A saga a que o filme pertence, sem os filmes (esses vêm em fetchColecao). */
export interface TMDBColecaoResumo {
    id: number;
    name: string;
    poster_path: string | null;
}

export interface TMDBMovieDetails {
    id?: number;
    genres: { id: number; name: string }[];
    overview: string;
    title: string;
    release_date: string;
    vote_average: number;
    backdrop_path: string | null;
    poster_path: string | null;
    certification?: string;
    imdb_id?: string;
    runtime?: number;
    /** Chave do vídeo no YouTube (item 18) — só a chave, nunca o array inteiro */
    trailerKey?: string;
    /** Elenco podado (item 34) */
    cast?: TMDBAtor[];
    /** Saga (item 29) */
    belongs_to_collection?: TMDBColecaoResumo | null;
}

export interface TMDBSeriesDetails {
    id?: number;
    genres: { id: number; name: string }[];
    overview: string;
    name: string;
    first_air_date: string;
    vote_average: number;
    backdrop_path: string | null;
    poster_path: string | null;
    certification?: string;
    imdb_id?: string;
    number_of_seasons?: number;
    /** Chave do vídeo no YouTube (item 18) */
    trailerKey?: string;
    /** Elenco podado (item 34) */
    cast?: TMDBAtor[];
}

/**
 * Get backdrop/poster image URL from TMDB
 */
/**
 * Tamanhos do TMDB. Numa grade de TV o card tem ~220 px de largura: baixar
 * w780 pra exibir em 220 gasta ~4x mais banda e memória de decodificação — e
 * numa TV de 1 GB de RAM a memória é o recurso que acaba primeiro.
 */
export const IMAGE_SIZE_GRADE = 'w342';
export const IMAGE_SIZE_FICHA = 'w500';
export const IMAGE_SIZE_FUNDO = 'w1280';

// Hoje TODO call site passa o tamanho de propósito; o padrão só existe pra
// quem for acrescentar um novo. A grade do catálogo não usa TMDB — ela mostra
// o stream_icon que o próprio provedor manda, num tamanho que não escolhemos.
export function getImageUrl(path: string | null, size: string = IMAGE_SIZE_FICHA): string | null {
    if (!path) return null;
    return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
}

/** Quantos atores a faixa de elenco mostra. Além disso é peso morto no cache. */
const MAX_ELENCO = 12;

interface TMDBVideo {
    key?: string;
    site?: string;
    type?: string;
    official?: boolean;
    iso_639_1?: string;
}

/**
 * A chave do trailer no YouTube, em ordem de preferência: dublado/legendado em
 * português > oficial > qualquer trailer > teaser. Guardamos SÓ a chave: o
 * array `videos.results` tem dezenas de entradas por filme e ia inteiro pro
 * localStorage, numa quota de ~5 MB.
 */
function extrairTrailer(videos: unknown): string | undefined {
    const lista = (videos as { results?: TMDBVideo[] } | undefined)?.results;
    if (!Array.isArray(lista)) return undefined;
    const doYoutube = lista.filter(v => v?.site === 'YouTube' && v.key);
    const trailers = doYoutube.filter(v => v.type === 'Trailer');
    const escolhido = trailers.find(v => v.iso_639_1 === 'pt')
        || trailers.find(v => v.official)
        || trailers[0]
        || doYoutube.find(v => v.type === 'Teaser');
    return escolhido?.key;
}

interface TMDBCastRaw {
    id?: number;
    name?: string;
    character?: string;
    profile_path?: string | null;
}

/** Elenco podado: só o que a faixa desenha, e só os primeiros MAX_ELENCO. */
function extrairElenco(credits: unknown): TMDBAtor[] | undefined {
    const lista = (credits as { cast?: TMDBCastRaw[] } | undefined)?.cast;
    if (!Array.isArray(lista) || lista.length === 0) return undefined;
    return lista
        .filter(pessoa => pessoa?.id != null && pessoa.name)
        .slice(0, MAX_ELENCO)
        .map(pessoa => ({
            id: Number(pessoa.id),
            name: String(pessoa.name),
            character: String(pessoa.character || ''),
            profile_path: pessoa.profile_path ?? null,
        }));
}

/**
 * Projeta a resposta do TMDB no que o app realmente usa.
 *
 * O código antigo gravava `{ ...data }` — a resposta INTEIRA, com production
 * companies, países, idiomas falados, coleção com sinopse, o array de vídeos
 * completo. Numa loja de 120 entradas isso passava de 2 MB, e quando a quota
 * estourava em qualquer outro serviço o `pruneCaches` derrubava as quatro
 * lojas do TMDB de uma vez. Projetar é o que torna seguro guardar MAIS coisas.
 */
function projetarFilme(data: Record<string, unknown>, certification?: string): TMDBMovieDetails {
    const saga = data.belongs_to_collection as
        { id?: number; name?: string; poster_path?: string | null } | null | undefined;
    return {
        id: typeof data.id === 'number' ? data.id : undefined,
        genres: Array.isArray(data.genres) ? data.genres as { id: number; name: string }[] : [],
        overview: String(data.overview || ''),
        title: String(data.title || ''),
        release_date: String(data.release_date || ''),
        vote_average: Number(data.vote_average) || 0,
        backdrop_path: (data.backdrop_path as string | null) ?? null,
        poster_path: (data.poster_path as string | null) ?? null,
        certification,
        imdb_id: (data.imdb_id as string | undefined)
            || ((data.external_ids as { imdb_id?: string } | undefined)?.imdb_id || undefined),
        runtime: typeof data.runtime === 'number' ? data.runtime : undefined,
        trailerKey: extrairTrailer(data.videos),
        cast: extrairElenco(data.credits),
        belongs_to_collection: saga?.id != null
            ? { id: Number(saga.id), name: String(saga.name || ''), poster_path: saga.poster_path ?? null }
            : null,
    };
}

function projetarSerie(data: Record<string, unknown>, certification?: string): TMDBSeriesDetails {
    return {
        id: typeof data.id === 'number' ? data.id : undefined,
        genres: Array.isArray(data.genres) ? data.genres as { id: number; name: string }[] : [],
        overview: String(data.overview || ''),
        name: String(data.name || ''),
        first_air_date: String(data.first_air_date || ''),
        vote_average: Number(data.vote_average) || 0,
        backdrop_path: (data.backdrop_path as string | null) ?? null,
        poster_path: (data.poster_path as string | null) ?? null,
        certification,
        imdb_id: (data.external_ids as { imdb_id?: string } | undefined)?.imdb_id || undefined,
        number_of_seasons: typeof data.number_of_seasons === 'number' ? data.number_of_seasons : undefined,
        trailerKey: extrairTrailer(data.videos),
        cast: extrairElenco(data.credits),
    };
}

/**
 * Fetch movie details by TMDB ID
 */
export async function fetchMovieDetails(tmdbId: string): Promise<TMDBMovieDetails | null> {
    if (!tmdbId) return null;

    const cached = getCached<TMDBMovieDetails>(memoryCache.movieDetails, tmdbId);
    if (cached) return cached;

    try {
        const detailsUrl = buildTmdbUrl(`/movie/${tmdbId}`, {
            language: 'pt-BR',
            // credits e videos entram no MESMO pedido: append_to_response não
            // custa requisição extra, e é isso que torna elenco e trailer de
            // graça em vez de mais duas viagens por ficha aberta.
            append_to_response: 'release_dates,external_ids,credits,videos',
        });
        if (!detailsUrl) return null;

        const response = await fetch(detailsUrl);
        if (!response.ok) return null;
        const data = await response.json();

        // Extract certification
        let certification: string | undefined;
        if (data.release_dates?.results) {
            const releases = data.release_dates.results as TMDBReleaseCountry[];
            const brRelease = releases.find((r) => r.iso_3166_1 === 'BR');
            const usRelease = releases.find((r) => r.iso_3166_1 === 'US');
            const releaseData = brRelease || usRelease || releases[0];
            if (releaseData?.release_dates?.[0]?.certification) {
                certification = releaseData.release_dates[0].certification;
            }
        }

        const result = projetarFilme(data, certification);
        setCache(memoryCache.movieDetails, tmdbId, result, CACHE_KEYS.MOVIE_DETAILS);
        return result;
    } catch (error) {
        console.error('Error fetching movie details:', error);
        return null;
    }
}

/**
 * Fetch series details by TMDB ID
 */
export async function fetchSeriesDetails(tmdbId: string): Promise<TMDBSeriesDetails | null> {
    if (!tmdbId) return null;

    const cached = getCached<TMDBSeriesDetails>(memoryCache.seriesDetails, tmdbId);
    if (cached) return cached;

    try {
        const detailsUrl = buildTmdbUrl(`/tv/${tmdbId}`, {
            language: 'pt-BR',
            append_to_response: 'content_ratings,external_ids,credits,videos',
        });
        if (!detailsUrl) return null;

        const response = await fetch(detailsUrl);
        if (!response.ok) return null;
        const data = await response.json();

        // Extract certification
        let certification: string | undefined;
        if (data.content_ratings?.results) {
            const ratings = data.content_ratings.results as TMDBContentRating[];
            const brRating = ratings.find((r) => r.iso_3166_1 === 'BR');
            const usRating = ratings.find((r) => r.iso_3166_1 === 'US');
            const ratingData = brRating || usRating || ratings[0];
            if (ratingData?.rating) {
                certification = ratingData.rating;
            }
        }

        const result = projetarSerie(data, certification);
        setCache(memoryCache.seriesDetails, tmdbId, result, CACHE_KEYS.SERIES_DETAILS);
        return result;
    } catch (error) {
        console.error('Error fetching series details:', error);
        return null;
    }
}

/**
 * Search movie by name and get details
 */
export async function searchMovieByName(movieName: string, year?: string): Promise<TMDBMovieDetails | null> {
    const searchKey = normalizeSearchKey(movieName, year);
    if (!getTmdbApiKey()) return null;

    const cachedTmdbId = getCached<string | null>(memoryCache.movieSearch, searchKey);
    if (cachedTmdbId !== null) {
        if (cachedTmdbId === '') return null;
        return await fetchMovieDetails(cachedTmdbId);
    }

    try {
        let cleanName = movieName.replace(/\s*\(\d{4}\)\s*/g, '').trim();
        cleanName = cleanName.replace(/\s*\[.*?\]\s*/g, '').trim();
        cleanName = cleanName.replace(/\s+/g, ' ').trim();

        const searchParams: Record<string, string> = {
            language: 'pt-BR',
            query: cleanName,
        };
        if (year) searchParams.year = year;

        const searchUrl = buildTmdbUrl('/search/movie', searchParams);
        if (!searchUrl) return null;

        const response = await fetch(searchUrl);
        if (!response.ok) return null;

        const data = await response.json();

        if (data.results && data.results.length > 0) {
            const tmdbId = data.results[0].id.toString();
            setCache(memoryCache.movieSearch, searchKey, tmdbId, CACHE_KEYS.MOVIE_SEARCH);
            return await fetchMovieDetails(tmdbId);
        }

        setCache(memoryCache.movieSearch, searchKey, '', CACHE_KEYS.MOVIE_SEARCH);
        return null;
    } catch (error) {
        console.error('Error searching movie:', error);
        return null;
    }
}

/**
 * Search series by name and get details
 */
export async function searchSeriesByName(seriesName: string, year?: string): Promise<TMDBSeriesDetails | null> {
    const searchKey = normalizeSearchKey(seriesName, year);
    if (!getTmdbApiKey()) return null;

    const cachedTmdbId = getCached<string | null>(memoryCache.seriesSearch, searchKey);
    if (cachedTmdbId !== null) {
        if (cachedTmdbId === '') return null;
        return await fetchSeriesDetails(cachedTmdbId);
    }

    try {
        let cleanName = seriesName.replace(/\s*\(\d{4}\)\s*/g, '').trim();
        cleanName = cleanName.replace(/\s*\[.*?\]\s*/g, '').trim();
        cleanName = cleanName.replace(/\s+/g, ' ').trim();

        const searchParams: Record<string, string> = {
            language: 'pt-BR',
            query: cleanName,
        };
        if (year) searchParams.first_air_date_year = year;

        const searchUrl = buildTmdbUrl('/search/tv', searchParams);
        if (!searchUrl) return null;

        const response = await fetch(searchUrl);
        if (!response.ok) return null;

        const data = await response.json();

        if (data.results && data.results.length > 0) {
            const tmdbId = data.results[0].id.toString();
            setCache(memoryCache.seriesSearch, searchKey, tmdbId, CACHE_KEYS.SERIES_SEARCH);
            return await fetchSeriesDetails(tmdbId);
        }

        setCache(memoryCache.seriesSearch, searchKey, '', CACHE_KEYS.SERIES_SEARCH);
        return null;
    } catch (error) {
        console.error('Error searching series:', error);
        return null;
    }
}

/**
 * Format genres array to string
 */
export function formatGenres(genres: { id: number; name: string }[]): string {
    return genres.map(g => g.name).join(', ');
}
