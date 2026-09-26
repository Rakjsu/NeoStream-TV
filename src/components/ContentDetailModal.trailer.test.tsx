// @vitest-environment jsdom
//
// 🎬 O botão do trailer era um ▶ pelado ao lado do ▶ do Assistir (T032).
//
// A etiqueta vivia só em `title="Ver o trailer"`, e `title` é tooltip de
// mouse: na TV não existe ponteiro parado sobre o botão, então ela nunca
// aparece. A três metros a fila de ações da ficha mostrava dois triângulos de
// play lado a lado — o segundo parecia botão repetido, e quem apertava ali
// achando que era play era levado pra FORA do app (na TV o trailer é entregue
// a outro app pelo sistema, ver services/tizenApp.abrirExterno).
//
// O teste olha o que se LÊ na tela (texto dos botões), nos dois alvos: no
// navegador o trailer abre dentro da ficha; na TV ele sai do app, e o botão
// tem de dizer isso antes de a pessoa apertar — e o OK e o clique entregam a
// URL ao sistema, nunca um iframe.

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';

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

const CHAVE = 'abcdefghijk';

beforeAll(() => {
    // jsdom não implementa scrollIntoView, e a ficha chama ao abrir
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (window as unknown as { tizen?: unknown }).tizen;
});

function abrirFilme() {
    return render(
        <ContentDetailModal
            isOpen
            onClose={() => {}}
            contentId="42"
            contentType="movie"
            contentData={{
                name: 'Filme de Teste',
                cover: '',
                youtubeTrailer: `https://www.youtube.com/watch?v=${CHAVE}`,
            }}
            onPlay={() => {}}
        />
    );
}

/** O texto de cada botão da fila de ações, como aparece na tela. */
function textosDasAcoes(container: HTMLElement): string[] {
    const acoes = container.querySelector('.modal-actions');
    if (!acoes) throw new Error('fila de ações da ficha não renderizou');
    return [...acoes.querySelectorAll('button')].map(b => (b.textContent || '').trim());
}

function botaoTrailer(container: HTMLElement): HTMLButtonElement {
    const acoes = [...container.querySelectorAll<HTMLButtonElement>('.modal-actions button')];
    const trailer = acoes.find(b => (b.textContent || '').includes('Trailer'));
    if (!trailer) {
        throw new Error(`nenhum botão com "Trailer" escrito; a fila mostra: ${JSON.stringify(acoes.map(b => b.textContent))}`);
    }
    return trailer;
}

function tecla(key: string) {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
}

/**
 * Os rótulos que vêm DEPOIS do `.icon`, como elementos. No Chromium 69 não há
 * `gap` em flex: quem separa ícone e rótulo é `.action-btn > * + *` (ver
 * flex-gap-fallback.css), e esse seletor só pega ELEMENTO — texto solto ao lado
 * do ícone ficaria colado nele.
 */
function rotuloDepoisDoIcone(botao: HTMLElement): string[] {
    const soltos = [...botao.childNodes]
        .filter(no => no.nodeType === Node.TEXT_NODE && (no.textContent || '').trim());
    if (soltos.length > 0) throw new Error(`texto solto no botão: ${JSON.stringify(soltos.map(n => n.textContent))}`);
    const filhos = [...botao.children];
    if (!filhos[0]?.classList.contains('icon')) throw new Error('o primeiro filho do botão não é o `.icon`');
    return filhos.slice(1).map(el => el.textContent || '');
}

/** Um Tizen falso que sabe abrir URL em app externo e registra o pedido. */
function tvComAppExterno() {
    const aberturas: { operacao: string; uri: string }[] = [];
    class ApplicationControlFalso {
        operation: string;
        uri?: string;
        constructor(operation: string, uri?: string) {
            this.operation = operation;
            this.uri = uri;
        }
    }
    (window as unknown as { tizen?: unknown }).tizen = {
        application: {
            launchAppControl: (controle: { operation: string; uri?: string }) => {
                aberturas.push({ operacao: controle.operation, uri: controle.uri || '' });
            },
        },
        ApplicationControl: ApplicationControlFalso,
    };
    vi.stubGlobal('__BUILD_TARGET__', 'tizen');
    return aberturas;
}

describe('botão do trailer na ficha', () => {
    it('no navegador tem texto visível, ícone diferente do play, e abre o trailer na ficha', async () => {
        const { container } = abrirFilme();
        const trailer = await waitFor(() => botaoTrailer(container));

        expect(textosDasAcoes(container)).toEqual([
            '▶Assistir Filme',
            '+Assistir Depois',
            '♡',
            '🎬Trailer',
        ]);
        // Só UM botão da fila pode ter o triângulo de play: o Assistir
        expect(textosDasAcoes(container).filter(t => t.includes('▶'))).toEqual(['▶Assistir Filme']);
        // Mesmo formato do principal: o ícone é um span `.icon` separado do texto
        expect(trailer.querySelector('.icon')?.textContent).toBe('🎬');
        // ...e o rótulo é um elemento depois dele, pro espaço existir na TV
        expect(rotuloDepoisDoIcone(trailer)).toEqual(['Trailer']);
        // Não é mais a bolinha de 54px do Favorito (texto não cabe nela), nem
        // veste o `.play-btn` do Assistir (seria de novo "dois plays"): é a
        // pílula secundária, a mesma do Assistir Depois
        expect(trailer.classList.contains('favorite-btn')).toBe(false);
        expect(trailer.classList.contains('play-btn')).toBe(false);
        expect(trailer.classList.contains('secondary-btn')).toBe(true);
        // A explicação não depende mais de tooltip de mouse
        expect(trailer.getAttribute('title')).toBeNull();

        // Clicar continua abrindo o trailer embutido (caminho do navegador)
        expect(document.querySelector('iframe')).toBeNull();
        act(() => { trailer.click(); });
        await waitFor(() => expect(document.querySelector('iframe')?.getAttribute('src'))
            .toContain(`/embed/${CHAVE}`));
    });

    it('na TV avisa que sai do app, e o OK no botão entrega a URL ao sistema', async () => {
        const aberturas = tvComAppExterno();
        const { container } = abrirFilme();
        const trailer = await waitFor(() => botaoTrailer(container));
        // O ouvinte do useTVNavigation é re-registrado num efeito
        await act(async () => { await Promise.resolve(); });

        expect(trailer.textContent?.trim()).toBe('🎬Trailer (sai do app)');
        expect(rotuloDepoisDoIcone(trailer)).toEqual(['Trailer (sai do app)']);
        expect(textosDasAcoes(container).filter(t => t.includes('▶'))).toEqual(['▶Assistir Filme']);

        // D-pad: Assistir → Assistir Depois → Favorito → Trailer
        for (const esperado of ['Assistir Depois', '♡', 'Trailer (sai do app)']) {
            tecla('ArrowRight');
            await waitFor(() => expect(container.querySelector('.modal-actions .focused')?.textContent)
                .toContain(esperado));
        }
        expect(aberturas).toEqual([]);

        const pedido = {
            operacao: 'http://tizen.org/appcontrol/operation/view',
            uri: `https://www.youtube.com/watch?v=${CHAVE}`,
        };
        tecla('Enter');
        expect(aberturas).toEqual([pedido]);

        // Controle com ponteiro (clique) vai pelo MESMO caminho: sai do app
        act(() => { trailer.click(); });
        expect(aberturas).toEqual([pedido, pedido]);
        // Na TV nunca há iframe (ver services/tizenApp)
        expect(document.querySelector('iframe')).toBeNull();
    });
});
