// Cache do TMDB: o que vai pro localStorage, quanto, e quando.
//
// Toda a defesa de memória do tmdb.ts era convenção escrita em comentário. E
// ela já falhou de verdade uma vez: o código antigo gravava `{ ...data }`, a
// resposta INTEIRA (production_companies, idiomas, o array de vídeos todo),
// e 120 fichas passavam de 2 MB numa quota de ~5 MB — até o `pruneCaches`
// derrubar as quatro lojas. Um campo a mais na projeção, ou uma poda que
// para de podar, não dá erro nenhum: aparece meses depois, na TV de alguém.
//
// Os testes passam pela API PÚBLICA de verdade (fetchMovieDetails,
// fetchSeriesDetails, fetchColecao, searchMovieByName, searchSeriesByName)
// com um fetch falso, e
// olham o que ficou no localStorage — que é o que importa. Nada de exportar
// função interna só pra testar.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFakeStorage, type FakeStorage } from '../testing/fakeStorage';

const CHAVE_FILMES = 'tmdb_movie_details_v2';
const CHAVE_SERIES = 'tmdb_series_details_v2';
const CHAVE_SAGAS = 'tmdb_collection';
const CHAVE_BUSCA_FILMES = 'tmdb_movie_search';
const CHAVE_BUSCA_SERIES = 'tmdb_series_search';
const DEBOUNCE_MS = 1500;
const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
const INICIO = new Date(2026, 8, 15, 12, 0, 0).getTime();

/** Texto que só existe nos campos que NÃO podem ir pro cache. */
const LIXO = 'LIXO_QUE_NAO_PODE_IR_PRO_CACHE';

type Tmdb = typeof import('./tmdb');

let fake: FakeStorage;
let fetchFalso: ReturnType<typeof vi.fn>;
let respostas: Map<string, unknown>;

/** Carrega o tmdb.ts do zero: o cache em memória é estado de módulo. */
async function carregarTmdb(): Promise<Tmdb> {
    vi.resetModules();
    return import('./tmdb');
}

function lerLoja(chave: string): Record<string, { data: unknown; timestamp: number }> {
    const cru = fake.store.get(chave);
    return cru ? JSON.parse(cru) : {};
}

/** Espera o debounce de gravação e confere que não sobrou timer armado. */
function esvaziarGravacao(): void {
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(vi.getTimerCount()).toBe(0);
}

// ---- respostas cruas do TMDB, com o que a API manda de verdade -------------

const video = (i: number, extra: Record<string, unknown> = {}) => ({
    key: `video${i}`, site: 'YouTube', type: 'Featurette', official: false,
    iso_639_1: 'en', name: `${LIXO} video ${i}`, published_at: '2020-01-01', ...extra,
});

const pessoa = (i: number) => ({
    id: i, name: `Ator ${i}`, character: `Papel ${i}`, profile_path: `/p${i}.jpg`,
    // campos que a faixa de elenco NÃO desenha
    known_for_department: LIXO, original_name: LIXO, popularity: 1, credit_id: LIXO, order: i,
});

