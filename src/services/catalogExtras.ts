// Extras de catálogo (Fase 3 da paridade com o desktop):
// - ordenação persistida (padrão/recentes/nome/nota)
// - esconder assistidos
// - selo NOVO (added/last_modified recente)
// - detecção de novos episódios de séries seguidas (diff de last_modified)
// - recomendações por afinidade de categoria (local-first, zero rede)

export type CatalogSort = 'default' | 'recent' | 'name' | 'rating';

export const SORT_ORDER: CatalogSort[] = ['default', 'recent', 'name', 'rating'];

export const SORT_LABELS: Record<CatalogSort, string> = {
    default: 'Padrão',
    recent: 'Recentes',
    name: 'Nome',
    rating: 'Nota',
};

const SORT_KEY_PREFIX = 'neostream_sort_';
const HIDE_WATCHED_KEY = 'neostream_hide_watched';
const NEW_EPISODES_KEY = 'neostream_series_lastmod';
const NEW_BADGE_DAYS = 7;

function safeWrite(key: string, value: string | null): void {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        // Quota cheia numa TV — falha silenciosa
    }
}

// Collator único: criar um por comparação é ~27x mais lento (lição do desktop)
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

export const catalogSort = {
    get(kind: 'movies' | 'series'): CatalogSort {
        const raw = localStorage.getItem(SORT_KEY_PREFIX + kind);
        return SORT_ORDER.includes(raw as CatalogSort) ? (raw as CatalogSort) : 'default';
    },
    set(kind: 'movies' | 'series', sort: CatalogSort): void {
        safeWrite(SORT_KEY_PREFIX + kind, sort === 'default' ? null : sort);
    },
    next(current: CatalogSort): CatalogSort {
        return SORT_ORDER[(SORT_ORDER.indexOf(current) + 1) % SORT_ORDER.length];
    },
};

export interface SortableItem {
    name: string;
    rating_5based?: number;
    added?: string;
    last_modified?: string;
}

/** Epoch (segundos) de um campo que pode vir como epoch string OU data ISO
 *  ("1723900000" vs "2026-08-10 14:22:00" — provedores Xtream variam). */
function parseEpoch(raw: string): number {
    const numeric = Number(raw);
    if (numeric > 0) return numeric;
    const parsed = Date.parse(raw.replace(' ', 'T'));
    return Number.isNaN(parsed) ? 0 : parsed / 1000;
}

/** Epoch (segundos) do item — `added` dos filmes e `last_modified` das séries. */
function addedEpoch(item: SortableItem): number {
    return parseEpoch(item.added || item.last_modified || '0');
}

export function sortCatalog<T extends SortableItem>(items: T[], sort: CatalogSort): T[] {
    if (sort === 'default') return items;
    const sorted = [...items];
    if (sort === 'recent') {
        sorted.sort((a, b) => addedEpoch(b) - addedEpoch(a));
    } else if (sort === 'name') {
        sorted.sort((a, b) => collator.compare(a.name || '', b.name || ''));
    } else if (sort === 'rating') {
        sorted.sort((a, b) => (b.rating_5based || 0) - (a.rating_5based || 0));
    }
    return sorted;
}

export const hideWatched = {
    get(): boolean {
        return localStorage.getItem(HIDE_WATCHED_KEY) === 'on';
    },
    set(value: boolean): void {
        safeWrite(HIDE_WATCHED_KEY, value ? 'on' : null);
    },
};

/** Selo NOVO: entrou no catálogo nos últimos 7 dias. */
export function isRecentlyAdded(item: SortableItem, nowMs: number): boolean {
    const epoch = addedEpoch(item);
    if (epoch <= 0) return false;
    return nowMs - epoch * 1000 < NEW_BADGE_DAYS * 24 * 60 * 60 * 1000;
}

// ---- Novos episódios de séries seguidas ----
// Baseline de last_modified por série; série seguida com last_modified maior
// que o baseline ganha badge. Primeira vez que a série é vista apenas semeia
// o baseline (sem badge) — zero chamadas extras de rede.

function readBaseline(): Record<string, string> {
    try {
        return JSON.parse(localStorage.getItem(NEW_EPISODES_KEY) || '{}');
    } catch {
        return {};
    }
}

export const newEpisodes = {
    /** Semeia baselines de séries seguidas ainda não conhecidas. */
    seed(entries: Array<{ seriesId: string; lastModified: string }>): void {
        const baseline = readBaseline();
        let changed = false;
        for (const entry of entries) {
            if (baseline[entry.seriesId] === undefined) {
                baseline[entry.seriesId] = entry.lastModified;
                changed = true;
            }
        }
        if (changed) safeWrite(NEW_EPISODES_KEY, JSON.stringify(baseline));
    },

    has(seriesId: string, lastModified: string): boolean {
        const baseline = readBaseline()[seriesId];
        if (baseline === undefined) return false;
        // parseEpoch cobre epoch string E data ISO (Number puro dava NaN>NaN)
        return parseEpoch(lastModified) > parseEpoch(baseline);
    },

    /** Usuário abriu a ficha — atualiza o baseline (tira o badge). */
    markSeen(seriesId: string, lastModified: string): void {
        const baseline = readBaseline();
        if (baseline[seriesId] !== lastModified) {
            baseline[seriesId] = lastModified;
            safeWrite(NEW_EPISODES_KEY, JSON.stringify(baseline));
        }
    },
};

