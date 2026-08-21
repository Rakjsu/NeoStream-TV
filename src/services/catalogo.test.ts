// Camada pura de nomes e agrupamento do catálogo.
//
// Estes cinco módulos não tocam DOM, rede nem armazenamento, e é onde os bugs
// de catálogo apareceram de verdade nas rodadas anteriores. Cada bloco abaixo
// tem pelo menos um caso que JÁ QUEBROU em produção — estão marcados.

import { describe, it, expect } from 'vitest';
import { versionBaseName, groupVodVersions } from './vodVariants';
import { looksLikeMatch, isRadioChannel, collectTodaysEvents } from './liveDiscovery';
import { fuzzyMatches, normalizeSearch, isRecentlyAdded } from './catalogExtras';
import { isAdultCategoryName } from './kidsFilter';
import type { LiveStream, VODStream } from '../types';

const filme = (name: string, id = 1): VODStream => ({
    num: id, name, stream_type: 'movie', stream_id: id, stream_icon: '',
    container_extension: 'mp4', custom_sid: '', direct_source: '', added: '0',
    category_id: '1', rating: '0', rating_5based: 0, backdrop_path: [],
    youtube_trailer: '', episode_run_time: '', cover: '', plot: '', cast: '',
    director: '', genre: '', release_date: '', tmdb_id: '',
});

const canal = (name: string, extra: Partial<LiveStream> = {}): LiveStream => ({
    num: 1, name, stream_type: 'live', stream_id: 1, stream_icon: '',
    epg_channel_id: '', added: '0', category_id: '1', custom_sid: '',
    tv_archive: 0, direct_source: '', tv_archive_duration: 0, ...extra,
});

describe('versionBaseName', () => {
    it('agrupa dublado e legendado do mesmo filme', () => {
        expect(versionBaseName('Matrix [DUB]')).toBe(versionBaseName('Matrix [LEG]'));
    });

    it('agrupa as marcas de qualidade', () => {
        expect(versionBaseName('Duna 4K')).toBe(versionBaseName('Duna FHD'));
    });

    // BUG REAL (R3): o ano era removido junto com as marcas, e três filmes
    // diferentes viravam um card só.
    it('NÃO funde refilmagens: o ano faz parte da identidade', () => {
        const a = versionBaseName('Batman (1989)');
        const b = versionBaseName('Batman (2022)');
        const c = versionBaseName('Batman (1966)');
        expect(new Set([a, b, c]).size).toBe(3);
    });

    it('trata nome que vira vazio depois da poda', () => {
        expect(versionBaseName('[DUB]')).not.toBe('');
    });
});

describe('groupVodVersions', () => {
    it('devolve um card por obra e guarda as versões', () => {
        const { groups, versionsOf } = groupVodVersions([
            filme('Matrix [DUB]', 1),
            filme('Matrix [LEG]', 2),
            filme('Duna (2021)', 3),
        ]);
        expect(groups).toHaveLength(2);
        // Só quem TEM irmãos entra no mapa de versões
        const comVersoes = groups.filter(g => versionsOf.has(String(g.stream_id)));
        expect(comVersoes).toHaveLength(1);
        expect(versionsOf.get(String(comVersoes[0].stream_id))).toHaveLength(2);
    });

    it('não perde nenhum título', () => {
        const entrada = [filme('Matrix [DUB]', 1), filme('Matrix [LEG]', 2), filme('Duna', 3)];
        const { groups, versionsOf } = groupVodVersions(entrada);
        const total = groups.reduce(
            (n, g) => n + (versionsOf.get(String(g.stream_id))?.length ?? 1),
            0
        );
        expect(total).toBe(entrada.length);
    });
});

describe('isRadioChannel', () => {
    // BUG REAL (R4): a checagem por substring (" am") casava com nomes de
    // canais de TV e escondia o vídeo atrás da tela de áudio.
    it.each([
        'TV Amazonas',
        'Band Amapá',
        'Canal América',
        'Prime Amazon',
    ])('não confunde canal de TV com rádio: %s', (nome) => {
        expect(isRadioChannel(canal(nome))).toBe(false);
    });

    it.each([
        'Jovem Pan FM',
        'Rádio Globo',
        'CBN AM',
        'Radio Mix',
    ])('detecta rádio de verdade: %s', (nome) => {
        expect(isRadioChannel(canal(nome))).toBe(true);
    });

    it('a categoria manda mais que o nome', () => {
        expect(isRadioChannel(canal('Qualquer Coisa'), 'RÁDIOS')).toBe(true);
    });

    it('canal com EPG nunca é rádio, por mais sugestivo que seja o nome', () => {
        expect(isRadioChannel(canal('FM TV', { epg_channel_id: 'fmtv.br' }))).toBe(false);
    });
});

