// EPG sob demanda via get_short_epg do Xtream (leve — por canal), com cache.
// Estratégia da matriz de paridade: nada de xmltv.php inteiro numa TV de 1GB.
// Os campos title/description vêm em base64 (UTF-8).

import { api } from './api';

export interface EpgProgram {
    title: string;
    description: string;
    /** epoch em ms */
    start: number;
    /** epoch em ms */
    end: number;
}

export interface ChannelEpg {
    now: EpgProgram | null;
    next: EpgProgram | null;
    programs: EpgProgram[];
}

interface ShortEpgListing {
    title?: string;
    description?: string;
    start_timestamp?: string | number;
    stop_timestamp?: string | number;
    start?: string;
    end?: string;
    stop?: string;
}

interface ShortEpgResponse {
    epg_listings?: ShortEpgListing[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 80; // teto de canais em memória (TV com pouca RAM)

const cache = new Map<number, { at: number; data: ChannelEpg }>();
// Dedupe de requisições em voo: ficha + player pedem o MESMO canal no mesmo
// ciclo (playChannel seta os dois estados juntos) — sem isso são 2 fetches.
const inflight = new Map<number, Promise<ChannelEpg>>();

function decodeBase64Utf8(value: string): string {
    try {
        const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
        return new TextDecoder('utf-8').decode(bytes);
    } catch {
        return value;
    }
}

function toMs(listing: ShortEpgListing, field: 'start' | 'stop'): number {
    const ts = field === 'start' ? listing.start_timestamp : listing.stop_timestamp;
    const numeric = Number(ts);
    if (numeric > 0) return numeric * 1000;
    // Fallback pro formato "YYYY-MM-DD HH:MM:SS" (fuso do provedor — impreciso,
    // mas melhor que nada quando o provedor não manda timestamps).
    const raw = field === 'start' ? listing.start : (listing.end || listing.stop);
    if (raw) {
        const parsed = Date.parse(raw.replace(' ', 'T'));
        if (!Number.isNaN(parsed)) return parsed;
    }
    return 0;
}

function parseListings(data: ShortEpgResponse): EpgProgram[] {
    const listings = Array.isArray(data?.epg_listings) ? data.epg_listings : [];
    return listings
        .map(listing => ({
            title: listing.title ? decodeBase64Utf8(listing.title) : '',
            description: listing.description ? decodeBase64Utf8(listing.description) : '',
            start: toMs(listing, 'start'),
            end: toMs(listing, 'stop'),
        }))
        .filter(p => p.title && p.start > 0 && p.end > p.start)
        .sort((a, b) => a.start - b.start);
}

function classify(programs: EpgProgram[]): ChannelEpg {
    const now = Date.now();
    const current = programs.find(p => p.start <= now && p.end > now) || null;
    const upcoming = programs.find(p => p.start > now) || null;
    return { now: current, next: upcoming, programs };
}

export const epgService = {
    /** EPG do canal (agora/a seguir). Cache de 5 min; erro devolve vazio. */
    async getChannelEpg(streamId: number, limit = 6): Promise<ChannelEpg> {
        const cached = cache.get(streamId);
        if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
            // Reclassifica com o relógio atual (o "agora" muda sem refetch).
            return classify(cached.data.programs);
        }

        const pending = inflight.get(streamId);
        if (pending) return pending;

        const request = (async (): Promise<ChannelEpg> => {
            try {
                const data = (await api.getShortEpg(streamId, limit)) as ShortEpgResponse;
                const programs = parseListings(data);
                const result = classify(programs);

                if (cache.size >= CACHE_MAX) {
                    let oldestKey: number | null = null;
                    let oldestAt = Infinity;
                    for (const [key, entry] of cache) {
                        if (entry.at < oldestAt) { oldestAt = entry.at; oldestKey = key; }
                    }
                    if (oldestKey !== null) cache.delete(oldestKey);
                }
                cache.set(streamId, { at: Date.now(), data: result });
                return result;
            } catch {
                return { now: null, next: null, programs: [] };
            } finally {
                inflight.delete(streamId);
            }
        })();

        inflight.set(streamId, request);
        return request;
    },

    /** Percentual decorrido do programa atual (0-100) ou null. */
    progressPct(program: EpgProgram | null): number | null {
        if (!program) return null;
        const total = program.end - program.start;
        if (total <= 0) return null;
        const pct = ((Date.now() - program.start) / total) * 100;
        return Math.max(0, Math.min(100, pct));
    },

    clearCache(): void {
        cache.clear();
    },
};
