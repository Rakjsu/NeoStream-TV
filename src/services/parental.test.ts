// Controle parental — o gate que separa uma criança do catálogo adulto.
//
// A força aqui não está no hash (são 4 dígitos num aparelho doméstico: 10.000
// combinações), está no LIMITE DE TENTATIVAS. Sem ele um controle remoto
// tentando uma vez por segundo abre o gate numa tarde de domingo.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { installFakeStorage } from '../testing/fakeStorage';
import { parentalService } from './parentalService';

// O ambiente node do vitest não tem `crypto.subtle` global em toda versão
if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const CERTO = '4271';
const ERRADO = '0000';

beforeEach(async () => {
    installFakeStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 21, 12, 0, 0));
    await parentalService.set(CERTO);
});

afterEach(() => {
    vi.useRealTimers();
});

async function errar(vezes: number) {
    for (let i = 0; i < vezes; i++) await parentalService.verify(ERRADO);
}

describe('PIN', () => {
    it('aceita o certo e recusa o errado', async () => {
        expect(await parentalService.verify(CERTO)).toBe(true);
        expect(await parentalService.verify(ERRADO)).toBe(false);
    });

    it('só aceita 4 dígitos ao definir', async () => {
        expect(await parentalService.set('123')).toBe(false);
        expect(await parentalService.set('12a4')).toBe(false);
        expect(await parentalService.set('12345')).toBe(false);
    });

    // Sem PIN configurado, verify tem que ser fail-CLOSED: um fail-open
    // transformaria "não configurei PIN" em "qualquer PIN serve".
    it('sem PIN configurado, nada passa', async () => {
        parentalService.clear();
        expect(parentalService.isSet()).toBe(false);
        expect(await parentalService.verify(CERTO)).toBe(false);
        expect(await parentalService.verify('')).toBe(false);
    });

    it('não guarda o PIN em texto claro', () => {
        const gravado = localStorage.getItem('neostream_parental_pin') || '';
        expect(gravado).not.toContain(CERTO);
        expect(gravado).toMatch(/^[0-9a-f]{64}$/); // SHA-256 em hex
    });
});

describe('limite de tentativas', () => {
    it('trava depois de 5 erros', async () => {
        await errar(4);
        expect(parentalService.travaRestanteMs()).toBe(0);
        expect(parentalService.tentativasRestantes()).toBe(1);

        await parentalService.verify(ERRADO); // o 5º
        expect(parentalService.travaRestanteMs()).toBe(30_000);
    });

    // O caso que importa: durante a espera nem o PIN CERTO abre. Se abrisse,
    // a espera seria decorativa — bastaria continuar tentando.
    it('durante a espera nem o PIN certo passa', async () => {
        await errar(5);
        expect(await parentalService.verify(CERTO)).toBe(false);
    });

    it('passada a espera, o PIN certo volta a valer', async () => {
        await errar(5);
        vi.advanceTimersByTime(30_000);
        expect(parentalService.travaRestanteMs()).toBe(0);
        expect(await parentalService.verify(CERTO)).toBe(true);
    });

    it('a espera cresce a cada rodada e para de crescer', async () => {
        const esperas: number[] = [];
        for (let rodada = 0; rodada < 5; rodada++) {
            await errar(5);
            const espera = parentalService.travaRestanteMs();
            esperas.push(espera);
            vi.advanceTimersByTime(espera);
        }
        expect(esperas).toEqual([30_000, 120_000, 600_000, 1_800_000, 1_800_000]);
    });

    it('acertar zera a contagem', async () => {
        await errar(4);
        expect(await parentalService.verify(CERTO)).toBe(true);
        expect(parentalService.tentativasRestantes()).toBe(5);

        await errar(4);
        expect(parentalService.travaRestanteMs()).toBe(0);
    });

    // Fechar e reabrir o app é o primeiro reflexo de quem está tentando
    // adivinhar. Se o contador vivesse em memória, isso zeraria tudo.
    it('a contagem sobrevive a reabrir o app', async () => {
        await errar(5);
        const guardado = localStorage.getItem('neostream_parental_lock');
        expect(guardado).toBeTruthy();

        // "reabrir": o módulo lê de novo do armazenamento
        expect(parentalService.travaRestanteMs()).toBeGreaterThan(0);
        expect(await parentalService.verify(CERTO)).toBe(false);
    });

    // O relógio de uma TV muda sozinho (fuso, NTP, tomada). Uma trava ancorada
    // no futuro distante prenderia o dono do aparelho pra sempre.
    it('relógio pro passado não tranca o aparelho pra sempre', async () => {
        await errar(5);
        vi.setSystemTime(new Date(2020, 0, 1)); // TV voltou 6 anos
        expect(parentalService.travaRestanteMs()).toBe(0);
        expect(await parentalService.verify(CERTO)).toBe(true);
    });

    it('definir ou remover o PIN limpa a espera', async () => {
        await errar(5);
        expect(parentalService.travaRestanteMs()).toBeGreaterThan(0);
        await parentalService.set('1111');
        expect(parentalService.travaRestanteMs()).toBe(0);

        await errar(5);
        parentalService.clear();
        expect(parentalService.travaRestanteMs()).toBe(0);
    });

    it('estado corrompido não trava nem abre o gate', async () => {
        localStorage.setItem('neostream_parental_lock', 'lixo{');
        expect(parentalService.travaRestanteMs()).toBe(0);
        expect(await parentalService.verify(CERTO)).toBe(true);
    });
});

describe('gates', () => {
    it('ambos ligados por padrão', () => {
        expect(parentalService.getGates()).toEqual({ settings: true, leaveKids: true });
    });

    it('requires exige PIN configurado E gate ligado', () => {
        expect(parentalService.requires('settings')).toBe(true);
        parentalService.setGates({ settings: false });
        expect(parentalService.requires('settings')).toBe(false);
        expect(parentalService.requires('leaveKids')).toBe(true);

        parentalService.clear();
        expect(parentalService.requires('leaveKids')).toBe(false);
    });
});
