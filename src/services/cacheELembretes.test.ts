// Catálogo guardado, lembretes e backup por QR.
//
// Os três compartilham a mesma armadilha: falham em SILÊNCIO. Um cache pela
// metade, um lembrete que não dispara e um QR grande demais não dão erro
// nenhum — só entregam menos do que deviam, e ninguém percebe até acontecer na
// sala de alguém.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFakeStorage } from '../testing/fakeStorage';
import {
    readCatalog, writeCatalog, dropCatalog, clearCatalogCache, trimLive, trimCategory,
} from './catalogCache';
import { reminderService } from './reminderService';
import { buildBackup, backupSize, restoreBackup, MAX_PAYLOAD_BYTES, BACKUP_FORMAT } from './backupService';

beforeEach(() => {
    installFakeStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 21, 12, 0, 0));
    reminderService.reset();
});

afterEach(() => {
    reminderService.reset();
    vi.useRealTimers();
});

const canal = (id: number) => ({
    num: id, name: `Canal ${id}`, stream_id: id, stream_icon: '', epg_channel_id: '',
    category_id: '1', tv_archive: 0, added: '0',
});

describe('catalogCache', () => {
    it('guarda e devolve o que foi guardado', () => {
        expect(writeCatalog('live', [canal(1), canal(2)], trimLive)).toBe(true);
        expect(readCatalog('live')).toHaveLength(2);
    });

    it('lista vazia não vira cache (senão "sem canais" fica gravado)', () => {
        expect(writeCatalog('live', [], trimLive)).toBe(false);
        expect(readCatalog('live')).toBeNull();
    });

    it('cada tipo tem a sua entrada', () => {
        writeCatalog('live', [canal(1)], trimLive);
        writeCatalog('vod-cats', [{ category_id: '9', category_name: 'Ação' }], trimCategory);
        expect(readCatalog('live')).toHaveLength(1);
        expect(readCatalog('vod-cats')).toHaveLength(1);
        expect(readCatalog('series')).toBeNull();
    });

    // BUG REAL (R7): meia lista de canais é PIOR que lista nenhuma — o usuário
    // procura um canal que existe, não acha, e conclui que sumiu do plano.
    it('inteira ou nada: catálogo grande demais não é gravado pela metade', () => {
        const enorme = Array.from({ length: 40_000 }, (_, i) => canal(i));
        expect(writeCatalog('live', enorme, trimLive)).toBe(false);
        expect(readCatalog('live')).toBeNull();
    });

    it('e derrubar o teto não deixa restos da versão anterior', () => {
        writeCatalog('live', [canal(1)], trimLive);
        vi.advanceTimersByTime(60 * 60 * 1000); // passa da janela de regravação
        const enorme = Array.from({ length: 40_000 }, (_, i) => canal(i));
        expect(writeCatalog('live', enorme, trimLive)).toBe(false);
        expect(readCatalog('live')).toBeNull(); // a entrada velha some junto
    });

    // Regravar a cada montagem custa caro numa TV — e sob quota a gravação
    // derruba TODO o cache do TMDB pra caber.
    it('não regrava enquanto o que está guardado é recente', () => {
        writeCatalog('live', [canal(1)], trimLive);
        expect(writeCatalog('live', [canal(1), canal(2), canal(3)], trimLive)).toBe(true);
        expect(readCatalog('live')).toHaveLength(1); // continua o antigo
    });

    it('cache vencido é descartado na leitura', () => {
        writeCatalog('live', [canal(1)], trimLive);
        vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000); // uma semana e pouco
        expect(readCatalog('live')).toBeNull();
    });

    it('entrada corrompida devolve null em vez de explodir', () => {
        writeCatalog('live', [canal(1)], trimLive);
        const chave = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
            .find(k => k?.includes('catalog_cache')) as string;
        localStorage.setItem(chave, '{"at":');
        expect(readCatalog('live')).toBeNull();
    });

    it('dropCatalog e clearCatalogCache limpam de verdade', () => {
        writeCatalog('live', [canal(1)], trimLive);
        writeCatalog('series', [canal(2)], trimLive);
        dropCatalog('live');
        expect(readCatalog('live')).toBeNull();
        expect(readCatalog('series')).not.toBeNull();

        clearCatalogCache();
        expect(readCatalog('series')).toBeNull();
    });

    it('a poda mantém o que a grade usa e joga fora o resto', () => {
        const cheio = { ...canal(7), plot: 'x'.repeat(5000), cast: 'y'.repeat(5000) };
        writeCatalog('live', [cheio], trimLive);
        const guardado = readCatalog<Record<string, unknown>>('live')?.[0];
        expect(guardado?.stream_id).toBe(7);
        expect(guardado?.name).toBe('Canal 7');
        expect(guardado?.plot).toBeUndefined();
    });
});

