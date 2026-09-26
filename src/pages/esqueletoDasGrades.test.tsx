// @vitest-environment jsdom
//
// 🦴 O esqueleto de carregamento de Filmes e Séries virava a pílula da TV ao vivo (T129).
//
// O app vai para a TV como UM arquivo de CSS (as três páginas são importadas
// direto no App.tsx, sem code-splitting). A TV ao vivo e as duas grades de
// pôster usavam o MESMO nome de classe para coisas diferentes:
//
//     LiveTV.css   .skeleton-card { display:flex; align-items:center; gap:12px;
//                                   padding:12px 16px; background:...; border:...; }
//     Movies.css   .skeleton-card { animation: skeletonPulse ... }   (Series.css igual)
//
// As regras se SOMAM: tudo o que Filmes/Séries não contestam (display, padding,
// fundo, borda) vinha da TV ao vivo. O esqueleto de Filmes, desenhado como uma
// célula de grade com o pôster 2/3 em cima e o título embaixo, virava uma LINHA
// flex centralizada: pôster e título são divs vazios, então como itens flex
// ficam com largura de conteúdo — zero — e o que aparece são pílulas vazias
// com borda. No Tizen 5.5 (sem gap em flex) o fallback ainda empurrava o título
// 12px para a direita (`html.no-flex-gap .skeleton-card > * + *`).
//
// O teste monta as PÁGINAS DE VERDADE com o provedor pendurado (o esqueleto é o
// que fica na tela), carrega TODAS as folhas de `src/` nas duas ordens (o
// resultado não pode depender de como o Vite concatena) e com a classe
// `no-flex-gap` no <html> (o caminho da TV), e confere o estilo computado:
//  - Filmes/Séries: o card é um bloco sem padding, fundo nem borda; pôster e
//    título não levam margem lateral de ninguém;
//  - TV ao vivo: o card dela continua a linha flex de ícone + texto (o conserto
//    não pode quebrar o esqueleto de quem o tinha de propósito).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';
import { api } from '../services/api';
import { installFakeStorage } from '../testing/fakeStorage';
import { LiveTV } from './LiveTV';
import { Movies } from './Movies';
import { Series } from './Series';

// Sob jsdom o import.meta.url é http: o caminho parte do cwd (raiz do projeto).
const SRC = path.resolve('src');

function folhasDeEstilo(dir: string): string[] {
    return readdirSync(dir).flatMap(nome => {
        const completo = path.join(dir, nome);
        if (statSync(completo).isDirectory()) return folhasDeEstilo(completo);
        return nome.endsWith('.css') ? [completo] : [];
    }).sort();
}

const FOLHAS = folhasDeEstilo(SRC);

let estilos: HTMLStyleElement[] = [];

/** Troca as folhas do documento. Folha que o jsdom não entende falha ALTO. */
function carregarFolhas(ordem: string[]): void {
    for (const s of estilos) s.remove();
    estilos = ordem.map(caminho => {
        const el = document.createElement('style');
        el.textContent = readFileSync(caminho, 'utf-8');
        document.head.appendChild(el);
        if ((el.sheet?.cssRules.length ?? 0) === 0) {
            throw new Error(`o jsdom não leu ${path.relative(SRC, caminho)} — o teste estaria medindo sem ela`);
        }
        return el;
    });
}

/** Provedor que nunca responde: a página fica no esqueleto de carregamento. */
const nuncaResponde = () => new Promise<never>(() => { /* pendurado de propósito */ });

const semValor = (v: string) => v === '' || v === '0px' || v === '0';
const semBorda = (v: string) => v === '' || v === 'none';
const semFundo = (v: string) => v === '' || v === 'transparent' || v === 'rgba(0, 0, 0, 0)';

function cardsDo(grade: string): HTMLElement[] {
    const el = document.querySelector(grade);
    if (!el) throw new Error(`a página não mostrou ${grade}`);
    const cards = Array.from(el.children) as HTMLElement[];
    expect(cards.length, `${grade} sem cards de esqueleto`).toBeGreaterThan(0);
    return cards;
}

const GRADES_DE_POSTER: Array<[string, () => ReactElement, () => void]> = [
    ['Filmes', () => <Movies />, () => {
        vi.spyOn(api, 'getVODStreams').mockImplementation(nuncaResponde);
        vi.spyOn(api, 'getVodCategories').mockImplementation(nuncaResponde);
    }],
    ['Séries', () => <Series />, () => {
        vi.spyOn(api, 'getSeries').mockImplementation(nuncaResponde);
        vi.spyOn(api, 'getSeriesCategories').mockImplementation(nuncaResponde);
    }],
];

const ORDENS: Array<[string, string[]]> = [
    ['ordem alfabética', FOLHAS],
    ['ordem invertida', [...FOLHAS].reverse()],
];

beforeAll(() => {
    // jsdom não implementa scrollIntoView/scrollTo; as páginas chamam.
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () { /* jsdom */ };
    if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function () { /* jsdom */ } as typeof Element.prototype.scrollTo;
});

