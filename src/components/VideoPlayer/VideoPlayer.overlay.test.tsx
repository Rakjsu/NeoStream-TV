// @vitest-environment jsdom
//
// 🔔 Aviso do App por cima do player (T003).
//
// Quando o aviso de lembrete aparece, o App muda a zona de foco pra 'overlay'
// e o player desliga o D-pad (useTVNavigation). Mas o player tem OUTROS dois
// ouvintes de keydown no window — as teclas de mídia (⏯ ⏹ ⏪ ⏩) e o CH±/dígitos
// — e eles continuavam vivos: com o aviso na tela, o ⏹ FECHAVA o player, o ⏯
// pausava o vídeo por baixo, o CH+ trocava de canal e um dígito armava o
// digit-jump. O OK e o 🔴 já respeitavam a zona; estes dois tinham ficado de
// fora.
//
// O teste monta o VideoPlayer DE VERDADE dentro do FocusContext, como o App
// faz, e aperta as teclas no window.
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { useCallback, useState } from 'react';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { installFakeStorage } from '../../testing/fakeStorage';
import { FocusContext, type FocusZone } from '../../contexts/FocusContext';
import { zapHistory } from '../../services/liveExtras';
import { VideoPlayer, type PlayerChannel } from './VideoPlayer';

/** Espera do CH± antes de trocar (ZAP_COMMIT_MS) e do digit-jump. */
const ESPERA_ZAP_MS = 600;
const ESPERA_DIGITO_MS = 1400;

const canais = (n: number): PlayerChannel[] =>
    Array.from({ length: n }, (_, i) => ({ stream_id: 100 + i, num: i + 1, name: `Canal ${i + 1}` }));

let trocas: number[];
let fechou: number;
let pauseSpy: MockInstance<() => void>;

beforeEach(() => {
    installFakeStorage();
    vi.useFakeTimers();
    trocas = [];
    fechou = 0;
    // jsdom não implementa mídia; o player só precisa que as chamadas existam.
    pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.playing;
});

/** A TV ao vivo em miniatura, dentro da zona de foco que o App escolheu. */
function Tela({ zona, lista, isOverlayOwner = false, navEnabled }: {
    zona: FocusZone;
    lista: PlayerChannel[];
    isOverlayOwner?: boolean;
    navEnabled?: boolean;
}) {
    const [atual, setAtual] = useState(lista[0].stream_id);
    const canal = lista.find(c => c.stream_id === atual)!;
    // Estáveis como os da LiveTV (useCallback): com uma função nova a cada
    // render, os effects do player re-rodariam por causa DELA na troca de
    // zona e o teste não veria se a zona está nas dependências.
    const trocar = useCallback((id: number) => { trocas.push(id); setAtual(id); }, []);
    const fechar = useCallback(() => { fechou++; }, []);
    return (
        <FocusContext.Provider value={{ focusZone: zona, setFocusZone: () => {} }}>
            <VideoPlayer
                src={`http://provedor.invalid/live/${atual}.ts`}
                title={canal.name}
                isLive
                contentType="live"
                channelList={lista}
                currentChannelId={atual}
                onSwitchChannel={trocar}
                onClose={fechar}
                isOverlayOwner={isOverlayOwner}
                navEnabled={navEnabled}
            />
        </FocusContext.Provider>
    );
}

const tecla = (key: string, keyCode: number) =>
    act(() => { fireEvent.keyDown(window, { key, keyCode }); });
const passar = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

/** O vídeo precisa estar "tocando" para o ⏯ tentar pausar. */
function fingirTocando() {
    const video = document.querySelector('video')!;
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
}

/** Aperta cada tecla que o aviso NÃO pode deixar passar e devolve o que mudou. */
function apertarTudo() {
    fingirTocando();
    const pausasAntes = pauseSpy.mock.calls.length;
    tecla('MediaPlayPause', 10252);   // ⏯
    tecla('MediaPause', 19);          // ⏸
    tecla('MediaStop', 413);          // ⏹
    tecla('PageDown', 34);            // CH−
    tecla('PageUp', 33);              // CH+
    tecla('7', 55);                   // dígito
    passar(ESPERA_ZAP_MS + ESPERA_DIGITO_MS);
    return { pausou: pauseSpy.mock.calls.length - pausasAntes };
}

