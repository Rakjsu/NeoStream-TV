// TV Navigation Hook - Handles D-pad navigation for Smart TVs

import { useEffect, useCallback, useRef } from 'react';

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
    onEnter?: () => void;
    enabled?: boolean;
}

// Check if key matches any of the codes
const matchKey = (key: string | number, codes: string[]): boolean => {
    return codes.includes(String(key)) || codes.includes(String(key));
};

export function useTVNavigation(options: UseTVNavigationOptions = {}) {
    const { onNavigate, onAction, onBack, onEnter, enabled = true } = options;

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        if (!enabled) return;

        const key = event.key || String(event.keyCode);

        // Ignore events if user is currently focused on an input/textarea
        // This allows the native TV keyboard (IME) to handle Backspace, Left, Right, etc.
        const target = event.target as HTMLElement;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
            // Dentro de input, espaço (32) é TEXTO — só Enter/OK de verdade
            // fecha o teclado (buscar "ESPN 2" precisa do espaço)
            if (matchKey(key, ['Enter', '13', '29443', 'Select'])) {
                event.preventDefault();
                event.stopPropagation();
                target.blur();
                onEnter?.();
                onAction?.('enter');
                return;
            }

            // If the user presses the 'Return' / 'Back' button on the TV remote while editing, 
            // we should blur the input to hide the virtual keyboard and restore TV navigation.
            // 10009 (Tizen Back), 461 (WebOS Back), XF86Back (Generic), Escape
            // Also handle keyCode 8 (Backspace) ONLY when input value is empty (to exit editing)
            if (matchKey(key, TV_KEYS.BACK) || key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                target.blur();
                onBack?.();
                onAction?.('back');
            }
            return;
        }

        // Navigation
        if (matchKey(key, TV_KEYS.UP)) {
            if (onNavigate) { event.preventDefault(); onNavigate('up'); }
        } else if (matchKey(key, TV_KEYS.DOWN)) {
            if (onNavigate) { event.preventDefault(); onNavigate('down'); }
        } else if (matchKey(key, TV_KEYS.LEFT)) {
            if (onNavigate) { event.preventDefault(); onNavigate('left'); }
        } else if (matchKey(key, TV_KEYS.RIGHT)) {
            if (onNavigate) { event.preventDefault(); onNavigate('right'); }
        }
        // Actions
        else if (matchKey(key, TV_KEYS.ENTER)) {
            if (onEnter || onAction) {
                event.preventDefault();
                onEnter?.();
                onAction?.('enter');
            }
        } else if (matchKey(key, TV_KEYS.BACK)) {
            if (onBack || onAction) {
                event.preventDefault();
                onBack?.();
                onAction?.('back');
            }
        }
        // Media
        else if (matchKey(key, TV_KEYS.PLAY)) {
            if (onAction) { event.preventDefault(); onAction('play'); }
        } else if (matchKey(key, TV_KEYS.PAUSE)) {
            if (onAction) { event.preventDefault(); onAction('pause'); }
        } else if (matchKey(key, TV_KEYS.STOP)) {
            if (onAction) { event.preventDefault(); onAction('stop'); }
        }
        // Color keys (atalhos por página)
        else if (matchKey(key, TV_KEYS.RED)) {
            if (onAction) { event.preventDefault(); onAction('red'); }
        } else if (matchKey(key, TV_KEYS.GREEN)) {
            if (onAction) { event.preventDefault(); onAction('green'); }
        } else if (matchKey(key, TV_KEYS.YELLOW)) {
            if (onAction) { event.preventDefault(); onAction('yellow'); }
        } else if (matchKey(key, TV_KEYS.BLUE)) {
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

// Focus management for TV navigation
export function useFocusManager<T extends HTMLElement>() {
    const containerRef = useRef<T>(null);
    const focusedIndexRef = useRef(0);

    const getFocusableElements = useCallback(() => {
        if (!containerRef.current) return [];
        return Array.from(containerRef.current.querySelectorAll('[data-focusable="true"]')) as HTMLElement[];
    }, []);

    const focusElement = useCallback((index: number) => {
        const elements = getFocusableElements();
        if (elements.length === 0) return;

        // Clamp index
        const newIndex = Math.max(0, Math.min(index, elements.length - 1));
        focusedIndexRef.current = newIndex;

        // Remove focus from all
        elements.forEach(el => el.classList.remove('tv-focused'));

        // Add focus to target
        const target = elements[newIndex];
        if (target) {
            target.classList.add('tv-focused');
            target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
    }, [getFocusableElements]);

    const moveFocus = useCallback((delta: number) => {
        focusElement(focusedIndexRef.current + delta);
    }, [focusElement]);

    const getCurrentElement = useCallback(() => {
        const elements = getFocusableElements();
        return elements[focusedIndexRef.current] || null;
    }, [getFocusableElements]);

    return {
        containerRef,
        focusElement,
        moveFocus,
        getCurrentElement,
        getFocusedIndex: () => focusedIndexRef.current,
    };
}

// Grid navigation hook
export function useGridNavigation(columns: number) {
    const containerRef = useRef<HTMLDivElement>(null);
    const focusedIndexRef = useRef(0);

    const getFocusableElements = useCallback(() => {
        if (!containerRef.current) return [];
        return Array.from(containerRef.current.querySelectorAll('[data-focusable="true"]')) as HTMLElement[];
    }, []);

    const focusElement = useCallback((index: number) => {
        const elements = getFocusableElements();
        if (elements.length === 0) return;

        const newIndex = Math.max(0, Math.min(index, elements.length - 1));
        focusedIndexRef.current = newIndex;

        elements.forEach(el => el.classList.remove('tv-focused'));

        const target = elements[newIndex];
        if (target) {
            target.classList.add('tv-focused');
            target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        }
    }, [getFocusableElements]);

    const handleNavigate = useCallback((direction: Direction) => {
        const elements = getFocusableElements();
        const current = focusedIndexRef.current;
        let newIndex = current;

        switch (direction) {
            case 'up':
                newIndex = current - columns;
                break;
            case 'down':
                newIndex = current + columns;
                break;
            case 'left':
                if (current % columns !== 0) newIndex = current - 1;
                break;
            case 'right':
                if ((current + 1) % columns !== 0) newIndex = current + 1;
                break;
        }

        if (newIndex >= 0 && newIndex < elements.length) {
            focusElement(newIndex);
        }
    }, [columns, getFocusableElements, focusElement]);

    return {
        containerRef,
        focusElement,
        handleNavigate,
        getCurrentIndex: () => focusedIndexRef.current,
    };
}
