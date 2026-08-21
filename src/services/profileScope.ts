// Escopo de DADOS por perfil (item 54).
//
// Regra central: o perfil 'default' — e o estado "nenhum perfil escolhido" —
// continuam usando as CHAVES ORIGINAIS. Isso faz a migração ser um no-op para
// quem já tinha dados: nada é copiado, nada pode se perder no meio do caminho,
// e desinstalar o recurso não órfã nenhum dado. Perfis novos nascem vazios,
// que é exatamente o que se espera de um perfil novo.

const PROFILES_KEY = 'neostream_tv_profiles';
const SUFFIX = '__p_';

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
export const SCOPED_BASES = [
    'neostream_favorites',
    'neostream_watch_later',
    'neostream_movie_progress',
    'neostream_series_progress',
    'neostream_usage_stats',
    'neostream_zap_history',
    'neostream_fav_channel_order',
    'neostream_last_channel',
    'neostream_reminders',
] as const;

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

/**
 * Migração única do item 54.
 *
 * Antes do escopo por perfil, TODO dado ia para as chaves base — inclusive
 * quando o usuário já tinha criado e ativado um perfil próprio. Sem esta
 * função, atualizar o app com um perfil não-'default' ativo abriria a TV com
 * favoritos, "Continuar assistindo", lembretes e estatísticas aparentemente
 * vazios: o dado continuaria no disco, inalcançável.
 */
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

    for (const base of SCOPED_BASES) {
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
