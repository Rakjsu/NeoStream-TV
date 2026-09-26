// @vitest-environment jsdom
//
// T134 — "Limpar Tudo" continuava no cabeçalho com uma lista NOMEADA aberta
// e apagava a lista que NÃO estava na tela.
//
// O botão chama storage.clearWatchLater(), que zera só a lista padrão; as
// listas nomeadas vivem em outra chave. Com "📌 Clássicos" aberta, o cabeçalho
// dizia "1 em Clássicos", o → levava ao "Limpar Tudo", o primeiro OK armava
// e o segundo apagava em silêncio a lista padrão, que está atrás da aba
// "Todos". Na tela, o botão simplesmente sumia e os cards continuavam lá.
//
// O teste monta a Minha Lista DE VERDADE e dirige pelo teclado, como o
// controle remoto faz.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { installFakeStorage } from '../testing/fakeStorage';
import { storage } from '../services/storage';
import { listsService } from '../services/listsService';
import { MyList } from './MyList';

/** Dispara uma tecla como a TV dispara (keyCode; o `key` vem vazio no Tizen). */
function tecla(keyCode: number): void {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '', keyCode, bubbles: true, cancelable: true }));
    });
}
const CIMA = 38;
const DIREITA = 39;
const OK = 13;

/** Slot do cabeçalho (aba ou "Limpar Tudo") com o foco do D-pad. */
const focado = (): Element | null =>
    document.querySelector('.mylist-header .tv-focused, .tabs-container .tv-focused');
const textoFocado = () => focado()?.textContent?.trim() ?? null;
const botaoLimpar = () => document.querySelector('.mylist-header .clear-btn');
const titulosNaTela = () =>
    Array.from(document.querySelectorAll('.cards-grid .card .card-title')).map(el => el.textContent);
const subtitulo = () => document.querySelector('.mylist-header .subtitle')?.textContent ?? null;

/**
 * Anda com → pelo cabeçalho até o foco parar de mover. Espera a CONDIÇÃO
 * (o foco no último slot), não um número fixo de toques.
 */
function irAoUltimoSlot(): void {
    const vistos: string[] = [];
    for (;;) {
        const antes = focado();
        if (!antes) throw new Error('nenhum slot do cabeçalho com foco');
        vistos.push(textoFocado() ?? '?');
        if (vistos.length > 40) throw new Error(`o → nunca parou: ${vistos.join(' | ')}`);
        tecla(DIREITA);
        if (focado() === antes) return;
    }
}

/** Anda com → até a aba cujo texto contém `nome`; falha alto se não existir. */
function focarAba(nome: string): void {
    const vistos: string[] = [];
    for (;;) {
        const atual = textoFocado();
        if (atual && atual.includes(nome)) return;
        vistos.push(atual ?? '?');
        const antes = focado();
        tecla(DIREITA);
        if (focado() === antes) throw new Error(`não existe aba "${nome}"; slots: ${vistos.join(' | ')}`);
    }
}

let classicosId = '';

beforeEach(() => {
    installFakeStorage();
    // jsdom não implementa scrollIntoView, e a fileira de abas rola com o foco
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
    storage.addWatchLater({ id: '1', type: 'movie', title: 'Padrão Um' });
    storage.addWatchLater({ id: '2', type: 'series', title: 'Padrão Dois' });
    const classicos = listsService.create('Clássicos');
    if (!classicos) throw new Error('não criou a lista');
    classicosId = classicos.id;
    listsService.toggleItem(classicosId, { id: '9', type: 'movie', title: 'Casablanca' });
});

afterEach(() => {
    cleanup();
});

/** Monta a página, sobe pras abas e abre a lista nomeada "Clássicos". */
function abrirClassicos(): void {
    render(<MyList onNavigate={() => {}} />);
    tecla(CIMA); // dos cards pras abas
    focarAba('Clássicos');
    tecla(OK);
    expect(subtitulo()).toContain('Clássicos');
    expect(titulosNaTela()).toEqual(['Casablanca']);
}

