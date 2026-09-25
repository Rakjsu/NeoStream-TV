// @vitest-environment jsdom
//
// ⌨️ Cada tecla da busca de Filmes refazia o catálogo INTEIRO.
//
// Digitar uma letra invalida `matchingStreams` e, em cascata, o agrupamento e a
// ordenação. Dois desperdícios por tecla, os dois proporcionais ao catálogo:
//
//  1. `fuzzyMatches(stream.name, query)` normalizava o NOME de cada item do zero
//     (`normalize('NFD')` + regex de diacríticos + `toLowerCase`) — num catálogo
//     de 8 mil títulos, 8 mil normalizações por tecla de um texto que nunca muda.
//     A barra A-Z e o filtro de letra repetiam a mesma normalização por item.
//  2. Com a ordenação "Nome" ligada, a lista era ordenada DUAS vezes com o
//     Intl.Collator: uma para a grade (`filteredStreams`) e outra só para montar
//     a barra A-Z (`alphabetIndex`). Nos outros modos isso não acontece —
//     `sortCatalog` devolve a lista intacta em 'default' e a barra A-Z só existe
//     em 'name' —, por isso os testes da barra ligam "Nome" de propósito.
//
// Os testes medem o TRABALHO feito pela página de verdade quando o usuário
// digita, e conferem que o resultado da busca continua o mesmo.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { api } from '../services/api';
import { sortCatalog } from '../services/catalogExtras';
import type { VODStream, Category } from '../types';
import { Movies } from './Movies';

const TAMANHO_DO_CATALOGO = 400;

