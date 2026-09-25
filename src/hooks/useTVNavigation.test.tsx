// @vitest-environment jsdom
//
// O único teste do projeto que precisa de DOM — e precisa mesmo: este hook é a
// TRADUÇÃO de todo controle remoto que o app entende, e ele registra o listener
// no `window`, olha o `event.target` e chama `preventDefault`. Nada disso pode
// ser exercitado com objetos de mentira.
//
// Três famílias de bug já saíram daqui e cada uma tem caso abaixo:
//  - dois hooks montados ao mesmo tempo → uma tecla, duas ações;
//  - o espaço dentro de um campo de texto virando "OK" ("ESPN 2" ficava "ESPN");
//  - `enabled` que não desliga de fato.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useTVNavigation } from './useTVNavigation';

interface SondaProps {
    onNavigate?: (d: 'up' | 'down' | 'left' | 'right') => void;
    onEnter?: (fromInput?: boolean) => void;
    onBack?: () => void;
    onAction?: (a: string) => void;
    enabled?: boolean;
    comInput?: boolean;
}

function Sonda({ comInput, ...opcoes }: SondaProps) {
    useTVNavigation(opcoes);
    return comInput ? <input data-testid="campo" defaultValue="ESPN" /> : <div />;
}

/** Dispara uma tecla como a TV dispara: por `key` OU por `keyCode`. */
function tecla(
    valor: string | number,
    alvo: EventTarget = window
): KeyboardEvent {
    const evento = new KeyboardEvent('keydown', {
        key: typeof valor === 'string' ? valor : '',
        keyCode: typeof valor === 'number' ? valor : 0,
        bubbles: true,
        cancelable: true,
    });
    alvo.dispatchEvent(evento);
    return evento;
}

afterEach(cleanup);

describe('setas', () => {
    let onNavigate: SondaProps['onNavigate'] & { mock: { calls: unknown[][] } };
    beforeEach(() => {
        onNavigate = vi.fn() as typeof onNavigate;
        render(<Sonda onNavigate={onNavigate} />);
    });

    it.each([
        ['ArrowUp', 'up'], ['ArrowDown', 'down'],
        ['ArrowLeft', 'left'], ['ArrowRight', 'right'],
    ])('%s vira %s', (key, direcao) => {
        tecla(key);
        expect(onNavigate).toHaveBeenCalledWith(direcao);
    });

    // Controle Samsung antigo manda keyCode, não `key`.
    it.each([[38, 'up'], [40, 'down'], [37, 'left'], [39, 'right']])(
        'keyCode %d vira %s', (code, direcao) => {
            tecla(code);
            expect(onNavigate).toHaveBeenCalledWith(direcao);
        });

    it('cancela o evento pra página não rolar por baixo', () => {
        expect(tecla('ArrowDown').defaultPrevented).toBe(true);
    });
});

describe('OK e Voltar', () => {
    // Cada um destes é um controle diferente na casa de alguém.
    it.each(['Enter', 13, 29443, ' ', 32, 'Select'])('%s é OK', (valor) => {
        const onEnter = vi.fn();
        render(<Sonda onEnter={onEnter} />);
        tecla(valor);
        expect(onEnter).toHaveBeenCalled();
    });

    it.each(['Backspace', 8, 10009, 461, 'XF86Back'])('%s é Voltar', (valor) => {
        const onBack = vi.fn();
        render(<Sonda onBack={onBack} />);
        tecla(valor);
        expect(onBack).toHaveBeenCalled();
    });

    it('OK também chega em onAction', () => {
        const onAction = vi.fn();
        render(<Sonda onAction={onAction} />);
        tecla('Enter');
        expect(onAction).toHaveBeenCalledWith('enter');
    });
});

