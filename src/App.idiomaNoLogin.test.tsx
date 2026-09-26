// @vitest-environment jsdom
//
// 🌐 O botão de idioma do Login era uma porta de saída só de ida.
//
// Ele levava o App para a tela de idioma do PRIMEIRO USO, cujo "concluir" é o
// `checkAuth` do boot. Sem credencial salva, o `checkAuth` manda para a
// Welcome: o Login desmontava e o que a pessoa já tinha digitado no D-pad
// (servidor, usuário, senha) sumia. E o Voltar daquela tela é o pedido de
// SAÍDA do app — quem entrou pelo 🌐 e apertou Voltar armava o "aperte de novo
// para sair", e o segundo Voltar fechava o NeoStream em vez de voltar pro
// formulário.
//
// O teste monta o App de verdade, no caminho que a pessoa faz no controle.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import App from './App';
import { storage } from './services/storage';

const sair = vi.fn(() => true);

// A fábrica traz TODOS os exports do módulo; só a saída do app é espionada
vi.mock('./services/tizenApp', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./services/tizenApp')>()),
    exitApp: () => sair(),
}));

const TECLAS = {
    ok: { key: 'Enter', keyCode: 13 },
    cima: { key: 'ArrowUp', keyCode: 38 },
    baixo: { key: 'ArrowDown', keyCode: 40 },
    direita: { key: 'ArrowRight', keyCode: 39 },
    voltar: { key: 'XF86Back', keyCode: 10009 },
} as const;

async function tecla(nome: keyof typeof TECLAS): Promise<void> {
    await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { ...TECLAS[nome], bubbles: true }));
    });
    // O ouvinte do useTVNavigation é re-registrado num efeito a cada render:
    // esvazia os efeitos antes da próxima tecla
    await act(async () => { await Promise.resolve(); });
}

const SERVIDOR = 'http://meu-servidor.exemplo:8080';
const formulario = () => document.querySelector('.login-container') as HTMLElement | null;
const campoServidor = () => document.querySelector('.login-container input') as HTMLInputElement | null;
const telaDeIdioma = () => document.querySelector('.language-selection-container');

/** Na tela de fato: nem o elemento nem nenhum ancestral com display:none. */
function naTela(el: Element | null): boolean {
    for (let n = el; n; n = n.parentElement) {
        if (getComputedStyle(n).display === 'none') return false;
    }
    return el !== null;
}

/** Primeiro uso com idioma já escolhido e nenhuma credencial: App → Welcome → Login. */
async function abrirLoginEDigitarServidor(): Promise<void> {
    render(<App />);
    // Welcome na tela (o checkAuth roda num microtask depois do mount)
    await vi.waitFor(() => {
        expect(document.querySelector('.welcome-container')).not.toBeNull();
    });
    await act(async () => { await Promise.resolve(); });
    await tecla('ok'); // Welcome → Login

    await vi.waitFor(() => {
        expect(campoServidor()).not.toBeNull();
    });
    await act(async () => { await Promise.resolve(); });
    act(() => {
        fireEvent.change(campoServidor() as HTMLInputElement, { target: { value: SERVIDOR } });
    });
    // Foco do D-pad: servidor(0) → usuário(1) → senha(2) → TV(3) → VOD(4) → 🌐(5)
    for (let i = 0; i < 5; i++) await tecla('baixo');
}

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // Idioma já escolhido antes (settings existe), nenhuma credencial salva
    storage.saveSettings({ language: 'pt' });
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
    sair.mockClear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
});