describe('reminderService', () => {
    const daquiA = (min: number) => Date.now() + min * 60_000;
    const lembrete = (streamId: number, startMs: number) => ({
        streamId, channelName: 'ESPN', programTitle: 'Jogo', startMs,
    });

    it('liga e desliga', () => {
        expect(reminderService.toggle(lembrete(1, daquiA(60)))).toBe(true);
        expect(reminderService.has(1, daquiA(60))).toBe(true);

        expect(reminderService.toggle(lembrete(1, daquiA(60)))).toBe(false);
        expect(reminderService.has(1, daquiA(60))).toBe(false);
    });

    it('o mesmo canal em horários diferentes são lembretes diferentes', () => {
        reminderService.toggle(lembrete(1, daquiA(60)));
        expect(reminderService.has(1, daquiA(120))).toBe(false);
        expect(reminderService.list()).toHaveLength(1);
    });

    // O ponto do recurso: avisar ANTES de começar (1 min), não quando já
    // começou — com o programa no ar o aviso não serve pra nada.
    it('dispara 1 min antes, não na hora exata', () => {
        const ouvinte = vi.fn();
        const cancelar = reminderService.subscribe(ouvinte);
        reminderService.toggle(lembrete(1, daquiA(10)));

        vi.advanceTimersByTime(8 * 60_000 + 59_000); // faltando 1min01
        expect(ouvinte).not.toHaveBeenCalled();

        vi.advanceTimersByTime(2_000); // cruzou a marca de 1 min
        expect(ouvinte).toHaveBeenCalledTimes(1);
        expect(ouvinte.mock.calls[0][0].programTitle).toBe('Jogo');
        cancelar();
    });

    it('não dispara antes da hora', () => {
        const ouvinte = vi.fn();
        const cancelar = reminderService.subscribe(ouvinte);
        reminderService.toggle(lembrete(1, daquiA(60)));
        vi.advanceTimersByTime(30 * 60_000);
        expect(ouvinte).not.toHaveBeenCalled();
        cancelar();
    });

    it('desligar antes da hora cancela o disparo', () => {
        const ouvinte = vi.fn();
        const cancelar = reminderService.subscribe(ouvinte);
        reminderService.toggle(lembrete(1, daquiA(10)));
        reminderService.toggle(lembrete(1, daquiA(10)));
        vi.advanceTimersByTime(20 * 60_000);
        expect(ouvinte).not.toHaveBeenCalled();
        cancelar();
    });

    // setTimeout com delay acima de ~24,8 dias estoura o int32 e dispara NA
    // HORA: sem a guarda, marcar um jogo da semana que vem avisava na mesma
    // hora e o lembrete se perdia.
    it('lembrete muito distante não vira alarme imediato', () => {
        const ouvinte = vi.fn();
        const cancelar = reminderService.subscribe(ouvinte);
        const daquiA40Dias = Date.now() + 40 * 86_400_000;
        reminderService.toggle(lembrete(1, daquiA40Dias));

        vi.advanceTimersByTime(60_000);
        expect(ouvinte).not.toHaveBeenCalled();
        // Segue guardado: só não tem timer ainda — o init() do próximo boot,
        // já dentro da janela de 24 dias, é quem vai agendá-lo
        expect(reminderService.has(1, daquiA40Dias)).toBe(true);
        cancelar();
    });

    it('um ouvinte que quebra não derruba os outros', () => {
        const bom = vi.fn();
        const cancelarRuim = reminderService.subscribe(() => { throw new Error('quebrei'); });
        const cancelarBom = reminderService.subscribe(bom);
        reminderService.toggle(lembrete(1, daquiA(10)));
        vi.advanceTimersByTime(9 * 60_000);
        expect(bom).toHaveBeenCalled();
        cancelarRuim();
        cancelarBom();
    });

    it('cancelar a inscrição para de receber', () => {
        const ouvinte = vi.fn();
        const cancelar = reminderService.subscribe(ouvinte);
        cancelar();
        reminderService.toggle(lembrete(1, daquiA(10)));
        vi.advanceTimersByTime(8 * 60_000);
        expect(ouvinte).not.toHaveBeenCalled();
    });

    it('lista corrompida não derruba a leitura', () => {
        localStorage.setItem('neostream_reminders', 'lixo{');
        expect(reminderService.list()).toEqual([]);
    });
});

