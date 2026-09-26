// @vitest-environment jsdom
//
// 📺 CH+/CH− paginam o guia, a agenda do dia e os painéis da TV ao vivo.
//
// As duas teclas já chegam ao web app na TV real (App.tsx registra
// 'ChannelUp'/'ChannelDown' no tvinputdevice; chegam como keyCode 427/428),
// e o player e a grade de filmes já as usam. No guia de programação — 7
// linhas sobre centenas de canais — ninguém as escutava: a única forma de
// descer era ↓ de um em um, 180 toques até o canal 180.
//
// Os testes montam os componentes DE VERDADE e disparam a tecla como a TV
// dispara (`key` inútil, `keyCode` verdadeiro), olhando qual linha acende.
// A tradução tecla → onPage (todos os nomes e códigos, o opt-in que deixa o
// CH± do player e dos filmes em paz) está em hooks/useTVNavigation.test.tsx.
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { EpgGrid } from './EpgGrid';
import { ChannelAgendaOverlay } from './ChannelAgendaOverlay';
import { FavoritesNowPanel, SportsPanel } from './LivePanels';
import { epgService, type EpgProgram } from '../services/epgService';
import type { LiveStream } from '../types';

/**
 * Os dados dos paineis chegam num microtask FORA do act: o DOM ja mostra o
 * item focado, mas o efeito que re-registra o ouvinte do useTVNavigation com a
 * lista nova pode nao ter rodado — e um CH± nesse intervalo caia no ouvinte
 * velho, de lista vazia (falhava ~1 vez em 10). Esvazia os efeitos antes de apertar.
 */
const esvaziarEfeitos = () => act(async () => { await Promise.resolve(); });

beforeAll(() => {
    // jsdom não implementa scrollIntoView; agenda e painéis chamam a cada foco
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const canais = (quantos: number): LiveStream[] =>
    Array.from({ length: quantos }, (_, i) => ({
        num: i + 1,
        name: `Canal ${i + 1}`,
        stream_type: 'live',
        stream_id: 1000 + i,
        stream_icon: '',
        epg_channel_id: '',
        added: '',
        category_id: '1',
        custom_sid: '',
        tv_archive: 0,
        direct_source: '',
        tv_archive_duration: 0,
    }));

/** Promessa que nunca resolve: o EPG "carregando" não mexe em state no meio do teste. */
const nunca = <T,>() => new Promise<T>(() => { /* pendente de propósito */ });

/** Tecla como a TV manda: `key` e `keyCode` (um dos dois pode vir inútil). */
function tecla(key: string, keyCode: number): KeyboardEvent {
    const evento = new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(evento); });
    return evento;
}
/** Samsung real: `key` chega 'Unidentified' e quem diz a tecla é o keyCode. */
const chMenos = () => tecla('Unidentified', 428);
const chMais = () => tecla('Unidentified', 427);

const texto = (raiz: HTMLElement, seletor: string) =>
    raiz.querySelector(seletor)?.textContent ?? null;

