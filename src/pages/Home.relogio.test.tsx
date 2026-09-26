// @vitest-environment jsdom
//
// T117 — o relógio da Home re-renderizava a PÁGINA INTEIRA a cada minuto.
//
// O estado da hora morava no corpo da Home: o `setInterval` de 60 s trocava
// esse estado e a Home reconstruía todas as fileiras de pôsteres só pra mudar
// dois dígitos do cabeçalho (e ainda montava dois formatadores Intl por vez).
// Pior: o intervalo contava a partir da MONTAGEM, não da virada do minuto —
// aberta às 10:00:30, a Home mostrava "10:00" até 10:01:30.
//
// A Home é a de verdade. O `useTVNavigation` é o de verdade também, só
// embrulhado num contador: ele é chamado uma vez por render do corpo da
// Home, então conta quantas vezes a página inteira foi re-executada.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { installFakeStorage } from '../testing/fakeStorage';
import { api } from '../services/api';
import { Home } from './Home';

const renders = vi.hoisted(() => ({ home: 0 }));
vi.mock('../hooks/useTVNavigation', async (importOriginal) => {
    const real = await importOriginal<typeof import('../hooks/useTVNavigation')>();
    return {
        ...real,
        useTVNavigation: (...args: Parameters<typeof real.useTVNavigation>) => {
            renders.home++;
            return real.useTVNavigation(...args);
        },
    };
});

const texto = (seletor: string) => document.querySelector(seletor)?.textContent?.trim() ?? null;
const relogio = () => texto('.home-clock');
const saudacao = () => texto('.home-greeting');
const data = () => texto('.home-date');

/** Dispara uma tecla como a TV dispara (keyCode; o `key` vem vazio no Tizen). */
function tecla(keyCode: number): void {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '', keyCode, bubbles: true, cancelable: true }));
    });
}
const DIREITA = 39;
const BAIXO = 40;

/** Espera a CONDIÇÃO (as promessas do fetch resolvem em microtarefas). */
async function ate(condicao: () => boolean): Promise<void> {
    for (let volta = 0; volta < 200; volta++) {
        if (condicao()) return;
        await act(async () => { await Promise.resolve(); });
    }
    throw new Error('a condição esperada não aconteceu');
}

