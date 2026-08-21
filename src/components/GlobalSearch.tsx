// Busca global (Fase 4b): overlay que procura em canais, filmes e séries ao
// mesmo tempo (catálogo cacheado). Canal toca direto; filme/série abrem a
// ficha. Acessível pela sidebar (🔍) — a página atrás fica com foco 'overlay'.

import { useState, useEffect, useRef, useMemo } from 'react';
import { loadSearchCatalog, searchIn, type SearchCatalogData } from '../services/searchCatalog';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useWatchSession } from '../hooks/useWatchSession';
import { api } from '../services/api';
import { zapHistory } from '../services/liveExtras';
import { storage } from '../services/storage';
import type { LiveStream, VODStream, Series } from '../types';
import { VideoPlayer } from './VideoPlayer';
import { MoviePlayer } from './MoviePlayer';
import { SeriesQueuePlayer } from './SeriesQueuePlayer';
import { ContentDetailModal } from './ContentDetailModal';
import { buildEpisodeQueue, type EpisodeQueue } from '../services/seriesPlayback';
import './GlobalSearch.css';

interface GlobalSearchProps {
    onClose: () => void;
}

type ResultItem =
    | { kind: 'channel'; channel: LiveStream }
    | { kind: 'movie'; movie: VODStream }
    | { kind: 'series'; series: Series };

const GROUP_LIMIT = 8;

