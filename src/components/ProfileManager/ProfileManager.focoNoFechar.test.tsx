// @vitest-environment jsdom
//
// O X da tela de Perfis recebia o foco do D-pad sem nada na tela dizer isso (T131).
//
// Subindo da primeira fileira de cartões, o `handleNavigate` liga o
// `closeButtonFocused` e o botão ganha a classe `focused` — mas o
// ProfileManager.css não tinha regra NENHUMA para `.pm-close-btn.focused` (só
// `:hover` e `:focus`, e o D-pad não move o foco do DOM). Pior: o `focusedIndex`
// não muda, então o cartão de onde se subiu CONTINUAVA com o anel. Na TV, o
// anel dizia "você está no perfil" e o OK fechava o gerenciador.
//
// O teste monta o componente de verdade, com o profileService de verdade
// (localStorage do jsdom), carrega a folha de estilo de verdade e confere o
// que a TV mostra: exatamente um elemento com cara de focado, e é o X.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, cleanup, fireEvent, screen, act, waitFor } from '@testing-library/react';
import { ProfileManager } from './ProfileManager';

const ENTER = { key: 'Enter', keyCode: 13 };
const CIMA = { key: 'ArrowUp', keyCode: 38 };
const BAIXO = { key: 'ArrowDown', keyCode: 40 };
const DIREITA = { key: 'ArrowRight', keyCode: 39 };
const ESQUERDA = { key: 'ArrowLeft', keyCode: 37 };

// Sob jsdom o import.meta.url é http: o caminho parte do cwd (raiz do projeto).
const FOLHA = path.resolve('src/components/ProfileManager/ProfileManager.css');

/** As propriedades da regra de foco do X — cada uma tem de mudar. */
const PROPRIEDADES = ['transform', 'boxShadow', 'borderColor', 'background'] as const;
type Aparencia = Record<(typeof PROPRIEDADES)[number], string>;

let estilo: HTMLStyleElement | null = null;

function apertar(tecla: { key: string; keyCode: number }): void {
    fireEvent.keyDown(document.activeElement ?? document.body, tecla);
}

function botaoFechar(): HTMLButtonElement {
    return screen.getByRole('button', { name: 'X' }) as HTMLButtonElement;
}

/** Tudo o que pode acender um anel na lista: cartões de perfil e o "+". */
function cartoes(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.pm-profile-card, .pm-add-card'));
}

function cartaoAdicionar(): HTMLElement {
    return screen.getByText('Adicionar Perfil').closest('.pm-add-card') as HTMLElement;
}

function cartaoKids(): HTMLElement {
    // O nome e o selo dizem 'Kids': o selo só existe no cartão do perfil Kids
    return document.querySelector('.pm-kids-badge')?.closest('.pm-profile-card') as HTMLElement;
}

