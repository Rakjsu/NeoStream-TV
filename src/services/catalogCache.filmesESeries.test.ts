// Catálogo guardado de Filmes e Séries (T118) — e o teto que isso exige.
//
// O cache de boot instantâneo só existia pra TV ao vivo: Filmes e Séries
// pagavam o download inteiro a cada visita. Estender pros três só é seguro com
// um teto SOMADO: uma entrada sozinha já podia ocupar 1,5 MB de uma quota de
// ~5 MB, e 'live' + 'vod' + 'series' + categorias passavam da metade dela —
// a próxima gravação de progresso ou favorito estourava e derrubava o TMDB.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFakeStorage, type FakeStorage } from '../testing/fakeStorage';
import {
    readCatalog, writeCatalog, trimLive, trimCategory, trimVod, trimSeries,
} from './catalogCache';

// Espelha as constantes do módulo: 2,5 MB somados, 1,5 MB por entrada
const TETO_SOMADO = 2_500 * 1024;

let armazenamento: FakeStorage;

beforeEach(() => {
    armazenamento = installFakeStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 25, 12, 0, 0));
});

afterEach(() => {
    vi.useRealTimers();
});

// ~2,2 KB por item serializado: o tamanho da lista é controlado pela contagem
const RECHEIO = 'x'.repeat(1000);

const canal = (id: number) => ({
    num: id, name: `Canal ${id} ${RECHEIO}`, stream_id: id, stream_icon: '', epg_channel_id: '',
    category_id: '1', tv_archive: 0,
});

const filme = (id: number, nome = `Filme ${id} ${RECHEIO}`) => ({
    num: id, name: nome, stream_id: id, stream_icon: `http://capa/${id}.jpg`, category_id: '7',
    rating: '7.5', rating_5based: 3.8, added: '1726000000', container_extension: 'mkv',
    release_date: '2019-05-01', tmdb_id: '550',
    // O que a poda tem que jogar fora
    plot: 'p'.repeat(4000), cast: 'c'.repeat(2000), director: 'Fulano', genre: 'Drama',
    backdrop_path: ['http://fundo/1.jpg'], youtube_trailer: 'abc', episode_run_time: '120',
    cover: '', custom_sid: '', direct_source: '', stream_type: 'movie',
});

const serie = (id: number, nome = `Serie ${id} ${RECHEIO}`) => ({
    num: id, name: nome, series_id: id, cover: `http://capa/s${id}.jpg`, category_id: '9',
    rating: '8', rating_5based: 4, last_modified: '1726100000', release_date: '2020-01-01', tmdb_id: '1399',
    plot: 'p'.repeat(4000), cast: 'c'.repeat(2000), director: '', genre: '',
    backdrop_path: [], youtube_trailer: '', episode_run_time: '50',
});

const lista = <T>(n: number, fazer: (i: number) => T) => Array.from({ length: n }, (_, i) => fazer(i + 1));

/** Bytes que TODAS as chaves do catálogo ocupam (a mesma conta da quota). */
function bytesDoCatalogo(): number {
    let total = 0;
    for (const [chave, valor] of armazenamento.store) {
        if (chave.startsWith('neostream_catalog_cache')) total += (chave.length + valor.length) * 2;
    }
    return total;
}

describe('catalogCache — Filmes e Séries', () => {
    it('a poda de filme guarda o que a grade e o Play usam e joga fora sinopse, elenco e fundo', () => {
        expect(writeCatalog('vod', [filme(1, 'Clube da Luta')], trimVod)).toBe(true);
        const guardado = readCatalog<Record<string, unknown>>('vod')?.[0];
        expect(guardado).toEqual({
            num: 1, name: 'Clube da Luta', stream_id: 1, stream_icon: 'http://capa/1.jpg', category_id: '7',
            rating: '7.5', rating_5based: 3.8, added: '1726000000', container_extension: 'mkv',
            release_date: '2019-05-01', tmdb_id: '550',
        });
    });

    it('a poda de série guarda a capa (cover) e o last_modified, e joga fora o resto', () => {
        expect(writeCatalog('series', [serie(3, 'Game of Thrones')], trimSeries)).toBe(true);
        const guardado = readCatalog<Record<string, unknown>>('series')?.[0];
        expect(guardado).toEqual({
            num: 3, name: 'Game of Thrones', series_id: 3, cover: 'http://capa/s3.jpg', category_id: '9',
            rating: '8', rating_5based: 4, last_modified: '1726100000', release_date: '2020-01-01', tmdb_id: '1399',
        });
    });
});

