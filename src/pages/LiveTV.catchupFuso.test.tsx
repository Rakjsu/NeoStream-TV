// @vitest-environment jsdom
//
// ⏮ Com o "Ajuste de fuso do EPG" ligado, o catch-up tocava OUTRO programa.
//
// O ajuste existe porque o provedor erra o fuso dos timestamps do guia: o
// usuário diz "o guia está 2h atrasado" e o parse soma 2h a start E a end. A
// partir daí o app inteiro trata o horário corrigido como o relógio REAL:
// classify() decide o "NO AR" com ele contra Date.now(), a fila decide com ele
// quando volta ao vivo, os lembretes disparam nele, e o pause-live manda
// Date.now() puro pra MESMA getTimeshiftUrl. O arquivo do provedor foi gravado
// no relógio real — é lá que está o programa que foi ao ar às 20:00.
//
// Só a URL do catch-up "DES-ofsetava" o início (program.start - ajuste): com
// +2h, ⏮ Reiniciar no Jornal das 20:00 pedia o arquivo das 18:00 — dez
// minutos de outro programa, e a fila voltava ao vivo. Com ajuste negativo o
// início caía no FUTURO e o arquivo não tinha nada. A duração nunca esteve
// errada (start, end e Date.now() estão todos no mesmo relógio): o que estava
// errado era o ponto de partida.
//
// O teste monta a PÁGINA DE VERDADE, com o epgService de verdade (é o parse
// dele que aplica o ajuste), o login de verdade (é dele que o api aprende o
// fuso do PAINEL) e a getTimeshiftUrl de verdade (é ela que vira o instante em
// "YYYY-MM-DD:HH-MM" do painel). Dublês: a rede e o player — que só mostra a
// URL que recebeu e expõe o "anterior" da fila.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, screen } from '@testing-library/react';
import { installFakeStorage } from '../testing/fakeStorage';
import { api } from '../services/api';
import { epgOffset } from '../services/epgService';
import { FocusContext } from '../contexts/FocusContext';
import type { LiveStream, Category } from '../types';

vi.mock('../components/VideoPlayer', () => ({
    VideoPlayer: (props: { src: string; onPreviousEpisode?: () => void; canGoPrevious?: boolean }) => (
        <div>
            <div data-testid="player-src">{props.src}</div>
            {props.canGoPrevious && (
                <button data-testid="anterior" onClick={props.onPreviousEpisode}>anterior</button>
            )}
        </div>
    ),
}));

import { LiveTV } from './LiveTV';

const HORA = 60 * 60_000;

const CANAL: LiveStream = {
    num: 1,
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

// Relógio real da TV (TZ dos testes: America/Sao_Paulo, UTC-3): 25/09/2026
// 20:10:20. Os 20 s a mais são de propósito: do Jornal já há 10⅓ min
// gravados, e o pedido tem de arredondar pra CIMA (11) pra não cortar o fim;
// nem pra baixo nem pro inteiro mais perto (os dois dariam 10).
const AGORA = new Date(2026, 8, 25, 20, 10, 20).getTime();
// A Novela começa num quarto de hora de propósito: o início tem de chegar ao
// painel no minuto exato, não arredondado pra hora cheia.
const AS_19_15 = new Date(2026, 8, 25, 19, 15, 0).getTime();
const AS_20 = new Date(2026, 8, 25, 20, 0, 0).getTime();
const AS_21 = new Date(2026, 8, 25, 21, 0, 0).getTime();

/**
 * Guia como o PROVEDOR manda: horários verdadeiros deslocados de `erroHoras`
 * (o erro que o usuário corrige com ajuste = +erroHoras).
 */
function guiaDoProvedor(erroHoras: number) {
    const cru = (ms: number) => String(Math.round((ms - erroHoras * HORA) / 1000));
    return {
        epg_listings: [
            { title: btoa('Novela'), description: '', start_timestamp: cru(AS_19_15), stop_timestamp: cru(AS_20), has_archive: 1 },
            { title: btoa('Jornal'), description: '', start_timestamp: cru(AS_20), stop_timestamp: cru(AS_21), has_archive: 1 },
        ],
    };
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

/** OK no canal abre a ficha; → até o ⏮ Reiniciar (aparece quando o EPG chega); OK. */
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
    await screen.findByTestId('player-src');
}

const pedido = () => screen.getByTestId('player-src').textContent;
// O painel também está em São Paulo: o arquivo das 20:00 é "2026-09-25:20-00".
const arquivo = (duracaoMin: number, inicioNoPainel: string) =>
    `http://provedor.invalid/timeshift/usuario/senha/${duracaoMin}/${inicioNoPainel}/1.m3u8`;

beforeEach(async () => {
    installFakeStorage();
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
    // Login de verdade: o par time_now/timestamp_now ensina o fuso do painel
    // (UTC-3) à getTimeshiftUrl. Só o login passa pelo fetch falso.
    const login = { user_info: { auth: 1, status: 'Active' }, server_info: { timestamp_now: AGORA / 1000, time_now: '2026-09-25 20:10:20' } };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(login) })));
    await api.authenticate('http://provedor.invalid', 'usuario', 'senha');
    vi.unstubAllGlobals();
    vi.spyOn(api, 'getLiveStreams').mockResolvedValue([CANAL]);
    vi.spyOn(api, 'getLiveCategories').mockResolvedValue(CATEGORIAS);
    vi.spyOn(api, 'getLiveStreamUrl').mockImplementation(id => `http://provedor.invalid/live/${id}.ts`);
});

afterEach(() => {
    cleanup();
    // set() também esvazia o cache do EPG: o próximo teste parseia de novo
    epgOffset.set(0);
    api.logout();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('TV ao vivo: catch-up com o ajuste de fuso do EPG', () => {
    it('sem ajuste: ⏮ Reiniciar pede o arquivo desde o início do programa no ar, só o já gravado', async () => {
        epgOffset.set(0);
        vi.spyOn(api, 'getShortEpg').mockResolvedValue(guiaDoProvedor(0));

        await reiniciarPeloControle();

        expect(pedido()).toBe(arquivo(11, '2026-09-25:20-00'));
    });

    it('guia 2h atrasado corrigido com +2h: ⏮ Reiniciar pede as 20:00 de verdade, não as 18:00', async () => {
        epgOffset.set(2);
        vi.spyOn(api, 'getShortEpg').mockResolvedValue(guiaDoProvedor(2));

        await reiniciarPeloControle();

        // O "NO AR" da ficha é o Jornal das 20:00 — o mesmo instante tem de ir pro arquivo
        expect(screen.getAllByText('Jornal').length).toBeGreaterThan(0);
        expect(pedido()).toBe(arquivo(11, '2026-09-25:20-00'));
    });

    it('guia 3h adiantado corrigido com -3h: o início não cai no futuro (arquivo vazio)', async () => {
        epgOffset.set(-3);
        vi.spyOn(api, 'getShortEpg').mockResolvedValue(guiaDoProvedor(-3));

        await reiniciarPeloControle();

        expect(pedido()).toBe(arquivo(11, '2026-09-25:20-00'));
    });

    it('com +2h, voltar na fila pro programa anterior pede a Novela inteira, das 19:15 às 20:00', async () => {
        epgOffset.set(2);
        vi.spyOn(api, 'getShortEpg').mockResolvedValue(guiaDoProvedor(2));

        await reiniciarPeloControle();
        act(() => { screen.getByTestId('anterior').click(); });

        expect(pedido()).toBe(arquivo(45, '2026-09-25:19-15'));
    });
});
