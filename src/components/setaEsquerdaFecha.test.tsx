// @vitest-environment jsdom
//
// ← Fechar: a dica que a tela ensina tem de ser a tecla que o código ouve.
//
// A agenda do canal, a busca global, os três painéis da TV ao vivo (⭐ Agora
// nos favoritos, ⚽ Jogos de hoje, ⏰ Meus lembretes) e o menu 🟡 de Filmes e
// Séries imprimem "← Fechar" no rodapé — e o onNavigate deles só tratava ↑↓.
// A pessoa apertava ← várias vezes, nada acontecia, e o app parecia travado.
// A lista de canais do player (zap) já fechava com ←: é a convenção do app.
//
// Os testes montam os componentes DE VERDADE e disparam a tecla como a TV
// dispara (`key` inútil, `keyCode` verdadeiro).
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, cleanup, act, waitFor, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ChannelAgendaOverlay } from './ChannelAgendaOverlay';
import { FavoritesNowPanel, SportsPanel } from './LivePanels';
import { RemindersPanel } from './RemindersPanel';
import { GlobalSearch } from './GlobalSearch';
import { Movies } from '../pages/Movies';
import { Series } from '../pages/Series';
import { FocusContext, type FocusZone } from '../contexts/FocusContext';
import { epgService, type EpgProgram } from '../services/epgService';
import { reminderService } from '../services/reminderService';
import { clearSearchCatalogCache } from '../services/searchCatalog';
import { api } from '../services/api';
import type { LiveStream, VODStream, Series as SeriesType, Category } from '../types';

/**
 * Os dados chegam num microtask FORA do act: o efeito que re-registra o
 * ouvinte do useTVNavigation com a lista nova pode não ter rodado ainda.
 * Esvazia os efeitos antes de apertar a tecla.
 */
const esvaziarEfeitos = () => act(async () => { await Promise.resolve(); });

beforeAll(() => {
    // jsdom não implementa scrollIntoView; as listas chamam a cada foco
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
});

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
});

const canais = (quantos: number): LiveStream[] =>
    Array.from({ length: quantos }, (_, i) => ({
        num: i + 1,
        name: `Canal ${i + 1}`,
        stream_type: 'live',
        stream_id: 1000 + i,
        stream_icon: '',
        epg_channel_id: '',
        added: '',
        category_id: '1',
        custom_sid: '',
        tv_archive: 0,
        direct_source: '',
        tv_archive_duration: 0,
    }));

/** Promessa que nunca resolve: o EPG "carregando" não mexe em state no meio do teste. */
const nunca = <T,>() => new Promise<T>(() => { /* pendente de propósito */ });

/** Tecla como a TV manda (Samsung: `key` chega 'Unidentified'). */
function tecla(keyCode: number, alvo: EventTarget = window): KeyboardEvent {
    const evento = new KeyboardEvent('keydown', { key: 'Unidentified', keyCode, bubbles: true, cancelable: true });
    act(() => { alvo.dispatchEvent(evento); });
    return evento;
}
const esquerda = (alvo?: EventTarget) => tecla(37, alvo);
/** → NÃO fecha: a dica só promete ←, e fechar com as duas setas seria surpresa. */
const direita = () => tecla(39);
const amarelo = () => tecla(405);

const texto = (raiz: HTMLElement | Document, seletor: string) =>
    raiz.querySelector(seletor)?.textContent ?? null;

