// @vitest-environment jsdom
//
// T135 — OK em "Assistir" de série podia não fazer NADA, e o erro morria no
// console.
//
// `buildEpisodeQueue` devolve null quando o painel manda get_series_info sem
// episódio (série recém-adicionada, temporada que o provedor tirou do ar, id
// que mudou) e lança quando a rede cai. Os seis chamadores tratavam os dois
// casos como "não faz nada": em Séries a ficha FECHAVA e a pessoa voltava pra
// grade sem nada acontecido; na Home, na Minha Lista, nos Favoritos e na busca
// global a ficha ficava imóvel; no Continuar Assistindo da Home o OK
// simplesmente não respondia. Numa TV não existe console.
//
// O teste monta as telas DE VERDADE; só a rede é de mentira (e o player da
// série, que só precisa dizer que abriu e saber fechar).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../services/tmdb', async (importOriginal) => {
    const original = await importOriginal<typeof import('../services/tmdb')>();
    return {
        ...original,
        searchMovieByName: vi.fn(async () => null),
        searchSeriesByName: vi.fn(async () => null),
        fetchSeriesDetails: vi.fn(async () => null),
        fetchMovieDetails: vi.fn(async () => null),
        fetchColecao: vi.fn(async () => null),
    };
});

// Único export do módulo que as telas usam
vi.mock('../components/SeriesQueuePlayer', () => ({
    SeriesQueuePlayer: ({ queue, onClose }: {
        queue: { seriesName: string; episodes: Array<{ season: number; episode: number }>; index: number };
        onClose: () => void;
    }) => (
        <div className="player-da-serie-de-teste">
            <span className="player-da-serie-nome">{queue.seriesName}</span>
            {/* Em que episódio a fila começou — o OK tem de tocar o PEDIDO */}
            <span className="player-da-serie-episodio">
                T{queue.episodes[queue.index].season}E{queue.episodes[queue.index].episode}
            </span>
            <button className="player-da-serie-fechar" onClick={onClose}>fechar</button>
        </div>
    ),
}));

import { installFakeStorage } from '../testing/fakeStorage';
import { api } from '../services/api';
import { storage } from '../services/storage';
import { progressService } from '../services/progressService';
import { clearSearchCatalogCache } from '../services/searchCatalog';
import { DURACAO_DO_AVISO_DE_SERIE_MS } from '../services/seriesPlayback';
import type { Series as SeriesType, SeriesInfo } from '../types';
import { Series } from './Series';
import { MyList } from './MyList';
import { Favorites } from './Favorites';
import { Home } from './Home';
import { GlobalSearch } from '../components/GlobalSearch';

/** Dispara uma tecla como a TV dispara (keyCode; o `key` vem vazio no Tizen). */
function tecla(keyCode: number): void {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '', keyCode, bubbles: true, cancelable: true }));
    });
}
const BAIXO = 40;
const OK = 13;

function serie(id: number, nome: string): SeriesType {
    return {
        num: id, name: nome, series_id: id, cover: 'capa.jpg', plot: '', cast: '',
        director: '', genre: '', release_date: '', last_modified: '0', rating: '',
        rating_5based: 0, backdrop_path: [], youtube_trailer: '', episode_run_time: '',
        category_id: '1', tmdb_id: '',
    };
}

const SEM_EPISODIOS = { seasons: {}, episodes: {}, info: {} } as unknown as SeriesInfo;
const COM_EPISODIO = {
    seasons: {},
    info: {},
    episodes: { '1': [{ id: '100', episode_num: 1, title: 'Piloto', container_extension: 'mp4', info: {} }] },
} as unknown as SeriesInfo;
const TRES_EPISODIOS = {
    seasons: {},
    info: {},
    episodes: {
        '1': [1, 2, 3].map(n => ({ id: String(100 + n), episode_num: n, title: `Ep ${n}`, container_extension: 'mp4', info: {} })),
    },
} as unknown as SeriesInfo;

