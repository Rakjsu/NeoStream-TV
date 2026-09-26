// @vitest-environment jsdom
//
// 🔴 O LiveTV.css arrancava o selo AO VIVO da fileira de controles do player (T130).
//
// O app vai para a TV como UM arquivo de CSS (a TV ao vivo é importada direto
// no App.tsx, sem code-splitting). O player e a ficha do canal usavam o MESMO
// nome de classe para coisas diferentes, e o LiveTV.css escrevia as regras
// SEM escopo:
//
//     LiveTV.css       .live-badge { position:absolute; top:12px; right:12px;
//                                    display:flex; font-size:11px;
//                                    animation: liveGlow 2s infinite; ... }
//                      .live-dot   { width:6px; height:6px; animation: liveDot ... }
//                      .loading-text { display:flex; gap:8px; margin-bottom:60px; ... }
//     VideoPlayer.css  .live-badge { display:inline-flex; ... }   (sem position)
//
// As regras se SOMAM. O que o player não contesta vinha da TV ao vivo:
//  - o selo AO VIVO saía da fileira de controles e ia para o canto de cima da
//    barra (position:absolute; top/right 12px), em cima da faixa do gradiente,
//    do outro lado da tela em relação aos botões;
//  - atrasado no ao vivo, o selo é o BOTÃO focável "VOLTAR AO VIVO": o D-pad
//    anda ←/→ pela fileira e o foco pula para um botão que não está nela. E a
//    animação liveGlow (box-shadow) passa por cima do anel de foco
//    (.live-badge-behind.focused pinta o anel com box-shadow; animação vence
//    declaração), então o botão focado nem mostra que está focado;
//  - o "Carregando..." do player ganhava display:flex e margin-bottom:60px,
//    empurrando o texto para longe do spinner.
// E no bundle de hoje o VideoPlayer.css vem ANTES do LiveTV.css: no que os
// dois disputam com a mesma especificidade, a TV ao vivo também vencia —
// pílula de 20px, fonte 11px e o fundo vermelho por cima do fundo de destaque
// do VOLTAR AO VIVO. Na ordem inversa quem perdia era a ficha do canal.
//
// O teste monta o VideoPlayer DE VERDADE e a TV ao vivo DE VERDADE, carrega
// TODAS as folhas de `src/` nas duas ordens (o resultado não pode depender de
// como o Vite concatena) e confere o estilo computado:
//  - player: o selo, o ponto, o botão focado e o "Carregando..." se pintam
//    EXATAMENTE como a folha do player sozinha os pinta;
//  - o player medido de dois jeitos: sozinho (como nas outras telas) e aberto
//    de DENTRO da TV ao vivo (sem portal, dentro do .livetv-page, com a ficha
//    do canal ao lado) — um escopo só aparente não passa no segundo;
//  - TV ao vivo: o selo da ficha do canal e o "Carregando canais" continuam
//    como estavam (o conserto não pode mexer no visual da página de canais),
//    inclusive no caminho da TV sem gap em flex.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { render, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { api } from '../../services/api';
import type { Category, LiveStream } from '../../types';
import { installFakeStorage } from '../../testing/fakeStorage';
import { FocusContext } from '../../contexts/FocusContext';
import { LiveTV } from '../../pages/LiveTV';
import { VideoPlayer } from './VideoPlayer';

// Sob jsdom o import.meta.url é http: o caminho parte do cwd (raiz do projeto).
const SRC = path.resolve('src');
const FOLHA_DO_PLAYER = path.join(SRC, 'components', 'VideoPlayer', 'VideoPlayer.css');

function folhasDeEstilo(dir: string): string[] {
    return readdirSync(dir).flatMap(nome => {
        const completo = path.join(dir, nome);
        if (statSync(completo).isDirectory()) return folhasDeEstilo(completo);
        return nome.endsWith('.css') ? [completo] : [];
    }).sort();
}

const FOLHAS = folhasDeEstilo(SRC);

let estilos: HTMLStyleElement[] = [];

/** Troca as folhas do documento. Folha que o jsdom não entende falha ALTO. */
function carregarFolhas(ordem: string[]): void {
    for (const s of estilos) s.remove();
    estilos = ordem.map(caminho => {
        const el = document.createElement('style');
        el.textContent = readFileSync(caminho, 'utf-8');
        document.head.appendChild(el);
        if ((el.sheet?.cssRules.length ?? 0) === 0) {
            throw new Error(`o jsdom não leu ${path.relative(SRC, caminho)} — o teste estaria medindo sem ela`);
        }
        return el;
    });
}