function filme(id: number, nome: string): VODStream {
    return {
        num: id,
        name: nome,
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

// Nomes distintos (sem tags de versão) para o agrupamento não fundir nada; um
// terço com acento, que é o caso que obriga a normalização existir.
function catalogo(): VODStream[] {
    const lista: VODStream[] = [];
    for (let i = 1; i <= TAMANHO_DO_CATALOGO; i++) {
        const nome = i % 3 === 0 ? `Ação Número ${i}` : i % 3 === 1 ? `Zebra Filme ${i}` : `Bárbaro Titulo ${i}`;
        lista.push(filme(i, nome));
    }
    return lista;
}

// Catálogo com ACENTO NA INICIAL: "Ébano" só cai na letra "E" se a barra A-Z
// e o filtro de letra usarem o nome normalizado ("É" cru viraria "#").
function catalogoComInicialAcentuada(): VODStream[] {
    const lista: VODStream[] = [];
    for (let i = 1; i <= TAMANHO_DO_CATALOGO; i++) {
        const nome = i % 2 === 0 ? `Ébano Sombrio ${i}` : `Zebra Filme ${i}`;
        lista.push(filme(i, nome));
    }
    return lista;
}

const categorias: Category[] = [{ category_id: '1', category_name: 'Filmes', parent_id: 0 } as Category];

async function montar(): Promise<HTMLInputElement> {
    render(<Movies />);
    // Espera a CONDIÇÃO (catálogo carregado e busca na tela), não um número de voltas
    await waitFor(() => {
        expect(document.querySelector('.search-input')).not.toBeNull();
    });
    return document.querySelector('.search-input') as HTMLInputElement;
}

function digitar(input: HTMLInputElement, texto: string): void {
    act(() => {
        fireEvent.change(input, { target: { value: texto } });
    });
}

function titulosNaGrade(): string[] {
    return Array.from(document.querySelectorAll('.movie-title')).map(el => el.textContent || '');
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
    vi.spyOn(api, 'getVODStreams').mockResolvedValue(catalogo());
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

describe('Filmes — custo de uma tecla na busca', () => {
    it('não normaliza o nome de cada filme a cada tecla', async () => {
        const input = await montar();

        // Digitar "acao" letra por letra, como no teclado da TV
        const primeiras = contarNormalizacoes(() => {
            digitar(input, 'a');
            digitar(input, 'ac');
            digitar(input, 'aca');
        });
        const titulosEmAca = titulosNaGrade();
        const naUltimaTecla = contarNormalizacoes(() => digitar(input, 'acao'));
        const noTotal = primeiras + naUltimaTecla;

        // Cada nome do catálogo é normalizado no MÁXIMO uma vez na digitação
        // inteira (antes: uma vez por tecla, 4 x 400)...
        expect(noTotal).toBeLessThanOrEqual(TAMANHO_DO_CATALOGO + 4 * 2);
        // ...e uma tecla depois da primeira só normaliza a QUERY: o número não
        // pode crescer com o tamanho da lista.
        expect(naUltimaTecla).toBeLessThanOrEqual(2);

        // E a busca continua achando o mesmo. "aca" (3 letras) só casa por
        // SUBSTRING — sem acento, dentro de "Ação" —, e "acao" acha só "Ação".
        expect(titulosEmAca.length).toBeGreaterThan(0);
        expect(titulosEmAca.every(t => t.startsWith('Ação Número'))).toBe(true);
        const titulos = titulosNaGrade();
        expect(titulos.length).toBeGreaterThan(0);
        expect(titulos.every(t => t.startsWith('Ação Número'))).toBe(true);
    });

    it('a busca tolerante segue funcionando com o nome já normalizado (typo e tokens)', async () => {
        const input = await montar();

        // "barbaro" sem acento acha "Bárbaro"
        digitar(input, 'barbaro titulo 2');
        expect(document.body.textContent).toContain('Bárbaro Titulo 2');
        expect(document.body.textContent).not.toContain('Zebra Filme 1');

        // Typo de 1 letra numa query de 4+ letras ("zebr4" ~ "zebra")
        digitar(input, 'zebr4');
        expect(document.body.textContent).toContain('Zebra Filme 1');
        expect(document.body.textContent).not.toContain('Ação Número 3');

        // A QUERY também passa pela normalização: o teclado da TV digita
        // maiúscula e acento, e o nome guardado está minúsculo e sem acento.
        digitar(input, 'AÇÃO');
        const acoes = titulosNaGrade();
        expect(acoes.length).toBeGreaterThan(0);
        expect(acoes.every(t => t.startsWith('Ação Número'))).toBe(true);
    });

    it('com a ordenação "Nome", ordena a lista UMA vez por tecla (não duas)', async () => {
        localStorage.setItem('neostream_sort_movies', 'name');
        const input = await montar();
        // Barra A-Z montada (só existe na ordenação "Nome")
        expect(document.querySelectorAll('.alphabet-letter').length).toBeGreaterThan(1);

        // `collator.compare(a, b)` passa pelo getter do protótipo a cada
        // comparação: contar o getter é contar comparações do Intl.Collator.
        const compare = vi.spyOn(Intl.Collator.prototype, 'compare', 'get');
        digitar(input, 'zebra');
        const comparacoesNaTecla = compare.mock.calls.length;

        // Referência: o custo de UMA ordenação da lista que a busca produz
        // (mesma entrada, mesma ordem — o sort é determinístico).
        compare.mockClear();
        const resultado = catalogo().filter(f => f.name.startsWith('Zebra'));
        sortCatalog(resultado, 'name');
        const umaOrdenacao = compare.mock.calls.length;
        compare.mockRestore();

        expect(umaOrdenacao).toBeGreaterThan(0);
        expect(comparacoesNaTecla).toBe(umaOrdenacao);

        // A grade continua em ordem de nome (Collator numérico: 1, 4, 7, 10...)
        expect(titulosNaGrade().slice(0, 4)).toEqual(['Zebra Filme 1', 'Zebra Filme 4', 'Zebra Filme 7', 'Zebra Filme 10']);
    });

    it('trocar a ordenação reordena a grade: a lista ordenada acompanha o modo', async () => {
        // "Recentes" com todos os `added` iguais deixa a ordem do provedor
        localStorage.setItem('neostream_sort_movies', 'recent');
        await montar();
        expect(titulosNaGrade().slice(0, 3)).toEqual(['Zebra Filme 1', 'Bárbaro Titulo 2', 'Ação Número 3']);

        // Recentes → Nome
        const ordenar = document.querySelector('.toolbar-btn[title="Ordenar"]') as HTMLElement;
        act(() => { fireEvent.click(ordenar); });
        expect(ordenar.textContent).toContain('Nome');
        expect(titulosNaGrade().slice(0, 3)).toEqual(['Ação Número 3', 'Ação Número 6', 'Ação Número 9']);
        expect(document.querySelectorAll('.alphabet-letter').length).toBeGreaterThan(1);
    });

    it('barra A-Z e filtro de letra usam o nome já normalizado, sem renormalizar o catálogo', async () => {
        vi.mocked(api.getVODStreams).mockResolvedValue(catalogoComInicialAcentuada());
        localStorage.setItem('neostream_sort_movies', 'name');
        const input = await montar();

        // Uma busca qualquer passa o catálogo inteiro pelo filtro (e pelo cache)
        digitar(input, 'x');

        // Limpar a busca devolve a lista inteira e remonta a barra A-Z sobre
        // ela: só a QUERY vazia é normalizada, nenhum nome de filme.
        const aoLimpar = contarNormalizacoes(() => digitar(input, ''));
        expect(aoLimpar).toBeLessThanOrEqual(2);

        // "Ébano" entra no "E", não no "#"
        const letras = Array.from(document.querySelectorAll('.alphabet-letter')).map(el => el.textContent);
        expect(letras).toEqual(['E', 'Z']);

        const letra = (l: string) =>
            Array.from(document.querySelectorAll('.alphabet-letter')).find(el => el.textContent === l) as Element;

        // "Z" primeiro: os "Ébano" vêm antes na ordem de nome, então a grade só
        // começa por "Zebra" se o filtro de letra tiver rodado de fato
        act(() => { fireEvent.click(letra('Z')); });
        const zs = titulosNaGrade();
        expect(zs.length).toBeGreaterThan(0);
        expect(zs.every(t => t.startsWith('Zebra Filme'))).toBe(true);

        // Escolher a letra filtra a grade, também sem renormalizar ninguém
        const aoEscolherLetra = contarNormalizacoes(() => {
            act(() => { fireEvent.click(letra('E')); });
        });
        expect(aoEscolherLetra).toBeLessThanOrEqual(2);

        const titulos = titulosNaGrade();
        expect(titulos.length).toBeGreaterThan(0);
        expect(titulos.every(t => t.startsWith('Ébano Sombrio'))).toBe(true);
    });
});

// Execução: npx vitest run src/pages/Movies.buscaPorTecla.test.tsx
