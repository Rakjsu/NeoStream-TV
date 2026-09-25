// @vitest-environment jsdom
//
// Precisa de DOM porque o `renderHook` monta um componente de verdade — mesmo
// padrão do useTVNavigation.test.tsx, o outro teste de hook do projeto. O
// ambiente padrão do vitest.config.ts continua sendo `node`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useConfirmacaoDupla, JANELA_CONFIRMACAO_MS } from './useConfirmacaoDupla';

/**
 * O Sair da conta apaga credenciais e TODAS as playlists. Num controle de TV,
 * OK por engano é comum — a garantia aqui é que UM toque nunca executa.
 */
describe('useConfirmacaoDupla', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('um toque só arma — nunca executa', () => {
        const acao = vi.fn();
        const { result } = renderHook(() => useConfirmacaoDupla(acao));
        act(() => { result.current.pedir(); });
        expect(acao).not.toHaveBeenCalled();
        expect(result.current.armado).toBe(true);
    });

    it('o segundo toque dentro da janela executa', () => {
        const acao = vi.fn();
        const { result } = renderHook(() => useConfirmacaoDupla(acao));
        act(() => { result.current.pedir(); });
        act(() => { vi.advanceTimersByTime(JANELA_CONFIRMACAO_MS - 100); });
        act(() => { result.current.pedir(); });
        expect(acao).toHaveBeenCalledTimes(1);
        expect(result.current.armado).toBe(false);
    });

    it('passada a janela, o toque seguinte só rearma', () => {
        const acao = vi.fn();
        const { result } = renderHook(() => useConfirmacaoDupla(acao));
        act(() => { result.current.pedir(); });
        act(() => { vi.advanceTimersByTime(JANELA_CONFIRMACAO_MS + 1); });
        expect(result.current.armado).toBe(false);
        act(() => { result.current.pedir(); });
        expect(acao).not.toHaveBeenCalled();
        expect(result.current.armado).toBe(true);
    });

    it('desarmar cancela: o toque seguinte volta a ser o primeiro', () => {
        const acao = vi.fn();
        const { result } = renderHook(() => useConfirmacaoDupla(acao));
        act(() => { result.current.pedir(); });
        act(() => { result.current.desarmar(); });
        expect(result.current.armado).toBe(false);
        act(() => { result.current.pedir(); });
        expect(acao).not.toHaveBeenCalled();
    });
});
