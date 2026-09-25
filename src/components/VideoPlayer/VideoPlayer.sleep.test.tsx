// @vitest-environment jsdom
//
// 🌙 O timer de desligamento só pausava o vídeo.
//
// A pessoa liga o timer de 30/60/90 min justamente para dormir. Quando ele
// vencia, o player chamava `pause()` e zerava o próprio estado — e mais nada:
// continuava montado, com `holdSystemScreenSaver(true)` valendo e com
// `data-playing` no <html>. Resultado: a TV passava a noite acesa com um
// quadro congelado, o screensaver do SISTEMA desligado por ordem do app e o
// anti burn-in do próprio app (theme.css, `html.app-dimmed:not([data-playing])`)
// impedido de escurecer a tela. Numa OLED é o cenário exato de burn-in.
//
// O teste monta o VideoPlayer DE VERDADE, com o relógio falso: o defeito é o
// que acontece quando passa tempo sem ninguém tocar no controle. O
// `webapis.appcommon` do Tizen é o único dublê — é a fronteira com a TV.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { installFakeStorage } from '../../testing/fakeStorage';
import { VideoPlayer } from './VideoPlayer';

const SCREEN_SAVER_OFF = 0; // "segura" o screensaver do sistema
const SCREEN_SAVER_ON = 1;  // devolve o screensaver ao sistema

const MIN = 60_000;

let setScreenSaver: ReturnType<typeof vi.fn>;

/** Último estado pedido ao sistema (OFF = app segurando a TV acesa). */
const ultimoPedido = () => setScreenSaver.mock.calls[setScreenSaver.mock.calls.length - 1]?.[0];

beforeEach(() => {
    installFakeStorage();
    vi.useFakeTimers();
    setScreenSaver = vi.fn();
    (window as unknown as { webapis?: unknown }).webapis = {
        appcommon: {
            setScreenSaver,
            AppCommonScreenSaverState: { SCREEN_SAVER_OFF, SCREEN_SAVER_ON },
        },
    };
    // jsdom não implementa mídia; o player só precisa que as chamadas existam.
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window as unknown as { webapis?: unknown }).webapis;
    delete document.documentElement.dataset.playing;
});

/** Página que desmonta o player no onClose — como Movies/Series/LiveTV fazem. */
function Pagina({ onClose, onTimeUpdate, aoVivo = false }: {
    onClose: () => void;
    onTimeUpdate?: (t: number, d: number) => void;
    aoVivo?: boolean;
}) {
    const [aberto, setAberto] = useState(true);
    if (!aberto) return <div data-testid="interface-do-app" />;
    return (
        <VideoPlayer
            src="http://provedor.invalid/filme.mp4"
            title="Filme"
            isLive={aoVivo}
            contentType={aoVivo ? 'live' : 'movie'}
            onTimeUpdate={onTimeUpdate}
            onClose={() => { onClose(); setAberto(false); }}
        />
    );
}

const botaoDaLua = () => screen.getByTitle('Timer de desligamento');

/** Um toque no botão da lua = próxima opção (30 → 60 → 90 → desligado). */
const tocarNaLua = () => fireEvent.click(botaoDaLua());

const passar = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('VideoPlayer — timer de desligamento', () => {
    it('ao vencer, fecha o player, salva o progresso e devolve o screensaver ao sistema', () => {
        const onClose = vi.fn();
        const onTimeUpdate = vi.fn();
        render(<Pagina onClose={onClose} onTimeUpdate={onTimeUpdate} />);

        // O player segura o screensaver enquanto toca
        expect(ultimoPedido()).toBe(SCREEN_SAVER_OFF);
        expect(document.documentElement.dataset.playing).toBe('1');

        tocarNaLua(); // 30 min
        passar(30 * MIN); // vence na hora marcada, não um tique depois

        expect(onClose).toHaveBeenCalledTimes(1);
        // O fechamento é o mesmo do botão Fechar: o progresso vai junto
        expect(onTimeUpdate).toHaveBeenCalled();
        expect(screen.getByTestId('interface-do-app')).toBeTruthy();
        expect(ultimoPedido()).toBe(SCREEN_SAVER_ON);
        // Sem `data-playing` o anti burn-in do app volta a poder escurecer a tela
        expect(document.documentElement.dataset.playing).toBeUndefined();
    });

    it('no ao vivo também fecha: volta para a interface, onde vale o anti burn-in', () => {
        const onClose = vi.fn();
        render(<Pagina onClose={onClose} aoVivo />);

        tocarNaLua(); // 30 min
        passar(30 * MIN);

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('interface-do-app')).toBeTruthy();
        expect(ultimoPedido()).toBe(SCREEN_SAVER_ON);
        expect(document.documentElement.dataset.playing).toBeUndefined();
    });

    it('não fecha antes da hora', () => {
        const onClose = vi.fn();
        render(<Pagina onClose={onClose} />);

        tocarNaLua(); // 30 min
        passar(30 * MIN - 1); // o último tique antes do prazo já passou

        expect(onClose).not.toHaveBeenCalled();
        expect(ultimoPedido()).toBe(SCREEN_SAVER_OFF);
        expect(document.documentElement.dataset.playing).toBe('1');
    });

    it('solta o screensaver mesmo que a página não desmonte o player, e desarma o tique', () => {
        // onClose que NÃO desmonta: o hold não pode depender do pai
        const onClose = vi.fn();
        render(
            <VideoPlayer
                src="http://provedor.invalid/filme.mp4"
                title="Filme"
                contentType="movie"
                onClose={onClose}
            />
        );

        // O tique do timer (15 s) é o único intervalo de 15 s do player
        const armar = vi.spyOn(window, 'setInterval');
        const desarmar = vi.spyOn(window, 'clearInterval');
        tocarNaLua(); // 30 min
        expect(botaoDaLua().textContent).toContain('30m');
        const armado = armar.mock.calls.findIndex(([, ms]) => ms === 15_000);
        expect(armado).toBeGreaterThanOrEqual(0);
        const tique = armar.mock.results[armado].value;
        passar(30 * MIN);

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(ultimoPedido()).toBe(SCREEN_SAVER_ON);
        // O timer vencido some da tela e o próximo toque recomeça do 30
        expect(botaoDaLua().className).not.toMatch(/\bactive\b/);
        expect(botaoDaLua().textContent).not.toMatch(/\d+m/);

        // O intervalo do timer tem de morrer junto: mais três horas paradas e
        // nada de fechar de novo nem voltar a segurar a TV acesa
        const pedidosAntes = setScreenSaver.mock.calls.length;
        passar(3 * 60 * MIN);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(setScreenSaver.mock.calls.length).toBe(pedidosAntes);
        expect(desarmar).toHaveBeenCalledWith(tique);

        tocarNaLua();
        expect(botaoDaLua().textContent).toContain('30m');
    });

    it('timer desligado pelo usuário não fecha nada', () => {
        const onClose = vi.fn();
        render(<Pagina onClose={onClose} />);

        tocarNaLua(); // 30
        tocarNaLua(); // 60
        tocarNaLua(); // 90
        tocarNaLua(); // desligado
        passar(3 * 60 * MIN);

        expect(onClose).not.toHaveBeenCalled();
        expect(ultimoPedido()).toBe(SCREEN_SAVER_OFF);
    });
});
