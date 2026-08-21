// A camada de armazenamento — a única do app que pode APAGAR dado do usuário.
//
// Roda em ambiente node com um localStorage falso que TEM quota (o do jsdom
// nunca lança QuotaExceededError, que é justamente o caso interessante).

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { installFakeStorage, setPerfilAtivo } from '../testing/fakeStorage';
import { readJson, writeRaw, writeJson, pruneCaches, pruneToNewest } from './safeStorage';
import {
    scopedKey, scopedKeyFor, purgeProfileData, migrateScopeOnce, migrateHiddenScope,
} from './profileScope';
import { keysOfGroup, resetGroup } from './dataReset';
import {
    TODAS_AS_BASES, KEYS_SESSAO, PREFIXOS_CACHE, PREFIXOS_PREFERENCIAS, SUFIXO_PERFIL,
} from './storageKeys';

beforeEach(() => {
    installFakeStorage();
});

describe('safeStorage', () => {
    it('lê JSON corrompido sem explodir (queda de energia no meio da escrita)', () => {
        localStorage.setItem('x', '{"a":');
        expect(readJson('x', { a: 1 })).toEqual({ a: 1 });
    });

    it('grava normalmente quando cabe', () => {
        expect(writeJson('neostream_favorites', [1, 2])).toEqual({ ok: true });
        expect(readJson('neostream_favorites', [])).toEqual([1, 2]);
    });

    // O comportamento que justifica o módulo existir: quando a quota estoura,
    // o cache morre e o dado do usuário sobrevive.
    it('poda os caches e tenta de novo quando a quota estoura', () => {
        installFakeStorage(800);
        localStorage.setItem('tmdb_550', 'x'.repeat(200));
        localStorage.setItem('neostream_catalog_cache_movie_1', 'y'.repeat(50));
        localStorage.setItem('neostream_favorites', '[1]');

        const r = writeRaw('neostream_movie_progress', 'z'.repeat(120));

        expect(r).toEqual({ ok: true, pruned: true });
        expect(localStorage.getItem('neostream_movie_progress')).toBe('z'.repeat(120));
        expect(localStorage.getItem('tmdb_550')).toBeNull();
        expect(localStorage.getItem('neostream_catalog_cache_movie_1')).toBeNull();
        // dado do usuário INTACTO
        expect(localStorage.getItem('neostream_favorites')).toBe('[1]');
    });

    it('desiste sem apagar nada quando não há cache pra podar', () => {
        installFakeStorage(120);
        localStorage.setItem('neostream_favorites', '[1,2,3]');
        expect(writeRaw('neostream_movie_progress', 'z'.repeat(500))).toEqual({ ok: false });
        expect(localStorage.getItem('neostream_favorites')).toBe('[1,2,3]');
    });

    it('pruneCaches nunca leva dado do usuário junto', () => {
        localStorage.setItem('tmdb_1', 'a');
        localStorage.setItem('neostream_favorites', 'b');
        localStorage.setItem('neostream_movie_progress__p_kids', 'c');
        expect(pruneCaches()).toBe(1);
        expect(localStorage.getItem('neostream_favorites')).toBe('b');
        expect(localStorage.getItem('neostream_movie_progress__p_kids')).toBe('c');
    });

    it('valor circular vira ok:false em vez de exceção', () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(writeJson('k', circular).ok).toBe(false);
    });

    it('pruneToNewest mantém os N mais recentes', () => {
        const mapa = {
            velho: { updatedAt: 1 }, medio: { updatedAt: 5 }, novo: { updatedAt: 9 },
        };
        expect(Object.keys(pruneToNewest(mapa, 2)).sort()).toEqual(['medio', 'novo']);
        expect(pruneToNewest(mapa, 9)).toBe(mapa); // sem cópia à toa
    });
});