/** O fator do scale() do transform: 1 é o mesmo que não crescer. */
function fatorDeEscala(transform: string): number {
    const m = /scale\(\s*([\d.]+)/.exec(transform);
    return m ? Number(m[1]) : NaN;
}

/** A espessura (spread, 4º comprimento) do anel do box-shadow: 0 é anel invisível. */
function espessuraDoAnel(boxShadow: string): number {
    const comprimentos = boxShadow
        .split(/\s+/)
        .filter(t => /^-?[\d.]+(px)?$/.test(t))
        .map(t => parseFloat(t));
    return comprimentos.length >= 4 ? comprimentos[3] : NaN;
}

/** O que a TV mostra: o estilo computado, não a classe. */
function aparencia(el: HTMLElement): Aparencia {
    const s = getComputedStyle(el);
    return {
        transform: s.transform,
        boxShadow: s.boxShadow,
        borderColor: s.borderColor,
        background: s.background,
    };
}

/** Um anel só na tela, e é o X: nenhum cartão (nem botão dentro dele) aceso. */
function soOXAceso(x: HTMLElement): void {
    expect(x.classList.contains('focused')).toBe(true);
    for (const c of cartoes()) {
        expect(c.classList.contains('focused')).toBe(false);
        expect(c.querySelector('.tv-focused')).toBeNull();
        expect(['', 'none']).toContain(getComputedStyle(c).transform);
    }
}

async function montar(onClose: () => void): Promise<void> {
    render(<ProfileManager onClose={onClose} />);
    await screen.findByText('Principal');
    // A lista chega num microtask fora do act: esvazia os efeitos pendentes
    // para o ouvinte de teclas já enxergar o perfil ativo.
    await act(async () => { await Promise.resolve(); });
}

beforeAll(() => {
    estilo = document.createElement('style');
    estilo.textContent = readFileSync(FOLHA, 'utf-8');
    document.head.appendChild(estilo);
    if ((estilo.sheet?.cssRules.length ?? 0) === 0) {
        throw new Error('o jsdom não leu ProfileManager.css — o teste estaria medindo sem ela');
    }
});

afterAll(() => {
    estilo?.remove();
    estilo = null;
});

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('ProfileManager — foco do D-pad no X (fechar)', () => {
    it('↑ da primeira fileira acende o X e apaga o anel do cartão', async () => {
        await montar(() => { /* não interessa aqui */ });
        const x = botaoFechar();
        const xEmRepouso = aparencia(x);
        const [primeiro] = cartoes();

        // Antes: o anel está no 1º cartão, não no X
        expect(primeiro.classList.contains('focused')).toBe(true);
        const primeiroComAnel = aparencia(primeiro);

        apertar(CIMA);

        await waitFor(() => expect(x.classList.contains('focused')).toBe(true));
        // O X tem de PARECER focado: sem regra para .focused ele ficava igual.
        // Cada propriedade da regra muda — fundo, borda, anel e escala.
        const xAceso = aparencia(x);
        for (const prop of PROPRIEDADES) {
            expect(xAceso[prop], prop).not.toBe(xEmRepouso[prop]);
        }
        expect(['', 'none']).not.toContain(xAceso.boxShadow);
        // Um anel de 0px ou transparente é o mesmo que nenhum anel
        expect(espessuraDoAnel(xAceso.boxShadow)).toBeGreaterThan(0);
        expect(xAceso.boxShadow).not.toContain('transparent');
        expect(xAceso.transform).toContain('scale');
        // scale(1) não cresce nada: o X aceso tem de ficar MAIOR que em repouso
        expect(fatorDeEscala(xAceso.transform)).toBeGreaterThan(1);
        // Sem o rotate(90deg) do :hover — a 3 m ele só embaralha o X
        expect(xAceso.transform).not.toContain('rotate');

        soOXAceso(x);
        expect(aparencia(primeiro)).not.toEqual(primeiroComAnel);
    });

    it('↑ a partir do cartão "+" também deixa o anel só no X', async () => {
        await montar(() => { /* não interessa aqui */ });
        const x = botaoFechar();

        // Principal e Kids na primeira fileira: ↓ do 1º cartão cai no "+" (índice 2)
        apertar(BAIXO);
        await waitFor(() => expect(cartaoAdicionar().classList.contains('focused')).toBe(true));

        apertar(CIMA);

        await waitFor(() => expect(x.classList.contains('focused')).toBe(true));
        soOXAceso(x);
    });

    it('↑ a partir do Kids (meio da primeira fileira) também deixa o anel só no X', async () => {
        await montar(() => { /* não interessa aqui */ });
        const x = botaoFechar();

        // ↓ cai no "+" (índice 2) e ← volta para o Kids (índice 1): o Kids não
        // tem Editar/Excluir, então o ← é navegação de grade
        apertar(BAIXO);
        await waitFor(() => expect(cartaoAdicionar().classList.contains('focused')).toBe(true));
        apertar(ESQUERDA);
        await waitFor(() => expect(cartaoKids().classList.contains('focused')).toBe(true));

        apertar(CIMA);

        await waitFor(() => expect(x.classList.contains('focused')).toBe(true));
        soOXAceso(x);
    });

    it('←/→ com o X aceso não acendem nada no cartão por baixo', async () => {
        const onClose = vi.fn();
        await montar(onClose);
        const x = botaoFechar();

        apertar(CIMA);
        await waitFor(() => expect(x.classList.contains('focused')).toBe(true));

        // O → ainda mexe no sub-foco do cartão por baixo (Editar); nada disso
        // pode aparecer enquanto o X está aceso
        apertar(DIREITA);
        soOXAceso(x);
        apertar(ESQUERDA);
        apertar(DIREITA);
        soOXAceso(x);

        // E o OK continua sendo do X
        apertar(ENTER);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Editar Perfil')).toBeNull();
    });

    it('OK com o X aceso fecha o gerenciador (o comportamento continua o mesmo)', async () => {
        const onClose = vi.fn();
        await montar(onClose);

        apertar(CIMA);
        await waitFor(() => expect(botaoFechar().classList.contains('focused')).toBe(true));
        apertar(ENTER);

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('↓ a partir do X devolve o anel ao cartão e apaga o X', async () => {
        await montar(() => { /* não interessa aqui */ });
        const x = botaoFechar();
        const xEmRepouso = aparencia(x);

        apertar(CIMA);
        await waitFor(() => expect(x.classList.contains('focused')).toBe(true));
        apertar(BAIXO);

        await waitFor(() => expect(x.classList.contains('focused')).toBe(false));
        expect(aparencia(x)).toEqual(xEmRepouso);
        const acesos = cartoes().filter(c => c.classList.contains('focused'));
        expect(acesos).toHaveLength(1);
        expect(acesos[0]).toBe(cartoes()[0]);
    });
});
