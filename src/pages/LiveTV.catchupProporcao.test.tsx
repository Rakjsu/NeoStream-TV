// @vitest-environment jsdom
//
// ⏮ A proporção escolhida no catch-up morria a cada programa (T005).
//
// A fila do arquivo REMONTA o VideoPlayer a cada programa (key com o início
// do programa) e o player de catch-up não recebia `contentKey`: sem chave, o
// VideoPlayer nem lê nem grava a proporção, então quem esticava um canal 4:3
// via a tarja preta voltar no programa seguinte — e de novo quando a fila
// alcança o programa no ar e devolve o usuário ao AO VIVO.
//
// A chave é a MESMA do ao vivo (`live-<stream_id>`): o arquivo é o sinal do
// mesmo canal, e o pause-live já toca o timeshift desse canal com essa chave.
//
// O teste monta a PÁGINA DE VERDADE com o VideoPlayer DE VERDADE e dirige
// pelo controle: ficha → ⏮ Reiniciar → botão de proporção → ⏮/⏭ da fila.
// Dublês: só a rede (login, lista de canais, guia).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, screen, fireEvent } from '@testing-library/react';
import { installFakeStorage } from '../testing/fakeStorage';
import { api } from '../services/api';
import { epgOffset } from '../services/epgService';
import { FocusContext } from '../contexts/FocusContext';
import type { LiveStream, Category } from '../types';
import { LiveTV } from './LiveTV';

const CANAL: LiveStream = {
    // num ≠ stream_id de propósito: a chave é o stream_id (a mesma do ao vivo),
    // não a posição do canal na lista do painel
    num: 42,
    name: 'Canal Um',
    stream_type: 'live',
    stream_id: 1,
    stream_icon: '',
    epg_channel_id: 'epg.1',
    added: '',
    category_id: '1',
    custom_sid: '',
    tv_archive: 1,
    direct_source: '',
    tv_archive_duration: 3,
};
const CATEGORIAS: Category[] = [{ category_id: '1', category_name: 'Variedades', parent_id: 0 }];

// 25/09/2026 20:10 (TZ dos testes: America/Sao_Paulo). No ar: o Jornal.
const AGORA = new Date(2026, 8, 25, 20, 10, 0).getTime();
const AS_19 = new Date(2026, 8, 25, 19, 0, 0).getTime();
const AS_20 = new Date(2026, 8, 25, 20, 0, 0).getTime();
const AS_21 = new Date(2026, 8, 25, 21, 0, 0).getTime();
const seg = (ms: number) => String(Math.round(ms / 1000));
const GUIA = {
    epg_listings: [
        { title: btoa('Novela'), description: '', start_timestamp: seg(AS_19), stop_timestamp: seg(AS_20), has_archive: 1 },
        { title: btoa('Jornal'), description: '', start_timestamp: seg(AS_20), stop_timestamp: seg(AS_21), has_archive: 1 },
    ],
};
const AO_VIVO = 'http://provedor.invalid/live/1.ts';

function tecla(key: string, keyCode?: number) {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }));
    });
}

/** Esvazia os efeitos pendentes: o ouvinte do useTVNavigation é re-registrado num efeito. */
async function assentar() {
    await act(async () => { await Promise.resolve(); });
}

/** O <video> do player na tela (só um player por vez na TV ao vivo). */
const video = () => document.querySelector('video.video-element');
const srcAtual = () => video()?.getAttribute('src') ?? '';
/** O título do player: o arquivo (.m3u8) não chega ao <video> no jsdom (sem MSE). */
const titulo = () => document.querySelector('.video-player-title')?.textContent ?? '';
function proporcao(): string | null {
    const m = video()?.className.match(/\baspect-(\w+)/);
    return m ? m[1] : null;
}
function trocarProporcao() {
    const botao = document.querySelector('button[title="Proporção"]');
    expect(botao, 'botão de proporção não está na tela').not.toBeNull();
    act(() => { fireEvent.click(botao!); });
}

/** OK no canal abre a ficha; → até o ⏮ Reiniciar; OK abre o arquivo do programa no ar. */
async function reiniciarPeloControle() {
    render(
        <FocusContext.Provider value={{ focusZone: 'content', setFocusZone: () => { /* não interessa */ } }}>
            <LiveTV />
        </FocusContext.Provider>
    );
    await screen.findByText('Canal Um');
    await assentar();
    tecla('Enter');
    await screen.findByText('⏮ Reiniciar');
    await assentar();
    const focado = () => document.querySelector('.preview-actions .tv-focused');
    for (let i = 0; i < 6 && focado()?.textContent?.trim() !== '⏮ Reiniciar'; i++) tecla('ArrowRight');
    expect(focado()?.textContent?.trim(), 'o ⏮ Reiniciar não é alcançável pelo D-pad na ficha').toBe('⏮ Reiniciar');
    tecla('Enter');
    await assentar();
    expect(titulo(), 'o arquivo do Jornal não abriu').toBe('⏮ Jornal — Canal Um');
}

beforeEach(async () => {
    installFakeStorage();
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
    // Login de verdade: ensina à getTimeshiftUrl o fuso do painel (o mesmo da TV)
    const login = { user_info: { auth: 1, status: 'Active' }, server_info: { timestamp_now: AGORA / 1000, time_now: '2026-09-25 20:10:00' } };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(login) })));
    await api.authenticate('http://provedor.invalid', 'usuario', 'senha');
    vi.unstubAllGlobals();
    vi.spyOn(api, 'getLiveStreams').mockResolvedValue([CANAL]);
    vi.spyOn(api, 'getLiveCategories').mockResolvedValue(CATEGORIAS);
    vi.spyOn(api, 'getLiveStreamUrl').mockImplementation(id => `http://provedor.invalid/live/${id}.ts`);
    vi.spyOn(api, 'getShortEpg').mockResolvedValue(GUIA);
    // jsdom não implementa mídia; o player só precisa que as chamadas existam.
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
});

afterEach(() => {
    cleanup();
    epgOffset.set(0);
    api.logout();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.playing;
});

describe('TV ao vivo: a proporção escolhida no catch-up', () => {
    it('sobrevive à troca de programa na fila e volta junto pro ao vivo do canal', async () => {
        await reiniciarPeloControle();
        expect(proporcao()).toBe('original');

        trocarProporcao();
        expect(proporcao()).toBe('stretch');

        // ⏮ do controle: programa anterior da fila — o player é REMONTADO
        tecla('MediaTrackPrevious', 10232);
        await assentar();
        expect(titulo(), 'a fila não voltou pra Novela').toBe('⏮ Novela — Canal Um');
        expect(proporcao()).toBe('stretch');

        // ⏭ do controle: o próximo é o Jornal, ainda no ar → a fila devolve ao ao vivo
        tecla('MediaTrackNext', 10233);
        await assentar();
        expect(srcAtual(), 'a fila não devolveu o usuário ao ao vivo').toBe(AO_VIVO);
        expect(proporcao()).toBe('stretch');
    });
});
