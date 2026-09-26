// @vitest-environment jsdom
//
// T132 — na Home o foco não era reancorado quando a fileira "Continuar
// Assistindo" mudava por baixo dele, na volta do player.
//
// O foco da Home é (id da seção, índice do card). Assistir um card da
// fileira e voltar muda a fileira: o filme que ACABOU sai dela, o que foi
// só adiantado vai pra FRENTE (a ordem é "mais recente primeiro"). O índice
// ficava onde estava:
//   - a fileira encolheu → o índice apontava pra fora dela: nenhum card com
//     realce e o OK não fazia nada;
//   - a fileira sumiu → o id 'continue' saía da lista e o foco caía nos
//     contadores do topo ("Canais"), onde o OK abre a TV ao Vivo;
//   - a fileira se reordenou → o realce ficava num OUTRO título.
//
// A Home é a de verdade (e a fila de episódios também); só a rede e os
// players são substituídos. O player falso é um botão que devolve a Home
// (onClose), como o Voltar do controle.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { installFakeStorage } from '../testing/fakeStorage';
import { api } from '../services/api';
import { progressService } from '../services/progressService';
import { Home } from './Home';

// A Home só usa o `MoviePlayer` deste módulo
vi.mock('../components/MoviePlayer', () => ({
    MoviePlayer: ({ title, onClose }: { title: string; onClose: () => void }) => (
        <button className="player-falso" onClick={onClose}>{title}</button>
    ),
}));
// ...e só o `SeriesQueuePlayer` deste
vi.mock('../components/SeriesQueuePlayer', () => ({
    SeriesQueuePlayer: ({ queue, onClose }: { queue: { seriesName: string }; onClose: () => void }) => (
        <button className="player-falso" onClick={onClose}>{queue.seriesName}</button>
    ),
}));

/** Dispara uma tecla como a TV dispara (keyCode; o `key` vem vazio no Tizen). */
function tecla(keyCode: number): void {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '', keyCode, bubbles: true, cancelable: true }));
    });
}
const BAIXO = 40;
const DIREITA = 39;
const ESQUERDA = 37;
const OK = 13;

let relogio = 1_000_000;
/** Grava progresso com updatedAt crescente (o último salvo é o 1º da fileira). */
function assistiu(id: string, nome: string, time: number): void {
    const now = vi.spyOn(Date, 'now').mockReturnValue(relogio += 1000);
    progressService.saveMovie({ id, name: nome, poster: `${id}.jpg`, time, duration: 7200 });
    now.mockRestore();
}
const emProgresso = (id: string, nome: string) => assistiu(id, nome, 600);
/** Chegou aos créditos: o filme sai do "Continuar Assistindo". */
const terminou = (id: string, nome: string) => assistiu(id, nome, 7190);

function serieEmProgresso(seriesId: string, nome: string, episode: number): void {
    const now = vi.spyOn(Date, 'now').mockReturnValue(relogio += 1000);
    progressService.saveSeries({
        seriesId, seriesName: nome, poster: `${seriesId}.jpg`, season: 1, episode,
        episodeId: `${seriesId}-e${episode}`, time: 600, duration: 2700,
    });
    now.mockRestore();
}

const titulos = () => Array.from(document.querySelectorAll('#home-continue .content-card .card-title'))
    .map(t => t.textContent?.trim() ?? '');
const focado = () => document.querySelector('#home-continue .tv-focused .card-title')?.textContent?.trim() ?? null;
const player = () => document.querySelector('.player-falso')?.textContent ?? null;

async function montarHome(onNavigate: (pagina: string) => void = () => {}): Promise<void> {
    render(<Home onNavigate={onNavigate} onRequestExit={() => {}} onCancelExit={() => {}} />);
    // Espera o fetch terminar (os contadores saem do "...")
    await waitFor(() => {
        expect(document.querySelector('.stat-card-live .stat-value')?.textContent).toBe('0');
    });
    // O ouvinte do useTVNavigation é re-registrado num efeito: esvazia antes
    // de apertar a primeira tecla
    await act(async () => { await Promise.resolve(); });
}

