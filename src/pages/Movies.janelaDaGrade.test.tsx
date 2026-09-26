// @vitest-environment jsdom
//
// 🧱 A grade de Filmes crescia sem teto (T020).
//
// O salto da barra A-Z já foi reescrito porque montar milhares de cards de uma
// vez fazia o sistema encerrar o app ("escolher 'S' montava ~6 mil cards no
// mesmo frame"). Mas só o atalho foi fechado: segurando ↓ numa categoria grande,
// `visibleCount` subia 24 por passo e NUNCA encolhia — chegar ao item 6 mil
// montava 6 mil cards, os mesmos 36 mil nós, só que em prestações. CH+ e a
// rolagem do mouse faziam o mesmo.
//
// Aqui roda a página DE VERDADE (só a rede do provedor é falsa). O jsdom não
// faz layout, então o teste dá a cada card o `offsetTop` que ele teria na grade
// INTEIRA (fileira × passo): é contra essa geometria que o espaçador acima dos
// cards montados tem de bater — senão a grade "pula" quando a janela anda.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { api } from '../services/api';
import { installFakeStorage } from '../testing/fakeStorage';
import type { VODStream, Category } from '../types';
import { Movies } from './Movies';

const TOTAL = 600;           // 100 fileiras de 6: 5x o teto do teste
const COLUNAS = 6;           // .movies-grid: repeat(6, 1fr)
const PASSO = 306;           // altura da fileira + gap (px), a geometria falsa
const TOPO_DA_GRADE = 100;   // padding-top do .movies-content
const ALTURA_DA_TELA = 1080; // TV em 1080p
/**
 * Descendo, o focado fica no PÉ da tela: as fileiras que cabem acima dele
 * (1080 / 306 = 3) estão à vista e não podem virar espaçador em branco.
 */
const FILEIRAS_A_VISTA_ACIMA = Math.floor(ALTURA_DA_TELA / PASSO);
/**
 * Teto de cards montados que o teste aceita: 20 fileiras. A tela mostra ~4;
 * o resto é folga pra capa chegar antes (PosterPreguicoso) e pro D-pad não
 * esbarrar na borda. O número exato é do código; o teste só cobra que EXISTE.
 */
const TETO = 20 * COLUNAS;
/** Centenas de teclas, cada uma com um render da página: folga pro CI mais lento. */
const LONGO = 30_000;

function filme(id: number): VODStream {
    return {
        num: id, name: `Filme n${id}`, stream_type: 'movie', stream_id: id,
        stream_icon: `http://img.test/filme-${id}.jpg`, container_extension: 'mp4',
        custom_sid: '', direct_source: '', added: '0', category_id: '1',
        rating: '', rating_5based: 0, backdrop_path: [], youtube_trailer: '',
        episode_run_time: '', cover: '', plot: '', cast: '',
    } as unknown as VODStream;
}
// "n" antes do número: "Filme 1080" e "Filme 720" viram tag de qualidade e o
// catálogo os agrupa como versões do mesmo "Filme" (vodVariants)
const CATEGORIAS: Category[] = [{ category_id: '1', category_name: 'Todos', parent_id: 0 } as Category];

/** Índice ABSOLUTO (0-based) do filme que o card mostra — sai do título. */
function indiceDoCard(card: Element): number {
    const titulo = card.querySelector('.movie-title')?.textContent || '';
    const m = /^Filme n(\d+)$/.exec(titulo.trim());
    if (!m) throw new Error(`card com título inesperado: "${titulo}" — o teste não sabe onde ele fica`);
    return Number(m[1]) - 1;
}

// ---- geometria falsa ----------------------------------------------------
let offsetTopOriginal: PropertyDescriptor | undefined;
beforeAll(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () { /* jsdom */ };
    offsetTopOriginal = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
        configurable: true,
        get(this: HTMLElement) {
            if (this.classList.contains('movies-grid')) return TOPO_DA_GRADE;
            // Onde o card ficaria na grade INTEIRA: é isso que o espaçador
            // precisa reproduzir para a janela andar sem a tela pular.
            if (this.classList.contains('movie-card')) {
                return TOPO_DA_GRADE + Math.floor(indiceDoCard(this) / COLUNAS) * PASSO;
            }
            return 0;
        },
    });
});
afterAll(() => {
    if (offsetTopOriginal) Object.defineProperty(HTMLElement.prototype, 'offsetTop', offsetTopOriginal);
});

