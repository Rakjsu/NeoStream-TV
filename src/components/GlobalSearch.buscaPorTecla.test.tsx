// @vitest-environment jsdom
//
// ⌨️ T042 — cada letra da busca global (overlay 🔍) renormalizava o catálogo
// INTEIRO: canais, filmes e séries, nome por nome, a cada tecla.
//
// Aqui é a tela de verdade: o GlobalSearch monta, carrega o catálogo pelo
// searchCatalog real (só o api é dublado) e o usuário digita. Da 2ª tecla em
// diante, o trabalho por tecla tem de ser só a consulta — uma normalização por
// lista —, e os resultados na tela têm de continuar os mesmos.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { api } from '../services/api';
import { clearSearchCatalogCache } from '../services/searchCatalog';
import type { LiveStream, VODStream, Series, Category } from '../types';
import { GlobalSearch } from './GlobalSearch';

const POR_LISTA = 300;

// Nomes com acento e caixa misturada; um terço casa com "glo".
function nomes(prefixo: string): string[] {
    return Array.from({ length: POR_LISTA }, (_, i) =>
        i % 3 === 0 ? `${prefixo} Ação ${i}` : i % 3 === 1 ? `GLOBO ${prefixo} ${i}` : `${prefixo} Número ${i}`
    );
}

const canais = (): LiveStream[] => nomes('Canal').map((name, i) => ({
    name, stream_id: i + 1, stream_icon: '', category_id: '1', direct_source: '',
}) as unknown as LiveStream);

const filmes = (): VODStream[] => nomes('Filme').map((name, i) => ({
    name, stream_id: i + 1, stream_icon: '', category_id: '1', container_extension: 'mp4',
}) as unknown as VODStream);

const series = (): Series[] => nomes('Série').map((name, i) => ({
    name, series_id: i + 1, cover: '', category_id: '1',
}) as unknown as Series);

const categorias: Category[] = [{ category_id: '1', category_name: 'Geral', parent_id: 0 } as Category];

async function montar(): Promise<HTMLInputElement> {
    render(<GlobalSearch onClose={() => { /* fechar não importa aqui */ }} />);
    // Espera a CONDIÇÃO: catálogo carregado (o aviso de 2 letras só aparece com ele)
    await waitFor(() => {
        expect(document.body.textContent).toContain('Digite pelo menos 2 letras.');
    });
    return document.querySelector('.gs-input') as HTMLInputElement;
}

function digitar(input: HTMLInputElement, texto: string): void {
    act(() => {
        fireEvent.change(input, { target: { value: texto } });
    });
}

/** [tipo, nome] de cada resultado na tela, na ordem. */
function resultados(): Array<[string, string]> {
    return Array.from(document.querySelectorAll('.gs-result')).map(el => [
        el.querySelector('.gs-result-type')?.textContent || '',
        el.querySelector('.gs-result-name')?.textContent || '',
    ]);
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
    clearSearchCatalogCache(); // o catálogo da busca é cache de módulo
    vi.spyOn(api, 'getLiveStreams').mockResolvedValue(canais());
    vi.spyOn(api, 'getVODStreams').mockResolvedValue(filmes());
    vi.spyOn(api, 'getSeries').mockResolvedValue(series());
    vi.spyOn(api, 'getLiveCategories').mockResolvedValue(categorias);
    vi.spyOn(api, 'getVodCategories').mockResolvedValue(categorias);
    vi.spyOn(api, 'getSeriesCategories').mockResolvedValue(categorias);
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    clearSearchCatalogCache();
    localStorage.clear();
});

describe('GlobalSearch — custo por tecla (T042)', () => {
    it('da 2ª tecla em diante, cada letra normaliza só a consulta (uma por lista), nenhum nome', async () => {
        const input = await montar();
        digitar(input, 'gl'); // 1ª busca: paga os nomes uma vez

        for (const texto of ['glo', 'glob', 'globo']) {
            // Antes: 3 consultas + 900 nomes = 903 por tecla
            expect(contarNormalizacoes(() => digitar(input, texto))).toBe(3);
        }
    });

    it('os resultados na tela continuam os mesmos: canais, filmes e séries, com acento e caixa', async () => {
        const input = await montar();
        digitar(input, 'gl');
        digitar(input, 'glo');

        const achados = resultados();
        // 8 por grupo, na ordem canal → filme → série, e só nomes que casam
        expect(achados).toHaveLength(24);
        expect(achados.slice(0, 8).every(([tipo, nome]) => tipo === 'Canal' && nome.startsWith('GLOBO Canal'))).toBe(true);
        expect(achados.slice(8, 16).every(([tipo, nome]) => tipo === 'Filme' && nome.startsWith('GLOBO Filme'))).toBe(true);
        expect(achados.slice(16).every(([tipo, nome]) => tipo === 'Série' && nome.startsWith('GLOBO Série'))).toBe(true);

        // Consulta sem acento e em caixa alta acha o nome acentuado, tecla após tecla
        digitar(input, 'SERIE ac');
        digitar(input, 'SERIE aca');
        expect(resultados().map(([tipo]) => tipo)).toEqual(Array(8).fill('Série'));
        expect(resultados().every(([, nome]) => nome.startsWith('Série Ação'))).toBe(true);

        // E o que não existe continua não aparecendo
        digitar(input, 'xyz');
        expect(resultados()).toEqual([]);
        expect(document.body.textContent).toContain('Nada encontrado para "xyz".');
    });
});
