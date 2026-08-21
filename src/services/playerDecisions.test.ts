// As três decisões do player. Antes viviam dentro de handlers do HLS.js e só
// dava pra exercitá-las com uma TV, um provedor e uma queda de rede na hora
// certa — o que na prática significava não exercitá-las nunca.

import { describe, it, expect } from 'vitest';
import {
    classifyStreamError, isTerminalCause, reconnectDelayMs, chooseCappedLevel,
    MAX_RECONNECT_ATTEMPTS,
} from './playerDecisions';

describe('classifyStreamError', () => {
    it.each([404, 403])('%d é o provedor dizendo que o canal não existe aqui', (status) => {
        expect(classifyStreamError('network', status)).toBe('notfound');
        expect(isTerminalCause(classifyStreamError('network', status))).toBe(true);
    });

    it.each([500, 502, 0, undefined])('%s é rede instável — vale tentar de novo', (status) => {
        expect(classifyStreamError('network', status)).toBe('network');
        expect(isTerminalCause('network')).toBe(false);
    });

    it('erro de mídia e o resto ficam separados', () => {
        expect(classifyStreamError('media')).toBe('media');
        expect(classifyStreamError('other')).toBe('fatal');
    });

    // 404 num erro de MÍDIA não é "canal não existe": o fragmento chegou.
    it('o status só decide em erro de rede', () => {
        expect(classifyStreamError('media', 404)).toBe('media');
        expect(classifyStreamError('other', 404)).toBe('fatal');
    });
});

describe('reconnectDelayMs', () => {
    it('dobra a cada tentativa', () => {
        expect([1, 2, 3, 4].map(reconnectDelayMs)).toEqual([2000, 4000, 8000, 16000]);
    });

    // Sem o teto, a 6ª tentativa esperaria 64s numa tela que só diz
    // "Reconectando…" — parece travado.
    it('trava em 16s por mais que a tentativa suba', () => {
        expect(reconnectDelayMs(9)).toBe(16000);
        expect(reconnectDelayMs(99)).toBe(16000);
    });

    it('não devolve valor absurdo pra entrada estranha', () => {
        expect(reconnectDelayMs(0)).toBe(2000);
        expect(reconnectDelayMs(-5)).toBe(2000);
    });

    // O ciclo inteiro tem que caber num tempo que o usuário tolera antes do
    // failover pra próxima variante do canal.
    it('o ciclo completo cabe em 30s', () => {
        const total = Array.from({ length: MAX_RECONNECT_ATTEMPTS }, (_, i) => reconnectDelayMs(i + 1))
            .reduce((a, b) => a + b, 0);
        expect(total).toBe(30000);
    });
});

describe('chooseCappedLevel', () => {
    const niveis = [
        { index: 0, height: 360 },
        { index: 1, height: 720 },
        { index: 2, height: 1080 },
    ];

    it('pega o melhor que cabe no teto', () => {
        expect(chooseCappedLevel(niveis, 720)).toBe(1);
        expect(chooseCappedLevel(niveis, 1080)).toBe(2);
        expect(chooseCappedLevel(niveis, 900)).toBe(1);
    });

    it('teto zero (Automático) não trava nada', () => {
        expect(chooseCappedLevel(niveis, 0)).toBeNull();
    });

    it('quando nada cabe, fica com a menor declarada', () => {
        expect(chooseCappedLevel(niveis, 240)).toBe(0);
    });

    // BUG REAL (R5): height 0 quer dizer "o manifesto não declarou RESOLUTION",
    // muito comum em Xtream. Tratado como número, ele "cabia" em qualquer teto
    // e travava o canal inteiro na pior variante do provedor.
    it('height 0 é ausência de dado, não qualidade mínima', () => {
        const semDeclaracao = [
            { index: 0, height: 0 },
            { index: 1, height: 0 },
            { index: 2, height: 0 },
        ];
        expect(chooseCappedLevel(semDeclaracao, 720)).toBeNull();
    });

    it('ignora os não declarados quando há pelo menos um declarado', () => {
        const misto = [
            { index: 0, height: 0 },
            { index: 1, height: 480 },
            { index: 2, height: 1080 },
        ];
        expect(chooseCappedLevel(misto, 720)).toBe(1);
        // e nunca escolhe o índice 0 só porque 0 <= cap
        expect(chooseCappedLevel(misto, 100)).toBe(1);
    });

    it('lista vazia não trava nada', () => {
        expect(chooseCappedLevel([], 720)).toBeNull();
    });
});
