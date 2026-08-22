// Listas pessoais nomeadas (item 30).
//
// O risco aqui é o de sempre com armazenamento: perder o que o usuário
// montou. A regra que protege é estrutural — a lista padrão continua na chave
// antiga e estas vivem numa chave nova —, e é a primeira coisa provada aqui.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { installFakeStorage, setPerfilAtivo } from '../testing/fakeStorage';
import {
    listsService, nomeDisponivel, NOMES_SUGERIDOS, MAX_LISTAS, MAX_ITENS_POR_LISTA,
} from './listsService';
import { storage } from './storage';

beforeEach(() => {
    installFakeStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 21, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

const filme = (id: string) => ({ id, type: 'movie' as const, title: `Filme ${id}` });

describe('convivência com a lista padrão', () => {
    // A decisão de desenho que evita a migração — e neste repo migração de
    // chave já apagou o dado de quem tinha perfil próprio.
    it('não encosta em neostream_watch_later', () => {
        storage.addWatchLater(filme('1'));
        const antes = localStorage.getItem('neostream_watch_later');

        const lista = listsService.create('Clássicos');
        listsService.toggleItem(lista!.id, filme('2'));

        expect(localStorage.getItem('neostream_watch_later')).toBe(antes);
        expect(storage.getWatchLater()).toHaveLength(1);
    });

    it('grava numa chave própria', () => {
        listsService.create('Clássicos');
        expect(localStorage.getItem('neostream_lists')).toBeTruthy();
    });

    // Listas são dado de QUEM assiste, como favoritos e progresso.
    it('cada perfil tem as suas', () => {
        setPerfilAtivo('pai');
        listsService.create('Clássicos');
        setPerfilAtivo('kids');
        expect(listsService.list()).toEqual([]);
        setPerfilAtivo('pai');
        expect(listsService.list()).toHaveLength(1);
    });
});

describe('nomeDisponivel', () => {
    // Escolher a mesma sugestão duas vezes criaria duas listas com o mesmo
    // nome e nenhuma forma de distingui-las na tela da TV.
    it('desambigua repetindo a sugestão', () => {
        expect(nomeDisponivel('Clássicos', [])).toBe('Clássicos');
        expect(nomeDisponivel('Clássicos', ['Clássicos'])).toBe('Clássicos 2');
        expect(nomeDisponivel('Clássicos', ['Clássicos', 'Clássicos 2'])).toBe('Clássicos 3');
    });

    it('ignora caixa e espaço ao comparar', () => {
        expect(nomeDisponivel('Clássicos', ['  clássicos '])).toBe('Clássicos 2');
    });
});

describe('CRUD', () => {
    it('cria com nome sugerido e nasce vazia', () => {
        const lista = listsService.create(NOMES_SUGERIDOS[0]);
        expect(lista?.nome).toBe(NOMES_SUGERIDOS[0]);
        expect(lista?.itens).toEqual([]);
        expect(listsService.list()).toHaveLength(1);
    });

    it('mantém a ordem de criação', () => {
        listsService.create('Clássicos');
        vi.setSystemTime(new Date(2026, 7, 21, 13, 0, 0));
        listsService.create('Rever');
        expect(listsService.list().map(l => l.nome)).toEqual(['Clássicos', 'Rever']);
    });

    // Sem teto, uma lista vira o serviço que estoura a quota e derruba os
    // outros — o cache do TMDB inclusive.
    it('respeita o teto de listas', () => {
        for (let i = 0; i < MAX_LISTAS; i++) listsService.create(`L${i}`);
        expect(listsService.create('Mais uma')).toBeNull();
        expect(listsService.list()).toHaveLength(MAX_LISTAS);
    });

    it('excluir leva os itens junto e não toca nas outras', () => {
        const a = listsService.create('A')!;
        const b = listsService.create('B')!;
        listsService.toggleItem(a.id, filme('1'));
        listsService.toggleItem(b.id, filme('2'));

        listsService.remove(a.id);
        expect(listsService.get(a.id)).toBeNull();
        expect(listsService.get(b.id)?.itens).toHaveLength(1);
    });

    it('operar numa lista que não existe não cria nada', () => {
        expect(listsService.toggleItem('fantasma', filme('1'))).toBe(false);
        expect(listsService.list()).toEqual([]);
    });
});

describe('itens', () => {
    it('liga e desliga', () => {
        const lista = listsService.create('A')!;
        expect(listsService.toggleItem(lista.id, filme('1'))).toBe(true);
        expect(listsService.has(lista.id, '1', 'movie')).toBe(true);

        expect(listsService.toggleItem(lista.id, filme('1'))).toBe(false);
        expect(listsService.has(lista.id, '1', 'movie')).toBe(false);
    });

    // Id colide entre filme e série no Xtream: tudo tem que ser chaveado por
    // id+tipo, como já é nos favoritos.
    it('mesmo id, tipos diferentes, itens diferentes', () => {
        const lista = listsService.create('A')!;
        listsService.toggleItem(lista.id, { id: '7', type: 'movie', title: 'Filme' });
        listsService.toggleItem(lista.id, { id: '7', type: 'series', title: 'Série' });
        expect(listsService.get(lista.id)?.itens).toHaveLength(2);
        expect(listsService.has(lista.id, '7', 'movie')).toBe(true);
        expect(listsService.has(lista.id, '7', 'series')).toBe(true);
    });

    it('o mais antigo sai quando bate o teto', () => {
        const lista = listsService.create('A')!;
        for (let i = 0; i < MAX_ITENS_POR_LISTA + 3; i++) {
            listsService.toggleItem(lista.id, filme(String(i)));
        }
        const itens = listsService.get(lista.id)!.itens;
        expect(itens).toHaveLength(MAX_ITENS_POR_LISTA);
        expect(itens[0].id).toBe('3');           // 0, 1 e 2 saíram
        expect(itens.at(-1)?.id).toBe(String(MAX_ITENS_POR_LISTA + 2));
    });

    it('conta em quantas listas o item está', () => {
        const a = listsService.create('A')!;
        const b = listsService.create('B')!;
        listsService.toggleItem(a.id, filme('1'));
        listsService.toggleItem(b.id, filme('1'));
        expect(listsService.countListsWith('1', 'movie')).toBe(2);
        expect(listsService.countListsWith('9', 'movie')).toBe(0);
    });
});

describe('dado corrompido', () => {
    it.each(['lixo{', '"texto"', '{"nao":"array"}'])(
        'devolve lista vazia em vez de explodir: %s', (bruto) => {
            localStorage.setItem('neostream_lists', bruto);
            expect(listsService.list()).toEqual([]);
        });

    it('descarta entradas quebradas e mantém as boas', () => {
        localStorage.setItem('neostream_lists', JSON.stringify([
            { nome: 'sem id' },
            { id: 'x', nome: 'boa', criadaEm: 1, itens: [{ id: '1', type: 'movie' }, { type: 'movie' }] },
        ]));
        const listas = listsService.list();
        expect(listas).toHaveLength(1);
        expect(listas[0].itens).toHaveLength(1);
        expect(listas[0].itens[0].title).toBe('Sem título');
    });
});
