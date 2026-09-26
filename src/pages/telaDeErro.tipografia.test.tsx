// @vitest-environment jsdom
//
// 📡 A tela de erro das três páginas de catálogo lia 14px vermelho a três metros.
//
// As páginas trocaram a tela de erro própria pelo `ErrorScreen`, mas passaram
// a classe antiga do container (`livetv-error-container`, `movies-error-container`,
// `series-error-container`) — e as folhas das páginas ainda tinham as regras da
// tela VELHA para os filhos desse container:
//
//     .livetv-error-container p { font-size: 14px; color: <vermelho>; margin-bottom: 32px }
//
// `.livetv-error-container p` (0,1,1) vence `.error-screen-message` (0,1,0) e
// `.error-screen-hint` (0,1,0): a mensagem caía de 19px para 14px e a DICA de
// navegação ("OK tenta de novo · ← ou Voltar abre o menu") saía em vermelho,
// como se fosse outro erro. No `h2` o empate de especificidade com
// `.error-screen-content h2` deixava o título à mercê da ordem do bundle.
//
// O teste monta a PÁGINA DE VERDADE com o provedor falhando, carrega TODAS as
// folhas de `src/` (nas duas ordens: o resultado não pode depender de como o
// Vite concatena o CSS) e exige que cada texto da tela de erro seja pintado
// exatamente como o `ErrorScreen` sozinho pinta: a página só escolhe o fundo
// do container, não a tipografia do componente.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';
import { api } from '../services/api';
import { installFakeStorage } from '../testing/fakeStorage';
import { ErrorScreen } from '../components/ErrorScreen';
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

/** O que a tela de erro pinta em cada texto: tamanho, cor, peso e respiro. */
const PROPRIEDADES = [
    'font-size', 'color', 'font-weight', 'line-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
] as const;

const TEXTOS: Array<[string, string]> = [
    ['ícone', '.error-screen-icon'],
    ['título', '.error-screen-content h2'],
    ['mensagem', '.error-screen-message'],
    ['botão', '.error-screen-retry'],
    ['dica de navegação', '.error-screen-hint'],
];

type Pintura = Record<string, Record<string, string>>;

function pinturaDaTela(): Pintura {
    const tela = document.querySelectorAll('.error-screen');
    expect(tela.length, 'esperava exatamente 1 .error-screen na página').toBe(1);
    const resultado: Pintura = {};
    for (const [nome, seletor] of TEXTOS) {
        const el = tela[0].querySelector(seletor);
        if (!el) throw new Error(`a tela de erro não tem ${seletor}`);
        const s = getComputedStyle(el);
        resultado[nome] = Object.fromEntries(PROPRIEDADES.map(p => [p, s.getPropertyValue(p).trim()]));
    }
    return resultado;
}

/** Como o `ErrorScreen` se pinta sem classe de página nenhuma. */
function pinturaDoComponente(): Pintura {
    render(<ErrorScreen icon="📡" title="Erro" message="O provedor não respondeu" />);
    try {
        return pinturaDaTela();
    } finally {
        cleanup();
    }
}

const FALHA = 'O provedor não respondeu (HTTP 503)';

const PAGINAS: Array<[string, () => ReactElement, string, () => void]> = [
    ['TV ao vivo', () => <LiveTV />, 'livetv-error-container', () => {
        vi.spyOn(api, 'getLiveStreams').mockRejectedValue(new Error(FALHA));
        vi.spyOn(api, 'getLiveCategories').mockRejectedValue(new Error(FALHA));
    }],
    ['Filmes', () => <Movies />, 'movies-error-container', () => {
        vi.spyOn(api, 'getVODStreams').mockRejectedValue(new Error(FALHA));
        vi.spyOn(api, 'getVodCategories').mockRejectedValue(new Error(FALHA));
    }],
    ['Séries', () => <Series />, 'series-error-container', () => {
        vi.spyOn(api, 'getSeries').mockRejectedValue(new Error(FALHA));
        vi.spyOn(api, 'getSeriesCategories').mockRejectedValue(new Error(FALHA));
    }],
];

// As duas ordens também cobrem um defeito do jsdom: ele deixa o atalho
// `margin` de uma regra MAIS FRACA porém posterior (`.error-screen-hint`)
// vencer o `margin-bottom` de uma regra mais forte. Na ordem alfabética as
// páginas vêm depois do componente, e aí o vazamento aparece como no navegador.
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
    // Sem catálogo em cache: a TV ao vivo só mostra o erro quando não tem o de ontem
    installFakeStorage();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe.each(ORDENS)('tela de erro das páginas de catálogo (%s)', (_nome, ordem) => {
    let componente: Pintura;

    beforeAll(() => {
        carregarFolhas(ordem);
        componente = pinturaDoComponente();
    });

    afterAll(() => {
        for (const s of estilos) s.remove();
        estilos = [];
    });

    it.each(PAGINAS)('%s: a página não reescreve a tipografia do ErrorScreen', async (_pagina, pagina, classe, falhar) => {
        falhar();
        render(pagina());
        await waitFor(() => expect(document.querySelector('.error-screen-message')?.textContent).toBe(FALHA));
        // É a tela de erro da PÁGINA (com a classe dela), não uma genérica
        expect(document.querySelector('.error-screen')?.classList.contains(classe)).toBe(true);

        expect(pinturaDaTela()).toEqual(componente);
    });
});
