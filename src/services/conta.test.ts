// Endereço do provedor, versionamento do armazenamento e progresso.
//
// A normalização de URL é a primeira coisa que roda no login: se ela erra, o
// usuário vê "não foi possível conectar" com credenciais perfeitamente boas —
// e não tem como descobrir o motivo numa TV.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { installFakeStorage, setPerfilAtivo } from '../testing/fakeStorage';
import { normalizarUrlDoServidor, foiRebaixadoParaHttp } from './api';
import { storageSchema, CURRENT_SCHEMA } from './storageSchema';
import { progressService } from './progressService';

beforeEach(() => {
    installFakeStorage();
});

describe('normalizarUrlDoServidor', () => {
    it('põe http quando o usuário não digita esquema nenhum', () => {
        expect(normalizarUrlDoServidor('meupainel.com:8080')).toBe('http://meupainel.com:8080');
    });

    it('respeita o https que o usuário digitou', () => {
        expect(normalizarUrlDoServidor('https://painel.com:443')).toBe('https://painel.com');
    });

    // Copiar a URL do painel pelo D-pad é doloroso; colar a linha inteira do
    // provedor (com /player_api.php e a query) é o que a pessoa realmente faz.
    it.each([
        'http://painel.com:8080/player_api.php',
        'http://painel.com:8080/get.php',
        'http://painel.com:8080/xmltv.php',
        'http://painel.com:8080/PLAYER_API.PHP',
    ])('corta o endpoint colado junto: %s', (entrada) => {
        expect(normalizarUrlDoServidor(entrada)).toBe('http://painel.com:8080');
    });

    // Este é o caso perigoso: a query do get.php CARREGA usuário e senha.
    // Deixá-la na URL base gravaria a senha em toda requisição montada depois.
    it('descarta a query — é lá que vêm usuário e senha', () => {
        expect(normalizarUrlDoServidor('http://painel.com:8080/get.php?username=joao&password=1234'))
            .toBe('http://painel.com:8080');
    });

    it('descarta credencial embutida no host', () => {
        const saida = normalizarUrlDoServidor('http://joao:1234@painel.com:8080');
        expect(saida).toBe('http://painel.com:8080');
        expect(saida).not.toContain('joao');
        expect(saida).not.toContain('1234');
    });

    it('descarta a âncora', () => {
        expect(normalizarUrlDoServidor('http://painel.com:8080/#/live')).toBe('http://painel.com:8080');
    });

    it('tira espaço — o teclado da TV adora um espaço no fim', () => {
        expect(normalizarUrlDoServidor('  http://painel.com:8080  ')).toBe('http://painel.com:8080');
        expect(normalizarUrlDoServidor('http://painel .com:8080')).toBe('http://painel.com:8080');
    });

    it('tira a barra final', () => {
        expect(normalizarUrlDoServidor('http://painel.com:8080/')).toBe('http://painel.com:8080');
    });

    it('entrada vazia é erro, não uma URL inventada', () => {
        expect(() => normalizarUrlDoServidor('')).toThrow();
        expect(() => normalizarUrlDoServidor('   ')).toThrow();
    });
});

describe('foiRebaixadoParaHttp', () => {
    it('avisa quando o pedido era HTTPS e a conexão saiu HTTP', () => {
        expect(foiRebaixadoParaHttp('https://painel.com', 'http://painel.com:8080')).toBe(true);
    });

    it.each([
        ['http://painel.com', 'http://painel.com'],
        ['https://painel.com', 'https://painel.com'],
        ['http://painel.com', 'https://painel.com'],
    ])('não avisa à toa: %s → %s', (pedido, efetivo) => {
        expect(foiRebaixadoParaHttp(pedido, efetivo)).toBe(false);
    });

    it('URL inválida não vira alerta falso', () => {
        expect(foiRebaixadoParaHttp('nada', 'http://painel.com')).toBe(false);
    });
});

describe('storageSchema', () => {
    // A regra que evita rodar migração em quem não precisa: aparelho zerado
    // nasce na versão atual.
    it('instalação nova nasce na versão atual', () => {
        expect(storageSchema.current()).toBe(CURRENT_SCHEMA);
    });

    // E a que evita perder dado: quem já tinha o app antes do versionamento
    // precisa nascer na v1, pra migração futura ainda ter chance de agir.
    it('instalação anterior ao versionamento nasce na v1', () => {
        localStorage.setItem('neostream_favorites', '[1]');
        expect(storageSchema.current()).toBe(1);
    });

    it('migrate grava a versão e é idempotente', () => {
        localStorage.setItem('neostream_favorites', '[1]');
        storageSchema.migrate();
        expect(storageSchema.current()).toBe(CURRENT_SCHEMA);
        storageSchema.migrate();
        expect(storageSchema.current()).toBe(CURRENT_SCHEMA);
    });

    it('versão gravada manda mais que a detecção', () => {
        localStorage.setItem('neostream_schema_version', '1');
        localStorage.setItem('neostream_favorites', '[1]');
        expect(storageSchema.current()).toBe(1);
    });
});