export function GlobalSearch({ onClose }: GlobalSearchProps) {
    const [query, setQuery] = useState('');
    const [catalog, setCatalog] = useState<SearchCatalogData | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [focusedIndex, setFocusedIndex] = useState(-1); // -1 = input
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    // Quando o IME fecha (blur), o MESMO keydown ainda chega no onBack/onEnter
    // — este timestamp separa "fechar teclado" de "fechar overlay"
    const lastInputBlurAtRef = useRef(0);

    // Reprodução dentro do overlay
    const [playingChannel, setPlayingChannel] = useState<LiveStream | null>(null);
    const [playingMovie, setPlayingMovie] = useState<VODStream | null>(null);
    const [modalSeries, setModalSeries] = useState<Series | null>(null);
    const [seriesQueue, setSeriesQueue] = useState<EpisodeQueue | null>(null);

    useWatchSession('live', playingChannel?.name || '');

    // Carrega (ou reaproveita) o catálogo unificado
    useEffect(() => {
        let cancelled = false;
        loadSearchCatalog()
            .then(data => { if (!cancelled) setCatalog(data); })
            .catch(() => { if (!cancelled) setLoadError(true); });
        return () => { cancelled = true; };
    }, []);

    // Foco inicial no input (abre o IME)
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const results = useMemo<ResultItem[]>(() => {
        if (!catalog || query.trim().length < 2) return [];
        return [
            ...searchIn(catalog.channels, query, GROUP_LIMIT).map(channel => ({ kind: 'channel' as const, channel })),
            ...searchIn(catalog.movies, query, GROUP_LIMIT).map(movie => ({ kind: 'movie' as const, movie })),
            ...searchIn(catalog.series, query, GROUP_LIMIT).map(series => ({ kind: 'series' as const, series })),
        ];
    }, [catalog, query]);

    // Índice focado sempre no range quando os resultados mudam
    const safeIndex = Math.min(focusedIndex, results.length - 1);

    // Mantém o resultado focado visível
    useEffect(() => {
        if (safeIndex < 0) return;
        const focused = listRef.current?.querySelector('.gs-result.tv-focused');
        focused?.scrollIntoView({ block: 'nearest' });
    }, [safeIndex]);

    const activateResult = (item: ResultItem) => {
        if (item.kind === 'channel') {
            storage.setLastChannel(item.channel.stream_id);
            zapHistory.push(item.channel.stream_id);
            setPlayingChannel(item.channel);
        } else if (item.kind === 'movie') {
            setPlayingMovie(item.movie);
        } else {
            setModalSeries(item.series);
        }
    };

    const playSeriesEpisode = async (series: Series, season?: number, episode?: number) => {
        try {
            const queue = await buildEpisodeQueue(series.series_id, series.name, series.cover, season, episode);
            if (queue) {
                setSeriesQueue(queue);
                setModalSeries(null);
            }
        } catch (err) {
            console.error('Error building episode queue:', err);
        }
    };

    const overlayBusy = !!(playingChannel || playingMovie || modalSeries || seriesQueue);

    useTVNavigation({
        enabled: !overlayBusy,
        onNavigate: (direction) => {
            if (direction === 'down') {
                setFocusedIndex(prev => Math.min(results.length - 1, prev + 1));
            } else if (direction === 'up') {
                setFocusedIndex(prev => {
                    const next = prev - 1;
                    if (next < 0) {
                        inputRef.current?.focus();
                        return -1;
                    }
                    return next;
                });
            }
        },
        onEnter: () => {
            if (safeIndex < 0) {
                // OK no input: com resultados, desce pra lista (refocar o
                // input criava um loop — resultados inalcançáveis por D-pad)
                if (results.length > 0) {
                    setFocusedIndex(0);
                } else {
                    inputRef.current?.focus();
                }
                return;
            }
            const item = results[safeIndex];
            if (item) activateResult(item);
        },
        onBack: () => {
            // Back que acabou de fechar o IME não fecha o overlay junto
            if (Date.now() - lastInputBlurAtRef.current < 150) {
                if (results.length > 0) setFocusedIndex(0);
                return;
            }
            onClose();
        },
    });

    const resultLabel = (item: ResultItem): { icon: string; name: string; type: string } => {
        if (item.kind === 'channel') return { icon: '📺', name: item.channel.name, type: 'Canal' };
        if (item.kind === 'movie') return { icon: '🎬', name: item.movie.name, type: 'Filme' };
        return { icon: '🎞', name: item.series.name, type: 'Série' };
    };

    return (
        <div className="gs-overlay">
            <div className="gs-panel">
                <div className="gs-header">
                    <span className="gs-icon">🔍</span>
                    <input
                        ref={inputRef}
                        className="gs-input"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setFocusedIndex(-1);
                        }}
                        placeholder="Buscar canais, filmes e séries..."
                        autoComplete="off"
                        spellCheck={false}
                        onBlur={() => { lastInputBlurAtRef.current = Date.now(); }}
                    />
                    <button className="gs-close" onClick={onClose}>✕</button>
                </div>

                <div ref={listRef} className="gs-results">
                    {loadError && (
                        <div className="gs-empty">Erro ao carregar o catálogo. Volte e tente de novo.</div>
                    )}
                    {!loadError && !catalog && (
                        <div className="gs-empty">Carregando catálogo...</div>
                    )}
                    {catalog && query.trim().length < 2 && (
                        <div className="gs-empty">Digite pelo menos 2 letras.</div>
                    )}
                    {catalog && query.trim().length >= 2 && results.length === 0 && (
                        <div className="gs-empty">Nada encontrado para "{query}".</div>
                    )}
                    {results.map((item, index) => {
                        const label = resultLabel(item);
                        return (
                            <div
                                key={`${item.kind}-${index}`}
                                className={`gs-result ${safeIndex === index ? 'tv-focused' : ''}`}
                                onClick={() => activateResult(item)}
                            >
                                <span className="gs-result-icon">{label.icon}</span>
                                <span className="gs-result-name">{label.name}</span>
                                <span className="gs-result-type">{label.type}</span>
                            </div>
                        );
                    })}
                </div>

                <div className="gs-hints">
                    <span>↑↓ Navegar</span>
                    <span>OK Abrir</span>
                    <span>← Fechar</span>
                </div>
            </div>

            {/* Reprodução dentro do overlay */}
            {playingChannel && (
                <VideoPlayer
                    isOverlayOwner
                    src={playingChannel.direct_source || api.getLiveStreamUrl(playingChannel.stream_id)}
                    title={playingChannel.name}
                    poster={playingChannel.stream_icon}
                    isLive
                    autoPlay
                    contentType="live"
                    contentKey={`live-${playingChannel.stream_id}`}
                    onClose={() => setPlayingChannel(null)}
                />
            )}

            {playingMovie && (
                <MoviePlayer
                    isOverlayOwner
                    movieId={String(playingMovie.stream_id)}
                    title={playingMovie.name}
                    poster={playingMovie.stream_icon || playingMovie.cover}
                    container={playingMovie.container_extension}
                    onClose={() => setPlayingMovie(null)}
                />
            )}

            {modalSeries && (
                <ContentDetailModal
                    isOpen={true}
                    onClose={() => setModalSeries(null)}
                    contentId={String(modalSeries.series_id)}
                    contentType="series"
                    contentData={{
                        name: modalSeries.name,
                        cover: modalSeries.cover,
                        rating: modalSeries.rating,
                        plot: modalSeries.plot,
                        genre: modalSeries.genre,
                        release_date: modalSeries.release_date,
                    }}
                    onPlay={(season, episode) => {
                        void playSeriesEpisode(modalSeries, season, episode);
                    }}
                />
            )}

            {seriesQueue && (
                <SeriesQueuePlayer
                    isOverlayOwner
                    queue={seriesQueue}
                    onClose={() => setSeriesQueue(null)}
                />
            )}
        </div>
    );
}
