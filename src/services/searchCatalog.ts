// Catálogo unificado pra busca global (Fase 4b): canais + filmes + séries
// com cache em memória (a busca abre e fecha toda hora; refetch seria brutal
// numa TV). Ranking simples com normalização de acentos.

import { api } from './api';
import { kidsFilter } from './kidsFilter';
import type { LiveStream, VODStream, Series } from '../types';

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface SearchCatalogData {
    channels: LiveStream[];
    movies: VODStream[];
    series: Series[];
}

let cache: { at: number; kids: boolean; data: SearchCatalogData } | null = null;
let inflight: Promise<SearchCatalogData> | null = null;

export function normalizeText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
}

export async function loadSearchCatalog(): Promise<SearchCatalogData> {
    const kids = kidsFilter.isKidsActive();
    if (cache && cache.kids === kids && Date.now() - cache.at < CACHE_TTL_MS) {
        return cache.data;
    }
    if (inflight) return inflight;

    inflight = (async () => {
        try {
            const [channels, movies, series, liveCats, vodCats, seriesCats] = await Promise.all([
                api.getLiveStreams(),
                api.getVODStreams(),
                api.getSeries(),
                api.getLiveCategories(),
                api.getVodCategories(),
                api.getSeriesCategories(),
            ]);
            const data: SearchCatalogData = {
                channels: kidsFilter.apply(channels, liveCats).items,
                movies: kidsFilter.apply(movies, vodCats).items,
                series: kidsFilter.apply(series, seriesCats).items,
            };
            cache = { at: Date.now(), kids, data };
            return data;
        } finally {
            inflight = null;
        }
    })();
    return inflight;
}

/** Score: começa com o termo = 3 · palavra começa = 2 · contém = 1 · nada = 0 */
function scoreName(normalizedName: string, query: string): number {
    if (!normalizedName.includes(query)) return 0;
    if (normalizedName.startsWith(query)) return 3;
    if (normalizedName.includes(' ' + query)) return 2;
    return 1;
}

export function searchIn<T extends { name: string }>(items: T[], query: string, limit: number): T[] {
    const normalizedQuery = normalizeText(query);
    if (normalizedQuery.length < 2) return [];
    const scored: Array<{ item: T; score: number }> = [];
    for (const item of items) {
        const score = scoreName(normalizeText(item.name || ''), normalizedQuery);
        if (score > 0) scored.push({ item, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(entry => entry.item);
}

export function clearSearchCatalogCache(): void {
    cache = null;
}
