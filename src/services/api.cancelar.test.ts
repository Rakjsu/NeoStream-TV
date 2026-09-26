// O login do boot pode ser cancelado por quem chamou (Voltar no spinner).
//
// Sem isto o `authenticate` só terminava pelo prazo de 15 s de cada tentativa,
// e o App não tinha como desistir: o usuário ficava olhando um spinner mudo.
// Cancelar tem de abortar o pedido EM VOO, não pular pro outro protocolo e
// não deixar para trás nem o cronômetro nem o ouvinte do sinal.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, AUTENTICACAO_CANCELADA } from './api';

interface Pedido {
    url: string;
    signal: AbortSignal;
    responder: (corpo: unknown) => void;
}

let pedidos: Pedido[] = [];
/** Quando true o provedor ignora o abort (resposta que já vinha no caminho). */
let ignorarAbort = false;

function fetchControlado(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const signal = init?.signal as AbortSignal;
    return new Promise<Response>((resolve, reject) => {
        pedidos.push({
            url: String(url),
            signal,
            responder: (corpo) => resolve({
                ok: true,
                status: 200,
                statusText: 'OK',
                text: async () => JSON.stringify(corpo),
            } as Response),
        });
        if (!ignorarAbort) {
            signal.addEventListener('abort', () => reject(new DOMException('The user aborted a request.', 'AbortError')));
        }
    });
}

const RESPOSTA_OK = {
    user_info: { auth: 1, username: 'u', status: 'Active' },
    server_info: { url: 'provedor.invalid', port: '8080' },
};

/** Guarda o desfecho da promessa sem deixar rejeição solta. */
function acompanhar<T>(promessa: Promise<T>) {
    const estado: { feito: boolean; valor?: T; erro?: unknown } = { feito: false };
    promessa.then(
        (valor) => { estado.feito = true; estado.valor = valor; },
        (erro) => { estado.feito = true; estado.erro = erro; },
    );
    return estado;
}

beforeEach(() => {
    vi.useFakeTimers();
    pedidos = [];
    ignorarAbort = false;
    vi.stubGlobal('fetch', vi.fn(fetchControlado));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('api.authenticate com sinal de cancelamento', () => {
    it('cancelar aborta o pedido em voo, na hora, e NÃO tenta o outro protocolo', async () => {
        const cancelar = new AbortController();
        const estado = acompanhar(api.authenticate('http://provedor.invalid:8080', 'u', 'p', cancelar.signal));
        await vi.waitFor(() => expect(pedidos).toHaveLength(1));

        cancelar.abort();

        // Sem andar o relógio até o prazo: o desfecho vem do cancelamento
        await vi.waitFor(() => expect(estado.feito).toBe(true));
        expect(pedidos[0].signal.aborted).toBe(true);
        expect((estado.erro as Error).message).toBe(AUTENTICACAO_CANCELADA);
        expect(pedidos).toHaveLength(1);
        // Nenhum cronômetro sobrou (o prazo de 15 s foi desarmado)
        expect(vi.getTimerCount()).toBe(0);
    });

    it('o ouvinte do sinal sai quando a tentativa termina bem', async () => {
        const cancelar = new AbortController();
        const add = vi.spyOn(cancelar.signal, 'addEventListener');
        const remove = vi.spyOn(cancelar.signal, 'removeEventListener');

        const estado = acompanhar(api.authenticate('http://provedor.invalid:8080', 'u', 'p', cancelar.signal));
        await vi.waitFor(() => expect(pedidos).toHaveLength(1));
        pedidos[0].responder(RESPOSTA_OK);
        await vi.waitFor(() => expect(estado.feito).toBe(true));

        expect(estado.erro).toBeUndefined();
        expect(add).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('resposta que chega DEPOIS do cancelamento não loga ninguém', async () => {
        ignorarAbort = true;
        const antes = api.getBaseUrl();
        const cancelar = new AbortController();
        const estado = acompanhar(api.authenticate('http://outro-provedor.invalid:8080', 'u2', 'p2', cancelar.signal));
        await vi.waitFor(() => expect(pedidos).toHaveLength(1));

        cancelar.abort();
        pedidos[0].responder(RESPOSTA_OK);
        await vi.waitFor(() => expect(estado.feito).toBe(true));

        expect((estado.erro as Error).message).toBe(AUTENTICACAO_CANCELADA);
        expect(api.getBaseUrl()).toBe(antes);
        expect(pedidos).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('sinal que já chega abortado: nem pede ao provedor', async () => {
        const cancelar = new AbortController();
        cancelar.abort();

        const estado = acompanhar(api.authenticate('http://provedor.invalid:8080', 'u', 'p', cancelar.signal));
        await vi.waitFor(() => expect(estado.feito).toBe(true));

        expect((estado.erro as Error).message).toBe(AUTENTICACAO_CANCELADA);
        expect(pedidos).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('com o fallback de protocolo, cada tentativa tira o SEU ouvinte e o cancelamento alcança a 2ª', async () => {
        vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
            if (String(url).startsWith('http://')) return Promise.reject(new TypeError('Failed to fetch'));
            return fetchControlado(url, init);
        }));
        const cancelar = new AbortController();
        const add = vi.spyOn(cancelar.signal, 'addEventListener');
        const remove = vi.spyOn(cancelar.signal, 'removeEventListener');

        const estado = acompanhar(api.authenticate('http://provedor.invalid:8080', 'u', 'p', cancelar.signal));
        // A 1ª (http) caiu por rede; a 2ª (https) está em voo
        await vi.waitFor(() => expect(pedidos).toHaveLength(1));
        expect(pedidos[0].url.startsWith('https://')).toBe(true);
        // O ouvinte da 1ª já saiu; o da 2ª está vivo
        expect(add).toHaveBeenCalledTimes(2);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);

        cancelar.abort();
        await vi.waitFor(() => expect(estado.feito).toBe(true));

        expect(pedidos[0].signal.aborted).toBe(true);
        expect((estado.erro as Error).message).toBe(AUTENTICACAO_CANCELADA);
        expect(remove).toHaveBeenCalledTimes(2);
        expect(remove).toHaveBeenLastCalledWith('abort', add.mock.calls[1][1]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('sem sinal nada muda: falha de rede na 1ª candidata ainda tenta o outro protocolo', async () => {
        vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
            if (String(url).startsWith('http://')) return Promise.reject(new TypeError('Failed to fetch'));
            return fetchControlado(url, init);
        }));

        const estado = acompanhar(api.authenticate('http://provedor.invalid:8080', 'u', 'p'));
        await vi.waitFor(() => expect(pedidos).toHaveLength(1));
        expect(pedidos[0].url.startsWith('https://provedor.invalid:8443')).toBe(true);
        pedidos[0].responder(RESPOSTA_OK);
        await vi.waitFor(() => expect(estado.feito).toBe(true));
        expect(estado.erro).toBeUndefined();
    });
});
