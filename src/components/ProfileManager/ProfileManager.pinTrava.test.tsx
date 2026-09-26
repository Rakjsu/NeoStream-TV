// @vitest-environment jsdom
//
// 🔒 O PIN de PERFIL não tinha limite de tentativas (T048).
//
// O PIN parental trava depois de 5 erros (30s, 2min, 10min, 30min) porque 4
// dígitos são 10.000 combinações e o controle faz uma tentativa por segundo.
// O PIN de entrada de cada perfil tem o MESMO espaço e nenhum limite: do Kids,
// OK no card Principal e era só ir digitando — "PIN incorreto." para sempre,
// sem espera, sem aviso, e fechar o app não mudava nada porque não havia nada
// para zerar.
//
// Aqui a tela de verdade, com o profileService de verdade (localStorage do
// jsdom), e as teclas chegando como a TV entrega.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor, act } from '@testing-library/react';
import { ProfileManager } from './ProfileManager';
import { profileService } from '../../services/profileService';

const ENTER = { key: 'Enter', keyCode: 13 };
const PIN_ADULTO = '1234';
const ERRADO = '0000';

function apertar(tecla: { key: string; keyCode: number }): void {
    fireEvent.keyDown(document.activeElement ?? document.body, tecla);
}

/** Números do controle: o PinPrompt escuta no window (4º dígito confirma). */
function digitar(pin: string): void {
    for (const d of pin) fireEvent.keyDown(window, { key: d, keyCode: 48 + Number(d) });
}

function promptDePin(): HTMLElement | null {
    return document.querySelector('.pin-overlay');
}

function mensagemDoPrompt(): string {
    return document.querySelector('.pin-overlay .pin-error')?.textContent ?? '';
}

function digitosPreenchidos(): number {
    return document.querySelectorAll('.pin-overlay .pin-dot.filled').length;
}

/** O Principal ganha PIN e o Kids vira o ativo: a TV na mão da criança. */
async function prepararKidsAtivo(): Promise<void> {
    profileService.initialize();
    expect(await profileService.updateProfile('default', { pin: PIN_ADULTO })).toBe(true);
    expect(profileService.setActiveProfile('kids-default')).toBe(true);
}

let fechou = false;

async function montar(): Promise<void> {
    fechou = false;
    render(<ProfileManager onClose={() => { fechou = true; }} />);
    await screen.findByText('Principal');
    // A lista chega num microtask fora do act: esvazia os efeitos antes da 1ª
    // tecla, senão o ouvinte do useTVNavigation ainda é o do estado vazio.
    await act(async () => { await Promise.resolve(); });
}

/** OK no card Principal (o focado ao abrir): troca de perfil → PIN dele. */
async function abrirPinDoPrincipal(): Promise<void> {
    apertar(ENTER);
    expect(promptDePin()).not.toBeNull();
    expect(screen.getByText('Perfil: Principal')).toBeTruthy();
    await act(async () => { await Promise.resolve(); });
}

/**
 * Um PIN errado inteiro, esperando a CONDIÇÃO de que ele foi julgado: o
 * digitar deixa os 4 pontos cheios e a mensagem limpa; o julgamento (fora do
 * act, a conferência é assíncrona) esvazia os pontos e põe a mensagem.
 */
async function errarUmaVez(): Promise<string> {
    digitar(ERRADO);
    await waitFor(() => {
        expect(digitosPreenchidos()).toBe(0);
        expect(mensagemDoPrompt()).not.toBe('');
    });
    // O ouvinte dos dígitos é re-registrado num efeito: esvazia antes da próxima
    await act(async () => { await Promise.resolve(); });
    return mensagemDoPrompt();
}

describe('ProfileManager — o PIN de perfil tem limite de tentativas (T048)', () => {
    beforeEach(() => {
        localStorage.clear();
    });
    afterEach(() => {
        cleanup();
        localStorage.clear();
    });

    it('5 erros travam o PIN do perfil; a tela avisa antes e mostra a espera depois', async () => {
        await prepararKidsAtivo();
        await montar();
        await abrirPinDoPrincipal();

        const mensagens: string[] = [];
        for (let i = 0; i < 5; i++) mensagens.push(await errarUmaVez());

        expect(mensagens).toEqual([
            'PIN incorreto.',
            'PIN incorreto.',
            'PIN incorreto. Mais 2 tentativas antes da espera.',
            'PIN incorreto. Mais 1 tentativa antes da espera.',
            'Muitas tentativas. Tente de novo em 30 s.',
        ]);
        expect(document.querySelectorAll('.pin-key-locked').length).toBeGreaterThan(0);
    });

    // O caso que importa: durante a espera nem o PIN CERTO abre. Se abrisse,
    // a espera seria decorativa — bastaria continuar tentando.
    it('durante a espera nem o PIN certo troca de perfil', async () => {
        await prepararKidsAtivo();
        await montar();
        await abrirPinDoPrincipal();
        for (let i = 0; i < 5; i++) await errarUmaVez();

        // Nenhum dígito entra: sem o 4º ponto não há envio nenhum a esperar
        // (a recusa do próprio serviço está no profilePinLock.test)
        digitar(PIN_ADULTO);
        expect(digitosPreenchidos()).toBe(0);

        expect(fechou).toBe(false);
        expect(profileService.getActiveProfile()?.id).toBe('kids-default');
        expect(promptDePin()).not.toBeNull();
        expect(mensagemDoPrompt()).toMatch(/^Muitas tentativas\. Tente de novo em \d+ s\.$/);
    });

    // Fechar e reabrir é o primeiro reflexo de quem está tentando adivinhar.
    it('fechar e reabrir o gerenciador não zera a espera', async () => {
        await prepararKidsAtivo();
        await montar();
        await abrirPinDoPrincipal();
        for (let i = 0; i < 5; i++) await errarUmaVez();

        cleanup();
        await montar();
        await abrirPinDoPrincipal();

        // A espera aparece JÁ ao abrir, antes de qualquer dígito
        expect(mensagemDoPrompt()).toMatch(/^Muitas tentativas\. Tente de novo em \d+ s\.$/);
        digitar(PIN_ADULTO);
        expect(digitosPreenchidos()).toBe(0);
        expect(fechou).toBe(false);
        expect(profileService.getActiveProfile()?.id).toBe('kids-default');
    });

    it('antes da 5ª, o PIN certo entra e zera a contagem', async () => {
        await prepararKidsAtivo();
        await montar();
        await abrirPinDoPrincipal();
        for (let i = 0; i < 4; i++) await errarUmaVez();

        digitar(PIN_ADULTO);
        await waitFor(() => expect(fechou).toBe(true));
        expect(profileService.getActiveProfile()?.id).toBe('default');
        expect(profileService.travaDoPin('default').tentativasRestantes()).toBe(5);
    });
});
