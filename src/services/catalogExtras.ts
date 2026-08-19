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
