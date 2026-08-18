/**
 * Agrupador de variantes FHD/HD/SD (port do NeoStream desktop): "ESPN FHD",
 * "ESPN HD" e "ESPN SD" viram UM card na TV ao vivo — a melhor qualidade
 * representa o grupo e as demais aparecem como botões de qualidade na ficha.
 * Tudo PURO: nada de rede/estado, só o nome dos canais.
 */

export interface VariantChannel {
    stream_id: number | string;
    name: string;
}

const QUALITY_ORDER = ['4k', 'uhd', 'fhd', 'hd', 'sd'];

// Regexes pré-compiladas: com 10k canais isso roda dezenas de milhares de
// vezes por filtro — compilar dentro da função travava TVs antigas.
const QUALITY_REGEXES = QUALITY_ORDER.map(q => new RegExp(`(^|[^a-z0-9])${q}([^a-z0-9]|$)`));

/** Nota de qualidade pelo nome (menor = melhor); sem tag fica entre HD e SD. */
export function qualityRank(name: string): number {
    const lower = name.toLowerCase();
    for (let i = 0; i < QUALITY_REGEXES.length; i++) {
        if (QUALITY_REGEXES[i].test(lower)) return i;
    }
    return 3.5;
}

/** Nome sem as tags de qualidade/codec — é a chave que junta as variantes. */
export function variantBaseName(name: string): string {
    const base = name
        .replace(/\s*[[(](fhd|hd|sd|4k|uhd|h\.?26[456]|hevc|avc)[\])]/gi, '')
        .replace(/\s+(fhd|hd|sd|4k|uhd)\s*$/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    // Nome que É só a tag ("FHD") não vira grupo de tudo — fica sozinho.
    return base || name.trim().toLowerCase();
}

/** Rótulo curto da qualidade pro botão da ficha ("4K", "FHD", "HD", "SD"). */
export function qualityLabel(name: string): string {
    const match = /(^|[^a-z0-9])(4k|uhd|fhd|hd|sd)([^a-z0-9]|$)/i.exec(name);
    return match ? match[2].toUpperCase() : name.slice(0, 12);
}

/**
 * Agrupa preservando a ordem da lista (o grupo aparece onde a PRIMEIRA
 * variante apareceria); o representante é a melhor qualidade do grupo.
 * `variantsOf` só tem entradas pra grupos com 2+ variantes, chaveadas pelo
 * stream_id do representante.
 */
export function groupChannelVariants<T extends VariantChannel>(channels: T[]): { groups: T[]; variantsOf: Map<string, T[]> } {
    // Passada ÚNICA de variantBaseName por canal; Map preserva a ordem de
    // inserção, então iterar byBase.values() mantém a ordem da lista original.
    const byBase = new Map<string, T[]>();
    for (const channel of channels) {
        const base = variantBaseName(channel.name);
        const list = byBase.get(base);
        if (list) list.push(channel);
        else byBase.set(base, [channel]);
    }

    const groups: T[] = [];
    const variantsOf = new Map<string, T[]>();
    for (const list of byBase.values()) {
        if (list.length === 1) {
            groups.push(list[0]);
            continue;
        }
        // decorate-sort-undecorate: qualityRank 1x por item, não por comparação
        const sorted = list
            .map(channel => ({ channel, rank: qualityRank(channel.name) }))
            .sort((a, b) => a.rank - b.rank)
            .map(entry => entry.channel);
        groups.push(sorted[0]);
        variantsOf.set(String(sorted[0].stream_id), sorted);
    }
    return { groups, variantsOf };
}
