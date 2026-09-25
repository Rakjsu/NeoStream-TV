// Dado de CONTA gravado com a quota cheia (T107).
//
// Numa TV de 5 MB com capas do TMDB em cache, a quota vive no teto. PIN
// parental, perfis e playlists gravavam com um localStorage.setItem cru dentro
// de um try/catch mudo: sem podar o cache e sem contar pra ninguém. A tela
// anunciava "PIN parental criado" e no boot seguinte não havia PIN nenhum.
//
// Aqui cada serviço é exercitado de verdade contra o localStorage falso COM
// quota. Dois cenários por escrita:
//   - há cache descartável → a gravação tem de PODAR e caber;
//   - não há o que podar   → a gravação tem de DIZER que falhou.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { installFakeStorage, type FakeStorage } from '../testing/fakeStorage';
import { parentalService } from './parentalService';
import { profileService } from './profileService';
import { playlistService } from './playlistService';
import { storage } from './storage';

if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const QUOTA = 20_000;

let fake: FakeStorage;

beforeEach(() => {
    fake = installFakeStorage(QUOTA);
    // O profileService loga no console.error quando recusa; não polui a saída
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Enche o aparelho até sobrarem `sobra` bytes, direto no mapa (o setItem do
 * falso recusaria). `chave` decide se o enchimento é cache (podável) ou dado
 * do usuário (intocável).
 */
function encher(chave: string, sobra: number): void {
    const livre = QUOTA - fake.used() - sobra;
    const unidades = Math.floor(livre / 2) - chave.length;
    expect(unidades, 'o cenário não cabe na quota do teste').toBeGreaterThan(0);
    fake.store.set(chave, 'x'.repeat(unidades));
}

/** Quota ESTOURADA de saída: nenhuma gravação cabe, nem a que encolhe o valor. */
function estourar(): void {
    fake.store.set('neostream_favorites', 'x'.repeat(QUOTA));
}

describe('PIN parental com a quota cheia', () => {
    it('sem cache pra podar: set() devolve false e o PIN NÃO passa a existir', async () => {
        encher('neostream_favorites', 40);
        expect(await parentalService.set('4271')).toBe(false);
        expect(parentalService.isSet()).toBe(false);
    });

    it('com cache pra podar: poda, grava e o PIN passa a valer', async () => {
        encher('tmdb_movie_550', 40);
        expect(await parentalService.set('4271')).toBe(true);
        expect(parentalService.isSet()).toBe(true);
        expect(await parentalService.verify('4271')).toBe(true);
        expect(fake.store.has('tmdb_movie_550')).toBe(false);
    });

    it('trocar o PIN sem espaço mantém o antigo e diz que falhou', async () => {
        expect(await parentalService.set('1111')).toBe(true);
        estourar();
        expect(await parentalService.set('2222')).toBe(false);
        // O PIN antigo segue valendo — e a tela não pode dizer que trocou
        fake.store.delete('neostream_favorites');
        expect(await parentalService.verify('1111')).toBe(true);
    });

    // Trocar o PIN que não coube não pode apagar o contador de tentativas do
    // PIN que continua valendo: 3 erros antes + 2 depois ainda são 5
    it('trocar o PIN sem espaço não zera o contador de tentativas do PIN antigo', async () => {
        expect(await parentalService.set('1111')).toBe(true);
        for (let i = 0; i < 3; i++) await parentalService.verify('0000');
        estourar();
        expect(await parentalService.set('2222')).toBe(false);
        fake.store.delete('neostream_favorites');
        for (let i = 0; i < 2; i++) await parentalService.verify('0000');
        expect(parentalService.travaRestanteMs()).toBeGreaterThan(0);
    });

    it('setGates() devolve false quando a trava não coube, e a trava não muda', () => {
        encher('neostream_favorites', 40);
        expect(parentalService.setGates({ leaveKids: false })).toBe(false);
        expect(parentalService.getGates().leaveKids).toBe(true);
    });

    it('setGates() poda o cache e grava', () => {
        encher('tmdb_tv_1399', 40);
        expect(parentalService.setGates({ settings: false })).toBe(true);
        expect(parentalService.getGates().settings).toBe(false);
    });

    // O contador de tentativas também gravava cru: com a quota cheia ele
    // nunca persistia e o limite de 5 erros sumia — tentativas infinitas.
    it('o limite de tentativas sobrevive à quota cheia (poda o cache pra contar)', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date(2026, 8, 25, 12, 0, 0));
            expect(await parentalService.set('4271')).toBe(true);
            encher('tmdb_movie_603', 20);
            for (let i = 0; i < 5; i++) await parentalService.verify('0000');
            expect(parentalService.travaRestanteMs()).toBe(30_000);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('perfis com a quota cheia', () => {
    it('createProfile devolve null quando não coube, e o perfil não aparece', async () => {
        profileService.initialize();
        encher('neostream_favorites', 40);
        const criado = await profileService.createProfile({ name: 'Vovó Maria', avatar: 'A' });
        expect(criado).toBeNull();
        expect(profileService.getAllProfiles().map(p => p.name)).not.toContain('Vovó Maria');
    });

    it('createProfile poda o cache e grava', async () => {
        profileService.initialize();
        encher('neostream_catalog_cache_movie_abc', 40);
        const criado = await profileService.createProfile({ name: 'Vovó Maria', avatar: 'A' });
        expect(criado).not.toBeNull();
        expect(profileService.getAllProfiles().map(p => p.name)).toContain('Vovó Maria');
    });

    it('updateProfile devolve false quando não coube, e o nome não muda', async () => {
        profileService.initialize();
        encher('neostream_favorites', 10);
        expect(await profileService.updateProfile('default', { name: 'Nome bem mais longo' })).toBe(false);
        expect(profileService.getAllProfiles().find(p => p.id === 'default')?.name).toBe('Principal');
    });

    it('deleteProfile que não gravou NÃO apaga os dados do perfil', async () => {
        profileService.initialize();
        const extra = await profileService.createProfile({ name: 'Visita', avatar: 'B' });
        expect(extra).not.toBeNull();
        const id = (extra as { id: string }).id;
        fake.store.set(`neostream_watch_later__p_${id}`, '[{"id":"1"}]');
        estourar();

        expect(profileService.deleteProfile(id)).toBe(false);
        // O perfil continua na lista gravada — então o dado dele também tem
        // de continuar, senão ele volta vazio no próximo boot
        expect(profileService.getAllProfiles().some(p => p.id === id)).toBe(true);
        expect(fake.store.has(`neostream_watch_later__p_${id}`)).toBe(true);
    });

    it('setActiveProfile devolve false quando a troca não foi gravada', () => {
        profileService.initialize();
        estourar();
        expect(profileService.setActiveProfile('kids-default')).toBe(false);
        expect(profileService.getActiveProfile()?.id).toBe('default');
    });
});

describe('playlists com a quota cheia', () => {
    function duasPlaylists(): { ativa: string; outra: string } {
        storage.saveCredentials({ url: 'http://a.example', username: 'u', password: 'p' });
        playlistService.migrate();
        playlistService.registerFromLogin({ url: 'http://b.example', username: 'u2', password: 'p2' });
        const [a, b] = playlistService.list();
        expect(b, 'o cenário precisa de duas playlists').toBeTruthy();
        return { ativa: b.id, outra: a.id };
    }

    // O Login não tem o que dizer aqui (a credencial ativa já foi gravada no
    // espelho): o ganho é a poda — antes o catch mudo descartava a entrada
    // mesmo com cache de sobra pra apagar
    it('registerFromLogin poda o cache e registra a playlist do login', () => {
        storage.saveCredentials({ url: 'http://a.example', username: 'u', password: 'p' });
        playlistService.migrate();
        encher('tmdb_movie_27205', 40);
        playlistService.registerFromLogin({ url: 'http://b.example', username: 'u2', password: 'p2' });
        expect(playlistService.list()).toHaveLength(2);
        expect(fake.store.has('tmdb_movie_27205')).toBe(false);
    });

    it('registerFromLogin sem espaço nenhum não derruba o login', () => {
        storage.saveCredentials({ url: 'http://a.example', username: 'u', password: 'p' });
        playlistService.migrate();
        encher('neostream_favorites', 40);
        expect(() => playlistService.registerFromLogin({ url: 'http://b.example', username: 'u2', password: 'p2' })).not.toThrow();
        expect(playlistService.list()).toHaveLength(1);
    });

    it('setActive que não gravou devolve false e NÃO troca a credencial em uso', () => {
        const { outra } = duasPlaylists();
        const antes = storage.getCredentials();
        estourar();
        expect(playlistService.setActive(outra)).toBe(false);
        expect(storage.getCredentials()).toEqual(antes);
    });

    it('remove que não gravou devolve false e NÃO apaga o catálogo da playlist', () => {
        const { outra } = duasPlaylists();
        fake.store.set(`neostream_epg_offset_${outra}`, '2');
        estourar();
        expect(playlistService.remove(outra)).toBe(false);
        expect(playlistService.list().some(p => p.id === outra)).toBe(true);
        expect(fake.store.has(`neostream_epg_offset_${outra}`)).toBe(true);
    });

    // Controle: a lista trocada tem o mesmo tamanho, então cabe sem podar
    it('com a quota no limite mas cabendo, setActive troca e grava (controle)', () => {
        const { outra } = duasPlaylists();
        encher('tmdb_movie_13', 10);
        expect(playlistService.setActive(outra)).toBe(true);
        expect(playlistService.getActiveId()).toBe(outra);
    });
});
