// @vitest-environment jsdom
//
// 📺 A lista de canais do player só andava de um em um (T004).
//
// O overlay 📺 mostra 9 linhas de uma lista que numa conta Xtream comum tem
// milhares de canais, e o único jeito de andar nela era ↓ uma vez por canal:
// do canal 40 ao 900 eram 860 toques. As duas teclas que qualquer um tenta no
// sofá — CH+/CH− para rolar de tela em tela e os dígitos para pular direto —
// eram engolidas com a lista aberta (o listener de teclas extras só ouvia a
// camada de controles), embora funcionassem com a lista fechada.
//
// Agora, com a lista aberta: CH± saltam uma página (9 linhas) e os dígitos
// levam o FOCO ao canal daquele número, sem trocar nada — quem confirma
// continua sendo o OK. O número pendente morre com a lista (fechar não pode
// trocar de canal "sozinho" 1,4 s depois) e com a seta ou o CH± (quem voltou a
// rolar mudou de ideia). Com o menu ⚙ aberto, CH± e dígitos seguem mudos.
//
// O teste monta o VideoPlayer DE VERDADE dentro de uma página que faz o que a
// LiveTV faz no onSwitchChannel, abre a lista pelo botão 📺 e aperta as teclas
// como a TV manda (keyCode de verdade), olhando qual linha acende.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { installFakeStorage } from '../../testing/fakeStorage';
import { epgService } from '../../services/epgService';
import { VideoPlayer, type PlayerChannel } from './VideoPlayer';

/** Pausa do digit-jump (DIGIT_TIMEOUT_MS no player). */
const DIGITO_MS = 1400;

const canais = (n: number): PlayerChannel[] =>
    Array.from({ length: n }, (_, i) => ({ stream_id: 1000 + i, num: i + 1, name: `Canal ${i + 1}` }));

let trocas: number[];

beforeEach(() => {
    installFakeStorage();
    vi.useFakeTimers();
    trocas = [];
    // jsdom não implementa mídia; o player só precisa que as chamadas existam.
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    // O "agora:" da linha focada vem do EPG: pendente de propósito, sem rede.
    vi.spyOn(epgService, 'getChannelEpg').mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.playing;
});

/** A LiveTV em miniatura: o onSwitchChannel troca o canal tocando. */
function Pagina({ lista, inicial = lista[0].stream_id }: { lista: PlayerChannel[]; inicial?: number }) {
    const [atual, setAtual] = useState(inicial);
    const canal = lista.find(c => c.stream_id === atual)!;
    return (
        <VideoPlayer
            src={`http://provedor.invalid/live/${atual}.ts`}
            title={canal.name}
            isLive
            contentType="live"
            channelList={lista}
            currentChannelId={atual}
            onSwitchChannel={(id) => { trocas.push(id); setAtual(id); }}
            onClose={() => {}}
        />
    );
}

const passar = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const tecla = (key: string, keyCode: number) => act(() => { fireEvent.keyDown(window, { key, keyCode }); });

/** Abre a lista 📺 pelo botão da barra (o mesmo que o OK no botão faz). */
const abrirLista = () => {
    const botao = document.querySelector('button[title="Lista de canais"]');
    expect(botao, 'botão 📺 não está na barra').not.toBeNull();
    act(() => { fireEvent.click(botao!); });
    expect(document.querySelector('.zap-overlay'), 'a lista 📺 não abriu').not.toBeNull();
};
const listaAberta = () => document.querySelector('.zap-overlay') !== null;

/** Número do canal com o foco na lista (a linha acesa). */
const focado = () => document.querySelector('.zap-item.focused .zap-num')?.textContent ?? null;

// Na TV real o `key` chega inútil e quem diz a tecla é o keyCode.
const chMenos = () => tecla('Unidentified', 428); // CH− = desce
const chMais = () => tecla('Unidentified', 427);  // CH+ = sobe
const digito = (d: string) => tecla('Unidentified', 48 + Number(d));
const digitar = (numero: string) => { for (const d of numero) digito(d); };
const ok = () => tecla('Enter', 13);
const voltar = () => tecla('XF86Back', 10009);
const baixo = () => tecla('ArrowDown', 40);
const cima = () => tecla('ArrowUp', 38);

