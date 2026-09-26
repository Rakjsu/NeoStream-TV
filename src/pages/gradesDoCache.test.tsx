// @vitest-environment jsdom
//
// ⚡ Filmes e Séries pagavam o download inteiro do catálogo a cada visita (T118).
//
// A TV ao vivo já pintava a lista de ontem na hora (catalogCache, item 70) e
// trocava por baixo quando a nova chegava. Filmes e Séries — cujo catálogo
// costuma ser MAIOR que o de canais — ficavam no esqueleto de "carregando"
// até o provedor responder, toda vez. Os testes montam a página de verdade,
// seguram a resposta do provedor e olham o que está na tela nesse intervalo.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { api } from '../services/api';
import {
    readCatalog, writeCatalog, trimCategory, trimLive, trimVod, trimSeries,
} from '../services/catalogCache';
import { newEpisodes } from '../services/catalogExtras';
import { kidsFilter } from '../services/kidsFilter';
import { storage } from '../services/storage';
import type { VODStream, Series as SeriesType, Category } from '../types';
import { Movies } from './Movies';
import { Series } from './Series';

function filme(id: number, nome: string): VODStream {
    return {
        num: id, name: nome, stream_type: 'movie', stream_id: id, stream_icon: 'capa.jpg',
        container_extension: 'mp4', custom_sid: '', direct_source: '', added: '0', category_id: '1',
        rating: '', rating_5based: 0, backdrop_path: [], youtube_trailer: '', episode_run_time: '',
        cover: '', plot: 'Sinopse completa', cast: '', director: '', genre: '', release_date: '', tmdb_id: '',
    };
}

function serie(id: number, nome: string, lastModified = '0'): SeriesType {
    return {
        num: id, name: nome, series_id: id, cover: 'capa.jpg', plot: 'Sinopse completa', cast: '',
        director: '', genre: '', release_date: '', last_modified: lastModified, rating: '', rating_5based: 0,
        backdrop_path: [], youtube_trailer: '', episode_run_time: '', category_id: '1', tmdb_id: '',
    };
}

const categorias: Category[] = [{ category_id: '1', category_name: 'Geral', parent_id: 0 }];

// Semeia o cache com o item inteiro: o que se testa aqui é a PÁGINA ler o
// cache, não a poda (essa tem teste próprio em catalogCache.filmesESeries)
const inteiro = <T,>(item: T) => item;

/** Promessa que o TESTE resolve — a resposta do provedor "ainda vindo". */
function adiada<T>() {
    let resolver!: (valor: T) => void;
    let rejeitar!: (erro: Error) => void;
    const promessa = new Promise<T>((ok, falha) => { resolver = ok; rejeitar = falha; });
    return { promessa, resolver, rejeitar };
}

const titulos = (seletor: string) =>
    Array.from(document.querySelectorAll(seletor)).map(el => el.textContent || '');

