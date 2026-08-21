// Proteção contra burn-in (item 78).
//
// TV OLED com o mesmo menu parado na tela por horas marca o painel. O app é
// navegado por controle: é normal alguém abrir a lista de canais e sair da
// sala. Depois de um tempo sem tecla nenhuma, a interface escurece; qualquer
// tecla traz de volta.
//
// Só vale FORA da reprodução: escurecer o filme que a pessoa está assistendo
// seria o oposto do que ela quer. O VideoPlayer marca `data-playing` no
// <html> enquanto existe, e o CSS usa isso.

const KEY = 'neostream_burnin_dimmer';
const DIM_CLASS = 'app-dimmed';
const IDLE_MS = 5 * 60 * 1000;

let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

function clearDim(): void {
    document.documentElement.classList.remove(DIM_CLASS);
}

function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = null;
        document.documentElement.classList.add(DIM_CLASS);
    }, IDLE_MS);
}

function wake(): void {
    clearDim();
    schedule();
}

export const burnIn = {
    isEnabled(): boolean {
        // Ligado por padrão: quem tem OLED é quem mais sofre e não vai
        // adivinhar que existe uma opção
        return localStorage.getItem(KEY) !== '0';
    },

    setEnabled(on: boolean): void {
        try {
            if (on) localStorage.removeItem(KEY);
            else localStorage.setItem(KEY, '0');
        } catch {
            // quota — vale só nesta sessão
        }
        if (on) this.install();
        else this.uninstall();
    },

    install(): void {
        if (installed || !this.isEnabled()) return;
        installed = true;
        window.addEventListener('keydown', wake);
        window.addEventListener('mousemove', wake);
        schedule();
    },

    uninstall(): void {
        if (!installed) return;
        installed = false;
        window.removeEventListener('keydown', wake);
        window.removeEventListener('mousemove', wake);
        if (timer) clearTimeout(timer);
        timer = null;
        clearDim();
    },
};
