// PIN de PERFIL com limite de tentativas (T048).
//
// O PIN parental ganhou limite porque 4 dígitos são 10.000 combinações e um
// controle faz uma tentativa por segundo. O PIN de entrada de cada perfil tem
// o MESMO espaço e ficava sem nada: sem contador, sem espera, sem memória
// entre aberturas do app — dava pra varrer o PIN do adulto a partir do Kids.
// Aqui o profileService de verdade, com o armazenamento de verdade.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { installFakeStorage } from '../testing/fakeStorage';
import { profileService } from './profileService';
import { parentalService } from './parentalService';
import { KEYS_CONTA } from './storageKeys';

if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const CERTO = '1234';
const ERRADO = '0000';
const CHAVE = 'neostream_profile_pin_lock';

beforeEach(async () => {
    installFakeStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 25, 12, 0, 0));
    profileService.initialize();
    expect(await profileService.updateProfile('default', { pin: CERTO })).toBe(true);
    expect(profileService.setActiveProfile('kids-default')).toBe(true);
});

afterEach(() => {
    vi.useRealTimers();
});

async function errar(vezes: number, id = 'default') {
    for (let i = 0; i < vezes; i++) expect(await profileService.verifyPin(id, ERRADO)).toBe(false);
}

describe('PIN de perfil — limite de tentativas (T048)', () => {
    it('trava depois de 5 erros e avisa quantas restam', async () => {
        const trava = profileService.travaDoPin('default');
        expect(trava.tentativasRestantes()).toBe(5);
        await errar(4);
        expect(trava.restanteMs()).toBe(0);
        expect(trava.tentativasRestantes()).toBe(1);

        await errar(1);
        expect(trava.restanteMs()).toBe(30_000);
    });

    // O caso que importa: durante a espera nem o PIN CERTO abre. Se abrisse,
    // a espera seria decorativa — bastaria continuar tentando.
    it('durante a espera nem o PIN certo passa; passada a espera, volta a valer', async () => {
        await errar(5);
        expect(await profileService.verifyPin('default', CERTO)).toBe(false);

        vi.advanceTimersByTime(30_000);
        expect(profileService.travaDoPin('default').restanteMs()).toBe(0);
        expect(await profileService.verifyPin('default', CERTO)).toBe(true);
    });

    it('a espera cresce a cada rodada e para de crescer', async () => {
        const trava = profileService.travaDoPin('default');
        const esperas: number[] = [];
        for (let rodada = 0; rodada < 5; rodada++) {
            await errar(5);
            const espera = trava.restanteMs();
            esperas.push(espera);
            vi.advanceTimersByTime(espera);
        }
        expect(esperas).toEqual([30_000, 120_000, 600_000, 1_800_000, 1_800_000]);
    });

    it('acertar zera a contagem', async () => {
        await errar(4);
        expect(await profileService.verifyPin('default', CERTO)).toBe(true);
        expect(profileService.travaDoPin('default').tentativasRestantes()).toBe(5);
    });

    // Acertar zera também as RODADAS: o dono que esqueceu o PIN uma vez e
    // acertou depois da espera não herda a espera maior na próxima distração.
    it('acertar depois de uma espera faz a próxima voltar a ser de 30 s', async () => {
        await errar(5);
        vi.advanceTimersByTime(30_000);
        expect(await profileService.verifyPin('default', CERTO)).toBe(true);

        await errar(5);
        expect(profileService.travaDoPin('default').restanteMs()).toBe(30_000);
    });

    // Fechar e reabrir o app é o primeiro reflexo de quem está tentando.
    it('a contagem mora no armazenamento e sobrevive a reabrir o app', async () => {
        await errar(5);
        expect(localStorage.getItem(CHAVE)).toBeTruthy();
        // "reabrir": o módulo lê de novo do armazenamento
        vi.resetModules();
        const { profileService: reaberto } = await import('./profileService');
        expect(reaberto.travaDoPin('default').restanteMs()).toBeGreaterThan(0);
        expect(await reaberto.verifyPin('default', CERTO)).toBe(false);
    });

    it('a trava é de cada perfil: errar o do adulto não tranca outro perfil', async () => {
        const outro = await profileService.createProfile({ name: 'Visita', avatar: 'B', pin: '5555' });
        expect(outro).not.toBeNull();
        await errar(5);
        expect(profileService.travaDoPin(outro!.id).restanteMs()).toBe(0);
        expect(await profileService.verifyPin(outro!.id, '5555')).toBe(true);
    });

    // O outro lado da mesma garantia: zerar a trava de um perfil (acertar o
    // PIN dele, trocá-lo, excluí-lo) não pode destrancar o adulto. Do Kids,
    // pôr um PIN no próprio perfil não pede PIN nenhum — se isso zerasse a
    // espera do Principal, a espera virava decorativa.
    it('zerar a trava de outro perfil não destranca o adulto', async () => {
        const outro = await profileService.createProfile({ name: 'Visita', avatar: 'B', pin: '5555' });
        expect(outro).not.toBeNull();
        await errar(5);

        expect(await profileService.verifyPin(outro!.id, '5555')).toBe(true);
        expect(await profileService.updateProfile('kids-default', { pin: '7777' })).toBe(true);
        expect(profileService.deleteProfile(outro!.id)).toBe(true);

        expect(profileService.travaDoPin('default').restanteMs()).toBe(30_000);
        expect(await profileService.verifyPin('default', CERTO)).toBe(false);
    });

    it('não mexe na trava do PIN parental (nem ela na do perfil)', async () => {
        expect(await parentalService.set('9090')).toBe(true);
        await errar(5);
        expect(parentalService.travaRestanteMs()).toBe(0);
        expect(parentalService.tentativasRestantes()).toBe(5);
        expect(localStorage.getItem('neostream_parental_lock')).toBeNull();
    });

    it('relógio pro passado não tranca o perfil pra sempre', async () => {
        await errar(5);
        vi.setSystemTime(new Date(2020, 0, 1)); // TV voltou 6 anos
        expect(profileService.travaDoPin('default').restanteMs()).toBe(0);
        expect(await profileService.verifyPin('default', CERTO)).toBe(true);
    });

    it('estado corrompido não trava nem abre', async () => {
        localStorage.setItem(CHAVE, 'lixo{');
        expect(profileService.travaDoPin('default').restanteMs()).toBe(0);
        expect(await profileService.verifyPin('default', ERRADO)).toBe(false);
        expect(await profileService.verifyPin('default', CERTO)).toBe(true);
    });

    it('trocar ou remover o PIN (quem já provou ser o dono) limpa a espera', async () => {
        await errar(5);
        expect(await profileService.updateProfile('default', { pin: '4321' })).toBe(true);
        expect(profileService.travaDoPin('default').restanteMs()).toBe(0);
        expect(await profileService.verifyPin('default', '4321')).toBe(true);
    });

    it('excluir o perfil leva a trava dele junto (sem chave órfã)', async () => {
        const outro = await profileService.createProfile({ name: 'Visita', avatar: 'B', pin: '5555' });
        await errar(3, outro!.id);
        expect(localStorage.getItem(CHAVE)).toContain(outro!.id);
        expect(profileService.deleteProfile(outro!.id)).toBe(true);
        expect(localStorage.getItem(CHAVE)).toBeNull();
    });

    it('perfil sem PIN e perfil inexistente continuam fail-closed e não contam erro', async () => {
        expect(await profileService.verifyPin('kids-default', CERTO)).toBe(false);
        expect(await profileService.verifyPin('nao-existe', CERTO)).toBe(false);
        expect(localStorage.getItem(CHAVE)).toBeNull();
    });

    it('a chave nova está no inventário das chaves de conta (o reset a alcança)', () => {
        expect(KEYS_CONTA as readonly string[]).toContain(CHAVE);
    });
});
