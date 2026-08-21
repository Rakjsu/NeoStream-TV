// Reset seletivo e inventário de dados (itens 61, 62, 63).
//
// As chaves são casadas por PREDICADO sobre tudo que existe no localStorage,
// nunca por uma lista fixa: o app tem chaves com sufixo de perfil (`__p_<id>`)
// e com prefixo dinâmico (ordenação por aba, offset de EPG por playlist).
// Uma lista fixa deixaria lixo para trás na primeira chave nova.

export type DataGroup = 'progresso' | 'listas' | 'caches' | 'preferencias' | 'conta';

interface GroupDef {
    label: string;
    description: string;
    /** Bases (sem o sufixo de perfil) e prefixos que pertencem ao grupo */
    bases: string[];
    prefixes: string[];
}

export const DATA_GROUPS: Record<DataGroup, GroupDef> = {
    progresso: {
        label: 'Progresso e histórico',
        description: 'Continuar assistindo, itens marcados como vistos e a retrospectiva.',
        bases: ['neostream_movie_progress', 'neostream_series_progress', 'neostream_usage_stats', 'neostream_zap_history'],
        prefixes: [],
    },
    listas: {
        label: 'Favoritos e Minha Lista',
        description: 'Favoritos, Minha Lista, ordem dos canais favoritos e lembretes.',
        bases: [
            'neostream_favorites',
            'neostream_watch_later',
            'neostream_fav_channel_order',
            'neostream_reminders',
            'neostream_last_channel',
        ],
        prefixes: [],
    },
    caches: {
        label: 'Caches',
        description: 'Capas e fichas do TMDB e marcadores de novidade. Tudo volta sozinho.',
        bases: ['neostream_series_lastmod'],
        prefixes: ['tmdb_'],
    },
    preferencias: {
        label: 'Preferências',
        description: 'Tema, acessibilidade, filtros, ajustes do player e da TV ao vivo.',
        bases: [
            'neostream_theme_accent',
            'neostream_theme_bg',
            'neostream_a11y_contrast',
            'neostream_a11y_text_scale',
            'neostream_a11y_reduce_motion',
            'neostream_quality_by_content',
            'neostream_quality_cap',
            'neostream_subtitle_size',
            'neostream_player_stats',
            'neostream_playback_prefs',
            'neostream_hidden_channels',
            'neostream_hidden_categories',
            'neostream_aspect_prefs',
            'neostream_live_only_epg',
            'neostream_group_variants',
            'neostream_boot_last_channel',
            'neostream_hide_watched',
        ],
        prefixes: ['neostream_sort_', 'neostream_filters_', 'neostream_epg_offset_'],
    },
    conta: {
        label: 'Conta e perfis',
        description: 'Credenciais, playlists, perfis, PIN e o estado da configuração inicial.',
        bases: [
            'neostream_credentials',
            'neostream_playlists',
            // Flags DA PLAYLIST ativa (o playlistService as reescreve a cada
            // troca) — nunca preferência do aparelho, ou um restore antigo
            // desligaria as abas de TV/VOD sem caminho de volta
            'includeTV',
            'includeVOD',
            // Estado do aparelho, não preferência: o snapshot não pode se
            // conter (recursão) e o wizard não deve reabrir num restore
            'neostream_config_snapshots',
            'neostream_wizard_done',
            'neostream_scope_migrated',
            'neostream_tv_profiles',
            'neostream_parental_pin',
            'neostream_parental_gates',
            'neostream_account_info',
            'neostream_expiry_snooze',
            'neostream_settings',
            'neostream_tmdb_api_key',
        ],
        prefixes: [],
    },
};

export const DATA_GROUP_IDS = Object.keys(DATA_GROUPS) as DataGroup[];

function allKeys(): string[] {
    const keys: string[] = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) keys.push(key);
        }
    } catch {
        return [];
    }
    return keys;
}

/** A chave pertence ao grupo? Aceita o sufixo de perfil `__p_<id>`. */
function belongsTo(key: string, group: GroupDef): boolean {
    const base = key.split('__p_')[0];
    return group.bases.includes(base) || group.prefixes.some(prefix => base.startsWith(prefix));
}

export function keysOfGroup(group: DataGroup): string[] {
    const def = DATA_GROUPS[group];
    return allKeys().filter(key => belongsTo(key, def));
}

export interface ResetResult {
    removed: number;
    bytes: number;
}

export function resetGroup(group: DataGroup): ResetResult {
    const keys = keysOfGroup(group);
    let bytes = 0;
    for (const key of keys) {
        try {
            bytes += (localStorage.getItem(key)?.length || 0) * 2;
            localStorage.removeItem(key);
        } catch {
            // segue removendo as outras
        }
    }
    return { removed: keys.length, bytes };
}

/** Quanto cada grupo ocupa hoje (KB) — mostrado ao lado de cada opção. */
export function groupSizeKb(group: DataGroup): number {
    const total = keysOfGroup(group).reduce(
        (sum, key) => sum + (localStorage.getItem(key)?.length || 0) * 2,
        0
    );
    return Math.round(total / 1024);
}