/** Anda o relógio falso (timers + Date) dentro do act. */
async function passar(ms: number): Promise<void> {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function montarHome(): Promise<() => void> {
    const { unmount } = render(<Home onNavigate={() => {}} onRequestExit={() => {}} onCancelExit={() => {}} />);
    // o fetch terminou: os contadores saíram do "..."
    await ate(() => texto('.stat-card-live .stat-value') === '0');
    return unmount;
}

beforeEach(() => {
    installFakeStorage();
    Element.prototype.scrollIntoView = function () { /* jsdom */ };
    vi.spyOn(api, 'getLiveStreams').mockResolvedValue([]);
    vi.spyOn(api, 'getVODStreams').mockResolvedValue([]);
    vi.spyOn(api, 'getSeries').mockResolvedValue([]);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    // TZ fixo no vitest.config (America/Sao_Paulo): 25/09/2026, 10:00:30,500
    // (os 500 ms de propósito: o tique tem de descontar os milissegundos)
    vi.setSystemTime(new Date(2026, 8, 25, 10, 0, 30, 500));
    renders.home = 0;
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('Home — relógio do cabeçalho (T117)', () => {
    it('mostra data, saudação e hora de quando abriu', async () => {
        await montarHome();
        expect(data()).toBe('sexta-feira, 25 de setembro');
        expect(saudacao()).toBe('Bom dia! 👋');
        expect(relogio()).toBe('10:00');
    });

    it('vira na virada do minuto, não 60 s depois de a Home abrir', async () => {
        await montarHome();
        await passar(29_499);            // 10:00:59,999
        expect(relogio()).toBe('10:00');
        await passar(1);                 // 10:01:00,000
        expect(relogio()).toBe('10:01');
        await passar(59_999);            // 10:01:59,999
        expect(relogio()).toBe('10:01');
        await passar(1);                 // 10:02:00,000
        expect(relogio()).toBe('10:02');
    });

    it('o tique do minuto NÃO re-renderiza a página (só o cabeçalho)', async () => {
        await montarHome();
        const antes = renders.home;
        // minuto a minuto (um act por tique: o act agruparia tiques seguidos
        // num render só e esconderia o custo)
        for (let minuto = 1; minuto <= 5; minuto++) {
            await passar(60_000);
            expect(relogio()).toBe(`10:0${minuto}`);
        }
        expect(renders.home).toBe(antes);
    });

    it('a seta do D-pad re-renderiza a Home mas NÃO o cabeçalho (nem os formatadores)', async () => {
        await montarHome();
        // O getter `format` do Intl.DateTimeFormat é lido a cada formatação:
        // conta quantas vezes o cabeçalho formatou data/hora. (No ECMA-402
        // `format` é um GETTER que devolve a função; o lib.d.ts o tipa como
        // método, daí a conversão de tipo.)
        const proto = Intl.DateTimeFormat.prototype as unknown as { format: object };
        const formatou = vi.spyOn(proto, 'format', 'get');
        const cabecalho = document.querySelector('.home-header');
        const rendersAntes = renders.home;
        tecla(DIREITA);                  // Canais → Filmes nos contadores
        expect(document.querySelector('.stat-card-vod.tv-focused')).not.toBeNull();
        expect(renders.home).toBeGreaterThan(rendersAntes);
        expect(formatou).not.toHaveBeenCalled();
        // ↓ troca de SEÇÃO (contadores → Acesso Rápido): o cabeçalho também
        // não pode remontar (uma `key` presa ao foco o recriaria a cada seta)
        tecla(BAIXO);
        expect(document.querySelector('.quick-item.tv-focused')).not.toBeNull();
        expect(formatou).not.toHaveBeenCalled();
        expect(document.querySelector('.home-header')).toBe(cabecalho);
        // ...e o cabeçalho continua vivo: o tique seguinte ainda formata
        await passar(29_500);            // 10:01:00
        expect(relogio()).toBe('10:01');
        expect(formatou).toHaveBeenCalled();
    });

    it('o tique reaproveita os formatadores: nenhum Intl.DateTimeFormat novo por minuto', async () => {
        await montarHome();
        // Os dois formatadores nascem quando o módulo carrega; daqui em diante
        // nenhum tique pode construir outro (era o custo do toLocale*String).
        // O espião repassa ao construtor real: só conta, não muda a saída.
        const Real = Intl.DateTimeFormat;
        const construiu = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
            function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
                return new Real(...args);
            } as unknown as typeof Intl.DateTimeFormat,
        );
        for (let minuto = 1; minuto <= 3; minuto++) {
            await passar(60_000);
            expect(relogio()).toBe(`10:0${minuto}`);
        }
        expect(data()).toBe('sexta-feira, 25 de setembro');
        expect(construiu).not.toHaveBeenCalled();
    });

    it('a saudação acompanha o relógio (meio-dia → "Boa tarde")', async () => {
        vi.setSystemTime(new Date(2026, 8, 25, 11, 59, 10));
        await montarHome();
        expect(saudacao()).toBe('Bom dia! 👋');
        await passar(50_000);            // 12:00:00
        expect(relogio()).toBe('12:00');
        expect(saudacao()).toBe('Boa tarde! 👋');
    });

    it('a saudação acompanha o relógio (18h → "Boa noite")', async () => {
        vi.setSystemTime(new Date(2026, 8, 25, 17, 59, 30));
        await montarHome();
        expect(saudacao()).toBe('Boa tarde! 👋');
        await passar(30_000);            // 18:00:00
        expect(relogio()).toBe('18:00');
        expect(saudacao()).toBe('Boa noite! 👋');
    });

    it('fechar a Home desarma o timer do relógio (também o reagendado depois de vários tiques)', async () => {
        const desmontar = await montarHome();
        // o timer vivo NÃO é mais o da montagem: cada tique agenda o próximo
        await passar(3 * 60_000);
        expect(relogio()).toBe('10:03');
        expect(vi.getTimerCount()).toBeGreaterThan(0);
        desmontar();
        expect(vi.getTimerCount()).toBe(0);
        // e nada mais é agendado depois
        await passar(3 * 60_000);
        expect(vi.getTimerCount()).toBe(0);
    });
});
