// @vitest-environment jsdom
//
// 📺 Logos de canal na TV ao vivo: o que faltava e o que custava caro.
//
// 1) Canal SEM logo (`stream_icon: ''`, comum em lista de IPTV) montava
//    `<img src="">`. O React 19 não põe `src` vazio no DOM (tira o atributo e
//    reclama no console), e um <img> sem `src` nunca dispara `error` — então o
//    card nunca caía no 📺: ficava com o texto do `alt` no lugar do logo, na
//    grade e na ficha do canal.
// 2) Canal com URL de logo QUEBRADA: cada `error` chega num evento separado e
//    virava um `setState` separado — a página inteira (todos os cards da
//    grade) repintava uma vez por logo. Agora os ids se acumulam e entram no
//    estado de uma vez, numa janela fixa de 100 ms contada do PRIMEIRO erro.
//
// O teste monta a página DE VERDADE (só a rede do provedor é falsa) e conta
// os commits do React com um <Profiler> em volta dela.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Profiler } from 'react';
import { render, cleanup, act, waitFor, fireEvent } from '@testing-library/react';
import { installFakeStorage } from '../testing/fakeStorage';
import { api } from '../services/api';
import { epgService } from '../services/epgService';
import type { LiveStream, Category } from '../types';
import { LiveTV } from './LiveTV';

function canal(stream_id: number, stream_icon: string): LiveStream {
    return {
        // `num` é a posição na lista do provedor, não o id: diferente de
        // propósito, pra que marcar/consultar o logo pelo campo errado apareça.
        num: stream_id + 100,
        name: `Canal ${stream_id}`,
        stream_type: 'live',
        stream_id,
        stream_icon,
        epg_channel_id: '',
        added: '',
        category_id: '1',
        custom_sid: '',
        tv_archive: 0,
        direct_source: '',
        tv_archive_duration: 0,
    };
}

const CATEGORIAS: Category[] = [{ category_id: '1', category_name: 'Teste', parent_id: 0 }];

let commits = 0;

async function abrir(canais: LiveStream[]) {
    vi.spyOn(api, 'getLiveStreams').mockResolvedValue(canais);
    vi.spyOn(api, 'getLiveCategories').mockResolvedValue(CATEGORIAS);
    vi.spyOn(epgService, 'getChannelEpg').mockResolvedValue({ now: null, next: null, programs: [] });
    const tela = render(
        <Profiler id="livetv" onRender={() => { commits++; }}>
            <LiveTV />
        </Profiler>,
    );
    await waitFor(() => expect(document.querySelectorAll('.channel-card')).toHaveLength(canais.length));
    // Esvazia os efeitos pendentes da carga antes de medir.
    await act(async () => { await Promise.resolve(); });
    return tela;
}

/** Abre a ficha do canal na posição `i` da grade e espera ela aparecer. */
async function abrirFicha(i: number) {
    act(() => { fireEvent.click(cards()[i]); });
    await waitFor(() => expect(document.querySelector('.preview-placeholder')).not.toBeNull());
    await act(async () => { await Promise.resolve(); });
    return document.querySelector('.preview-placeholder')!;
}

const cards = () => Array.from(document.querySelectorAll<HTMLElement>('.channel-card'));
const placeholders = () => document.querySelectorAll('.channel-card .channel-placeholder');
const imgDoCard = (i: number) => cards()[i].querySelector('img');

beforeEach(() => {
    installFakeStorage();
    sessionStorage.clear();
    commits = 0;
});

afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
});