describe('VideoPlayer — com um aviso do App por cima, as teclas são do aviso', () => {
    it('zona "overlay" (aviso de lembrete): ⏯ ⏸ ⏹ CH± e dígitos não fazem NADA no player', () => {
        render(<Tela zona="overlay" lista={canais(8)} />);

        const { pausou } = apertarTudo();

        expect(fechou, 'o ⏹ fechou o player por baixo do aviso').toBe(0);
        expect(pausou, 'o ⏯/⏸ pausou o vídeo por baixo do aviso').toBe(0);
        expect(trocas, 'CH± ou dígito trocou de canal por baixo do aviso').toEqual([]);
    });

    it('zona "overlay" não arma timer de CH± nem de digit-jump, nem mostra o alvo ou o número', () => {
        render(<Tela zona="overlay" lista={canais(8)} />);
        const armar = vi.spyOn(window, 'setTimeout');

        tecla('PageDown', 34);
        // Conferido ANTES de o tempo passar: depois da espera os dois somem
        // de qualquer jeito e a checagem não provaria nada
        expect(document.querySelector('.zap-banner-alvo'), 'o CH− mostrou o canal-alvo').toBeNull();
        tecla('7', 55);
        expect(document.querySelector('.digit-osd'), 'o dígito abriu o digit-jump').toBeNull();

        const esperas = armar.mock.calls.map(([, ms]) => ms);
        expect(esperas).not.toContain(ESPERA_ZAP_MS);
        expect(esperas).not.toContain(ESPERA_DIGITO_MS);
    });

    it('zona "overlay": o 🔴 (canal anterior) e o Voltar também não mexem no player', () => {
        const lista = canais(8);
        // Histórico: o anterior ao Canal 1 (tocando) é o Canal 4
        zapHistory.push(lista[3].stream_id);
        zapHistory.push(lista[0].stream_id);
        const { rerender } = render(<Tela zona="overlay" lista={lista} />);

        tecla('ColorF0Red', 403);
        tecla('XF86Back', 10009);
        expect(trocas, 'o 🔴 trocou de canal por baixo do aviso').toEqual([]);
        expect(fechou, 'o Voltar fechou o player por baixo do aviso').toBe(0);

        // Controle: sem o aviso as mesmas teclas valem
        rerender(<Tela zona="content" lista={lista} />);
        tecla('ColorF0Red', 403);
        expect(trocas).toEqual([lista[3].stream_id]);
        tecla('XF86Back', 10009);
        expect(fechou).toBe(1);
    });

    it('navEnabled={false} desliga TODAS as teclas do player, não só o D-pad', () => {
        render(<Tela zona="content" lista={canais(8)} navEnabled={false} />);

        const { pausou } = apertarTudo();
        tecla('XF86Back', 10009);

        expect(fechou).toBe(0);
        expect(pausou).toBe(0);
        expect(trocas).toEqual([]);
    });

    it('o aviso some (zona volta a "content"): as mesmas teclas voltam a valer', () => {
        const lista = canais(8);
        const { rerender } = render(<Tela zona="overlay" lista={lista} />);
        tecla('PageDown', 34);
        passar(ESPERA_ZAP_MS);
        expect(trocas).toEqual([]);

        rerender(<Tela zona="content" lista={lista} />);
        tecla('PageDown', 34);
        passar(ESPERA_ZAP_MS);
        expect(trocas).toEqual([lista[1].stream_id]);

        fingirTocando();
        const antes = pauseSpy.mock.calls.length;
        tecla('MediaPlayPause', 10252);
        expect(pauseSpy.mock.calls.length - antes).toBe(1);

        tecla('MediaStop', 413);
        expect(fechou).toBe(1);
    });

    it('o player que É o overlay (Busca Global) continua recebendo mídia e CH±', () => {
        const lista = canais(8);
        render(<Tela zona="overlay" lista={lista} isOverlayOwner />);

        tecla('PageDown', 34);
        passar(ESPERA_ZAP_MS);
        expect(trocas).toEqual([lista[1].stream_id]);

        tecla('MediaStop', 413);
        expect(fechou).toBe(1);
    });

    it('sem aviso nenhum (zona "content"), ⏯ ⏹ CH± e dígito funcionam como sempre', () => {
        const lista = canais(8);
        render(<Tela zona="content" lista={lista} />);

        const { pausou } = apertarTudo();

        expect(pausou).toBeGreaterThan(0);
        expect(fechou).toBe(1);
    });

    it('o aviso chega com o player já aberto: os ouvintes de keydown do player são DESARMADOS', () => {
        const lista = canais(8);
        const { rerender } = render(<Tela zona="content" lista={lista} />);
        // Os ouvintes de tecla que o player pendurou no window até aqui
        const armar = vi.spyOn(window, 'addEventListener');
        const desarmar = vi.spyOn(window, 'removeEventListener');

        rerender(<Tela zona="overlay" lista={lista} />);

        const keydownRemovidos = desarmar.mock.calls.filter(([tipo]) => tipo === 'keydown').length;
        const keydownArmados = armar.mock.calls.filter(([tipo]) => tipo === 'keydown').length;
        // Os ouvintes de mídia e de CH±/dígitos saem e NÃO voltam. O do D-pad
        // (useTVNavigation) é trocado por outro inerte — o hook sempre pendura
        // um ouvinte e confere o `enabled` lá dentro —, então o saldo tem de
        // ser de pelo menos dois ouvintes a menos no window.
        expect(keydownArmados, 'o player re-armou ouvinte de tecla por baixo do aviso').toBeLessThanOrEqual(1);
        expect(keydownRemovidos - keydownArmados, 'mídia ou CH± ficaram escutando por baixo do aviso')
            .toBeGreaterThanOrEqual(2);

        const { pausou } = apertarTudo();
        expect(fechou).toBe(0);
        expect(pausou).toBe(0);
        expect(trocas).toEqual([]);
    });
});
