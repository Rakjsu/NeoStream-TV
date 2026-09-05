// @vitest-environment jsdom
//
// O epgService é onde três coisas que erram calado se encontram: o timestamp
// do provedor (numérico ou string SEM fuso), o offset que o usuário ajusta na
// mão, e o base64 dos títulos. Nenhuma delas lança quando dá errado — a
// agenda só aparece deslocada em horas, ou com o título ilegível. Daí os
// testes serem por aqui e não pela tela.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getShortEpg = vi.fn();
const getSimpleDataTable = vi.fn();
const getProviderOffsetMs = vi.fn(() => 0);

vi.mock('./api', () => ({
    api: {
        getShortEpg: (...args: unknown[]) => getShortEpg(...args),
        getSimpleDataTable: (...args: unknown[]) => getSimpleDataTable(...args),
        getProviderOffsetMs: () => getProviderOffsetMs(),
    },
}));

vi.mock('./playlistService', () => ({
    playlistService: { getActiveId: () => 'lista-1' },
}));

import { epgService, epgOffset } from './epgService';

const b64 = (texto: string) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(texto)));

/** epoch de um instante UTC, em segundos (como o Xtream manda). */
const seg = (iso: string) => Math.floor(Date.parse(iso) / 1000);

let proximoCanal = 1;
/** Cada teste usa um streamId novo: o cache do módulo é global. */
const canal = () => proximoCanal++;

beforeEach(() => {
    getShortEpg.mockReset();
    getSimpleDataTable.mockReset();
    getProviderOffsetMs.mockReset();
    getProviderOffsetMs.mockReturnValue(0);
    localStorage.clear();
    epgService.clearCache();
});

afterEach(() => { vi.useRealTimers(); });

describe('timestamps', () => {
    it('start_timestamp numérico vem em segundos e vira ms', async () => {
        getShortEpg.mockResolvedValue({
            epg_listings: [{
                title: b64('Jornal'),
                start_timestamp: seg('2026-09-04T12:00:00Z'),
                stop_timestamp: seg('2026-09-04T13:00:00Z'),
            }],
        });
        const { programs } = await epgService.getChannelEpg(canal());
        expect(programs[0].start).toBe(Date.parse('2026-09-04T12:00:00Z'));
        expect(programs[0].end).toBe(Date.parse('2026-09-04T13:00:00Z'));
    });

    it('numérico em string também conta (o Xtream manda os dois jeitos)', async () => {
        getShortEpg.mockResolvedValue({
            epg_listings: [{
                title: b64('Jornal'),
                start_timestamp: String(seg('2026-09-04T12:00:00Z')),
                stop_timestamp: String(seg('2026-09-04T13:00:00Z')),
            }],
        });
        const { programs } = await epgService.getChannelEpg(canal());
        expect(programs[0].start).toBe(Date.parse('2026-09-04T12:00:00Z'));
    });

    // O caso que desloca a agenda inteira: painel na Europa, usuário no
    // Brasil. Sem sufixo de fuso, o Date.parse leria no fuso da TV.
    it('string sem fuso é lida como UTC e corrigida pelo offset do provedor', async () => {
        getProviderOffsetMs.mockReturnValue(3 * 3600 * 1000); // provedor 3h à frente
        getShortEpg.mockResolvedValue({
            epg_listings: [{
                title: b64('Jornal'),
                start: '2026-09-04 12:00:00',
                end: '2026-09-04 13:00:00',
            }],
        });
        const { programs } = await epgService.getChannelEpg(canal());
        expect(programs[0].start).toBe(Date.parse('2026-09-04T12:00:00Z') - 3 * 3600 * 1000);
        expect(programs[0].end).toBe(Date.parse('2026-09-04T13:00:00Z') - 3 * 3600 * 1000);
    });

    it('offset negativo do provedor empurra pra frente', async () => {
        getProviderOffsetMs.mockReturnValue(-2 * 3600 * 1000);
        getShortEpg.mockResolvedValue({
            epg_listings: [{
                title: b64('Jornal'),
                start: '2026-09-04 12:00:00',
                stop: '2026-09-04 13:00:00',
            }],
        });
        const { programs } = await epgService.getChannelEpg(canal());
        expect(programs[0].start).toBe(Date.parse('2026-09-04T12:00:00Z') + 2 * 3600 * 1000);
    });

    it('o ajuste manual do usuário soma por cima', async () => {
        epgOffset.set(2);
        getShortEpg.mockResolvedValue({
            epg_listings: [{
                title: b64('Jornal'),
                start_timestamp: seg('2026-09-04T12:00:00Z'),
                stop_timestamp: seg('2026-09-04T13:00:00Z'),
            }],
        });
        const { programs } = await epgService.getChannelEpg(canal());
        expect(programs[0].start).toBe(Date.parse('2026-09-04T14:00:00Z'));
    });

    it('o ajuste manual fica preso entre -12 e +12', () => {
        epgOffset.set(99);
        expect(epgOffset.get()).toBe(12);
        epgOffset.set(-99);
        expect(epgOffset.get()).toBe(-12);
    });
});