describe('progressService', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 7, 21, 12, 0, 0));
    });
    afterEach(() => vi.useRealTimers());

    const filme = (id: string, time: number, duration = 7200) =>
        progressService.saveMovie({ id, name: `F${id}`, time, duration });

    it('guarda e devolve o ponto de retomada do filme', () => {
        filme('1', 600);
        expect(progressService.getMovieResumeTime('1')).toBe(600);
    });

    // Retomar aos 10 segundos é pior que começar do zero: parece que não salvou.
    it('menos de 30s não vira progresso', () => {
        filme('a', 10);
        expect(progressService.getMovie('a')).toBeNull();
        expect(progressService.getMovieResumeTime('a')).toBeNull();
    });

    // BUG REAL (R5): exigir 95% cravado prendia filme longo em "Continuar
    // assistindo" pra sempre — os créditos de um filme de 2h levam quase 10min.
    it('chegar aos créditos conta como assistido', () => {
        filme('c', 7100); // faltam 100s de 7200
        expect(progressService.getCompletedMovieIds().has('c')).toBe(true);
        expect(progressService.getMovieResumeTime('c')).toBeNull();
    });

    // E o outro lado do mesmo bug: um episódio infantil de 5 min não pode ser
    // dado como visto faltando um terço do vídeo.
    it('episódio curto não vira "visto" cedo demais', () => {
        filme('kids', 240, 300); // 4:00 de 5:00 — faltam 60s
        expect(progressService.getCompletedMovieIds().has('kids')).toBe(false);
        expect(progressService.getMovieResumeTime('kids')).toBe(240);
    });

    it('remover apaga de verdade', () => {
        filme('d', 600);
        progressService.removeMovie('d');
        expect(progressService.getMovie('d')).toBeNull();
    });

    // Numa quota de ~5 MB, um mapa que só cresce acaba derrubando outra coisa.
    it('mantém no máximo 50 filmes, os mais recentes', () => {
        for (let i = 0; i < 55; i++) {
            vi.setSystemTime(new Date(2026, 7, 21, 12, i, 0));
            filme(`f${i}`, 600);
        }
        expect(progressService.getMovieIdsWithProgress().size).toBe(50);
        expect(progressService.getMovie('f0')).toBeNull();   // o mais velho saiu
        expect(progressService.getMovie('f54')).not.toBeNull();
    });

    const serie = (season: number, episode: number, time: number) =>
        progressService.saveSeries({
            seriesId: 's1', seriesName: 'Série', season, episode,
            episodeId: `s${season}e${episode}`, time, duration: 2700,
        });

    it('série guarda temporada e episódio', () => {
        serie(2, 5, 900);
        const salvo = progressService.getSeries('s1');
        expect(salvo?.season).toBe(2);
        expect(salvo?.episode).toBe(5);
        expect(progressService.getSeriesResumeTime('s1', 2, 5)).toBe(900);
    });

    // O ponto salvo é DAQUELE episódio: devolvê-lo pra outro faria o episódio
    // 6 abrir 15 minutos adiante sem motivo.
    it('não devolve o ponto de um episódio para outro', () => {
        serie(2, 5, 900);
        expect(progressService.getSeriesResumeTime('s1', 2, 6)).toBeNull();
        expect(progressService.getSeriesResumeTime('s1', 3, 5)).toBeNull();
    });

    it('avançar de episódio substitui o ponto da série', () => {
        serie(1, 1, 900);
        serie(1, 2, 300);
        expect(progressService.getSeriesResumeTime('s1', 1, 1)).toBeNull();
        expect(progressService.getSeriesResumeTime('s1', 1, 2)).toBe(300);
    });

    it('série terminada é marcada como tal só no ÚLTIMO episódio', () => {
        progressService.saveSeries({
            seriesId: 's2', seriesName: 'Fim', season: 1, episode: 10,
            episodeId: 's1e10', time: 2650, duration: 2700, isLastEpisode: true,
        });
        expect(progressService.getFinishedSeriesIds().has('s2')).toBe(true);

        progressService.saveSeries({
            seriesId: 's3', seriesName: 'Meio', season: 1, episode: 3,
            episodeId: 's1e3', time: 2650, duration: 2700,
        });
        expect(progressService.getFinishedSeriesIds().has('s3')).toBe(false);
    });

    // O escopo por perfil vale também aqui: o progresso do pai não pode
    // aparecer no perfil das crianças.
    it('o progresso é de quem assiste, não do aparelho', () => {
        setPerfilAtivo('pai');
        filme('99', 600);
        setPerfilAtivo('kids');
        expect(progressService.getMovie('99')).toBeNull();
        setPerfilAtivo('pai');
        expect(progressService.getMovie('99')).not.toBeNull();
    });
});