beforeEach(() => {
    installFakeStorage();
    vi.spyOn(api, 'getVODStreams').mockResolvedValue(Array.from({ length: TOTAL }, (_, i) => filme(i + 1)));
    vi.spyOn(api, 'getVodCategories').mockResolvedValue(CATEGORIAS);
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

// ---- ajudantes ----------------------------------------------------------
const cards = () => [...document.querySelectorAll('.movie-card')];
const grade = () => document.querySelector('.movies-grid') as HTMLElement;
const rolagem = () => document.querySelector('.movies-content') as HTMLElement;

async function montar() {
    const pagina = render(<Movies />);
    await waitFor(() => expect(cards().length).toBeGreaterThan(COLUNAS));
    // O ouvinte do useTVNavigation é re-registrado num efeito: esvazia os
    // efeitos antes da primeira tecla, senão ela cai no ouvinte velho
    await act(async () => { await Promise.resolve(); });
    return pagina;
}

const tecla = (key: string, keyCode: number) => {
    act(() => { fireEvent.keyDown(window, { key, keyCode }); });
};
const baixo = () => tecla('ArrowDown', 40);
const cima = () => tecla('ArrowUp', 38);
const paginaAbaixo = () => tecla('PageDown', 34);

/** Os invariantes que valem a CADA passo, com o índice que deveria estar focado. */
function conferir(focoEsperado: number, passo: string) {
    const montados = cards();
    expect(montados.length, `${passo}: ${montados.length} cards montados (teto ${TETO})`).toBeLessThanOrEqual(TETO);

    const focados = montados.filter(c => c.classList.contains('tv-focused'));
    expect(focados, `${passo}: o card focado tem de estar MONTADO (senão o scroll não acha)`).toHaveLength(1);
    expect(indiceDoCard(focados[0]), `${passo}: o anel está no filme errado`).toBe(focoEsperado);

    // Os montados são uma faixa contínua da lista, começando no início de uma fileira
    const indices = montados.map(indiceDoCard);
    const primeiro = indices[0];
    expect(primeiro % COLUNAS, `${passo}: janela começando no meio de uma fileira`).toBe(0);
    indices.forEach((indice, i) => expect(indice).toBe(primeiro + i));

    // O que a tela mostra ACIMA do focado também está montado (a faixa é
    // contínua, então basta ela começar antes)
    const linhaDoFoco = Math.floor(focoEsperado / COLUNAS);
    const primeiraAVista = Math.max(0, linhaDoFoco - FILEIRAS_A_VISTA_ACIMA);
    expect(primeiro / COLUNAS, `${passo}: a fileira ${primeiraAVista}, à vista acima do focado, não está montada`)
        .toBeLessThanOrEqual(primeiraAVista);

    // O espaçador ocupa exatamente as fileiras que NÃO estão montadas acima
    const espacador = parseFloat(grade().style.paddingTop || '0');
    expect(espacador, `${passo}: espaçador não bate com as ${primeiro / COLUNAS} fileiras de cima`)
        .toBe((primeiro / COLUNAS) * PASSO);
}

describe('Filmes — a grade tem teto de cards montados (T020)', () => {
    it('segurar ↓ até o fim de 600 títulos nunca passa do teto; o focado está sempre montado', async () => {
        await montar();
        conferir(0, 'início');
        for (let linha = 1; linha < TOTAL / COLUNAS; linha++) {
            baixo();
            conferir(linha * COLUNAS, `↓ nº ${linha}`);
        }
        // Chegou ao último filme da coluna 0; ele e a última fileira estão na tela
        expect(cards().some(c => indiceDoCard(c) === TOTAL - 1)).toBe(true);
    }, LONGO);

    it('e subir de volta com ↑ remonta as fileiras de cima até o topo, sem espaçador', async () => {
        await montar();
        // Fundo o bastante pra janela ter largado o topo (60 fileiras = 360 filmes)
        const fundo = 60;
        for (let linha = 1; linha <= fundo; linha++) baixo();
        expect(indiceDoCard(cards()[0]), 'a janela nem chegou a andar').toBeGreaterThan(0);
        for (let linha = fundo - 1; linha >= 0; linha--) {
            cima();
            conferir(linha * COLUNAS, `↑ até a fileira ${linha}`);
        }
        expect(indiceDoCard(cards()[0])).toBe(0);
        expect(parseFloat(grade().style.paddingTop || '0')).toBe(0);
    }, LONGO);

    it('CH+ (página inteira) também anda com a janela, sem acumular', async () => {
        await montar();
        let esperado = 0;
        for (let i = 0; i < 40; i++) {
            paginaAbaixo();
            esperado = Math.min(TOTAL - 1, esperado + COLUNAS * 3);
            conferir(esperado, `CH+ nº ${i + 1}`);
        }
    }, LONGO);

    it('rolar com o mouse até o meio monta a região da tela, não tudo que ficou acima', async () => {
        await montar();
        const caixa = rolagem();
        const linhaNoTopo = 70;
        Object.defineProperty(caixa, 'clientHeight', { configurable: true, value: ALTURA_DA_TELA });
        Object.defineProperty(caixa, 'scrollTop', {
            configurable: true, writable: true, value: TOPO_DA_GRADE + linhaNoTopo * PASSO,
        });
        act(() => { caixa.dispatchEvent(new Event('scroll')); });

        const montados = cards();
        expect(montados.length).toBeLessThanOrEqual(TETO);
        const indices = new Set(montados.map(indiceDoCard));
        // As fileiras que a tela mostra (70..73 com 1080 px) estão montadas
        for (let linha = linhaNoTopo; linha <= linhaNoTopo + 3; linha++) {
            expect(indices.has(linha * COLUNAS), `fileira ${linha} na tela e não montada`).toBe(true);
        }
        const primeiro = indiceDoCard(montados[0]);
        expect(parseFloat(grade().style.paddingTop || '0')).toBe((primeiro / COLUNAS) * PASSO);
    });

    it('rolar com o mouse até o fundo e depois buscar mostra o resultado, não uma grade vazia', async () => {
        // O foco do D-pad fica no topo (o mouse não o move) e a janela desceu
        // com a rolagem. A busca encolhe a lista para 11 títulos: uma janela
        // que ficasse lá embaixo fatiaria a lista nova no vazio, e o espaçador
        // de 60 fileiras seguraria a tela em branco.
        await montar();
        const caixa = rolagem();
        Object.defineProperty(caixa, 'clientHeight', { configurable: true, value: ALTURA_DA_TELA });
        Object.defineProperty(caixa, 'scrollTop', {
            configurable: true, writable: true, value: TOPO_DA_GRADE + 70 * PASSO,
        });
        act(() => { caixa.dispatchEvent(new Event('scroll')); });
        expect(indiceDoCard(cards()[0]), 'a rolagem nem levou a janela pra baixo').toBeGreaterThan(0);

        const busca = document.querySelector('.search-input') as HTMLInputElement;
        act(() => { fireEvent.change(busca, { target: { value: 'Filme n7' } }); });

        // "Filme n7" e "Filme n70".."Filme n79"
        const achados = cards().map(indiceDoCard).sort((a, b) => a - b);
        expect(achados, 'a busca achou 11 filmes e a grade não mostra todos').toEqual(
            [6, ...Array.from({ length: 10 }, (_, i) => 69 + i)],
        );
        expect(parseFloat(grade().style.paddingTop || '0'), 'espaçador sobrou acima do resultado').toBe(0);
    });

    it('numa tela mais alta que o teto, tudo que a tela mostra continua montado', async () => {
        // Janela do navegador esticada (build web): 24 fileiras à vista, mais
        // que o teto. O teto existe pra não montar o que NINGUÉM vê — nunca
        // pode abrir buraco no meio da tela.
        await montar();
        const caixa = rolagem();
        const linhaNoTopo = 50;
        const aVista = 24;
        Object.defineProperty(caixa, 'clientHeight', { configurable: true, value: aVista * PASSO });
        Object.defineProperty(caixa, 'scrollTop', {
            configurable: true, writable: true, value: TOPO_DA_GRADE + linhaNoTopo * PASSO,
        });
        act(() => { caixa.dispatchEvent(new Event('scroll')); });

        const indices = new Set(cards().map(indiceDoCard));
        for (let linha = linhaNoTopo; linha < linhaNoTopo + aVista; linha++) {
            expect(indices.has(linha * COLUNAS), `fileira ${linha} na tela e não montada`).toBe(true);
        }
    });

    it('sair da página desarma o ouvinte de rolagem', async () => {
        const armados = new Set<EventListenerOrEventListenerObject>();
        const add = EventTarget.prototype.addEventListener;
        const remove = EventTarget.prototype.removeEventListener;
        vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (this: EventTarget, tipo, fn, opcoes) {
            if (tipo === 'scroll' && this instanceof HTMLElement && this.classList.contains('movies-content') && fn) armados.add(fn);
            return add.call(this, tipo, fn, opcoes);
        });
        vi.spyOn(EventTarget.prototype, 'removeEventListener').mockImplementation(function (this: EventTarget, tipo, fn, opcoes) {
            if (tipo === 'scroll' && fn) armados.delete(fn);
            return remove.call(this, tipo, fn, opcoes);
        });

        const pagina = await montar();
        baixo();
        expect(armados.size, 'a grade precisa ouvir a rolagem do mouse').toBeGreaterThan(0);
        pagina.unmount();
        expect(armados.size, 'ouvinte de rolagem vivo depois de sair da página').toBe(0);
    });
});

// Execução: npx vitest run src/pages/Movies.janelaDaGrade.test.tsx