describe('guia de programação (EpgGrid)', () => {
    const linhaFocada = (raiz: HTMLElement) =>
        texto(raiz, '.epgrid-row.is-focused-row .epgrid-channel-name');

    function abrirGuia(quantos: number) {
        vi.spyOn(epgService, 'getDayEpg').mockImplementation(() => nunca<EpgProgram[]>());
        return render(
            <EpgGrid
                channels={canais(quantos)}
                onClose={vi.fn()}
                onPlay={vi.fn()}
                onPlayArchive={vi.fn()}
                onToggleReminder={vi.fn(() => false)}
                isReminded={() => false}
            />
        );
    }

    it('CH− desce uma tela inteira (7 linhas) e CH+ volta', () => {
        const { container } = abrirGuia(200);
        expect(linhaFocada(container)).toBe('Canal 1');

        const evento = chMenos();
        expect(linhaFocada(container)).toBe('Canal 8');
        // Consumida: a página não rola por baixo do guia
        expect(evento.defaultPrevented).toBe(true);

        chMenos();
        expect(linhaFocada(container)).toBe('Canal 15');

        chMais();
        expect(linhaFocada(container)).toBe('Canal 8');
        expect(container.textContent).toContain('CH± Página');
    });

    it('chegar ao canal 180 deixa de custar 180 toques', () => {
        const { container } = abrirGuia(200);
        for (let i = 0; i < 25; i++) chMenos();
        // 25 × 7 = 175 → índice 175 = "Canal 176": 25 toques + 4 setas
        expect(linhaFocada(container)).toBe('Canal 176');
    });

    it('para nas pontas da lista (sem sair dela nem dar a volta)', () => {
        const { container } = abrirGuia(20);
        for (let i = 0; i < 5; i++) chMenos();
        expect(linhaFocada(container)).toBe('Canal 20');
        for (let i = 0; i < 5; i++) chMais();
        expect(linhaFocada(container)).toBe('Canal 1');
    });

    it.each([
        ['só o nome que o Tizen emite (ChannelDown)', 'ChannelDown', 0],
        ['PageDown do teclado', 'PageDown', 34],
        ['só o keyCode do PageDown (34)', '', 34],
    ])('%s também pagina', (_caso, key, keyCode) => {
        const { container } = abrirGuia(50);
        tecla(key, keyCode);
        expect(linhaFocada(container)).toBe('Canal 8');
    });

    it('paginar apaga o aviso da linha anterior, como o ↑↓', async () => {
        const agora = Date.now();
        // Só um programa, no futuro e dentro da janela: o OK vira lembrete
        const futuro: EpgProgram = {
            title: 'Mais tarde', description: '',
            start: agora + 5 * 60 * 1000, end: agora + 60 * 60 * 1000,
        };
        vi.spyOn(epgService, 'getDayEpg').mockResolvedValue([futuro]);
        const { container } = render(
            <EpgGrid
                channels={canais(50)}
                onClose={vi.fn()}
                onPlay={vi.fn()}
                onPlayArchive={vi.fn()}
                onToggleReminder={vi.fn(() => false)}
                isReminded={() => false}
            />
        );
        await waitFor(() => expect(texto(container, '.epgrid-prog.tv-focused .epgrid-prog-title')).toBe('Mais tarde'));
        await esvaziarEfeitos();

        tecla('Enter', 13);
        expect(texto(container, '.epgrid-aviso')).toBe('Lembrete removido.');

        chMenos();
        expect(linhaFocada(container)).toBe('Canal 8');
        expect(container.querySelector('.epgrid-aviso')).toBeNull();
    });

    it('paginar mantém o horário focado, como o ↑↓ (não volta pro "agora")', async () => {
        const agora = Date.now();
        const min = 60 * 1000;
        // A mesma grade em todo canal: um no ar e dois depois
        const grade: EpgProgram[] = [
            { title: 'No ar', description: '', start: agora - 10 * min, end: agora + 20 * min },
            { title: 'Depois', description: '', start: agora + 20 * min, end: agora + 50 * min },
            { title: 'Mais depois', description: '', start: agora + 50 * min, end: agora + 80 * min },
        ];
        const busca = vi.spyOn(epgService, 'getDayEpg').mockResolvedValue(grade);
        const { container } = render(
            <EpgGrid
                channels={canais(50)}
                onClose={vi.fn()}
                onPlay={vi.fn()}
                onPlayArchive={vi.fn()}
                onToggleReminder={vi.fn(() => false)}
                isReminded={() => false}
            />
        );
        const programaFocado = () => texto(container, '.epgrid-prog.tv-focused .epgrid-prog-title');
        // Espera a 1ª leva (linhas 0..9) chegar inteira antes de paginar
        await waitFor(() => expect(busca).toHaveBeenCalledTimes(10));
        await waitFor(() => expect(programaFocado()).toBe('No ar'));
        await esvaziarEfeitos();

        tecla('ArrowRight', 39);
        expect(programaFocado()).toBe('Depois');

        chMenos();
        expect(linhaFocada(container)).toBe('Canal 8');
        await waitFor(() => expect(programaFocado()).toBe('Depois'));
        await esvaziarEfeitos();
        chMais();
        expect(linhaFocada(container)).toBe('Canal 1');
        expect(programaFocado()).toBe('Depois');
    });

    it('fechar o guia desarma a escuta: CH− depois disso não é consumido', () => {
        const { unmount } = abrirGuia(50);
        unmount();
        expect(chMenos().defaultPrevented).toBe(false);
    });
});

