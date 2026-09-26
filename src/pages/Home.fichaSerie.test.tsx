// @vitest-environment jsdom
//
// T133 (ajuste do cético) — a Home cravava `season ?? 1, episode ?? 1` ao
// tocar uma série pela ficha. A ficha hoje sempre manda os dois, mas o default
// era a próxima armadilha do mesmo defeito: só a temporada (onPlay(3)) virava
// "T3 E1"; a T3 de numeração corrida começa no E11, a fila não achava o E1 e
// caía no 1º episódio da SÉRIE (T2), não no da temporada pedida. Sem o
// default, a Home repassa como Séries, Minha Lista, Favoritos e a Busca já
// repassam, e a fila (buildEpisodeQueue) resolve.
//
// A Home e a fila de episódios são as de verdade; a ficha é trocada por uma
// que só chama o onPlay com os argumentos do teste (o que a Home faz com eles
// é o que está sob teste), e o player falso mostra o episódio da fila.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import type { Episode, Series, SeriesInfo } from '../types';
import { installFakeStorage } from '../testing/fakeStorage';
import { api } from '../services/api';
import { Home } from './Home';

// A Home só usa o `ContentDetailModal` deste módulo
vi.mock('../components/ContentDetailModal', () => ({
    ContentDetailModal: ({ contentType, onPlay }: {
        contentType: 'series' | 'movie';
        onPlay: (season?: number, episode?: number) => void;
    }) => (
        <div className="ficha-falsa" data-tipo={contentType}>
            <button className="so-temporada" onClick={() => onPlay(3)}>T3</button>
        </div>
    ),
}));
// ...só o `MoviePlayer` deste
vi.mock('../components/MoviePlayer', () => ({
    MoviePlayer: ({ title }: { title: string }) => <div className="player-falso">{title}</div>,
}));
// ...e só o `SeriesQueuePlayer` deste
vi.mock('../components/SeriesQueuePlayer', () => ({
    SeriesQueuePlayer: ({ queue }: {
        queue: { episodes: Array<{ season: number; episode: number }>; index: number };
    }) => {
        const ep = queue.episodes[queue.index];
        return <div className="player-falso">{`T${ep.season} E${ep.episode}`}</div>;
    },
}));

function tecla(keyCode: number): void {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '', keyCode, bubbles: true, cancelable: true }));
    });
}
const BAIXO = 40;
const OK = 13;

const SERIE = {
    series_id: 77, name: 'Série em Exibição', cover: 'capa.jpg', category_id: '1',
    last_modified: '1700000000', plot: '', genre: '', rating: '', release_date: '',
} as unknown as Series;

function episodio(temporada: number, n: number): Episode {
    return {
        id: `t${temporada}e${n}`, episode_num: n, title: `Episódio ${n}`, container_extension: 'mp4',
        info: { duration_secs: 1500, duration: '00:25:00', plot: '', releasedate: '', movie_image: '' },
        custom_sid: '', added: '', season: temporada, direct_source: '',
    };
}

/** Provedor que só manda a T2 e a T3, e a T3 em numeração corrida */
const INFO = {
    episodes: {
        '2': [episodio(2, 1), episodio(2, 2)],
        '3': [episodio(3, 11), episodio(3, 12)],
    },
    info: {},
    seasons: [],
} as unknown as SeriesInfo;

/**
 * O useTVNavigation registra o ouvinte de teclas num EFEITO, depois que a
 * tela é pintada: logo que o catálogo chega, o ouvinte em vigor ainda pode ser
 * o de ANTES dele (só contadores e acesso rápido: a ↓ pularia direto pro fim).
 * Cada registro anota se a tela já mostrava o card da série.
 */
let cardQuandoOuviu = false;
function anotarOuvintes(): void {
    const registrar = window.addEventListener;
    vi.spyOn(window, 'addEventListener').mockImplementation(function (
        this: Window, ...args: Parameters<typeof window.addEventListener>
    ) {
        if (args[0] === 'keydown') {
            cardQuandoOuviu = Array.from(document.querySelectorAll('.content-card .card-title'))
                .some(t => t.textContent?.trim() === SERIE.name);
        }
        return registrar.apply(this, args);
    } as typeof window.addEventListener);
}

const focado = () => document.querySelector('.tv-focused .card-title')?.textContent?.trim() ?? null;
const player = () => document.querySelector('.player-falso')?.textContent ?? null;

async function abrirFichaDaSerie(): Promise<void> {
    render(<Home onNavigate={() => {}} onRequestExit={() => {}} onCancelExit={() => {}} />);
    // O catálogo chegou, o card da série está na tela e o ouvinte de teclas
    // em vigor é o que já o viu
    await waitFor(() => expect(cardQuandoOuviu).toBe(true));

    // Desce até o primeiro card da série (a fileira em que ela cai depende do
    // sorteio das recomendações; o card é o mesmo título)
    for (let i = 0; i < 10 && focado() !== SERIE.name; i++) tecla(BAIXO);
    expect(focado()).toBe(SERIE.name);
    tecla(OK);
    await waitFor(() => expect(document.querySelector('.ficha-falsa')?.getAttribute('data-tipo')).toBe('series'));
}

beforeEach(() => {
    installFakeStorage();
    cardQuandoOuviu = false;
    anotarOuvintes();
    Element.prototype.scrollIntoView = function () { /* jsdom */ };
    vi.spyOn(api, 'getLiveStreams').mockResolvedValue([]);
    vi.spyOn(api, 'getVODStreams').mockResolvedValue([]);
    vi.spyOn(api, 'getSeries').mockResolvedValue([SERIE]);
    vi.spyOn(api, 'getSeriesInfo').mockResolvedValue(INFO);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Home — tocar série pela ficha sem inventar T1 E1', () => {
    it('só a temporada: toca o 1º episódio DELA (T3 E11), não o 1º da série', async () => {
        await abrirFichaDaSerie();
        act(() => { document.querySelector<HTMLButtonElement>('.so-temporada')!.click(); });
        await waitFor(() => expect(player()).not.toBeNull());
        expect(player()).toBe('T3 E11');
    });
});
