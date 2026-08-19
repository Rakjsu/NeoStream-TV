// Temas (port lite do desktop): fundo Padrão/AMOLED + 6 cores de destaque.
// A cor vive nas CSS vars --ns-accent / --ns-accent-rgb (todo o CSS do app
// referencia as vars); o fundo vira data-bg no <html> com overrides em
// theme.css. Aplicar no boot (App) e a cada mudança (Settings).

export type AccentId = 'roxo' | 'azul' | 'verde' | 'rosa' | 'laranja' | 'ciano';
export type BackgroundId = 'default' | 'amoled';

interface AccentDef {
    label: string;
    hex: string;
    rgb: string; // "r, g, b" pra compor rgba(var(--ns-accent-rgb), a)
}

export const ACCENTS: Record<AccentId, AccentDef> = {
    roxo: { label: 'Roxo', hex: '#a855f7', rgb: '168, 85, 247' },
    azul: { label: 'Azul', hex: '#3b82f6', rgb: '59, 130, 246' },
    verde: { label: 'Verde', hex: '#22c55e', rgb: '34, 197, 94' },
    rosa: { label: 'Rosa', hex: '#ec4899', rgb: '236, 72, 153' },
    laranja: { label: 'Laranja', hex: '#f97316', rgb: '249, 115, 22' },
    ciano: { label: 'Ciano', hex: '#06b6d4', rgb: '6, 182, 212' },
};

export const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[];

export const BACKGROUNDS: Record<BackgroundId, string> = {
    default: 'Padrão',
    amoled: 'AMOLED (preto puro)',
};

export const BACKGROUND_IDS = Object.keys(BACKGROUNDS) as BackgroundId[];

const ACCENT_KEY = 'neostream_theme_accent';
const BG_KEY = 'neostream_theme_bg';

function safeWrite(key: string, value: string | null): void {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        // Quota cheia — falha silenciosa
    }
}

export const themeService = {
    getAccent(): AccentId {
        const raw = localStorage.getItem(ACCENT_KEY);
        return raw && raw in ACCENTS ? (raw as AccentId) : 'roxo';
    },

    getBackground(): BackgroundId {
        const raw = localStorage.getItem(BG_KEY);
        return raw === 'amoled' ? 'amoled' : 'default';
    },

    setAccent(accent: AccentId): void {
        safeWrite(ACCENT_KEY, accent === 'roxo' ? null : accent);
        this.apply();
    },

    setBackground(background: BackgroundId): void {
        safeWrite(BG_KEY, background === 'default' ? null : background);
        this.apply();
    },

    /** Aplica o tema atual nas CSS vars + data-bg do <html>. */
    apply(): void {
        const root = document.documentElement;
        const accent = ACCENTS[this.getAccent()];
        root.style.setProperty('--ns-accent', accent.hex);
        root.style.setProperty('--ns-accent-rgb', accent.rgb);
        root.dataset.bg = this.getBackground();
    },
};
