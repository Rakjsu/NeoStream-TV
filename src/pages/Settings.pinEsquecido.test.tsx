// @vitest-environment jsdom
//
// ➕ PIN parental esquecido trancava as Configurações pra sempre (T073).
//
// Com a trava "Pedir PIN pra abrir Configurações" ligada (o padrão), a página
// devolvia só o PinPrompt, e o único apagador do PIN morava DENTRO dela. Quatro
// dígitos esquecidos = idioma, tema, playlists e diagnóstico perdidos até
// reinstalar o .wgt, que leva junto favoritos, histórico e credenciais.
//
// A saída não pode ser "apagar tudo sem provar nada": isso é exatamente o
// caminho lateral que a linha "Apagar dados → Conta e perfis" fechou de
// propósito (o modo Kids viraria três toques). O resgate pede a senha da conta
// IPTV — o segredo do dono do aparelho, que a criança no perfil Kids não tem —
// e remove SÓ o PIN.
//
// Os testes montam as Configurações de verdade e dirigem pelo teclado, como o
// controle remoto.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { installFakeStorage } from '../testing/fakeStorage';
import { parentalService } from '../services/parentalService';
import { storage } from '../services/storage';
import { Settings } from './Settings';
import { PinPrompt } from '../components/PinPrompt';

if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
// O jsdom não implementa scrollIntoView, e a página rola a seção focada
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
}

const PIN = '4271';
const SENHA = 'senha-do-provedor-9';
const FAVORITOS = '[{"id":1,"type":"movie","title":"Filme"}]';

beforeEach(async () => {
    installFakeStorage();
    storage.saveCredentials({ url: 'http://prov.invalid', username: 'dono', password: SENHA });
    // Dado do usuário que o resgate NÃO pode levar junto
    localStorage.setItem('neostream_favorites', FAVORITOS);
    expect(await parentalService.set(PIN)).toBe(true);
});

afterEach(() => {
    cleanup();
});

function tecla(key: string): void {
    fireEvent.keyDown(window, { key });
}

/** Esvazia os efeitos: o ouvinte do useTVNavigation é re-registrado num efeito. */
async function assentar(): Promise<void> {
    await act(async () => { await Promise.resolve(); });
}

function botaoEsqueci(): HTMLElement {
    return screen.getByText('Esqueci o PIN');
}

/** Desce com o D-pad até o "Esqueci o PIN" — espera a condição, não uma contagem. */
function descerAteEsqueci(): void {
    for (let passos = 0; !botaoEsqueci().classList.contains('tv-focused'); passos++) {
        if (passos > 10) throw new Error('o D-pad não chega no "Esqueci o PIN"');
        tecla('ArrowDown');
    }
}

function campoDaSenha(): HTMLInputElement {
    return screen.getByLabelText('Senha da conta IPTV') as HTMLInputElement;
}

/** Digita no campo (o IME da TV) e fecha com o OK de dentro do campo. */
function digitarSenha(valor: string): void {
    const campo = campoDaSenha();
    campo.focus();
    fireEvent.change(campo, { target: { value: valor } });
    fireEvent.keyDown(campo, { key: 'Enter' });
}

/** O valor (à direita) da linha cujo rótulo casa com `rotulo`. */
function valorDaLinha(rotulo: RegExp): HTMLElement {
    const label = screen.getByText(rotulo);
    const valor = label.parentElement?.querySelector<HTMLElement>('.settings-value');
    if (!valor) throw new Error(`linha sem valor: ${rotulo}`);
    return valor;
}

const LINHA_PIN = /^PIN de 4 dígitos/;
const LINHA_SAIR_DO_KIDS = /^Pedir PIN pra sair de um perfil Kids/;

function descerAteLinha(rotulo: RegExp): void {
    for (let passos = 0; !valorDaLinha(rotulo).classList.contains('focused'); passos++) {
        if (passos > 40) throw new Error(`o D-pad não chegou em ${rotulo}`);
        tecla('ArrowDown');
    }
}

