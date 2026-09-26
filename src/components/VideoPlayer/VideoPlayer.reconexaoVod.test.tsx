// @vitest-environment jsdom
//
// 🔄 Filme e episódio não tinham reconexão nenhuma (T121).
//
// Toda a máquina de reconexão do player — backoff de 2/4/8/16 s, o overlay
// "Reconectando… n/4", a posição reaplicada depois do reload, a mensagem por
// causa — só era acionada pelo `hls.on(Hls.Events.ERROR)` do useHls. Filme e
// episódio são URL DIRETA (.mp4/.mkv): o hls.js nunca é criado, e o único
// ouvinte de `error` do <video> era o do VideoPlayer, que jogava a tela
// "Erro ao reproduzir vídeo" na cara de quem estava no meio do filme. Nenhuma
// tentativa automática.
//
// O teste monta o VideoPlayer DE VERDADE com o src de um filme e faz o <video>
// falhar como o Chromium faz (evento `error` + `video.error.code`). A fronteira
// é a mídia do jsdom, que não existe: play/pause/load viram dublês.
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { useRef } from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { installFakeStorage } from '../../testing/fakeStorage';
import { useHls, type StreamErrorCause } from '../../hooks/useHls';
import { VideoPlayer } from './VideoPlayer';

// Códigos do MediaError (HTML): o Chromium 69 do Tizen segue os mesmos
const MEDIA_ERR_ABORTED = 1;
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

const FILME = 'http://provedor.invalid/movie/usuario/senha/42.mp4';
const EPISODIO = 'http://provedor.invalid/series/usuario/senha/7.mkv';
// Canal ao vivo com `direct_source` que não é .m3u8: também cai no ramo direto
const CANAL_DIRETO = 'http://provedor.invalid/live/usuario/senha/9.ts';

let loadSpy: MockInstance<() => void>;

beforeEach(() => {
    installFakeStorage();
    vi.useFakeTimers();
    // jsdom não implementa mídia; o player só precisa que as chamadas existam.
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    loadSpy = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.playing;
});

const passar = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

/** O <video> de verdade, com relógio e estado de "tocando" controláveis. */
function prepararVideo(video: HTMLVideoElement) {
    let posicao = 0;
    Object.defineProperty(video, 'currentTime', {
        configurable: true,
        get: () => posicao,
        set: (v: number) => { posicao = v; },
    });
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    return video;
}

/** O Chromium: `video.error` preenchido e o evento `error` no elemento. */
function falhar(video: HTMLVideoElement, code: number) {
    Object.defineProperty(video, 'error', { configurable: true, get: () => ({ code }) });
    act(() => { video.dispatchEvent(new Event('error')); });
}

function carregouMetadados(video: HTMLVideoElement) {
    act(() => { video.dispatchEvent(new Event('loadedmetadata')); });
}

function montarFilme(contentType: 'movie' | 'series' = 'movie') {
    render(
        <VideoPlayer
            src={contentType === 'movie' ? FILME : EPISODIO}
            title="Filme"
            autoPlay
            contentType={contentType}
            onClose={() => {}}
        />
    );
    return prepararVideo(document.querySelector('video')!);
}

const overlay = () => document.querySelector('.reconnect-overlay')?.textContent ?? null;
const telaDeErro = () => document.querySelector('.video-player-error p')?.textContent ?? null;

