// @vitest-environment jsdom
//
// 🧱 Teto de nós da grade de Filmes (T082).
//
// A grade crescia sem teto: `visibleCount` ganhava fileiras a cada ↓, → ou CH+
// (e a cada evento de rolagem) e nunca encolhia. Quem segurava ↓ num "Todos"
// de 8 mil títulos até o item 6 mil montava 6 mil cards — os mesmos ~36 mil
// nós que já fizeram o sistema do Tizen encerrar o app quando o salto A-Z
// fazia `visibleCount = índice + 18` (esse atalho foi fechado; a escada não).
// Build verde, navegador rápido, TV encerrada: é o tipo de defeito que volta
// sem ninguém ver, então aqui ele vira número.
//
// O teste monta a PÁGINA DE VERDADE (só a rede do provedor é falsa) e conta
// nós depois de CADA tecla — o que mata a TV é o pico, não o estado final.
// Ele não sabe COMO a grade limita os cards (janela, espaçador, paginação):
// só cobra o contrato que qualquer implementação tem de cumprir:
//  - `.movie-card` nunca passa de TETO_DE_CARDS, por mais longe que se desça;
//  - `img[src]` também não — e isto roda SEM IntersectionObserver, o pior caso
//    (o PosterPreguicoso cai no "carrega na hora": uma capa por card montado;
//    que a capa espere o card chegar perto da tela é o gradesPreguicosas.test);
//  - o card focado está sempre montado, é o título certo e tem a capa — por
//    ↓, →, CH+ e CH-, não só pelo caminho que a janela da grade testa —, e a
//    cada tecla as fileiras de cima e de baixo dele também estão montadas;
//  - voltar lá pra cima traz o começo da lista de volta (a janela anda pros
//    dois lados, não é só um corte), e o último filme continua alcançável;
//  - a rolagem do mouse (build web, ponteiro do controle) também tem teto e
//    nunca deixa em branco uma fileira que está na tela — um teto que só
//    cortasse a fatia prenderia o mouse nos primeiros 150 cards.
//
// Complementa o Movies.janelaDaGrade.test.tsx (T020), que confere a geometria
// da janela (espaçador, histerese) com ↓, CH+ e um salto de rolagem.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { api } from '../services/api';
import type { VODStream, Category } from '../types';
import { Movies } from './Movies';

/** Um "Todos" de lista IPTV grande: é onde a escada leva ao crash. */
const CATALOGO = 8000;
/**
 * Teto escolhido POR ESTE TESTE, não copiado da página: uma tela de 1080p
 * mostra ~3 fileiras de 6 (18 cards); 150 cards são mais de 8 telas cheias.
 * Se algum dia a grade precisar montar mais, que seja uma decisão explícita
 * aqui — não um `setVisibleCount(prev + algo)` que passa calado.
 */
const TETO_DE_CARDS = 150;
const COLUNAS = 6; // .movies-grid: repeat(6, 1fr); o D-pad da página usa o mesmo
/** ↓ e → que o teste aperta: o código antigo estourava o teto no ↓ nº 21 e no → nº 127. */
const APERTOS_BAIXO = 60;
const APERTOS_DIREITA = 200;
/** Centenas de teclas, cada uma com um render da página: folga pro CI carregado. */
const LONGO = 120_000;
/**
 * Rolagem do mouse: quantas fileiras descer, uma por evento. Bem além do teto
 * (150 cards = 25 fileiras): a fatia crescente estourava na 10ª, e um teto
 * sem janela que acompanha a rolagem deixava a fileira 20 em branco.
 */
const FILEIRAS_ROLADAS = 120;
// Geometria falsa da rolagem: o jsdom não faz layout, então o teste dá a cada
// card o `offsetTop` que ele teria na grade INTEIRA (fileira × passo) — igual
// ao Movies.janelaDaGrade.test.tsx. É a única ponte com a implementação: a
// grade precisa saber o que a tela mostra, e a TV não tem outra régua.
const PASSO = 306;           // altura da fileira + gap (px)
const TOPO_DA_GRADE = 100;   // padding-top do .movies-content
const ALTURA_DA_TELA = 1080; // TV em 1080p
const LARGURA_DA_CAIXA = 1600; // 1920 menos a sidebar e a barra A-Z