/** Espiona os timers para provar que a pausa do dígito é DESARMADA. */
function espiarDigito() {
    const armar = vi.spyOn(window, 'setTimeout');
    const desarmar = vi.spyOn(window, 'clearTimeout');
    return {
        ultima: () => {
            const i = armar.mock.calls.map(([, ms]) => ms).lastIndexOf(DIGITO_MS);
            expect(i, 'o dígito não armou a pausa').toBeGreaterThanOrEqual(0);
            return armar.mock.results[i].value as ReturnType<typeof setTimeout>;
        },
        desarmou: (timer: ReturnType<typeof setTimeout>) => desarmar.mock.calls.some(([t]) => t === timer),
    };
}

describe('VideoPlayer — lista 📺: CH± saltam uma página', () => {
    it('CH− desce 9 linhas e CH+ sobe 9, sem trocar de canal', () => {
        render(<Pagina lista={canais(40)} />);
        abrirLista();
        expect(focado()).toBe('1');
        // A dica da lista conta as teclas novas, como os painéis vizinhos
        expect(document.querySelector('.zap-overlay-hint')?.textContent).toContain('CH± Página');

        chMenos();
        expect(focado()).toBe('10');
        chMenos();
        expect(focado()).toBe('19');
        chMais();
        expect(focado()).toBe('10');

        // Rolar a lista não é trocar de canal: nem na hora, nem depois
        passar(10_000);
        expect(trocas).toEqual([]);
        expect(listaAberta()).toBe(true);
    });

    it('para nas pontas em vez de dar a volta', () => {
        render(<Pagina lista={canais(20)} />);
        abrirLista();

        chMais();
        expect(focado()).toBe('1');
        chMenos();
        chMenos();
        chMenos();
        expect(focado()).toBe('20');
    });

    it('PageDown/PageUp do teclado fazem o mesmo', () => {
        render(<Pagina lista={canais(40)} />);
        abrirLista();

        tecla('PageDown', 34);
        expect(focado()).toBe('10');
        tecla('PageUp', 33);
        expect(focado()).toBe('1');
    });

    it('OK depois do salto assiste o canal focado', () => {
        const lista = canais(40);
        render(<Pagina lista={lista} />);
        abrirLista();

        chMenos();
        ok();
        expect(trocas).toEqual([lista[9].stream_id]);
        expect(listaAberta()).toBe(false);
    });
});