describe('VideoPlayer — filme/episódio (URL direta) reconecta como o ao vivo', () => {
    it.each(['movie', 'series'] as const)(
        '%s: queda de rede no meio mostra "Reconectando 1/4", refaz o pipeline e volta na mesma posição',
        (tipo) => {
            const video = montarFilme(tipo);
            const src = video.getAttribute('src');
            carregouMetadados(video);
            video.currentTime = 1800; // meia hora de filme

            const loadsAntes = loadSpy.mock.calls.length;
            falhar(video, MEDIA_ERR_NETWORK);

            expect(telaDeErro(), 'a queda virou tela de erro em vez de reconexão').toBeNull();
            expect(overlay()).toContain('tentativa 1/4');

            // Backoff da 1ª tentativa: 2 s. Antes disso, nada de reload.
            passar(1999);
            expect(loadSpy.mock.calls.length).toBe(loadsAntes);
            passar(1);
            expect(loadSpy.mock.calls.length, 'o pipeline não foi refeito').toBeGreaterThan(loadsAntes);
            expect(video.getAttribute('src')).toBe(src);

            // O pipeline novo recomeça do zero; a posição volta no loadedmetadata
            video.currentTime = 0;
            carregouMetadados(video);
            expect(video.currentTime).toBe(1800);

            // Voltou a tocar: some o overlay
            act(() => { video.dispatchEvent(new Event('playing')); });
            expect(overlay()).toBeNull();
            expect(telaDeErro()).toBeNull();
        }
    );

    it('4 quedas seguidas sem voltar a tocar: desiste com a mensagem de rede (não a genérica)', () => {
        const video = montarFilme();
        carregouMetadados(video);

        for (const [tentativa, espera] of [[1, 2000], [2, 4000], [3, 8000], [4, 16000]] as const) {
            falhar(video, MEDIA_ERR_NETWORK);
            expect(overlay()).toContain(`tentativa ${tentativa}/4`);
            passar(espera);
        }
        falhar(video, MEDIA_ERR_NETWORK);

        expect(overlay()).toBeNull();
        expect(telaDeErro()).toBe('⚠️ Falha de rede. Verifique a conexão da TV.');

        // Terminal: não sobra timer de reconexão armado
        const loads = loadSpy.mock.calls.length;
        passar(60_000);
        expect(loadSpy.mock.calls.length).toBe(loads);
    });

    it('arquivo que nunca abriu (código 4 antes do loadedmetadata): não insiste e não fala em "Canal … 404"', () => {
        const video = montarFilme();
        const loads = loadSpy.mock.calls.length;

        falhar(video, MEDIA_ERR_SRC_NOT_SUPPORTED);

        expect(overlay()).toBeNull();
        expect(telaDeErro()).toBe('⚠️ Conteúdo indisponível ou formato não suportado.');

        passar(60_000);
        expect(loadSpy.mock.calls.length, 'arquivo inexistente/formato não suportado virou retry').toBe(loads);
    });

    it('código 4 numa REABERTURA de filme que já tocava é rede fora: continua tentando e volta na posição', () => {
        const video = montarFilme();
        carregouMetadados(video);
        video.currentTime = 1800;

        falhar(video, MEDIA_ERR_NETWORK);
        passar(2000);
        video.currentTime = 0; // o reload zerou o relógio
        // Rede ainda fora: o Chromium reporta a falha ao reabrir como código 4
        falhar(video, MEDIA_ERR_SRC_NOT_SUPPORTED);

        expect(telaDeErro()).toBeNull();
        expect(overlay()).toContain('tentativa 2/4');

        // A 2ª tentativa abre: a posição guardada na 1ª não se perdeu
        passar(4000);
        carregouMetadados(video);
        expect(video.currentTime).toBe(1800);
    });

    it('um "error" que o useHls não trata como queda ainda mostra a tela de erro genérica', () => {
        const video = montarFilme();
        carregouMetadados(video);
        // Código 1 (abortou): sem reconexão em curso, o ouvinte genérico do
        // player continua valendo
        falhar(video, MEDIA_ERR_ABORTED);
        expect(overlay()).toBeNull();
        expect(telaDeErro()).toBe('⚠️ Erro ao reproduzir vídeo');
    });
});

describe('VideoPlayer — canal ao vivo com fonte direta (não .m3u8)', () => {
    function montarCanal(onStreamFailed: () => void) {
        render(
            <VideoPlayer
                src={CANAL_DIRETO}
                title="Canal"
                isLive
                autoPlay
                contentType="live"
                onStreamFailed={onStreamFailed}
                onClose={() => {}}
            />
        );
        return prepararVideo(document.querySelector('video')!);
    }

    it('não abriu: mensagem de canal e failover pra próxima variante, sem retry', () => {
        const falhou = vi.fn();
        const video = montarCanal(falhou);
        const loads = loadSpy.mock.calls.length;

        falhar(video, MEDIA_ERR_SRC_NOT_SUPPORTED);

        expect(telaDeErro()).toBe('⚠️ Canal indisponível no provedor (404). Tente outra variante ou canal.');
        expect(falhou).toHaveBeenCalledTimes(1);
        passar(60_000);
        expect(loadSpy.mock.calls.length).toBe(loads);
    });

    it('caiu no meio: reconecta', () => {
        const video = montarCanal(() => {});
        carregouMetadados(video);
        falhar(video, MEDIA_ERR_NETWORK);
        expect(telaDeErro()).toBeNull();
        expect(overlay()).toContain('tentativa 1/4');
    });
});