/** Volta do player (o Voltar do controle chama o onClose). */
async function fecharPlayer(): Promise<void> {
    const botao = document.querySelector<HTMLButtonElement>('.player-falso');
    expect(botao).not.toBeNull();
    act(() => { botao!.click(); });
    expect(player()).toBeNull();
    // o useTVNavigation volta a ser habilitado num efeito
    await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
    installFakeStorage();
    // jsdom não implementa scrollIntoView, e a Home rola a cada mudança de foco
    Element.prototype.scrollIntoView = function () { /* jsdom */ };
    vi.spyOn(api, 'getLiveStreams').mockResolvedValue([]);
    vi.spyOn(api, 'getVODStreams').mockResolvedValue([]);
    vi.spyOn(api, 'getSeries').mockResolvedValue([]);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Home — o foco acompanha a fileira "Continuar Assistindo" na volta do player', () => {
    it('o filme da PONTA acabou: a fileira encolhe e o foco vai pro novo último card (e o OK toca ele)', async () => {
        for (let i = 0; i < 3; i++) emProgresso(`f${i}`, `Filme ${i}`);
        await montarHome();

        tecla(BAIXO);
        tecla(DIREITA);
        tecla(DIREITA);
        expect(focado()).toBe('Filme 0');
        tecla(OK);
        expect(player()).toBe('Filme 0');

        terminou('f0', 'Filme 0');
        await fecharPlayer();

        expect(titulos()).toEqual(['Filme 2', 'Filme 1']);
        expect(focado()).toBe('Filme 1');
        // um card com realce em TODA a Home, e é esse
        expect(document.querySelectorAll('.tv-focused')).toHaveLength(1);

        tecla(OK);
        expect(player()).toBe('Filme 1');
    });

    it('o ÚNICO filme da fileira acabou: a fileira some e o foco segue pra seção seguinte, não pros contadores', async () => {
        const navegou = vi.fn();
        emProgresso('unico', 'Único');
        await montarHome(navegou);

        tecla(BAIXO);
        tecla(OK);
        expect(player()).toBe('Único');

        terminou('unico', 'Único');
        await fecharPlayer();

        expect(document.querySelector('#home-continue')).toBeNull();
        const foco = document.querySelectorAll('.tv-focused');
        expect(foco).toHaveLength(1);
        // a seção que subiu pro lugar da fileira (catálogo vazio: Acesso Rápido)
        expect(foco[0].closest('.quick-grid')).not.toBeNull();
        expect(foco[0].closest('.home-stats')).toBeNull();

        // e o D-pad e o OK continuam de onde o realce está: nada de TV ao Vivo
        tecla(DIREITA);
        expect(document.querySelector('.quick-grid .tv-focused .quick-label')?.textContent).toBe('Filmes');
        expect(navegou).not.toHaveBeenCalled();
        tecla(OK);
        expect(navegou).toHaveBeenCalledTimes(1);
        expect(navegou).toHaveBeenCalledWith('movies');
    });

    it('o filme só foi adiantado: ele vai pra frente da fileira e o foco vai JUNTO', async () => {
        for (let i = 0; i < 3; i++) emProgresso(`f${i}`, `Filme ${i}`);
        await montarHome();

        tecla(BAIXO);
        tecla(DIREITA);
        tecla(DIREITA);
        expect(focado()).toBe('Filme 0');
        tecla(OK);

        emProgresso('f0', 'Filme 0');   // parou no meio de novo, agora é o mais recente
        await fecharPlayer();

        expect(titulos()).toEqual(['Filme 0', 'Filme 2', 'Filme 1']);
        expect(focado()).toBe('Filme 0');
    });

    it('a SÉRIE retomada da fileira vai pra frente e o foco vai junto (fila de episódios de verdade)', async () => {
        vi.spyOn(api, 'getSeriesInfo').mockResolvedValue({
            episodes: {
                '1': [
                    { id: 's1-e3', episode_num: 3, container_extension: 'mp4', title: 'Ep 3' },
                    { id: 's1-e4', episode_num: 4, container_extension: 'mp4', title: 'Ep 4' },
                ],
            },
        } as never);
        serieEmProgresso('s1', 'Série Um', 3);
        emProgresso('f1', 'Filme 1');
        await montarHome();

        tecla(BAIXO);
        tecla(DIREITA);
        expect(focado()).toBe('Série Um · T1 E3');
        tecla(OK);
        // a fila é montada de forma assíncrona (get_series_info)
        await waitFor(() => expect(player()).toBe('Série Um'));

        serieEmProgresso('s1', 'Série Um', 4);   // viu o ep 3 e parou no meio do 4
        await fecharPlayer();

        // o card mostra o episódio novo, e o realce foi com a série
        expect(titulos()).toEqual(['Série Um · T1 E4', 'Filme 1']);
        expect(focado()).toBe('Série Um · T1 E4');
    });

    it('a volta do player com o foco FORA da fileira não mexe no foco', async () => {
        for (let i = 0; i < 2; i++) emProgresso(`f${i}`, `Filme ${i}`);
        await montarHome();

        // foco no 3º contador (Séries); o card é tocado pelo clique
        tecla(DIREITA);
        tecla(DIREITA);
        const cards = document.querySelectorAll<HTMLButtonElement>('#home-continue .content-card');
        act(() => { cards[1].click(); });
        expect(player()).toBe('Filme 0');

        terminou('f0', 'Filme 0');
        await fecharPlayer();

        expect(titulos()).toEqual(['Filme 1']);
        const foco = document.querySelectorAll('.tv-focused');
        expect(foco).toHaveLength(1);
        expect(foco[0].classList.contains('stat-card-series')).toBe(true);
    });

    it('o card seguido vale só pra UMA volta: o 🎲 aberto depois não puxa o foco pro card antigo', async () => {
        // um filme no catálogo pra roleta ter o que sortear
        vi.spyOn(api, 'getVODStreams').mockResolvedValue([
            { stream_id: 99, name: 'Sorteado', category_id: '1', stream_icon: '', container_extension: 'mp4', added: '1' },
        ] as never);
        for (let i = 0; i < 3; i++) emProgresso(`f${i}`, `Filme ${i}`);
        await montarHome();

        tecla(BAIXO);
        expect(focado()).toBe('Filme 2');
        tecla(OK);
        emProgresso('f2', 'Filme 2');
        await fecharPlayer();
        expect(focado()).toBe('Filme 2');

        tecla(DIREITA);
        tecla(DIREITA);
        expect(focado()).toBe('Filme 0');
        // 🎲 pelo mouse (build web), com o foco ainda na fileira
        const dado = Array.from(document.querySelectorAll<HTMLButtonElement>('.quick-item'))
            .find(b => b.textContent?.includes('Surpreenda-me'));
        act(() => { dado!.click(); });
        expect(player()).toBe('Sorteado');
        await fecharPlayer();

        expect(titulos()).toEqual(['Filme 2', 'Filme 1', 'Filme 0']);
        expect(focado()).toBe('Filme 0');
    });

    it('a série que NÃO abriu (fila vazia) não deixa card seguido pra volta seguinte', async () => {
        // sem episódios a fila não é montada e o player nem abre: o card
        // não pode ficar guardado pra ser seguido na próxima volta
        const info = vi.spyOn(api, 'getSeriesInfo').mockResolvedValue({ episodes: {} } as never);
        vi.spyOn(api, 'getVODStreams').mockResolvedValue([
            { stream_id: 99, name: 'Sorteado', category_id: '1', stream_icon: '', container_extension: 'mp4', added: '1' },
        ] as never);
        serieEmProgresso('s1', 'Série Um', 3);
        emProgresso('f1', 'Filme 1');
        emProgresso('f2', 'Filme 2');
        await montarHome();

        tecla(BAIXO);
        tecla(DIREITA);
        tecla(DIREITA);
        expect(focado()).toBe('Série Um · T1 E3');
        tecla(OK);
        await waitFor(() => expect(info).toHaveBeenCalledTimes(1));
        // deixa o buildEpisodeQueue e o playContinueItem terminarem
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        expect(player()).toBeNull();

        tecla(ESQUERDA);
        expect(focado()).toBe('Filme 1');
        // 🎲 pelo mouse (build web), com o foco ainda na fileira
        const dado = Array.from(document.querySelectorAll<HTMLButtonElement>('.quick-item'))
            .find(b => b.textContent?.includes('Surpreenda-me'));
        act(() => { dado!.click(); });
        expect(player()).toBe('Sorteado');
        await fecharPlayer();

        expect(titulos()).toEqual(['Filme 2', 'Filme 1', 'Série Um · T1 E3']);
        expect(focado()).toBe('Filme 1');
    });

    it('a rolagem horizontal mira o card que ficou com o realce', async () => {
        for (let i = 0; i < 3; i++) emProgresso(`f${i}`, `Filme ${i}`);
        await montarHome();
        const rolados: Element[] = [];
        Element.prototype.scrollIntoView = function (this: Element) { rolados.push(this); };

        tecla(BAIXO);
        tecla(DIREITA);
        tecla(DIREITA);
        tecla(OK);
        terminou('f0', 'Filme 0');
        rolados.length = 0;
        await fecharPlayer();

        const cartao = document.querySelector('#home-continue .tv-focused');
        expect(cartao).not.toBeNull();
        expect(rolados).toContain(cartao);
    });
});