// ---------------------------------------------------------------------------
// A rede de mentira: cada chamada de get_series_info responde o que o teste
// mandou POR ÚLTIMO. A ficha também chama (pra listar episódios) ao abrir.
// ---------------------------------------------------------------------------
let resposta: () => Promise<SeriesInfo> = () => Promise.resolve(SEM_EPISODIOS);
const responder = (info: SeriesInfo) => { resposta = () => Promise.resolve(info); };
const cairARede = () => { resposta = () => Promise.reject(new Error('Failed to fetch')); };
/** Pedido que só termina quando o teste manda. */
function segurar(): { resolver: (info: SeriesInfo) => void; falhar: () => void } {
    let resolver!: (info: SeriesInfo) => void;
    let rejeitar!: (err: Error) => void;
    const promessa = new Promise<SeriesInfo>((res, rej) => { resolver = res; rejeitar = rej; });
    resposta = () => promessa;
    return { resolver, falhar: () => rejeitar(new Error('Failed to fetch')) };
}

const ficha = () => document.querySelector('.modal-backdrop');
const botaoAssistirDaFicha = (): HTMLElement => {
    const botao = document.querySelector<HTMLElement>('.modal-backdrop .modal-actions .play-btn');
    if (!botao) throw new Error('a ficha não mostrou o botão Assistir');
    return botao;
};
const apertarAssistir = () => act(() => { fireEvent.click(botaoAssistirDaFicha()); });
// O que a pessoa LÊ: os dois finais sem fila têm frases diferentes
const SEM_EPISODIO_NA_TELA = /sem episódios/i;
const FALHA_NA_TELA = /conexão/i;
const NENHUM = '(nenhum aviso na tela)';
const avisoNaTela = () => document.querySelector('[role="alert"]')?.textContent ?? NENHUM;
/** Nas telas com ficha, o aviso tem de estar DENTRO dela (onde o foco está). */
const avisoNaFicha = () => document.querySelector('.modal-backdrop [role="alert"]')?.textContent ?? NENHUM;
const player = () => document.querySelector('.player-da-serie-nome');
const episodioNoPlayer = () => document.querySelector('.player-da-serie-episodio')?.textContent;

type Espiao = { mock: { calls: unknown[][]; results: { value: unknown }[] } };

/** Chamadas de setTimeout armadas com o atraso do aviso. */
function chamadasDoAviso(armar: Espiao): Array<{ callback: () => void; id: unknown }> {
    return armar.mock.calls
        .map((args, i) => ({ callback: args[0] as () => void, atraso: args[1], id: armar.mock.results[i]?.value }))
        .filter(c => c.atraso === DURACAO_DO_AVISO_DE_SERIE_MS);
}

/**
 * Espera o timer do aviso ser ARMADO (o useEffect roda depois do commit que
 * já pôs o aviso na tela), desmonta, e confere que todo timer do aviso foi
 * desarmado — nenhum fica pendurado disparando setState em tela morta.
 */
async function provarQueOTimerMorreComATela(armar: Espiao, desarmar: Espiao): Promise<void> {
    await waitFor(() => expect(chamadasDoAviso(armar).length).toBeGreaterThan(0));
    const ids = chamadasDoAviso(armar).map(c => c.id);
    cleanup();
    const desarmados = new Set(desarmar.mock.calls.map(args => args[0]));
    expect(ids.filter(id => !desarmados.has(id))).toEqual([]);
}

/** Faz o timer do aviso VENCER (roda o callback que a tela armou por último). */
async function vencerOTimerDoAviso(armar: Espiao): Promise<void> {
    await waitFor(() => expect(chamadasDoAviso(armar).length).toBeGreaterThan(0));
    const ultimo = chamadasDoAviso(armar).pop();
    act(() => { ultimo?.callback(); });
}

/**
 * Deixa terminar toda a cadeia de promessas já disparada (um macrotask só roda
 * depois de a fila de microtasks esvaziar) e aplica o que ela mudou na tela.
 * É a condição "o pedido velho já respondeu", não uma contagem de voltas.
 */
