// @vitest-environment jsdom
//
// 📺 CH+/CH− sem acumulador (T002).
//
// Segurar CH+ no controle gera keydown de auto-repeat — o Chromium da TV
// repete ~15-20 vezes por segundo. Cada repetição era uma troca de canal
// COMPLETA: o player destruía e recriava o pipeline MSE, abria uma conexão
// nova no provedor e a página escrevia duas vezes no localStorage
// (zapHistory.push + setLastChannel). Meio segundo de dedo no botão eram ~10
// pipelines criados e destruídos numa TV de 1 GB.
//
// Agora CH+/CH− só andam um alvo, mostrado na hora no zap-banner (número +
// nome), e a troca sai UMA vez, ~600 ms depois da última tecla — o mesmo
// padrão que o seek já usa (nudgeSeek/commitSeek).
//
// O teste monta o VideoPlayer DE VERDADE dentro de uma página que faz o que a
// LiveTV faz no onSwitchChannel: troca o canal tocando (src + currentChannelId).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { installFakeStorage } from '../../testing/fakeStorage';
import { zapHistory } from '../../services/liveExtras';
import { VideoPlayer, type PlayerChannel } from './VideoPlayer';

/** Espera que o player dá depois da última tecla antes de trocar. */
const ESPERA_MS = 600;

const canais = (n: number): PlayerChannel[] =>
    Array.from({ length: n }, (_, i) => ({ stream_id: 100 + i, num: i + 1, name: `Canal ${i + 1}` }));

let trocas: number[];

beforeEach(() => {
    installFakeStorage();
    vi.useFakeTimers();
    trocas = [];
    // jsdom não implementa mídia; o player só precisa que as chamadas existam.
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.playing;
});

/** A LiveTV em miniatura: o onSwitchChannel troca o canal tocando. */
function Pagina({ lista, inicial = lista[0].stream_id }: { lista: PlayerChannel[]; inicial?: number }) {
    const [atual, setAtual] = useState(inicial);
    const canal = lista.find(c => c.stream_id === atual)!;
    return (
        <VideoPlayer
            src={`http://provedor.invalid/live/${atual}.ts`}
            title={canal.name}
            isLive
            contentType="live"
            channelList={lista}
            currentChannelId={atual}
            onSwitchChannel={(id) => { trocas.push(id); setAtual(id); }}
            onClose={() => {}}
        />
    );
}

const passar = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

/** CH− do controle (428 no Tizen; PageDown no teclado) = próximo da lista. */
const chMenos = (repeat = false) =>
    act(() => { fireEvent.keyDown(window, { key: 'PageDown', keyCode: 34, repeat }); });
/** CH+ do controle (427 no Tizen; PageUp no teclado) = anterior da lista. */
const chMais = (repeat = false) =>
    act(() => { fireEvent.keyDown(window, { key: 'PageUp', keyCode: 33, repeat }); });
/** 🔴 do controle: canal anterior do histórico. */
const vermelho = () =>
    act(() => { fireEvent.keyDown(window, { key: 'ColorF0Red', keyCode: 403 }); });

/** O banner do canal-alvo (número + nome), ou null se não está na tela. */
const alvo = () => document.querySelector('.zap-banner-alvo')?.textContent ?? null;

/**
 * Espiona setTimeout/clearTimeout para provar que a espera do CH± é
 * DESARMADA quando a troca pendente é cancelada (não só que ela não troca).
 */
function espiarEspera() {
    const armar = vi.spyOn(window, 'setTimeout');
    const desarmar = vi.spyOn(window, 'clearTimeout');
    return {
        /** O timer da última espera armada pelo CH±. */
        ultima: () => {
            const i = armar.mock.calls.map(([, ms]) => ms).lastIndexOf(ESPERA_MS);
            expect(i, 'CH± não armou a espera').toBeGreaterThanOrEqual(0);
            return armar.mock.results[i].value as ReturnType<typeof setTimeout>;
        },
        desarmou: (timer: ReturnType<typeof setTimeout>) => desarmar.mock.calls.some(([t]) => t === timer),
    };
}

