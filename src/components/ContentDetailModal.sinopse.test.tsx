// @vitest-environment jsdom
//
// 📖 A sinopse da ficha era cortada em 4 linhas e nenhuma tecla revelava o
// resto (T115).
//
// A ficha é onde a pessoa decide se vai assistir, e o texto que sustenta a
// decisão parava em reticências. Rolar a ficha não resolvia: o corte é no
// PRÓPRIO elemento (line-clamp + max-height), não na dobra. E nenhuma zona do
// D-pad chegava na sinopse — a cadeia vertical ia do X direto pras ações.
//
// O jsdom não faz layout, então o teste traz um "layout de brinquedo" para o
// parágrafo da sinopse que OBEDECE à folha de estilo de verdade (carregada no
// documento): tamanho de fonte, altura de linha, `max-height` e
// `-webkit-line-clamp` saem do getComputedStyle. Assim "o texto inteiro ficou
// visível" é medido pela mesma regra que a TV aplica, e não por uma classe
// que o teste conhece de antemão.

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, cleanup, act, waitFor, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

import { ContentDetailModal } from './ContentDetailModal';
import { api } from '../services/api';
import { searchMovieByName, fetchColecao, type TMDBMovieDetails } from '../services/tmdb';
import type { Episode, SeriesInfo } from '../types';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/** Largura útil da coluna de texto da ficha ao lado do pôster (~528px). */
const LARGURA_DO_TEXTO = 528;
/** Letra média de uma sans latina: ~0,55em (mesma estimativa de tipografia10ft). */
const LETRA_EM = 0.55;

const FRASE = 'Uma família se muda para uma casa antiga no interior e descobre que o porão guarda segredos. ';
// ~900 letras: bem mais que quatro linhas em qualquer tamanho de fonte razoável
const SINOPSE_LONGA = FRASE.repeat(10).trim();
const SINOPSE_CURTA = 'Um curta sobre um gato.';

function px(valor: string): number {
    const m = /^(\d*\.?\d+)px$/.exec(valor.trim());
    if (!m) throw new Error(`esperava um valor em px, veio "${valor}"`);
    return Number(m[1]);
}

/**
 * Altura da caixa da sinopse, com a regra da folha: linhas de texto × altura
 * de linha, cortada pelo line-clamp (só vale com display -webkit-box) e pelo
 * max-height. `inteira` é o que o texto ocuparia sem corte.
 */
function caixaDaSinopse(el: HTMLElement): { inteira: number; visivel: number } {
    const estilo = getComputedStyle(el);
    const fonte = px(estilo.fontSize);
    const lh = estilo.lineHeight.trim();
    const linha = /^\d*\.?\d+$/.test(lh) ? Number(lh) * fonte : px(lh);
    const letrasPorLinha = Math.max(1, Math.floor(LARGURA_DO_TEXTO / (fonte * LETRA_EM)));
    const linhas = Math.max(1, Math.ceil((el.textContent || '').length / letrasPorLinha));
    const inteira = linhas * linha;
    let visivel = inteira;
    const clamp = Number(estilo.getPropertyValue('-webkit-line-clamp'));
    if (estilo.display === '-webkit-box' && clamp > 0) visivel = Math.min(visivel, clamp * linha);
    if (/px$/.test(estilo.maxHeight)) visivel = Math.min(visivel, px(estilo.maxHeight));
    return { inteira, visivel };
}

let folha: HTMLStyleElement | null = null;
const descritores: Array<[string, PropertyDescriptor | undefined]> = [];

