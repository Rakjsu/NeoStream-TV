// Preferências de reprodução (item 66).
//
// Três comportamentos que hoje eram fixos no código e que dividem opinião:
// emendar o próximo episódio, retomar de onde parou, e quanto buffer segurar.

const KEY = 'neostream_playback_prefs';

export type BufferProfile = 'economico' | 'equilibrado' | 'generoso';

export const BUFFER_PROFILES: BufferProfile[] = ['economico', 'equilibrado', 'generoso'];

export const BUFFER_LABELS: Record<BufferProfile, string> = {
    economico: 'Econômico (TV com pouca RAM)',
    equilibrado: 'Equilibrado',
    generoso: 'Generoso (rede instável)',
};

export interface PlaybackPrefs {
    /** Emendar o próximo episódio quando o atual acaba */
    autoNextEpisode: boolean;
    /** Retomar de onde parou ao reabrir um título */
    resume: boolean;
    bufferProfile: BufferProfile;
}

const DEFAULTS: PlaybackPrefs = {
    autoNextEpisode: true,
    resume: true,
    bufferProfile: 'equilibrado',
};

/** Segundos de buffer por perfil — ao vivo e VOD têm necessidades diferentes. */
export const BUFFER_SETTINGS: Record<BufferProfile, { live: number; vod: number; maxLive: number; maxVod: number }> = {
    // Os valores "equilibrado" são exatamente os que o app usava antes de
    // existir esta preferência — quem não mexer não sente diferença nenhuma.
    economico: { live: 15, vod: 30, maxLive: 30, maxVod: 300 },
    equilibrado: { live: 30, vod: 60, maxLive: 60, maxVod: 600 },
    generoso: { live: 60, vod: 120, maxLive: 120, maxVod: 900 },
};

export const playbackPrefs = {
    get(): PlaybackPrefs {
        try {
            const raw = localStorage.getItem(KEY);
            return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
        } catch {
            return DEFAULTS;
        }
    },

    set(patch: Partial<PlaybackPrefs>): void {
        try {
            localStorage.setItem(KEY, JSON.stringify({ ...this.get(), ...patch }));
        } catch {
            // quota — segue com o valor em memória desta sessão
        }
    },

    buffers() {
        return BUFFER_SETTINGS[this.get().bufferProfile];
    },
};