describe('agenda do dia (ChannelAgendaOverlay)', () => {
    const focado = (raiz: HTMLElement) => texto(raiz, '.agenda-item.tv-focused .agenda-name');

    it('CH−/CH+ pulam 10 programas, com parada nas pontas', async () => {
        const agora = Date.now();
        const meiaHora = 30 * 60 * 1000;
        // O 1º está NO AR (a agenda nasce focada nele); os outros vêm depois
        const programas: EpgProgram[] = Array.from({ length: 30 }, (_, i) => ({
            title: `Programa ${i + 1}`,
            description: '',
            start: agora - 10 * 60 * 1000 + i * meiaHora,
            end: agora - 10 * 60 * 1000 + (i + 1) * meiaHora,
        }));
        vi.spyOn(epgService, 'getDayEpg').mockResolvedValue(programas);

        const { container } = render(
            <ChannelAgendaOverlay channel={canais(1)[0]} onClose={vi.fn()} onPlayArchive={vi.fn()} />
        );
        await waitFor(() => expect(focado(container)).toBe('Programa 1'));
        await esvaziarEfeitos();
        chMais(); // já no topo: fica
        expect(focado(container)).toBe('Programa 1');

        chMenos();
        expect(focado(container)).toBe('Programa 11');
        chMenos();
        chMenos();
        expect(focado(container)).toBe('Programa 30');
        chMais();
        expect(focado(container)).toBe('Programa 20');
        expect(container.textContent).toContain('CH± Página');
    });

    it('CH± enquanto a agenda ainda carrega não derruba a tela', async () => {
        const agora = Date.now();
        let entregar: (lista: EpgProgram[]) => void = () => { /* definido abaixo */ };
        vi.spyOn(epgService, 'getDayEpg').mockImplementation(
            () => new Promise<EpgProgram[]>(resolve => { entregar = resolve; })
        );
        const { container } = render(
            <ChannelAgendaOverlay channel={canais(1)[0]} onClose={vi.fn()} onPlayArchive={vi.fn()} />
        );
        // Ainda sem lista: a tecla não tem onde pular
        chMenos();
        chMais();

        const programas: EpgProgram[] = Array.from({ length: 12 }, (_, i) => ({
            title: `Programa ${i + 1}`,
            description: '',
            start: agora - 10 * 60 * 1000 + i * 30 * 60 * 1000,
            end: agora + 20 * 60 * 1000 + i * 30 * 60 * 1000,
        }));
        await act(async () => { entregar(programas); });
        await waitFor(() => expect(focado(container)).toBe('Programa 1'));
        await esvaziarEfeitos();
        chMenos();
        expect(focado(container)).toBe('Programa 11');
    });
});

describe('painéis da TV ao vivo', () => {
    it('⭐ Agora nos favoritos: CH± pulam 10 canais', () => {
        vi.spyOn(epgService, 'getChannelEpg').mockImplementation(() => nunca());
        const { container } = render(
            <FavoritesNowPanel channels={canais(20)} onClose={vi.fn()} onPlay={vi.fn()} />
        );
        const focado = () => texto(container, '.fav-now-row.tv-focused .fav-now-name');
        expect(focado()).toBe('Canal 1');
        chMais(); // já no topo: fica
        expect(focado()).toBe('Canal 1');

        chMenos();
        expect(focado()).toBe('Canal 11');
        chMenos();
        expect(focado()).toBe('Canal 20');
        chMais();
        expect(focado()).toBe('Canal 10');
        expect(container.textContent).toContain('CH± Página');
    });

    it('⚽ Jogos de hoje: CH± pulam 10 jogos', async () => {
        const agora = Date.now();
        vi.spyOn(epgService, 'getChannelEpg').mockImplementation(async (streamId: number) => {
            const n = streamId - 1000;
            const jogo: EpgProgram = {
                title: `Time ${n} x Rival ${n}`,
                description: '',
                start: agora,
                end: agora + 60 * 60 * 1000,
            };
            return { now: jogo, next: null, programs: [jogo] };
        });
        const { container } = render(
            <SportsPanel
                channels={canais(25)}
                onClose={vi.fn()}
                onPlay={vi.fn()}
                onRemind={vi.fn()}
                isReminded={() => false}
            />
        );
        const focado = () => texto(container, '.sports-row.tv-focused .sports-title');
        await waitFor(() => expect(focado()).toBe('Time 0 x Rival 0'));
        await esvaziarEfeitos();
        chMais(); // já no topo: fica
        expect(focado()).toBe('Time 0 x Rival 0');

        chMenos();
        expect(focado()).toBe('Time 10 x Rival 10');
        chMenos();
        chMenos();
        expect(focado()).toBe('Time 24 x Rival 24');
        chMais();
        expect(focado()).toBe('Time 14 x Rival 14');
        expect(container.textContent).toContain('CH± Página');
    });
});