describe('teclas coloridas e de mídia', () => {
    it.each([
        ['ColorF0Red', 'red'], [403, 'red'],
        ['ColorF1Green', 'green'], [404, 'green'],
        ['ColorF2Yellow', 'yellow'], [405, 'yellow'],
        ['ColorF3Blue', 'blue'], [406, 'blue'],
        ['MediaPlayPause', 'play'], [415, 'play'],
        [19, 'pause'], [413, 'stop'],
    ])('%s vira %s', (valor, acao) => {
        const onAction = vi.fn();
        render(<Sonda onAction={onAction} />);
        tecla(valor);
        expect(onAction).toHaveBeenCalledWith(acao);
    });
});

describe('enabled', () => {
    it('desligado não escuta nada', () => {
        const onNavigate = vi.fn();
        const onEnter = vi.fn();
        const onBack = vi.fn();
        render(<Sonda enabled={false} onNavigate={onNavigate} onEnter={onEnter} onBack={onBack} />);
        tecla('ArrowDown');
        tecla('Enter');
        tecla(10009);
        expect(onNavigate).not.toHaveBeenCalled();
        expect(onEnter).not.toHaveBeenCalled();
        expect(onBack).not.toHaveBeenCalled();
    });

    // A armadilha mais recorrente do projeto: o listener é GLOBAL, então dois
    // hooks montados ao mesmo tempo transformam uma tecla em duas ações — um
    // OK que "abre a ficha" e "dá play" no mesmo toque.
    it('dois hooks ligados = a MESMA tecla contada duas vezes', () => {
        const debaixo = vi.fn();
        const emCima = vi.fn();
        render(<><Sonda onEnter={debaixo} /><Sonda onEnter={emCima} /></>);
        tecla('Enter');
        expect(debaixo).toHaveBeenCalledTimes(1);
        expect(emCima).toHaveBeenCalledTimes(1);
    });

    it('é por isso que o de baixo precisa ser desligado', () => {
        const debaixo = vi.fn();
        const emCima = vi.fn();
        render(<><Sonda enabled={false} onEnter={debaixo} /><Sonda onEnter={emCima} /></>);
        tecla('Enter');
        expect(debaixo).not.toHaveBeenCalled();
        expect(emCima).toHaveBeenCalledTimes(1);
    });

    it('desmontar leva o listener junto', () => {
        const onEnter = vi.fn();
        const { unmount } = render(<Sonda onEnter={onEnter} />);
        unmount();
        tecla('Enter');
        expect(onEnter).not.toHaveBeenCalled();
    });
});

describe('dentro de um campo de texto (IME do Tizen)', () => {
    function comCampo(opcoes: SondaProps = {}) {
        const { getByTestId } = render(<Sonda comInput {...opcoes} />);
        const campo = getByTestId('campo') as HTMLInputElement;
        campo.focus();
        return campo;
    }

    // BUG REAL: o espaço é OK no controle e TEXTO no teclado. Tratado como OK
    // dentro do campo, buscar "ESPN 2" fechava o teclado em "ESPN".
    it('espaço dentro do campo é texto, não OK', () => {
        const onEnter = vi.fn();
        const campo = comCampo({ onEnter });
        tecla(' ', campo);
        tecla(32, campo);
        expect(onEnter).not.toHaveBeenCalled();
    });

    it('as setas ficam com o IME nativo', () => {
        const onNavigate = vi.fn();
        const campo = comCampo({ onNavigate });
        tecla('ArrowLeft', campo);
        tecla('ArrowRight', campo);
        expect(onNavigate).not.toHaveBeenCalled();
    });

    // OK de verdade fecha o teclado — e avisa a página de onde veio, senão
    // ela reabre a busca e o IME do Tizen fica piscando sem saída.
    it('OK fecha o teclado e diz que veio do campo', () => {
        const onEnter = vi.fn();
        const campo = comCampo({ onEnter });
        tecla('Enter', campo);
        expect(onEnter).toHaveBeenCalledWith(true);
        expect(document.activeElement).not.toBe(campo);
    });

    it('Voltar sai do campo', () => {
        const onBack = vi.fn();
        const campo = comCampo({ onBack });
        tecla(10009, campo);
        expect(onBack).toHaveBeenCalled();
        expect(document.activeElement).not.toBe(campo);
    });
});

