// @vitest-environment jsdom
//
// T029 — "Continuar Assistindo" crescia sem teto e nenhuma tecla tirava um
// card de lá.
//
// Era a única fileira da Home sem corte: até 50 filmes + 50 séries em
// progresso viravam 100 cards na primeira fileira da primeira tela. E o
// progressService.removeMovie/removeSeries não tinha UM chamador: o filme
// largado aos 4 minutos ficava na posição de honra até o LRU de 50 expulsá-lo.
//
// O teste monta a Home DE VERDADE (só a rede e o aviso de validade são
// substituídos) e dirige pelo teclado, como o controle remoto faz.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { installFakeStorage } from '../testing/fakeStorage';
import { api } from '../services/api';
import { accountService } from '../services/accountService';
import { progressService } from '../services/progressService';
import { Home } from './Home';

/** Dispara uma tecla como a TV dispara (keyCode; o `key` vem vazio no Tizen). */
function tecla(keyCode: number): void {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '', keyCode, bubbles: true, cancelable: true }));
    });
}
const BAIXO = 40;
const DIREITA = 39;
const VERMELHO = 403;
const DICA = '🔴 tirar da fileira';

let relogio = 1_000_000;
function filmeEmProgresso(id: string, nome: string): void {
    // updatedAt crescente: o último salvo é o primeiro da fileira
    const now = vi.spyOn(Date, 'now').mockReturnValue(relogio += 1000);
    progressService.saveMovie({ id, name: nome, poster: `${id}.jpg`, time: 600, duration: 7200 });
    now.mockRestore();
}

function serieEmProgresso(seriesId: string, nome: string, episode = 3): void {
    const now = vi.spyOn(Date, 'now').mockReturnValue(relogio += 1000);
    progressService.saveSeries({
        seriesId, seriesName: nome, poster: `${seriesId}.jpg`, season: 1, episode,
        episodeId: `${seriesId}-e${episode}`, time: 600, duration: 2700,
    });
    now.mockRestore();
}

const cards = () => Array.from(document.querySelectorAll<HTMLElement>('#home-continue .content-card'));
const titulos = () => cards().map(c => c.querySelector('.card-title')?.textContent?.trim() ?? '');
const focado = () => document.querySelector('#home-continue .tv-focused .card-title')?.textContent?.trim() ?? null;
const dica = () => document.querySelector('#home-continue .section-hint')?.textContent ?? null;

async function montarHome(): Promise<void> {
    render(<Home onNavigate={() => {}} onRequestExit={() => {}} onCancelExit={() => {}} />);
    // Espera o fetch da Home terminar (os contadores saem do "...") — sem
    // isto os setState do fetch caem fora do act no meio do teste
    await waitFor(() => {
        expect(document.querySelector('.stat-card-live .stat-value')?.textContent).toBe('0');
    });
}

beforeEach(() => {
    installFakeStorage();
    // jsdom não implementa scrollIntoView, e a Home rola a cada mudança de foco
    Element.prototype.scrollIntoView = function () { /* jsdom */ };
    // Só a rede é de mentira: catálogo vazio, a Home real por cima
    vi.spyOn(api, 'getLiveStreams').mockResolvedValue([]);
    vi.spyOn(api, 'getVODStreams').mockResolvedValue([]);
    vi.spyOn(api, 'getSeries').mockResolvedValue([]);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Continuar Assistindo — teto da fileira', () => {
    it('mostra no máximo 15 cards, os mais recentes primeiro', async () => {
        for (let i = 0; i < 20; i++) filmeEmProgresso(`f${i}`, `Filme ${i}`);
        await montarHome();

        expect(cards()).toHaveLength(15);
        expect(titulos()[0]).toBe('Filme 19');
        expect(titulos()[14]).toBe('Filme 5');
        // o que ficou de fora continua guardado, com o ponto de retomada
        expect(progressService.getMovieResumeTime('f0')).toBe(600);
    });

    it('o teto vale para filmes e séries somados', () => {
        for (let i = 0; i < 12; i++) filmeEmProgresso(`f${i}`, `Filme ${i}`);
        for (let i = 0; i < 12; i++) serieEmProgresso(`s${i}`, `Série ${i}`);
        expect(progressService.getContinueWatching()).toHaveLength(15);
    });

    it('esconder um id que não existe não inventa entrada no progresso', () => {
        filmeEmProgresso('f0', 'Filme 0');
        progressService.hideFromContinueWatching('movie', 'fantasma');
        progressService.hideFromContinueWatching('series', 'fantasma');
        expect([...progressService.getMovieIdsWithProgress()]).toEqual(['f0']);
        expect(progressService.getSeriesIdsWithProgress().size).toBe(0);
    });
});

