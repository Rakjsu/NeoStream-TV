// Inventário único das chaves de armazenamento (item 84).
//
// Antes desta lista, as chaves viviam espalhadas por 15 serviços e eram
// RE-LISTADAS à mão em dataReset, profileScope, configSnapshot e backupService.
// Toda chave nova precisava ser lembrada em quatro lugares — e a que fosse
// esquecida virava dado órfão que nenhum reset alcançava (aconteceu com
// `neostream_config_snapshots` e `neostream_wizard_done` na R6).

/** Chaves de CREDENCIAL e identidade do aparelho. Nunca entram em backup. */
export const KEYS_CONTA = [
    'neostream_credentials',
    'neostream_playlists',
    'neostream_tv_profiles',
    'neostream_parental_pin',
    'neostream_parental_gates',
    'neostream_account_info',
    'neostream_expiry_snooze',
    'neostream_settings',
    'neostream_tmdb_api_key',
    // Flags DA PLAYLIST ativa: o playlistService as reescreve a cada troca
    'includeTV',
    'includeVOD',
    // Estado do aparelho, não preferência
    'neostream_config_snapshots',
    'neostream_wizard_done',
    'neostream_scope_migrated',
    'neostream_schema_version',
] as const;

/** Dado de QUEM assiste — vive por perfil (ver profileScope). */
export const KEYS_PROGRESSO = [
    'neostream_movie_progress',
    'neostream_series_progress',
    'neostream_usage_stats',
    'neostream_zap_history',
] as const;

export const KEYS_LISTAS = [
    // Ocultação de canais é decisão de QUEM assiste (e é a base do controle
    // parental na prática), não ajuste do aparelho
    'neostream_hidden_channels',
    'neostream_hidden_categories',
    'neostream_favorites',
    'neostream_watch_later',
    'neostream_fav_channel_order',
    'neostream_reminders',
    'neostream_last_channel',
] as const;

/** Ajustes do aparelho: é isto que o snapshot e o backup por QR carregam. */
export const KEYS_PREFERENCIAS = [
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
    'neostream_aspect_prefs',
    'neostream_live_only_epg',
    'neostream_group_variants',
    'neostream_boot_last_channel',
    'neostream_hide_watched',
    'neostream_burnin_dimmer',
    // BASELINE de "novos episódios": não é cache, perdê-la faz o app achar
    // que tudo é novidade
    'neostream_series_lastmod',
] as const;

// Só entra aqui o que volta sozinho de graça. O catálogo e o TMDB vêm por
// prefixo (PREFIXOS_CACHE).
export const KEYS_CACHE: readonly string[] = [];

/** Famílias com sufixo dinâmico (aba, playlist). */
export const PREFIXOS_PREFERENCIAS = [
    'neostream_sort_',
    'neostream_filters_',
    'neostream_epg_offset_',
] as const;

export const PREFIXOS_CACHE = [
    'tmdb_',
    // O catálogo guardado leva o tipo e a playlist no nome da chave
    'neostream_catalog_cache',
] as const;

/** Sufixo que o escopo por perfil acrescenta às chaves de dado. */
export const SUFIXO_PERFIL = '__p_';

/** Toda chave conhecida — usada em conferências e no diagnóstico. */
export const TODAS_AS_BASES: readonly string[] = [
    ...KEYS_CONTA,
    ...KEYS_PROGRESSO,
    ...KEYS_LISTAS,
    ...KEYS_PREFERENCIAS,
    ...KEYS_CACHE,
];