// "n" antes do número: "Filme 720"/"Filme 1080" viram UM grupo no
// agrupamento de versões (o sufixo parece qualidade) e o catálogo encolheria.
const nome = (id: number) => `Filme n${id}`;
const capaDe = (id: number) => `http://img.test/filme-${id}.jpg`;

function filme(id: number): VODStream {
    return {
        num: id, name: nome(id), stream_type: 'movie', stream_id: id,
        stream_icon: capaDe(id), container_extension: 'mp4',
        custom_sid: '', direct_source: '', added: '0', category_id: '1',
        rating: '', rating_5based: 0, backdrop_path: [], youtube_trailer: '',
        episode_run_time: '', cover: '', plot: '', cast: '',
    } as unknown as VODStream;
}

const CATEGORIAS: Category[] = [{ category_id: '1', category_name: 'Filmes', parent_id: 0 } as Category];
const TODOS = Array.from({ length: CATALOGO }, (_, i) => filme(i + 1));

type ComObserver = { IntersectionObserver?: unknown };
let observerOriginal: unknown;
beforeAll(() => {
    // jsdom não implementa scrollIntoView/scrollTo, e a página chama
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () { /* jsdom */ };
    if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function () { /* jsdom */ } as typeof Element.prototype.scrollTo;
    observerOriginal = (globalThis as ComObserver).IntersectionObserver;
});

let pico = { cards: 0, capas: 0 };

beforeEach(() => {
    pico = { cards: 0, capas: 0 };
    localStorage.clear();
    sessionStorage.clear();
    // Pior caso de memória: sem observer, cada card montado baixa a capa
    delete (globalThis as ComObserver).IntersectionObserver;
    vi.spyOn(api, 'getVODStreams').mockResolvedValue(TODOS);
    vi.spyOn(api, 'getVodCategories').mockResolvedValue(CATEGORIAS);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    if (observerOriginal === undefined) delete (globalThis as ComObserver).IntersectionObserver;
    else (globalThis as ComObserver).IntersectionObserver = observerOriginal;
});

const cards = () => [...document.querySelectorAll('.movie-card')];
const capas = () => [...document.querySelectorAll('.movie-card img')].filter(img => !!img.getAttribute('src'));
const tituloDe = (card: Element) => (card.querySelector('.movie-title')?.textContent || '').trim();

/** Índice ABSOLUTO (0-based) do filme que o card mostra — sai do título. */
function indiceDoCard(card: Element): number {
    const m = /^Filme n(\d+)$/.exec(tituloDe(card));
    if (!m) throw new Error(`card com título inesperado: "${tituloDe(card)}" — o teste não sabe onde ele fica`);
    return Number(m[1]) - 1;
}

let topoDaRolagem = 0;
/**
 * Dá layout ao jsdom ANTES da página montar (a grade mede a fileira ao
 * renderizar, como no aparelho): offsetTop dos cards e da grade, tamanho e
 * rolagem do `.movies-content`. Devolve o desfazer.
 */
function instalarGeometria() {
    const proto = HTMLElement.prototype;
    const originais = (['offsetTop', 'clientHeight', 'clientWidth', 'scrollTop'] as const)
        .map(nome => [nome, Object.getOwnPropertyDescriptor(proto, nome)] as const);
    const daCaixa = (el: HTMLElement) => el.classList.contains('movies-content');
    topoDaRolagem = 0;
    Object.defineProperty(proto, 'offsetTop', {
        configurable: true,
        get(this: HTMLElement) {
            if (this.classList.contains('movies-grid')) return TOPO_DA_GRADE;
            if (this.classList.contains('movie-card')) {
                return TOPO_DA_GRADE + Math.floor(indiceDoCard(this) / COLUNAS) * PASSO;
            }
            return 0;
        },
    });
    Object.defineProperty(proto, 'clientHeight', {
        configurable: true,
        get(this: HTMLElement) { return daCaixa(this) ? ALTURA_DA_TELA : 0; },
    });
    Object.defineProperty(proto, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) { return daCaixa(this) ? LARGURA_DA_CAIXA : 0; },
    });
    Object.defineProperty(proto, 'scrollTop', {
        configurable: true,
        get(this: HTMLElement) { return daCaixa(this) ? topoDaRolagem : 0; },
        set(this: HTMLElement, valor: number) { if (daCaixa(this)) topoDaRolagem = valor; },
    });
    return () => {
        for (const [nome, descritor] of originais) {
            if (descritor) Object.defineProperty(proto, nome, descritor);
            else delete (proto as unknown as Record<string, unknown>)[nome]; // volta a herdar do Element
        }
    };
}