function descarregarFolhas(): void {
    for (const s of estilos) s.remove();
    estilos = [];
}

/**
 * O que a folha de uma página pode vazar para o selo, o ponto e o texto de
 * carregamento: posição, caixa, tipografia, respiro e animação.
 */
const PROPRIEDADES = [
    'position', 'top', 'right', 'bottom', 'left',
    'display', 'width', 'height',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'font-size', 'font-weight', 'letter-spacing', 'border-radius',
    'box-shadow', 'animation', 'animation-name', 'background', 'background-image', 'background-color',
] as const;

type Pintura = Record<string, string>;

function pintura(el: Element): Pintura {
    const s = getComputedStyle(el);
    return Object.fromEntries(PROPRIEDADES.map(p => [p, s.getPropertyValue(p).trim()]));
}

function unico(seletor: string): HTMLElement {
    const achados = document.querySelectorAll<HTMLElement>(seletor);
    expect(achados.length, `esperava exatamente 1 "${seletor}" na tela`).toBe(1);
    return achados[0];
}

/**
 * Pinta os elementos só com a folha do player (a referência: é assim que o
 * VideoPlayer.css os desenha) e depois com TODAS as folhas na ordem dada.
 */
function pinturas(seletores: string[], ordem: string[]) {
    const els = seletores.map(unico);
    carregarFolhas([FOLHA_DO_PLAYER]);
    const soDoPlayer = els.map(pintura);
    carregarFolhas(ordem);
    const comTudo = els.map(pintura);
    return { soDoPlayer, comTudo };
}

const ORDENS: Array<[string, string[]]> = [
    ['ordem alfabética', FOLHAS],
    ['ordem invertida', [...FOLHAS].reverse()],
];

/** Intervalo do vigia do player: é ele que decide "atrasado no ao vivo". */
const VIGIA_MS = 4000;

const tecla = (key: string, keyCode: number) =>
    act(() => { fireEvent.keyDown(window, { key, keyCode }); });

function Player() {
    return (
        <FocusContext.Provider value={{ focusZone: 'content', setFocusZone: () => {} }}>
            <VideoPlayer
                src="http://provedor.invalid/live/100.ts"
                title="Canal 1"
                isLive
                contentType="live"
                onClose={() => {}}
            />
        </FocusContext.Provider>
    );
}

beforeAll(() => {
    // jsdom não implementa scrollIntoView/scrollTo; as páginas chamam.
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () { /* jsdom */ };
    if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function () { /* jsdom */ } as typeof Element.prototype.scrollTo;
});