function filmeCru(id: number): Record<string, unknown> {
    return {
        id,
        title: `Filme ${id}`,
        original_title: LIXO,
        overview: 'Sinopse.',
        tagline: LIXO,
        release_date: '2010-07-16',
        vote_average: 8.4,
        vote_count: 30000,
        popularity: 99,
        runtime: 148,
        budget: 160000000,
        revenue: 800000000,
        homepage: LIXO,
        status: 'Released',
        imdb_id: 'tt1375666',
        backdrop_path: '/fundo.jpg',
        poster_path: '/capa.jpg',
        genres: [{ id: 28, name: 'Ação' }],
        production_companies: [{ id: 1, name: LIXO, logo_path: LIXO, origin_country: 'US' }],
        production_countries: [{ iso_3166_1: 'US', name: LIXO }],
        spoken_languages: [{ iso_639_1: 'en', name: LIXO, english_name: LIXO }],
        belongs_to_collection: { id: 10, name: 'Saga', poster_path: '/saga.jpg', backdrop_path: LIXO, overview: LIXO },
        release_dates: { results: [
            { iso_3166_1: 'US', release_dates: [{ certification: 'PG-13', note: LIXO }] },
            { iso_3166_1: 'BR', release_dates: [{ certification: '14', note: LIXO }] },
        ] },
        external_ids: { imdb_id: 'tt1375666', facebook_id: LIXO, twitter_id: LIXO },
        credits: {
            cast: Array.from({ length: 50 }, (_, i) => pessoa(i + 1)),
            crew: Array.from({ length: 80 }, (_, i) => ({ id: 1000 + i, name: LIXO, job: LIXO })),
        },
        videos: { results: [
            ...Array.from({ length: 40 }, (_, i) => video(i)),
            video(900, { type: 'Trailer', official: true }),
            video(901, { type: 'Trailer', iso_639_1: 'pt' }),
        ] },
    };
}

function serieCrua(id: number): Record<string, unknown> {
    return {
        id,
        name: `Série ${id}`,
        original_name: LIXO,
        overview: 'Sinopse.',
        first_air_date: '2011-04-17',
        vote_average: 8.4,
        number_of_seasons: 8,
        number_of_episodes: 73,
        backdrop_path: '/fundo.jpg',
        poster_path: '/capa.jpg',
        genres: [{ id: 18, name: 'Drama' }],
        created_by: [{ id: 1, name: LIXO }],
        networks: [{ id: 49, name: LIXO, logo_path: LIXO }],
        production_companies: [{ id: 1, name: LIXO }],
        spoken_languages: [{ iso_639_1: 'en', name: LIXO }],
        seasons: Array.from({ length: 8 }, (_, i) => ({ id: i, name: LIXO, overview: LIXO, episode_count: 10 })),
        last_episode_to_air: { id: 1, name: LIXO, overview: LIXO },
        content_ratings: { results: [
            { iso_3166_1: 'US', rating: 'TV-MA' },
            { iso_3166_1: 'BR', rating: '16' },
        ] },
        external_ids: { imdb_id: 'tt0944947', tvdb_id: 121361 },
        credits: { cast: Array.from({ length: 30 }, (_, i) => pessoa(i + 1)), crew: [{ id: 1, name: LIXO }] },
        videos: { results: [video(1, { type: 'Trailer' })] },
    };
}

function sagaCrua(id: number): Record<string, unknown> {
    return {
        id,
        name: `Saga ${id}`,
        overview: LIXO,
        poster_path: '/saga.jpg',
        backdrop_path: LIXO,
        parts: [
            { id: 3, title: 'Terceiro', release_date: '2012-07-20', poster_path: '/3.jpg', overview: LIXO, backdrop_path: LIXO, vote_average: 7 },
            { id: 1, title: 'Primeiro', release_date: '2005-06-15', poster_path: '/1.jpg', overview: LIXO, backdrop_path: LIXO, vote_average: 8 },
            { id: 2, title: 'Segundo', release_date: '2008-07-18', poster_path: '/2.jpg', overview: LIXO, backdrop_path: LIXO, vote_average: 9 },
        ],
    };
}

function responder(corpo: unknown) {
    return { ok: true, json: async () => corpo };
}

