// @vitest-environment jsdom
//
// 🖼️ A ficha pedia TODAS as miniaturas de uma vez (T031).
//
// As imagens da lista de episódios e da fileira da saga tinham só
// `loading="lazy"`. O alvo é o Chromium 69 (Tizen 5.5), e o atributo só chegou
// no Chrome 76: lá ele é ignorado em silêncio. Abrir uma temporada de 24
// episódios com miniatura disparava 24 downloads e 24 decodificações com ~4
// linhas na tela — numa TV de ~1 GB, banda e bitmap gastos no que ninguém vê.
//
// O teste troca o IntersectionObserver (Chrome 51, existe na TV) por um falso
// que ESTE arquivo controla: a imagem só pode ganhar `src` depois que o
// observer disser que a moldura entrou na janela da lista. E o observer tem de
// ser desligado quando a imagem já veio e quando a ficha desmonta.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import type { Episode, SeriesInfo } from '../types';

vi.mock('../services/tmdb', async (importOriginal) => {
    const original = await importOriginal<typeof import('../services/tmdb')>();
    return {
        ...original,
        searchMovieByName: vi.fn(async () => null),
        searchSeriesByName: vi.fn(async () => null),
        fetchSeriesDetails: vi.fn(async () => null),
        fetchMovieDetails: vi.fn(async () => ({
            genres: [], overview: 'Filme de teste', title: 'Filme 1', release_date: '2001-01-01',
            vote_average: 7, backdrop_path: null, poster_path: null,
            belongs_to_collection: { id: 9, name: 'Saga de Teste', poster_path: null },
        })),
        fetchColecao: vi.fn(async () => ({
            id: 9,
            name: 'Saga de Teste',
            parts: Array.from({ length: 8 }, (_, i) => ({
                id: i + 1, title: `Filme ${i + 1}`, year: String(2001 + i), poster_path: null,
            })),
        })),
    };
});

import { api } from '../services/api';
import { ContentDetailModal } from './ContentDetailModal';
import { ImagemPreguicosa } from './ImagemPreguicosa';

// ---- IntersectionObserver falso ----------------------------------------
class ObserverFalso {
    static vivos = new Set<ObserverFalso>();
    readonly alvos = new Set<Element>();
    readonly root: Element | Document | null;
    readonly rootMargin: string;
    private readonly callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback, opcoes: IntersectionObserverInit = {}) {
        this.callback = callback;
        this.root = opcoes.root ?? null;
        this.rootMargin = opcoes.rootMargin ?? '0px';
        ObserverFalso.vivos.add(this);
    }
    observe(alvo: Element) { this.alvos.add(alvo); }
    unobserve(alvo: Element) { this.alvos.delete(alvo); }
    disconnect() { this.alvos.clear(); ObserverFalso.vivos.delete(this); }
    takeRecords(): IntersectionObserverEntry[] { return []; }
    /**
     * O navegador avisando sobre `alvo`, um estado por entrada do MESMO lote:
     * true = dentro da janela da raiz. Logo depois do observe() o navegador
     * avisa TODO alvo, inclusive os de fora (isIntersecting false) — o
     * componente tem de ignorar esses.
     */
    avisar(alvo: Element, ...estados: boolean[]) {
        const entradas = estados.map(dentro => ({
            target: alvo, isIntersecting: dentro, intersectionRatio: dentro ? 1 : 0, time: 0,
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
        }) as IntersectionObserverEntry);
        this.callback(entradas, this as unknown as IntersectionObserver);
    }
}

/** Quantos elementos ainda estão sendo vigiados, somando todos os observers. */
const vigiados = () => [...ObserverFalso.vivos].reduce((n, o) => n + o.alvos.size, 0);

/** Margem (px) de um lado do `rootMargin` — 0 = cima, 1 = direita. */
const margemPx = (observer: ObserverFalso, lado: 0 | 1) =>
    parseFloat(observer.rootMargin.split(' ')[lado] ?? observer.rootMargin);

/** O aviso inicial do navegador: todo alvo vigiado, FORA da janela. */
function avisoInicialForaDaTela() {
    act(() => {
        for (const observer of [...ObserverFalso.vivos]) {
            for (const alvo of [...observer.alvos]) observer.avisar(alvo, false);
        }
    });
}

/** Faz as molduras dadas "entrarem na tela" para quem as estiver vigiando. */
function entrarNaTela(elementos: Element[]) {
    act(() => {
        for (const observer of [...ObserverFalso.vivos]) {
            for (const alvo of [...observer.alvos]) {
                if (elementos.some(el => el === alvo || el.contains(alvo) || alvo.contains(el))) {
                    observer.avisar(alvo, true);
                }
            }
        }
    });
}

// ---- dados ------------------------------------------------------------
function episodio(n: number): Episode {
    return {
        id: `ep${n}`, episode_num: n, title: `Episódio ${n}`, container_extension: 'mp4',
        info: {
            duration_secs: 1500, duration: '00:25:00', plot: `Sinopse do episódio ${n}`,
            releasedate: '', movie_image: `http://img.test/ep${n}.jpg`,
        },
        custom_sid: '', added: '', season: 1, direct_source: '',
    };
}

