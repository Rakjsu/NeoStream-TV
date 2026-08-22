// Cruzamento entre um título do TMDB e o catálogo do PROVEDOR (itens 29 e 34).
//
// É o coração dos dois itens: mostrar "a saga tem 8 filmes" ou "este ator fez
// 40 filmes" não serve de nada numa TV — o que interessa é quais deles o
// usuário PODE assistir agora, na lista dele. Sem esse cruzamento, os dois
// recursos viram uma vitrine de coisas que não abrem.
//
// Duas passadas, nesta ordem:
//  1. `tmdb_id` — o provedor manda esse campo e ele é match EXATO. Ganha sempre.
//  2. nome normalizado — para o resto, que é a maioria: poucos painéis
//     preenchem tmdb_id em todo o catálogo.
//
// Módulo PURO: sem DOM, sem rede, sem armazenamento.

import { normalizeSearch } from './catalogExtras';
import { versionBaseName } from './vodVariants';

/** O mínimo que um item do catálogo precisa ter pra ser cruzado. */
export interface ItemDoCatalogo {
    stream_id: number | string;
    name: string;
    tmdb_id?: string | number;
}

/** O mínimo que um título do TMDB precisa ter. */
export interface TituloTmdb {
    id: number;
    title: string;
    /** Ano de lançamento, quando o TMDB manda (`release_date`) */
    year?: string | number;
}

export interface IndiceDoCatalogo<T extends ItemDoCatalogo> {
    porTmdbId: Map<string, T>;
    porNomeEAno: Map<string, T>;
    porNome: Map<string, T>;
}

/**
 * Nome sem tags E SEM ANO, mais o ano à parte.
 *
 * `versionBaseName` devolve "batman|1989" de propósito — foi o conserto que
 * impediu três Batman diferentes de virarem um card só. Só que o TMDB manda o
 * título limpo ("Batman") e o ano num campo separado: usar a chave dela crua
 * faria o cruzamento falhar em todo título que o provedor nomeia com o ano,
 * que é a maioria. Aqui a chave é quebrada nas duas partes.
 */
function baseEAno(nome: string): { base: string; ano: string } {
    const [base, ano = ''] = versionBaseName(nome || '').split('|');
    return { base: normalizeSearch(base), ano };
}

/**
 * Índice para consulta O(1). Construir uma vez por catálogo e reusar: as telas
 * que consomem isto cruzam dezenas de títulos seguidos, e varrer milhares de
 * itens por consulta travaria a TV.
 *
 * Quando dois itens disputam a mesma chave, o PRIMEIRO vence — a lista do
 * provedor costuma trazer a melhor versão antes, e trocar o vencedor a cada
 * duplicata faria o resultado depender da ordem de varredura.
 */
export function indexarCatalogo<T extends ItemDoCatalogo>(itens: readonly T[]): IndiceDoCatalogo<T> {
    const porTmdbId = new Map<string, T>();
    const porNomeEAno = new Map<string, T>();
    const porNome = new Map<string, T>();
    for (const item of itens) {
        const tmdbId = item.tmdb_id != null ? String(item.tmdb_id).trim() : '';
        if (tmdbId && tmdbId !== '0' && !porTmdbId.has(tmdbId)) porTmdbId.set(tmdbId, item);

        const { base, ano } = baseEAno(item.name || '');
        if (!base) continue;
        if (ano && !porNomeEAno.has(`${base}|${ano}`)) porNomeEAno.set(`${base}|${ano}`, item);
        if (!porNome.has(base)) porNome.set(base, item);
    }
    return { porTmdbId, porNomeEAno, porNome };
}

/**
 * O item do catálogo que corresponde a este título do TMDB, se houver.
 *
 * Ordem das tentativas, da mais forte pra mais fraca:
 *  1. `tmdb_id` — match exato; ganha sempre.
 *  2. nome + ano — é o que separa refilmagem de original.
 *  3. nome só — chute honesto, e o melhor que dá pra fazer quando nem o
 *     provedor nem o TMDB dão o ano.
 */
export function acharNoCatalogo<T extends ItemDoCatalogo>(
    indice: IndiceDoCatalogo<T>,
    titulo: TituloTmdb
): T | null {
    const porId = indice.porTmdbId.get(String(titulo.id));
    if (porId) return porId;

    const { base } = baseEAno(titulo.title);
    if (!base) return null;

    const ano = titulo.year != null ? String(titulo.year).slice(0, 4) : '';
    if (ano) {
        const comAno = indice.porNomeEAno.get(`${base}|${ano}`);
        if (comAno) return comAno;
    }
    return indice.porNome.get(base) || null;
}

/**
 * Cruza uma lista do TMDB com o catálogo, preservando a ORDEM do TMDB (numa
 * saga isso é a ordem cronológica, que é a que a pessoa espera ver) e
 * descartando repetidos por `stream_id` — duas entradas do TMDB podem cair no
 * mesmo item do provedor quando o nome é genérico.
 */
export function cruzarComCatalogo<T extends ItemDoCatalogo>(
    titulos: readonly TituloTmdb[],
    indice: IndiceDoCatalogo<T>,
    excluirStreamId?: string | number
): T[] {
    const vistos = new Set<string>();
    const excluir = excluirStreamId != null ? String(excluirStreamId) : null;
    const achados: T[] = [];
    for (const titulo of titulos) {
        const item = acharNoCatalogo(indice, titulo);
        if (!item) continue;
        const id = String(item.stream_id);
        if (id === excluir || vistos.has(id)) continue;
        vistos.add(id);
        achados.push(item);
    }
    return achados;
}
