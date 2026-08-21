// Preferências do player que sobrevivem ao fechar (backlog itens 41, 46, 47, 48).
// Tudo em localStorage, sempre com try/catch: numa TV com armazenamento cheio
// uma exceção aqui derrubaria a reprodução inteira.

const QUALITY_BY_KEY = 'neostream_quality_by_content';
const QUALITY_CAP = 'neostream_quality_cap';
const SUBTITLE_SIZE = 'neostream_subtitle_size';
const SHOW_STATS = 'neostream_player_stats';
const MAX_QUALITY_ENTRIES = 120;

function readJson<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}

function writeJson(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // quota / modo privado — preferência é perdida, a reprodução segue
    }
}

// ---- Qualidade manual por conteúdo (item 46) ----
// Guardamos a ALTURA (720, 1080…), não o índice: a ordem dos níveis muda
// entre variantes do mesmo canal e o índice apontaria pra outra faixa.

export const qualityByContent = {
    get(contentKey: string | undefined): number | null {
        if (!contentKey) return null;
        const map = readJson<Record<string, number>>(QUALITY_BY_KEY, {});
        const height = map[contentKey];
        return typeof height === 'number' && height > 0 ? height : null;
    },

    set(contentKey: string | undefined, height: number | null): void {
        if (!contentKey) return;
        const map = readJson<Record<string, number>>(QUALITY_BY_KEY, {});
        if (height == null) {
            delete map[contentKey];
        } else {
            map[contentKey] = height;
        }
        // Poda simples: o mapa cresce a cada canal visitado
        const keys = Object.keys(map);
        if (keys.length > MAX_QUALITY_ENTRIES) {
            for (const key of keys.slice(0, keys.length - MAX_QUALITY_ENTRIES)) {
                delete map[key];
            }
        }
        writeJson(QUALITY_BY_KEY, map);
    },
};

// ---- Teto global de qualidade (item 47) ----
// 0 = sem limite. Serve pra rede fraca: o ABR nunca sobe além disso.

export const QUALITY_CAPS = [0, 1080, 720, 480] as const;
export type QualityCap = (typeof QUALITY_CAPS)[number];

export const qualityCap = {
    get(): QualityCap {
        const raw = Number(localStorage.getItem(QUALITY_CAP));
        return (QUALITY_CAPS as readonly number[]).includes(raw) ? (raw as QualityCap) : 0;
    },
    set(cap: QualityCap): void {
        try {
            localStorage.setItem(QUALITY_CAP, String(cap));
        } catch {
            // sem drama
        }
    },
    label(cap: QualityCap): string {
        return cap === 0 ? 'Sem limite' : `Máx ${cap}p`;
    },
};

// ---- Tamanho da legenda (item 41) ----
// A TV é vista a ~3 m: o padrão do navegador é pequeno demais nessa distância.

export const SUBTITLE_SIZES = ['normal', 'grande', 'enorme'] as const;
export type SubtitleSize = (typeof SUBTITLE_SIZES)[number];

export const SUBTITLE_SIZE_LABELS: Record<SubtitleSize, string> = {
    normal: 'Normal',
    grande: 'Grande',
    enorme: 'Enorme',
};

export const subtitleSize = {
    get(): SubtitleSize {
        const raw = localStorage.getItem(SUBTITLE_SIZE);
        return (SUBTITLE_SIZES as readonly string[]).includes(raw || '')
            ? (raw as SubtitleSize)
            : 'grande'; // padrão pensado pra 3 m, não pro desktop
    },
    set(size: SubtitleSize): void {
        try {
            localStorage.setItem(SUBTITLE_SIZE, size);
        } catch {
            // sem drama
        }
    },
};

// ---- Estatísticas do stream (item 48) ----

export const statsOverlay = {
    get(): boolean {
        return localStorage.getItem(SHOW_STATS) === '1';
    },
    set(on: boolean): void {
        try {
            localStorage.setItem(SHOW_STATS, on ? '1' : '0');
        } catch {
            // sem drama
        }
    },
};
