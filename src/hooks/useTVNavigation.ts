// TV Navigation Hook - Handles D-pad navigation for Smart TVs

import { useEffect, useCallback } from 'react';

// Key codes for TV remotes
const TV_KEYS = {
    // Arrow keys
    UP: ['ArrowUp', '38'],
    DOWN: ['ArrowDown', '40'],
    LEFT: ['ArrowLeft', '37'],
    RIGHT: ['ArrowRight', '39'],

    // Action keys - Samsung OK button uses 13, 29443, or space (32)
    ENTER: ['Enter', '13', '29443', ' ', '32', 'Select'],
    BACK: ['Backspace', 'XF86Back', '10009', '8', '461'], // Samsung, LG, etc.

    // Media keys
    PLAY: ['MediaPlayPause', '415'],
    PAUSE: ['MediaPause', '19'],
    STOP: ['MediaStop', '413'],

    // Color keys (Samsung/LG)
    RED: ['ColorF0Red', '403'],
    GREEN: ['ColorF1Green', '404'],
    YELLOW: ['ColorF2Yellow', '405'],
    BLUE: ['ColorF3Blue', '406'],
};

type Direction = 'up' | 'down' | 'left' | 'right';
type TVAction = 'enter' | 'back' | 'play' | 'pause' | 'stop' | 'red' | 'green' | 'yellow' | 'blue';
type TizenHardwareKeyEvent = Event & { keyName?: string };

interface UseTVNavigationOptions {
    onNavigate?: (direction: Direction) => void;
    onAction?: (action: TVAction) => void;
    onBack?: () => void;
    /**
     * @param fromInput true quando o OK veio de DENTRO de um campo de texto —
     * nesse caso o hook já fechou o teclado nativo, e reabrir a busca aqui
     * refocaria o input, deixando o IME do Tizen piscando num loop sem saída.
     */
    onEnter?: (fromInput?: boolean) => void;
    enabled?: boolean;
}

// Uma tecla de controle chega por DUAS fontes e nem sempre pelas duas: em TV
// real o `event.key` costuma vir 'Unidentified' (ou vazio) e quem identifica a
// tecla e o `keyCode`. O codigo antigo era `event.key || String(keyCode)`, ou
// seja, o keyCode so era consultado quando o key vinha VAZIO — com
// 'Unidentified' o fallback nunca rodava e a tecla se perdia.
//
// Aqui as duas fontes sao testadas, cada uma contra o tipo certo de codigo:
// nome contra nome ('ArrowUp'), numero contra numero ('38'). Cruzar os dois
// era o que fazia o digito '8' do teclado numerico virar Voltar (keyCode 8 do
// Backspace esta na lista do BACK).
const ehNumero = (codigo: string) => /^\d+$/.test(codigo);

const matchKey = (event: KeyboardEvent, codes: string[]): boolean => {
    const nome = event.key;
    if (nome && nome !== 'Unidentified' && codes.some(c => !ehNumero(c) && c === nome)) return true;
    const numero = String(event.keyCode);
    return event.keyCode > 0 && codes.some(c => ehNumero(c) && c === numero);
};

/** Quanto tempo o elemento focado fica "apertado" depois do OK. */
const PRESSIONADO_MS = 140;

/**
 * Pisca o elemento focado ao receber OK. Sem isto, a TV nao dava sinal nenhum
 * de que a tecla foi lida: numa acao que demora (abrir ficha, carregar canal)
 * o usuario aperta OK de novo achando que nao pegou — e a segunda leitura vai
 * parar na tela seguinte.
 *
 * Marca TODOS os `.tv-focused` porque so o componente sabe qual e a zona ativa;
 * na pratica cada pagina condiciona a classe a sua area de foco, entao e um so.
 */
function piscarFocado(): void {
    const focados = document.querySelectorAll<HTMLElement>('.tv-focused');
    focados.forEach((el) => {
        el.classList.remove('ns-pressed');
        // Reinicia a animacao quando o OK vem duas vezes seguidas: sem ler o
        // offsetWidth o navegador junta remove+add num frame so e nada pisca.
        void el.offsetWidth;
        el.classList.add('ns-pressed');
        window.setTimeout(() => el.classList.remove('ns-pressed'), PRESSIONADO_MS);
    });
}

