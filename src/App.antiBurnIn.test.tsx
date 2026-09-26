// @vitest-environment jsdom
//
// 🌙 O anti burn-in não escurecia as telas onde a TV mais fica esquecida.
//
// O serviço (services/burnIn.ts) marca `app-dimmed` no <html> depois de 5 min
// sem tecla, e o theme.css escurecia só `.app` — o <div> do app principal. As
// telas de idioma, boas-vindas, login e "sem conexão" saem do App por
// `return` ANTES desse <div> existir: a classe entrava e nada escurecia. São
// justamente as mais perigosas para OLED — estáticas, alto contraste, logo
// grande no meio — e a de login é a que a pessoa larga no meio de digitar
// URL e senha no D-pad.
//
// Teste comportamental: monta o App DE VERDADE (com Welcome, idioma e Login
// de verdade) no MESMO ponto de montagem da TV — o <body> do tizen/index.html
// de verdade, no elemento que o main.tsx passa ao createRoot —, carrega o
// theme.css de verdade, deixa o relógio correr 5 min sem tecla e mede a
// opacidade EFETIVA da tela — o produto da opacidade de cada ancestral. Não
// importa em que elemento a regra mora, só que a pessoa veja a tela escurecer.
// Páginas do app principal que buscariam catálogo na rede viram dublês; o
// provedor é um spy no `api`.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { render, cleanup, act } from '@testing-library/react';
import { api } from './services/api';
import { burnIn } from './services/burnIn';
import type { AuthResponse } from './types';
import App from './App';

vi.mock('./pages/Home', () => ({ Home: () => <div data-testid="pagina-home" className="pagina-home" /> }));
vi.mock('./pages/LiveTV', () => ({ LiveTV: () => null }));
vi.mock('./pages/Movies', () => ({ Movies: () => null }));
vi.mock('./pages/Series', () => ({ Series: () => null }));
vi.mock('./pages/Favorites', () => ({ Favorites: () => null }));
vi.mock('./pages/MyList', () => ({ MyList: () => null }));
vi.mock('./pages/Settings', () => ({ Settings: () => null }));
vi.mock('./components/Sidebar', () => ({ Sidebar: () => <nav data-testid="sidebar" /> }));
vi.mock('./components/ProfileManager', () => ({ ProfileManager: () => null }));
vi.mock('./components/GlobalSearch', () => ({ GlobalSearch: () => null }));
vi.mock('./components/SetupWizard', () => ({ SetupWizard: () => null }));

const MIN = 60_000;
const OCIOSO = 5 * MIN; // o IDLE_MS do burnIn
// O nível do escurecimento no theme.css. Conferido exato, e não só "menos da
// metade": escurecer pouco demais (0,49) não protege o painel, e escurecer
// duas vezes (.app e #root juntos, 0,35 × 0,35) apagaria a tela.
const ESCURECIDA = 0.35;

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const THEME_CSS = readFileSync(path.join(RAIZ, 'theme.css'), 'utf-8');
const HTML_DA_TV = readFileSync(path.join(RAIZ, '..', 'tizen', 'index.html'), 'utf-8');
const HTML_DA_WEB = readFileSync(path.join(RAIZ, '..', 'index.html'), 'utf-8');

// O id que o main.tsx entrega ao createRoot. Se o ponto de montagem mudar de
// nome, o teste passa a montar no nome novo — e o CSS que ainda mira o velho
// deixa de escurecer, que é exatamente o que ele precisa pegar.
const ID_DA_MONTAGEM = /createRoot\(\s*document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)/
    .exec(readFileSync(path.join(RAIZ, 'main.tsx'), 'utf-8'))?.[1];

const RESPOSTA_DO_PROVEDOR = {
    user_info: { username: 'teste', status: 'Active', auth: 1 },
    server_info: { url: 'servidor.exemplo', timezone: 'America/Sao_Paulo' },
} as unknown as AuthResponse;

let folha: HTMLStyleElement;

beforeAll(() => {
    folha = document.createElement('style');
    folha.textContent = THEME_CSS;
    document.head.appendChild(folha);
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
});

afterAll(() => {
    folha.remove();
});

/**
 * Quanto a pessoa enxerga do elemento: opacidade é multiplicativa, então é o
 * produto da de cada ancestral até o <html>.
 */
function opacidadeEfetiva(el: Element): number {
    let total = 1;
    for (let n: Element | null = el; n; n = n.parentElement) {
        const valor = getComputedStyle(n).opacity;
        total *= valor === '' ? 1 : parseFloat(valor);
    }
    return total;
}

/** O elemento que ficou apagado: o ancestral com opacidade < 1. */
function quemApaga(el: Element): Element {
    for (let n: Element | null = el; n; n = n.parentElement) {
        if (parseFloat(getComputedStyle(n).opacity || '1') < 1) return n;
    }
    throw new Error('nenhum ancestral está apagado');
}

/**
 * O <body> de verdade do .wgt (as <script> vindas por innerHTML não rodam) e o
 * App no elemento que o main.tsx usa — não num <div id="root"> inventado aqui.
 */
function montarApp(): void {
    if (!ID_DA_MONTAGEM) throw new Error('não achei o createRoot(document.getElementById(...)) no main.tsx');
    const tv = new DOMParser().parseFromString(HTML_DA_TV, 'text/html');
    document.body.innerHTML = tv.body.innerHTML;
    const raiz = document.getElementById(ID_DA_MONTAGEM);
    if (!raiz) throw new Error(`o tizen/index.html não tem o #${ID_DA_MONTAGEM} que o main.tsx monta`);
    render(<App />, { container: raiz });
}