beforeEach(() => {
    fake = installFakeStorage();
    localStorage.setItem('neostream_tmdb_api_key', 'chave-de-teste');
    vi.useFakeTimers();
    vi.setSystemTime(INICIO);
    respostas = new Map();
    fetchFalso = vi.fn(async (url: string) => {
        const caminho = new URL(url).pathname.replace(/^\/3(?=\/)/, '');
        if (respostas.has(caminho)) return responder(respostas.get(caminho));
        const filme = caminho.match(/^\/movie\/(\d+)$/);
        if (filme) return responder(filmeCru(Number(filme[1])));
        const serie = caminho.match(/^\/tv\/(\d+)$/);
        if (serie) return responder(serieCrua(Number(serie[1])));
        const saga = caminho.match(/^\/collection\/(\d+)$/);
        if (saga) return responder(sagaCrua(Number(saga[1])));
        return { ok: false, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchFalso);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('tmdb: a projeção é o que vai pro cache (a regressão dos 2 MB)', () => {
    it('filme: grava SÓ os campos da ficha, nunca a resposta crua', async () => {
        const tmdb = await carregarTmdb();
        const ficha = await tmdb.fetchMovieDetails('27205');
        esvaziarGravacao();

        const gravado = fake.store.get(CHAVE_FILMES) as string;
        expect(gravado).toBeDefined();
        // A chave da regressão histórica: nada do que foi descartado aparece
        expect(gravado).not.toContain(LIXO);
        for (const campo of ['production_companies', 'production_countries', 'spoken_languages',
            'videos', 'credits', 'release_dates', 'external_ids', 'crew', 'budget', 'tagline']) {
            expect(gravado).not.toContain(`"${campo}"`);
        }

        const entrada = lerLoja(CHAVE_FILMES)['27205'].data as Record<string, unknown>;
        // Lista FECHADA: um campo novo na projeção tem de ser decisão consciente
        expect(Object.keys(entrada).sort()).toEqual([
            'backdrop_path', 'belongs_to_collection', 'cast', 'certification', 'genres', 'id',
            'imdb_id', 'overview', 'poster_path', 'release_date', 'runtime', 'title',
            'trailerKey', 'vote_average',
        ]);
        expect(entrada.trailerKey).toBe('video901'); // o trailer em português ganha
        expect(entrada.certification).toBe('14'); // a classificação do Brasil ganha
        expect(entrada.cast).toHaveLength(12);
        expect(Object.keys((entrada.cast as object[])[0]).sort()).toEqual(['character', 'id', 'name', 'profile_path']);
        expect(entrada.belongs_to_collection).toEqual({ id: 10, name: 'Saga', poster_path: '/saga.jpg' });
        // O que volta pra tela é o mesmo que foi gravado
        expect(ficha).toEqual(entrada);
    });

    it('série: grava SÓ os campos da ficha (sem seasons, networks, created_by)', async () => {
        const tmdb = await carregarTmdb();
        const ficha = await tmdb.fetchSeriesDetails('1399');
        esvaziarGravacao();

        const gravado = fake.store.get(CHAVE_SERIES) as string;
        expect(gravado).not.toContain(LIXO);
        const entrada = lerLoja(CHAVE_SERIES)['1399'].data as Record<string, unknown>;
        expect(Object.keys(entrada).sort()).toEqual([
            'backdrop_path', 'cast', 'certification', 'first_air_date', 'genres', 'id', 'imdb_id',
            'name', 'number_of_seasons', 'overview', 'poster_path', 'trailerKey', 'vote_average',
        ]);
        expect(entrada.certification).toBe('16');
        expect(entrada.imdb_id).toBe('tt0944947');
        expect(entrada.cast).toHaveLength(12);
        // O que volta pra tela é o mesmo que foi gravado
        expect(ficha).toEqual(entrada);
    });

    it('saga: grava só id/título/ano/capa de cada filme, em ordem cronológica', async () => {
        const tmdb = await carregarTmdb();
        await tmdb.fetchColecao(10);
        esvaziarGravacao();

        const gravado = fake.store.get(CHAVE_SAGAS) as string;
        expect(gravado).not.toContain(LIXO);
        expect(lerLoja(CHAVE_SAGAS)['10'].data).toEqual({
            id: 10,
            name: 'Saga 10',
            parts: [
                { id: 1, title: 'Primeiro', year: '2005', poster_path: '/1.jpg' },
                { id: 2, title: 'Segundo', year: '2008', poster_path: '/2.jpg' },
                { id: 3, title: 'Terceiro', year: '2012', poster_path: '/3.jpg' },
            ],
        });
    });

    it('uma ficha projetada cabe num orçamento: 120 delas em menos de 400 KB', async () => {
        const tmdb = await carregarTmdb();
        for (let i = 1; i <= 120; i++) {
            vi.setSystemTime(INICIO + i);
            await tmdb.fetchMovieDetails(String(i));
        }
        esvaziarGravacao();
        // Crua, cada resposta de teste passa de 50 KB em UTF-16 — 120 delas
        // estouram a quota inteira. Projetada, a loja toda cabe em 400 KB.
        expect(JSON.stringify(filmeCru(1)).length * 2 * 120).toBeGreaterThan(5 * 1024 * 1024);
        const bytes = (fake.store.get(CHAVE_FILMES) as string).length * 2;
        expect(bytes).toBeLessThan(400 * 1024);
    });
});

describe('tmdb: teto de entradas por loja (pruneStore)', () => {
    // Filme e série: cada loja passa o seu próprio `max` (ou nenhum) no setCache
    it.each([
        ['fichas de filme', CHAVE_FILMES, (t: Tmdb, id: string) => t.fetchMovieDetails(id)],
        ['fichas de série', CHAVE_SERIES, (t: Tmdb, id: string) => t.fetchSeriesDetails(id)],
    ] as const)('130 %s viram 120 no disco — e ficam as MAIS RECENTES', async (_nome, chave, abrir) => {
        const tmdb = await carregarTmdb();
        for (let i = 1; i <= 130; i++) {
            vi.setSystemTime(INICIO + i * 1000);
            await abrir(tmdb, String(i));
        }
        esvaziarGravacao();

        const loja = lerLoja(chave);
        const ids = Object.keys(loja).map(Number).sort((a, b) => a - b);
        expect(ids).toHaveLength(120);
        expect(ids[0]).toBe(11); // as 10 mais antigas saíram
        expect(ids[ids.length - 1]).toBe(130);
    });

    it('a poda também vale em memória: a ficha podada volta a ir à rede', async () => {
        const tmdb = await carregarTmdb();
        for (let i = 1; i <= 121; i++) {
            vi.setSystemTime(INICIO + i * 1000);
            await tmdb.fetchMovieDetails(String(i));
        }
        expect(fetchFalso).toHaveBeenCalledTimes(121);
        await tmdb.fetchMovieDetails('121'); // ficou: vem do cache
        expect(fetchFalso).toHaveBeenCalledTimes(121);
        await tmdb.fetchMovieDetails('1'); // foi podada: rede de novo
        expect(fetchFalso).toHaveBeenCalledTimes(122);
    });

    it('sagas têm teto PRÓPRIO, menor: 35 viram 30', async () => {
        const tmdb = await carregarTmdb();
        for (let i = 1; i <= 35; i++) {
            vi.setSystemTime(INICIO + i * 1000);
            await tmdb.fetchColecao(i);
        }
        esvaziarGravacao();

        const ids = Object.keys(lerLoja(CHAVE_SAGAS)).map(Number).sort((a, b) => a - b);
        expect(ids).toHaveLength(30);
        expect(ids[0]).toBe(6);
    });
});

describe('tmdb: gravação agrupada (debounce)', () => {
    it('dez fichas seguidas = UMA gravação, só depois do debounce, e o timer é desarmado', async () => {
        const tmdb = await carregarTmdb();
        const gravar = vi.spyOn(localStorage, 'setItem');

        for (let i = 1; i <= 10; i++) {
            await tmdb.fetchMovieDetails(String(i));
            vi.advanceTimersByTime(100);
        }
        const gravacoesDaLoja = () => gravar.mock.calls.filter(([chave]) => chave === CHAVE_FILMES).length;
        expect(gravacoesDaLoja()).toBe(0);
        expect(vi.getTimerCount()).toBe(1); // um timer só, não um por ficha

        // A última ficha abriu há 100 ms: o disco só é tocado DEBOUNCE_MS
        // depois dela — nem 1 ms antes
        vi.advanceTimersByTime(DEBOUNCE_MS - 100 - 1);
        expect(gravacoesDaLoja()).toBe(0);
        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(1);
        expect(gravacoesDaLoja()).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
        expect(Object.keys(lerLoja(CHAVE_FILMES))).toHaveLength(10);
    });
});

describe('tmdb: validade de 7 dias', () => {
    it('ficha com mais de 7 dias no disco vai à rede de novo — e sai do disco na próxima gravação', async () => {
        const QUASE_SETE_DIAS = SETE_DIAS_MS - 60 * 1000; // ainda vale: faltam 60 s
        fake.store.set(CHAVE_FILMES, JSON.stringify({
            velha: { data: { title: 'Velha' }, timestamp: INICIO - SETE_DIAS_MS - 1 },
            nova: { data: { title: 'Nova', genres: [] }, timestamp: INICIO - QUASE_SETE_DIAS },
        }));
        const tmdb = await carregarTmdb();

        expect((await tmdb.fetchMovieDetails('nova'))?.title).toBe('Nova');
        expect(fetchFalso).not.toHaveBeenCalled();

        respostas.set('/movie/velha', filmeCru(1));
        expect((await tmdb.fetchMovieDetails('velha'))?.title).toBe('Filme 1');
        expect(fetchFalso).toHaveBeenCalledTimes(1);
        esvaziarGravacao(); // a gravação deste módulo não pode cair em cima do próximo

        // Uma entrada vencida que não foi reaberta também não sobrevive — e a
        // que ainda está no prazo continua no disco
        fake.store.set(CHAVE_FILMES, JSON.stringify({
            vencida: { data: { title: 'X' }, timestamp: INICIO - SETE_DIAS_MS - 1 },
            quase: { data: { title: 'Y' }, timestamp: INICIO - QUASE_SETE_DIAS },
        }));
        const outra = await carregarTmdb();
        await outra.fetchMovieDetails('42');
        esvaziarGravacao();
        expect(Object.keys(lerLoja(CHAVE_FILMES)).sort()).toEqual(['42', 'quase']);
    });
});

describe('tmdb: o cache sobrevive a reabrir o app', () => {
    it('as cinco lojas voltam do disco: a 2ª visita depois de reabrir não vai à rede', async () => {
        respostas.set('/search/movie', { results: [{ id: 27205, title: 'A Origem' }] });
        respostas.set('/search/tv', { results: [{ id: 1399, name: 'Game of Thrones' }] });
        const primeira = await carregarTmdb();
        const antes = [
            await primeira.searchMovieByName('A Origem (2010)'), // busca de filme + ficha de filme
            await primeira.searchSeriesByName('Game of Thrones'), // busca de série + ficha de série
            await primeira.fetchColecao(10), // saga
        ];
        expect(antes.every(Boolean)).toBe(true);
        expect(fetchFalso).toHaveBeenCalledTimes(5);
        esvaziarGravacao();

        // App reaberto: a memória do módulo zera, só o disco sobrou. Cada loja
        // tem de ser relida no carregamento — não só a de fichas de filme
        const segunda = await carregarTmdb();
        const depois = [
            await segunda.searchMovieByName('A Origem (2010)'),
            await segunda.searchSeriesByName('Game of Thrones'),
            await segunda.fetchColecao(10),
        ];
        expect(fetchFalso).toHaveBeenCalledTimes(5);
        expect(depois).toEqual(antes);
    });
});

describe('tmdb: faxina e quota', () => {
    it('ao carregar, apaga as lojas da versão antiga (a resposta crua de 2-3 MB)', async () => {
        fake.store.set('tmdb_movie_details', 'x'.repeat(1000));
        fake.store.set('tmdb_series_details', 'x'.repeat(1000));
        fake.store.set(CHAVE_FILMES, '{}');
        fake.store.set(CHAVE_SERIES, '{}');
        await carregarTmdb();
        expect(fake.store.has('tmdb_movie_details')).toBe(false);
        expect(fake.store.has('tmdb_series_details')).toBe(false);
        // a faxina é só da versão antiga: as lojas _v2 ficam
        expect(fake.store.get(CHAVE_FILMES)).toBe('{}');
        expect(fake.store.get(CHAVE_SERIES)).toBe('{}');
    });

    it('quota cheia: a ficha abre mesmo assim, nada lança e nada de ninguém é apagado', async () => {
        fake = installFakeStorage(2000);
        localStorage.setItem('neostream_tmdb_api_key', 'chave-de-teste');
        localStorage.setItem('neostream_favorites', 'f'.repeat(300));
        const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const tmdb = await carregarTmdb();

        const ficha = await tmdb.fetchMovieDetails('27205');
        expect(ficha?.title).toBe('Filme 27205');
        expect(() => esvaziarGravacao()).not.toThrow();

        expect(fake.store.has(CHAVE_FILMES)).toBe(false);
        expect(fake.store.get('neostream_favorites')).toBe('f'.repeat(300));
        expect(aviso).toHaveBeenCalled();
        // em memória continua valendo: reabrir não vai à rede
        await tmdb.fetchMovieDetails('27205');
        expect(fetchFalso).toHaveBeenCalledTimes(1);
    });
});

describe('tmdb: busca por nome', () => {
    // O formato da CHAVE (normalizeSearchKey) fica de fora de propósito: o
    // contrato aqui é o que vai no VALOR — só o id, ou '' para "não achei".
    const BUSCAS = [
        ['filme', '/search/movie', CHAVE_BUSCA_FILMES, 'Filme 27205',
            async (t: Tmdb, nome: string, ano?: string) => (await t.searchMovieByName(nome, ano))?.title],
        ['série', '/search/tv', CHAVE_BUSCA_SERIES, 'Série 27205',
            async (t: Tmdb, nome: string, ano?: string) => (await t.searchSeriesByName(nome, ano))?.name],
    ] as const;

    it.each(BUSCAS)('%s: "não achei" também fica em cache — a mesma busca não volta à rede', async (_tipo, rota, chave, _titulo, buscar) => {
        respostas.set(rota, { results: [] });
        const tmdb = await carregarTmdb();

        expect(await buscar(tmdb, 'Titulo Que Nao Existe', '1999')).toBeUndefined();
        expect(await buscar(tmdb, 'Titulo Que Nao Existe', '1999')).toBeUndefined();
        expect(fetchFalso).toHaveBeenCalledTimes(1);

        esvaziarGravacao();
        expect(Object.values(lerLoja(chave))).toEqual([{ data: '', timestamp: INICIO }]);
    });

    it.each(BUSCAS)('%s: achou — guarda só o id e reaproveita a ficha já em cache', async (_tipo, rota, chave, titulo, buscar) => {
        respostas.set(rota, { results: [{ id: 27205, title: 'A Origem', name: 'A Origem', overview: LIXO }] });
        const tmdb = await carregarTmdb();

        expect(await buscar(tmdb, 'A Origem (2010)')).toBe(titulo);
        expect(fetchFalso).toHaveBeenCalledTimes(2); // busca + ficha
        expect(await buscar(tmdb, 'A Origem (2010)')).toBe(titulo);
        expect(fetchFalso).toHaveBeenCalledTimes(2);

        esvaziarGravacao();
        expect(fake.store.get(chave)).not.toContain(LIXO);
        expect(Object.values(lerLoja(chave)).map(entrada => entrada.data)).toEqual(['27205']);
    });

    it('sem chave TMDB não vai à rede', async () => {
        localStorage.removeItem('neostream_tmdb_api_key');
        const tmdb = await carregarTmdb();
        expect(await tmdb.searchMovieByName('Qualquer')).toBeNull();
        expect(await tmdb.fetchMovieDetails('1')).toBeNull();
        expect(fetchFalso).not.toHaveBeenCalled();
    });
});