describe('PIN parental esquecido — porta de entrada das Configurações', () => {
    it('"Esqueci o PIN" + a senha da conta removem o PIN e abrem a página, sem apagar mais nada', async () => {
        render(<Settings />);
        expect(screen.getByText(/Configurações protegidas/)).toBeTruthy();

        descerAteEsqueci();
        tecla('Enter');
        await assentar();

        // Senha errada: não destrava e diz por quê
        digitarSenha('chute-da-crianca');
        expect(await screen.findByText(/não confere/)).toBeTruthy();
        expect(parentalService.isSet()).toBe(true);
        expect(screen.queryByText('Aparência, uso e integrações')).toBeNull();
        await assentar();

        digitarSenha(SENHA);

        expect(await screen.findByText(/PIN parental removido/)).toBeTruthy();
        expect(screen.getByText('Aparência, uso e integrações')).toBeTruthy();
        expect(parentalService.isSet()).toBe(false);
        expect(valorDaLinha(LINHA_PIN).textContent).toBe('Não definido');
        // Só o PIN saiu: favoritos e a conta continuam
        expect(localStorage.getItem('neostream_favorites')).toBe(FAVORITOS);
        expect(storage.getCredentials()?.password).toBe(SENHA);

        // E a página fica destravada de verdade: mexer numa trava não pede
        // o PIN que acabou de sumir (senão ninguém conseguiria confirmá-lo)
        await assentar();
        descerAteLinha(LINHA_SAIR_DO_KIDS);
        tecla('Enter');
        expect(screen.queryByText(/Confirmar com o PIN/)).toBeNull();
        expect(valorDaLinha(LINHA_SAIR_DO_KIDS).textContent).toBe('Desligado');
    });

    it('"Esqueci o PIN" funciona DURANTE a espera — e a espera vale pra senha também', async () => {
        // Quem errou o PIN 5 vezes é justamente quem mais precisa do resgate
        for (let i = 0; i < 5; i++) expect(await parentalService.verify('0000')).toBe(false);
        expect(parentalService.travaRestanteMs()).toBeGreaterThan(0);

        render(<Settings />);
        expect(screen.getByText(/Muitas tentativas/)).toBeTruthy();
        descerAteEsqueci();
        tecla('Enter');
        await assentar();

        expect(campoDaSenha()).toBeTruthy();
        expect(screen.getByText(/Muitas tentativas/)).toBeTruthy();

        // Nem a senha certa passa enquanto a espera durar
        digitarSenha(SENHA);
        await assentar();
        expect(screen.getByText(/Muitas tentativas/)).toBeTruthy();
        expect(parentalService.isSet()).toBe(true);
        expect(screen.queryByText('Aparência, uso e integrações')).toBeNull();
    });

    it('OK do teclado da TV confere o que está NO CAMPO, mesmo antes de o React ver a digitação', async () => {
        render(<Settings />);
        descerAteEsqueci();
        tecla('Enter');
        await assentar();

        // O IME escreve no campo e o OK chega sem 'change' processado
        const campo = campoDaSenha();
        campo.focus();
        campo.value = SENHA;
        fireEvent.keyDown(campo, { key: 'Enter' });

        expect(await screen.findByText(/PIN parental removido/)).toBeTruthy();
        expect(parentalService.isSet()).toBe(false);
    });

    it('Voltar no resgate devolve ao teclado do PIN — a trava continua de pé', async () => {
        render(<Settings />);
        descerAteEsqueci();
        tecla('Enter');
        await assentar();
        expect(campoDaSenha()).toBeTruthy();

        tecla('XF86Back');
        await assentar();

        expect(screen.getByText(/Configurações protegidas/)).toBeTruthy();
        expect(screen.queryByLabelText('Senha da conta IPTV')).toBeNull();
        expect(parentalService.isSet()).toBe(true);
    });

    it('sem conta salva não há senha pra conferir — o resgate não é oferecido', () => {
        storage.clearCredentials();
        render(<Settings />);

        expect(screen.getByText(/Configurações protegidas/)).toBeTruthy();
        expect(screen.queryByText('Esqueci o PIN')).toBeNull();
    });

    it('OK com o campo vazio abre o teclado e não gasta tentativa; não existe "apagar tudo"', async () => {
        render(<Settings />);
        descerAteEsqueci();
        tecla('Enter');
        await assentar();

        const antes = parentalService.tentativasRestantes();
        tecla('Enter');
        expect(document.activeElement).toBe(campoDaSenha());
        expect(parentalService.tentativasRestantes()).toBe(antes);

        // OK de dentro do campo ainda vazio: fecha o teclado sem conferir nada
        // e NÃO o reabre (refocar ali prende o IME do Tizen num laço)
        fireEvent.keyDown(campoDaSenha(), { key: 'Enter' });
        await assentar();
        expect(document.activeElement).not.toBe(campoDaSenha());
        expect(parentalService.tentativasRestantes()).toBe(antes);
        expect(parentalService.isSet()).toBe(true);
        expect(storage.getCredentials()?.password).toBe(SENHA);
        expect(screen.queryByText(/Apagar tudo/)).toBeNull();
    });
});