describe('profileScope', () => {
    it('default e "nenhum perfil" usam as chaves ORIGINAIS', () => {
        expect(scopedKey('neostream_favorites')).toBe('neostream_favorites');
        setPerfilAtivo('default');
        expect(scopedKey('neostream_favorites')).toBe('neostream_favorites');
    });

    it('perfil próprio ganha sufixo', () => {
        setPerfilAtivo('kids');
        expect(scopedKey('neostream_favorites')).toBe(`neostream_favorites${SUFIXO_PERFIL}kids`);
    });

    it('um perfil não enxerga o dado do outro', () => {
        setPerfilAtivo('pai');
        localStorage.setItem(scopedKey('neostream_favorites'), '["adulto"]');
        setPerfilAtivo('kids');
        expect(localStorage.getItem(scopedKey('neostream_favorites'))).toBeNull();
    });

    it('excluir perfil apaga o dado dele — inclusive o do default', () => {
        localStorage.setItem('neostream_favorites', '["do default"]');
        localStorage.setItem('neostream_favorites__p_kids', '["do kids"]');
        purgeProfileData('kids');
        expect(localStorage.getItem('neostream_favorites__p_kids')).toBeNull();
        expect(localStorage.getItem('neostream_favorites')).toBe('["do default"]');

        purgeProfileData('default');
        expect(localStorage.getItem('neostream_favorites')).toBeNull();
    });

    // BUG REAL (R6): quem já tinha ATIVADO um perfil próprio abriria a versão
    // nova com favoritos e "Continuar assistindo" vazios.
    it('migração leva o dado antigo pro escopo do perfil ativo', () => {
        setPerfilAtivo('kids');
        localStorage.setItem('neostream_favorites', '["antigo"]');
        localStorage.setItem('neostream_movie_progress', '{"1":{}}');

        migrateScopeOnce();

        expect(localStorage.getItem('neostream_favorites__p_kids')).toBe('["antigo"]');
        expect(localStorage.getItem('neostream_favorites')).toBeNull();
        expect(localStorage.getItem('neostream_movie_progress__p_kids')).toBe('{"1":{}}');
    });

    it('migração é no-op para default e não roda duas vezes', () => {
        setPerfilAtivo('default');
        localStorage.setItem('neostream_favorites', '["fica"]');
        migrateScopeOnce();
        expect(localStorage.getItem('neostream_favorites')).toBe('["fica"]');

        // segunda execução (já com perfil próprio) não pode sobrescrever nada
        setPerfilAtivo('kids');
        localStorage.setItem('neostream_favorites__p_kids', '["legitimo"]');
        localStorage.setItem('neostream_favorites', '["velho"]');
        migrateScopeOnce();
        expect(localStorage.getItem('neostream_favorites__p_kids')).toBe('["legitimo"]');
    });

    it('nunca sobrescreve dado que o perfil já tem', () => {
        setPerfilAtivo('kids');
        localStorage.setItem('neostream_favorites__p_kids', '["meu"]');
        localStorage.setItem('neostream_favorites', '["do outro"]');
        migrateScopeOnce();
        expect(localStorage.getItem('neostream_favorites__p_kids')).toBe('["meu"]');
    });

    // BUG REAL (R7): a ocultação de canais virou dado de perfil DEPOIS que a
    // primeira migração já tinha gravado a flag em todo mundo.
    it('a segunda leva alcança quem já rodou a primeira', () => {
        setPerfilAtivo('kids');
        localStorage.setItem('neostream_scope_migrated', '1'); // v1 já rodou
        localStorage.setItem('neostream_hidden_channels', '["c1"]');

        migrateScopeOnce();
        expect(localStorage.getItem('neostream_hidden_channels')).toBe('["c1"]'); // v1 não pega

        migrateHiddenScope();
        expect(localStorage.getItem('neostream_hidden_channels__p_kids')).toBe('["c1"]');
        expect(localStorage.getItem('neostream_hidden_channels')).toBeNull();
    });

    it('scopedKeyFor não depende do perfil ativo', () => {
        setPerfilAtivo('kids');
        expect(scopedKeyFor('neostream_favorites', 'pai')).toBe('neostream_favorites__p_pai');
        expect(scopedKeyFor('neostream_favorites', 'default')).toBe('neostream_favorites');
    });
});