describe('títulos em base64', () => {
    it('decodifica UTF-8 com acento', async () => {
        getShortEpg.mockResolvedValue({
            epg_listings: [{
                title: b64('Sessão da Tarde'),
                description: b64('Ação e emoção'),
                start_timestamp: seg('2026-09-04T12:00:00Z'),
                stop_timestamp: seg('2026-09-04T13:00:00Z'),
            }],
        });
        const { programs } = await epgService.getChannelEpg(canal());
        expect(programs[0].title).toBe('Sessão da Tarde');
        expect(programs[0].description).toBe('Ação e emoção');
    });

    // Nem todo provedor manda base64. Título cru tem que passar como está, e
    // não sumir da grade.
    it('texto que não é base64 passa cru em vez de virar lixo', async () => {
        getShortEpg.mockResolvedValue({
            epg_listings: [{
                title: 'Jornal Nacional!!',
                start_timestamp: seg('2026-09-04T12:00:00Z'),
                stop_timestamp: seg('2026-09-04T13:00:00Z'),
            }],
        });
        const { programs } = await epgService.getChannelEpg(canal());
        expect(programs[0].title).toBe('Jornal Nacional!!');
    });
});

describe('limpeza e ordem', () => {
    it('descarta sem título, sem horário e com fim antes do início; ordena por início', async () => {
        getShortEpg.mockResolvedValue({
            epg_listings: [
                { title: b64('Depois'), start_timestamp: seg('2026-09-04T14:00:00Z'), stop_timestamp: seg('2026-09-04T15:00:00Z') },
                { title: '', start_timestamp: seg('2026-09-04T10:00:00Z'), stop_timestamp: seg('2026-09-04T11:00:00Z') },
                { title: b64('Invertido'), start_timestamp: seg('2026-09-04T18:00:00Z'), stop_timestamp: seg('2026-09-04T17:00:00Z') },
                { title: b64('Sem horário') },
                { title: b64('Antes'), start_timestamp: seg('2026-09-04T12:00:00Z'), stop_timestamp: seg('2026-09-04T13:00:00Z') },
            ],
        });
        const { programs } = await epgService.getChannelEpg(canal());
        expect(programs.map(p => p.title)).toEqual(['Antes', 'Depois']);
    });

    // Forks do XUI omitem o campo. "Ausente" não é "não tem arquivo": quem
    // consome trata undefined como reproduzível se o CANAL tiver catch-up.
    it('has_archive ausente fica undefined, não false', async () => {
        getShortEpg.mockResolvedValue({
            epg_listings: [
                { title: b64('Sem campo'), start_timestamp: seg('2026-09-04T12:00:00Z'), stop_timestamp: seg('2026-09-04T13:00:00Z') },
                { title: b64('Com campo'), start_timestamp: seg('2026-09-04T13:00:00Z'), stop_timestamp: seg('2026-09-04T14:00:00Z'), has_archive: '1' },
                { title: b64('Zerado'), start_timestamp: seg('2026-09-04T14:00:00Z'), stop_timestamp: seg('2026-09-04T15:00:00Z'), has_archive: 0 },
            ],
        });
        const { programs } = await epgService.getChannelEpg(canal());
        expect(programs[0].hasArchive).toBeUndefined();
        expect(programs[1].hasArchive).toBe(true);
        expect(programs[2].hasArchive).toBe(false);
    });
});