/** O card com o anel de foco: tem de ser UM, e estar montado. */
function focado() {
    const comFoco = cards().filter(c => c.classList.contains('tv-focused'));
    expect(comFoco, 'nenhum (ou mais de um) card focado montado na grade').toHaveLength(1);
    const card = comFoco[0];
    return { card, titulo: tituloDe(card) };
}

async function montar() {
    render(<Movies />);
    // Espera a CONDIÇÃO (grade carregada), não um número de voltas
    await waitFor(() => expect(cards().length).toBeGreaterThan(COLUNAS));
    // O ouvinte do useTVNavigation é re-registrado num efeito: o act vazio
    // descarrega os efeitos pendentes antes da 1ª tecla (senão ela cai no
    // ouvinte velho). Não conta voltas: é o flush do próprio React.
    await act(async () => {});
    expect(focado().titulo).toBe(nome(1));
}

/** Mede depois de um passo e falha ALTO no primeiro que estourar o teto. */
function medir(passo: string) {
    const n = cards().length;
    const c = capas().length;
    pico = { cards: Math.max(pico.cards, n), capas: Math.max(pico.capas, c) };
    if (n > TETO_DE_CARDS || c > TETO_DE_CARDS) {
        throw new Error(
            `${passo}: ${n} cards e ${c} capas montados (teto ${TETO_DE_CARDS}) — a grade voltou a crescer sem teto`,
        );
    }
}

/**
 * Depois de CADA tecla, o que a tela mostra em volta do anel está montado: a
 * fileira de cima e a de baixo do foco (quando existem). Conferir só no fim
 * deixava passar uma janela sem margem, que em certas teclas mostrava em
 * branco a fileira vizinha do foco e no fim do trajeto parecia inteira.
 */
function vizinhancaMontada(passo: string, total: number) {
    const foco = indiceDoCard(focado().card);
    const linha = Math.floor(foco / COLUNAS);
    const montados = new Set(cards().map(indiceDoCard));
    for (const vizinha of [linha - 1, linha + 1]) {
        if (vizinha < 0 || vizinha * COLUNAS >= total) continue;
        if (!montados.has(vizinha * COLUNAS)) {
            throw new Error(`${passo}: foco na fileira ${linha}, e a fileira ${vizinha} (colada no anel) não está montada`);
        }
    }
}

/** Aperta a tecla `vezes` vezes e mede DEPOIS DE CADA UMA (é o pico que derruba a TV). */
function apertar(key: string, keyCode: number, vezes: number, total = CATALOGO) {
    for (let i = 0; i < vezes; i++) {
        act(() => { fireEvent.keyDown(window, { key, keyCode }); });
        medir(`${key} nº ${i + 1}`);
        vizinhancaMontada(`${key} nº ${i + 1}`, total);
    }
}

