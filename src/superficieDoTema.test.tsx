// @vitest-environment jsdom
//
// ⬛ AMOLED e Alto contraste paravam na porta.
//
// O theme.css pintava o fundo de preto (e apagava os orbs/gradientes
// decorativos) por uma lista FIXA de classes de página — Home, TV ao vivo,
// Filmes, Séries, Minha Lista, Favoritos, Configurações. As telas de entrada
// (idioma, boas-vindas, login) e os dois overlays de tela inteira (assistente
// de configuração e Perfis) ficavam de fora: quem ligou AMOLED para proteger o
// painel OLED continuava com orbs de 300–400 px com blur animados e gradiente
// aceso em tela cheia, e quem ligou Alto contraste por baixa visão digitava
// servidor e senha no D-pad sobre o gradiente.
//
// Teste comportamental: monta cada tela DE VERDADE, com as folhas REAIS
// (index.css, theme.css e o CSS da própria tela), liga a opção pela peça de
// verdade (themeService / a11yService — a mesma que Configurações chama) e
// mede o cascade: o fundo da tela tem de sair preto puro e nenhum orb com blur
// pode continuar desenhado. Não importa em que classe a regra mora.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { render, cleanup } from '@testing-library/react';
import { themeService } from './services/themeService';
import { a11yService } from './services/a11yService';
import { LanguageSelection } from './pages/LanguageSelection';
import { Welcome } from './pages/Welcome';
import { Login } from './pages/Login';
import { SetupWizard } from './components/SetupWizard';
import { ProfileManager } from './components/ProfileManager';

/** Separa uma lista de seletores nas vírgulas de fora de parênteses. */
function seletoresDaLista(lista: string): string[] {
    const partes: string[] = [];
    let nivel = 0;
    let atual = '';
    for (const c of lista) {
        if (c === '(') nivel++;
        if (c === ')') nivel--;
        if (c === ',' && nivel === 0) {
            partes.push(atual.trim());
            atual = '';
        } else {
            atual += c;
        }
    }
    partes.push(atual.trim());
    return partes.filter(Boolean);
}

/**
 * Injeta a folha REAL. O vitest não processa CSS (`import './X.css'` vira
 * módulo vazio): sem isto não há cascade para medir. Caminho relativo ao cwd,
 * porque sob jsdom o `import.meta.url` é http.
 *
 * Contorno de UM defeito do jsdom, e só dele: numa lista de seletores
 * (`a, b { }`) o jsdom dá à regra inteira a especificidade do seletor MAIS
 * forte, e o navegador usa a do seletor que casou. Aqui isso importa: a regra
 * do tema tem de vencer a folha da tela por especificidade, e um
 * `.ns-surface` fraco escondido numa lista forte passaria no jsdom e perderia
 * na TV. Cada lista vira uma regra por seletor, na mesma posição do cascade e
 * com as mesmas declarações — é o que o navegador aplica. Devolve quantas
 * listas foram separadas.
 */
function injetarFolha(caminho: string): number {
    const elemento = document.createElement('style');
    elemento.textContent = readFileSync(caminho, 'utf8');
    document.head.appendChild(elemento);
    const folha = elemento.sheet;
    // Falha ALTO se a folha vier vazia ou não parsear: mediria um cascade sem ela
    expect(folha?.cssRules.length ?? 0, `a folha ${caminho} não carregou`).toBeGreaterThan(0);
    let separadas = 0;
    for (let i = folha!.cssRules.length - 1; i >= 0; i--) {
        const regra = folha!.cssRules[i];
        if (!(regra instanceof CSSStyleRule)) continue;
        const seletores = seletoresDaLista(regra.selectorText);
        if (seletores.length < 2) continue;
        const declaracoes = regra.style.cssText;
        folha!.deleteRule(i);
        for (let j = seletores.length - 1; j >= 0; j--) {
            folha!.insertRule(`${seletores[j]} { ${declaracoes} }`, i);
        }
        separadas++;
    }
    return separadas;
}

const nada = (): void => { /* callback que o teste não observa */ };

interface Tela {
    nome: string;
    css: string;
    montar: () => ReactElement;
}

// As telas de página inteira que ficavam de fora da lista do theme.css
const TELAS: Tela[] = [
    { nome: 'escolha de idioma', css: 'src/pages/LanguageSelection.css', montar: () => <LanguageSelection onComplete={nada} /> },
    { nome: 'boas-vindas', css: 'src/pages/Welcome.css', montar: () => <Welcome onGoToLogin={nada} /> },
    { nome: 'login', css: 'src/pages/Login.css', montar: () => <Login onLoginSuccess={nada} onBack={nada} /> },
    { nome: 'assistente de configuração', css: 'src/components/SetupWizard.css', montar: () => <SetupWizard onFinish={nada} /> },
    { nome: 'Perfis', css: 'src/components/ProfileManager/ProfileManager.css', montar: () => <ProfileManager onClose={nada} /> },
];

const PRETO = 'rgb(0, 0, 0)';

/** A raiz da tela: o primeiro elemento que o componente desenha. */
function montarTela(tela: Tela): HTMLElement {
    const { container } = render(tela.montar());
    const raiz = container.firstElementChild as HTMLElement | null;
    if (!raiz) throw new Error(`a tela ${tela.nome} não desenhou nada`);
    return raiz;
}

/** Desenhado = nem ele nem nenhum ancestral com display:none. */
function desenhado(el: Element): boolean {
    for (let n: Element | null = el; n; n = n.parentElement) {
        if (getComputedStyle(n).display === 'none') return false;
    }
    return true;
}

