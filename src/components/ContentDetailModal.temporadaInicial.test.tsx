// @vitest-environment jsdom
//
// 📺 A ficha de série abria SEMPRE em T1 E1 (T133).
//
// Sem progresso salvo, o fetch da série cravava `setSelectedSeason(1)` e
// `setSelectedEpisode(1)` sem olhar o que o provedor mandou. Provedor que só
// carrega as temporadas correntes (série em exibição) devolve `episodes` com
// as chaves "2" e "3": a ficha mostrava as abas T2 e T3 SEM nenhuma ativa, a
// lista de episódios saía VAZIA, o botão prometia "Assistir T1 E1" e a seta ↓
// ficava morta (a aresta play → episódio exige lista não vazia).
//
// O mesmo 1 cravado vivia na troca de temporada (OK na aba e clique na aba):
// temporada que começa no E11 (numeração corrida) prometia "Assistir T2 E1",
// um episódio que não existe.
//
// O teste é o componente de verdade: só a rede (painel e TMDB) é substituída,
// e o que se confere é o que se LÊ na tela e o que o OK entrega ao onPlay.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import type { Episode, SeriesInfo } from '../types';
import { installFakeStorage } from '../testing/fakeStorage';

vi.mock('../services/tmdb', async (importOriginal) => {
    const original = await importOriginal<typeof import('../services/tmdb')>();
    return {
        ...original,
        searchMovieByName: vi.fn(async () => null),
        searchSeriesByName: vi.fn(async () => null),
        fetchSeriesDetails: vi.fn(async () => null),
        fetchMovieDetails: vi.fn(async () => null),
        fetchColecao: vi.fn(async () => null),
    };
});

import { api } from '../services/api';
import { progressService } from '../services/progressService';
import { ContentDetailModal } from './ContentDetailModal';

/** Tecla como a TV dispara (keyCode; o `key` vem vazio no Tizen). */
function tecla(keyCode: number): void {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '', keyCode, bubbles: true, cancelable: true }));
    });
}
const CIMA = 38;
const BAIXO = 40;
const DIREITA = 39;
const OK = 13;

function episodio(temporada: number, n: number): Episode {
    return {
        id: `t${temporada}e${n}`, episode_num: n, title: `Episódio ${n}`, container_extension: 'mp4',
        info: {
            duration_secs: 1500, duration: '00:25:00', plot: '', releasedate: '', movie_image: '',
        },
        custom_sid: '', added: '', season: temporada, direct_source: '',
    };
}

/** { "2": [1, 2, 3] } → a resposta do get_series_info com esses episódios */
function serie(temporadas: Record<string, number[]>): SeriesInfo {
    const episodes: Record<string, Episode[]> = {};
    for (const [t, nums] of Object.entries(temporadas)) {
        episodes[t] = nums.map(n => episodio(Number(t), n));
    }
    return { episodes, info: {}, seasons: [] } as unknown as SeriesInfo;
}

const abaAtiva = () => document.querySelector('.season-tab.active')?.textContent?.trim() ?? null;
const botaoAssistir = () => document.querySelector('.play-btn')?.textContent?.replace('▶', '').trim() ?? null;
const episodiosNaLista = () => Array.from(document.querySelectorAll('.episode-item .episode-number'))
    .map(n => Number(n.textContent));
const episodioSelecionado = () => Number(document.querySelector('.episode-item.selected .episode-number')?.textContent ?? NaN);
const episodioFocado = () => Number(document.querySelector('.episode-item.focused .episode-number')?.textContent ?? NaN);

/**
 * O useTVNavigation registra o ouvinte de teclas num EFEITO, depois que a
 * tela é pintada: logo que a resposta do painel aparece, o ouvinte em vigor
 * ainda pode ser o de ANTES dela (sem abas, sem episódios). Cada registro
 * anota quantas abas a tela mostrava, e a primeira tecla só sai quando o
 * ouvinte em vigor já viu as abas.
 */