describe('useHls — ouvinte de erro da fonte direta', () => {
    function Gancho({ src, onStreamError }: { src: string; onStreamError: (c?: StreamErrorCause) => void }) {
        const ref = useRef<HTMLVideoElement | null>(video);
        // autoPlay desligado: o play-no-loadedmetadata do autoplay é outro
        // ouvinte (once) e não é o que este teste conta
        useHls({ src, videoRef: ref, onStreamError, autoPlay: false });
        return null;
    }
    let video: HTMLVideoElement;
    /** Ouvintes de error/loadedmetadata VIVOS no <video> (add sem remove), por par tipo+função. */
    let vivos: Map<EventListenerOrEventListenerObject, Set<string>>;
    const quantosVivos = () => [...vivos.values()].reduce((n, tipos) => n + tipos.size, 0);
    beforeEach(() => {
        video = document.createElement('video');
        document.body.appendChild(video);
        vivos = new Map();
        const add = video.addEventListener.bind(video);
        const remove = video.removeEventListener.bind(video);
        vi.spyOn(video, 'addEventListener').mockImplementation((tipo, fn, opts) => {
            if ((tipo === 'error' || tipo === 'loadedmetadata') && fn) {
                vivos.set(fn, (vivos.get(fn) ?? new Set()).add(tipo));
            }
            add(tipo, fn, opts);
        });
        vi.spyOn(video, 'removeEventListener').mockImplementation((tipo, fn, opts) => {
            if ((tipo === 'error' || tipo === 'loadedmetadata') && fn) vivos.get(fn)?.delete(tipo);
            remove(tipo, fn, opts);
        });
    });
    afterEach(() => { video.remove(); });

    it('entrega a causa; é DESARMADO na troca de src e ao desmontar (nada de ouvinte duplicado ou órfão)', () => {
        const erros: (StreamErrorCause | undefined)[] = [];
        const onStreamError = (c?: StreamErrorCause) => { erros.push(c); };
        const { rerender, unmount } = render(<Gancho src={FILME} onStreamError={onStreamError} />);

        falhar(video, MEDIA_ERR_NETWORK);
        expect(erros).toEqual(['network']);
        expect(quantosVivos(), 'um par error + loadedmetadata por src').toBe(2);

        // Troca de episódio: o ouvinte do src velho sai, só o novo responde
        rerender(<Gancho src={EPISODIO} onStreamError={onStreamError} />);
        falhar(video, MEDIA_ERR_DECODE);
        expect(erros).toEqual(['network', 'media']);
        expect(quantosVivos(), 'o par do src velho ficou armado').toBe(2);

        unmount();
        expect(quantosVivos(), 'ouvintes do <video> sobreviveram ao desmonte').toBe(0);
        falhar(video, MEDIA_ERR_NETWORK);
        carregouMetadados(video);
        expect(erros, 'ouvinte de erro sobreviveu ao desmonte').toEqual(['network', 'media']);
    });

    it('o "já abriu" é do src: o conteúdo seguinte que não abre volta a ser terminal', () => {
        const erros: (StreamErrorCause | undefined)[] = [];
        const onStreamError = (c?: StreamErrorCause) => { erros.push(c); };
        const { rerender } = render(<Gancho src={FILME} onStreamError={onStreamError} />);

        carregouMetadados(video);
        falhar(video, MEDIA_ERR_SRC_NOT_SUPPORTED);
        expect(erros, 'o filme que já abriu: 4 é rede').toEqual(['network']);

        rerender(<Gancho src={EPISODIO} onStreamError={onStreamError} />);
        falhar(video, MEDIA_ERR_SRC_NOT_SUPPORTED);
        expect(erros, 'o episódio nunca abriu: herdou o "já abriu" do filme').toEqual(['network', 'notfound']);
    });

    it('abortar (código 1) não é falha: troca de src/fechar não dispara reconexão', () => {
        const erros: (StreamErrorCause | undefined)[] = [];
        render(<Gancho src={FILME} onStreamError={(c) => { erros.push(c); }} />);
        falhar(video, MEDIA_ERR_ABORTED);
        expect(erros).toEqual([]);
    });
});