describe('🌐 do Login', () => {
    it('trocar o idioma devolve ao MESMO formulário, traduzido e com o que já foi digitado', async () => {
        await abrirLoginEDigitarServidor();

        await tecla('ok'); // 🌐
        expect(telaDeIdioma()).not.toBeNull();
        // O formulário fica montado e escondido por baixo, não na tela junto
        expect(formulario()).not.toBeNull();
        expect(getComputedStyle(formulario() as HTMLElement).display).toBe('none');
        // ...e a tela de idioma não pode estar DENTRO dele, escondida junto
        expect(naTela(telaDeIdioma())).toBe(true);

        await tecla('direita'); // Português → English
        await tecla('ok');

        // De volta ao Login — não à Welcome
        expect(document.querySelector('.welcome-container')).toBeNull();
        expect(telaDeIdioma()).toBeNull();
        expect(getComputedStyle(formulario() as HTMLElement).display).not.toBe('none');
        // O formulário volta com o layout da própria classe (o display:flex do
        // Login.css): nenhum display inline sobrando por cima dele
        expect(formulario()?.style.display).toBe('');
        // O que foi digitado continua lá
        expect(campoServidor()?.value).toBe(SERVIDOR);
        // E a tela já está no idioma escolhido
        expect(storage.getSettings().language).toBe('en');
        expect(screen.getByText('Server Address')).toBeTruthy();
        expect(document.querySelector('.login-btn-lang')?.textContent).toContain('EN');
    });

    it('Voltar na tela de idioma aberta pelo 🌐 volta ao formulário e NÃO fecha o app', async () => {
        await abrirLoginEDigitarServidor();

        await tecla('ok'); // 🌐
        expect(telaDeIdioma()).not.toBeNull();

        // Antes: este Voltar ARMAVA a saída do app ("Pressione Voltar de novo
        // para sair") e o segundo fechava o NeoStream. Agora ele só desiste do
        // idioma — o próximo Voltar já é o do próprio Login.
        await tecla('voltar');

        expect(sair).not.toHaveBeenCalled();
        expect(document.querySelector('.app-exit-toast')).toBeNull();
        expect(telaDeIdioma()).toBeNull();
        expect(campoServidor()?.value).toBe(SERVIDOR);
        // Idioma não mudou: Voltar é "desisti"
        expect(storage.getSettings().language).toBe('pt');
    });

    it('com a tela de idioma aberta, as setas não mexem no formulário escondido', async () => {
        await abrirLoginEDigitarServidor();

        await tecla('ok'); // 🌐 (foco do Login fica em 5)
        await tecla('baixo'); // só a tela de idioma deve ouvir
        await tecla('voltar'); // desiste do idioma

        // Se o Login tivesse ouvido o ↓, o foco teria ido para o 6 ("Voltar",
        // que recarrega a página). OK agora tem que reabrir a tela de idioma —
        // e a tela de idioma que fechou não pode ter deixado ouvinte para trás
        // (ele escolheria o idioma focado e fecharia a tela de novo).
        await tecla('ok');
        expect(telaDeIdioma()).not.toBeNull();
        expect(storage.getSettings().language).toBe('pt');
    });

    it('de volta ao formulário, os campos ainda abrem para edição', async () => {
        await abrirLoginEDigitarServidor();

        await tecla('ok'); // 🌐
        await tecla('voltar'); // desiste do idioma

        // Os ouvintes de focus/blur são presos nos inputs UMA vez, no mount do
        // Login. Se o formulário fosse desmontado enquanto escolhe o idioma, os
        // inputs voltariam novos e sem ouvinte: o OK no campo não entraria em
        // modo de edição.
        for (let i = 0; i < 5; i++) await tecla('cima'); // 🌐(5) → servidor(0)
        await tecla('ok');
        expect(document.activeElement).toBe(campoServidor());
        expect(document.querySelector('.login-input-wrap.editing')).not.toBeNull();
    });

    it('com o mouse, o 🌐 e a escolha também ficam dentro do Login', async () => {
        await abrirLoginEDigitarServidor();

        act(() => {
            fireEvent.click(document.querySelector('.login-btn-lang') as HTMLElement);
        });
        expect(naTela(telaDeIdioma())).toBe(true);

        act(() => {
            fireEvent.click(document.querySelectorAll('.language-btn')[2] as HTMLElement); // Español
        });
        expect(telaDeIdioma()).toBeNull();
        expect(document.querySelector('.welcome-container')).toBeNull();
        expect(campoServidor()?.value).toBe(SERVIDOR);
        expect(storage.getSettings().language).toBe('es');
    });
});