afterEach(() => {
    cleanup();
    descarregarFolhas();
    document.documentElement.classList.remove('no-flex-gap');
    delete document.documentElement.dataset.playing;
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe.each(ORDENS)('player ao vivo: a folha da TV ao vivo não repinta o selo (%s)', (_nome, ordem) => {
    beforeEach(() => {
        installFakeStorage();
        vi.useFakeTimers();
        // jsdom não implementa mídia; o player só precisa que as chamadas existam.
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    });

    it('selo AO VIVO na fileira de controles: fica EM FLUXO, pintado só pela folha do player', () => {
        render(<Player />);
        const seletores = ['.video-player-controls .live-badge', '.video-player-controls .live-dot'];
        const { soDoPlayer, comTudo } = pinturas(seletores, ordem);

        // Controle: a referência é o selo em fluxo, na fileira dos botões
        expect(soDoPlayer[0].position, 'a folha do player sozinha tirou o selo da fileira').toBe('static');
        expect(comTudo[0].position, 'o selo AO VIVO saiu da fileira de controles').toBe('static');
        expect(comTudo).toEqual(soDoPlayer);

        // Tizen 5.5 (sem gap em flex): o fallback do selo do player continua
        document.documentElement.classList.add('no-flex-gap');
        const texto = document.querySelector('.video-player-controls .live-badge > .live-dot + *');
        if (!texto) throw new Error('selo do player sem o texto depois do ponto');
        expect(getComputedStyle(texto).marginLeft).toBe('6px');
    });

    it('botão VOLTAR AO VIVO focado: fica na fileira, sem a animação que apaga o anel de foco', () => {
        render(<Player />);
        // O vídeo do jsdom está sempre pausado: na 1ª volta do vigia o player
        // se considera atrasado e o selo vira o botão focável.
        act(() => { vi.advanceTimersByTime(VIGIA_MS); });
        const botao = unico('.video-player-controls .live-badge-behind');
        expect(botao.tagName).toBe('BUTTON');

        // O foco começa no ▶; → anda para o próximo da fileira: o VOLTAR AO VIVO
        tecla('ArrowRight', 39);
        expect(botao.classList.contains('focused'), 'o D-pad não chegou no VOLTAR AO VIVO').toBe(true);

        const seletores = ['.live-badge-behind.focused', '.live-badge-behind .live-dot'];
        const { soDoPlayer, comTudo } = pinturas(seletores, ordem);

        // O anel de foco é box-shadow; uma animação de box-shadow passa por cima
        // dele. (O jsdom não expande o atalho `animation` em `animation-name`:
        // a comparação é pelo atalho.)
        expect(comTudo[0].animation, 'o anel de foco está debaixo de uma animação')
            .toBe(soDoPlayer[0].animation);
        expect(comTudo[0].position, 'o botão focado saiu da fileira de controles').toBe('static');
        expect(comTudo).toEqual(soDoPlayer);
    });

    it('"Carregando..." do player: não herda o flex nem o respiro de 60px da TV ao vivo', () => {
        render(<Player />);
        const { soDoPlayer, comTudo } = pinturas(['.video-player-loading .loading-text'], ordem);

        expect(comTudo[0]['margin-bottom']).toBe(soDoPlayer[0]['margin-bottom']);
        expect(comTudo).toEqual(soDoPlayer);
    });
});

// ---- dados do provedor (falsos) para montar a TV ao vivo ----

const CATEGORIAS: Category[] = [{ category_id: '1', category_name: 'Teste', parent_id: 0 }];
const CANAIS = Array.from({ length: 4 }, (_, i) => ({
    num: i + 1,
    name: `Canal ${i + 1}`,
    stream_type: 'live',
    stream_id: 1000 + i,
    stream_icon: '',
    epg_channel_id: '',
    added: '',
    category_id: '1',
    custom_sid: '',
    tv_archive: 0,
    direct_source: '',
    tv_archive_duration: 0,
})) as unknown as LiveStream[];

/** Provedor que nunca responde: a página fica na tela de "Carregando canais". */
const nuncaResponde = () => new Promise<never>(() => { /* pendurado de propósito */ });

// ---- o player como o usuário chega nele: aberto de DENTRO da TV ao vivo ----
//
// Não há portal: o <VideoPlayer> da TV ao vivo é renderizado dentro do
// .livetv-page, e a ficha do canal (.channel-preview) continua na tela ao
// lado dele. Um "escopo" que só parecesse certo (ex.: `.livetv-page .live-badge`)
// passaria no player montado sozinho e continuaria quebrando justamente aqui.

function mockarProvedor() {
    vi.spyOn(api, 'getLiveStreams').mockResolvedValue(CANAIS);
    vi.spyOn(api, 'getLiveCategories').mockResolvedValue(CATEGORIAS);
    vi.spyOn(api, 'getShortEpg').mockResolvedValue({ epg_listings: [] });
    vi.spyOn(api, 'getSimpleDataTable').mockResolvedValue({ epg_listings: [] });
}

/** TV ao vivo → clica no canal (abre a ficha) → ▶ Assistir → player na tela. */
async function abrirPlayerPelaTvAoVivo(): Promise<void> {
    mockarProvedor();
    render(<LiveTV />);
    await waitFor(() => expect(document.querySelectorAll('.channel-card').length).toBeGreaterThan(0));
    fireEvent.click(document.querySelectorAll('.channel-card')[0]);
    await waitFor(() => expect(document.querySelector('.channel-preview .play-button')).not.toBeNull());
    fireEvent.click(document.querySelector('.channel-preview .play-button')!);
    await waitFor(() => expect(document.querySelector('.video-player-controls')).not.toBeNull());
    // O player está DENTRO da página e a ficha do canal segue ao lado dele
    expect(document.querySelector('.livetv-page .video-player-controls')).not.toBeNull();
    expect(document.querySelector('.channel-preview .live-badge')).not.toBeNull();
}

describe.each(ORDENS)('player aberto pela TV ao vivo: o selo continua na fileira (%s)', (_nome, ordem) => {
    beforeEach(() => {
        installFakeStorage();
        // shouldAdvanceTime: o waitFor da página anda; o vigia de 4 s do player
        // só dispara quando o teste avança o relógio
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    });

    it('selo AO VIVO e "Carregando..." do player: pintados só pela folha do player', async () => {
        await abrirPlayerPelaTvAoVivo();
        const seletores = [
            '.video-player-controls .live-badge',
            '.video-player-controls .live-dot',
            '.video-player-loading .loading-text',
        ];
        const { soDoPlayer, comTudo } = pinturas(seletores, ordem);

        expect(comTudo[0].position, 'o selo AO VIVO saiu da fileira de controles').toBe('static');
        expect(comTudo[2]['margin-bottom'], '"Carregando..." herdou o respiro da página').toBe(soDoPlayer[2]['margin-bottom']);
        expect(comTudo).toEqual(soDoPlayer);
    });

    it('botão VOLTAR AO VIVO focado: na fileira e com o anel de foco à mostra', async () => {
        await abrirPlayerPelaTvAoVivo();
        act(() => { vi.advanceTimersByTime(VIGIA_MS); });
        const botao = unico('.video-player-controls .live-badge-behind');
        expect(botao.tagName).toBe('BUTTON');

        tecla('ArrowRight', 39);
        expect(botao.classList.contains('focused'), 'o D-pad não chegou no VOLTAR AO VIVO').toBe(true);

        const { soDoPlayer, comTudo } = pinturas(['.live-badge-behind.focused', '.live-badge-behind .live-dot'], ordem);
        expect(comTudo[0].animation, 'o anel de foco está debaixo de uma animação').toBe(soDoPlayer[0].animation);
        expect(comTudo[0].position, 'o botão focado saiu da fileira de controles').toBe('static');
        expect(comTudo).toEqual(soDoPlayer);
    });
});

// ---- a página de canais não pode mudar de visual com o conserto ----

describe.each(ORDENS)('TV ao vivo: o selo da ficha e o "Carregando canais" continuam iguais (%s)', (_nome, ordem) => {
    beforeEach(() => {
        installFakeStorage();
        // O afterEach global descarrega as folhas; esta parte mede com todas
        carregarFolhas(ordem);
    });

    it('selo AO VIVO da ficha do canal: preso no canto da prévia, pulsando', async () => {
        mockarProvedor();
        render(<LiveTV />);
        await waitFor(() => expect(document.querySelectorAll('.channel-card').length).toBeGreaterThan(0));
        fireEvent.click(document.querySelectorAll('.channel-card')[0]);
        await waitFor(() => expect(document.querySelector('.channel-preview')).not.toBeNull());

        const selo = pintura(unico('.channel-preview .preview-video .live-badge'));
        expect(selo.position).toBe('absolute');
        expect(selo.top).toBe('12px');
        expect(selo.right).toBe('12px');
        expect(selo.display).toBe('flex');
        expect(selo['font-size']).toBe('11px');
        expect(`${selo.animation} ${selo['animation-name']}`).toContain('liveGlow');

        const ponto = pintura(unico('.channel-preview .preview-video .live-dot'));
        expect(ponto.width).toBe('6px');
        expect(ponto.height).toBe('6px');
        expect(`${ponto.animation} ${ponto['animation-name']}`).toContain('liveDot');

        // Tizen 5.5 (sem gap em flex): o texto AO VIVO a 6px do ponto
        document.documentElement.classList.add('no-flex-gap');
        const texto = document.querySelector('.channel-preview .live-badge > .live-dot + *');
        if (!texto) throw new Error('selo da ficha sem o texto depois do ponto');
        expect(getComputedStyle(texto).marginLeft).toBe('6px');
    });

    it('"Carregando canais": linha flex com respiro de 60px — e, sem gap em flex, os pontos a 8px do texto', async () => {
        vi.spyOn(api, 'getLiveStreams').mockImplementation(nuncaResponde);
        vi.spyOn(api, 'getLiveCategories').mockImplementation(nuncaResponde);
        render(<LiveTV />);
        await waitFor(() => expect(document.querySelector('.livetv-loading-container')).not.toBeNull());

        const texto = unico('.livetv-loading-container .loading-text');
        const s = pintura(texto);
        expect(s.display).toBe('flex');
        expect(s['margin-bottom']).toBe('60px');
        expect(s['font-size']).toBe('18px');

        // O caminho do Tizen 5.5: o boot põe esta classe quando o motor não tem gap em flex
        document.documentElement.classList.add('no-flex-gap');
        const pontos = texto.querySelector('.loading-dots');
        if (!pontos) throw new Error('"Carregando canais" sem .loading-dots');
        expect(getComputedStyle(pontos).marginLeft).toBe('8px');
    });
});
