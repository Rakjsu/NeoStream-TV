// @vitest-environment jsdom
//
// ⌨️ A busca de Séries tinha o mesmo desperdício da de Filmes: a cada tecla,
// `fuzzyMatches(s.name, query)` normalizava de novo (NFD + regex de acento)
// o nome de TODAS as séries, um texto que nunca muda entre teclas. Aqui a
// ordenação já era feita uma vez só (`sortedSeries`), então o que se mede é
// a normalização — e que a busca continua achando o mesmo.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { api } from '../services/api';
import type { Series as SeriesType, Category } from '../types';
import { Series } from './Series';

const TAMANHO_DO_CATALOGO = 400;

function serie(id: number, nome: string): SeriesType {
    return {
        num: id,
        name: nome,
        series_id: id,
        cover: 'capa.jpg', // src vazio faz o React reclamar no console
        plot: '',
        cast: '',
        director: '',
        genre: '',
        release_date: '',
        last_modified: '0',
        rating: '',
        rating_5based: 0,
        backdrop_path: [],
        youtube_trailer: '',
        episode_run_time: '',
        category_id: '1',
        tmdb_id: '',
    };
}

// Um terço com acento: é o caso que obriga a normalização existir
function catalogo(): SeriesType[] {
    const lista: SeriesType[] = [];
    for (let i = 1; i <= TAMANHO_DO_CATALOGO; i++) {
        const nome = i % 3 === 0 ? `Ação Temporada ${i}` : i % 3 === 1 ? `Zebra Serie ${i}` : `Bárbaro Show ${i}`;
        lista.push(serie(i, nome));
    }
    return lista;
}

const categorias: Category[] = [{ category_id: '1', category_name: 'Séries', parent_id: 0 } as Category];

function digitar(input: HTMLInputElement, texto: string): void {
    act(() => {
        fireEvent.change(input, { target: { value: texto } });
    });
}

function titulosNaGrade(): string[] {
    return Array.from(document.querySelectorAll('.series-title')).map(el => el.textContent || '');
}

/** Conta as chamadas de `normalize('NFD')` feitas dentro de `acao`. */
function contarNormalizacoes(acao: () => void): number {
    const normalize = vi.spyOn(String.prototype, 'normalize');
    try {
        acao();
        return normalize.mock.calls.filter(args => args[0] === 'NFD').length;
    } finally {
        normalize.mockRestore();
    }
}

beforeEach(() => {
    localStorage.clear();
    vi.spyOn(api, 'getSeries').mockResolvedValue(catalogo());
    vi.spyOn(api, 'getSeriesCategories').mockResolvedValue(categorias);
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('Séries — custo de uma tecla na busca', () => {
    it('não normaliza o nome de cada série a cada tecla, e acha o mesmo', async () => {
        render(<Series />);
        // Espera a CONDIÇÃO (catálogo carregado e busca na tela)
        await waitFor(() => {
            expect(document.querySelector('.search-input')).not.toBeNull();
        });
        const input = document.querySelector('.search-input') as HTMLInputElement;

        const primeiras = contarNormalizacoes(() => {
            digitar(input, 'a');
            digitar(input, 'ac');
            digitar(input, 'aca');
        });
        const naUltimaTecla = contarNormalizacoes(() => digitar(input, 'acao'));

        // Cada nome é normalizado no máximo uma vez na digitação inteira
        // (antes: 4 x 400), e a tecla seguinte só normaliza a QUERY
        expect(primeiras + naUltimaTecla).toBeLessThanOrEqual(TAMANHO_DO_CATALOGO + 4 * 2);
        expect(naUltimaTecla).toBeLessThanOrEqual(2);

        // "acao" sem acento acha "Ação", e só ela
        const titulos = titulosNaGrade();
        expect(titulos.length).toBeGreaterThan(0);
        expect(titulos.every(t => t.startsWith('Ação Temporada'))).toBe(true);

        // Tokens fora de ordem e typo de 1 letra continuam valendo
        digitar(input, 'show barbaro');
        expect(titulosNaGrade().length).toBeGreaterThan(0);
        expect(titulosNaGrade().every(t => t.startsWith('Bárbaro Show'))).toBe(true);
        digitar(input, 'zebr4');
        expect(titulosNaGrade().length).toBeGreaterThan(0);
        expect(titulosNaGrade().every(t => t.startsWith('Zebra Serie'))).toBe(true);

        // A QUERY também é normalizada: maiúscula e acento do teclado da TV
        digitar(input, 'AÇÃO');
        expect(titulosNaGrade().length).toBeGreaterThan(0);
        expect(titulosNaGrade().every(t => t.startsWith('Ação Temporada'))).toBe(true);
    });
});

// Execução: npx vitest run src/pages/Series.buscaPorTecla.test.tsx