describe('agora / a seguir', () => {
    it('classifica pelo relógio e reclassifica sem refazer a busca', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(Date.parse('2026-09-04T12:58:00Z'));
        getShortEpg.mockResolvedValue({
            epg_listings: [
                { title: b64('Agora'), start_timestamp: seg('2026-09-04T12:00:00Z'), stop_timestamp: seg('2026-09-04T13:00:00Z') },
                { title: b64('Depois'), start_timestamp: seg('2026-09-04T13:00:00Z'), stop_timestamp: seg('2026-09-04T14:00:00Z') },
            ],
        });
        const id = canal();
        const primeiro = await epgService.getChannelEpg(id);
        expect(primeiro.now?.title).toBe('Agora');
        expect(primeiro.next?.title).toBe('Depois');

        // Três minutos depois: dentro do TTL de 5 min, então o cache serve —
        // mas atravessando a virada das 13h, o "agora" tem que ser outro.
        vi.setSystemTime(Date.parse('2026-09-04T13:01:00Z'));
        const segundo = await epgService.getChannelEpg(id);
        expect(segundo.now?.title).toBe('Depois');
        expect(getShortEpg).toHaveBeenCalledTimes(1);
    });

    it('progressPct é o percentual decorrido, preso entre 0 e 100', () => {
        vi.useFakeTimers();
        vi.setSystemTime(Date.parse('2026-09-04T12:30:00Z'));
        const meio = {
            title: 'x',
            description: '',
            start: Date.parse('2026-09-04T12:00:00Z'),
            end: Date.parse('2026-09-04T13:00:00Z'),
        };
        expect(epgService.progressPct(meio)).toBe(50);
        expect(epgService.progressPct(null)).toBeNull();
        // Programa de duração zero não vira divisão por zero.
        expect(epgService.progressPct({ ...meio, end: meio.start })).toBeNull();
    });
});

describe('cache e falhas', () => {
    it('pedir mais programas que o cache tem refaz a busca', async () => {
        getShortEpg.mockResolvedValue({ epg_listings: [] });
        const id = canal();
        await epgService.getChannelEpg(id, 6);
        await epgService.getChannelEpg(id, 6);
        expect(getShortEpg).toHaveBeenCalledTimes(1);
        await epgService.getChannelEpg(id, 40);
        expect(getShortEpg).toHaveBeenCalledTimes(2);
    });

    it('duas chamadas no mesmo ciclo viram uma requisição só', async () => {
        getShortEpg.mockResolvedValue({ epg_listings: [] });
        const id = canal();
        await Promise.all([epgService.getChannelEpg(id), epgService.getChannelEpg(id)]);
        expect(getShortEpg).toHaveBeenCalledTimes(1);
    });

    it('erro do provedor devolve vazio em vez de derrubar a tela', async () => {
        getShortEpg.mockRejectedValue(new Error('502'));
        const epg = await epgService.getChannelEpg(canal());
        expect(epg).toEqual({ now: null, next: null, programs: [] });
    });

    it('resposta sem epg_listings devolve vazio', async () => {
        getShortEpg.mockResolvedValue({});
        const { programs } = await epgService.getChannelEpg(canal());
        expect(programs).toEqual([]);
    });

    it('a agenda do dia usa o outro endpoint e o próprio cache', async () => {
        getSimpleDataTable.mockResolvedValue({
            epg_listings: [{
                title: b64('Dia'),
                start_timestamp: seg('2026-09-04T12:00:00Z'),
                stop_timestamp: seg('2026-09-04T13:00:00Z'),
            }],
        });
        const id = canal();
        expect((await epgService.getDayEpg(id))[0].title).toBe('Dia');
        await epgService.getDayEpg(id);
        expect(getSimpleDataTable).toHaveBeenCalledTimes(1);
    });

    it('mudar o ajuste de fuso invalida o cache', async () => {
        getShortEpg.mockResolvedValue({ epg_listings: [] });
        const id = canal();
        await epgService.getChannelEpg(id);
        epgOffset.set(3);
        await epgService.getChannelEpg(id);
        expect(getShortEpg).toHaveBeenCalledTimes(2);
    });
});
