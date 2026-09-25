import { describe, it, expect } from 'vitest';
import { amostraAleatoria, maioresPor } from './homeRanking';

const item = (nome: string, peso: number) => ({ nome, peso });

describe('maioresPor', () => {
    it('devolve os n maiores em ordem decrescente', () => {
        const itens = [item('a', 3), item('b', 9), item('c', 1), item('d', 7)];
        expect(maioresPor(itens, i => i.peso, 2).map(i => i.nome)).toEqual(['b', 'd']);
    });

    it('empate mantém a ordem de entrada (o sort do Chromium 69 não é estável)', () => {
        const itens = [item('primeiro', 5), item('segundo', 5), item('terceiro', 5)];
        expect(maioresPor(itens, i => i.peso, 2).map(i => i.nome)).toEqual(['primeiro', 'segundo']);
    });

    it('pede mais do que existe: devolve tudo, ordenado', () => {
        const itens = [item('a', 1), item('b', 2)];
        expect(maioresPor(itens, i => i.peso, 10).map(i => i.nome)).toEqual(['b', 'a']);
    });

    it('lista vazia, n zero e n negativo não quebram', () => {
        expect(maioresPor([], (i: { peso: number }) => i.peso, 5)).toEqual([]);
        expect(maioresPor([item('a', 1)], i => i.peso, 0)).toEqual([]);
        expect(maioresPor([item('a', 1)], i => i.peso, -3)).toEqual([]);
    });

    // A chave real da fileira de séries é `new Date(last_modified).getTime()`,
    // e provedor devolve data que não parseia com alguma frequência. Antes,
    // comparação com NaN sendo sempre falsa, o item parava onde desse.
    it('chave não-finita vai para o fim, de forma determinística', () => {
        // Vale para NaN e para os infinitos: nenhum dos dois é peso de verdade
        // aqui (a chave real é uma data ou um epoch), e empatados entre si
        // mantêm a ordem de entrada.
        const itens = [item('nan', NaN), item('bom', 2), item('inf', Infinity)];
        expect(maioresPor(itens, i => i.peso, 3).map(i => i.nome)).toEqual(['bom', 'nan', 'inf']);
    });

    it('a chave é calculada UMA vez por item — é o ponto do exercício', () => {
        let chamadas = 0;
        const itens = Array.from({ length: 500 }, (_, i) => item(String(i), i));
        maioresPor(itens, i => { chamadas++; return i.peso; }, 15);
        expect(chamadas).toBe(500);
    });

    it('não mexe no array de entrada', () => {
        const itens = [item('a', 1), item('b', 2)];
        const copia = [...itens];
        maioresPor(itens, i => i.peso, 1);
        expect(itens).toEqual(copia);
    });
});

describe('amostraAleatoria', () => {
    const catalogo = Array.from({ length: 20 }, (_, i) => `item-${i}`);

    it('devolve a quantidade pedida, sem repetir', () => {
        const amostra = amostraAleatoria(catalogo, 8);
        expect(amostra).toHaveLength(8);
        expect(new Set(amostra).size).toBe(8);
        for (const escolhido of amostra) expect(catalogo).toContain(escolhido);
    });

    it('pede mais do que existe: devolve tudo, uma vez cada', () => {
        expect(new Set(amostraAleatoria(catalogo, 999)).size).toBe(catalogo.length);
    });

    it('sorteio viciado ainda assim completa, sem repetir e sem laço eterno', () => {
        // Sempre o mesmo índice: o caminho de tentativas esgota e a rede de
        // segurança completa em ordem.
        const amostra = amostraAleatoria(catalogo, 5, () => 0);
        expect(amostra).toHaveLength(5);
        expect(new Set(amostra).size).toBe(5);
        expect(amostra[0]).toBe('item-0');
    });

    it('sorteio que devolve 1 (limite superior) não estoura o array', () => {
        const amostra = amostraAleatoria(catalogo, 3, () => 1);
        expect(amostra).toHaveLength(3);
        expect(amostra.every(x => typeof x === 'string')).toBe(true);
    });

    it('zero, negativo e catálogo vazio devolvem lista vazia', () => {
        expect(amostraAleatoria(catalogo, 0)).toEqual([]);
        expect(amostraAleatoria(catalogo, -2)).toEqual([]);
        expect(amostraAleatoria([], 5)).toEqual([]);
    });

    it('não mexe no array de entrada', () => {
        const copia = [...catalogo];
        amostraAleatoria(catalogo, 8);
        expect(catalogo).toEqual(copia);
    });
});