// ---- Recomendações por afinidade de categoria ----
// Peso das categorias vem do que o usuário assistiu/favoritou; itens não
// vistos das categorias preferidas sobem. Empate desempata por nota.

export interface RecommendableItem extends SortableItem {
    category_id: string;
}

export function categoryAffinity(
    watchedOrFavoriteCategoryIds: string[]
): Map<string, number> {
    const affinity = new Map<string, number>();
    for (const categoryId of watchedOrFavoriteCategoryIds) {
        if (!categoryId) continue;
        affinity.set(categoryId, (affinity.get(categoryId) || 0) + 1);
    }
    return affinity;
}

export function scoreRecommendations<T extends RecommendableItem>(
    candidates: T[],
    affinity: Map<string, number>,
    excludeScore = 0
): T[] {
    if (affinity.size === 0) return [];
    const scored = candidates
        .map(item => ({
            item,
            score: (affinity.get(item.category_id) || 0) * 10 + (item.rating_5based || 0),
        }))
        .filter(entry => entry.score > excludeScore);
    scored.sort((a, b) => b.score - a.score);
    return scored.map(entry => entry.item);
}

/** Sorteio ponderado pela afinidade (roleta 🎲). rand injetável pra teste. */
export function spinRoulette<T extends RecommendableItem>(
    candidates: T[],
    affinity: Map<string, number>,
    rand: () => number = Math.random
): T | null {
    if (candidates.length === 0) return null;
    const weights = candidates.map(item => 1 + (affinity.get(item.category_id) || 0) * 3);
    const total = weights.reduce((sum, w) => sum + w, 0);
    let ticket = rand() * total;
    for (let i = 0; i < candidates.length; i++) {
        ticket -= weights[i];
        if (ticket <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
}

// ---- Filtros de catálogo (item 32) + busca tolerante (item 26) ----

export interface CatalogFilters {
    /** 1990, 2000, 2010, 2020... (0 = qualquer) */
    decade: number;
    /** nota mínima em escala 0-5 (0 = qualquer) */
    minRating: number;
}

export const DECADES = [0, 2020, 2010, 2000, 1990, 1980];
export const MIN_RATINGS = [0, 3, 3.5, 4, 4.5];

const FILTERS_KEY_PREFIX = 'neostream_filters_';

export const catalogFilters = {
    get(kind: 'movies' | 'series'): CatalogFilters {
        try {
            const raw = localStorage.getItem(FILTERS_KEY_PREFIX + kind);
            const parsed = raw ? JSON.parse(raw) : {};
            return {
                decade: DECADES.includes(Number(parsed.decade)) ? Number(parsed.decade) : 0,
                minRating: MIN_RATINGS.includes(Number(parsed.minRating)) ? Number(parsed.minRating) : 0,
            };
        } catch {
            return { decade: 0, minRating: 0 };
        }
    },
    set(kind: 'movies' | 'series', filters: CatalogFilters): void {
        const isDefault = filters.decade === 0 && filters.minRating === 0;
        safeWrite(FILTERS_KEY_PREFIX + kind, isDefault ? null : JSON.stringify(filters));
    },
};

export interface FilterableItem extends SortableItem {
    rating_5based?: number;
    release_date?: string;
}

/** Ano do item (release_date ou o ano dentro do nome). */
export function itemYear(item: FilterableItem): number {
    const fromDate = Number((item.release_date || '').slice(0, 4));
    if (fromDate >= 1900) return fromDate;
    const match = /(19|20)\d{2}/.exec(item.name || '');
    return match ? Number(match[0]) : 0;
}

export function matchesFilters(item: FilterableItem, filters: CatalogFilters): boolean {
    if (filters.minRating > 0 && (item.rating_5based || 0) < filters.minRating) return false;
    if (filters.decade > 0) {
        const year = itemYear(item);
        if (year < filters.decade || year >= filters.decade + 10) return false;
    }
    return true;
}

/** Normaliza pra busca: sem acento, minúsculo. */
export function normalizeSearch(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

/**
 * Casamento tolerante (item 26): substring direta OU todos os tokens da
 * query presentes OU distância de edição 1 numa palavra (typo simples).
 * Barato de propósito — roda sobre milhares de itens numa TV.
 */
export function fuzzyMatches(name: string, normalizedQuery: string): boolean {
    if (!normalizedQuery) return true;
    const normalizedName = normalizeSearch(name);
    if (normalizedName.includes(normalizedQuery)) return true;

    const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
    if (queryTokens.length > 1 && queryTokens.every(token => normalizedName.includes(token))) {
        return true;
    }
    // Typo de 1 caractere só vale pra query com 4+ letras (evita ruído)
    if (normalizedQuery.length < 4 || queryTokens.length > 1) return false;
    return normalizedName.split(/\s+/).some(word => withinEditDistance1(word, normalizedQuery));
}

/** true se as strings diferem por no máximo 1 inserção/remoção/troca. */
function withinEditDistance1(a: string, b: string): boolean {
    if (Math.abs(a.length - b.length) > 1) return false;
    if (a === b) return true;
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    let i = 0;
    let j = 0;
    let diffs = 0;
    while (i < shorter.length && j < longer.length) {
        if (shorter[i] === longer[j]) {
            i++;
            j++;
            continue;
        }
        if (++diffs > 1) return false;
        if (shorter.length === longer.length) i++;
        j++;
    }
    return true;
}
