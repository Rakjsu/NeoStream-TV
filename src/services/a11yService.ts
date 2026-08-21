// Acessibilidade e conforto de leitura (itens 58, 64, 65).
//
// Tudo vira data-attribute no <html> e o CSS reage em theme.css — mesmo padrão
// já usado pelo data-bg do tema. Nenhum componente precisa saber que existe.

export type ContrastMode = 'normal' | 'alto';
export type TextScale = 100 | 115 | 130;

export const TEXT_SCALES: TextScale[] = [100, 115, 130];

const CONTRAST_KEY = 'neostream_a11y_contrast';
const SCALE_KEY = 'neostream_a11y_text_scale';
const MOTION_KEY = 'neostream_a11y_reduce_motion';

function safeWrite(key: string, value: string | null): void {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        // quota — a preferência se perde, o app segue
    }
}

export const a11yService = {
    getContrast(): ContrastMode {
        return localStorage.getItem(CONTRAST_KEY) === 'alto' ? 'alto' : 'normal';
    },

    setContrast(mode: ContrastMode): void {
        safeWrite(CONTRAST_KEY, mode === 'normal' ? null : mode);
        this.apply();
    },

    getTextScale(): TextScale {
        const raw = Number(localStorage.getItem(SCALE_KEY));
        return (TEXT_SCALES as number[]).includes(raw) ? (raw as TextScale) : 100;
    },

    setTextScale(scale: TextScale): void {
        safeWrite(SCALE_KEY, scale === 100 ? null : String(scale));
        this.apply();
    },

    getReduceMotion(): boolean {
        return localStorage.getItem(MOTION_KEY) === '1';
    },

    setReduceMotion(on: boolean): void {
        safeWrite(MOTION_KEY, on ? '1' : null);
        this.apply();
    },

    /** Aplica no <html>. Chamado no boot e a cada mudança. */
    apply(): void {
        const root = document.documentElement;
        const contrast = this.getContrast();
        const scale = this.getTextScale();
        const motion = this.getReduceMotion();
        // Atributo ausente = padrão: evita seletor extra pro caso comum
        if (contrast === 'normal') delete root.dataset.contrast;
        else root.dataset.contrast = contrast;
        if (scale === 100) delete root.dataset.textscale;
        else root.dataset.textscale = String(scale);
        if (motion) root.dataset.motion = 'reduzido';
        else delete root.dataset.motion;
    },
};