describe('looksLikeMatch', () => {
    it.each(['Flamengo x Vasco', 'Brasil vs Argentina', 'AO VIVO: Palmeiras'])(
        'reconhece confronto: %s', (titulo) => {
            expect(looksLikeMatch(titulo)).toBe(true);
        });

    it.each(['Jornal Nacional', 'Missa', 'x', ''])(
        'não vê confronto onde não há: %s', (titulo) => {
            expect(looksLikeMatch(titulo)).toBe(false);
        });
});

describe('collectTodaysEvents', () => {
    const meioDia = new Date(2026, 7, 21, 12, 0, 0).getTime();
    const hora = (h: number) => new Date(2026, 7, 21, h, 0, 0).getTime();

    it('pega só os de hoje que ainda não acabaram, em ordem de horário', () => {
        const eventos = collectTodaysEvents([{
            channel: canal('ESPN'),
            programs: [
                { title: 'Fla x Vasco', start: hora(20), end: hora(22), description: '' },
                { title: 'Grêmio x Inter', start: hora(16), end: hora(18), description: '' },
                { title: 'Jogo de ontem x Nada', start: hora(8), end: hora(10), description: '' },
                { title: 'Jornal', start: hora(19), end: hora(20), description: '' },
            ],
        }], meioDia);

        expect(eventos.map(e => e.program.title)).toEqual(['Grêmio x Inter', 'Fla x Vasco']);
    });

    it('ignora o que é de outro dia', () => {
        const amanha = new Date(2026, 7, 22, 20, 0, 0).getTime();
        const eventos = collectTodaysEvents([{
            channel: canal('ESPN'),
            programs: [{ title: 'Fla x Vasco', start: amanha, end: amanha + 3600000, description: '' }],
        }], meioDia);
        expect(eventos).toHaveLength(0);
    });
});

describe('busca do catálogo', () => {
    it('normaliza acento e caixa', () => {
        expect(normalizeSearch('Coração À Noite')).toBe(normalizeSearch('coracao a noite'));
    });

    it('perdoa UM erro de digitação (distância 1)', () => {
        expect(fuzzyMatches('vingadres', 'vingadores')).toBe(true);
        expect(fuzzyMatches('matrx', 'matrix')).toBe(true);
    });

    it('não perdoa dois erros', () => {
        expect(fuzzyMatches('vngadrs', 'vingadores')).toBe(false);
    });
});

describe('isRecentlyAdded', () => {
    const agora = new Date(2026, 7, 21, 12, 0, 0).getTime();
    const diasAtras = (d: number) => String(Math.floor((agora - d * 86400000) / 1000));

    it('conta o que entrou nos últimos dias', () => {
        expect(isRecentlyAdded({ name: 'X', added: diasAtras(2) }, agora)).toBe(true);
    });

    it('não conta o que é antigo', () => {
        expect(isRecentlyAdded({ name: 'X', added: diasAtras(90) }, agora)).toBe(false);
    });

    it('data ausente não é novidade', () => {
        expect(isRecentlyAdded({ name: 'X', added: '' }, agora)).toBe(false);
    });
});

describe('isAdultCategoryName', () => {
    it.each(['ADULTOS', 'XXX', 'Canais +18', 'Adulto | Premium'])(
        'barra categoria adulta: %s', (nome) => {
            expect(isAdultCategoryName(nome)).toBe(true);
        });

    // O gate é ancorado de propósito: sem isso, "Documentários" e "Sextante"
    // seriam classificados como adultos por conterem trechos de palavra.
    it.each(['Documentários', 'Filmes', 'Infantil', 'Sexta-feira'])(
        'não barra categoria inocente: %s', (nome) => {
            expect(isAdultCategoryName(nome)).toBe(false);
        });
});