describe('TV ao vivo: logos de canal', () => {
    it('canal SEM logo mostra o 📺 direto, sem montar <img>', async () => {
        const erros = vi.spyOn(console, 'error');
        await abrir([canal(1, ''), canal(2, 'http://provedor.invalid/2.png'), canal(3, '')]);

        const [semLogo1, comLogo, semLogo3] = cards();
        expect(semLogo1.querySelector('img'), 'canal sem logo não pode montar <img>').toBeNull();
        expect(semLogo1.querySelector('.channel-placeholder')).not.toBeNull();
        expect(semLogo3.querySelector('img')).toBeNull();
        expect(semLogo3.querySelector('.channel-placeholder')).not.toBeNull();

        const img = comLogo.querySelector('img');
        expect(img).not.toBeNull();
        expect(img!.getAttribute('src')).toBe('http://provedor.invalid/2.png');
        expect(comLogo.querySelector('.channel-placeholder')).toBeNull();

        const srcVazio = erros.mock.calls.filter(c => String(c[0]).includes('An empty string ("") was passed'));
        expect(srcVazio, 'o React reclamou de src vazio').toHaveLength(0);
    });

    it('a ficha de um canal sem logo também mostra o 📺, sem montar <img>', async () => {
        await abrir([canal(1, ''), canal(2, 'http://provedor.invalid/2.png')]);

        const ficha = await abrirFicha(0);
        expect(ficha.querySelector('img')).toBeNull();
        expect(ficha.querySelector('.placeholder-emoji')).not.toBeNull();
    });

    it('uma rajada de logos quebrados vira UM render, não um por logo', async () => {
        const QUEBRADOS = 8;
        const canais = Array.from({ length: QUEBRADOS }, (_, i) => canal(i + 1, `http://provedor.invalid/${i + 1}.png`));
        await abrir(canais);
        expect(placeholders()).toHaveLength(0);

        const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.channel-card img'));
        expect(imgs).toHaveLength(QUEBRADOS);

        commits = 0;
        // Cada `error` chega num evento separado, como no navegador.
        for (const img of imgs) {
            act(() => { fireEvent.error(img); });
        }
        await waitFor(() => expect(placeholders()).toHaveLength(QUEBRADOS));

        expect(commits, `${QUEBRADOS} logos quebrados custaram ${commits} renders da página`).toBe(1);
        expect(document.querySelectorAll('.channel-card img')).toHaveLength(0);
    });

    it('a janela é FIXA: conta do primeiro erro e não se estende com os seguintes', async () => {
        await abrir([1, 2, 3, 4].map(id => canal(id, `http://provedor.invalid/${id}.png`)));
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        commits = 0;

        // Erros espalhados no tempo, como chegam da rede: t=0, t=40, t=80.
        act(() => { fireEvent.error(imgDoCard(0)!); });
        act(() => { vi.advanceTimersByTime(40); });
        act(() => { fireEvent.error(imgDoCard(1)!); });
        act(() => { vi.advanceTimersByTime(40); });
        act(() => { fireEvent.error(imgDoCard(2)!); });
        act(() => { vi.advanceTimersByTime(19); }); // t=99
        expect(placeholders(), 'repassou antes da janela fechar').toHaveLength(0);
        expect(commits).toBe(0);

        act(() => { vi.advanceTimersByTime(1); }); // t=100
        expect(placeholders(), 'a janela não fechou em 100 ms').toHaveLength(3);
        expect(commits).toBe(1);
        expect(imgDoCard(3), 'o canal com logo bom não pode cair no 📺').not.toBeNull();

        // Os erros de t=40 e t=80 não podem ter aberto janelas próprias.
        act(() => { vi.advanceTimersByTime(500); });
        expect(commits, 'sobrou repasse armado depois da janela').toBe(1);
    });

    it('uma segunda leva de erros, depois do repasse, também vira 📺 e não desfaz a primeira', async () => {
        await abrir([canal(1, 'http://provedor.invalid/1.png'), canal(2, 'http://provedor.invalid/2.png'), canal(3, 'http://provedor.invalid/3.png')]);

        act(() => { fireEvent.error(imgDoCard(0)!); });
        await waitFor(() => expect(placeholders()).toHaveLength(1));

        commits = 0;
        act(() => { fireEvent.error(imgDoCard(1)!); });
        await waitFor(() => expect(placeholders()).toHaveLength(2));

        expect(commits).toBe(1);
        expect(cards()[0].querySelector('.channel-placeholder'), 'a 2ª leva apagou a 1ª').not.toBeNull();
        expect(cards()[1].querySelector('.channel-placeholder')).not.toBeNull();
        expect(imgDoCard(2)).not.toBeNull();
    });

    it('o logo quebrado só na FICHA também cai no 📺 (ficha e card)', async () => {
        await abrir([canal(1, 'http://provedor.invalid/1.png'), canal(2, 'http://provedor.invalid/2.png')]);
        const ficha = await abrirFicha(0);
        const imgFicha = ficha.querySelector('img');
        expect(imgFicha).not.toBeNull();

        act(() => { fireEvent.error(imgFicha!); });
        await waitFor(() => expect(document.querySelector('.preview-placeholder .placeholder-emoji')).not.toBeNull());

        expect(document.querySelector('.preview-placeholder img')).toBeNull();
        expect(cards()[0].querySelector('.channel-placeholder')).not.toBeNull();
        expect(imgDoCard(1)).not.toBeNull();
    });

    it('o mesmo logo quebrado na grade e na ficha não conta duas vezes', async () => {
        await abrir([canal(1, 'http://provedor.invalid/1.png'), canal(2, 'http://provedor.invalid/2.png')]);
        await abrirFicha(0);
        expect(document.querySelector('.preview-placeholder img')).not.toBeNull();

        commits = 0;
        act(() => { fireEvent.error(imgDoCard(0)!); });
        act(() => { fireEvent.error(document.querySelector('.preview-placeholder img')!); });
        await waitFor(() => expect(placeholders()).toHaveLength(1));

        expect(commits).toBe(1);
        expect(document.querySelector('.preview-placeholder .placeholder-emoji')).not.toBeNull();
        expect(imgDoCard(1)).not.toBeNull();
    });

    it('sair da página com logos quebrados pendentes desarma o (único) timer', async () => {
        const tela = await abrir([canal(1, 'http://provedor.invalid/1.png'), canal(2, 'http://provedor.invalid/2.png')]);
        const imgs = [imgDoCard(0)!, imgDoCard(1)!];

        const armar = vi.spyOn(window, 'setTimeout');
        const desarmar = vi.spyOn(window, 'clearTimeout');
        for (const img of imgs) {
            act(() => { fireEvent.error(img); });
        }
        const armados = armar.mock.results.map(r => r.value as ReturnType<typeof setTimeout>);
        expect(armados, 'dois erros na mesma janela têm de armar UM repasse').toHaveLength(1);

        tela.unmount();

        expect(desarmar.mock.calls.map(c => c[0])).toContain(armados[0]);
    });
});