const serie24 = {
    episodes: { '1': Array.from({ length: 24 }, (_, i) => episodio(i + 1)) },
    info: {},
    seasons: [],
} as unknown as SeriesInfo;

const imagensCarregadas = (raiz: ParentNode) =>
    [...raiz.querySelectorAll('img')].filter(img => !!img.getAttribute('src'));

let observerOriginal: unknown;
beforeAll(() => {
    // jsdom não implementa scrollIntoView, e a ficha chama ao abrir
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
    observerOriginal = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

beforeEach(() => {
    ObserverFalso.vivos.clear();
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = ObserverFalso;
    vi.spyOn(api, 'getSeriesInfo').mockResolvedValue(serie24);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = observerOriginal;
});

/**
 * Espera a lista E os observers. A resposta do painel chega fora de `act`,
 * então o React pinta a lista e roda os efeitos (onde o observer nasce) em
 * passos separados: esperar só pelos 24 itens deixava o teste disparar
 * `entrarNaTela` antes de existir quem vigiasse.
 */
async function esperarLista(container: HTMLElement, itens = 24, comImagem = itens) {
    await waitFor(() => expect(container.querySelectorAll('.episode-item')).toHaveLength(itens));
    await waitFor(() => expect(vigiados()).toBe(comImagem));
}

function abrirSerie() {
    return render(
        <ContentDetailModal
            isOpen
            onClose={() => {}}
            contentId="77"
            contentType="series"
            contentData={{ name: 'Série de Teste', cover: 'http://img.test/capa.jpg' }}
            onPlay={() => {}}
        />
    );
}

describe('lista de episódios', () => {
    it('não pede miniatura nenhuma antes de ela entrar na janela da lista', async () => {
        const { container } = abrirSerie();
        await esperarLista(container);
        const lista = container.querySelector('.episode-list')!;

        expect(imagensCarregadas(lista)).toHaveLength(0);
        // A janela é a PRÓPRIA lista (ela rola sozinha, 38vh), com margem na
        // vertical: contra o viewport a margem alargaria a tela, mas o overflow
        // da lista seguiria cortando a próxima linha — nada seria pedido antes
        // de aparecer
        expect(vigiados()).toBe(24);
        for (const observer of ObserverFalso.vivos) {
            expect(observer.root).toBe(lista);
            expect(margemPx(observer, 0)).toBeGreaterThan(0);
        }

        // O aviso inicial do navegador (todas fora da janela) não carrega nada
        avisoInicialForaDaTela();
        expect(imagensCarregadas(lista)).toHaveLength(0);
        expect(vigiados()).toBe(24);
    });

    it('episódio sem miniatura não é vigiado e fica só com a moldura', async () => {
        const semImagem = episodio(2);
        semImagem.info = { ...semImagem.info, movie_image: '' };
        const serie = {
            episodes: { '1': [episodio(1), semImagem, episodio(3)] },
            info: {},
            seasons: [],
        } as unknown as SeriesInfo;
        vi.spyOn(api, 'getSeriesInfo').mockResolvedValue(serie);

        const { container } = abrirSerie();
        await esperarLista(container, 3, 2);
        const molduras = [...container.querySelectorAll('.episode-list .episode-thumb')];
        expect(molduras).toHaveLength(3);

        entrarNaTela(molduras);
        expect(imagensCarregadas(container.querySelector('.episode-list')!).map(img => img.getAttribute('src')))
            .toEqual(['http://img.test/ep1.jpg', 'http://img.test/ep3.jpg']);
        expect(molduras[1].querySelector('img')).toBeNull();
        expect(ObserverFalso.vivos.size).toBe(0);
    });

    it('carrega só as que entram na tela e desarma o observer de cada uma', async () => {
        const { container, unmount } = abrirSerie();
        await esperarLista(container);
        const lista = container.querySelector('.episode-list')!;
        const molduras = [...lista.querySelectorAll('.episode-thumb')];
        expect(molduras).toHaveLength(24);

        entrarNaTela(molduras.slice(0, 4));

        expect(imagensCarregadas(lista).map(img => img.getAttribute('src'))).toEqual([
            'http://img.test/ep1.jpg', 'http://img.test/ep2.jpg',
            'http://img.test/ep3.jpg', 'http://img.test/ep4.jpg',
        ]);
        // As quatro que já vieram não são mais vigiadas; as outras 20 seguem
        expect(vigiados()).toBe(20);

        // Aviso inicial e entrada chegando no MESMO lote (rolou no mesmo quadro
        // do observe): a entrada vale, mesmo não sendo a única do lote
        act(() => {
            for (const observer of [...ObserverFalso.vivos]) {
                if (observer.alvos.has(molduras[4])) observer.avisar(molduras[4], false, true);
            }
        });
        expect(molduras[4].querySelector('img')?.getAttribute('src')).toBe('http://img.test/ep5.jpg');
        expect(vigiados()).toBe(19);

        // Rolar até o fim traz o resto
        entrarNaTela(molduras.slice(5));
        expect(imagensCarregadas(lista)).toHaveLength(24);
        expect(vigiados()).toBe(0);
        expect(ObserverFalso.vivos.size).toBe(0);

        unmount();
        expect(ObserverFalso.vivos.size).toBe(0);
    });

    it('fechar a ficha desliga os observers das miniaturas que nunca apareceram', async () => {
        const { container, unmount } = abrirSerie();
        await esperarLista(container);
        expect(ObserverFalso.vivos.size).toBeGreaterThan(0);

        unmount();

        expect(ObserverFalso.vivos.size).toBe(0);
        expect(vigiados()).toBe(0);
    });

    it('sem IntersectionObserver, carrega tudo como antes (nunca fica sem miniatura)', async () => {
        delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
        const { container } = abrirSerie();
        await waitFor(() => expect(container.querySelectorAll('.episode-item')).toHaveLength(24));

        expect(imagensCarregadas(container.querySelector('.episode-list')!)).toHaveLength(24);
    });

    it('miniatura quebrada some sem deixar ícone', async () => {
        const { container } = abrirSerie();
        await esperarLista(container);
        const primeira = container.querySelector('.episode-list .episode-thumb')!;
        entrarNaTela([primeira]);

        const img = primeira.querySelector('img')!;
        act(() => { img.dispatchEvent(new Event('error')); });
        expect(img.style.display).toBe('none');
    });
});

describe('fileira da saga', () => {
    it('só pede o pôster dos filmes que entram na janela da fileira', async () => {
        const catalogo = Array.from({ length: 8 }, (_, i) => ({
            stream_id: 100 + i, name: `Filme ${i + 1}`, tmdb_id: i + 1,
            stream_icon: `http://img.test/poster${i + 1}.jpg`,
        }));
        const { container } = render(
            <ContentDetailModal
                isOpen
                onClose={() => {}}
                contentId="999"
                contentType="movie"
                contentData={{ name: 'Filme 0', cover: 'http://img.test/capa.jpg', tmdbId: '500' }}
                onPlay={() => {}}
                catalogoFilmes={catalogo}
                onOpenRelated={() => {}}
            />
        );
        await waitFor(() => expect(container.querySelectorAll('.saga-card')).toHaveLength(8));
        const fileira = container.querySelector('.saga-row')!;
        // Mesma espera da lista: os observers nascem num passo depois da pintura
        await waitFor(() => expect(vigiados()).toBe(8));

        expect(imagensCarregadas(fileira)).toHaveLength(0);
        // A janela é a fileira (ela rola na horizontal), não o viewport
        const observersDaSaga = [...ObserverFalso.vivos].filter(o => o.root === fileira);
        expect(observersDaSaga).toHaveLength(8);
        // Margem na HORIZONTAL: o próximo pôster é pedido antes de aparecer
        for (const observer of observersDaSaga) expect(margemPx(observer, 1)).toBeGreaterThan(0);

        avisoInicialForaDaTela();
        expect(imagensCarregadas(fileira)).toHaveLength(0);

        entrarNaTela([...fileira.querySelectorAll('.saga-poster')].slice(0, 3));

        expect(imagensCarregadas(fileira).map(img => img.getAttribute('src'))).toEqual([
            'http://img.test/poster1.jpg', 'http://img.test/poster2.jpg', 'http://img.test/poster3.jpg',
        ]);
        expect(vigiados()).toBe(5);
    });
});

// ---- o componente sozinho ---------------------------------------------
// Caminhos que a ficha só alcança de longe. A `key` do episódio é
// `ep.id || index`: sem id, trocar de temporada REAPROVEITA a moldura e o
// `src` muda sem desmontar — o de um episódio sem miniatura pode virar o de
// um que tem. E sem IntersectionObserver a moldura nasce "na tela".
describe('ImagemPreguicosa', () => {
    it('src que chega depois arma o observer e a imagem vem quando entra na janela', () => {
        const { container, rerender } = render(<ImagemPreguicosa className="moldura" src="" />);
        expect(vigiados()).toBe(0);

        rerender(<ImagemPreguicosa className="moldura" src="http://img.test/tardia.jpg" />);
        // Sem isso a moldura ficaria vazia para sempre: ninguém vigiando
        expect(vigiados()).toBe(1);
        expect(imagensCarregadas(container)).toHaveLength(0);

        entrarNaTela([container.querySelector('.moldura')!]);
        expect(imagensCarregadas(container).map(img => img.getAttribute('src')))
            .toEqual(['http://img.test/tardia.jpg']);
        expect(ObserverFalso.vivos.size).toBe(0);
    });

    it('sem IntersectionObserver e sem src, fica só a moldura (nenhum <img> vazio)', () => {
        delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
        const { container } = render(<ImagemPreguicosa className="moldura" src="" />);

        expect(container.querySelector('.moldura')).not.toBeNull();
        expect(container.querySelector('img')).toBeNull();
    });
});