describe('PIN parental esquecido — remover o PIN com a página aberta', () => {
    it('com a trava de entrada desligada, "Remover PIN" também tem o resgate', async () => {
        expect(parentalService.setGates({ settings: false })).toBe(true);
        render(<Settings />);
        descerAteLinha(LINHA_PIN);
        tecla('Enter');
        expect(screen.getByText(/Confirmar com o PIN/)).toBeTruthy();

        descerAteEsqueci();
        tecla('Enter');
        await assentar();
        digitarSenha(SENHA);

        expect(await screen.findByText(/PIN parental removido/)).toBeTruthy();
        expect(parentalService.isSet()).toBe(false);
        expect(valorDaLinha(LINHA_PIN).textContent).toBe('Não definido');
    });

    it('Voltar no resgate devolve ao "Confirmar com o PIN" de onde saiu, não a uma trava de entrada desligada', async () => {
        expect(parentalService.setGates({ settings: false })).toBe(true);
        render(<Settings />);
        descerAteLinha(LINHA_PIN);
        tecla('Enter');
        descerAteEsqueci();
        tecla('Enter');
        await assentar();
        expect(campoDaSenha()).toBeTruthy();

        tecla('XF86Back');
        await assentar();

        expect(screen.getByText(/Confirmar com o PIN/)).toBeTruthy();
        expect(screen.queryByText(/Configurações protegidas/)).toBeNull();
        expect(parentalService.isSet()).toBe(true);
    });
});

describe('resgate por senha — limite de tentativas', () => {
    it('senha errada conta pro MESMO limite do PIN; durante a espera nem a certa passa', async () => {
        // 4 PINs errados + 1 senha errada = os 5 erros que armam a espera
        for (let i = 0; i < 4; i++) expect(await parentalService.verify('0000')).toBe(false);
        expect(parentalService.travaRestanteMs()).toBe(0);
        expect(parentalService.resgatarComSenhaDaConta('errada')).toBe(false);
        expect(parentalService.travaRestanteMs()).toBeGreaterThan(0);

        expect(parentalService.resgatarComSenhaDaConta(SENHA)).toBe(false);
        expect(parentalService.isSet()).toBe(true);
    });

    it('sem PIN definido não há o que resgatar', () => {
        parentalService.clear();
        expect(parentalService.resgatarComSenhaDaConta(SENHA)).toBe(false);
        expect(parentalService.podeResgatar()).toBe(false);
    });

    it('conta salva sem senha não vira "senha vazia serve"', () => {
        storage.saveCredentials({ url: 'http://prov.invalid', username: 'dono', password: '' });
        expect(parentalService.podeResgatar()).toBe(false);
        expect(parentalService.resgatarComSenhaDaConta('')).toBe(false);
        expect(parentalService.isSet()).toBe(true);
    });
});

describe('PinPrompt sem onForgot (perfis, criar PIN) — nada muda', () => {
    it('descer da última fileira não leva o foco pra um botão que não existe', () => {
        render(<PinPrompt title="PIN do perfil" onSubmit={() => false} onCancel={() => undefined} />);
        for (let i = 0; i < 6; i++) tecla('ArrowDown');

        expect(screen.queryByText('Esqueci o PIN')).toBeNull();
        const focados = document.querySelectorAll('.tv-focused');
        expect(focados.length).toBe(1);
        expect(focados[0].classList.contains('pin-key')).toBe(true);
    });
});

describe('PinPrompt com onForgot — o botão fica fora da grade', () => {
    it('Cima no "Esqueci o PIN" volta pro 0 do teclado — o foco não fica preso no botão', () => {
        render(<PinPrompt title="PIN" onSubmit={() => false} onCancel={() => undefined} onForgot={() => undefined} />);
        descerAteEsqueci();

        tecla('ArrowUp');

        const focados = document.querySelectorAll('.tv-focused');
        expect(focados.length).toBe(1);
        expect(focados[0].classList.contains('pin-key')).toBe(true);
        expect(focados[0].textContent).toBe('0');
        tecla('Enter');
        expect(document.querySelectorAll('.pin-dot.filled').length).toBe(1);
    });
});