describe('agenda do canal (ChannelAgendaOverlay)', () => {
    it('← fecha a agenda, como a dica "← Fechar" promete', async () => {
        const agora = Date.now();
        const programas: EpgProgram[] = Array.from({ length: 5 }, (_, i) => ({
            title: `Programa ${i + 1}`,
            description: '',
            start: agora - 10 * 60 * 1000 + i * 30 * 60 * 1000,
            end: agora + 20 * 60 * 1000 + i * 30 * 60 * 1000,
        }));
        vi.spyOn(epgService, 'getDayEpg').mockResolvedValue(programas);
        const onClose = vi.fn();
        const { container } = render(
            <ChannelAgendaOverlay channel={canais(1)[0]} onClose={onClose} onPlayArchive={vi.fn()} />
        );
        await waitFor(() => expect(texto(container, '.agenda-item.tv-focused .agenda-name')).toBe('Programa 1'));
        await esvaziarEfeitos();
        expect(container.textContent).toContain('← Fechar');

        direita();
        expect(onClose).not.toHaveBeenCalled();

        // ← fecha de qualquer ponto da lista, não só do primeiro item
        tecla(40);
        expect(texto(container, '.agenda-item.tv-focused .agenda-name')).toBe('Programa 2');

        const evento = esquerda();
        expect(onClose).toHaveBeenCalledTimes(1);
        // Consumida: não escorrega pra página por baixo
        expect(evento.defaultPrevented).toBe(true);
    });

    it('← fecha também enquanto a agenda ainda carrega (lista vazia não prende a pessoa)', () => {
        vi.spyOn(epgService, 'getDayEpg').mockImplementation(() => nunca<EpgProgram[]>());
        const onClose = vi.fn();
        render(<ChannelAgendaOverlay channel={canais(1)[0]} onClose={onClose} onPlayArchive={vi.fn()} />);
        direita();
        expect(onClose).not.toHaveBeenCalled();
        esquerda();
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('painéis da TV ao vivo', () => {
    it('⭐ Agora nos favoritos: ← fecha', () => {
        vi.spyOn(epgService, 'getChannelEpg').mockImplementation(() => nunca());
        const onClose = vi.fn();
        const { container } = render(
            <FavoritesNowPanel channels={canais(5)} onClose={onClose} onPlay={vi.fn()} />
        );
        expect(container.textContent).toContain('← Fechar');
        direita();
        expect(onClose).not.toHaveBeenCalled();
        // ← fecha de qualquer ponto da lista, não só do primeiro canal
        tecla(40);
        expect(texto(container, '.fav-now-row.tv-focused .fav-now-name')).toBe('Canal 2');
        esquerda();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('⭐ sem favorito nenhum: ← fecha do mesmo jeito', () => {
        const onClose = vi.fn();
        render(<FavoritesNowPanel channels={[]} onClose={onClose} onPlay={vi.fn()} />);
        direita();
        expect(onClose).not.toHaveBeenCalled();
        esquerda();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('⭐ no modo reordenar, ← MOVE o canal e não fecha — e a dica deixa de prometer "← Fechar"', () => {
        vi.spyOn(epgService, 'getChannelEpg').mockImplementation(() => nunca());
        const onClose = vi.fn();
        const onMove = vi.fn();
        const { container } = render(
            <FavoritesNowPanel channels={canais(5)} onClose={onClose} onPlay={vi.fn()} onMove={onMove} />
        );
        const focado = () => texto(container, '.fav-now-row.tv-focused .fav-now-name');
        tecla(40); // ↓ para o Canal 2
        expect(focado()).toBe('Canal 2');

        amarelo(); // liga o reordenar
        expect(container.textContent).not.toContain('← Fechar');
        expect(container.textContent).toContain('Voltar Fechar');

        esquerda();
        expect(onMove).toHaveBeenCalledTimes(1);
        expect(onMove.mock.calls[0][0].name).toBe('Canal 2');
        expect(onMove.mock.calls[0][1]).toBe(-1);
        expect(onClose).not.toHaveBeenCalled();

        amarelo(); // sai do reordenar: ← volta a fechar (e → volta a não fazer nada)
        expect(container.textContent).toContain('← Fechar');
        direita();
        expect(onClose).not.toHaveBeenCalled();
        esquerda();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onMove).toHaveBeenCalledTimes(1);
    });

    it('⚽ Jogos de hoje: ← fecha, até enquanto procura os eventos', () => {
        vi.spyOn(epgService, 'getChannelEpg').mockImplementation(() => nunca());
        const onClose = vi.fn();
        const { container } = render(
            <SportsPanel
                channels={canais(3)}
                onClose={onClose}
                onPlay={vi.fn()}
                onRemind={vi.fn()}
                isReminded={() => false}
            />
        );
        expect(container.textContent).toContain('← Fechar');
        direita();
        expect(onClose).not.toHaveBeenCalled();
        esquerda();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('⏰ Meus lembretes: ← fecha, com a lista vazia ou não', () => {
        const agora = Date.now();
        vi.spyOn(reminderService, 'upcoming').mockReturnValue([{
            id: '1000|1',
            streamId: 1000,
            channelName: 'Canal 1',
            programTitle: 'Mais tarde',
            startMs: agora + 60 * 60 * 1000,
        }]);
        const onClose = vi.fn();
        const { container, unmount } = render(
            <RemindersPanel resolveChannel={() => undefined} onClose={onClose} onPlay={vi.fn()} />
        );
        expect(container.textContent).toContain('← Fechar');
        direita();
        expect(onClose).not.toHaveBeenCalled();
        esquerda();
        expect(onClose).toHaveBeenCalledTimes(1);
        unmount();

        vi.spyOn(reminderService, 'upcoming').mockReturnValue([]);
        const onCloseVazio = vi.fn();
        render(<RemindersPanel resolveChannel={() => undefined} onClose={onCloseVazio} onPlay={vi.fn()} />);
        direita();
        expect(onCloseVazio).not.toHaveBeenCalled();
        esquerda();
        expect(onCloseVazio).toHaveBeenCalledTimes(1);
    });
});

describe('busca global (GlobalSearch)', () => {
    beforeEach(() => {
        clearSearchCatalogCache();
        vi.spyOn(api, 'getLiveStreams').mockResolvedValue(canais(3));
        vi.spyOn(api, 'getVODStreams').mockResolvedValue([]);
        vi.spyOn(api, 'getSeries').mockResolvedValue([]);
        vi.spyOn(api, 'getLiveCategories').mockResolvedValue([]);
        vi.spyOn(api, 'getVodCategories').mockResolvedValue([]);
        vi.spyOn(api, 'getSeriesCategories').mockResolvedValue([]);
    });
    afterEach(() => clearSearchCatalogCache());

    it('← na lista de resultados fecha a busca; ← DENTRO do campo continua sendo do teclado', async () => {
        const onClose = vi.fn();
        const { container } = render(<GlobalSearch onClose={onClose} />);
        await waitFor(() => expect(container.textContent).toContain('Digite pelo menos 2 letras.'));
        const input = container.querySelector('.gs-input') as HTMLInputElement;
        expect(container.textContent).toContain('← Fechar');

        // Digitando: ← move o cursor do texto, não fecha nada
        act(() => { fireEvent.change(input, { target: { value: 'canal' } }); });
        await waitFor(() => expect(container.querySelectorAll('.gs-result').length).toBe(3));
        await esvaziarEfeitos();
        const noCampo = esquerda(input);
        expect(onClose).not.toHaveBeenCalled();
        expect(noCampo.defaultPrevented).toBe(false);

        // OK fecha o teclado e desce pra lista
        tecla(13, input);
        expect(texto(container, '.gs-result.tv-focused .gs-result-name')).toBe('Canal 1');
        await esvaziarEfeitos();

        direita();
        expect(onClose).not.toHaveBeenCalled();
        // ← fecha de qualquer ponto da lista, não só do primeiro resultado
        tecla(40);
        expect(texto(container, '.gs-result.tv-focused .gs-result-name')).toBe('Canal 2');
        const naLista = esquerda();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(naLista.defaultPrevented).toBe(true);
    });
});

describe('menu 🟡 dos cards (Filmes e Séries)', () => {
    const categorias: Category[] = [{ category_id: '1', category_name: 'Tudo', parent_id: 0 } as Category];

    /** Monta a página dentro de um FocusContext espião: ← não pode vazar pra sidebar. */
    function montar(pagina: ReactElement) {
        const setFocusZone = vi.fn<(zone: FocusZone) => void>();
        const view = render(
            <FocusContext.Provider value={{ focusZone: 'content', setFocusZone }}>
                {pagina}
            </FocusContext.Provider>
        );
        return { ...view, setFocusZone };
    }

    it('Filmes: ← fecha o menu e o foco fica no mesmo card (não escorrega pra sidebar)', async () => {
        const filmes = [1, 2, 3].map(id => ({
            num: id, name: `Filme ${id}`, stream_type: 'movie', stream_id: id,
            stream_icon: 'capa.jpg', container_extension: 'mp4', custom_sid: '', direct_source: '',
            added: '0', category_id: '1', rating: '', rating_5based: 0, cover: '',
        }) as unknown as VODStream);
        vi.spyOn(api, 'getVODStreams').mockResolvedValue(filmes);
        vi.spyOn(api, 'getVodCategories').mockResolvedValue(categorias);

        const { container, setFocusZone } = montar(<Movies />);
        await waitFor(() => expect(texto(container, '.movie-card.tv-focused .movie-title')).toBe('Filme 1'));
        await esvaziarEfeitos();

        amarelo();
        expect(container.querySelector('.context-menu')).not.toBeNull();
        expect(texto(container, '.context-hint')).toContain('← Fechar');
        await esvaziarEfeitos();

        // → não fecha o menu, e a grade por baixo não anda com ele
        direita();
        expect(container.querySelector('.context-menu')).not.toBeNull();
        expect(texto(container, '.movie-card.tv-focused .movie-title')).toBe('Filme 1');

        // ← fecha de qualquer item do menu, não só do primeiro
        const primeiraAcao = texto(container, '.context-item.tv-focused');
        tecla(40);
        expect(texto(container, '.context-item.tv-focused')).not.toBe(primeiraAcao);
        expect(texto(container, '.context-item.tv-focused')).not.toBeNull();

        const evento = esquerda();
        expect(container.querySelector('.context-menu')).toBeNull();
        expect(evento.defaultPrevented).toBe(true);
        expect(texto(container, '.movie-card.tv-focused .movie-title')).toBe('Filme 1');
        expect(setFocusZone).not.toHaveBeenCalledWith('sidebar');
    });

    it('Séries: ← fecha o menu e o foco fica no mesmo card (não escorrega pra sidebar)', async () => {
        const series = [1, 2, 3].map(id => ({
            num: id, name: `Serie ${id}`, series_id: id, cover: 'capa.jpg', plot: '', cast: '',
            director: '', genre: '', release_date: '', last_modified: '0', rating: '', rating_5based: 0,
            backdrop_path: [], youtube_trailer: '', episode_run_time: '', category_id: '1', tmdb_id: '',
        }) as SeriesType);
        vi.spyOn(api, 'getSeries').mockResolvedValue(series);
        vi.spyOn(api, 'getSeriesCategories').mockResolvedValue(categorias);

        const { container, setFocusZone } = montar(<Series />);
        await waitFor(() => expect(texto(container, '.series-card.tv-focused .series-title')).toBe('Serie 1'));
        await esvaziarEfeitos();

        amarelo();
        expect(container.querySelector('.context-menu')).not.toBeNull();
        expect(texto(container, '.context-hint')).toContain('← Fechar');
        await esvaziarEfeitos();

        // → não fecha o menu, e a grade por baixo não anda com ele
        direita();
        expect(container.querySelector('.context-menu')).not.toBeNull();
        expect(texto(container, '.series-card.tv-focused .series-title')).toBe('Serie 1');

        // ← fecha de qualquer item do menu, não só do primeiro
        const primeiraAcao = texto(container, '.context-item.tv-focused');
        tecla(40);
        expect(texto(container, '.context-item.tv-focused')).not.toBe(primeiraAcao);
        expect(texto(container, '.context-item.tv-focused')).not.toBeNull();

        const evento = esquerda();
        expect(container.querySelector('.context-menu')).toBeNull();
        expect(evento.defaultPrevented).toBe(true);
        expect(texto(container, '.series-card.tv-focused .series-title')).toBe('Serie 1');
        expect(setFocusZone).not.toHaveBeenCalledWith('sidebar');
    });
});
