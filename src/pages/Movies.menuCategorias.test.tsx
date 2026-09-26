// @vitest-environment jsdom
//
// ⏸️ Fechar o menu de categorias de Filmes deixava o controle morto por 300 ms.
//
// A ponte é esta: a página liga o próprio hook com `!categoryMenuOpen` e só
// recebe `onOpenChange(false)` do CategoryMenu no FIM da animação de fechar. O
// menu, por sua vez, desligava o hook dele no COMEÇO da animação. No meio,
// ninguém ouvia: o ↓ de quem aperta de novo "pra garantir" sumia.
//
// Aqui roda a página de verdade (Filmes + CategoryMenu + useTVNavigation), sem
// timer falso: as teclas saem no mesmo bloco síncrono, então o setTimeout de
// 300 ms da animação não tem como disparar entre elas. O comportamento fino do
// menu (timer desarmado, OK repetido, desmonte) está em
// src/components/CategoryMenu.closing.test.tsx.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { api } from '../services/api';
import type { VODStream, Category } from '../types';
import { Movies } from './Movies';

function filme(id: number): VODStream {
    return {
        num: id,
        name: `Filme ${id}`,
        stream_type: 'movie',
        stream_id: id,
        stream_icon: 'capa.jpg', // src vazio faz o React reclamar no console
        container_extension: 'mp4',
        custom_sid: '',
        direct_source: '',
        added: '0',
        category_id: '1',
        rating: '',
        rating_5based: 0,
        backdrop_path: [],
        youtube_trailer: '',
        episode_run_time: '',
        cover: '',
        plot: '',
        cast: '',
    } as unknown as VODStream;
}

const categorias: Category[] = [{ category_id: '1', category_name: 'Filmes', parent_id: 0 } as Category];

beforeEach(() => {
    localStorage.clear();
    vi.spyOn(api, 'getVODStreams').mockResolvedValue(Array.from({ length: 30 }, (_, i) => filme(i + 1)));
    vi.spyOn(api, 'getVodCategories').mockResolvedValue(categorias);
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
});

async function montar(): Promise<void> {
    render(<Movies />);
    // Espera a CONDIÇÃO (grade carregada), não um número de voltas
    await waitFor(() => {
        expect(document.querySelectorAll('.movie-card').length).toBeGreaterThan(6);
    });
    // O ouvinte do useTVNavigation é re-registrado num efeito: esvazia os
    // efeitos antes de apertar tecla, senão a tecla cai no ouvinte velho
    await act(async () => { await Promise.resolve(); });
}

const tecla = (key: string, keyCode: number) => {
    act(() => { fireEvent.keyDown(window, { key, keyCode }); });
};
const voltar = () => tecla('XF86Back', 10009);
const baixo = () => tecla('ArrowDown', 40);

const painel = () => document.querySelector('.category-panel');

/** Posição do card focado na grade (-1 = nenhum). */
const cardFocado = () =>
    Array.from(document.querySelectorAll('.movie-card')).findIndex(el => el.classList.contains('tv-focused'));

describe('Filmes — fechar o menu de categorias não deixa o controle morto', () => {
    it('o ↓ apertado durante a animação de fechar responde, e o seguinte já anda na grade', async () => {
        await montar();
        expect(cardFocado()).toBe(0);

        act(() => { fireEvent.click(document.querySelector('.category-toggle-btn') as HTMLElement); });
        expect(painel()?.className).toContain('open');

        // Com o painel aberto, o ↓ é do menu: a grade atrás não se mexe
        baixo();
        expect(cardFocado()).toBe(0);

        voltar();
        expect(painel()?.className).toContain('closing');

        // Ainda dentro dos 300 ms: a tecla encerra o fechamento na hora, e é
        // consumida pelo menu — não vaza pra grade com o painel na tela
        baixo();
        expect(painel()).toBeNull();
        expect(cardFocado()).toBe(0);

        // A página já voltou a ouvir: o próximo ↓ desce uma linha (6 colunas)
        baixo();
        expect(cardFocado()).toBe(6);
    });
});

// Execução: npx vitest run src/pages/Movies.menuCategorias.test.tsx