describe('VideoPlayer — CH+/CH− acumulam e trocam uma vez só', () => {
    it('segurar CH− (auto-repeat) não troca a cada repetição: troca UMA vez, onde o dedo parou', () => {
        const lista = canais(8);
        render(<Pagina lista={lista} />);
        expect(alvo()).toBeNull();

        // Meio segundo de dedo no botão: 1 toque + 4 repetições a cada 50 ms
        chMenos();
        for (let i = 0; i < 4; i++) {
            passar(50);
            chMenos(true);
        }

        // Nada de trocar no meio da rajada...
        expect(trocas).toEqual([]);
        // ...mas o canal-alvo aparece NA HORA, com número e nome
        expect(alvo()).toBe('6Canal 6');

        passar(ESPERA_MS - 1);
        expect(trocas).toEqual([]);
        passar(1);
        expect(trocas).toEqual([lista[5].stream_id]);
        // Trocou: o banner do alvo sai da tela
        expect(alvo()).toBeNull();

        // A troca é uma só: o timer morreu com ela
        passar(10 * ESPERA_MS);
        expect(trocas).toEqual([lista[5].stream_id]);
    });

    it('cada tecla nova reinicia a espera, e CH+ anda para trás (dando a volta na lista)', () => {
        const lista = canais(5);
        render(<Pagina lista={lista} />);

        chMais(); // 1 → 5
        expect(alvo()).toBe('5Canal 5');
        passar(ESPERA_MS - 100);
        chMais(); // 5 → 4
        passar(ESPERA_MS - 100);
        expect(trocas).toEqual([]);
        expect(alvo()).toBe('4Canal 4');

        passar(100);
        expect(trocas).toEqual([lista[3].stream_id]);
    });

    it('dar a volta inteira na lista e parar no mesmo canal não troca nada', () => {
        const lista = canais(3);
        render(<Pagina lista={lista} />);

        chMenos();
        chMenos(true);
        chMenos(true);
        expect(alvo()).toBe('1Canal 1');
        passar(10 * ESPERA_MS);

        expect(trocas).toEqual([]);
        expect(alvo()).toBeNull();
    });

    it('depois de trocar, o próximo CH− parte do canal novo', () => {
        const lista = canais(6);
        render(<Pagina lista={lista} />);

        chMenos();
        chMenos(true);
        passar(ESPERA_MS);
        expect(trocas).toEqual([lista[2].stream_id]);

        chMenos();
        passar(ESPERA_MS);
        expect(trocas).toEqual([lista[2].stream_id, lista[3].stream_id]);
    });

    it('se a lista muda no meio da espera, o CH− seguinte parte do canal escolhido, não do índice velho', () => {
        const lista = canais(6);
        const { rerender } = render(<Pagina lista={lista} />);

        chMenos(); // alvo: Canal 2
        expect(alvo()).toBe('2Canal 2');
        // A playlist recarrega com um canal novo no topo: os índices andam um
        rerender(<Pagina lista={[{ stream_id: 999, num: 99, name: 'Novo' }, ...lista]} />);
        chMenos(true); // alvo: Canal 3 (o seguinte ao Canal 2, na lista nova)
        expect(alvo()).toBe('3Canal 3');
        passar(ESPERA_MS);

        expect(trocas).toEqual([lista[2].stream_id]);
    });

    it('se o canal-alvo some da lista no meio da espera, o CH− seguinte parte do canal que está tocando', () => {
        const lista = canais(6);
        const { rerender } = render(<Pagina lista={lista} inicial={lista[2].stream_id} />);

        chMenos(); // tocando o Canal 3; alvo: Canal 4
        expect(alvo()).toBe('4Canal 4');
        // A playlist recarrega SEM o Canal 4: o alvo pendente não existe mais
        rerender(<Pagina lista={lista.filter(c => c.stream_id !== lista[3].stream_id)} inicial={lista[2].stream_id} />);
        chMenos(true); // parte do Canal 3 (tocando): o seguinte na lista nova é o Canal 5
        expect(alvo()).toBe('5Canal 5');
        passar(ESPERA_MS);

        expect(trocas).toEqual([lista[4].stream_id]);
    });

    it('se o zapping deixa de valer no meio da espera (lista vazia), o banner do alvo sai da tela', () => {
        const props = {
            src: 'http://provedor.invalid/live/100.ts',
            title: 'Canal 1',
            isLive: true,
            contentType: 'live' as const,
            currentChannelId: 100,
            onSwitchChannel: (id: number) => { trocas.push(id); },
            onClose: () => {},
        };
        const { rerender } = render(<VideoPlayer {...props} channelList={canais(4)} />);

        chMenos();
        expect(alvo()).toBe('2Canal 2');
        rerender(<VideoPlayer {...props} channelList={[]} />);
        expect(alvo()).toBeNull();
    });

    it('digitar um número com a troca pendente cancela o CH−: vale só o número', () => {
        const lista = canais(8);
        render(<Pagina lista={lista} />);
        const espera = espiarEspera();

        chMenos(); // alvo: Canal 2
        const timer = espera.ultima();
        act(() => { fireEvent.keyDown(window, { key: '7', keyCode: 55 }); });
        expect(alvo()).toBeNull();
        expect(espera.desarmou(timer), 'o dígito não desarmou a espera do CH−').toBe(true);
        passar(ESPERA_MS);
        expect(trocas).toEqual([]);

        passar(1400); // o digit-jump assenta
        expect(trocas).toEqual([lista[6].stream_id]);
    });

    it('🔴 com a troca pendente desfaz o CH−: fica no canal que está tocando, sem troca nenhuma', () => {
        const lista = canais(8);
        // Histórico: o anterior ao Canal 1 (tocando) é o Canal 8
        zapHistory.push(lista[7].stream_id);
        zapHistory.push(lista[0].stream_id);
        render(<Pagina lista={lista} />);
        const espera = espiarEspera();

        chMenos(); // alvo: Canal 2
        const timer = espera.ultima();
        vermelho();
        expect(alvo()).toBeNull();
        expect(espera.desarmou(timer), 'o 🔴 não desarmou a espera do CH−').toBe(true);
        passar(10 * ESPERA_MS);
        expect(trocas).toEqual([]);

        // Sem nada pendente o 🔴 volta a ser "canal anterior"
        vermelho();
        expect(trocas).toEqual([lista[7].stream_id]);
    });

    it('fechar o player com a troca pendente desarma o timer', () => {
        const lista = canais(8);
        const { unmount } = render(<Pagina lista={lista} />);
        const espera = espiarEspera();

        chMenos();
        const timer = espera.ultima();

        unmount();
        expect(espera.desarmou(timer), 'fechar o player não desarmou a espera do CH−').toBe(true);
        passar(10 * ESPERA_MS);
        expect(trocas).toEqual([]);
    });
});
