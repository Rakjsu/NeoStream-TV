// Escopo de DADOS por perfil (item 54).
//
// Regra central: o perfil 'default' — e o estado "nenhum perfil escolhido" —
// continuam usando as CHAVES ORIGINAIS. Isso faz a migração ser um no-op para
// quem já tinha dados: nada é copiado, nada pode se perder no meio do caminho,
// e desinstalar o recurso não órfã nenhum dado. Perfis novos nascem vazios,
// que é exatamente o que se espera de um perfil novo.

import { KEYS_PROGRESSO, KEYS_LISTAS, SUFIXO_PERFIL } from './storageKeys';

const PROFILES_KEY = 'neostream_tv_profiles';
const SUFFIX = SUFIXO_PERFIL;

// getItem é barato; JSON.parse não é. Só reparseia quando a string muda —
// scopedKey() é chamado em todo isFavorite()/getMovie() do app.
let cachedRaw: string | null = null;
let cachedId: string | null = null;

/** Id do perfil ativo, ou null se ainda não há perfis. */
export function activeProfileId(): string | null {
    try {
        const raw = localStorage.getItem(PROFILES_KEY);
        if (raw !== cachedRaw) {
            cachedRaw = raw;
            const parsed: unknown = raw ? JSON.parse(raw) : null;
            const id = (parsed as { activeProfileId?: unknown } | null)?.activeProfileId;
            cachedId = typeof id === 'string' ? id : null;
        }
        return cachedId;
    } catch {
        return null;
    }
}

/** Chave de dado no escopo do perfil ativo. */
export function scopedKey(base: string): string {
    const id = activeProfileId();
    if (!id || id === 'default') return base;
    return `${base}${SUFFIX}${id}`;
}

/** Chave de dado no escopo de UM perfil específico (limpeza, backup). */
export function scopedKeyFor(base: string, profileId: string): string {
    return profileId === 'default' ? base : `${base}${SUFFIX}${profileId}`;
}

/**
 * Bases que são DADO do usuário e portanto vivem por perfil. Preferências de
 * aparelho (tema, acessibilidade, teto de qualidade) ficam de fora de
 * propósito: são do aparelho e da sala, não de quem está assistindo.
 */
export const SCOPED_BASES: readonly string[] = [...KEYS_PROGRESSO, ...KEYS_LISTAS];

/**
 * Apaga todo o dado de um perfil (usado ao excluir o perfil).
 * Vale também para 'default', cujo dado mora nas chaves BASE: pular esse caso
 * deixava favoritos e progresso do perfil excluído vivos no armazenamento,
 * prontos pra reaparecer no próximo perfil que virasse 'default'.
 */
export function purgeProfileData(profileId: string): void {
    for (const base of SCOPED_BASES) {
        try {
            localStorage.removeItem(scopedKeyFor(base, profileId));
        } catch {
            // segue tentando as outras
        }
    }
}

const MIGRATED_KEY = 'neostream_scope_migrated';
// Bases que entraram no escopo DEPOIS da primeira migração. Quem já rodou a v1
// tem a flag gravada e nunca mais passaria pelo laço — a ocultação de canais
// ficaria pra trás na chave base e o usuário abriria o app com os 40 canais
// que ele escondeu de volta na grade.
const MIGRATED_V2_KEY = 'neostream_scope_migrated_v2';
const BASES_V2 = ['neostream_hidden_channels', 'neostream_hidden_categories'];

/**
 * Migração única do item 54.
 *
 * Antes do escopo por perfil, TODO dado ia para as chaves base — inclusive
 * quando o usuário já tinha criado e ativado um perfil próprio. Sem esta
 * função, atualizar o app com um perfil não-'default' ativo abriria a TV com
 * favoritos, "Continuar assistindo", lembretes e estatísticas aparentemente
 * vazios: o dado continuaria no disco, inalcançável.
 */
/** Move um conjunto de bases pro escopo do perfil ativo (uma vez só). */
function moverParaOEscopo(bases: readonly string[], id: string): void {
    for (const base of bases) {
        try {
            const target = scopedKeyFor(base, id);
            if (localStorage.getItem(target) !== null) continue; // já tem dado próprio
            const value = localStorage.getItem(base);
            if (value === null) continue;
            localStorage.setItem(target, value);
            // Só larga a origem depois de conferir que o destino gravou: numa
            // TV com quota estourada, remover antes destruiria o dado de vez
            if (localStorage.getItem(target) === value) localStorage.removeItem(base);
        } catch {
            // a base que falhar continua onde está — visível de novo no perfil principal
        }
    }
}

/**
 * Segunda leva da migração de escopo: a ocultação de canais só virou dado de
 * perfil depois que a primeira migração já tinha rodado em todo mundo.
 */
export function migrateHiddenScope(): void {
    try {
        if (localStorage.getItem(MIGRATED_V2_KEY)) return;
        localStorage.setItem(MIGRATED_V2_KEY, '1');
    } catch {
        return;
    }
    const id = activeProfileId();
    if (!id || id === 'default') return;
    moverParaOEscopo(BASES_V2, id);
}

export function migrateScopeOnce(): void {
    try {
        if (localStorage.getItem(MIGRATED_KEY)) return;
        // A marca é gravada ANTES de mover: se algo falhar no meio, uma
        // segunda execução sobrescreveria dado já legítimo do perfil.
        localStorage.setItem(MIGRATED_KEY, '1');
    } catch {
        return; // sem marca confiável, não mexe em nada
    }

    const id = activeProfileId();
    if (!id || id === 'default') return; // aqui a migração é de fato um no-op

    moverParaOEscopo(SCOPED_BASES, id);
}
