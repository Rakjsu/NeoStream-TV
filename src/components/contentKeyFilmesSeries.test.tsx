// @vitest-environment jsdom
//
// 🎞️ Proporção e qualidade lembradas em filmes e séries (T005).
//
// O VideoPlayer só lembra a proporção (aspectPrefs) e a qualidade manual
// (qualityByContent) quando recebe `contentKey` — e só o ao vivo passava. No
// SeriesQueuePlayer o player é REMONTADO a cada episódio (key={ep.id}), então
// quem esticava uma série 4:3 numa TV 16:9 via a tarja preta voltar em TODO
// episódio; no filme, a escolha morria ao fechar e reabrir.
//
// Os testes montam o MoviePlayer e o SeriesQueuePlayer DE VERDADE, com o
// VideoPlayer real dentro, e usam os botões do player como o controle usaria.
// Único dublê: os níveis de qualidade. O jsdom não tem MSE, então o hls.js
// nunca anuncia níveis; o useHls de verdade roda e só `qualityLevels` e
// `setQuality` são trocados (é por eles que a preferência entra e sai).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { installFakeStorage } from '../testing/fakeStorage';
import { MoviePlayer } from './MoviePlayer';
import { SeriesQueuePlayer } from './SeriesQueuePlayer';
import type { EpisodeQueue } from '../services/seriesPlayback';
import type { QualityLevel } from '../hooks/useHls';

