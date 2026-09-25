// @vitest-environment jsdom
//
// ⏱️ A sessão só era contabilizada na DESMONTAGEM — e numa TV o jeito normal
// de parar de assistir é desligar no controle: o React não desmonta nada, o
// processo morre. As três horas de futebol nunca chegavam à Retrospectiva, ao
// ranking da Home nem ao painel das Configurações.
//
// O relógio do teste é falso de propósito: o defeito é exatamente o que
// acontece quando passa tempo SEM desmontar nada.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { installFakeStorage } from '../testing/fakeStorage';
import { usageStats } from '../services/usageStats';
import { useWatchSession } from './useWatchSession';

function Sonda() {
    useWatchSession('live', 'ESPN');
    return <div />;
}

function Zap({ canal }: { canal: string }) {
    useWatchSession('live', canal);
    return <div />;
}

beforeEach(() => {
    installFakeStorage();
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('useWatchSession', () => {
    it('contabiliza a sessão sem desmontagem nenhuma', () => {
        // Desligar a TV no controle: nada desmonta, o processo morre.
        render(<Sonda />);
        vi.advanceTimersByTime(3 * 60_000);

        expect(usageStats.summary().totalSeconds).toBe(180);
    });

    it('não conta o mesmo minuto duas vezes quando desmonta', () => {
        // Trava contra a correção ingênua: se o marco não for reavançado, cada
        // tique gravaria "desde a montagem" e daria 540.
        const { unmount } = render(<Sonda />);
        vi.advanceTimersByTime(3 * 60_000);
        unmount();

        expect(usageStats.summary().totalSeconds).toBe(180);
    });

    it('não perde o resto da sessão que não fecha um minuto', () => {
        // O piso de 15 s do `record` existe pra descartar blip de zapping. Sem
        // marcar a continuação, ele passaria a comer o rabo de toda sessão.
        const { unmount } = render(<Sonda />);
        vi.advanceTimersByTime(74_000);
        unmount();

        expect(usageStats.summary().totalSeconds).toBe(74);
    });

    it('zapping de canais de 70 s não encolhe o total', () => {
        // Cinco canais × 70 s. Comendo 10 s de cada, o total cairia 14% e cada
        // canal apareceria com 60 s no ranking.
        const { rerender, unmount } = render(<Zap canal="C1" />);
        for (let i = 2; i <= 5; i++) {
            vi.advanceTimersByTime(70_000);
            rerender(<Zap canal={`C${i}`} />);
        }
        vi.advanceTimersByTime(70_000);
        unmount();

        expect(usageStats.summary().totalSeconds).toBe(350);
    });

    it('blip de 3 s continua descartado', () => {
        const { unmount } = render(<Sonda />);
        vi.advanceTimersByTime(3_000);
        unmount();

        expect(usageStats.summary().totalSeconds).toBe(0);
    });
});
