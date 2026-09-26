// @vitest-environment jsdom
//
// 💤 O segura-screensaver do player era um no-op na TV de verdade.
//
// `webapis` NÃO é injetado pela plataforma como o objeto `tizen`: ele só
// existe se o widget carregar `$WEBAPIS/webapis/webapis.js`. O
// tizen/index.html não carregava — então `window.webapis` era `undefined` na
// TV, `holdSystemScreenSaver` saía no primeiro `if` sem um aviso sequer, e o
// descanso de tela do sistema continuava armado durante um filme de duas
// horas. E, como era silencioso, a tela de diagnóstico não mostrava nada.
//
// Duas metades:
//  1. o index.html que vai no .wgt carrega o webapis.js ANTES do bundle;
//  2. quando a API falta (ou falha) numa TV Tizen, isso vai para o anel de
//     erros do diagnóstico — uma vez, não uma por canal zapeado.
//
// O player é montado DE VERDADE; o `webapis.appcommon` é o único dublê (é a
// fronteira com a TV), como no VideoPlayer.sleep.test.tsx.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { installFakeStorage } from '../../testing/fakeStorage';
import { clearErrorLog, getErrorLog } from '../../services/diagnostics';
import { VideoPlayer } from './VideoPlayer';

const SCREEN_SAVER_OFF = 0; // "segura" o screensaver do sistema
const SCREEN_SAVER_ON = 1;  // devolve o screensaver ao sistema
const WEBAPIS_JS = '$WEBAPIS/webapis/webapis.js';

type Janela = { webapis?: unknown; tizen?: unknown };
const janela = window as unknown as Janela;

/** Entradas do anel de erros que falam do screensaver. */
const avisosDoScreensaver = () => getErrorLog().filter(e => e.source === 'screensaver');

function abrirPlayer() {
    return render(
        <VideoPlayer
            src="http://provedor.invalid/filme.mp4"
            title="Filme"
            contentType="movie"
            onClose={() => {}}
        />
    );
}

beforeEach(() => {
    installFakeStorage();
    clearErrorLog();
    // jsdom não implementa mídia; o player só precisa que as chamadas existam.
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete janela.webapis;
    delete janela.tizen;
    delete document.documentElement.dataset.playing;
    clearErrorLog();
});

describe('tizen/index.html carrega o webapis.js da TV', () => {
    const HTML = readFileSync(join(process.cwd(), 'tizen', 'index.html'), 'utf-8');
    const doc = new DOMParser().parseFromString(HTML, 'text/html');

    it('há uma tag <script> do SDK Samsung no <head>', () => {
        const tag = doc.head.querySelector(`script[src="${WEBAPIS_JS}"]`);
        expect(tag, 'sem esta tag window.webapis é undefined na TV').not.toBeNull();
    });

    it('e ela vem ANTES do script que injeta o bundle', () => {
        const scripts = [...doc.querySelectorAll('script')];
        const webapis = scripts.findIndex(s => s.getAttribute('src') === WEBAPIS_JS);
        const carregador = scripts.findIndex(s => (s.textContent || '').includes('assets/index.js'));
        expect(carregador, 'não achei o script que carrega o bundle').toBeGreaterThanOrEqual(0);
        expect(webapis).toBeGreaterThanOrEqual(0);
        expect(webapis).toBeLessThan(carregador);
    });
});

describe('VideoPlayer — segura-screensaver sem a API', () => {
    it('numa TV Tizen sem webapis, o sumiço da API vai para o diagnóstico', () => {
        janela.tizen = {}; // a plataforma injeta sozinha; o webapis, não
        abrirPlayer();

        const avisos = avisosDoScreensaver();
        expect(avisos).toHaveLength(1);
        expect(avisos[0].message).toContain('webapis');
    });

    it('avisa uma vez só, por mais canais que se abram', () => {
        janela.tizen = {};
        abrirPlayer();
        cleanup(); // fechar o player também chama o hold(false)
        abrirPlayer();
        cleanup();
        abrirPlayer();

        expect(avisosDoScreensaver()).toHaveLength(1);
    });

    it('se a TV recusa o pedido (callback de erro), isso também aparece', () => {
        janela.tizen = {};
        janela.webapis = {
            appcommon: {
                setScreenSaver: (_state: number, _ok?: () => void, erro?: (e: unknown) => void) => {
                    erro?.({ name: 'NotSupportedError', message: 'recusado' });
                },
                AppCommonScreenSaverState: { SCREEN_SAVER_OFF, SCREEN_SAVER_ON },
            },
        };
        abrirPlayer();

        const avisos = avisosDoScreensaver();
        expect(avisos).toHaveLength(1);
        expect(avisos[0].message).toContain('recusado');
    });

    it('se a chamada lança, isso também aparece (antes o catch engolia calado)', () => {
        janela.tizen = {};
        janela.webapis = {
            appcommon: {
                setScreenSaver: () => { throw new Error('TypeMismatchError'); },
                AppCommonScreenSaverState: { SCREEN_SAVER_OFF, SCREEN_SAVER_ON },
            },
        };
        abrirPlayer();

        const avisos = avisosDoScreensaver();
        expect(avisos).toHaveLength(1);
        expect(avisos[0].message).toContain('TypeMismatchError');
    });

    it('se a TV recusa com um motivo que não é objeto (texto cru), o texto aparece', () => {
        janela.tizen = {};
        janela.webapis = {
            appcommon: {
                setScreenSaver: (_state: number, _ok?: () => void, erro?: (e: unknown) => void) => {
                    erro?.('SecurityError');
                },
                AppCommonScreenSaverState: { SCREEN_SAVER_OFF, SCREEN_SAVER_ON },
            },
        };
        abrirPlayer();

        const avisos = avisosDoScreensaver();
        expect(avisos).toHaveLength(1);
        expect(avisos[0].message).toContain('SecurityError');
    });

    it('com a API presente e funcionando, segura na abertura, solta no fechamento e não avisa nada', () => {
        janela.tizen = {};
        const setScreenSaver = vi.fn();
        janela.webapis = {
            appcommon: {
                setScreenSaver,
                AppCommonScreenSaverState: { SCREEN_SAVER_OFF, SCREEN_SAVER_ON },
            },
        };
        abrirPlayer();
        expect(setScreenSaver).toHaveBeenCalledTimes(1);
        expect(setScreenSaver).toHaveBeenLastCalledWith(SCREEN_SAVER_OFF, undefined, expect.any(Function));
        cleanup();
        expect(setScreenSaver).toHaveBeenCalledTimes(2);
        expect(setScreenSaver).toHaveBeenLastCalledWith(SCREEN_SAVER_ON, undefined, expect.any(Function));

        expect(avisosDoScreensaver()).toHaveLength(0);
    });

    it('fora da TV (navegador, build web) não suja o diagnóstico', () => {
        abrirPlayer(); // sem `tizen` e sem `webapis`
        cleanup();
        expect(avisosDoScreensaver()).toHaveLength(0);
    });
});