describe('VideoPlayer — lista 📺: dígitos levam o foco ao canal', () => {
    it('digitar o número move o foco pra ele depois da pausa, sem trocar; o OK confirma', () => {
        const lista = canais(40);
        render(<Pagina lista={lista} />);
        abrirLista();

        digitar('27');
        // O número aparece na hora, como com a lista fechada
        expect(document.querySelector('.digit-osd')?.textContent).toBe('27');
        passar(DIGITO_MS);
        expect(focado()).toBe('27');
        expect(document.querySelector('.digit-osd')).toBeNull();
        // Mover o foco não é trocar de canal
        passar(10_000);
        expect(trocas).toEqual([]);
        expect(listaAberta()).toBe(true);

        ok();
        expect(trocas).toEqual([lista[26].stream_id]);
    });

    it('OK antes da pausa assiste direto o canal digitado', () => {
        const lista = canais(40);
        render(<Pagina lista={lista} />);
        abrirLista();
        const espera = espiarDigito();

        digitar('33');
        const timer = espera.ultima();
        ok();
        expect(trocas).toEqual([lista[32].stream_id]);
        expect(listaAberta()).toBe(false);
        expect(espera.desarmou(timer), 'o OK não desarmou a pausa do dígito').toBe(true);

        passar(10 * DIGITO_MS);
        expect(trocas).toEqual([lista[32].stream_id]);
    });

    it('acha o canal mesmo com o num vindo como string do painel Xtream', () => {
        // Muitos painéis mandam "num":"27" no JSON; o tipo diz number, o dado não
        const lista = canais(40).map(c => ({ ...c, num: String(c.num) as unknown as number }));
        render(<Pagina lista={lista} />);
        abrirLista();

        digitar('27');
        passar(DIGITO_MS);
        expect(focado()).toBe('27');
        digitar('33');
        ok();
        expect(trocas).toEqual([lista[32].stream_id]);
    });

    it('número que não existe na lista deixa o foco onde estava', () => {
        const lista = canais(40);
        render(<Pagina lista={lista} />);
        abrirLista();
        chMenos(); // foco no 10

        digitar('999');
        passar(DIGITO_MS);
        expect(focado()).toBe('10');

        // ...e o OK com número inexistente pendente não troca pra canal nenhum
        digitar('555');
        ok();
        expect(trocas).toEqual([]);
        expect(listaAberta()).toBe(true);
        // O OK consumiu o número: ele some da tela na hora, não 1,4 s depois
        expect(document.querySelector('.digit-osd')).toBeNull();
        expect(focado()).toBe('10');
    });

    it('fechar a lista com número pendente descarta o número e desarma a pausa', () => {
        render(<Pagina lista={canais(40)} />);
        abrirLista();
        const espera = espiarDigito();

        digitar('30');
        const timer = espera.ultima();
        voltar();
        expect(listaAberta()).toBe(false);
        expect(document.querySelector('.digit-osd')).toBeNull();
        expect(espera.desarmou(timer), 'fechar a lista não desarmou a pausa do dígito').toBe(true);

        // Com a lista fechada ninguém pediu troca: o número não vira canal
        passar(10 * DIGITO_MS);
        expect(trocas).toEqual([]);
    });

    it('usar a seta depois do dígito descarta o número: o foco não é puxado depois', () => {
        render(<Pagina lista={canais(40)} />);
        abrirLista();

        digitar('30');
        baixo();
        expect(document.querySelector('.digit-osd')).toBeNull();
        passar(10 * DIGITO_MS);
        expect(focado()).toBe('2');
        expect(trocas).toEqual([]);
    });

    it('a seta pra CIMA também descarta o número, não só a de baixo', () => {
        render(<Pagina lista={canais(40)} />);
        abrirLista();
        chMenos(); // foco no 10

        digitar('30');
        cima();
        expect(document.querySelector('.digit-osd')).toBeNull();
        passar(10 * DIGITO_MS);
        expect(focado()).toBe('9');
        expect(trocas).toEqual([]);
    });

    it('CH± depois do dígito também descarta o número e desarma a pausa', () => {
        render(<Pagina lista={canais(40)} />);
        abrirLista();
        const espera = espiarDigito();

        digitar('30');
        const timer = espera.ultima();
        chMenos();
        expect(document.querySelector('.digit-osd')).toBeNull();
        expect(espera.desarmou(timer), 'o CH± não desarmou a pausa do dígito').toBe(true);
        passar(10 * DIGITO_MS);
        expect(focado()).toBe('10');
        expect(trocas).toEqual([]);
    });

    it('com o menu ⚙ aberto, CH± e dígitos continuam mudos (não zapeiam por baixo)', () => {
        render(<Pagina lista={canais(40)} />);
        const opcoes = document.querySelector('button[title="Opções"]');
        expect(opcoes, 'botão ⚙ não está na barra').not.toBeNull();
        act(() => { fireEvent.click(opcoes!); });
        expect(document.querySelector('.quality-menu-item'), 'o menu ⚙ não abriu').not.toBeNull();

        chMenos();
        digitar('12');
        expect(document.querySelector('.digit-osd')).toBeNull();
        passar(10 * DIGITO_MS);
        expect(trocas).toEqual([]);
    });

    it('com a lista FECHADA o dígito continua trocando de canal', () => {
        const lista = canais(40);
        render(<Pagina lista={lista} />);

        digitar('12');
        passar(DIGITO_MS);
        expect(trocas).toEqual([lista[11].stream_id]);
    });

    it('dígito digitado na barra não vira salto na lista aberta logo depois: é descartado', () => {
        render(<Pagina lista={canais(40)} />);

        digitar('12');
        abrirLista();
        passar(10 * DIGITO_MS);
        expect(focado()).toBe('1');
        expect(trocas).toEqual([]);
    });
});