describe('Filmes: a grade tem teto de nós, por mais longe que o D-pad vá', () => {
    it(`↓ ${APERTOS_BAIXO}× num catálogo de ${CATALOGO}: nunca mais de ${TETO_DE_CARDS} cards nem capas; ↑ traz o começo de volta`, async () => {
        await montar();

        apertar('ArrowDown', 40, APERTOS_BAIXO);
        // Andou de verdade: 60 fileiras de 6, bem além do teto
        const destino = APERTOS_BAIXO * COLUNAS; // índice 360
        const { card, titulo } = focado();
        expect(titulo).toBe(nome(destino + 1));
        // O card focado tem a capa (o teto não cortou o que está na tela)
        expect(card.querySelector('img')?.getAttribute('src')).toBe(capaDe(destino + 1));
        // A grade ainda mostra a vizinhança: fileira de cima e de baixo montadas
        const titulos = cards().map(tituloDe);
        expect(titulos).toContain(nome(destino + 1 - COLUNAS));
        expect(titulos).toContain(nome(destino + 1 + COLUNAS));
        // ...e o começo da lista saiu do DOM
        expect(titulos).not.toContain(nome(1));

        apertar('ArrowUp', 38, APERTOS_BAIXO);
        expect(focado().titulo).toBe(nome(1));
        expect(tituloDe(cards()[0]), 'a grade não voltou pro topo').toBe(nome(1));
        // Ordem preservada no que está montado (sem buraco nem card repetido)
        const agora = cards().map(tituloDe);
        expect(agora).toEqual(agora.map((_, i) => nome(i + 1)));

        expect(pico.cards).toBeLessThanOrEqual(TETO_DE_CARDS);
        expect(pico.capas).toBeLessThanOrEqual(TETO_DE_CARDS);
    }, LONGO);

    it('CH+ 20× (página de 3 fileiras): mesmo teto; CH- volta ao primeiro', async () => {
        await montar();

        // 20 páginas de 18 = índice 360: muito além do teto (o antigo estourava na 8ª)
        const PAGINAS = 20;
        apertar('PageDown', 34, PAGINAS);
        const destino = PAGINAS * COLUNAS * 3;
        const { card, titulo } = focado();
        expect(titulo).toBe(nome(destino + 1));
        expect(card.querySelector('img')?.getAttribute('src')).toBe(capaDe(destino + 1));

        apertar('PageUp', 33, PAGINAS);
        expect(focado().titulo).toBe(nome(1));
        expect(tituloDe(cards()[0])).toBe(nome(1));
    }, LONGO);

    it(`→ ${APERTOS_DIREITA}× atravessando fileiras: mesmo teto, foco no título certo`, async () => {
        await montar();

        apertar('ArrowRight', 39, APERTOS_DIREITA);
        expect(focado().titulo).toBe(nome(APERTOS_DIREITA + 1));
    }, LONGO);

    it('fim da lista: CH+ até o último filme monta o último card, sem passar do teto', async () => {
        // Catálogo menor só pra chegar ao fim com menos teclas: o que se mede
        // aqui é a borda de baixo, não a distância
        const TAMANHO = 1200;
        vi.mocked(api.getVODStreams).mockResolvedValue(TODOS.slice(0, TAMANHO));
        await montar();

        apertar('PageDown', 34, Math.ceil(TAMANHO / (COLUNAS * 3)) + 1, TAMANHO);
        apertar('ArrowDown', 40, 2, TAMANHO);
        const titulos = cards().map(tituloDe);
        expect(titulos[titulos.length - 1], 'o último filme do catálogo não aparece').toBe(nome(TAMANHO));
        expect(focado().titulo).toBe(nome(TAMANHO));
    }, LONGO);

    it(`rolagem do mouse (build web / ponteiro): ${FILEIRAS_ROLADAS} fileiras abaixo e de volta, sem passar do teto nem abrir buraco na tela`, async () => {
        const desfazer = instalarGeometria();
        try {
            await montar();
            const caixa = document.querySelector('.movies-content') as HTMLElement | null;
            expect(caixa, 'o contêiner que rola sumiu — o teste precisa achar outro').not.toBeNull();
            const rolarAte = (fileira: number, passo: string) => {
                topoDaRolagem = TOPO_DA_GRADE + fileira * PASSO;
                act(() => { (caixa as HTMLElement).dispatchEvent(new Event('scroll')); });
                medir(passo);
                // O que a tela mostra está montado: a rolagem não pode parar
                // num teto nem mostrar uma faixa em branco no lugar dos cards
                const montados = new Set(cards().map(indiceDoCard));
                const ultimaAVista = Math.min(
                    Math.ceil(CATALOGO / COLUNAS) - 1,
                    fileira + Math.floor(ALTURA_DA_TELA / PASSO),
                );
                for (let linha = fileira; linha <= ultimaAVista; linha++) {
                    if (!montados.has(linha * COLUNAS)) {
                        throw new Error(`${passo}: a fileira ${linha} está na tela e não está montada`);
                    }
                }
            };
            for (let fileira = 1; fileira <= FILEIRAS_ROLADAS; fileira++) rolarAte(fileira, `rolagem ↓ até a fileira ${fileira}`);
            // Andou de verdade: o começo da lista saiu do DOM
            expect(cards().map(tituloDe)).not.toContain(nome(1));
            for (let fileira = FILEIRAS_ROLADAS - 1; fileira >= 0; fileira--) rolarAte(fileira, `rolagem ↑ até a fileira ${fileira}`);
        } finally {
            desfazer();
        }
        expect(tituloDe(cards()[0]), 'a rolagem não trouxe o topo de volta').toBe(nome(1));
        // A rolagem não mexe no foco do D-pad
        expect(focado().titulo).toBe(nome(1));
    }, LONGO);
});

// Execução: npx vitest run src/pages/Movies.tetoDaGrade.test.tsx
