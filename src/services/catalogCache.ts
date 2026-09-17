// Boot instantâneo com catálogo em cache (item 70) — padrão stale-while-revalidate.
//
// O primeiro carregamento da TV ao Vivo baixa a lista inteira de canais do
// provedor: numa lista grande e num Wi-Fi de TV isso são vários segundos de
// tela de "carregando". A lista quase não muda de um dia pro outro, então dá
// pra mostrar a de ontem NA HORA e trocar por baixo quando a nova chegar.
//
// O que NÃO fazer aqui: guardar a resposta crua. Uma lista de 5 mil canais em
// JSON completo passa de 5 MB e estoura a quota de uma TV inteira sozinha.
// Por isso cada item é PODADO para os campos que a grade realmente usa, e há
// um teto de bytes por cima disso.

import { readJson, writeRaw, removeKey } from './safeStorage';
import { scopedKeyFor } from './profileScope';
import { playlistService } from './playlistService';

const BASE_KEY = 'neostream_catalog_cache';
// Um dia: o provedor pode acrescentar canais, mas ninguém liga a TV esperando
// que a lista de ontem esteja errada
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Teto por entrada. A quota de uma TV é ~5 MB no total e o app tem muito mais
// coisa pra guardar do que catálogo.
// 1,5 MB: uma lista de ~8 mil canais podados serializa em ~1,2 MB, e é
// justamente ela que faz o boot demorar 4-8s. Com 500 KB o cache nunca
// existia onde mais importava, e o app ainda pagava o custo de descobrir isso
// serializando tudo a cada visita.
const MAX_BYTES = 1_500 * 1024;
// A LiveTV remonta a cada visita; regravar o catálogo em toda uma delas é
// desperdício puro. Uma hora é folgado pro que a lista muda.
const REWRITE_AFTER_MS = 60 * 60 * 1000;

export type CatalogKind = 'live' | 'vod' | 'series' | 'live-cats' | 'vod-cats' | 'series-cats';

interface CacheEntry<T> {
    at: number;
    items: T[];
}

/**
 * A chave leva a PLAYLIST ativa: dois provedores têm catálogos diferentes e
 * misturá-los mostraria canais que não existem naquela conta.
 */
function key(kind: CatalogKind): string {
    const playlist = playlistService.getActiveId() || 'default';
    return scopedKeyFor(`${BASE_KEY}_${kind}_${playlist}`, 'default');
}

/**
 * Carimbo de idade numa chave PRÓPRIA, minúscula.
 *
 * A guarda de regravação lia a entrada inteira só pra olhar o `at` e jogava o
 * objeto fora na linha seguinte — ou seja, pra evitar reserializar ~1,2 MB ela
 * parseava ~1,2 MB, em toda visita à TV ao vivo. O carimbo continua dentro da
 * entrada (é o que o `readCatalog` usa pra vencer), mas quem só quer a data lê
 * daqui.
 *
 * Ele começa com o mesmo prefixo da entrada, então a poda por quota
 * (`pruneCaches`) e o `clearCatalogCache` levam os dois juntos.
 */
function keyAt(kind: CatalogKind): string {
    return `${key(kind)}_at`;
}

/** Lê o catálogo guardado, ou null se não há ou já venceu. */
export function readCatalog<T>(kind: CatalogKind): T[] | null {
    const entry = readJson<CacheEntry<T> | null>(key(kind), null);
    if (!entry || !Array.isArray(entry.items)) return null;
    if (Date.now() - entry.at > MAX_AGE_MS) {
        dropCatalog(kind);
        return null;
    }
    return entry.items;
}

/**
 * Guarda o catálogo, podando campo por campo e cortando pelo teto de bytes.
 * @param trim reduz cada item ao que a grade precisa
 */
export function writeCatalog<T, S>(kind: CatalogKind, items: T[], trim: (item: T) => S): boolean {
    if (!Array.isArray(items) || items.length === 0) return false;

    // Só regrava se o que está guardado já envelheceu. A LiveTV remonta a cada
    // visita, e reserializar centenas de KB toda vez custa caro numa TV — e
    // pior: uma gravação sob quota derruba TODO o cache do TMDB pra caber.
    // Só o carimbo — sem isto, a guarda que existe pra não serializar 1,2 MB
    // começava PARSEANDO 1,2 MB.
    const gravadoEm = readJson<number>(keyAt(kind), 0);
    if (gravadoEm > 0 && Date.now() - gravadoEm < REWRITE_AFTER_MS) return true;

    const agora = Date.now();
    const slim = items.map(trim);
    const json = JSON.stringify({ at: agora, items: slim } satisfies CacheEntry<S>);
    // INTEIRA ou nada: meia lista de canais é pior que lista nenhuma — o
    // usuário procura um canal que existe, não acha, e conclui que sumiu.
    if (json.length * 2 > MAX_BYTES) {
        dropCatalog(kind);
        return false;
    }

    // `writeRaw` com a string que já existe: `writeJson` serializaria a mesma
    // lista uma segunda vez, e são centenas de KB.
    const gravou = writeRaw(key(kind), json).ok;
    if (gravou) writeRaw(keyAt(kind), String(agora));
    return gravou;
}

/** Descarta uma entrada do catálogo guardado. */
export function dropCatalog(kind: CatalogKind): void {
    removeKey(key(kind));
    // O carimbo tem que ir junto: sozinho, ele faria a próxima gravação ser
    // pulada por "ainda é recente" — e aí não haveria catálogo nenhum.
    removeKey(keyAt(kind));
}

/** Apaga o catálogo guardado de todas as playlists (usado no reset). */
export function clearCatalogCache(): void {
    try {
        const doomed: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const name = localStorage.key(i);
            if (name && name.startsWith(BASE_KEY)) doomed.push(name);
        }
        doomed.forEach(removeKey);
    } catch {
        // sem drama
    }
}

// ---- Podas por tipo ----
// Só os campos que a grade e a navegação usam. O resto (plot, cast, backdrop)
// vem do fetch real, que chega logo atrás.

/** O que sobra de um canal depois da poda — NÃO é um LiveStream completo. */
export type CachedLiveStream = ReturnType<typeof trimLive>;

export function trimLive(stream: {
    num: number; name: string; stream_id: number; stream_icon: string;
    category_id: string; epg_channel_id: string; tv_archive: number;
}) {
    return {
        num: stream.num,
        name: stream.name,
        stream_id: stream.stream_id,
        stream_icon: stream.stream_icon,
        category_id: stream.category_id,
        epg_channel_id: stream.epg_channel_id,
        tv_archive: stream.tv_archive,
    };
}

export function trimCategory(category: { category_id: string; category_name: string }) {
    return { category_id: category.category_id, category_name: category.category_name };
}
