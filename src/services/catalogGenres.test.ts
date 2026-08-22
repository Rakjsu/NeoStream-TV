// Gênero extraído do nome da categoria (item 31).
//
// O filtro nasce ou morre aqui: casar demais mistura gêneros e o usuário
// escolhe "Comédia" e recebe terror; casar de menos oferece um gênero que
// devolve grade vazia — que numa TV é indistinguível de bug.

import { describe, it, expect } from 'vitest';
import {
    generoDaCategoria, mapaDeGeneros, generosDisponiveis, rotuloDoGenero, GENEROS,
} from './catalogGenres';

const cat = (id: string, nome: string) => ({ category_id: id, category_name: nome });

describe('generoDaCategoria', () => {
    // Formatos reais de painel Xtream — é assim que os nomes chegam.
    it.each([
        ['Ação | 2024', 'acao'],
        ['FILMES - COMÉDIA', 'comedia'],
        ['Séries | Drama', 'drama'],
        ['VOD TERROR', 'terror'],
        ['Documentários HD', 'documentario'],
        ['FICÇÃO CIENTÍFICA', 'ficcao'],
        ['Sci-Fi & Fantasy', 'ficcao'],
        ['Filmes de Guerra', 'guerra'],
        ['INFANTIL / KIDS', 'infantil'],
        ['Doramas', 'novela'],
        ['Novelas Turcas', 'novela'],
    ])('%s → %s', (nome, esperado) => {
        expect(generoDaCategoria(nome)).toBe(esperado);
    });

    it('funciona sem acento e em qualquer caixa', () => {
        expect(generoDaCategoria('ACAO')).toBe('acao');
        expect(generoDaCategoria('ação')).toBe('acao');
        expect(generoDaCategoria('AÇÃO')).toBe('acao');
    });

    // A ordem de GENEROS é significativa: "Animes" contém "anime" mas também
    // contém "anim", e "Animação" viria antes se a lista estivesse na ordem
    // errada — o gênero mais pedido do catálogo cairia dentro de outro.
    it('anime não é engolido por animação', () => {
        expect(generoDaCategoria('ANIMES LEGENDADOS')).toBe('anime');
        expect(generoDaCategoria('ANIMAÇÃO INFANTIL')).toBe('animacao');
    });

    // BUG REAL achado por este teste: "ANIMAÇÃO" normaliza pra `animacao`, que
    // CONTÉM `acao`. Com `includes` cru, TODO desenho do catálogo ia parar em
    // Ação — o mesmo defeito de fronteira que já tinha escondido "TV Amazonas"
    // atrás da tela de rádio.
    it.each([
        ['ANIMAÇÃO', 'animacao'],
        ['Animações', 'animacao'],
        ['DESENHOS ANIMADOS', 'animacao'],
    ])('%s não cai em Ação por conter "acao": %s', (nome, esperado) => {
        expect(generoDaCategoria(nome)).toBe(esperado);
    });

    // O outro lado da fronteira: nome de canal que COMEÇA com uma pista curta.
    it.each(['WARNER CHANNEL', 'Warner TV', 'Dramaturgia Brasileira'])(
        'palavra maior que a pista não casa: %s', (nome) => {
            expect(generoDaCategoria(nome)).not.toBe('guerra');
        });

    // Categoria que não fala de gênero tem que devolver null, não um chute:
    // classificar "4K" como algum gênero mistura o catálogo inteiro.
    it.each(['LANÇAMENTOS 2024', '4K', 'COLEÇÕES', 'EM ALTA', 'Netflix', ''])(
        'não inventa gênero para: %s', (nome) => {
            expect(generoDaCategoria(nome)).toBeNull();
        });

    it('nome ausente não quebra', () => {
        expect(generoDaCategoria(undefined as unknown as string)).toBeNull();
    });

    it('todo gênero da tabela é reconhecível pela própria pista', () => {
        for (const genero of GENEROS) {
            expect(generoDaCategoria(genero.pistas[0])).toBe(genero.id);
        }
    });
});

describe('mapaDeGeneros', () => {
    it('mapeia só o que tem gênero', () => {
        const mapa = mapaDeGeneros([cat('1', 'Ação'), cat('2', '4K'), cat('3', 'Terror')]);
        expect(mapa.get('1')).toBe('acao');
        expect(mapa.get('3')).toBe('terror');
        expect(mapa.has('2')).toBe(false);
    });

    it('lista vazia devolve mapa vazio', () => {
        expect(mapaDeGeneros([]).size).toBe(0);
    });
});

describe('generosDisponiveis', () => {
    // Oferecer um gênero que o provedor não tem devolve grade vazia — e numa
    // TV grade vazia sem explicação é indistinguível de defeito.
    it('só oferece o que o provedor realmente tem', () => {
        const disponiveis = generosDisponiveis([
            cat('1', 'Ação'), cat('2', 'LANÇAMENTOS'), cat('3', 'Comédia Nacional'),
        ]);
        expect(disponiveis.map(g => g.id)).toEqual(['acao', 'comedia']);
    });

    it('não repete o gênero que aparece em várias categorias', () => {
        const disponiveis = generosDisponiveis([
            cat('1', 'Ação | 2024'), cat('2', 'AÇÃO CLÁSSICOS'), cat('3', 'Ação Nacional'),
        ]);
        expect(disponiveis).toHaveLength(1);
    });

    // A ordem tem que ser estável: o botão cicla por ela, e uma ordem que
    // muda com a lista de categorias faria a sequência mudar sozinha.
    it('mantém a ordem da tabela, não a das categorias', () => {
        const disponiveis = generosDisponiveis([cat('1', 'Terror'), cat('2', 'Ação')]);
        expect(disponiveis.map(g => g.id)).toEqual(['acao', 'terror']);
    });

    it('catálogo sem gênero nenhum devolve lista vazia (o botão some)', () => {
        expect(generosDisponiveis([cat('1', 'LANÇAMENTOS'), cat('2', '4K')])).toEqual([]);
    });
});

describe('rotuloDoGenero', () => {
    it('devolve o rótulo com acento pro botão', () => {
        expect(rotuloDoGenero('acao')).toBe('Ação');
        expect(rotuloDoGenero('documentario')).toBe('Documentário');
    });

    it('id desconhecido devolve o próprio id em vez de vazio', () => {
        expect(rotuloDoGenero('inexistente')).toBe('inexistente');
    });
});
