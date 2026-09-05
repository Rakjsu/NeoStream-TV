// @vitest-environment jsdom
//
// O boundary e a ultima rede do app: se ELE prender o usuario, nao ha mais
// nada embaixo. O caso que importa e o crash deterministico — OK recarrega
// direto pro mesmo erro, e Voltar tem que ser a saida.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AppErrorBoundary } from './AppErrorBoundary';

const sair = vi.fn();
const pode = vi.fn(() => true);

vi.mock('../services/tizenApp', () => ({
    exitApp: () => sair(),
    podeSair: () => pode(),
}));

function Explode(): never {
    throw new Error('catalogo invalido');
}

function tecla(key: string, keyCode = 0) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true }));
}

describe('AppErrorBoundary', () => {
    beforeEach(() => {
        sair.mockClear();
        pode.mockClear();
        // O React registra o erro no console; nao poluir a saida do teste.
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    // O auto-cleanup do RTL só roda com `globals: true`, que este projeto não
    // usa — sem isto os boundaries de um teste seguem ouvindo no próximo.
    afterEach(() => { cleanup(); vi.restoreAllMocks(); });

    it('Voltar fecha o app na tela de crash', () => {
        render(<AppErrorBoundary><Explode /></AppErrorBoundary>);
        expect(screen.getByText(/Algo deu errado/)).toBeTruthy();
        tecla('XF86Back');
        expect(sair).toHaveBeenCalledTimes(1);
    });

    it('o keycode do Tizen tambem fecha (o event.key nao chega na TV)', () => {
        render(<AppErrorBoundary><Explode /></AppErrorBoundary>);
        tecla('', 10009);
        expect(sair).toHaveBeenCalledTimes(1);
    });

    it('seta nao fecha o app', () => {
        render(<AppErrorBoundary><Explode /></AppErrorBoundary>);
        tecla('ArrowDown');
        expect(sair).not.toHaveBeenCalled();
    });

    it('sem crash, Voltar passa reto', () => {
        render(<AppErrorBoundary><span>tudo certo</span></AppErrorBoundary>);
        tecla('XF86Back');
        expect(sair).not.toHaveBeenCalled();
    });

    it('a dica de sair some quando a TV nao tem a API', () => {
        pode.mockReturnValue(false);
        render(<AppErrorBoundary><Explode /></AppErrorBoundary>);
        expect(screen.queryByText(/aperte Voltar/)).toBeNull();
    });
});