describe('dataReset', () => {
    it('alcança as chaves de TODOS os perfis, não só as do ativo', () => {
        localStorage.setItem('neostream_favorites', 'a');
        localStorage.setItem('neostream_favorites__p_kids', 'b');
        localStorage.setItem('neostream_watch_later__p_pai', 'c');
        expect(keysOfGroup('listas').sort()).toEqual([
            'neostream_favorites', 'neostream_favorites__p_kids', 'neostream_watch_later__p_pai',
        ]);
    });

    it('apaga só o grupo pedido', () => {
        localStorage.setItem('neostream_favorites', 'a');
        localStorage.setItem('neostream_credentials', 'segredo');
        localStorage.setItem('tmdb_550', 'capa');

        expect(resetGroup('listas').removed).toBe(1);
        expect(localStorage.getItem('neostream_favorites')).toBeNull();
        expect(localStorage.getItem('neostream_credentials')).toBe('segredo');
        expect(localStorage.getItem('tmdb_550')).toBe('capa');
    });

    it('os prefixos dinâmicos entram no grupo certo', () => {
        localStorage.setItem('neostream_sort_movies', 'az');
        localStorage.setItem('neostream_epg_offset_pl1', '2');
        localStorage.setItem('neostream_catalog_cache_movie_pl1', '[]');
        expect(keysOfGroup('preferencias')).toContain('neostream_sort_movies');
        expect(keysOfGroup('preferencias')).toContain('neostream_epg_offset_pl1');
        expect(keysOfGroup('caches')).toContain('neostream_catalog_cache_movie_pl1');
    });
});

// =====================================================================
// Teste de CONTRATO: nenhuma chave pode existir fora do inventário.
//
// É o teste que a auditoria pediu. Sem ele, toda chave nova esquecida em
// storageKeys.ts vira dado órfão: nenhum reset a alcança, nenhum backup a
// leva, e ela fica ocupando uma quota de ~5 MB para sempre.
// =====================================================================
describe('contrato storageKeys x código', () => {
    const SRC = join(process.cwd(), 'src');

    function arquivos(dir: string): string[] {
        return readdirSync(dir).flatMap(nome => {
            const caminho = join(dir, nome);
            if (statSync(caminho).isDirectory()) return arquivos(caminho);
            return /\.(ts|tsx)$/.test(nome) && !nome.endsWith('.test.ts') ? [caminho] : [];
        });
    }

    const conhecida = (chave: string) =>
        TODAS_AS_BASES.includes(chave)
        || (KEYS_SESSAO as readonly string[]).includes(chave)
        || [...PREFIXOS_CACHE, ...PREFIXOS_PREFERENCIAS].some(p => chave.startsWith(p));

    it('toda chave neostream_* do código está no inventário', () => {
        const desconhecidas = new Map<string, string>();
        for (const caminho of arquivos(SRC)) {
            const texto = readFileSync(caminho, 'utf-8');
            for (const achado of texto.matchAll(/['"`](neostream_[a-z0-9_]+)['"`]/g)) {
                const chave = achado[1];
                // Interpolações (`neostream_sort_${aba}`) já entram por prefixo
                if (!conhecida(chave) && !desconhecidas.has(chave)) {
                    desconhecidas.set(chave, caminho.slice(SRC.length + 1));
                }
            }
        }
        expect(Array.from(desconhecidas, ([k, f]) => `${k} (${f})`)).toEqual([]);
    });

    it('chave de sessão nunca aparece como chave persistente', () => {
        for (const chave of KEYS_SESSAO) expect(TODAS_AS_BASES).not.toContain(chave);
    });

    it('não há chave duplicada entre grupos', () => {
        const vistas = new Set<string>();
        const duplicadas = TODAS_AS_BASES.filter(k => vistas.has(k) || (vistas.add(k), false));
        expect(duplicadas).toEqual([]);
    });
});