describe('tizenhwkey', () => {
    // A TV manda este evento quando o teclado nativo está aberto; sem tirar o
    // foco do campo, o teclado não fecha.
    it('a tecla de hardware tira o foco do campo', () => {
        const { getByTestId } = render(<Sonda comInput />);
        const campo = getByTestId('campo') as HTMLInputElement;
        campo.focus();
        expect(document.activeElement).toBe(campo);

        const evento = new Event('tizenhwkey') as Event & { keyName?: string };
        evento.keyName = 'back';
        window.dispatchEvent(evento);

        expect(document.activeElement).not.toBe(campo);
    });
});

describe('as duas fontes da tecla', () => {
    /** A TV real manda os dois campos: `key` inútil e `keyCode` verdadeiro. */
    function teclaTV(key: string, keyCode: number, alvo: EventTarget = window) {
        alvo.dispatchEvent(new KeyboardEvent('keydown', {
            key, keyCode, bubbles: true, cancelable: true,
        }));
    }

    // Este é o caso que o `event.key || String(event.keyCode)` não pegava: com
    // 'Unidentified' o `||` fica satisfeito e o keyCode nunca é consultado.
    it('key "Unidentified" não impede o keyCode de identificar a seta', () => {
        const onNavigate = vi.fn();
        render(<Sonda onNavigate={onNavigate} />);
        teclaTV('Unidentified', 40);
        expect(onNavigate).toHaveBeenCalledWith('down');
    });

    it('key "Unidentified" com o OK do Samsung (29443)', () => {
        const onEnter = vi.fn();
        render(<Sonda onEnter={onEnter} />);
        teclaTV('Unidentified', 29443);
        expect(onEnter).toHaveBeenCalled();
    });

    // '8' é o keyCode do Backspace e está na lista do Voltar. Comparando as
    // duas fontes contra os dois tipos de código, o dígito 8 do teclado
    // numérico do controle deixa de fechar a tela.
    it('o dígito 8 não é Voltar', () => {
        const onBack = vi.fn();
        render(<Sonda onBack={onBack} />);
        teclaTV('8', 56);
        expect(onBack).not.toHaveBeenCalled();
    });

    it('mas o Backspace continua sendo Voltar', () => {
        const onBack = vi.fn();
        render(<Sonda onBack={onBack} />);
        teclaTV('Backspace', 8);
        expect(onBack).toHaveBeenCalled();
    });

    it('keyCode 8 sozinho (sem key) continua sendo Voltar', () => {
        const onBack = vi.fn();
        render(<Sonda onBack={onBack} />);
        teclaTV('', 8);
        expect(onBack).toHaveBeenCalled();
    });
});

describe('retorno de toque do OK', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('o elemento focado fica marcado por um instante', () => {
        vi.useFakeTimers();
        const alvo = document.createElement('div');
        alvo.className = 'tv-focused';
        document.body.appendChild(alvo);
        render(<Sonda onEnter={vi.fn()} />);

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        expect(alvo.classList.contains('ns-pressed')).toBe(true);

        vi.advanceTimersByTime(200);
        expect(alvo.classList.contains('ns-pressed')).toBe(false);
        alvo.remove();
    });

    it('OK dentro de um campo de texto não pisca nada', () => {
        const alvo = document.createElement('div');
        alvo.className = 'tv-focused';
        document.body.appendChild(alvo);
        const { getByTestId } = render(<Sonda comInput onEnter={vi.fn()} />);
        const campo = getByTestId('campo') as HTMLInputElement;
        campo.focus();

        campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        expect(alvo.classList.contains('ns-pressed')).toBe(false);
        alvo.remove();
    });
});
