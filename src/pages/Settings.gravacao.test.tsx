// @vitest-environment jsdom
//
// 💾 "PIN parental criado." com o PIN que não foi gravado (T107).
//
// Com a quota da TV cheia e nada descartável pra podar, a gravação do PIN, das
// travas e da troca/remoção de playlist falhava em silêncio e a tela seguia
// como se tivesse dado certo: no boot seguinte não havia PIN nenhum, e o modo
// Kids ficava aberto sem ninguém saber. Aqui a página de verdade roda por
// D-pad contra um localStorage que TEM quota.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { installFakeStorage, type FakeStorage } from '../testing/fakeStorage';
import { parentalService } from '../services/parentalService';
import { playlistService } from '../services/playlistService';
import { storage } from '../services/storage';
import { Settings } from './Settings';

if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
// O jsdom não implementa scrollIntoView, e a página rola a seção focada
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
}

const QUOTA = 50_000;
const SEM_ESPACO = /memória da TV está cheia/;

let fake: FakeStorage;

beforeEach(() => {
    fake = installFakeStorage(QUOTA);
});

afterEach(() => {
    cleanup();
});

/** Dado do usuário (não é cache): a poda do safeStorage não tem o que apagar. */
function estourarQuota(): void {
    fake.store.set('neostream_favorites', 'x'.repeat(QUOTA));
}

function tecla(key: string): void {
    fireEvent.keyDown(window, { key });
}

/** O valor (à direita) da linha cujo rótulo casa com `rotulo`. */
function valorDaLinha(rotulo: RegExp): HTMLElement {
    const label = screen.getByText(rotulo);
    const valor = label.parentElement?.querySelector<HTMLElement>('.settings-value');
    if (!valor) throw new Error(`linha sem valor: ${rotulo}`);
    return valor;
}

/** Desce com o D-pad até a linha ficar em foco — espera a condição, não uma contagem. */
function descerAte(rotulo: RegExp): void {
    for (let passos = 0; !valorDaLinha(rotulo).classList.contains('focused'); passos++) {
        if (passos > 40) throw new Error(`o D-pad não chegou em ${rotulo}`);
        tecla('ArrowDown');
    }
}

function digitar(pin: string): void {
    for (const digito of pin) tecla(digito);
}

const LINHA_PIN = /^PIN de 4 dígitos/;
const LINHA_TRAVA_CONFIG = /^Pedir PIN pra abrir Configurações$/;
const LINHA_TRAVA_KIDS = /^Pedir PIN pra sair de um perfil Kids$/;

describe('Configurações com a memória cheia — PIN parental', () => {
    it('criar o PIN que não coube avisa em vez de dizer "criado", e o PIN não passa a existir', async () => {
        render(<Settings />);
        estourarQuota();
        descerAte(LINHA_PIN);
        tecla('Enter');
        expect(screen.getByText(/Criar PIN parental/)).toBeTruthy();

        digitar('4271');

        expect(await screen.findByText(SEM_ESPACO)).toBeTruthy();
        expect(screen.queryByText('PIN parental criado.')).toBeNull();
        // Não é "PIN incorreto": o PIN estava certo, faltou espaço
        expect(screen.queryByText(/PIN incorreto/)).toBeNull();
        expect(valorDaLinha(LINHA_PIN).textContent).toBe('Não definido');
        expect(parentalService.isSet()).toBe(false);
    });

    it('com espaço, cria e diz que criou (controle)', async () => {
        render(<Settings />);
        descerAte(LINHA_PIN);
        tecla('Enter');
        digitar('4271');

        expect(await screen.findByText('PIN parental criado.')).toBeTruthy();
        expect(screen.queryByText(SEM_ESPACO)).toBeNull();
        expect(valorDaLinha(LINHA_PIN).textContent).toBe('Definido');
        expect(parentalService.isSet()).toBe(true);
    });
});

describe('Configurações com a memória cheia — travas', () => {
    it('←→ numa trava que não coube avisa e a trava continua como estava', () => {
        render(<Settings />);
        estourarQuota();
        descerAte(LINHA_TRAVA_CONFIG);
        tecla('ArrowLeft');

        expect(screen.getByText(SEM_ESPACO)).toBeTruthy();
        expect(valorDaLinha(LINHA_TRAVA_CONFIG).textContent).toBe('Ligado');
        expect(parentalService.getGates().settings).toBe(true);
    });

    it('OK numa trava que não coube avisa e a trava continua como estava', () => {
        render(<Settings />);
        estourarQuota();
        descerAte(LINHA_TRAVA_KIDS);
        tecla('Enter');

        expect(screen.getByText(SEM_ESPACO)).toBeTruthy();
        expect(valorDaLinha(LINHA_TRAVA_KIDS).textContent).toBe('Ligado');
        expect(parentalService.getGates().leaveKids).toBe(true);
    });

    it('trava mudada depois de provar o PIN, sem espaço: avisa e não muda', async () => {
        expect(await parentalService.set('4271')).toBe(true);
        // Sem a trava de ENTRADA, a página abre direto — mas mexer nas travas
        // ainda pede o PIN (caminho do 'unlock')
        expect(parentalService.setGates({ settings: false })).toBe(true);
        render(<Settings />);
        estourarQuota();
        descerAte(LINHA_TRAVA_KIDS);
        tecla('ArrowLeft');
        expect(screen.getByText(/Confirmar com o PIN/)).toBeTruthy();

        digitar('4271');

        expect(await screen.findByText(SEM_ESPACO)).toBeTruthy();
        expect(valorDaLinha(LINHA_TRAVA_KIDS).textContent).toBe('Ligado');
        expect(parentalService.getGates().leaveKids).toBe(true);
    });

    it('com espaço, ←→ muda a trava sem aviso (controle)', () => {
        render(<Settings />);
        descerAte(LINHA_TRAVA_CONFIG);
        tecla('ArrowLeft');

        expect(valorDaLinha(LINHA_TRAVA_CONFIG).textContent).toBe('Desligado');
        expect(screen.queryByText(SEM_ESPACO)).toBeNull();
        expect(parentalService.getGates().settings).toBe(false);
    });
});

describe('Configurações com a memória cheia — playlists', () => {
    function duasPlaylists(): void {
        storage.saveCredentials({ url: 'http://a.example', username: 'u', password: 'p' });
        playlistService.migrate();
        playlistService.registerFromLogin({ url: 'http://b.example', username: 'u2', password: 'p2' });
        expect(playlistService.list()).toHaveLength(2);
    }

    it('trocar pra uma playlist que não coube avisa e não troca a credencial', () => {
        duasPlaylists();
        const antes = storage.getCredentials();
        render(<Settings />);
        estourarQuota();

        fireEvent.click(screen.getByText('a.example'));

        expect(screen.getByText(SEM_ESPACO)).toBeTruthy();
        expect(storage.getCredentials()).toEqual(antes);
    });

    it('remover uma playlist sem espaço avisa e ela continua na lista', () => {
        duasPlaylists();
        render(<Settings />);
        estourarQuota();

        const botao = screen.getByText('a.example').closest('button');
        const remover = botao?.querySelector('.playlist-remove');
        if (!remover) throw new Error('sem o ✕ da playlist não ativa');
        fireEvent.click(remover);

        expect(screen.getByText(SEM_ESPACO)).toBeTruthy();
        expect(screen.queryByText(/removida\./)).toBeNull();
        expect(screen.getByText('a.example')).toBeTruthy();
    });
});