let abasQuandoOuviu = -1;
function anotarOuvintes(): void {
    const registrar = window.addEventListener;
    vi.spyOn(window, 'addEventListener').mockImplementation(function (
        this: Window, ...args: Parameters<typeof window.addEventListener>
    ) {
        if (args[0] === 'keydown') abasQuandoOuviu = document.querySelectorAll('.season-tab').length;
        return registrar.apply(this, args);
    } as typeof window.addEventListener);
}

async function abrirSerie(info: SeriesInfo, onPlay = vi.fn()) {
    vi.spyOn(api, 'getSeriesInfo').mockResolvedValue(info);
    render(
        <ContentDetailModal
            isOpen
            onClose={() => {}}
            contentId="77"
            contentType="series"
            contentData={{ name: 'Série de Teste', cover: 'http://img.test/capa.jpg' }}
            onPlay={onPlay}
        />
    );
    // A resposta do painel chega, as abas são pintadas (só depois do
    // `finally` do fetch: a escolha da temporada já foi feita) e o ouvinte de
    // teclas em vigor é o que já as viu
    await waitFor(() => expect(abasQuandoOuviu).toBeGreaterThan(0));
    return onPlay;
}

beforeAll(() => {
    // jsdom não implementa scrollIntoView, e a ficha chama ao mover o foco
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
});

beforeEach(() => {
    installFakeStorage();
    abasQuandoOuviu = -1;
    anotarOuvintes();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ficha de série sem progresso — abre no que o provedor mandou', () => {
    it('provedor sem T1 (só T2 e T3): abre na T2, com a lista cheia, ↓ vivo e o OK tocando T2 E1', async () => {
        const onPlay = await abrirSerie(serie({ '2': [1, 2, 3], '3': [1, 2] }));

        await waitFor(() => expect(abaAtiva()).toBe('T2'));
        expect(episodiosNaLista()).toEqual([1, 2, 3]);
        expect(episodioSelecionado()).toBe(1);
        expect(botaoAssistir()).toBe('Assistir T2 E1');

        // A aresta play → episódio existe (a lista não está vazia)
        tecla(BAIXO);
        expect(episodioFocado()).toBe(1);

        // OK no episódio toca exatamente o que está na tela
        tecla(OK);
        expect(onPlay).toHaveBeenLastCalledWith(2, 1);
    });

    it('o botão Assistir entrega a temporada e o episódio que ele promete', async () => {
        const onPlay = await abrirSerie(serie({ '3': [4, 5], '4': [1] }));
        await waitFor(() => expect(botaoAssistir()).toBe('Assistir T3 E4'));

        tecla(OK); // o foco nasce no Assistir
        expect(onPlay).toHaveBeenLastCalledWith(3, 4);
    });

    it('temporada que não começa no E1 (numeração corrida): promete e toca o primeiro episódio dela', async () => {
        const onPlay = await abrirSerie(serie({ '1': [5, 6, 7] }));

        await waitFor(() => expect(abaAtiva()).toBe('T1'));
        expect(episodioSelecionado()).toBe(5);
        expect(botaoAssistir()).toBe('Assistir T1 E5');

        tecla(OK);
        expect(onPlay).toHaveBeenLastCalledWith(1, 5);
    });

    it('especiais (T0) não roubam a abertura quando existe temporada regular', async () => {
        await abrirSerie(serie({ '0': [1], '2': [1, 2] }));

        await waitFor(() => expect(abaAtiva()).toBe('T2'));
        expect(botaoAssistir()).toBe('Assistir T2 E1');
        // O realce do D-pad nas abas nasce na aba ativa (a 2ª: T0, T2)
        tecla(CIMA);
        const abas = Array.from(document.querySelectorAll('.season-tab'));
        expect(abas.map(a => a.textContent?.trim())).toEqual(['T0', 'T2']);
        expect(abas.findIndex(a => a.classList.contains('focused'))).toBe(1);
    });

    it('painel que manda as temporadas fora de ordem ("3" antes de "2"): abre na menor, com o realce na aba dela', async () => {
        // O texto cru da resposta, na ordem do painel (o JSON.parse é o mesmo
        // que a api usa): a abertura não depende da ordem em que as chaves chegam
        const cru = `{"episodes":{"3":${JSON.stringify([episodio(3, 1)])},"2":${JSON.stringify([episodio(2, 7), episodio(2, 8)])}},"info":{},"seasons":[]}`;
        await abrirSerie(JSON.parse(cru) as SeriesInfo);

        await waitFor(() => expect(abaAtiva()).toBe('T2'));
        expect(botaoAssistir()).toBe('Assistir T2 E7');
        tecla(CIMA);
        const abas = Array.from(document.querySelectorAll('.season-tab'));
        expect(abas.map(a => a.textContent?.trim())).toEqual(['T2', 'T3']);
        expect(abas.findIndex(a => a.classList.contains('focused'))).toBe(0);
    });

    it('série só com especiais abre na T0', async () => {
        await abrirSerie(serie({ '0': [1, 2] }));
        await waitFor(() => expect(abaAtiva()).toBe('T0'));
        expect(botaoAssistir()).toBe('Assistir T0 E1');
    });

    it('com especiais na frente, o episódio prometido é o da temporada aberta, não o 1º dos especiais', async () => {
        // T0 começa no E1 e a T2 (numeração corrida) no E11: o episódio tem de
        // vir da MESMA temporada que abriu, não da primeira chave do painel
        const onPlay = await abrirSerie(serie({ '0': [1, 2], '2': [11, 12] }));

        await waitFor(() => expect(abaAtiva()).toBe('T2'));
        expect(episodioSelecionado()).toBe(11);
        expect(botaoAssistir()).toBe('Assistir T2 E11');
        tecla(OK);
        expect(onPlay).toHaveBeenLastCalledWith(2, 11);
    });

    it('temporada que veio sem episódios: o botão promete E1, como antes (nem E0, nem ENaN)', async () => {
        await abrirSerie(serie({ '2': [], '3': [4] }));

        await waitFor(() => expect(abaAtiva()).toBe('T2'));
        expect(episodiosNaLista()).toEqual([]);
        expect(botaoAssistir()).toBe('Assistir T2 E1');
    });
});

