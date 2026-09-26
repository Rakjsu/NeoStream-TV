// @vitest-environment jsdom
//
// O anel de erros da tela de diagnóstico também recebe avisos de falhas que
// NÃO viram exceção global (ex.: o segura-screensaver sem `webapis` na TV).
// Esses avisos se repetem a cada canal aberto — sem deduplicar e sem teto,
// empurrariam pra fora do anel o erro que interessa.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearErrorLog, getErrorLog, logWarning } from './diagnostics';

beforeEach(() => {
    clearErrorLog();
});

describe('logWarning', () => {
    it('entra no anel com a origem, o mais novo primeiro', () => {
        logWarning('primeiro', 'screensaver');
        logWarning('segundo', 'outra-origem');

        const log = getErrorLog();
        expect(log.map(e => [e.message, e.source])).toEqual([
            ['segundo', 'outra-origem'],
            ['primeiro', 'screensaver'],
        ]);
        expect(typeof log[0].at).toBe('number');
    });

    it('a mesma mensagem da mesma origem entra uma vez só; outra origem entra', () => {
        logWarning('sumiu', 'screensaver');
        logWarning('sumiu', 'screensaver');
        logWarning('sumiu', 'outra-origem');

        expect(getErrorLog()).toHaveLength(2);
    });

    it('um aviso repetido não volta mesmo com outro erro no meio', () => {
        logWarning('sumiu', 'screensaver');
        logWarning('outro erro', 'promise');
        logWarning('sumiu', 'screensaver');

        expect(getErrorLog().map(e => e.message)).toEqual(['outro erro', 'sumiu']);
    });

    it('guarda a hora do aviso (a tela de diagnóstico mostra quando foi)', () => {
        vi.spyOn(Date, 'now').mockReturnValue(1_758_844_800_000);
        logWarning('sumiu', 'screensaver');
        vi.restoreAllMocks();

        expect(getErrorLog()[0].at).toBe(1_758_844_800_000);
    });

    it('depois de limpar a tela, o aviso pode voltar', () => {
        logWarning('sumiu', 'screensaver');
        clearErrorLog();
        logWarning('sumiu', 'screensaver');

        expect(getErrorLog()).toHaveLength(1);
    });

    it('respeita o teto do anel e corta mensagem gigante', () => {
        for (let i = 0; i < 25; i++) logWarning(`aviso ${i}`, 'screensaver');
        const log = getErrorLog();
        expect(log).toHaveLength(20);
        expect(log[0].message).toBe('aviso 24');

        clearErrorLog();
        logWarning('x'.repeat(1000), 'screensaver');
        logWarning('x'.repeat(1000), 'screensaver');
        expect(getErrorLog()).toHaveLength(1);
        expect(getErrorLog()[0].message).toHaveLength(300);
    });
});
