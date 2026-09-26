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
// Teto SOMADO de todas as entradas do catálogo (T118). Com Filmes e Séries
// guardados também, o teto por entrada deixou de bastar: 'live' + 'vod' +
// 'series' + as categorias podiam passar de 4 MB — quase a quota inteira — e
// a próxima gravação de progresso ou favorito estourava, derrubando junto o
// cache do TMDB. Metade da quota fica pro catálogo; a outra metade é do resto
// do app.
const MAX_TOTAL_BYTES = 2_500 * 1024;

export type CatalogKind = 'live' | 'vod' | 'series' | 'live-cats' | 'vod-cats' | 'series-cats';

const TODOS_OS_TIPOS: readonly CatalogKind[] = ['live', 'vod', 'series', 'live-cats', 'vod-cats', 'series-cats'];
// A TV ao vivo é a razão de o cache existir (é a tela do boot): Filmes e
// Séries usam o que SOBRA do teto somado e nunca tiram espaço dela.
const PRIORITARIOS: readonly CatalogKind[] = ['live', 'live-cats'];
// Listas que já foram recusadas por não caber. O api.ts devolve o MESMO array
// por 5 min, e o catálogo de filmes grande — justamente o que não cabe —
// repetia a medição e a serialização a cada visita a Filmes só pra ouvir "não
// cabe" de novo, com a grade esperando atrás. Lista nova (fetch novo) tenta de
// novo; a velha sai daqui sozinha junto com o array.
const naoCouberam = new WeakSet<object>();

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
    if (naoCouberam.has(items)) {
        dropCatalog(kind);
        return false;
    }

    const agora = Date.now();
    const chave = key(kind);
    const chaveAt = keyAt(kind);
    const espaco = espacoDoCatalogo(kind, [chave, chaveAt]);
    // O limite já desconta o que não pode sair: um catálogo de filmes que não
    // cabe é descoberto no primeiro pedaço que passa, não depois de
    // serializar 40 mil títulos.
    const limite = Math.min(MAX_BYTES, MAX_TOTAL_BYTES - espaco.fixo)
        - (chave.length + chaveAt.length + String(agora).length) * 2;
    const json = serializar(agora, items, trim, limite);
    // INTEIRA ou nada: meia lista de canais é pior que lista nenhuma — o
    // usuário procura um canal que existe, não acha, e conclui que sumiu.
    if (json === null) {
        naoCouberam.add(items);
        dropCatalog(kind);
        return false;
    }

    // Abre espaço no teto somado, do descartável pro menos descartável
    const custo = bytesDe(chave, json) + bytesDe(chaveAt, String(agora));
    let ocupado = espaco.fixo + espaco.removiveis.reduce((soma, r) => soma + r.bytes, 0);
    for (const removivel of espaco.removiveis) {
        if (ocupado + custo <= MAX_TOTAL_BYTES) break;
        // Entrada e carimbo saem JUNTOS: o carimbo órfão faria a próxima
        // gravação daquele tipo ser pulada por "ainda é recente"
        removeKey(removivel.chave);
        removeKey(`${removivel.chave}_at`);
        ocupado -= removivel.bytes;
    }

    // `writeRaw` com a string que já existe: `writeJson` serializaria a mesma
    // lista uma segunda vez, e são centenas de KB.
    const gravou = writeRaw(chave, json).ok;
    if (gravou) writeRaw(chaveAt, String(agora));
    return gravou;
}

/** Bytes que uma chave ocupa na quota (UTF-16: 2 por unidade, chave + valor). */
function bytesDe(chave: string, valor: string): number {
    return (chave.length + valor.length) * 2;
}

/**
 * O que as OUTRAS entradas do catálogo ocupam, separado entre o que pode sair
 * pra dar lugar a `kind` e o que não pode.
 *
 * `removiveis` vem em ordem de sacrifício: primeiro o catálogo de OUTRA
 * playlist (ninguém está olhando pra ele agora), depois — só se
 * `kind` for da TV ao vivo — Filmes e Séries da playlist ativa.
 */