beforeEach(() => {
    // Sem catálogo em cache: a página abre no esqueleto de carregamento
    installFakeStorage();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe.each(ORDENS)('esqueleto de carregamento das grades (%s, TV sem gap em flex)', (_nome, ordem) => {
    beforeAll(() => {
        carregarFolhas(ordem);
        // O caminho do Tizen 5.5: o boot põe esta classe quando o motor não tem gap em flex
        document.documentElement.classList.add('no-flex-gap');
    });

    afterAll(() => {
        for (const s of estilos) s.remove();
        estilos = [];
        document.documentElement.classList.remove('no-flex-gap');
    });

    it.each(GRADES_DE_POSTER)('%s: o card do esqueleto é uma célula de pôster, não a pílula da TV ao vivo', async (_pagina, pagina, pendurar) => {
        pendurar();
        render(pagina());
        await waitFor(() => expect(document.querySelector('.loading-grid')).not.toBeNull());

        for (const card of cardsDo('.loading-grid')) {
            const s = getComputedStyle(card);
            // Pôster EM CIMA do título: o card é bloco, não linha flex
            expect(s.display, 'display do card').toBe('block');
            for (const lado of ['top', 'right', 'bottom', 'left']) {
                expect(semValor(s.getPropertyValue(`padding-${lado}`)), `padding-${lado} do card: "${s.getPropertyValue(`padding-${lado}`)}"`).toBe(true);
                expect(semBorda(s.getPropertyValue(`border-${lado}-style`)), `borda ${lado} do card: "${s.getPropertyValue(`border-${lado}-style`)}"`).toBe(true);
            }
            expect(semFundo(s.backgroundColor), `fundo do card: "${s.backgroundColor}"`).toBe(true);

            const filhos = Array.from(card.children) as HTMLElement[];
            expect(filhos.map(f => f.className)).toEqual(['skeleton-poster', 'skeleton-title']);
            for (const filho of filhos) {
                // Ninguém de fora empurra o pôster ou o título para o lado
                const margem = getComputedStyle(filho).marginLeft;
                expect(semValor(margem), `margin-left de .${filho.className}: "${margem}"`).toBe(true);
            }
        }
    });

    it('TV ao vivo: o esqueleto dela continua a linha de ícone + texto', async () => {
        vi.spyOn(api, 'getLiveStreams').mockImplementation(nuncaResponde);
        vi.spyOn(api, 'getLiveCategories').mockImplementation(nuncaResponde);
        render(<LiveTV />);
        await waitFor(() => expect(document.querySelector('.loading-skeleton-grid')).not.toBeNull());

        for (const card of cardsDo('.loading-skeleton-grid')) {
            const s = getComputedStyle(card);
            expect(s.display).toBe('flex');
            expect(s.alignItems).toBe('center');
            // A pílula inteira: padding nos quatro lados, borda e fundo
            expect([s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft]).toEqual(['12px', '16px', '12px', '16px']);
            for (const lado of ['top', 'right', 'bottom', 'left']) {
                expect(s.getPropertyValue(`border-${lado}-style`), `borda ${lado} do card da TV ao vivo`).toBe('solid');
            }
            expect(semFundo(s.backgroundColor), 'o card da TV ao vivo tem fundo').toBe(false);

            const [icone, texto] = Array.from(card.children) as HTMLElement[];
            expect(icone.className).toBe('skeleton-icon');
            expect(texto.className).toBe('skeleton-text');
            // Sem gap em flex, o fallback separa o texto do ícone -- e só o texto:
            // o ícone, primeiro filho, não leva margem nenhuma
            const margemDoIcone = getComputedStyle(icone).marginLeft;
            expect(semValor(margemDoIcone), `margin-left do ícone: "${margemDoIcone}"`).toBe(true);
            expect(getComputedStyle(texto).marginLeft).toBe('12px');
        }
    });

    it('TV ao vivo num motor COM gap em flex: o fallback não soma margem ao gap', async () => {
        document.documentElement.classList.remove('no-flex-gap');
        try {
            vi.spyOn(api, 'getLiveStreams').mockImplementation(nuncaResponde);
            vi.spyOn(api, 'getLiveCategories').mockImplementation(nuncaResponde);
            render(<LiveTV />);
            await waitFor(() => expect(document.querySelector('.loading-skeleton-grid')).not.toBeNull());

            for (const card of cardsDo('.loading-skeleton-grid')) {
                expect(getComputedStyle(card).display).toBe('flex');
                for (const filho of Array.from(card.children) as HTMLElement[]) {
                    const margem = getComputedStyle(filho).marginLeft;
                    expect(semValor(margem), `margin-left de .${filho.className} com gap em flex: "${margem}"`).toBe(true);
                }
            }
        } finally {
            document.documentElement.classList.add('no-flex-gap');
        }
    });
});
