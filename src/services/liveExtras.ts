// Extras da TV ao vivo (port do NeoStream desktop, tudo localStorage):
// - zapHistory: MRU de canais zapeados (chips "Recentes")
// - hiddenChannels: canais ocultos pelo usuário
// - aspectPrefs: proporção/zoom lembrada por conteúdo
// - liveToggles: filtros persistidos da página (só-EPG, agrupar variantes)

const ZAP_KEY = 'neostream_zap_history';
const HIDDEN_KEY = 'neostream_hidden_channels';
const ASPECT_KEY = 'neostream_aspect_prefs';
const ONLY_EPG_KEY = 'neostream_live_only_epg';
const GROUP_VARIANTS_KEY = 'neostream_group_variants';

const ZAP_MAX = 10;

function readJson<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

// TVs têm quota apertada de localStorage; escrita nunca pode derrubar o app
// (zapHistory.push roda a cada troca de canal)
function writeJson(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Quota cheia — falha silenciosa, igual ao progressService
    }
}

function writeRaw(key: string, value: string | null): void {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        // Quota cheia — falha silenciosa
    }
}

export const zapHistory = {
    get(): number[] {
        return readJson<number[]>(ZAP_KEY, []);
    },
    push(streamId: number): void {
        const list = this.get().filter(id => id !== streamId);
        list.unshift(streamId);
        writeJson(ZAP_KEY, list.slice(0, ZAP_MAX));
    },
};

export const hiddenChannels = {
    get(): Set<number> {
        return new Set(readJson<number[]>(HIDDEN_KEY, []));
    },
    toggle(streamId: number): Set<number> {
        const set = this.get();
        if (set.has(streamId)) set.delete(streamId);
        else set.add(streamId);
        writeJson(HIDDEN_KEY, [...set]);
        return set;
    },
};

export type AspectMode = 'original' | 'stretch' | 'fill' | 'zoom';

export const ASPECT_MODES: AspectMode[] = ['original', 'stretch', 'fill', 'zoom'];

export const ASPECT_LABELS: Record<AspectMode, string> = {
    original: 'Original',
    stretch: 'Esticar',
    fill: 'Preencher',
    zoom: 'Zoom',
};

export const aspectPrefs = {
    get(contentKey: string): AspectMode {
        const map = readJson<Record<string, AspectMode>>(ASPECT_KEY, {});
        return map[contentKey] || 'original';
    },
    set(contentKey: string, mode: AspectMode): void {
        const map = readJson<Record<string, AspectMode>>(ASPECT_KEY, {});
        if (mode === 'original') delete map[contentKey];
        else map[contentKey] = mode;
        writeJson(ASPECT_KEY, map);
    },
};

export const liveToggles = {
    getOnlyWithEpg(): boolean {
        return localStorage.getItem(ONLY_EPG_KEY) === 'on';
    },
    setOnlyWithEpg(value: boolean): void {
        writeRaw(ONLY_EPG_KEY, value ? 'on' : null);
    },
    /** Agrupar variantes é ligado por padrão (igual ao desktop). */
    getGroupVariants(): boolean {
        return localStorage.getItem(GROUP_VARIANTS_KEY) !== 'off';
    },
    setGroupVariants(value: boolean): void {
        writeRaw(GROUP_VARIANTS_KEY, value ? null : 'off');
    },
};
