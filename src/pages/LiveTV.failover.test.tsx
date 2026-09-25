// @vitest-environment jsdom
//
// 🧬 O failover de stream não pode depender de um botão de APRESENTAÇÃO.
//
// Quando o stream morre de vez, o player chama `onStreamFailed` e a TV ao vivo
// tenta outra variante do mesmo canal (ESPN FHD → HD → SD). Só que o mapa de
// variantes vinha do agrupamento da GRADE: com o 🧬 desligado ele era um Map
// vazio, e com o 🧬 ligado ele só enxergava os canais que sobreviveram aos
// filtros da tela (📅 só-EPG, categoria, busca). Nos dois casos o canal caía e
// o app não tentava nada — o usuário via o erro do player e tinha de voltar e
// achar a outra qualidade na mão. E quem começava na variante do MEIO (HD)
// nunca chegava à FHD: o failover só andava pra `variants[index + 1]`.
//
// O teste monta a página DE VERDADE. Só o player é trocado por um dublê — ele
// monta hls.js e o watchdog de reconexão, que não são o assunto aqui — e o
// dublê expõe exatamente o que o player de verdade entrega à página: a prop
// `onStreamFailed`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, waitFor, screen } from '@testing-library/react';
import { installFakeStorage } from '../testing/fakeStorage';
import { api } from '../services/api';
import { epgService } from '../services/epgService';
import { storage } from '../services/storage';
import { liveToggles, hiddenChannels, hiddenCategories } from '../services/liveExtras';
import type { LiveStream, Category } from '../types';

const dublê = vi.hoisted(() => ({
    onStreamFailed: undefined as undefined | (() => void),
    onSwitchChannel: undefined as undefined | ((streamId: number) => void),
}));

vi.mock('../components/VideoPlayer', () => ({
    VideoPlayer: (props: { title: string; onStreamFailed?: () => void; onSwitchChannel?: (streamId: number) => void }) => {
        dublê.onStreamFailed = props.onStreamFailed;
        dublê.onSwitchChannel = props.onSwitchChannel;
        return <div data-testid="player">{props.title}</div>;
    },
}));

import { LiveTV } from './LiveTV';

function canal(stream_id: number, name: string, extra: Partial<LiveStream> = {}): LiveStream {
    return {
        num: stream_id,
        name,
        stream_type: 'live',
        stream_id,
        stream_icon: 'http://provedor.invalid/logo.png',
        epg_channel_id: `epg.${stream_id}`,
        added: '',
        category_id: '1',
        custom_sid: '',
        tv_archive: 0,
        direct_source: '',
        tv_archive_duration: 0,
        ...extra,
    };
}

const CATEGORIAS: Category[] = [
    { category_id: '1', category_name: 'Esportes', parent_id: 0 },
    { category_id: '2', category_name: 'Esportes (outra região)', parent_id: 0 },
];

/** Abre a página já tocando `idInicial` (o caminho "ligar e assistir"). */
async function abrirTocando(canais: LiveStream[], idInicial: number, nomeInicial: string) {
    vi.spyOn(api, 'getLiveStreams').mockResolvedValue(canais);
    vi.spyOn(api, 'getLiveCategories').mockResolvedValue(CATEGORIAS);
    vi.spyOn(api, 'getLiveStreamUrl').mockImplementation(id => `http://provedor.invalid/live/${id}.ts`);
    vi.spyOn(epgService, 'getChannelEpg').mockResolvedValue({ now: null, next: null, programs: [] });
    storage.setLastChannel(idInicial);
    sessionStorage.setItem('neostream_autoplay_last', '1');

    render(<LiveTV />);
    await waitFor(() => expect(screen.getByTestId('player').textContent).toBe(nomeInicial));
}

/** O player desistiu do stream atual (reconexões esgotadas / 404). */
function streamMorreu() {
    const falhou = dublê.onStreamFailed;
    expect(falhou, 'o player tocando não recebeu onStreamFailed').toBeTypeOf('function');
    act(() => falhou!());
}

const tocando = () => screen.getByTestId('player').textContent;

const ESPN = [
    canal(1, 'ESPN FHD'),
    canal(2, 'ESPN HD'),
    canal(3, 'ESPN SD'),
    canal(4, 'Globo HD'),
];

