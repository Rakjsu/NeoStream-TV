// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 🖤 A tela de boot do .wgt não pode ficar por cima do app.
 *
 * O `tizen/index.html` esperava 300 ms depois do `onload` do bundle e conferia
 * UMA vez se o `#root` tinha filho. Se o primeiro commit do React demorasse
 * mais que isso — CPU de TV de 2015, heap sob pressão depois de 1 MB de
 * bundle —, não havia segunda tentativa: o overlay ficava na frente para
 * sempre. Ele não tem zona de foco nem tratador de tecla, então o D-pad não
 * faz nada e a única saída é matar o app.
 *
 * O teste roda o script de boot DE VERDADE, o do arquivo que vai no pacote —
 * um teste estrutural (grep por `setInterval`) provaria a letra, não o
 * comportamento.
 */
declare global {
    interface Window {
        /** Definidos pelo tizen/index.html (o tsconfig dos testes não vê o main.tsx). */
        __NEOSTREAM_PRONTO__?: () => void;
        __NEOSTREAM_BOOTED__?: boolean;
    }
}

const HTML = readFileSync(join(process.cwd(), 'tizen', 'index.html'), 'utf-8');

function scriptsInline(): string[] {
    return [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(achado => achado[1]);
}

/** Roda os dois <script> inline do index.html no documento do teste. */
function abrirOApp(): void {
    document.body.innerHTML = '<div id="boot-status"><div>Carregando</div></div><div id="root"></div>';
    const scripts = scriptsInline();
    const cabecalho = scripts.find(texto => texto.includes('__NEOSTREAM_BOOT_ERROR__ ='));
    const carregador = scripts.find(texto => texto.includes('assets/index.js'));
    expect(cabecalho, 'não achei o script de erro no <head> do tizen/index.html').toBeTruthy();
    expect(carregador, 'não achei o script que carrega o bundle').toBeTruthy();
    new Function(cabecalho as string)();
    new Function(carregador as string)();
}

/** O bundle terminou de executar (é o gatilho do boot). */
function bundleCarregado(): void {
    const tag = document.querySelector('script[src^="./assets/index.js"]') as HTMLScriptElement | null;
    expect(tag, 'o index.html não injetou o bundle').toBeTruthy();
    (tag as HTMLScriptElement).onload?.(new Event('load'));
}

const overlay = () => document.getElementById('boot-status') as HTMLElement;
/** Simula o primeiro commit do React: um nó dentro do #root. */
const reactRenderou = () => {
    (document.getElementById('root') as HTMLElement).appendChild(document.createElement('div'));
};

describe('tela de boot do .wgt', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        abrirOApp();
        bundleCarregado();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('espera o React mesmo que ele demore muito mais que os 300 ms de antes', () => {
        vi.advanceTimersByTime(300);
        expect(overlay().className).toBe(''); // ainda na frente, e tudo bem

        vi.advanceTimersByTime(5000);
        reactRenderou();
        vi.advanceTimersByTime(100);

        expect(overlay().className).toBe('ready');
        expect(window.__NEOSTREAM_BOOTED__).toBe(true);
    });

    it('o aviso do próprio app tira a tela na hora, sem esperar tique nenhum', () => {
        // É o caminho normal: o efeito do main.tsx roda depois do commit.
        window.__NEOSTREAM_PRONTO__?.();
        expect(overlay().className).toBe('ready');
    });

    it('30 s sem nada no #root viram uma mensagem, não um retângulo preto mudo', () => {
        vi.advanceTimersByTime(30_000);
        expect(overlay().className).toBe('');
        expect(overlay().textContent).toContain('nao terminou de abrir');
    });

    it('e se o app subir depois disso, a mensagem sai da frente', () => {
        vi.advanceTimersByTime(30_000);
        window.__NEOSTREAM_PRONTO__?.();
        expect(overlay().className).toBe('ready');
    });
});

describe('o aviso vem de quem sabe que renderizou', () => {
    it('o AvisaQueSubiu chama __NEOSTREAM_PRONTO__ num efeito, e o main.tsx o monta', () => {
        // `createRoot(...).render(...)` não aceita callback no React 18+; o
        // efeito é o que roda depois do commit. Sem esta metade, o index.html
        // volta a depender só do laço de conferência.
        const componente = readFileSync(join(process.cwd(), 'src', 'components', 'AvisaQueSubiu.tsx'), 'utf-8');
        expect(componente).toContain('useEffect');
        expect(componente).toContain('window.__NEOSTREAM_PRONTO__?.()');

        const main = readFileSync(join(process.cwd(), 'src', 'main.tsx'), 'utf-8');
        expect(main).toContain('<AvisaQueSubiu>');
    });
});