beforeEach(() => {
    localStorage.clear();
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('Filmes — catálogo de ontem na tela enquanto o de hoje vem', () => {
    it('pinta o catálogo guardado ANTES de o provedor responder e troca quando ele responde', async () => {
        writeCatalog('vod', [filme(1, 'Filme de Ontem A'), filme(2, 'Filme de Ontem B')], inteiro);
        writeCatalog('vod-cats', categorias, trimCategory);
        const provedor = adiada<VODStream[]>();
        vi.spyOn(api, 'getVODStreams').mockReturnValue(provedor.promessa);
        vi.spyOn(api, 'getVodCategories').mockResolvedValue(categorias);

        render(<Movies />);

        // Com o provedor ainda calado, a grade já mostra o de ontem
        await waitFor(() => {
            expect(titulos('.movie-title')).toEqual(['Filme de Ontem A', 'Filme de Ontem B']);
        });
        expect(document.querySelector('.skeleton-card')).toBeNull();

        await act(async () => {
            provedor.resolver([filme(1, 'Filme de Hoje A'), filme(3, 'Filme de Hoje C')]);
        });
        await waitFor(() => {
            expect(titulos('.movie-title')).toEqual(['Filme de Hoje A', 'Filme de Hoje C']);
        });
    });

    it('sem cache, a primeira visita guarda o catálogo podado pra próxima', async () => {
        vi.spyOn(api, 'getVODStreams').mockResolvedValue([filme(1, 'Guardado')]);
        vi.spyOn(api, 'getVodCategories').mockResolvedValue(categorias);

        render(<Movies />);
        await waitFor(() => { expect(titulos('.movie-title')).toEqual(['Guardado']); });

        const guardado = readCatalog<Record<string, unknown>>('vod');
        expect(guardado).toHaveLength(1);
        expect(guardado?.[0].name).toBe('Guardado');
        expect(guardado?.[0].plot).toBeUndefined(); // podado
        expect(readCatalog('vod-cats')).toHaveLength(1);
    });

    it('com o cache na tela, o provedor fora do ar não troca a grade pela tela de erro', async () => {
        writeCatalog('vod', [filme(1, 'Filme de Ontem')], inteiro);
        writeCatalog('vod-cats', categorias, trimCategory);
        const provedor = adiada<VODStream[]>();
        vi.spyOn(api, 'getVODStreams').mockReturnValue(provedor.promessa);
        vi.spyOn(api, 'getVodCategories').mockResolvedValue(categorias);

        render(<Movies />);
        await waitFor(() => { expect(titulos('.movie-title')).toEqual(['Filme de Ontem']); });

        await act(async () => { provedor.rejeitar(new Error('Tempo esgotado.')); });
        expect(document.querySelector('.movies-error-container')).toBeNull();
        expect(titulos('.movie-title')).toEqual(['Filme de Ontem']);
    });
});

describe('Séries — catálogo de ontem na tela enquanto o de hoje vem', () => {
    it('pinta o catálogo guardado ANTES de o provedor responder e troca quando ele responde', async () => {
        writeCatalog('series', [serie(1, 'Série de Ontem')], inteiro);
        writeCatalog('series-cats', categorias, trimCategory);
        const provedor = adiada<SeriesType[]>();
        vi.spyOn(api, 'getSeries').mockReturnValue(provedor.promessa);
        vi.spyOn(api, 'getSeriesCategories').mockResolvedValue(categorias);

        render(<Series />);

        await waitFor(() => { expect(titulos('.series-title')).toEqual(['Série de Ontem']); });
        expect(document.querySelector('.skeleton-card')).toBeNull();

        await act(async () => { provedor.resolver([serie(1, 'Série de Hoje')]); });
        await waitFor(() => { expect(titulos('.series-title')).toEqual(['Série de Hoje']); });
        expect(readCatalog<Record<string, unknown>>('series')?.[0].name).toBe('Série de Ontem'); // recente: não regrava
    });

    it('sem cache, a primeira visita guarda o catálogo podado pra próxima', async () => {
        vi.spyOn(api, 'getSeries').mockResolvedValue([serie(1, 'Guardada')]);
        vi.spyOn(api, 'getSeriesCategories').mockResolvedValue(categorias);

        render(<Series />);
        await waitFor(() => { expect(titulos('.series-title')).toEqual(['Guardada']); });

        const guardado = readCatalog<Record<string, unknown>>('series');
        expect(guardado?.[0].name).toBe('Guardada');
        expect(guardado?.[0].plot).toBeUndefined();
        expect(readCatalog('series-cats')).toHaveLength(1);
    });

    it('o selo de episódio novo não nasce do last_modified de ontem', async () => {
        // Série recém-seguida: ainda sem baseline de "novos episódios"
        storage.addFavorite({ id: '5', type: 'series', title: 'Seguida' });
        writeCatalog('series', [serie(5, 'Seguida', '1726000000')], inteiro);
        writeCatalog('series-cats', categorias, trimCategory);
        const provedor = adiada<SeriesType[]>();
        vi.spyOn(api, 'getSeries').mockReturnValue(provedor.promessa);
        vi.spyOn(api, 'getSeriesCategories').mockResolvedValue(categorias);

        render(<Series />);
        await waitFor(() => { expect(titulos('.series-title')).toEqual(['Seguida']); });

        // Hoje o provedor mostra a série como sempre esteve — ninguém assistiu
        // nada, nenhum episódio novo foi visto pelo usuário antes disso
        await act(async () => { provedor.resolver([serie(5, 'Seguida', '1726500000')]); });
        await waitFor(() => { expect(localStorage.getItem('neostream_series_lastmod')).not.toBeNull(); });

        // A baseline é a da lista de HOJE: nada de selo "novo" inventado
        expect(newEpisodes.has('5', '1726500000')).toBe(false);
    });

    it('com o cache na tela, o provedor fora do ar não troca a grade pela tela de erro', async () => {
        writeCatalog('series', [serie(1, 'Série de Ontem')], inteiro);
        writeCatalog('series-cats', categorias, trimCategory);
        const provedor = adiada<SeriesType[]>();
        vi.spyOn(api, 'getSeries').mockReturnValue(provedor.promessa);
        vi.spyOn(api, 'getSeriesCategories').mockResolvedValue(categorias);

        render(<Series />);
        await waitFor(() => { expect(titulos('.series-title')).toEqual(['Série de Ontem']); });

        await act(async () => { provedor.rejeitar(new Error('Tempo esgotado.')); });
        expect(document.querySelector('.series-error-container')).toBeNull();
        expect(titulos('.series-title')).toEqual(['Série de Ontem']);
    });
});

// A ficha aberta sobre um item do cache mostra o item PODADO (sem sinopse,
// elenco, trailer). Quando a lista de hoje chega, a ficha tem que passar a
// mostrar o item completo — senão fica "Sem descrição disponível." até o
// usuário fechar e abrir de novo.
describe('ficha aberta sobre o catálogo de ontem', () => {
    const sinopse = () => document.querySelector('.modal-overview')?.textContent;

    it('Filmes: ganha a sinopse quando a lista de hoje chega', async () => {
        writeCatalog('vod', [filme(1, 'Filme Guardado')], trimVod);
        writeCatalog('vod-cats', categorias, trimCategory);
        const provedor = adiada<VODStream[]>();
        vi.spyOn(api, 'getVODStreams').mockReturnValue(provedor.promessa);
        vi.spyOn(api, 'getVodCategories').mockResolvedValue(categorias);

        render(<Movies />);
        await waitFor(() => { expect(titulos('.movie-title')).toEqual(['Filme Guardado']); });
        act(() => { (document.querySelector('.movie-card') as HTMLElement).click(); });
        await waitFor(() => { expect(sinopse()).toBe('Sem descrição disponível.'); });

        await act(async () => { provedor.resolver([filme(1, 'Filme Guardado')]); });
        await waitFor(() => { expect(sinopse()).toBe('Sinopse completa'); });
    });

    it('Séries: ganha a sinopse quando a lista de hoje chega', async () => {
        writeCatalog('series', [serie(1, 'Série Guardada')], trimSeries);
        writeCatalog('series-cats', categorias, trimCategory);
        const provedor = adiada<SeriesType[]>();
        vi.spyOn(api, 'getSeries').mockReturnValue(provedor.promessa);
        vi.spyOn(api, 'getSeriesCategories').mockResolvedValue(categorias);
        // A ficha de série busca as temporadas ao abrir
        vi.spyOn(api, 'getSeriesInfo').mockResolvedValue({
            seasons: {}, episodes: {}, info: serie(1, 'Série Guardada'),
        });

        render(<Series />);
        await waitFor(() => { expect(titulos('.series-title')).toEqual(['Série Guardada']); });
        act(() => { (document.querySelector('.series-card') as HTMLElement).click(); });
        await waitFor(() => { expect(sinopse()).toBe('Sem descrição disponível.'); });

        await act(async () => { provedor.resolver([serie(1, 'Série Guardada')]); });
        await waitFor(() => { expect(sinopse()).toBe('Sinopse completa'); });
    });
});

// Lista e categorias só servem JUNTAS (a página só pinta o cache com as duas).
// Uma sem a outra é peso morto no teto somado — e ocupa o espaço que o outro
// catálogo (Filmes ou Séries) poderia usar.
describe.each([
    {
        aba: 'Filmes', lista: 'vod', cats: 'vod-cats', seletor: '.movie-title',
        montar: () => render(<Movies />),
        responder: (itens: VODStream[] | SeriesType[], cats: Category[]) => {
            vi.spyOn(api, 'getVODStreams').mockResolvedValue(itens as VODStream[]);
            vi.spyOn(api, 'getVodCategories').mockResolvedValue(cats);
        },
        item: (nome: string) => filme(1, nome),
    },
    {
        aba: 'Séries', lista: 'series', cats: 'series-cats', seletor: '.series-title',
        montar: () => render(<Series />),
        responder: (itens: VODStream[] | SeriesType[], cats: Category[]) => {
            vi.spyOn(api, 'getSeries').mockResolvedValue(itens as SeriesType[]);
            vi.spyOn(api, 'getSeriesCategories').mockResolvedValue(cats);
        },
        item: (nome: string) => serie(1, nome),
    },
] as const)('$aba — lista e categorias andam juntas no cache', ({ lista, cats, seletor, montar, responder, item }) => {
    it('categorias que não cabem levam a lista junto', async () => {
        // A TV ao vivo ocupa ~1,3 MB do teto somado de 2,5 MB
        const canais = Array.from({ length: 600 }, (_, i) => ({
            num: i, name: `Canal ${i} ${'x'.repeat(1000)}`, stream_id: i, stream_icon: '',
            epg_channel_id: '', category_id: '1', tv_archive: 0,
        }));
        expect(writeCatalog('live', canais, trimLive)).toBe(true);
        // A lista é pequena e cabe; as categorias (~1,3 MB) não cabem mais
        const categoriasEnormes: Category[] = [{ category_id: '1', category_name: 'x'.repeat(650_000), parent_id: 0 }];
        responder([item('Cabe')] as VODStream[] | SeriesType[], categoriasEnormes);

        montar();
        await waitFor(() => { expect(titulos(seletor)).toEqual(['Cabe']); });

        expect(readCatalog(cats)).toBeNull();
        expect(readCatalog(lista)).toBeNull();
        expect(readCatalog('live')).toHaveLength(600);
    });

    it('lista que não cabe leva as categorias antigas junto', async () => {
        writeCatalog(cats, categorias, trimCategory);
        // Um título com ~1,6 MB: passa do teto POR ENTRADA sozinho
        const nomeEnorme = `Enorme ${'x'.repeat(800_000)}`;
        responder([item(nomeEnorme)] as VODStream[] | SeriesType[], categorias);

        montar();
        await waitFor(() => { expect(titulos(seletor)).toEqual([nomeEnorme]); });

        expect(readCatalog(lista)).toBeNull();
        expect(readCatalog(cats)).toBeNull();
    });
});

// O cache é por PLAYLIST, não por perfil: a lista guardada é a crua do
// provedor, gravada por quem estiver usando. No perfil Kids, o que sai do
// cache tem que passar pelo mesmo gate que a lista fresca — senão a grade de
// ontem mostra a categoria adulta até o provedor responder.
describe.each([
    {
        aba: 'Filmes', lista: 'vod', cats: 'vod-cats', seletor: '.movie-title',
        montar: () => render(<Movies />),
        segurar: () => {
            vi.spyOn(api, 'getVODStreams').mockReturnValue(new Promise<VODStream[]>(() => { /* ainda vindo */ }));
            vi.spyOn(api, 'getVodCategories').mockResolvedValue([]);
        },
        item: (id: number, nome: string, categoria: string) => ({ ...filme(id, nome), category_id: categoria }),
    },
    {
        aba: 'Séries', lista: 'series', cats: 'series-cats', seletor: '.series-title',
        montar: () => render(<Series />),
        segurar: () => {
            vi.spyOn(api, 'getSeries').mockReturnValue(new Promise<SeriesType[]>(() => { /* ainda vindo */ }));
            vi.spyOn(api, 'getSeriesCategories').mockResolvedValue([]);
        },
        item: (id: number, nome: string, categoria: string) => ({ ...serie(id, nome), category_id: categoria }),
    },
] as const)('$aba — perfil Kids com o catálogo de ontem', ({ lista, cats, seletor, montar, segurar, item }) => {
    it('a categoria adulta não aparece nem enquanto o provedor não responde', async () => {
        vi.spyOn(kidsFilter, 'isKidsActive').mockReturnValue(true);
        const categoriasMistas: Category[] = [
            { category_id: '1', category_name: 'Desenhos', parent_id: 0 },
            { category_id: '2', category_name: 'ADULTOS', parent_id: 0 },
        ];
        writeCatalog(lista, [item(1, 'Desenho Guardado', '1'), item(2, 'Adulto Guardado', '2')], inteiro);
        writeCatalog(cats, categoriasMistas, trimCategory);
        segurar();

        montar();
        await waitFor(() => { expect(titulos(seletor)).toEqual(['Desenho Guardado']); });
        expect(document.body.textContent).not.toContain('ADULTOS');
    });
});

// Execução: npx vitest run src/pages/gradesDoCache.test.tsx