beforeEach(() => {
    installFakeStorage();
    sessionStorage.clear();
    dublê.onStreamFailed = undefined;
    dublê.onSwitchChannel = undefined;
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('TV ao vivo: failover entre variantes', () => {
    it('com o 🧬 DESLIGADO o stream que cai ainda troca pra outra variante', async () => {
        liveToggles.setGroupVariants(false);
        await abrirTocando(ESPN, 1, 'ESPN FHD');

        streamMorreu();

        await waitFor(() => expect(tocando()).toBe('ESPN HD'));
        expect(screen.getByText(/trocando para HD/)).toBeTruthy();
    });

    it('com o 🧬 ligado, a variante escondida pelo filtro da grade também entra no failover', async () => {
        // 📅 só-EPG ligado e a FHD sem EPG: a grade nem mostra a FHD, mas ela
        // é justamente a que funciona quando a HD cai.
        liveToggles.setOnlyWithEpg(true);
        const canais = [canal(1, 'ESPN FHD', { epg_channel_id: '' }), canal(2, 'ESPN HD'), canal(4, 'Globo HD')];
        await abrirTocando(canais, 2, 'ESPN HD');

        streamMorreu();

        await waitFor(() => expect(tocando()).toBe('ESPN FHD'));
    });

    it('quem começou no MEIO (HD) passa por TODAS as variantes antes de desistir', async () => {
        await abrirTocando(ESPN, 2, 'ESPN HD');

        // A ordem de antes continua valendo (desce a qualidade primeiro)...
        streamMorreu();
        await waitFor(() => expect(tocando()).toBe('ESPN SD'));

        // ...mas o fim da lista não é o fim: a FHD, que ficou "atrás", ainda
        // não foi tentada nesta queda.
        streamMorreu();
        await waitFor(() => expect(tocando()).toBe('ESPN FHD'));

        // Agora sim acabou: nada de voltar pra uma que já caiu nesta queda.
        streamMorreu();
        await waitFor(() => expect(screen.getByText(/Todas as variantes deste canal falharam/)).toBeTruthy());
        expect(tocando()).toBe('ESPN FHD');
    });

    it('escolher um canal de novo zera as tentativas: a variante que caiu antes volta a valer', async () => {
        await abrirTocando(ESPN, 1, 'ESPN FHD');
        streamMorreu();
        await waitFor(() => expect(tocando()).toBe('ESPN HD'));
        streamMorreu();
        await waitFor(() => expect(tocando()).toBe('ESPN SD'));

        // O usuário zapeia pela lista do player (CH±/dígitos) e volta pra FHD:
        // é uma escolha dele, não uma queda — a memória da queda anterior não
        // pode fazer o próximo failover desistir de cara.
        const zapear = dublê.onSwitchChannel;
        expect(zapear, 'o player tocando não recebeu onSwitchChannel').toBeTypeOf('function');
        act(() => zapear!(1));
        await waitFor(() => expect(tocando()).toBe('ESPN FHD'));

        streamMorreu();
        await waitFor(() => expect(tocando()).toBe('ESPN HD'));
    });

    it('não troca pra um canal que o usuário OCULTOU', async () => {
        hiddenChannels.toggle(2);
        await abrirTocando(ESPN, 1, 'ESPN FHD');

        streamMorreu();

        await waitFor(() => expect(tocando()).toBe('ESPN SD'));
    });

    it('não troca pra um canal de uma CATEGORIA que o usuário ocultou', async () => {
        // Com o 🧬 ligado na visão "Todos" a grade já deixava a categoria
        // oculta de fora do agrupamento — o failover sobre o catálogo inteiro
        // não pode reabrir essa porta.
        hiddenCategories.toggle('2');
        const canais = [canal(1, 'ESPN FHD'), canal(2, 'ESPN HD', { category_id: '2' }), canal(3, 'ESPN SD')];
        await abrirTocando(canais, 1, 'ESPN FHD');

        streamMorreu();

        await waitFor(() => expect(tocando()).toBe('ESPN SD'));
    });

    it('quem está vendo um canal OCULTO de propósito ainda cai pra variante oculta ao lado', async () => {
        // O usuário abriu a própria categoria oculta (o caminho pra rever o
        // que escondeu): ali a grade mostra os ocultos, e o failover também.
        hiddenCategories.toggle('2');
        const canais = [
            canal(1, 'ESPN FHD'),
            canal(2, 'ESPN HD', { category_id: '2' }),
            canal(3, 'ESPN SD', { category_id: '2' }),
        ];
        await abrirTocando(canais, 2, 'ESPN HD');

        streamMorreu();

        await waitFor(() => expect(tocando()).toBe('ESPN SD'));
    });

    it('canal sem outra qualidade continua no erro do player, sem trocar de canal', async () => {
        await abrirTocando(ESPN, 4, 'Globo HD');

        streamMorreu();

        expect(tocando()).toBe('Globo HD');
        expect(screen.queryByText(/Falha no stream|Todas as variantes/)).toBeNull();
    });
});