async function esperarTela(seletor: string): Promise<Element> {
    await vi.waitFor(() => {
        expect(document.querySelector(seletor), `a tela ${seletor} não abriu`).not.toBeNull();
    });
    // O ouvinte do useTVNavigation é re-registrado num efeito: esvazia antes de tecla
    await act(async () => { await Promise.resolve(); });
    return document.querySelector(seletor) as Element;
}

/** 5 min sem tecla nenhuma, com o relógio falso. */
function deixarATvParada(): void {
    act(() => { vi.advanceTimersByTime(OCIOSO); });
    // O serviço fez a parte dele — o que está em jogo é o CSS
    expect(document.documentElement.classList.contains('app-dimmed'), 'o burnIn não marcou o <html>').toBe(true);
}

function tecla(key: string, keyCode: number): void {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true }));
    });
}

function primeiroUso(): void {
    // Nada salvo: o boot abre a escolha de idioma
}

function idiomaEscolhido(): void {
    localStorage.setItem('neostream_settings', JSON.stringify({ language: 'pt', autoPlay: true, preferredQuality: 'auto' }));
    localStorage.setItem('neostream_wizard_done', '1');
}

function aparelhoComConta(): void {
    idiomaEscolhido();
    localStorage.setItem('neostream_credentials', JSON.stringify({
        url: 'http://servidor.exemplo:8080', username: 'teste', password: 'teste',
    }));
}

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // Só o relógio que o burnIn usa. O resto (microtasks do boot, o
    // MessageChannel do React) segue de verdade.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(api, 'authenticate').mockResolvedValue(RESPOSTA_DO_PROVEDOR);
});

afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    // Estado de módulo: a próxima montagem precisa instalar de novo, com o
    // relógio falso do próximo teste
    burnIn.uninstall();
    document.documentElement.removeAttribute('data-playing');
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
});

describe('ponto de montagem', () => {
    // O build web (index.html) e o .wgt (tizen/index.html) montam no mesmo id:
    // o CSS mira um só
    it('index.html e tizen/index.html têm o elemento que o main.tsx monta', () => {
        expect(ID_DA_MONTAGEM, 'createRoot(document.getElementById(...)) sumiu do main.tsx').toBeTruthy();
        for (const html of [HTML_DA_TV, HTML_DA_WEB]) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            expect(doc.getElementById(ID_DA_MONTAGEM as string)).not.toBeNull();
        }
    });
});

describe('anti burn-in nas telas de entrada', () => {
    it('escolha de idioma escurece depois de 5 min parada', async () => {
        primeiroUso();
        montarApp();
        const tela = await esperarTela('.language-selection-container');
        expect(opacidadeEfetiva(tela)).toBe(1);

        deixarATvParada();

        expect(opacidadeEfetiva(tela)).toBeCloseTo(ESCURECIDA, 5);
    });

    it('boas-vindas escurece depois de 5 min parada', async () => {
        idiomaEscolhido();
        montarApp();
        const tela = await esperarTela('.welcome-container');
        expect(opacidadeEfetiva(tela)).toBe(1);

        deixarATvParada();

        expect(opacidadeEfetiva(tela)).toBeCloseTo(ESCURECIDA, 5);
    });

    it('login largado no meio escurece depois de 5 min parado', async () => {
        idiomaEscolhido();
        montarApp();
        await esperarTela('.welcome-container');
        tecla('Enter', 13); // Welcome → Login
        const tela = await esperarTela('.login-container');
        expect(opacidadeEfetiva(tela)).toBe(1);

        deixarATvParada();

        expect(opacidadeEfetiva(tela)).toBeCloseTo(ESCURECIDA, 5);
    });

    it('"sem conexão" escurece depois de 5 min parada', async () => {
        aparelhoComConta();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(api.authenticate).mockRejectedValue(new Error('Failed to fetch'));
        montarApp();
        const tela = await esperarTela('.app-offline-actions');
        expect(opacidadeEfetiva(tela)).toBe(1);

        deixarATvParada();

        expect(opacidadeEfetiva(tela)).toBeCloseTo(ESCURECIDA, 5);
    });

    it('qualquer tecla devolve o brilho', async () => {
        idiomaEscolhido();
        montarApp();
        const tela = await esperarTela('.welcome-container');
        deixarATvParada();
        expect(opacidadeEfetiva(tela)).toBeCloseTo(ESCURECIDA, 5);
        // Apaga devagar (1,2 s) e acende rápido (0,4 s): o mesmo elemento
        // carrega as duas transições
        const apagado = quemApaga(tela);
        expect(getComputedStyle(apagado).transition).toBe('opacity 1.2s ease');

        tecla('ArrowDown', 40);

        expect(opacidadeEfetiva(tela)).toBe(1);
        expect(getComputedStyle(apagado).transition).toBe('opacity 0.4s ease');
    });

    it('com o player aberto (data-playing) nada escurece — nem na tela de entrada', async () => {
        idiomaEscolhido();
        montarApp();
        const tela = await esperarTela('.welcome-container');
        document.documentElement.setAttribute('data-playing', '');

        deixarATvParada();

        expect(opacidadeEfetiva(tela)).toBe(1);
    });
});

describe('anti burn-in no app principal (não pode regredir)', () => {
    it('Home escurece depois de 5 min parada', async () => {
        aparelhoComConta();
        montarApp();
        const tela = await esperarTela('.pagina-home');
        expect(opacidadeEfetiva(tela)).toBe(1);

        deixarATvParada();

        expect(opacidadeEfetiva(tela)).toBeCloseTo(ESCURECIDA, 5);
    });

    it('com o player aberto (data-playing) o app principal não escurece', async () => {
        aparelhoComConta();
        montarApp();
        const tela = await esperarTela('.pagina-home');
        document.documentElement.setAttribute('data-playing', '');

        deixarATvParada();

        expect(opacidadeEfetiva(tela)).toBe(1);
    });
});