describe('Continuar Assistindo — 🔴 tira o card focado', () => {
    it('um toque tira o card, quem estava fora entra na vaga e o progresso fica', async () => {
        for (let i = 0; i < 20; i++) filmeEmProgresso(`f${i}`, `Filme ${i}`);
        await montarHome();

        tecla(BAIXO);    // stats → Continuar Assistindo
        tecla(DIREITA);  // 2º card: Filme 18
        expect(focado()).toBe('Filme 18');
        expect(dica()).toBe(DICA);

        tecla(VERMELHO);
        expect(titulos()).not.toContain('Filme 18');
        expect(cards()).toHaveLength(15);
        expect(titulos()[14]).toBe('Filme 4');      // o 16º subiu pra vaga
        // o foco fica na mesma posição, agora no card seguinte
        expect(focado()).toBe('Filme 17');

        // Só sai da FILEIRA: o ponto de retomada e o histórico (afinidade,
        // roleta) continuam, e a ordem das sementes de "Porque você
        // assistiu" não muda (esconder não conta como assistir agora)
        expect(progressService.getMovieResumeTime('f18')).toBe(600);
        expect(progressService.getMovieIdsWithProgress().has('f18')).toBe(true);
        expect(progressService.getWatchSeeds(2).map(s => s.id)).toEqual(['f19', 'f18']);

        // assistir de novo traz o card de volta
        filmeEmProgresso('f18', 'Filme 18');
        expect(progressService.getContinueWatching()[0]).toMatchObject({ kind: 'movie', progress: { id: 'f18' } });
    });

    it('série escondida continua "seguida" (novos episódios) e volta ao assistir de novo', async () => {
        serieEmProgresso('s1', 'Série Um', 3);
        await montarHome();

        tecla(BAIXO);
        tecla(VERMELHO);
        expect(document.querySelector('#home-continue')).toBeNull();
        expect(progressService.getSeriesIdsWithProgress().has('s1')).toBe(true);
        expect(progressService.getSeriesResumeTime('s1', 1, 3)).toBe(600);

        serieEmProgresso('s1', 'Série Um', 4);
        expect(progressService.getContinueWatching().map(e => e.kind === 'series' && e.progress.seriesId)).toEqual(['s1']);
    });

    it('tirar o card da PONTA direita põe o foco no novo último card, e com um só sobrando o foco fica nele', async () => {
        for (let i = 0; i < 3; i++) filmeEmProgresso(`f${i}`, `Filme ${i}`);
        await montarHome();

        tecla(BAIXO);
        tecla(DIREITA);
        tecla(DIREITA);  // Filme 0, o último
        tecla(VERMELHO);

        expect(titulos()).toEqual(['Filme 2', 'Filme 1']);
        expect(focado()).toBe('Filme 1');

        // Sobrou UM card: a fileira continua e o foco fica nele (só a
        // fileira vazia manda o foco pra seção seguinte)
        tecla(VERMELHO);
        expect(titulos()).toEqual(['Filme 2']);
        expect(focado()).toBe('Filme 2');
        expect(dica()).toBe(DICA);
    });

    it('tirar o ÚLTIMO card apaga a fileira e o foco segue para a seção seguinte', async () => {
        filmeEmProgresso('unico', 'Único');
        await montarHome();

        tecla(BAIXO);
        tecla(VERMELHO);

        expect(document.querySelector('#home-continue')).toBeNull();
        const foco = document.querySelector('.tv-focused');
        expect(foco).not.toBeNull();
        expect(foco?.closest('.quick-grid')).not.toBeNull();
    });

    it('fora da fileira o 🔴 não tira nada', async () => {
        filmeEmProgresso('f0', 'Filme 0');
        await montarHome();

        // foco nos contadores (seção inicial)
        tecla(VERMELHO);
        expect(titulos()).toEqual(['Filme 0']);
        expect(dica()).toBeNull();
    });

    it('com o aviso de validade na tela, o 🔴 é do aviso: adia primeiro, só depois tira', async () => {
        vi.spyOn(accountService, 'shouldWarnExpiry').mockReturnValue(true);
        vi.spyOn(accountService, 'daysUntilExpiry').mockReturnValue(3);
        const adiar = vi.spyOn(accountService, 'snoozeExpiry').mockImplementation(() => {});
        for (let i = 0; i < 2; i++) filmeEmProgresso(`f${i}`, `Filme ${i}`);
        await montarHome();

        tecla(BAIXO);
        expect(document.querySelector('.home-expiry')).not.toBeNull();
        expect(dica()).toBeNull();          // a tela não promete o que o 🔴 não faz

        tecla(VERMELHO);
        expect(adiar).toHaveBeenCalledTimes(1);
        expect(document.querySelector('.home-expiry')).toBeNull();
        expect(titulos()).toEqual(['Filme 1', 'Filme 0']);
        expect(dica()).toBe(DICA);

        tecla(VERMELHO);
        expect(titulos()).toEqual(['Filme 0']);
        expect(adiar).toHaveBeenCalledTimes(1);
    });

    it('com a falha de rede na tela, o 🔴 é do "tentar de novo" e a fileira não mostra a dica', async () => {
        vi.spyOn(api, 'getLiveStreams').mockRejectedValue(new Error('sem rede'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        filmeEmProgresso('f0', 'Filme 0');
        await montarHome();
        expect(document.querySelector('.home-load-error')).not.toBeNull();

        tecla(BAIXO);
        expect(focado()).toBe('Filme 0');
        expect(dica()).toBeNull();

        // O jsdom não navega (o reload vira "Not implemented" no console e
        // não dá pra espionar: a propriedade é inalterável). O que importa
        // aqui é que o 🔴 NÃO caiu na fileira.
        tecla(VERMELHO);
        expect(titulos()).toEqual(['Filme 0']);
    });
});