async function esvaziarPromessasPendentes(): Promise<void> {
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

beforeEach(() => {
    installFakeStorage();
    clearSearchCatalogCache();
    responder(SEM_EPISODIOS);
    vi.spyOn(api, 'getSeriesInfo').mockImplementation(() => resposta());
    // jsdom não implementa scrollIntoView; ficha e grades rolam com o foco
    Element.prototype.scrollIntoView = function () { /* jsdom */ };
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
    cleanup();
    // Carga pendente da tela desmontada termina aqui, e não no armazenamento
    // do próximo teste
    await new Promise(resolve => setTimeout(resolve, 0));
    vi.restoreAllMocks();
    clearSearchCatalogCache();
});

// ---------------------------------------------------------------------------
// Séries
// ---------------------------------------------------------------------------
function cardDaGrade(): HTMLElement {
    const el = document.querySelector<HTMLElement>('.series-card');
    if (!el) throw new Error('grade ainda sem card');
    return el;
}

async function abrirFichaEmSeries(): Promise<void> {
    vi.spyOn(api, 'getSeries').mockResolvedValue([serie(7, 'Série Nova')]);
    vi.spyOn(api, 'getSeriesCategories').mockResolvedValue([]);
    render(<Series />);
    // Espera a CONDIÇÃO: o card na grade
    const card = await waitFor(cardDaGrade);
    act(() => { fireEvent.click(card); });
    expect(ficha()).not.toBeNull();
}

describe('Séries — OK em Assistir sem ter o que tocar', () => {
    it('painel sem episódio: a ficha FICA aberta e diz por quê', async () => {
        await abrirFichaEmSeries();

        apertarAssistir();

        await waitFor(() => expect(avisoNaFicha()).toMatch(SEM_EPISODIO_NA_TELA));
        expect(ficha()).not.toBeNull();   // antes: fechava e voltava pra grade
        expect(player()).toBeNull();
    });

    it('rede caída: a ficha fica aberta e o aviso é o da conexão', async () => {
        await abrirFichaEmSeries();
        cairARede();

        apertarAssistir();

        await waitFor(() => expect(avisoNaFicha()).toMatch(FALHA_NA_TELA));
        expect(ficha()).not.toBeNull();
        expect(player()).toBeNull();
    });

    it('com episódio, continua tocando e a ficha fecha', async () => {
        responder(COM_EPISODIO);
        await abrirFichaEmSeries();

        apertarAssistir();

        await waitFor(() => expect(player()?.textContent).toBe('Série Nova'));
        expect(ficha()).toBeNull();
        expect(avisoNaTela()).toBe(NENHUM);
    });

    it('o aviso some sozinho quando o tempo dele vence', async () => {
        await abrirFichaEmSeries();
        const armar = vi.spyOn(globalThis, 'setTimeout');

        apertarAssistir();
        await waitFor(() => expect(avisoNaFicha()).toMatch(SEM_EPISODIO_NA_TELA));

        await vencerOTimerDoAviso(armar);
        expect(avisoNaTela()).toBe(NENHUM);
        expect(ficha()).not.toBeNull();
    });

    it('o timer do aviso é desarmado quando a ficha sai da tela', async () => {
        await abrirFichaEmSeries();
        const armar = vi.spyOn(globalThis, 'setTimeout');
        const desarmar = vi.spyOn(globalThis, 'clearTimeout');

        apertarAssistir();
        await waitFor(() => expect(avisoNaFicha()).toMatch(SEM_EPISODIO_NA_TELA));

        await provarQueOTimerMorreComATela(armar, desarmar);
    });

    it('um novo OK apaga o aviso velho enquanto o pedido está no ar', async () => {
        await abrirFichaEmSeries();
        cairARede();
        apertarAssistir();
        await waitFor(() => expect(avisoNaFicha()).toMatch(FALHA_NA_TELA));

        const pedido = segurar();
        apertarAssistir();
        // A frase da tentativa anterior não fica na tela durante a nova
        expect(avisoNaTela()).toBe(NENHUM);

        pedido.resolver(SEM_EPISODIOS);
        await waitFor(() => expect(avisoNaFicha()).toMatch(SEM_EPISODIO_NA_TELA));
    });

    it('OK do controle num EPISÓDIO da lista também avisa (é outro caminho da ficha)', async () => {
        responder(COM_EPISODIO);          // a ficha lista o episódio...
        await abrirFichaEmSeries();
        await waitFor(() => expect(document.querySelector('.modal-backdrop .episode-item')).not.toBeNull());
        tecla(BAIXO);                      // Assistir → lista de episódios
        expect(document.querySelector('.modal-backdrop .episode-item.focused')).not.toBeNull();
        cairARede();                       // ...e a rede cai antes do OK

        tecla(OK);

        await waitFor(() => expect(avisoNaFicha()).toMatch(FALHA_NA_TELA));
        expect(ficha()).not.toBeNull();
        expect(player()).toBeNull();
    });

    it('dois OK seguidos: só o ÚLTIMO fala — a falha atrasada do primeiro não aparece depois', async () => {
        responder(COM_EPISODIO);
        await abrirFichaEmSeries();

        const primeiro = segurar();
        apertarAssistir();                 // 1º OK: rede lenta
        responder(COM_EPISODIO);
        apertarAssistir();                 // 2º OK: toca
        await waitFor(() => expect(player()?.textContent).toBe('Série Nova'));

        // Sai do player e reabre a mesma série: a ficha é a MESMA instância
        act(() => { fireEvent.click(document.querySelector<HTMLElement>('.player-da-serie-fechar')!); });
        act(() => { fireEvent.click(cardDaGrade()); });
        expect(ficha()).not.toBeNull();

        // Só agora o 1º pedido desiste — a resposta dele é velha
        primeiro.falhar();
        await esvaziarPromessasPendentes();

        expect(avisoNaTela()).toBe(NENHUM);
    });
});

// ---------------------------------------------------------------------------
// Minha Lista
// ---------------------------------------------------------------------------
describe('Minha Lista — OK em Assistir sem ter o que tocar', () => {
    it('OK do CONTROLE no Assistir (o foco da ficha abre nele) também avisa', async () => {
        storage.addWatchLater({ id: '7', type: 'series', title: 'Série Nova' });
        render(<MyList />);
        const card = document.querySelector<HTMLElement>('.cards-grid .card');
        if (!card) throw new Error('a Minha Lista não mostrou o card');
        act(() => { fireEvent.click(card); });
        expect(document.querySelector('.modal-backdrop .play-btn.focused')).not.toBeNull();
        cairARede();

        tecla(OK);

        await waitFor(() => expect(avisoNaFicha()).toMatch(FALHA_NA_TELA));
        expect(ficha()).not.toBeNull();
        expect(player()).toBeNull();
    });

    it('a ficha não fica imóvel: mostra o aviso e o player não abre', async () => {
        storage.addWatchLater({ id: '7', type: 'series', title: 'Série Nova' });
        render(<MyList />);
        const card = document.querySelector<HTMLElement>('.cards-grid .card');
        if (!card) throw new Error('a Minha Lista não mostrou o card');
        act(() => { fireEvent.click(card); });
        expect(ficha()).not.toBeNull();

        apertarAssistir();

        await waitFor(() => expect(avisoNaFicha()).toMatch(SEM_EPISODIO_NA_TELA));
        expect(ficha()).not.toBeNull();
        expect(player()).toBeNull();
    });

    it('com episódio, continua tocando e a ficha fecha', async () => {
        responder(COM_EPISODIO);
        storage.addWatchLater({ id: '7', type: 'series', title: 'Série Nova' });
        render(<MyList />);
        const card = document.querySelector<HTMLElement>('.cards-grid .card');
        if (!card) throw new Error('a Minha Lista não mostrou o card');
        act(() => { fireEvent.click(card); });

        apertarAssistir();

        await waitFor(() => expect(player()?.textContent).toBe('Série Nova'));
        expect(ficha()).toBeNull();
        expect(avisoNaTela()).toBe(NENHUM);
    });
});

// ---------------------------------------------------------------------------
// Favoritos
// ---------------------------------------------------------------------------
describe('Favoritos — OK em Assistir sem ter o que tocar', () => {
    it('rede caída: a ficha mostra o aviso da conexão e o player não abre', async () => {
        storage.addFavorite({ id: '7', type: 'series', title: 'Série Nova' });
        render(<Favorites />);
        const card = document.querySelector<HTMLElement>('.cards-grid .card');
        if (!card) throw new Error('os Favoritos não mostraram o card');
        act(() => { fireEvent.click(card); });
        expect(ficha()).not.toBeNull();
        cairARede();

        apertarAssistir();

        await waitFor(() => expect(avisoNaFicha()).toMatch(FALHA_NA_TELA));
        expect(ficha()).not.toBeNull();
        expect(player()).toBeNull();
    });

    it('com episódio, continua tocando e a ficha fecha', async () => {
        responder(COM_EPISODIO);
        storage.addFavorite({ id: '7', type: 'series', title: 'Série Nova' });
        render(<Favorites />);
        const card = document.querySelector<HTMLElement>('.cards-grid .card');
        if (!card) throw new Error('os Favoritos não mostraram o card');
        act(() => { fireEvent.click(card); });

        apertarAssistir();

        await waitFor(() => expect(player()?.textContent).toBe('Série Nova'));
        expect(ficha()).toBeNull();
        expect(avisoNaTela()).toBe(NENHUM);
    });
});

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
async function montarHome(): Promise<void> {
    render(<Home onNavigate={() => {}} onRequestExit={() => {}} onCancelExit={() => {}} />);
    // Espera o fetch da Home terminar (os contadores saem do "...")
    await waitFor(() => {
        expect(document.querySelector('.stat-card-live .stat-value')?.textContent).toBe('0');
    });
}

async function montarHomeComSerieEmProgresso(): Promise<void> {
    vi.spyOn(api, 'getLiveStreams').mockResolvedValue([]);
    vi.spyOn(api, 'getVODStreams').mockResolvedValue([]);
    vi.spyOn(api, 'getSeries').mockResolvedValue([]);
    progressService.saveSeries({
        seriesId: '7', seriesName: 'Série Nova', poster: '7.jpg', season: 1, episode: 3,
        episodeId: '7-e3', time: 600, duration: 2700,
    });
    await montarHome();
    tecla(BAIXO); // stats → Continuar Assistindo
    const focado = document.querySelector('#home-continue .tv-focused .card-title')?.textContent?.trim();
    expect(focado).toMatch(/^Série Nova/);
}

describe('Home — ficha aberta pela fileira Séries Recentes', () => {
    async function abrirFichaNaHome(): Promise<void> {
        vi.spyOn(api, 'getLiveStreams').mockResolvedValue([]);
        vi.spyOn(api, 'getVODStreams').mockResolvedValue([]);
        vi.spyOn(api, 'getSeries').mockResolvedValue([serie(7, 'Série Nova')]);
        await montarHome();
        // A fileira chega depois dos contadores: descer antes dela existir
        // levava o foco pra baixo dela, e o ↓ não sobe de volta (falhava
        // ~1 em 15 com "o foco ainda não chegou em Séries Recentes")
        await waitFor(() => {
            expect(document.querySelector('#home-series .card-title')?.textContent).toBe('Série Nova');
        });
        // Desce até a fileira: a ordem das fileiras depende do que existe, então
        // espera a CONDIÇÃO "foco nela" apertando ↓ enquanto ela não chega
        await waitFor(() => {
            if (!document.querySelector('#home-series .tv-focused')) {
                tecla(BAIXO);
                throw new Error('o foco ainda não chegou em Séries Recentes');
            }
        });
        expect(document.querySelector('#home-series .tv-focused .card-title')?.textContent).toBe('Série Nova');
        tecla(OK);
        expect(ficha()).not.toBeNull();
    }

    it('painel sem episódio: a ficha fica aberta e diz por quê', async () => {
        await abrirFichaNaHome();

        apertarAssistir();

        await waitFor(() => expect(avisoNaFicha()).toMatch(SEM_EPISODIO_NA_TELA));
        expect(ficha()).not.toBeNull();
        expect(player()).toBeNull();
    });

    it('com episódio, continua tocando e a ficha fecha', async () => {
        responder(COM_EPISODIO);
        await abrirFichaNaHome();

        apertarAssistir();

        await waitFor(() => expect(player()?.textContent).toBe('Série Nova'));
        expect(ficha()).toBeNull();
        expect(avisoNaTela()).toBe(NENHUM);
    });
});

describe('Home — OK num card de série do Continuar Assistindo (não há ficha aqui)', () => {
    it('painel sem episódio: o OK responde com um aviso', async () => {
        await montarHomeComSerieEmProgresso();

        tecla(OK);

        await waitFor(() => expect(avisoNaTela()).toMatch(SEM_EPISODIO_NA_TELA));
        expect(player()).toBeNull();
    });

    it('rede caída: o aviso é o da conexão, e o timer morre com a Home', async () => {
        await montarHomeComSerieEmProgresso();
        cairARede();
        const armar = vi.spyOn(globalThis, 'setTimeout');
        const desarmar = vi.spyOn(globalThis, 'clearTimeout');

        tecla(OK);
        await waitFor(() => expect(avisoNaTela()).toMatch(FALHA_NA_TELA));
        expect(player()).toBeNull();

        await provarQueOTimerMorreComATela(armar, desarmar);
    });

    it('o aviso some sozinho quando o tempo dele vence', async () => {
        await montarHomeComSerieEmProgresso();
        const armar = vi.spyOn(globalThis, 'setTimeout');

        tecla(OK);
        await waitFor(() => expect(avisoNaTela()).toMatch(SEM_EPISODIO_NA_TELA));

        await vencerOTimerDoAviso(armar);
        expect(avisoNaTela()).toBe(NENHUM);
    });

    it('um novo OK apaga o aviso velho enquanto o pedido está no ar', async () => {
        await montarHomeComSerieEmProgresso();
        cairARede();
        tecla(OK);
        await waitFor(() => expect(avisoNaTela()).toMatch(FALHA_NA_TELA));

        const pedido = segurar();
        tecla(OK);
        expect(avisoNaTela()).toBe(NENHUM);

        pedido.resolver(COM_EPISODIO);
        await waitFor(() => expect(player()?.textContent).toBe('Série Nova'));
        expect(avisoNaTela()).toBe(NENHUM);
    });

    it('com episódio, o OK abre o player e não há aviso', async () => {
        responder(COM_EPISODIO);
        await montarHomeComSerieEmProgresso();

        tecla(OK);

        await waitFor(() => expect(player()?.textContent).toBe('Série Nova'));
        expect(avisoNaTela()).toBe(NENHUM);
    });

    it('com a série inteira no painel, retoma no episódio salvo (T1E3), não no primeiro', async () => {
        responder(TRES_EPISODIOS);
        await montarHomeComSerieEmProgresso();   // progresso salvo em T1E3

        tecla(OK);

        await waitFor(() => expect(player()?.textContent).toBe('Série Nova'));
        expect(episodioNoPlayer()).toBe('T1E3');
    });
});

// ---------------------------------------------------------------------------
// Busca global (overlay 🔍)
// ---------------------------------------------------------------------------
describe('Busca global — OK em Assistir sem ter o que tocar', () => {
    async function abrirFichaPelaBusca(): Promise<void> {
        vi.spyOn(api, 'getLiveStreams').mockResolvedValue([]);
        vi.spyOn(api, 'getVODStreams').mockResolvedValue([]);
        vi.spyOn(api, 'getSeries').mockResolvedValue([serie(7, 'Série Nova')]);
        vi.spyOn(api, 'getLiveCategories').mockResolvedValue([]);
        vi.spyOn(api, 'getVodCategories').mockResolvedValue([]);
        vi.spyOn(api, 'getSeriesCategories').mockResolvedValue([]);
        render(<GlobalSearch onClose={() => { /* fechar não importa aqui */ }} />);
        // Espera a CONDIÇÃO: catálogo carregado (o aviso de 2 letras só aparece com ele)
        await waitFor(() => expect(document.body.textContent).toContain('Digite pelo menos 2 letras.'));
        const input = document.querySelector('.gs-input') as HTMLInputElement;
        act(() => { fireEvent.change(input, { target: { value: 'serie nova' } }); });
        const resultado = document.querySelector<HTMLElement>('.gs-result');
        if (!resultado) throw new Error('a busca não achou a série');
        act(() => { fireEvent.click(resultado); });
        expect(ficha()).not.toBeNull();
    }

    it('a ficha aberta pela busca mostra o aviso e o player não abre', async () => {
        await abrirFichaPelaBusca();

        apertarAssistir();

        await waitFor(() => expect(avisoNaFicha()).toMatch(SEM_EPISODIO_NA_TELA));
        expect(ficha()).not.toBeNull();
        expect(player()).toBeNull();
    });

    it('com episódio, continua tocando e a ficha fecha', async () => {
        responder(COM_EPISODIO);
        await abrirFichaPelaBusca();

        apertarAssistir();

        await waitFor(() => expect(player()?.textContent).toBe('Série Nova'));
        expect(ficha()).toBeNull();
        expect(avisoNaTela()).toBe(NENHUM);
    });
});
