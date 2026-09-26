// @vitest-environment jsdom
//
// ⏰ Dava pra criar lembrete em três telas (guia 📊, agenda do canal e ⚽ Jogos
// de hoje) e em NENHUMA pra ver ou cancelar a lista.
//
// `reminderService.list()` não tinha um chamador de produto. O usuário marcava
// o jogo de sábado, o filme de domingo e três programas no guia e depois não
// havia lugar nenhum que dissesse o que estava marcado; pra cancelar era
// preciso voltar ao guia e achar de novo a MESMA célula (canal certo, janela
// de tempo certa) — ou seja, lembrar o horário que o lembrete devia lembrar.
//
// O teste monta a PÁGINA DE VERDADE. Só a rede (API/EPG) e o player são
// dublês — o player monta hls.js, que não é o assunto aqui. O painel é aberto
// pelo CONTROLE (↑ até o cabeçalho, → até o botão, OK), porque botão que só
// abre por mouse não existe numa TV.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, screen, waitFor } from '@testing-library/react';
import { installFakeStorage } from '../testing/fakeStorage';
import { api } from '../services/api';
import { epgService } from '../services/epgService';
import { reminderService } from '../services/reminderService';
import { FocusContext, type FocusZone } from '../contexts/FocusContext';
import type { LiveStream, Category } from '../types';

vi.mock('../components/VideoPlayer', () => ({
    VideoPlayer: (props: { title: string }) => <div data-testid="player">{props.title}</div>,
}));

import { LiveTV } from './LiveTV';

function canal(stream_id: number, name: string): LiveStream {
    return {
        num: stream_id,
        name,
        stream_type: 'live',
        stream_id,
        stream_icon: 'http://provedor.invalid/logo.png',
        epg_channel_id: `epg.${stream_id}`,
        added: '',
        category_id: '1',
        custom_sid: '',
        tv_archive: 0,
        direct_source: '',
        tv_archive_duration: 0,
    };
}

const CATEGORIAS: Category[] = [{ category_id: '1', category_name: 'Variedades', parent_id: 0 }];
const CANAIS = [canal(1, 'Canal Um'), canal(2, 'Canal Dois'), canal(3, 'Canal Três')];

const MIN = 60_000;

function lembrar(ch: LiveStream, programTitle: string, startMs: number) {
    reminderService.toggle({ streamId: ch.stream_id, channelName: ch.name, programTitle, startMs });
}

