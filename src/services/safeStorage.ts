// Leitura e escrita blindadas em localStorage (item 81).
//
// Cada serviço tinha o seu try/catch e a sua ideia de o que fazer quando a
// quota estoura — alguns desistiam em silêncio, outros tentavam de novo, e o
// progressService tinha uma poda própria. Aqui isso vira um comportamento só:
// tenta gravar; se a quota estourar, PODA o que for descartável e tenta mais
// uma vez. Numa TV com 5 MB de quota e capas do TMDB em cache, isso acontece.

import { PREFIXOS_CACHE, KEYS_CACHE } from './storageKeys';

export function readJson<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        // Chave corrompida (queda de energia no meio de uma escrita é comum
        // em TV): o valor padrão é melhor que uma tela branca
        return fallback;
    }
}

export function readRaw(key: string, fallback = ''): string {
    try {
        return localStorage.getItem(key) ?? fallback;
    } catch {
        return fallback;
    }
}

/** Apaga caches (nunca dado do usuário) pra liberar espaço. */
export function pruneCaches(): number {
    let removed = 0;
    try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            const isCache = PREFIXOS_CACHE.some(prefix => key.startsWith(prefix))
                || (KEYS_CACHE as readonly string[]).includes(key.split('__p_')[0]);
            if (isCache) keys.push(key);
        }
        for (const key of keys) {
            localStorage.removeItem(key);
            removed++;
        }
    } catch {
        // sem o que fazer aqui
    }
    return removed;
}

export interface WriteResult {
    ok: boolean;
    /** true quando só coube depois de apagar caches */
    pruned?: boolean;
}

export function writeRaw(key: string, value: string): WriteResult {
    try {
        localStorage.setItem(key, value);
        return { ok: true };
    } catch {
        // Quota: derruba os caches (que voltam sozinhos) e tenta de novo.
        // Descartar o dado do usuário em silêncio seria muito pior.
        if (pruneCaches() === 0) return { ok: false };
        try {
            localStorage.setItem(key, value);
            return { ok: true, pruned: true };
        } catch {
            return { ok: false };
        }
    }
}

export function writeJson(key: string, value: unknown): WriteResult {
    try {
        return writeRaw(key, JSON.stringify(value));
    } catch {
        // Valor circular ou impossível de serializar — erro de programação,
        // não de armazenamento
        return { ok: false };
    }
}

export function removeKey(key: string): void {
    try {
        localStorage.removeItem(key);
    } catch {
        // segue
    }
}

/**
 * Mantém só as N entradas mais recentes de um mapa por `updatedAt` (LRU).
 * Estava duplicado no progressService com um limite e uma ordem próprios.
 */
export function pruneToNewest<T extends { updatedAt: number }>(
    map: Record<string, T>,
    max: number
): Record<string, T> {
    const entries = Object.entries(map);
    if (entries.length <= max) return map;
    entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    return Object.fromEntries(entries.slice(0, max));
}
