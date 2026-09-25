// @vitest-environment jsdom
//
// ⏳ Linha da grade presa em "Carregando…" pelo resto da sessão.
//
// O efeito preguiçoso do EPG marcava a faixa inteira como "já buscada" ANTES
// de pedir qualquer coisa e só consumia a fila de 3 em 3. Quando a faixa
// visível mudava (um ↓ depois da 4ª linha) o cleanup cancelava a fila: o que
// ainda não tinha sido entregue ficava marcado como buscado e nenhuma rodada
// seguinte pedia de novo. Com o `StrictMode` do main.tsx era pior: monta →
// limpa → monta, e a segunda rodada achava tudo "buscado" — a grade nascia
// inteira em "Carregando…".
//
// Os testes montam a grade DE VERDADE e só trocam a rede: o getDayEpg fica
// preso num portão que o teste abre quando quer, que é exatamente a janela em
// que a pessoa rola a lista antes de o provedor responder.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { EpgGrid } from './EpgGrid';
import { epgService, type EpgProgram } from '../services/epgService';
import type { LiveStream } from '../types';

const canais = (quantos: number): LiveStream[] =>
    Array.from({ length: quantos }, (_, i) => ({
        num: i + 1,
        name: `Canal ${i + 1}`,
        stream_type: 'live',
        stream_id: i + 1,
        stream_icon: '',
        epg_channel_id: '',
        added: '0',
        category_id: '1',
        custom_sid: '',
        tv_archive: 0,
        direct_source: '',
        tv_archive_duration: 0,
    }) as unknown as LiveStream);

/** Um programa no ar agora, com o título carimbando o canal. */
const programaDe = (streamId: number): EpgProgram[] => {
    const agora = Date.now();
    return [{
        title: `Programa ${streamId}`,
        description: '',
        start: agora - 30 * 60 * 1000,
        end: agora + 60 * 60 * 1000,
    } as EpgProgram];
};

let liberar: () => void = () => { /* trocado no beforeEach */ };

beforeEach(() => {
    const portao = new Promise<void>(resolve => { liberar = resolve; });
    vi.spyOn(epgService, 'getDayEpg').mockImplementation(async (streamId: number) => {
        await portao;
        return programaDe(streamId);
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function montar(lista: LiveStream[], estrito = false) {
    const grade = (
        <EpgGrid
            channels={lista}
            initialChannelId={lista[0].stream_id}
            onClose={() => { /* não interessa */ }}
            onPlay={() => { /* não interessa */ }}
            onPlayArchive={() => { /* não interessa */ }}
            onToggleReminder={() => false}
            isReminded={() => false}
        />
    );
    return render(estrito ? <StrictMode>{grade}</StrictMode> : grade);
}

function apertar(key: 'ArrowDown' | 'ArrowUp', vezes = 1) {
    for (let i = 0; i < vezes; i++) {
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        });
    }
}

const pedidos = () => vi.mocked(epgService.getDayEpg).mock.calls.map(([id]) => id);
const linhas = () => Array.from(document.querySelectorAll<HTMLElement>('.epgrid-row'));
const nomeDa = (linha: HTMLElement) => linha.querySelector('.epgrid-channel-name')?.textContent ?? '';
const numeroDa = (linha: HTMLElement) => Number(nomeDa(linha).replace('Canal ', ''));

/** Espera a CONDIÇÃO: toda linha visível com o programa do próprio canal. */
async function esperarTudoCarregado() {
    await waitFor(() => {
        const visiveis = linhas();
        expect(visiveis.length).toBeGreaterThan(0);
        for (const linha of visiveis) {
            expect(linha.textContent, nomeDa(linha)).not.toContain('Carregando…');
            expect(linha.textContent, nomeDa(linha)).toContain(`Programa ${numeroDa(linha)}`);
        }
    });
}

describe('EpgGrid — EPG preguiçoso por linha visível', () => {
    it('rolar antes de o provedor responder não deixa linha presa em "Carregando…"', async () => {
        montar(canais(20));
        // Faixa 1..10 (7 visíveis + margem de 3): 1, 2 e 3 em voo, 4..10 na
        // fila. Quatro ↓ trocam a faixa (primeiraLinha 0 → 1, vai até o 11)
        // e o cleanup cancela a fila.
        apertar('ArrowDown', 4);
        act(() => liberar());

        await esperarTudoCarregado();
        // A faixa nova inteira foi pedida de fato...
        await waitFor(() => {
            for (let id = 1; id <= 11; id++) expect(pedidos()).toContain(id);
        });
        // ...e a fila cancelada PAROU: só o que já estava em voo quando a
        // faixa andou foi pedido duas vezes
        const repetidos = [...new Set(pedidos().filter((id, i, todos) => todos.indexOf(id) !== i))];
        expect(repetidos.sort((a, b) => a - b)).toEqual([1, 2, 3]);
    });

    it('fila cancelada no meio (parte já entregue) não deixa o resto preso em "Carregando…"', async () => {
        // Só os canais 1, 2 e 3 respondem; o resto fica preso no portão
        let liberarResto: () => void = () => { /* trocado abaixo */ };
        const resto = new Promise<void>(resolve => { liberarResto = resolve; });
        vi.mocked(epgService.getDayEpg).mockImplementation(async (streamId: number) => {
            if (streamId > 3) await resto;
            return programaDe(streamId);
        });
        montar(canais(20));
        // 1, 2 e 3 entregues; 4, 5 e 6 em voo; 7..10 na fila. Marcar
        // "buscado" só o que CHEGOU: uma entrega não pode dar a faixa inteira
        // da rodada por buscada.
        await waitFor(() => {
            for (let id = 4; id <= 6; id++) expect(pedidos()).toContain(id);
        });
        apertar('ArrowDown', 4);
        act(() => liberarResto());

        await esperarTudoCarregado();
        await waitFor(() => {
            for (let id = 1; id <= 11; id++) expect(pedidos()).toContain(id);
        });
        // O que já tinha chegado não volta a ser pedido
        expect(pedidos().filter(id => id <= 3).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    });

    it('com StrictMode (monta → limpa → monta) a grade não nasce inteira em "Carregando…"', async () => {
        montar(canais(20), true);
        act(() => liberar());
        await esperarTudoCarregado();
    });

    it('canal já entregue não é pedido de novo ao rolar dentro da margem', async () => {
        montar(canais(20));
        act(() => liberar());
        await esperarTudoCarregado();
        const antes = pedidos().length;
        expect(antes).toBe(10); // 7 visíveis + margem de 3

        apertar('ArrowDown', 4); // faixa passa a ir até o canal 11: só ele é novo
        await esperarTudoCarregado();
        await waitFor(() => expect(pedidos()).toContain(11));
        expect(pedidos().slice(antes)).toEqual([11]);
    });

    it('descer a lista inteira e voltar recarrega o que o teto de memória podou', async () => {
        const lista = canais(70); // passa do teto de 40 canais em memória
        montar(lista);
        act(() => liberar());
        await esperarTudoCarregado();

        for (let i = 0; i < lista.length; i++) {
            apertar('ArrowDown');
            await esperarTudoCarregado();
        }
        for (let i = 0; i < lista.length; i++) {
            apertar('ArrowUp');
            await esperarTudoCarregado();
        }
        expect(nomeDa(linhas()[0])).toBe('Canal 1');
        // O canal 1 foi podado lá embaixo e pedido de novo na volta
        expect(pedidos().filter(id => id === 1)).toHaveLength(2);
    });
});