/**
 * Os orbs decorativos: todo elemento da tela com `filter: blur(...)`. Se o
 * jsdom deixar de expor o `filter`, esta lista sai vazia e os testes de
 * AMOLED/contraste passariam à toa — por isso o bloco de controle (tema
 * padrão) exige que os orbs SEJAM achados antes.
 */
function orbsDesenhados(raiz: Element): Element[] {
    return Array.from(raiz.querySelectorAll('*'))
        .filter(el => /blur\(/.test(getComputedStyle(el).filter))
        .filter(desenhado);
}

/** Os controles que o usuário opera no D-pad (botões, campos) ainda desenhados. */
function controlesDesenhados(raiz: Element): number {
    return Array.from(raiz.querySelectorAll('button, input, select, textarea, [tabindex]'))
        .filter(desenhado).length;
}

/**
 * O modo apaga a DECORAÇÃO, não a tela: a raiz continua desenhada e todo
 * controle que a tela mostra sem tema nem contraste continua na tela. Sem
 * isto, um `ns-surface-decor` posto no vidro do idioma ou na raiz do Perfis
 * passaria — fundo preto e nenhum orb, porque não sobra NADA desenhado.
 */
function esperarUiIntacta(tela: Tela): void {
    const html = document.documentElement;
    const { bg, contrast } = html.dataset;
    delete html.dataset.bg;
    delete html.dataset.contrast;
    const semModo = controlesDesenhados(montarTela(tela));
    cleanup();
    themeService.apply();
    a11yService.apply();
    expect({ bg: html.dataset.bg, contrast: html.dataset.contrast }).toEqual({ bg, contrast });
    expect(semModo, `a tela ${tela.nome} não mostrou controle nenhum sem o modo`).toBeGreaterThan(0);

    const raiz = montarTela(tela);
    expect(desenhado(raiz)).toBe(true);
    expect(controlesDesenhados(raiz)).toBe(semModo);
}

function fundoDe(el: Element): { cor: string; imagem: string } {
    const estilo = getComputedStyle(el);
    return { cor: estilo.backgroundColor, imagem: estilo.backgroundImage };
}

beforeAll(() => {
    // A ordem do app de verdade: o main.tsx importa index.css e theme.css ANTES
    // do App, e o CSS de cada tela só chega depois, pelo import do componente.
    // Ou seja, a folha da tela vem por último e ganharia um empate — a regra do
    // tema tem de vencer por especificidade, não por posição.
    injetarFolha('src/index.css');
    // Falha ALTO se o contorno deixar de achar as listas do tema: sem ele, a
    // especificidade medida seria a do jsdom, não a da TV.
    expect(injetarFolha('src/theme.css')).toBeGreaterThan(0);
    for (const tela of TELAS) injetarFolha(tela.css);
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
});

beforeEach(() => {
    localStorage.clear();
    themeService.apply();
    a11yService.apply();
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    themeService.apply();
    a11yService.apply();
});

describe('tema padrão (controle: o teste enxerga os orbs e o gradiente)', () => {
    // O assistente não tem orbs: só o gradiente do fundo.
    it.each(TELAS.filter(t => t.nome !== 'assistente de configuração').map(t => [t.nome, t] as const))(
        '%s desenha os orbs com blur',
        (_nome, tela) => {
            const raiz = montarTela(tela);
            expect(orbsDesenhados(raiz).length).toBeGreaterThan(0);
        },
    );

    // O idioma fica de fora deste controle: o LanguageSelection.css pinta o
    // fundo com variáveis que não existem (--color-background,
    // --color-primary-rgb...). O jsdom devolve o `var(...)` cru; o navegador
    // descarta a declaração e mostra o body. É outro defeito, não este.
    it.each(TELAS.filter(t => t.nome !== 'escolha de idioma').map(t => [t.nome, t] as const))(
        '%s tem o fundo com gradiente próprio',
        (_nome, tela) => {
            const raiz = montarTela(tela);
            expect(fundoDe(raiz).imagem).toMatch(/gradient/);
        },
    );
});

describe('AMOLED (preto puro) vale em toda tela de página inteira', () => {
    beforeEach(() => {
        themeService.setBackground('amoled');
        expect(document.documentElement.dataset.bg).toBe('amoled');
    });

    it.each(TELAS.map(t => [t.nome, t] as const))('%s: fundo preto puro, sem gradiente', (_nome, tela) => {
        const raiz = montarTela(tela);
        expect(fundoDe(raiz)).toEqual({ cor: PRETO, imagem: 'none' });
    });

    it.each(TELAS.map(t => [t.nome, t] as const))('%s: nenhum orb com blur desenhado', (_nome, tela) => {
        const raiz = montarTela(tela);
        expect(orbsDesenhados(raiz).map(el => el.className)).toEqual([]);
    });

    it.each(TELAS.map(t => [t.nome, t] as const))('%s: a UI da tela continua desenhada', (_nome, tela) => {
        esperarUiIntacta(tela);
    });
});

describe('Alto contraste vale em toda tela de página inteira', () => {
    beforeEach(() => {
        a11yService.setContrast('alto');
        expect(document.documentElement.dataset.contrast).toBe('alto');
    });

    it.each(TELAS.map(t => [t.nome, t] as const))('%s: fundo preto puro, sem gradiente', (_nome, tela) => {
        const raiz = montarTela(tela);
        expect(fundoDe(raiz)).toEqual({ cor: PRETO, imagem: 'none' });
    });

    it.each(TELAS.map(t => [t.nome, t] as const))('%s: nenhum orb com blur desenhado', (_nome, tela) => {
        const raiz = montarTela(tela);
        expect(orbsDesenhados(raiz).map(el => el.className)).toEqual([]);
    });

    it.each(TELAS.map(t => [t.nome, t] as const))('%s: a UI da tela continua desenhada', (_nome, tela) => {
        esperarUiIntacta(tela);
    });
});