function espacoDoCatalogo(kind: CatalogKind, proprias: string[]): {
    fixo: number;
    removiveis: Array<{ chave: string; bytes: number }>;
} {
    const doContextoAtivo = new Set<string>();
    const secundariasAtivas = new Set<string>();
    for (const tipo of TODOS_OS_TIPOS) {
        doContextoAtivo.add(key(tipo));
        doContextoAtivo.add(keyAt(tipo));
        if (PRIORITARIOS.indexOf(tipo) === -1) {
            secundariasAtivas.add(key(tipo));
            secundariasAtivas.add(keyAt(tipo));
        }
    }
    const prioritario = PRIORITARIOS.indexOf(kind) !== -1;
    let fixo = 0;
    // Agrupado pela chave da entrada: o `_at` conta (e sai) junto com ela
    const alheias = new Map<string, number>();
    const secundarias = new Map<string, number>();
    const somar = (grupo: Map<string, number>, nome: string, bytes: number) => {
        const entrada = nome.slice(-3) === '_at' ? nome.slice(0, -3) : nome;
        grupo.set(entrada, (grupo.get(entrada) || 0) + bytes);
    };
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const nome = localStorage.key(i);
            if (!nome || !nome.startsWith(BASE_KEY) || proprias.indexOf(nome) !== -1) continue;
            const bytes = bytesDe(nome, localStorage.getItem(nome) ?? '');
            if (!doContextoAtivo.has(nome)) somar(alheias, nome, bytes);
            else if (prioritario && secundariasAtivas.has(nome)) somar(secundarias, nome, bytes);
            else fixo += bytes;
        }
    } catch {
        // Sem como medir: o teto por entrada continua valendo
    }
    const removiveis: Array<{ chave: string; bytes: number }> = [];
    alheias.forEach((bytes, chave) => removiveis.push({ chave, bytes }));
    secundarias.forEach((bytes, chave) => removiveis.push({ chave, bytes }));
    return { fixo, removiveis };
}

/**
 * Serializa `{ at, items }` item a item, podando no caminho, e desiste (null)
 * assim que passa de `limite` bytes. Gera o mesmo JSON que um
 * `JSON.stringify` da entrada inteira geraria.
 */
function serializar<T, S>(agora: number, items: T[], trim: (item: T) => S, limite: number): string | null {
    const cabecalho = `{"at":${agora},"items":[`;
    let bytes = (cabecalho.length + 2) * 2;
    if (bytes > limite) return null;
    const partes: string[] = [];
    for (const item of items) {
        const parte = JSON.stringify(trim(item));
        bytes += (parte.length + 1) * 2;
        if (bytes > limite) return null;
        partes.push(parte);
    }
    return `${cabecalho}${partes.join(',')}]}`;
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

/** O que sobra de um filme depois da poda — NÃO é um VODStream completo. */
export type CachedVodStream = ReturnType<typeof trimVod>;

// Grade de Filmes: capa, nome, nota (exibida e 5-based pra ordenar/filtrar),
// categoria, `added` (ordenação "Recentes" e selo NOVO), `release_date`
// (filtro de década) e `container_extension`, sem o qual o Play não monta a URL.
export function trimVod(stream: {
    num: number; name: string; stream_id: number; stream_icon: string; category_id: string;
    rating: string; rating_5based: number; added: string; container_extension: string;
    release_date?: string; tmdb_id?: string;
}) {
    return {
        num: stream.num,
        name: stream.name,
        stream_id: stream.stream_id,
        stream_icon: stream.stream_icon,
        category_id: stream.category_id,
        rating: stream.rating,
        rating_5based: stream.rating_5based,
        added: stream.added,
        container_extension: stream.container_extension,
        release_date: stream.release_date || '',
        tmdb_id: stream.tmdb_id || '',
    };
}

/** O que sobra de uma série depois da poda — NÃO é um Series completo. */
export type CachedSeries = ReturnType<typeof trimSeries>;

// Grade de Séries: a capa é o `cover` (série não tem stream_icon) e o
// `last_modified` faz o papel do `added` — ordenação e selo de novidade.
export function trimSeries(series: {
    num: number; name: string; series_id: number; cover: string; category_id: string;
    rating: string; rating_5based: number; last_modified: string;
    release_date?: string; tmdb_id?: string;
}) {
    return {
        num: series.num,
        name: series.name,
        series_id: series.series_id,
        cover: series.cover,
        category_id: series.category_id,
        rating: series.rating,
        rating_5based: series.rating_5based,
        last_modified: series.last_modified,
        release_date: series.release_date || '',
        tmdb_id: series.tmdb_id || '',
    };
}