describe('trocar de temporada escolhe o primeiro episódio DELA', () => {
    it('pelo D-pad: OK na aba T2 (que começa no E11) promete T2 E11', async () => {
        const onPlay = await abrirSerie(serie({ '1': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '2': [11, 12] }));
        await waitFor(() => expect(abaAtiva()).toBe('T1'));

        tecla(CIMA);     // play → abas
        tecla(DIREITA);  // T1 → T2
        tecla(OK);       // seleciona T2

        expect(abaAtiva()).toBe('T2');
        expect(episodiosNaLista()).toEqual([11, 12]);
        expect(episodioSelecionado()).toBe(11);
        expect(botaoAssistir()).toBe('Assistir T2 E11');

        tecla(BAIXO);    // abas → episódios
        expect(episodioFocado()).toBe(11);
        tecla(OK);
        expect(onPlay).toHaveBeenLastCalledWith(2, 11);
    });

    it('pelo clique na aba (navegador): também promete o primeiro episódio da temporada', async () => {
        await abrirSerie(serie({ '1': [1, 2], '2': [11, 12] }));
        await waitFor(() => expect(abaAtiva()).toBe('T1'));

        const abaT2 = Array.from(document.querySelectorAll<HTMLButtonElement>('.season-tab'))
            .find(a => a.textContent?.trim() === 'T2')!;
        act(() => { abaT2.click(); });

        expect(abaAtiva()).toBe('T2');
        expect(episodioSelecionado()).toBe(11);
        expect(botaoAssistir()).toBe('Assistir T2 E11');
    });
});

describe('progresso salvo continua mandando', () => {
    it('quem parou na T3 E2 reabre em T3 E2, mesmo sem T1 no provedor', async () => {
        progressService.saveSeries({
            seriesId: '77', seriesName: 'Série de Teste', poster: '', season: 3, episode: 2,
            episodeId: 't3e2', time: 600, duration: 2700,
        });
        const onPlay = await abrirSerie(serie({ '2': [1, 2], '3': [1, 2, 3] }));

        await waitFor(() => expect(abaAtiva()).toBe('T3'));
        expect(botaoAssistir()).toBe('Assistir T3 E2');
        tecla(OK);
        expect(onPlay).toHaveBeenLastCalledWith(3, 2);
    });
});