export function useTVNavigation(options: UseTVNavigationOptions = {}) {
    const { onNavigate, onAction, onBack, onEnter, enabled = true } = options;

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        if (!enabled) return;

                // Ignore events if user is currently focused on an input/textarea
        // This allows the native TV keyboard (IME) to handle Backspace, Left, Right, etc.
        const target = event.target as HTMLElement;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
            // Dentro de input, espaço (32) é TEXTO — só Enter/OK de verdade
            // fecha o teclado (buscar "ESPN 2" precisa do espaço)
            if (matchKey(event, ['Enter', '13', '29443', 'Select'])) {
                event.preventDefault();
                event.stopPropagation();
                target.blur();
                onEnter?.(true);
                onAction?.('enter');
                return;
            }

            // If the user presses the 'Return' / 'Back' button on the TV remote while editing, 
            // we should blur the input to hide the virtual keyboard and restore TV navigation.
            // 10009 (Tizen Back), 461 (WebOS Back), XF86Back (Generic), Escape
            // Also handle keyCode 8 (Backspace) ONLY when input value is empty (to exit editing)
            if (matchKey(event, TV_KEYS.BACK) || event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                target.blur();
                onBack?.();
                onAction?.('back');
            }
            return;
        }

        // Navigation
        if (matchKey(event, TV_KEYS.UP)) {
            if (onNavigate) { event.preventDefault(); onNavigate('up'); }
        } else if (matchKey(event, TV_KEYS.DOWN)) {
            if (onNavigate) { event.preventDefault(); onNavigate('down'); }
        } else if (matchKey(event, TV_KEYS.LEFT)) {
            if (onNavigate) { event.preventDefault(); onNavigate('left'); }
        } else if (matchKey(event, TV_KEYS.RIGHT)) {
            if (onNavigate) { event.preventDefault(); onNavigate('right'); }
        }
        // Actions
        else if (matchKey(event, TV_KEYS.ENTER)) {
            if (onEnter || onAction) {
                event.preventDefault();
                piscarFocado();
                onEnter?.();
                onAction?.('enter');
            }
        } else if (matchKey(event, TV_KEYS.BACK)) {
            if (onBack || onAction) {
                event.preventDefault();
                onBack?.();
                onAction?.('back');
            }
        }
        // Media
        else if (matchKey(event, TV_KEYS.PLAY)) {
            if (onAction) { event.preventDefault(); onAction('play'); }
        } else if (matchKey(event, TV_KEYS.PAUSE)) {
            if (onAction) { event.preventDefault(); onAction('pause'); }
        } else if (matchKey(event, TV_KEYS.STOP)) {
            if (onAction) { event.preventDefault(); onAction('stop'); }
        }
        // Color keys (atalhos por página)
        else if (matchKey(event, TV_KEYS.RED)) {
            if (onAction) { event.preventDefault(); onAction('red'); }
        } else if (matchKey(event, TV_KEYS.GREEN)) {
            if (onAction) { event.preventDefault(); onAction('green'); }
        } else if (matchKey(event, TV_KEYS.YELLOW)) {
            if (onAction) { event.preventDefault(); onAction('yellow'); }
        } else if (matchKey(event, TV_KEYS.BLUE)) {
            if (onAction) { event.preventDefault(); onAction('blue'); }
        }
    }, [enabled, onNavigate, onAction, onBack, onEnter]);

    useEffect(() => {
        // Custom handler for Tizen hardware 'back' key when keyboard is open
        const handleTizenHwKey = (e: TizenHardwareKeyEvent) => {
            if (e.keyName === 'back' || e.keyName === 'Return') {
                const active = document.activeElement as HTMLElement;
                if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                    active.blur();
                    // Let TV close the keyboard
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('tizenhwkey', handleTizenHwKey as EventListener);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('tizenhwkey', handleTizenHwKey as EventListener);
        };
    }, [handleKeyDown]);
}
