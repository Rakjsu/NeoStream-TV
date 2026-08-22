// Cruzamento TMDB ↔ catálogo do provedor (itens 29 e 34).
//
// Errar aqui tem duas caras, e as duas são ruins: casar de menos esconde
// filmes que o usuário TEM (a saga aparece vazia e o recurso parece quebrado);
// casar demais oferece um card que abre o filme ERRADO.

import { describe, it, expect } from 'vitest';
import { indexarCatalogo, acharNoCatalogo, cruzarComCatalogo } from './tmdbMatch';

const filme = (stream_id: number, name: string, tmdb_id?: string) => ({ stream_id, name, tmdb_id });

describe('acharNoCatalogo', () => {
    it('tmdb_id ganha de tudo', () => {
        const indice = indexarCatalogo([
            filme(1, 'Nome Completamente Diferente', '603'),
            filme(2, 'Matrix'),
        ]);
        expect(acharNoCatalogo(indice, { id: 603, title: 'Matrix' })?.stream_id).toBe(1);
    });

    it('cai no nome quando não há tmdb_id', () => {
        const indice = indexarCatalogo([filme(2, 'Matrix')]);
        expect(acharNoCatalogo(indice, { id: 603, title: 'Matrix' })?.stream_id).toBe(2);
    });

    // O caso que quebra um cruzamento ingênuo: o provedor nomeia com tags e o
    // TMDB manda o título limpo.
    it.each([
        'Matrix [DUB]',
        'Matrix 4K',
        'Matrix (1999)',
        'MATRIX FHD',
        'Matrix [LEG] 1080p',
    ])('acha apesar das tags do provedor: %s', (nomeNoProvedor) => {
        const indice = indexarCatalogo([filme(7, nomeNoProvedor)]);
        expect(acharNoCatalogo(indice, { id: 603, title: 'Matrix' })?.stream_id).toBe(7);
    });

    it('acento e caixa não atrapalham', () => {
        const indice = indexarCatalogo([filme(3, 'O CORAÇÃO DELAS')]);
        expect(acharNoCatalogo(indice, { id: 1, title: 'O Coração Delas' })?.stream_id).toBe(3);
    });

    // `versionBaseName` guarda o ano na chave de propósito (foi o conserto que
    // impediu três Batman de virarem um card). Sem separar base e ano aqui, o
    // TMDB — que manda o título LIMPO — nunca casaria com "Batman (1989)".
    it('o ano do provedor não impede o casamento com o título limpo', () => {
        const indice = indexarCatalogo([filme(9, 'Batman (1989)')]);
        expect(acharNoCatalogo(indice, { id: 268, title: 'Batman' })?.stream_id).toBe(9);
    });

    // E o outro lado: quando o catálogo tem VÁRIAS refilmagens, o ano do TMDB
    // é o que decide. Sem ele, o card abriria o Batman errado.
    it('com refilmagens no catálogo, o ano do TMDB desempata', () => {
        const indice = indexarCatalogo([
            filme(1, 'Batman (1966)'),
            filme(2, 'Batman (1989)'),
            filme(3, 'Batman (2022)'),
        ]);
        expect(acharNoCatalogo(indice, { id: 268, title: 'Batman', year: '1989' })?.stream_id).toBe(2);
        expect(acharNoCatalogo(indice, { id: 414906, title: 'Batman', year: '2022-03-01' })?.stream_id).toBe(3);
    });

    it('sem ano nenhum, devolve o primeiro em vez de nada', () => {
        const indice = indexarCatalogo([filme(1, 'Batman (1966)'), filme(2, 'Batman (1989)')]);
        expect(acharNoCatalogo(indice, { id: 268, title: 'Batman' })?.stream_id).toBe(1);
    });

    it('o que não está no catálogo devolve null', () => {
        const indice = indexarCatalogo([filme(1, 'Matrix')]);
        expect(acharNoCatalogo(indice, { id: 999, title: 'Filme Que Ele Não Tem' })).toBeNull();
    });

    it('tmdb_id vazio ou zero não vira chave', () => {
        const indice = indexarCatalogo([filme(1, 'A', ''), filme(2, 'B', '0')]);
        expect(indice.porTmdbId.size).toBe(0);
        expect(acharNoCatalogo(indice, { id: 0, title: 'Nada' })).toBeNull();
    });

    it('catálogo vazio e título vazio não explodem', () => {
        expect(acharNoCatalogo(indexarCatalogo([]), { id: 1, title: 'X' })).toBeNull();
        expect(acharNoCatalogo(indexarCatalogo([filme(1, 'A')]), { id: 1, title: '' })).toBeNull();
    });
});

describe('cruzarComCatalogo', () => {
    const catalogo = [
        filme(10, 'Matrix (1999)'),
        filme(11, 'Matrix Reloaded'),
        filme(12, 'Duna'),
    ];

    // A ordem do TMDB numa saga é a cronológica — é a que a pessoa espera ver.
    it('preserva a ordem do TMDB e descarta o que ela não tem', () => {
        const achados = cruzarComCatalogo([
            { id: 604, title: 'Matrix Reloaded' },
            { id: 605, title: 'Matrix Revolutions' },  // não está no catálogo
            { id: 603, title: 'Matrix', year: '1999' },
        ], indexarCatalogo(catalogo));
        expect(achados.map(f => f.stream_id)).toEqual([11, 10]);
    });

    // O filme que está aberto não pode aparecer na própria fileira de "saga".
    it('exclui o item que já está na tela', () => {
        const achados = cruzarComCatalogo(
            [{ id: 603, title: 'Matrix', year: '1999' }, { id: 604, title: 'Matrix Reloaded' }],
            indexarCatalogo(catalogo),
            10
        );
        expect(achados.map(f => f.stream_id)).toEqual([11]);
    });

    // Dois títulos do TMDB podem cair no mesmo item quando o nome é genérico —
    // e a fileira mostraria o mesmo card duas vezes.
    it('não repete o mesmo item do catálogo', () => {
        const achados = cruzarComCatalogo(
            [{ id: 1, title: 'Duna' }, { id: 2, title: 'DUNA' }],
            indexarCatalogo(catalogo)
        );
        expect(achados).toHaveLength(1);
    });

    it('lista vazia devolve lista vazia', () => {
        expect(cruzarComCatalogo([], indexarCatalogo(catalogo))).toEqual([]);
    });
});

describe('indexarCatalogo', () => {
    // Trocar o vencedor a cada duplicata faria o resultado depender da ordem
    // de varredura — e a lista do provedor traz a melhor versão primeiro.
    it('o primeiro de cada chave vence', () => {
        const indice = indexarCatalogo([
            filme(1, 'Matrix [4K]'),
            filme(2, 'Matrix [SD]'),
        ]);
        expect(indice.porNome.get('matrix')?.stream_id).toBe(1);
    });

    it('indexa por id e por nome ao mesmo tempo', () => {
        const indice = indexarCatalogo([filme(1, 'Matrix', '603')]);
        expect(indice.porTmdbId.get('603')?.stream_id).toBe(1);
        expect(indice.porNome.get('matrix')?.stream_id).toBe(1);
    });
});
