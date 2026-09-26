// @vitest-environment jsdom
//
// A contagem regressiva do PinPrompt deixou de ser exclusiva do PIN parental
// (T048): qualquer trava (a do PIN de perfil, agora) aparece na tela. E o
// relógio que a conta é armado só enquanto há espera — acabou a espera ou
// fechou o prompt, o timer morre.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { PinPrompt } from './PinPrompt';
import type { TravaVisivel } from '../services/pinLock';

let travadoAte = 0;
let tentativas = 5;
const trava: TravaVisivel = {
    restanteMs: () => Math.max(0, travadoAte - Date.now()),
    tentativasRestantes: () => tentativas,
};

function mensagem(): string {
    return document.querySelector('.pin-error')?.textContent ?? '';
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 25, 12, 0, 0));
    tentativas = 5;
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('PinPrompt com trava de perfil (T048)', () => {
    it('mostra a espera da trava recebida, conta até zero e desarma o relógio', () => {
        travadoAte = Date.now() + 2_000;
        render(<PinPrompt title="Digite o PIN" trava={trava} onSubmit={() => false} onCancel={() => {}} />);

        expect(mensagem()).toBe('Muitas tentativas. Tente de novo em 2 s.');
        expect(vi.getTimerCount()).toBe(1);

        // Digitar durante a espera não envia nada
        fireEvent.keyDown(window, { key: '1', keyCode: 49 });
        expect(document.querySelectorAll('.pin-dot.filled').length).toBe(0);

        act(() => { vi.advanceTimersByTime(1_000); });
        expect(mensagem()).toBe('Muitas tentativas. Tente de novo em 1 s.');

        act(() => { vi.advanceTimersByTime(1_000); });
        expect(mensagem()).toBe('');
        expect(document.querySelectorAll('.pin-key-locked').length).toBe(0);
        // Espera acabou: nenhum intervalo sobrando
        expect(vi.getTimerCount()).toBe(0);
    });

    it('fechar o prompt no meio da espera desarma o relógio', () => {
        travadoAte = Date.now() + 60_000;
        const { unmount } = render(<PinPrompt title="Digite o PIN" trava={trava} onSubmit={() => false} onCancel={() => {}} />);
        expect(vi.getTimerCount()).toBe(1);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('sem espera, não arma relógio nenhum', () => {
        travadoAte = 0;
        render(<PinPrompt title="Digite o PIN" trava={trava} onSubmit={() => false} onCancel={() => {}} />);
        expect(mensagem()).toBe('');
        expect(vi.getTimerCount()).toBe(0);
    });
});

// O `parental` virou atalho para a trava do PIN parental: as telas que já o
// usavam (Configurações, sair do Kids) não podem perder a espera nem o aviso
// no caminho. O estado vai gravado cru, no formato que a versão anterior
// gravava — quem estava em espera ao atualizar o app continua em espera.
describe('PinPrompt parental continua mostrando a trava do PIN parental (T048)', () => {
    const LOCK_PARENTAL = 'neostream_parental_lock';

    beforeEach(() => {
        vi.useRealTimers();
        localStorage.clear();
    });
    afterEach(() => {
        localStorage.clear();
    });

    it('espera gravada pela versão anterior aparece ao abrir', () => {
        localStorage.setItem(LOCK_PARENTAL, JSON.stringify({ erros: 0, travadoAte: Date.now() + 60_000, rodadas: 1 }));
        render(<PinPrompt title="Controle parental" parental onSubmit={() => false} onCancel={() => {}} />);

        expect(mensagem()).toBe('Muitas tentativas. Tente de novo em 1 min.');
        fireEvent.keyDown(window, { key: '1', keyCode: 49 });
        expect(document.querySelectorAll('.pin-dot.filled').length).toBe(0);
    });

    it('avisa quantas tentativas faltam antes da espera', async () => {
        localStorage.setItem(LOCK_PARENTAL, JSON.stringify({ erros: 3, travadoAte: 0, rodadas: 0 }));
        render(<PinPrompt title="Controle parental" parental onSubmit={() => false} onCancel={() => {}} />);

        for (const d of '0000') fireEvent.keyDown(window, { key: d, keyCode: 48 });
        await waitFor(() => expect(mensagem()).toBe('PIN incorreto. Mais 2 tentativas antes da espera.'));
    });
});