const hls = vi.hoisted(() => ({
    // Referências ESTÁVEIS: o efeito que reaplica a qualidade depende delas
    niveis: [
        { index: 0, height: 480, width: 854, bitrate: 1_500_000, label: '480p' },
        { index: 1, height: 720, width: 1280, bitrate: 3_000_000, label: '720p' },
        { index: 2, height: 1080, width: 1920, bitrate: 6_000_000, label: '1080p' },
    ] as QualityLevel[],
    setQuality: undefined as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('../hooks/useHls', async (importOriginal) => {
    const real = await importOriginal<typeof import('../hooks/useHls')>();
    return {
        ...real,
        useHls: (opcoes: Parameters<typeof real.useHls>[0]) => ({
            ...real.useHls(opcoes),
            qualityLevels: hls.niveis,
            setQuality: hls.setQuality,
        }),
    };
});

beforeEach(() => {
    installFakeStorage();
    hls.setQuality = vi.fn();
    // jsdom não implementa mídia; o player só precisa que as chamadas existam.
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.playing;
});

/** A proporção aplicada no <video> (classe aspect-*). */
function proporcao(): string | null {
    const video = document.querySelector('video.video-element');
    const m = video?.className.match(/\baspect-(\w+)/);
    return m ? m[1] : null;
}

/** O botão de proporção do player (original → esticar → preencher → …). */
function trocarProporcao() {
    const botao = document.querySelector('button[title="Proporção"]');
    expect(botao, 'botão de proporção não está na tela').not.toBeNull();
    act(() => { fireEvent.click(botao!); });
}

/** ⚙ Opções → Qualidade → a faixa pedida. */
function escolherQualidade(rotulo: string) {
    const opcoes = document.querySelector('button[title="Opções"]');
    expect(opcoes, 'botão de opções não está na tela').not.toBeNull();
    act(() => { fireEvent.click(opcoes!); });
    act(() => { fireEvent.click(screen.getByText('Qualidade')); });
    act(() => { fireEvent.click(screen.getByText(rotulo)); });
}

/** Índices que o player aplicou sozinho (sem ninguém escolher nada). */
const aplicadas = () => hls.setQuality.mock.calls.map(chamada => chamada[0]);

function fila(seriesId: string, index = 0): EpisodeQueue {
    return {
        seriesId,
        seriesName: `Série ${seriesId}`,
        episodes: [
            { id: `${seriesId}01`, season: 1, episode: 1, container: 'mp4', title: 'Piloto' },
            { id: `${seriesId}02`, season: 1, episode: 2, container: 'mp4', title: 'Segundo' },
        ],
        index,
    };
}

/** ⏭ do controle (MediaTrackNext; 10233 no Tizen): próximo episódio. */
const proximoEpisodio = () =>
    act(() => { fireEvent.keyDown(window, { key: 'MediaTrackNext', keyCode: 10233 }); });

/** O src do <video> — prova que o episódio mudou de fato. */
const srcAtual = () => document.querySelector('video.video-element')?.getAttribute('src') ?? '';

describe('SeriesQueuePlayer — a proporção escolhida atravessa os episódios', () => {
    it('esticar no episódio 1 continua esticado no episódio 2 (o player é remontado entre eles)', () => {
        render(<SeriesQueuePlayer queue={fila('10')} onClose={() => {}} />);
        expect(proporcao()).toBe('original');

        trocarProporcao();
        expect(proporcao()).toBe('stretch');

        const antes = srcAtual();
        proximoEpisodio();

        expect(srcAtual()).not.toBe(antes);
        expect(srcAtual()).toContain('1002');
        expect(proporcao()).toBe('stretch');
    });

    it('a preferência é da SÉRIE: outra série começa no original', () => {
        const { unmount } = render(<SeriesQueuePlayer queue={fila('10')} onClose={() => {}} />);
        trocarProporcao();
        expect(proporcao()).toBe('stretch');
        unmount();

        render(<SeriesQueuePlayer queue={fila('20')} onClose={() => {}} />);
        expect(proporcao()).toBe('original');
    });

    it('reabrir a série mais tarde (outro episódio) volta com a proporção escolhida', () => {
        const { unmount } = render(<SeriesQueuePlayer queue={fila('10')} onClose={() => {}} />);
        trocarProporcao();
        trocarProporcao();
        expect(proporcao()).toBe('fill');
        unmount();

        render(<SeriesQueuePlayer queue={fila('10', 1)} onClose={() => {}} />);
        expect(proporcao()).toBe('fill');
    });

    it('duas séries com o MESMO nome (ex.: versões de países diferentes) não dividem a preferência', () => {
        const { unmount } = render(<SeriesQueuePlayer queue={{ ...fila('10'), seriesName: 'The Office' }} onClose={() => {}} />);
        trocarProporcao();
        expect(proporcao()).toBe('stretch');
        unmount();

        render(<SeriesQueuePlayer queue={{ ...fila('20'), seriesName: 'The Office' }} onClose={() => {}} />);
        expect(proporcao()).toBe('original');
    });
});

describe('SeriesQueuePlayer — a qualidade manual atravessa os episódios', () => {
    it('720p escolhido no episódio 1 é reaplicado sozinho no episódio 2', () => {
        render(<SeriesQueuePlayer queue={fila('10')} onClose={() => {}} />);
        expect(aplicadas(), 'sem escolha salva o player não pode forçar faixa').toEqual([]);

        escolherQualidade('720p');
        expect(aplicadas()).toEqual([1]);
        hls.setQuality.mockClear();

        proximoEpisodio();

        expect(srcAtual()).toContain('1002');
        expect(aplicadas()).toEqual([1]);
    });

    it('outra série não herda a faixa escolhida', () => {
        const { unmount } = render(<SeriesQueuePlayer queue={fila('10')} onClose={() => {}} />);
        escolherQualidade('720p');
        unmount();
        hls.setQuality.mockClear();

        render(<SeriesQueuePlayer queue={fila('20')} onClose={() => {}} />);
        expect(aplicadas()).toEqual([]);
    });
});

describe('MoviePlayer — proporção e qualidade lembradas por filme', () => {
    it('fechar e reabrir o mesmo filme mantém a proporção; outro filme começa no original', () => {
        const { unmount } = render(<MoviePlayer movieId="555" title="Filme 4:3" onClose={() => {}} />);
        expect(proporcao()).toBe('original');
        trocarProporcao();
        expect(proporcao()).toBe('stretch');
        unmount();

        const segundo = render(<MoviePlayer movieId="555" title="Filme 4:3" onClose={() => {}} />);
        expect(proporcao()).toBe('stretch');
        segundo.unmount();

        render(<MoviePlayer movieId="777" title="Outro filme" onClose={() => {}} />);
        expect(proporcao()).toBe('original');
    });

    it('a chave é do grupo de versões (movieId), não da versão tocada (streamId)', () => {
        const { unmount } = render(<MoviePlayer movieId="555" streamId={901} title="Filme" onClose={() => {}} />);
        trocarProporcao();
        expect(proporcao()).toBe('stretch');
        unmount();

        // Mesma obra, outra versão (ex.: legendado × dublado)
        render(<MoviePlayer movieId="555" streamId={902} title="Filme" onClose={() => {}} />);
        expect(srcAtual()).toContain('902');
        expect(proporcao()).toBe('stretch');
    });

    it('reabrir o filme reaplica a qualidade escolhida; outro filme fica no automático', () => {
        const { unmount } = render(<MoviePlayer movieId="555" title="Filme" onClose={() => {}} />);
        escolherQualidade('480p');
        unmount();
        hls.setQuality.mockClear();

        const segundo = render(<MoviePlayer movieId="555" title="Filme" onClose={() => {}} />);
        expect(aplicadas()).toEqual([0]);
        segundo.unmount();
        hls.setQuality.mockClear();

        render(<MoviePlayer movieId="777" title="Outro filme" onClose={() => {}} />);
        expect(aplicadas()).toEqual([]);
    });

    it('dois filmes com o MESMO nome (ex.: refilmagem) não dividem a preferência', () => {
        const { unmount } = render(<MoviePlayer movieId="555" title="Drácula" onClose={() => {}} />);
        trocarProporcao();
        expect(proporcao()).toBe('stretch');
        unmount();

        render(<MoviePlayer movieId="777" title="Drácula" onClose={() => {}} />);
        expect(proporcao()).toBe('original');
    });

    it('filme e série com o MESMO id não dividem a preferência', () => {
        // Os ids de VOD e de série vêm de numerações independentes do painel
        const { unmount } = render(<MoviePlayer movieId="10" title="Filme 10" onClose={() => {}} />);
        trocarProporcao();
        expect(proporcao()).toBe('stretch');
        unmount();

        render(<SeriesQueuePlayer queue={fila('10')} onClose={() => {}} />);
        expect(proporcao()).toBe('original');
    });
});