describe('catalogCache — teto somado (o risco de guardar as três abas)', () => {
    // O teto não depende da poda: aqui todo tipo usa a de canal, pra que o
    // que se mede seja só a conta de bytes
    it('Filmes não entram se passariam do teto somado — e a TV ao vivo fica intacta', () => {
        expect(writeCatalog('live', lista(600, canal), trimLive)).toBe(true); // ~1,3 MB
        // ~1,3 MB de filmes: cabe no teto POR ENTRADA, mas não no somado
        expect(writeCatalog('vod', lista(600, canal), trimLive)).toBe(false);
        expect(readCatalog('vod')).toBeNull();
        expect(readCatalog('live')).toHaveLength(600);
        expect(bytesDoCatalogo()).toBeLessThanOrEqual(TETO_SOMADO);
    });

    it('a TV ao vivo tem prioridade: abre espaço tirando Filmes/Séries da playlist ativa', () => {
        expect(writeCatalog('vod', lista(600, canal), trimLive)).toBe(true);
        expect(writeCatalog('live', lista(600, canal), trimLive)).toBe(true);
        expect(readCatalog('live')).toHaveLength(600);
        expect(readCatalog('vod')).toBeNull();
        // O carimbo sai junto: sozinho, ele faria a próxima gravação de
        // Filmes ser pulada por "ainda é recente"
        const restos = Array.from(armazenamento.store.keys()).filter(k => k.includes('_vod_'));
        expect(restos).toEqual([]);
        expect(bytesDoCatalogo()).toBeLessThanOrEqual(TETO_SOMADO);
    });

    it('o catálogo de OUTRA playlist sai antes do da playlist ativa', () => {
        const alheia = 'neostream_catalog_cache_live_outra-playlist';
        localStorage.setItem(alheia, JSON.stringify({ at: Date.now(), items: lista(550, canal).map(trimLive) }));
        expect(writeCatalog('vod', lista(300, canal), trimLive)).toBe(true); // ~0,65 MB
        expect(writeCatalog('live', lista(600, canal), trimLive)).toBe(true);

        expect(localStorage.getItem(alheia)).toBeNull();
        expect(readCatalog('vod')).toHaveLength(300);
        expect(readCatalog('live')).toHaveLength(600);
        expect(bytesDoCatalogo()).toBeLessThanOrEqual(TETO_SOMADO);
    });

    it('as seis entradas juntas nunca passam do teto somado', () => {
        const cats = lista(20, i => ({ category_id: String(i), category_name: `Cat ${i}` }));
        writeCatalog('live', lista(450, canal), trimLive);
        writeCatalog('live-cats', cats, trimCategory);
        writeCatalog('vod', lista(450, canal), trimLive);
        writeCatalog('vod-cats', cats, trimCategory);
        writeCatalog('series', lista(450, canal), trimLive);
        writeCatalog('series-cats', cats, trimCategory);

        expect(bytesDoCatalogo()).toBeLessThanOrEqual(TETO_SOMADO);
        // Quem entrou, entrou INTEIRO
        expect(readCatalog('live')).toHaveLength(450);
        expect(readCatalog('vod')).toHaveLength(450);
        expect(readCatalog('series')).toBeNull();
    });

    it('catálogo grande demais é recusado sem podar e serializar a lista inteira', () => {
        const enorme = lista(40_000, i => ({ ...canal(i), name: `Filme ${i}` }));
        const poda = vi.fn(trimLive);
        expect(writeCatalog('vod', enorme, poda)).toBe(false);
        expect(readCatalog('vod')).toBeNull();
        // Desiste no primeiro pedaço que passa do teto — 40 mil filmes na TV
        // custavam a poda e o stringify de todos só pra descobrir que não cabe
        expect(poda.mock.calls.length).toBeLessThan(enorme.length / 2);
    });

    it('a MESMA lista recusada não é medida de novo na visita seguinte', () => {
        // ~2,2 MB: passa do teto por entrada. O api.ts devolve o mesmo array
        // por 5 min, e cada visita a Filmes chama writeCatalog com ele
        const enorme = lista(1_000, canal);
        const poda = vi.fn(trimLive);
        expect(writeCatalog('vod', enorme, poda)).toBe(false);
        const naPrimeira = poda.mock.calls.length;
        expect(naPrimeira).toBeGreaterThan(0);

        expect(writeCatalog('vod', enorme, poda)).toBe(false);
        expect(poda.mock.calls.length).toBe(naPrimeira);

        // Fetch novo = array novo: esse é medido (e aqui cabe)
        expect(writeCatalog('vod', enorme.slice(0, 100), poda)).toBe(true);
        expect(readCatalog('vod')).toHaveLength(100);

        // E a recusa lembrada vale o mesmo que a medida: não deixa a versão
        // anterior pra trás, nem o carimbo dela
        vi.setSystemTime(Date.now() + 61 * 60 * 1000);
        expect(writeCatalog('vod', enorme, poda)).toBe(false);
        expect(readCatalog('vod')).toBeNull();
        expect(Array.from(armazenamento.store.keys()).filter(k => k.includes('_vod_'))).toEqual([]);
    });

    it('regravar o próprio catálogo não conta a versão antiga contra o teto somado', () => {
        expect(writeCatalog('live', lista(600, canal), trimLive)).toBe(true); // ~1,3 MB
        expect(writeCatalog('vod', lista(450, canal), trimLive)).toBe(true); // ~1,0 MB
        // Passada a janela de regravação, a lista de hoje — do mesmo tamanho —
        // SUBSTITUI a de ontem: somar as duas recusaria (e apagaria) o cache
        vi.setSystemTime(Date.now() + 61 * 60 * 1000);
        expect(writeCatalog('vod', lista(450, canal), trimLive)).toBe(true);
        expect(readCatalog('vod')).toHaveLength(450);
        expect(bytesDoCatalogo()).toBeLessThanOrEqual(TETO_SOMADO);
    });

    it('o teto somado conta a chave e o carimbo, não só o JSON — nem um byte além', () => {
        expect(writeCatalog('live', lista(600, canal), trimLive)).toBe(true); // ~1,3 MB
        const livre = TETO_SOMADO - bytesDoCatalogo();
        // Aqui quem manda é o teto SOMADO, não o de 1,5 MB por entrada
        expect(livre).toBeLessThan(1_500 * 1024);

        const chaveLive = Array.from(armazenamento.store.keys()).find(k => k.includes('_live_') && !k.endsWith('_at'));
        const chave = String(chaveLive).replace('_live_', '_vod_');
        const agora = Date.now();
        // Além do JSON, a quota paga o nome da chave, o da chave do carimbo e o carimbo
        const extras = (chave.length + `${chave}_at`.length + String(agora).length) * 2;
        // Um filme só, com o nome no tamanho exato pra entrada inteira custar `custo` bytes
        const vazio = JSON.stringify({ at: agora, items: [trimLive({ ...canal(1), name: '' })] }).length;
        const filmeQueCusta = (custo: number) =>
            [{ ...canal(1), name: 'x'.repeat((custo - extras) / 2 - vazio) }];

        // 2 bytes além do que sobra: o JSON sozinho cabe, com as chaves não
        expect(writeCatalog('vod', filmeQueCusta(livre + 2), trimLive)).toBe(false);
        expect(readCatalog('vod')).toBeNull();
        expect(bytesDoCatalogo()).toBeLessThanOrEqual(TETO_SOMADO);

        // 2 bytes aquém: entra, e o catálogo fecha colado no teto sem passar
        expect(writeCatalog('vod', filmeQueCusta(livre - 2), trimLive)).toBe(true);
        expect(readCatalog('vod')).toHaveLength(1);
        expect(bytesDoCatalogo()).toBe(TETO_SOMADO - 2);
    });
});

// Execução: npx vitest run src/services/catalogCache.filmesESeries.test.ts
