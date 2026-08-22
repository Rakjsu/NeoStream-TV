// Variantes de canal, busca, fila de episódios, gate Kids e o dado deixado por
// versões antigas do app.
//
// O fio comum: todos falham entregando MENOS do que deviam. Um agrupador que
// funde canais demais some com canais da grade; um gate Kids que erra deixa
// vazar o que não devia; e uma lista gravada por uma versão antiga vira card
// em branco em vez de erro.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installFakeStorage, setPerfilAtivo } from '../testing/fakeStorage';
import {
    qualityRank, variantBaseName, qualityLabel, groupChannelVariants,
} from './channelVariants';
import { normalizeText, searchIn } from './searchCatalog';
import {
    currentEpisode, playbackTitle, hasNext, hasPrevious, type EpisodeQueue,
} from './seriesPlayback';
import { isAdultCategoryName, kidsFilter } from './kidsFilter';
import { profileService } from './profileService';
import { storage } from './storage';
import { playlistService } from './playlistService';

beforeEach(() => {
    installFakeStorage();
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Item 91 — variantes de canal
// ---------------------------------------------------------------------------
describe('channelVariants', () => {
    const canal = (id: number, name: string) => ({ stream_id: id, name });

    it('ordena a qualidade do melhor pro pior', () => {
        const nomes = ['ESPN 4K', 'ESPN UHD', 'ESPN FHD', 'ESPN HD', 'ESPN SD'];
        const notas = nomes.map(qualityRank);
        expect(notas).toEqual([...notas].sort((a, b) => a - b));
    });

    // Canal sem tag nenhuma é o caso mais comum de lista IPTV. Ele não pode
    // perder pra um "SD" declarado, nem ganhar de um "HD" declarado.
    it('canal sem tag fica entre HD e SD', () => {
        expect(qualityRank('ESPN')).toBeGreaterThan(qualityRank('ESPN HD'));
        expect(qualityRank('ESPN')).toBeLessThan(qualityRank('ESPN SD'));
    });

    it('junta as variantes do mesmo canal', () => {
        expect(variantBaseName('ESPN FHD')).toBe(variantBaseName('ESPN HD'));
        expect(variantBaseName('ESPN [FHD]')).toBe(variantBaseName('ESPN (HD)'));
        expect(variantBaseName('ESPN [H.265]')).toBe(variantBaseName('ESPN (HEVC)'));
    });

    // Tag de codec SÓ é removida entre colchetes ou parênteses. É deliberado e
    // conservador: "ESPN H265" solto pode ser um canal de verdade com outro
    // nome, e fundir demais SOME com canais da grade — o erro mais caro deste
    // agrupador (foi o que aconteceu com os Batman no catálogo de filmes).
    it('codec solto NÃO funde: entre colchetes é sinal, no meio do nome é nome', () => {
        expect(variantBaseName('ESPN H.265')).not.toBe(variantBaseName('ESPN'));
        expect(variantBaseName('ESPN [H.265]')).toBe(variantBaseName('ESPN'));
    });

    // O espelho do bug do Batman (R3), agora em canal: a tag só vale quando é
    // uma PALAVRA. Sem isso "HBO" viraria "O" e todo canal com HD no meio do
    // nome cairia no mesmo grupo.
    it.each([
        ['HBO', 'HBO 2'],
        ['Discovery HD Theater', 'Discovery'],
        ['SBT', 'SBT Interior'],
    ])('não funde canais diferentes: %s vs %s', (a, b) => {
        expect(variantBaseName(a)).not.toBe(variantBaseName(b));
    });

    it('nome que é SÓ a tag não vira grupo de tudo', () => {
        expect(variantBaseName('FHD')).not.toBe('');
        expect(variantBaseName('FHD')).not.toBe(variantBaseName('HD'));
    });

    it('o rótulo do botão é a qualidade, não o nome inteiro', () => {
        expect(qualityLabel('ESPN FHD')).toBe('FHD');
        expect(qualityLabel('ESPN [4K]')).toBe('4K');
        // Sem tag nenhuma, o rótulo cai pro nome cortado em 12 (cabe no botão)
        expect(qualityLabel('Canal Sem Tag')).toBe('Canal Sem Ta');
    });

    it('agrupa e elege a melhor qualidade como representante', () => {
        const { groups, variantsOf } = groupChannelVariants([
            canal(1, 'ESPN SD'), canal(2, 'ESPN 4K'), canal(3, 'ESPN HD'),
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].name).toBe('ESPN 4K');
        expect(variantsOf.get('2')?.map(c => c.name)).toEqual(['ESPN 4K', 'ESPN HD', 'ESPN SD']);
    });

    // A ordem da grade é a ordem que o provedor mandou; embaralhar faz o
    // usuário perder o canal que ele sabia estar "logo abaixo da Globo".
    it('preserva a ordem da lista original', () => {
        const { groups } = groupChannelVariants([
            canal(1, 'Globo HD'), canal(2, 'SBT HD'), canal(3, 'Globo SD'), canal(4, 'Record HD'),
        ]);
        expect(groups.map(c => c.name)).toEqual(['Globo HD', 'SBT HD', 'Record HD']);
    });

    it('canal sozinho não entra no mapa de variantes', () => {
        const { groups, variantsOf } = groupChannelVariants([canal(1, 'Globo HD')]);
        expect(groups).toHaveLength(1);
        expect(variantsOf.size).toBe(0);
    });

    it('lista vazia não explode', () => {
        expect(groupChannelVariants([]).groups).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Item 91 — busca global
// ---------------------------------------------------------------------------
describe('searchCatalog', () => {
    const item = (name: string) => ({ name });

    it('normaliza acento e caixa', () => {
        expect(normalizeText('Coração À Noite')).toBe(normalizeText('coracao a noite'));
    });

    it('menos de 2 letras não busca (senão devolve o catálogo inteiro)', () => {
        expect(searchIn([item('Globo')], 'g', 10)).toEqual([]);
        expect(searchIn([item('Globo')], '', 10)).toEqual([]);
    });

    // A ordenação é o que faz a busca ser útil numa TV: só cabem ~8 resultados
    // na tela, e "Globo" tem que vir antes de "TV Aparecida Globo Rural".
    it('quem começa com o termo vem primeiro', () => {
        const achados = searchIn(
            [item('Canal Globo News'), item('Globo SP'), item('Rede Globo Nordeste')],
            'globo', 10
        );
        expect(achados[0].name).toBe('Globo SP');
    });

    it('respeita o limite', () => {
        const muitos = Array.from({ length: 50 }, (_, i) => item(`Globo ${i}`));
        expect(searchIn(muitos, 'globo', 8)).toHaveLength(8);
    });

    it('busca com acento acha o nome sem acento e vice-versa', () => {
        expect(searchIn([item('Sao Paulo FC')], 'são', 10)).toHaveLength(1);
        expect(searchIn([item('São Paulo FC')], 'sao', 10)).toHaveLength(1);
    });

    it('item sem nome não derruba a busca', () => {
        const quebrado = [{ name: undefined as unknown as string }, item('Globo')];
        expect(searchIn(quebrado, 'globo', 10)).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Item 92 — fila de episódios
// ---------------------------------------------------------------------------
describe('seriesPlayback', () => {
    const fila = (index: number): EpisodeQueue => ({
        seriesId: '1',
        seriesName: 'Série',
        episodes: [
            { id: 'a', season: 1, episode: 1, container: 'mp4', title: 'Piloto' },
            { id: 'b', season: 1, episode: 2, container: 'mp4', title: 'Segundo' },
            { id: 'c', season: 2, episode: 1, container: 'mkv', title: 'Nova temporada' },
        ],
        index,
    });

    it('o episódio atual é o do índice', () => {
        expect(currentEpisode(fila(1)).id).toBe('b');
    });

    it('o título mostra temporada e episódio', () => {
        expect(playbackTitle(fila(2))).toBe('Série - T2 E1');
    });

    // Estes dois decidem se os botões ⏭ e ⏮ aparecem: errar aqui deixa um
    // botão que não faz nada, ou esconde o próximo episódio que existe.
    it('sabe quando há próximo e anterior', () => {
        expect(hasPrevious(fila(0))).toBe(false);
        expect(hasNext(fila(0))).toBe(true);

        expect(hasPrevious(fila(2))).toBe(true);
        expect(hasNext(fila(2))).toBe(false);
    });

    // A fila é PLANA e atravessa temporadas: o último episódio da temporada 1
    // emenda no primeiro da 2, que é o comportamento esperado numa maratona.
    it('a fila atravessa a virada de temporada', () => {
        const naVirada = fila(1);
        expect(hasNext(naVirada)).toBe(true);
        expect(currentEpisode({ ...naVirada, index: 2 }).season).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Item 94 — gate Kids
// ---------------------------------------------------------------------------
describe('kidsFilter', () => {
    const cat = (id: string, name: string) => ({ category_id: id, category_name: name, parent_id: 0 });

    it.each(['ADULTOS', 'XXX', 'Canais +18', 'Adulto | Premium', 'Erótico', 'Playboy TV', 'PORN HD'])(
        'barra a categoria adulta: %s', (nome) => {
            expect(isAdultCategoryName(nome)).toBe(true);
        });

    // Estes são os falsos positivos que os padrões foram ancorados pra evitar:
    // /sex/ solto casaria "Sexta" e "Essex"; /18/ solto casaria "2018".
    it.each([
        'Sexta-feira', 'Essex TV', 'Filmes 2018', 'Documentários', 'Infantil',
        'Desenhos', 'Clássicos 1980', 'Sertanejo',
    ])('não barra a categoria inocente: %s', (nome) => {
        expect(isAdultCategoryName(nome)).toBe(false);
    });

    it('perfil normal passa reto, sem cópia de lista', () => {
        vi.spyOn(profileService, 'getActiveProfile').mockReturnValue(
            { id: 'p', name: 'Pai', avatar: '👤', isKids: false } as never
        );
        const itens = [{ category_id: '1' }, { category_id: '2' }];
        const cats = [cat('1', 'ADULTOS'), cat('2', 'Infantil')];
        const saida = kidsFilter.apply(itens, cats);
        expect(saida.items).toBe(itens); // MESMA referência: sem custo
        expect(saida.categories).toBe(cats);
    });

    // O que o recurso existe pra fazer: no perfil kids, a categoria adulta
    // some E os itens dela somem junto. Esconder só a categoria deixaria o
    // conteúdo alcançável pela busca e pelas fileiras da Home.
    it('perfil kids perde a categoria adulta E os itens dela', () => {
        vi.spyOn(profileService, 'getActiveProfile').mockReturnValue(
            { id: 'k', name: 'Kids', avatar: '🧒', isKids: true } as never
        );
        const saida = kidsFilter.apply(
            [{ category_id: '1' }, { category_id: '2' }, { category_id: '2' }],
            [cat('1', 'XXX'), cat('2', 'Desenhos')]
        );
        expect(saida.categories.map(c => c.category_name)).toEqual(['Desenhos']);
        expect(saida.items).toHaveLength(2);
        expect(saida.items.every(i => i.category_id === '2')).toBe(true);
    });

    it('getBlockedCategoryIds funciona mesmo fora do perfil kids', () => {
        vi.spyOn(profileService, 'getActiveProfile').mockReturnValue(null);
        const bloqueadas = kidsFilter.getBlockedCategoryIds([cat('9', 'ADULTOS'), cat('8', 'Ação')]);
        expect([...bloqueadas]).toEqual(['9']);
    });

    it('categoria sem nome não quebra o gate', () => {
        vi.spyOn(profileService, 'getActiveProfile').mockReturnValue(null);
        const semNome = { category_id: '7', category_name: undefined as unknown as string, parent_id: 0 };
        expect([...kidsFilter.getBlockedCategoryIds([semNome])]).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Item 95 — dado deixado por versões antigas
// ---------------------------------------------------------------------------
describe('migração de dado legado', () => {
    // O modal antigo gravava só {id, type}: sem título, o card renderizava
    // vazio — um retângulo mudo que o usuário não sabia o que era.
    it('favorito antigo sem título vira "Sem título", não card em branco', () => {
        localStorage.setItem('neostream_favorites', JSON.stringify([
            { id: 550, type: 'movie' },
            { id: '99', type: 'series', title: 'Novo formato', addedAt: 123 },
        ]));
        const favoritos = storage.getFavorites();
        expect(favoritos).toHaveLength(2);
        expect(favoritos[0].title).toBe('Sem título');
        expect(favoritos[0].id).toBe('550');   // número vira texto
        expect(favoritos[0].addedAt).toBe(0);
        expect(favoritos[1].title).toBe('Novo formato');
    });

    it('descarta entradas sem id ou sem tipo em vez de renderizar lixo', () => {
        localStorage.setItem('neostream_favorites', JSON.stringify([
            { type: 'movie' }, { id: '1' }, null, { id: '2', type: 'movie' },
        ]));
        expect(storage.getFavorites().map(f => f.id)).toEqual(['2']);
    });

    it.each(['lixo{', '"texto solto"', '{"nao":"array"}'])(
        'conteúdo corrompido devolve lista vazia: %s', (bruto) => {
            localStorage.setItem('neostream_favorites', bruto);
            expect(storage.getFavorites()).toEqual([]);
        });

    // Antes do multi-playlist havia UMA credencial solta. Sem esta migração,
    // quem atualizasse abriria as Configurações sem playlist nenhuma listada.
    it('a credencial única antiga vira a primeira playlist, já ativa', () => {
        localStorage.setItem('neostream_credentials', JSON.stringify({
            url: 'http://painel.com:8080', username: 'joao', password: 'x',
        }));
        playlistService.migrate();

        const lista = playlistService.list();
        expect(lista).toHaveLength(1);
        expect(lista[0].url).toBe('http://painel.com:8080');
        expect(playlistService.getActiveId()).toBe(lista[0].id);
        expect(lista[0].alias).toBeTruthy();
    });

    it('não duplica se já houver playlist', () => {
        localStorage.setItem('neostream_credentials', JSON.stringify({
            url: 'http://painel.com:8080', username: 'joao', password: 'x',
        }));
        playlistService.migrate();
        playlistService.migrate();
        expect(playlistService.list()).toHaveLength(1);
    });

    it('sem credencial nenhuma, a migração não inventa playlist', () => {
        playlistService.migrate();
        expect(playlistService.list()).toEqual([]);
    });

    // O escopo por perfil chegou depois: as listas são de QUEM assiste.
    it('as listas legadas ficam no perfil que as tinha', () => {
        localStorage.setItem('neostream_favorites', JSON.stringify([{ id: '1', type: 'movie' }]));
        setPerfilAtivo('kids');
        expect(storage.getFavorites()).toEqual([]); // o kids nasce vazio
        setPerfilAtivo('default');
        expect(storage.getFavorites()).toHaveLength(1);
    });
});