beforeAll(() => {
    // jsdom não implementa scrollIntoView, e a ficha chama ao focar
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
    // A folha REAL da ficha. O import de CSS do componente não chega ao jsdom.
    folha = document.createElement('style');
    folha.textContent = readFileSync(path.join(AQUI, 'ContentDetailModal.css'), 'utf-8');
    document.head.appendChild(folha);
    if ((folha.sheet?.cssRules.length ?? 0) === 0) {
        throw new Error('o jsdom não leu ContentDetailModal.css — o teste mediria sem ela');
    }
    for (const prop of ['scrollHeight', 'clientHeight'] as const) {
        descritores.push([prop, Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)]);
        Object.defineProperty(HTMLElement.prototype, prop, {
            configurable: true,
            get(this: HTMLElement) {
                if (!this.classList.contains('modal-overview')) return 0;
                const caixa = caixaDaSinopse(this);
                return prop === 'scrollHeight' ? caixa.inteira : caixa.visivel;
            },
        });
    }
});

afterAll(() => {
    folha?.remove();
    for (const [prop, original] of descritores) {
        if (original) Object.defineProperty(HTMLElement.prototype, prop, original);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
    }
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

type PropsDaFicha = ComponentProps<typeof ContentDetailModal>;

function ficha(props: {
    contentId?: string; plot: string; tipo?: 'movie' | 'series';
    extra?: Pick<PropsDaFicha, 'versions' | 'onSelectVersion' | 'catalogoFilmes' | 'onOpenRelated'>;
}) {
    return (
        <ContentDetailModal
            isOpen
            onClose={() => {}}
            contentId={props.contentId ?? '42'}
            contentType={props.tipo ?? 'movie'}
            contentData={{ name: 'Título de Teste', cover: '', plot: props.plot }}
            onPlay={() => {}}
            {...props.extra}
        />
    );
}

function tecla(key: string) {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
}

function sinopse(container: HTMLElement): HTMLElement {
    const el = container.querySelector<HTMLElement>('.modal-overview');
    if (!el) throw new Error('a ficha não renderizou a sinopse');
    return el;
}

/**
 * O elemento com o destaque do D-pad — exige que haja exatamente UM. A ficha
 * usa as duas convenções de foco do app: `.focused` e, nas versões,
 * `.tv-focused`.
 */
function destacado(container: HTMLElement): HTMLElement {
    const focados = [...container.querySelectorAll<HTMLElement>('.focused, .tv-focused')];
    if (focados.length !== 1) {
        throw new Error(`esperava UM elemento destacado, há ${focados.length}: ${JSON.stringify(focados.map(f => f.className))}`);
    }
    return focados[0];
}

/** Onde o destaque do D-pad está agora, descrito pelo que a pessoa vê. */
function focoAtual(container: HTMLElement): string {
    const el = destacado(container);
    if (el.classList.contains('modal-close-btn')) return 'fechar';
    if (el.querySelector('.modal-overview') || el.classList.contains('modal-overview')) return 'sinopse';
    if (el.classList.contains('season-tab')) return 'temporada';
    if (el.classList.contains('saga-card')) return 'saga';
    if (el.classList.contains('version-btn')) return 'versão';
    if (el.closest('.modal-actions')) return `ação:${(el.textContent || '').trim()}`;
    return el.className;
}

function textoVisivelEInteiro(el: HTMLElement): boolean {
    return el.clientHeight >= el.scrollHeight;
}

/** Resposta do TMDB que o teste solta quando quiser (chega DEPOIS do provedor). */
function tmdbPendente() {
    let soltar: (overview: string) => void = () => { throw new Error('o TMDB não foi consultado'); };
    const resposta = new Promise<TMDBMovieDetails | null>(resolve => {
        soltar = overview => resolve({ overview, genres: [] } as unknown as TMDBMovieDetails);
    });
    vi.mocked(searchMovieByName).mockImplementationOnce(() => resposta);
    return (overview: string) => act(async () => { soltar(overview); await resposta; });
}

describe('sinopse da ficha (T115)', () => {
    it('a folha não trava a sinopse em pixels e a letra é de leitura a três metros', () => {
        const { container } = render(ficha({ plot: SINOPSE_LONGA }));
        const estilo = getComputedStyle(sinopse(container));
        expect(px(estilo.fontSize)).toBeGreaterThanOrEqual(20);
        // max-height em px corta no meio da 3ª linha assim que a fonte cresce
        expect(estilo.maxHeight).not.toMatch(/px$/);
    });

    it('filme com sinopse longa: o D-pad chega nela entre o X e as ações, e o OK revela e recolhe o texto', async () => {
        const { container } = render(ficha({ plot: SINOPSE_LONGA }));
        const p = sinopse(container);
        await waitFor(() => expect(focoAtual(container)).toBe('ação:▶Assistir Filme'));

        // Recolhida: o texto não cabe, e a ficha diz que há mais
        expect(textoVisivelEInteiro(p)).toBe(false);
        expect(container.textContent).toContain('Ler sinopse inteira');

        // Assistir ↑ → sinopse (antes ia direto pro X)
        tecla('ArrowUp');
        expect(focoAtual(container)).toBe('sinopse');

        // O destaque é VISÍVEL: a zona focada ganha o anel da folha
        const zona = destacado(container);
        // (o jsdom não desdobra o atalho `outline` nas longhands)
        expect(getComputedStyle(zona).getPropertyValue('outline').split(' ')).toContain('solid');

        // OK revela o texto inteiro
        tecla('Enter');
        expect(textoVisivelEInteiro(sinopse(container))).toBe(true);
        expect(container.textContent).toContain('Recolher sinopse');

        // OK de novo recolhe
        tecla('Enter');
        expect(textoVisivelEInteiro(sinopse(container))).toBe(false);

        // A cadeia vertical segue a ordem do DOM: X ↔ sinopse ↔ ações
        tecla('ArrowUp');
        expect(focoAtual(container)).toBe('fechar');
        tecla('ArrowDown');
        expect(focoAtual(container)).toBe('sinopse');
        tecla('ArrowDown');
        expect(focoAtual(container)).toBe('ação:▶Assistir Filme');
    });

    it('focar a sinopse a traz para a tela, e abrir rola de novo para o texto que cresceu', async () => {
        const { container } = render(ficha({ plot: SINOPSE_LONGA }));
        await waitFor(() => expect(focoAtual(container)).toBe('ação:▶Assistir Filme'));
        const rolar = vi.spyOn(Element.prototype, 'scrollIntoView');
        const rolagensDa = (el: Element) => rolar.mock.contexts.filter(c => c === el).length;

        tecla('ArrowUp');
        const zona = destacado(container);
        expect(zona.contains(sinopse(container))).toBe(true);
        expect(rolagensDa(zona)).toBe(1);

        tecla('Enter');
        expect(textoVisivelEInteiro(sinopse(container))).toBe(true);
        expect(rolagensDa(zona)).toBe(2);
    });

    it('sinopse que cabe inteira não ganha parada no D-pad nem convite a ler mais', async () => {
        const { container } = render(ficha({ plot: SINOPSE_CURTA }));
        await waitFor(() => expect(focoAtual(container)).toBe('ação:▶Assistir Filme'));
        expect(textoVisivelEInteiro(sinopse(container))).toBe(true);
        expect(container.textContent).not.toContain('Ler sinopse inteira');

        // Uma parada que não faz nada é o defeito mais comum do repositório
        tecla('ArrowUp');
        expect(focoAtual(container)).toBe('fechar');
        tecla('ArrowDown');
        expect(focoAtual(container)).toBe('ação:▶Assistir Filme');
    });

    it('a sinopse longa do TMDB, que chega depois da curta do provedor, ganha a zona', async () => {
        const responderTmdb = tmdbPendente();
        const { container } = render(ficha({ plot: SINOPSE_CURTA }));
        await waitFor(() => expect(focoAtual(container)).toBe('ação:▶Assistir Filme'));
        expect(container.textContent).not.toContain('Ler sinopse inteira');

        await responderTmdb(SINOPSE_LONGA);
        expect(sinopse(container).textContent).toBe(SINOPSE_LONGA);
        expect(container.textContent).toContain('Ler sinopse inteira');
        tecla('ArrowUp');
        expect(focoAtual(container)).toBe('sinopse');
    });

    it('com o foco na sinopse, se o texto do TMDB passa a caber o foco volta ao Assistir', async () => {
        const responderTmdb = tmdbPendente();
        const { container } = render(ficha({ plot: SINOPSE_LONGA }));
        await waitFor(() => expect(focoAtual(container)).toBe('ação:▶Assistir Filme'));
        tecla('ArrowUp');
        expect(focoAtual(container)).toBe('sinopse');

        await responderTmdb(SINOPSE_CURTA);
        expect(sinopse(container).textContent).toBe(SINOPSE_CURTA);
        // Nada de foco parado numa zona que não existe mais
        await waitFor(() => expect(focoAtual(container)).toBe('ação:▶Assistir Filme'));
        expect(container.textContent).not.toContain('Ler sinopse inteira');
    });

    it('no navegador, clicar na sinopse também abre e recolhe', async () => {
        const { container } = render(ficha({ plot: SINOPSE_LONGA }));
        await waitFor(() => expect(focoAtual(container)).toBe('ação:▶Assistir Filme'));
        const zona = sinopse(container).parentElement as HTMLElement;

        fireEvent.click(zona);
        expect(textoVisivelEInteiro(sinopse(container))).toBe(true);
        fireEvent.click(zona);
        expect(textoVisivelEInteiro(sinopse(container))).toBe(false);
    });

    it('clicar na sinopse que cabe não faz nada — nem a deixa aberta às escondidas para o texto longo do TMDB', async () => {
        const responderTmdb = tmdbPendente();
        const { container } = render(ficha({ plot: SINOPSE_CURTA }));
        await waitFor(() => expect(focoAtual(container)).toBe('ação:▶Assistir Filme'));

        fireEvent.click(sinopse(container).parentElement as HTMLElement);

        // O texto longo chega depois: tem de vir recolhido, com o convite
        await responderTmdb(SINOPSE_LONGA);
        expect(textoVisivelEInteiro(sinopse(container))).toBe(false);
        expect(container.textContent).toContain('Ler sinopse inteira');
    });

    it('trocar de conteúdo com a ficha aberta volta a sinopse para recolhida', async () => {
        const { container, rerender } = render(ficha({ contentId: '42', plot: SINOPSE_LONGA }));
        await waitFor(() => expect(focoAtual(container)).toBe('ação:▶Assistir Filme'));
        tecla('ArrowUp');
        tecla('Enter');
        expect(textoVisivelEInteiro(sinopse(container))).toBe(true);

        // Outra versão/filme da saga troca o contentId sem fechar a ficha
        rerender(ficha({ contentId: '43', plot: FRASE.repeat(12).trim() }));
        await waitFor(() => expect(focoAtual(container)).toBe('ação:▶Assistir Filme'));
        expect(textoVisivelEInteiro(sinopse(container))).toBe(false);
        expect(container.textContent).toContain('Ler sinopse inteira');
    });

    it('filme com saga e versões: X ↓ sinopse ↓ saga ↓ versões ↓ Assistir, e o caminho inverso passa pela sinopse', async () => {
        vi.mocked(searchMovieByName).mockResolvedValueOnce({
            overview: SINOPSE_LONGA, genres: [],
            belongs_to_collection: { id: 9, name: 'Saga de Teste', poster_path: null },
        } as unknown as TMDBMovieDetails);
        vi.mocked(fetchColecao).mockResolvedValueOnce({
            id: 9, name: 'Saga de Teste',
            parts: [{ id: 1, title: 'Filme 1', year: '2001', poster_path: null }],
        });
        const { container } = render(ficha({
            plot: SINOPSE_LONGA,
            extra: {
                versions: [{ id: '42', label: 'DUB' }, { id: '43', label: 'LEG' }],
                onSelectVersion: () => {},
                catalogoFilmes: [{ stream_id: 100, name: 'Filme 1', tmdb_id: 1 }],
                onOpenRelated: () => {},
            },
        }));
        await waitFor(() => expect(container.querySelectorAll('.saga-card')).toHaveLength(1));
        expect(focoAtual(container)).toBe('ação:▶Assistir Filme');

        const percorrer = (key: string, passos: number) => Array.from({ length: passos }, () => {
            tecla(key);
            return focoAtual(container);
        });
        expect(percorrer('ArrowUp', 4)).toEqual(['versão', 'saga', 'sinopse', 'fechar']);
        expect(percorrer('ArrowDown', 4)).toEqual(['sinopse', 'saga', 'versão', 'ação:▶Assistir Filme']);
    });

    it('filme só com versões: versões ↑ chega na sinopse e sinopse ↓ volta nas versões', async () => {
        const { container } = render(ficha({
            plot: SINOPSE_LONGA,
            extra: { versions: [{ id: '42', label: 'DUB' }, { id: '43', label: 'LEG' }], onSelectVersion: () => {} },
        }));
        await waitFor(() => expect(focoAtual(container)).toBe('ação:▶Assistir Filme'));
        tecla('ArrowUp');
        expect(focoAtual(container)).toBe('versão');
        tecla('ArrowUp');
        expect(focoAtual(container)).toBe('sinopse');
        tecla('ArrowDown');
        expect(focoAtual(container)).toBe('versão');
    });

    it('série com sinopse longa: Assistir ↑ temporadas ↑ sinopse ↑ X, e X ↓ sinopse ↓ temporadas', async () => {
        const episodio = (n: number): Episode => ({
            id: `ep${n}`, episode_num: n, title: `Episódio ${n}`, container_extension: 'mp4',
            custom_sid: '', added: '', season: 1, direct_source: '',
            info: { duration_secs: 0, duration: '', plot: '', releasedate: '' },
        });
        const serie = {
            seasons: {},
            info: {},
            episodes: { '1': [episodio(1), episodio(2)], '2': [episodio(1)] },
        } as unknown as SeriesInfo;
        vi.spyOn(api, 'getSeriesInfo').mockResolvedValue(serie);

        const { container } = render(ficha({ contentId: '7', plot: SINOPSE_LONGA, tipo: 'series' }));
        await waitFor(() => expect(container.querySelectorAll('.season-tab')).toHaveLength(2));
        expect(focoAtual(container)).toBe('ação:▶Assistir T1 E1');

        // Assistir ↑ vai às temporadas, não à sinopse: no DOM elas ficam entre
        // a sinopse e as ações. Só o passo seguinte chega na sinopse.
        tecla('ArrowUp');
        expect(focoAtual(container)).toBe('temporada');
        tecla('ArrowUp');
        expect(focoAtual(container)).toBe('sinopse');
        tecla('ArrowUp');
        expect(focoAtual(container)).toBe('fechar');

        // X ↓ sinopse ↓ temporadas
        tecla('ArrowDown');
        expect(focoAtual(container)).toBe('sinopse');
        tecla('Enter');
        expect(textoVisivelEInteiro(sinopse(container))).toBe(true);
        tecla('ArrowDown');
        expect(focoAtual(container)).toBe('temporada');
        tecla('ArrowUp');
        expect(focoAtual(container)).toBe('sinopse');
        tecla('ArrowUp');
        expect(focoAtual(container)).toBe('fechar');
    });

    it('série sem temporadas: Assistir ↑ chega na sinopse e ↓ volta, a mesma aresta nos dois sentidos', async () => {
        vi.spyOn(api, 'getSeriesInfo').mockResolvedValue({ seasons: {}, info: {}, episodes: {} } as unknown as SeriesInfo);

        const { container } = render(ficha({ contentId: '8', plot: SINOPSE_LONGA, tipo: 'series' }));
        await waitFor(() => expect(container.textContent).not.toContain('Carregando episódios'));
        expect(container.querySelectorAll('.season-tab')).toHaveLength(0);
        expect(focoAtual(container)).toBe('ação:▶Assistir T1 E1');

        tecla('ArrowUp');
        expect(focoAtual(container)).toBe('sinopse');
        tecla('ArrowDown');
        expect(focoAtual(container)).toBe('ação:▶Assistir T1 E1');
    });
});