describe('Minha Lista — "Limpar Tudo" só fala da lista padrão', () => {
    it('com uma lista nomeada aberta, o cabeçalho não oferece "Limpar Tudo"', () => {
        abrirClassicos();
        expect(botaoLimpar()).toBeNull();
    });

    it('OK duas vezes no último slot do cabeçalho não apaga a lista padrão escondida atrás de "Todos"', () => {
        abrirClassicos();

        irAoUltimoSlot();
        const ultimoSlot = textoFocado();
        tecla(OK);
        tecla(OK);

        // A lista padrão continua inteira no armazenamento...
        expect(storage.getWatchLater().map(item => item.title)).toEqual(['Padrão Um', 'Padrão Dois']);
        // ...e a lista nomeada também
        expect(listsService.get(classicosId)?.itens.map(item => item.title)).toEqual(['Casablanca']);
        // O último slot alcançável é uma aba, não um botão que mexe em outra lista
        expect(ultimoSlot).not.toContain('Limpar Tudo');
    });

    it('na aba "Todos" o "Limpar Tudo" continua lá, arma no 1º OK e esvazia a lista padrão no 2º', () => {
        render(<MyList onNavigate={() => {}} />);
        tecla(CIMA);

        irAoUltimoSlot();
        expect(focado()).toBe(botaoLimpar());
        expect(textoFocado()).toContain('Limpar Tudo');

        tecla(OK);
        expect(textoFocado()).toContain('OK de novo apaga');
        expect(storage.getWatchLater()).toHaveLength(2);

        tecla(OK);
        expect(storage.getWatchLater()).toHaveLength(0);
        // O que foi apagado é o que estava na tela; a lista nomeada fica
        expect(listsService.get(classicosId)?.itens).toHaveLength(1);
        expect(botaoLimpar()).toBeNull();
        // O foco não fica preso no slot que sumiu
        expect(focado()).not.toBeNull();
    });

    // O caminho mais comum de cair numa lista nomeada VAZIA: criar uma. O
    // "＋ Nova lista" abre a lista recém-criada, sem nenhum item, e com ela já
    // são duas listas nomeadas. Esconder o botão só quando a lista aberta tem
    // itens, ou só quando existe uma única lista, devolveria o apagão aqui.
    it('na lista recém-criada (vazia), OK duas vezes no fim do cabeçalho também não apaga a lista padrão', () => {
        render(<MyList onNavigate={() => {}} />);
        tecla(CIMA);
        focarAba('Nova lista');
        tecla(OK); // abre as sugestões
        tecla(OK); // cria com a primeira sugestão e abre a lista nova
        expect(listsService.list()).toHaveLength(2);
        expect(subtitulo()).toContain('0 em');
        expect(titulosNaTela()).toEqual([]);
        expect(botaoLimpar()).toBeNull();

        irAoUltimoSlot();
        expect(textoFocado()).not.toContain('Limpar Tudo');
        tecla(OK);
        tecla(OK);

        expect(storage.getWatchLater().map(item => item.title)).toEqual(['Padrão Um', 'Padrão Dois']);
        expect(listsService.get(classicosId)?.itens.map(item => item.title)).toEqual(['Casablanca']);
    });

    it('com um único item na lista padrão, o "Limpar Tudo" continua ao alcance em "Todos"', () => {
        storage.removeWatchLater('2', 'series');
        render(<MyList onNavigate={() => {}} />);
        tecla(CIMA);
        expect(subtitulo()).toContain('1 itens');

        irAoUltimoSlot();
        expect(focado()).toBe(botaoLimpar());
        tecla(OK);
        tecla(OK);
        expect(storage.getWatchLater()).toHaveLength(0);
    });

    // As três vistas da lista PADRÃO (Todos, Filmes, Séries) continuam com o
    // botão: só a lista nomeada perde. Sem Filmes/Séries aqui, esconder o
    // botão em tudo que não fosse "Todos" passaria calado.
    it.each(['Todos', '🎬 Filmes', '📺 Séries'])(
        'voltar de uma lista nomeada pra "%s" devolve o "Limpar Tudo" ao alcance do →',
        (aba) => {
            abrirClassicos();
            expect(botaoLimpar()).toBeNull();

            // ← até a aba e OK
            const ESQUERDA = 37;
            for (;;) {
                const atual = textoFocado() ?? '';
                if (atual.startsWith(aba)) break;
                const antes = focado();
                tecla(ESQUERDA);
                if (focado() === antes) throw new Error(`não achou a aba "${aba}" (parou em "${atual}")`);
            }
            tecla(OK);
            expect(subtitulo()).toContain('2 itens');
            expect(document.querySelector('.tabs-container .tab.active')?.textContent).toContain(aba);

            irAoUltimoSlot();
            expect(focado()).toBe(botaoLimpar());
            expect(textoFocado()).toContain('Limpar Tudo');
        },
    );
});
