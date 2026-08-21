// Versões e tags de VOD (backlog itens 21 e 22): listas de IPTV repetem o
// mesmo filme como DUB/LEG/4K/H265. Agrupa numa ficha só e expõe as tags
// como chips de filtro. Tudo PURO — só o nome do item.

export type VodTag = 'DUB' | 'LEG' | '4K' | 'HD' | 'H265';

export interface VariantableItem {
    stream_id: number | string;
    name: string;
}

// Ordem de preferência do representante do grupo (melhor primeiro)
const QUALITY_SCORE: Array<{ re: RegExp; score: number }> = [
    { re: /(^|[^a-z0-9])4k([^a-z0-9]|$)/i, score: 0 },
    { re: /(^|[^a-z0-9])uhd([^a-z0-9]|$)/i, score: 0 },
    { re: /(^|[^a-z0-9])fhd([^a-z0-9]|$)/i, score: 1 },
    { re: /(^|[^a-z0-9])1080p?([^a-z0-9]|$)/i, score: 1 },
    { re: /(^|[^a-z0-9])hd([^a-z0-9]|$)/i, score: 2 },
    { re: /(^|[^a-z0-9])720p?([^a-z0-9]|$)/i, score: 2 },
    { re: /(^|[^a-z0-9])sd([^a-z0-9]|$)/i, score: 4 },
];

const TAG_PATTERNS: Array<{ tag: VodTag; re: RegExp }> = [
    { tag: 'DUB', re: /(^|[^a-z0-9])(dub|dublado|dublada)([^a-z0-9]|$)/i },
    { tag: 'LEG', re: /(^|[^a-z0-9])(leg|legendado|legendada|sub)([^a-z0-9]|$)/i },
    { tag: '4K', re: /(^|[^a-z0-9])(4k|uhd|2160p?)([^a-z0-9]|$)/i },
    { tag: 'HD', re: /(^|[^a-z0-9])(hd|fhd|1080p?|720p?)([^a-z0-9]|$)/i },
    { tag: 'H265', re: /(^|[^a-z0-9])(h\.?265|hevc)([^a-z0-9]|$)/i },
];

export const ALL_VOD_TAGS: VodTag[] = ['DUB', 'LEG', '4K', 'HD', 'H265'];

/** Tags presentes no nome do item. */
export function tagsOf(name: string): VodTag[] {
    const tags: VodTag[] = [];
    for (const { tag, re } of TAG_PATTERNS) {
        if (re.test(name)) tags.push(tag);
    }
    return tags;
}

export function hasTag(name: string, tag: VodTag): boolean {
    const pattern = TAG_PATTERNS.find(t => t.tag === tag);
    return pattern ? pattern.re.test(name) : false;
}

function qualityScore(name: string): number {
    for (const { re, score } of QUALITY_SCORE) {
        if (re.test(name)) return score;
    }
    return 3; // sem tag fica entre HD e SD
}

/**
 * Nome sem tags de qualidade/idioma/codec — chave que junta as versões.
 * O ANO PERMANECE na chave: sem ele, "Batman (1989)", "(2022)" e "(1966)"
 * virariam um card só e dois deles sumiriam do catálogo.
 */
export function versionBaseName(name: string): string {
    const year = /[[(]((?:19|20)\d{2})[\])]/.exec(name)?.[1] || '';
    const base = name
        .replace(/\s*[[(](dub|dublado|dublada|leg|legendado|legendada|sub|fhd|hd|sd|4k|uhd|h\.?26[456]|hevc|avc|2160p?|1080p?|720p?|480p?)[\])]/gi, ' ')
        .replace(/\s+(dub|dublado|dublada|leg|legendado|legendada|fhd|hd|sd|4k|uhd|2160p?|1080p?|720p?|480p?)\s*$/gi, '')
        .replace(/\s*[[(](19|20)\d{2}[\])]\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    const core = base || name.trim().toLowerCase();
    return year ? `${core}|${year}` : core;
}

/**
 * Agrupa versões do mesmo título preservando a ordem da lista; o
 * representante é a melhor qualidade. `versionsOf` só tem entradas pra
 * grupos com 2+ versões, chaveadas pelo stream_id do representante.
 */
export function groupVodVersions<T extends VariantableItem>(
    items: T[]
): { groups: T[]; versionsOf: Map<string, T[]> } {
    const byBase = new Map<string, T[]>();
    for (const item of items) {
        const base = versionBaseName(item.name);
        const list = byBase.get(base);
        if (list) list.push(item);
        else byBase.set(base, [item]);
    }

    const groups: T[] = [];
    const versionsOf = new Map<string, T[]>();
    for (const list of byBase.values()) {
        if (list.length === 1) {
            groups.push(list[0]);
            continue;
        }
        const sorted = list
            .map(item => ({ item, score: qualityScore(item.name) }))
            .sort((a, b) => a.score - b.score)
            .map(entry => entry.item);
        groups.push(sorted[0]);
        versionsOf.set(String(sorted[0].stream_id), sorted);
    }
    return { groups, versionsOf };
}

/**
 * Rótulo curto da versão pro botão da ficha ("4K DUB", "HD LEG"...).
 * Sem tags, cai num trecho do próprio nome — dois botões "Padrão"
 * idênticos não diriam ao usuário qual é qual.
 */
export function versionLabel(name: string): string {
    const tags = tagsOf(name).filter(t => t !== 'H265');
    if (tags.length > 0) return tags.join(' ');
    const trimmed = name.trim();
    return trimmed.length > 22 ? `${trimmed.slice(0, 20)}…` : trimmed;
}