describe('backupService', () => {
    it('leva as preferências', () => {
        localStorage.setItem('neostream_theme_accent', 'roxo');
        localStorage.setItem('neostream_subtitle_size', '120');
        const payload = JSON.parse(buildBackup());
        expect(payload.f).toBe(BACKUP_FORMAT);
        expect(payload.d.theme_accent).toBe('roxo');
        expect(payload.d.subtitle_size).toBe('120');
    });

    // A regra de segurança do recurso: um QR na tela da sala é lido por
    // qualquer câmera do cômodo, e um print numa rede social entrega a conta.
    it('NUNCA leva credencial, endereço do provedor nem chave do TMDB', () => {
        localStorage.setItem('neostream_credentials', '{"username":"joao","password":"1234"}');
        localStorage.setItem('neostream_tmdb_api_key', 'chave-secreta');
        localStorage.setItem('neostream_account_info', '{"serverUrl":"http://painel.com"}');

        const json = buildBackup();
        expect(json).not.toContain('joao');
        expect(json).not.toContain('1234');
        expect(json).not.toContain('chave-secreta');
        expect(json).not.toContain('painel.com');
    });

    // BUG REAL: `series_lastmod` cresce uma entrada por série vista. É
    // "preferência" pra efeito de reset, mas inchava o QR até não caber.
    it('deixa de fora a chave que cresce com o uso', () => {
        const gordo = JSON.stringify(
            Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`s${i}`, 1_700_000_000]))
        );
        localStorage.setItem('neostream_series_lastmod', gordo);
        localStorage.setItem('neostream_theme_accent', 'roxo');

        const { json, fits } = backupSize();
        expect(json).not.toContain('series_lastmod');
        expect(fits).toBe(true);
    });

    it('mede em BYTES UTF-8, não em caracteres (acento ocupa 2)', () => {
        localStorage.setItem('neostream_theme_accent', 'ção');
        const { json, bytes } = backupSize();
        expect(bytes).toBeGreaterThan(json.length);
    });

    it('avisa quando não cabe no QR em vez de gerar um ilegível', () => {
        localStorage.setItem('neostream_theme_accent', 'x'.repeat(MAX_PAYLOAD_BYTES));
        expect(backupSize().fits).toBe(false);
    });

    it('restaura o que gerou (ida e volta)', () => {
        localStorage.setItem('neostream_theme_accent', 'roxo');
        localStorage.setItem('neostream_a11y_text_scale', '125');
        const json = buildBackup();

        installFakeStorage(); // outra TV, zerada
        const r = restoreBackup(json);
        expect(r.ok).toBe(true);
        expect(r.applied).toBe(2);
        expect(localStorage.getItem('neostream_theme_accent')).toBe('roxo');
        expect(localStorage.getItem('neostream_a11y_text_scale')).toBe('125');
    });

    it.each(['', 'lixo{', '{"f":"outro-formato","d":{}}', '{"f":"neostream-tv-prefs-1"}'])(
        'recusa entrada inválida sem quebrar: %s', (entrada) => {
            const r = restoreBackup(entrada);
            expect(r.ok).toBe(false);
            expect(r.error).toBeTruthy();
        });

    it('valor que não é texto é ignorado, não gravado como "[object Object]"', () => {
        const r = restoreBackup(JSON.stringify({
            f: BACKUP_FORMAT, t: 1, d: { theme_accent: { nao: 'é texto' }, subtitle_size: '120' },
        }));
        expect(r.applied).toBe(1);
        expect(localStorage.getItem('neostream_theme_accent')).toBeNull();
    });
});
