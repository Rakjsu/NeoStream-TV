// T042 — cada letra digitada na busca global renormalizava o catálogo INTEIRO.
//
// searchIn rodava normalizeText (normalize('NFD') + regex de acentos +
// toLowerCase) no nome de TODO item a cada chamada, e o GlobalSearch chama
// searchIn três vezes por tecla (canais, filmes, séries). O nome de um item
// não muda entre uma tecla e outra — só a consulta muda —, então a conta era
// jogada fora e refeita idêntica, milhares de vezes, num Chromium 69 de 1 GB.
//
// O conserto reaproveita o cache por objeto que a busca de Filmes/Séries já
// tinha (searchNameOf, T019) em vez de abrir um segundo: são as MESMAS
// instâncias do cache do api, então o nome normalizado numa tela serve à outra.
//
// Os testes medem o trabalho de verdade: quantas vezes normalize('NFD') roda.
// A consulta sempre é normalizada (1 por busca); o nome, só na 1ª vez do item.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { searchIn, normalizeText } from './searchCatalog';
import { searchNameOf } from './catalogExtras';

afterEach(() => {
    vi.restoreAllMocks();
});

const item = (name: string) => ({ name });

/** Catálogo sintético: nomes com acento e caixa misturada, como lista de provedor. */
function catalogo(tamanho: number) {
    return Array.from({ length: tamanho }, (_, i) =>
        item(i % 3 === 0 ? `Canal Ação ${i}` : i % 3 === 1 ? `GLOBO São Paulo ${i}` : `Filme Número ${i}`)
    );
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

describe('searchIn — nome normalizado uma vez por item (T042)', () => {
    it('a segunda tecla na mesma lista normaliza só a consulta, nenhum nome', () => {
        const itens = catalogo(3000);
        searchIn(itens, 'gl', 8); // primeira busca: paga a normalização dos nomes

        let achados: Array<{ name: string }> = [];
        const normalizacoes = contarNormalizacoes(() => { achados = searchIn(itens, 'glo', 8); });

        expect(achados).toHaveLength(8);
        // Antes: 3001 (3000 nomes + a consulta). Agora: só a consulta.
        expect(normalizacoes).toBe(1);
    });

    it('as três listas da busca global, tecla após tecla, não renormalizam nada', () => {
        const canais = catalogo(1000);
        const filmes = catalogo(1000);
        const series = catalogo(1000);
        const buscarTudo = (q: string) => [
            ...searchIn(canais, q, 8), ...searchIn(filmes, q, 8), ...searchIn(series, q, 8),
        ];
        buscarTudo('ac');

        const normalizacoes = contarNormalizacoes(() => {
            for (const q of ['aca', 'acao', 'ação']) buscarTudo(q);
        });

        // 3 teclas x 3 listas = 9 consultas normalizadas; 0 nomes (antes: 9009).
        expect(normalizacoes).toBe(9);
    });

    it('o nome que a busca de Filmes/Séries já normalizou não é refeito aqui, e vice-versa', () => {
        // Filmes e Séries (searchNameOf) e a busca global recebem as MESMAS
        // instâncias do cache do api: um cache só, não dois com a mesma string.
        const vistosEmFilmes = catalogo(300);
        for (const filme of vistosEmFilmes) searchNameOf(filme);
        expect(contarNormalizacoes(() => searchIn(vistosEmFilmes, 'glo', 8))).toBe(1);

        const vistosNaBuscaGlobal = catalogo(300);
        searchIn(vistosNaBuscaGlobal, 'glo', 8);
        expect(contarNormalizacoes(() => {
            for (const serie of vistosNaBuscaGlobal) searchNameOf(serie);
        })).toBe(0);
    });

    it('o mesmo item em duas listas (filtro Kids: subconjunto das mesmas instâncias) é normalizado uma vez só', () => {
        const compartilhados = catalogo(200);
        const outraLista = compartilhados.slice(0, 100);
        searchIn(compartilhados, 'gl', 8);

        expect(contarNormalizacoes(() => searchIn(outraLista, 'glo', 8))).toBe(1);
    });

    it('o resultado é o mesmo de normalizar na hora (acento, caixa e ranking), consulta após consulta', () => {
        const itens = [
            item('Canal Globo News'), item('Globo SP'), item('Rede Globo Nordeste'),
            item('Coração À Noite'), item('São Paulo FC'),
        ];
        // Mesma lista, consultas diferentes: o cache não pode "grudar" resultado velho
        expect(searchIn(itens, 'globo', 10).map(i => i.name))
            .toEqual(['Globo SP', 'Canal Globo News', 'Rede Globo Nordeste']);
        expect(searchIn(itens, 'coracao', 10).map(i => i.name)).toEqual(['Coração À Noite']);
        expect(searchIn(itens, 'SAO', 10).map(i => i.name)).toEqual(['São Paulo FC']);
        expect(searchIn(itens, 'noite', 10).map(i => i.name)).toEqual(['Coração À Noite']);
        expect(searchIn(itens, 'globo', 10).map(i => i.name))
            .toEqual(['Globo SP', 'Canal Globo News', 'Rede Globo Nordeste']);
    });

    it('digitar o nome exatamente como aparece acha o item (consulta e nome normalizados do mesmo jeito)', () => {
        // Consulta passa por normalizeText e nome por searchNameOf: se as duas
        // normalizações divergirem (acento, caixa, espaço nas pontas), isto quebra.
        const nomes = ['  Ñandú Açaí  ', 'ÉRICA ÜBER', 'Pão de Queijo', 'Ångström TV'];
        const itens = nomes.map(item);
        for (const nome of nomes) {
            expect(searchIn(itens, nome, 10).map(i => i.name)).toEqual([nome]);
        }
    });

    it('lista reordenada ou com item novo continua certa (cache é por item, não por posição)', () => {
        const itens = [item('Zeta Ação'), item('Alfa Ação')];
        expect(searchIn(itens, 'acao', 10)).toHaveLength(2);

        itens.sort((a, b) => a.name.localeCompare(b.name));
        itens.push(item('Beta Ação'));
        expect(searchIn(itens, 'alfa', 10).map(i => i.name)).toEqual(['Alfa Ação']);
        expect(searchIn(itens, 'beta', 10).map(i => i.name)).toEqual(['Beta Ação']);
        expect(searchIn(itens, 'acao', 10)).toHaveLength(3);
    });

    it('item sem nome continua não derrubando a busca, nem sendo renormalizado na segunda tecla', () => {
        // Lista de provedor tem item sem nome ou só com espaço: o nome normalizado
        // dele é '' e tem de sair do cache como qualquer outro, não virar "falsy,
        // normaliza de novo" a cada tecla.
        const quebrado = [{ name: undefined as unknown as string }, item('   '), item('Globo')];
        expect(searchIn(quebrado, 'glo', 10)).toHaveLength(1);

        let achados: Array<{ name: string }> = [];
        expect(contarNormalizacoes(() => { achados = searchIn(quebrado, 'globo', 10); })).toBe(1);
        expect(achados.map(i => i.name)).toEqual(['Globo']);
    });

    it('normalizeText segue exportado e igual', () => {
        expect(normalizeText('  Coração À NOITE ')).toBe('coracao a noite');
    });
});