function relogio(ms: number): string {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function tecla(key: string) {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
}

/** Esvazia os efeitos pendentes: o ouvinte do useTVNavigation é re-registrado num efeito. */
async function assentar() {
    await act(async () => { await Promise.resolve(); });
}

function arvore(zona: FocusZone) {
    return (
        <FocusContext.Provider value={{ focusZone: zona, setFocusZone: () => { /* não interessa */ } }}>
            <LiveTV />
        </FocusContext.Provider>
    );
}

async function montarPagina(zona: FocusZone = 'content') {
    const r = render(arvore(zona));
    await screen.findByText('Canal Um');
    await assentar();
    return r;
}

const TITULO_DO_BOTAO = 'Meus lembretes';

/** ↑ sai da grade pro cabeçalho; → anda pela barra até o botão dos lembretes; OK abre. */
async function abrirLembretesPeloControle() {
    tecla('ArrowUp');
    const focado = () => document.querySelector('.livetv-toolbar .toolbar-btn.tv-focused');
    for (let i = 0; i < 15 && focado()?.getAttribute('title') !== TITULO_DO_BOTAO; i++) {
        tecla('ArrowRight');
    }
    expect(focado()?.getAttribute('title'), 'a barra da TV ao vivo não tem um botão "Meus lembretes" alcançável pelo D-pad')
        .toBe(TITULO_DO_BOTAO);
    tecla('Enter');
    await screen.findByText('⏰ Meus lembretes');
    await assentar();
}

const linhas = () => Array.from(document.querySelectorAll<HTMLElement>('.reminders-row'));
const titulos = () => linhas().map(l => l.querySelector('.reminders-program')?.textContent ?? '');
const linhaFocada = () => document.querySelector<HTMLElement>('.reminders-row.tv-focused');

beforeEach(() => {
    installFakeStorage();
    sessionStorage.clear();
    reminderService.reset();
    vi.spyOn(api, 'getLiveStreams').mockResolvedValue(CANAIS);
    vi.spyOn(api, 'getLiveCategories').mockResolvedValue(CATEGORIAS);
    vi.spyOn(api, 'getLiveStreamUrl').mockImplementation(id => `http://provedor.invalid/live/${id}.ts`);
    vi.spyOn(epgService, 'getChannelEpg').mockResolvedValue({ now: null, next: null, programs: [] });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    reminderService.reset();
    vi.restoreAllMocks();
});

describe('TV ao vivo: ⏰ Meus lembretes', () => {
    it('lista o que está marcado, do mais próximo ao mais distante, com canal, programa e horário', async () => {
        // Meio-dia fixo: "daqui a 30 min" rodado às 23:45 cairia amanhã e o
        // teste de "hoje mostra só a hora" viraria loteria
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 8, 25, 12, 0, 0));
        const agora = Date.now();
        const sabado = agora + 3 * 86_400_000;
        const logo = agora + 30 * MIN;
        const depois = agora + 3 * 60 * MIN;
        lembrar(CANAIS[2], 'Jogo de sábado', sabado);
        lembrar(CANAIS[0], 'Jornal', logo);
        lembrar(CANAIS[1], 'Filme da noite', depois);

        await montarPagina();
        await abrirLembretesPeloControle();

        expect(titulos()).toEqual(['Jornal', 'Filme da noite', 'Jogo de sábado']);
        const [primeira, , terceira] = linhas();
        const horario = (linha: HTMLElement) => linha.querySelector('.reminders-time')?.textContent;
        expect(primeira.textContent).toContain('Canal Um');
        // Hoje: só a hora
        expect(horario(primeira)).toBe(relogio(logo));
        expect(terceira.textContent).toContain('Canal Três');
        // Outro dia: só a hora mentiria ("21:00" de sábado lido como hoje)
        expect(horario(terceira)).toBe(`28/09 ${relogio(sabado)}`);
        expect(linhaFocada()).toBe(primeira);
    });

    it('o que passou da janela de limpeza não aparece: a lista não é histórico', async () => {
        const agora = Date.now();
        // Começou há 20 min: o init poda no boot, mas com o app aberto a sobra
        // continua guardada — a tela não pode mostrá-la como "NO AR"
        lembrar(CANAIS[0], 'Já acabou faz tempo', agora - 20 * MIN);
        lembrar(CANAIS[1], 'Começou agora', agora - 2 * MIN);
        lembrar(CANAIS[2], 'Mais tarde', agora + 60 * MIN);

        await montarPagina();
        await abrirLembretesPeloControle();

        expect(titulos()).toEqual(['Começou agora', 'Mais tarde']);
    });

    it('CH± pula uma página de lembretes, sem passar das pontas', async () => {
        const agora = Date.now();
        for (let i = 0; i < 12; i++) lembrar(CANAIS[i % 3], `Programa ${i + 1}`, agora + (i + 1) * 30 * MIN);

        await montarPagina();
        await abrirLembretesPeloControle();
        expect(linhaFocada()?.querySelector('.reminders-program')?.textContent).toBe('Programa 1');

        tecla('PageDown');
        expect(linhaFocada()?.querySelector('.reminders-program')?.textContent).toBe('Programa 11');
        tecla('PageDown');
        expect(linhaFocada()?.querySelector('.reminders-program')?.textContent).toBe('Programa 12');
        tecla('PageUp');
        expect(linhaFocada()?.querySelector('.reminders-program')?.textContent).toBe('Programa 2');
        tecla('PageUp');
        expect(linhaFocada()?.querySelector('.reminders-program')?.textContent).toBe('Programa 1');
        // Paginar não cancela nada
        expect(reminderService.list()).toHaveLength(12);
    });

    it('OK cancela o lembrete focado — some da tela E do serviço — e ↓ anda pela lista', async () => {
        const agora = Date.now();
        lembrar(CANAIS[0], 'Jornal', agora + 30 * MIN);
        lembrar(CANAIS[1], 'Filme da noite', agora + 90 * MIN);
        lembrar(CANAIS[2], 'Novela', agora + 150 * MIN);

        await montarPagina();
        await abrirLembretesPeloControle();

        tecla('ArrowDown');
        expect(linhaFocada()?.textContent).toContain('Filme da noite');
        tecla('Enter');

        expect(titulos()).toEqual(['Jornal', 'Novela']);
        expect(reminderService.list().map(r => r.programTitle).sort()).toEqual(['Jornal', 'Novela']);
        // O foco fica no vizinho, não salta pro topo
        expect(linhaFocada()?.textContent).toContain('Novela');
        // Cancelar não abre o player, e a página por baixo não ouviu as
        // mesmas teclas (↓ + OK nela abririam a ficha de um canal)
        expect(screen.queryByTestId('player')).toBeNull();
        expect(document.querySelector('.channel-preview')).toBeNull();
    });

    it('nas pontas o foco não some: ↑ no primeiro fica nele, e cancelar o último cai no novo último', async () => {
        const agora = Date.now();
        lembrar(CANAIS[0], 'Jornal', agora + 30 * MIN);
        lembrar(CANAIS[1], 'Filme da noite', agora + 90 * MIN);
        lembrar(CANAIS[2], 'Novela', agora + 150 * MIN);
        const programaFocado = () => linhaFocada()?.querySelector('.reminders-program')?.textContent;

        await montarPagina();
        await abrirLembretesPeloControle();

        // ↑ no topo: sem linha focada o OK seguinte não faria nada
        tecla('ArrowUp');
        expect(programaFocado()).toBe('Jornal');

        tecla('ArrowDown');
        tecla('ArrowDown');
        tecla('ArrowDown');
        expect(programaFocado()).toBe('Novela');

        // Cancelar o ÚLTIMO: não há vizinho de baixo, o foco sobe um
        tecla('Enter');
        expect(titulos()).toEqual(['Jornal', 'Filme da noite']);
        expect(programaFocado()).toBe('Filme da noite');

        // E o OK seguinte age no que está focado, sem precisar mexer a seta
        tecla('Enter');
        expect(titulos()).toEqual(['Jornal']);
        expect(programaFocado()).toBe('Jornal');
        expect(reminderService.list().map(r => r.programTitle)).toEqual(['Jornal']);
    });

    it('num programa que JÁ está no ar, OK assiste (e o lembrete sai da lista)', async () => {
        const agora = Date.now();
        lembrar(CANAIS[1], 'Começou há pouco', agora - 2 * MIN);
        lembrar(CANAIS[0], 'Mais tarde', agora + 60 * MIN);

        await montarPagina();
        await abrirLembretesPeloControle();

        expect(linhaFocada()?.textContent).toContain('Começou há pouco');
        expect(linhaFocada()?.textContent).toContain('NO AR');
        tecla('Enter');

        await waitFor(() => expect(screen.getByTestId('player').textContent).toBe('Canal Dois'));
        expect(screen.queryByText('⏰ Meus lembretes')).toBeNull();
        expect(reminderService.list().map(r => r.programTitle)).toEqual(['Mais tarde']);
    });

    it('no ar, mas o canal sumiu do catálogo: OK só cancela, sem player e sem fechar o painel', async () => {
        const agora = Date.now();
        // stream_id 99 não existe em CANAIS (o provedor tirou o canal)
        reminderService.toggle({ streamId: 99, channelName: 'Canal Extinto', programTitle: 'Órfão', startMs: agora - 2 * MIN });
        lembrar(CANAIS[0], 'Mais tarde', agora + 60 * MIN);

        await montarPagina();
        await abrirLembretesPeloControle();

        expect(linhaFocada()?.textContent).toContain('Órfão');
        expect(linhaFocada()?.textContent).toContain('NO AR');
        // O que ainda vai começar não leva o selo
        expect(linhas()[1].textContent).not.toContain('NO AR');
        tecla('Enter');

        expect(titulos()).toEqual(['Mais tarde']);
        expect(reminderService.list().map(r => r.programTitle)).toEqual(['Mais tarde']);
        expect(screen.queryByTestId('player')).toBeNull();
        expect(screen.getByText('⏰ Meus lembretes')).toBeTruthy();
    });

    it('o lembrete que dispara com o painel aberto sai da lista sozinho (estado vazio, sem travar)', async () => {
        await montarPagina();
        lembrar(CANAIS[0], 'Daqui a pouco', Date.now() + 90 * MIN);
        await abrirLembretesPeloControle();
        expect(titulos()).toEqual(['Daqui a pouco']);

        // Relógio controlado a partir daqui: reset() re-agenda com o setTimeout falso
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        reminderService.reset();
        act(() => { vi.advanceTimersByTime(90 * MIN); });

        expect(reminderService.list()).toEqual([]);
        expect(linhas()).toHaveLength(0);
        expect(screen.getByText(/Nenhum lembrete marcado/)).toBeTruthy();
        // Lista vazia: OK não quebra nem abre nada; Voltar ainda fecha
        tecla('Enter');
        expect(screen.queryByTestId('player')).toBeNull();
        tecla('Backspace');
        expect(screen.queryByText('⏰ Meus lembretes')).toBeNull();
    });

    it('Voltar fecha o painel, devolve o controle à página e desliga a inscrição no serviço', async () => {
        const inscricoes: Array<ReturnType<typeof vi.fn>> = [];
        const original = reminderService.subscribe.bind(reminderService);
        vi.spyOn(reminderService, 'subscribe').mockImplementation(ouvinte => {
            const cancelar = vi.fn(original(ouvinte));
            inscricoes.push(cancelar);
            return cancelar;
        });
        lembrar(CANAIS[0], 'Jornal', Date.now() + 30 * MIN);

        await montarPagina();
        await abrirLembretesPeloControle();
        expect(inscricoes.length).toBeGreaterThan(0);

        tecla('Backspace');
        expect(screen.queryByText('⏰ Meus lembretes')).toBeNull();
        for (const cancelar of inscricoes) expect(cancelar).toHaveBeenCalled();
        // Voltar NÃO cancelou nada
        expect(reminderService.list()).toHaveLength(1);

        // A página voltou a ouvir o controle: OK no botão focado reabre o painel
        await assentar();
        tecla('Enter');
        await screen.findByText('⏰ Meus lembretes');
    });

    it('com o aviso de lembrete do App por cima (zona "overlay"), o OK não cancela nada por baixo', async () => {
        lembrar(CANAIS[0], 'Jornal', Date.now() + 30 * MIN);
        const { rerender } = await montarPagina('content');
        await abrirLembretesPeloControle();

        // O App trocou a zona pra 'overlay': o OK é do aviso, não do painel
        rerender(arvore('overlay'));
        await assentar();
        tecla('Enter');
        expect(reminderService.list()).toHaveLength(1);
        expect(titulos()).toEqual(['Jornal']);

        rerender(arvore('content'));
        await assentar();
        tecla('Enter');
        expect(reminderService.list()).toHaveLength(0);
    });
});
