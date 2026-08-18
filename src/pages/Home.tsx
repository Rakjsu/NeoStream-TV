// Home Page - Matching NeoStream Desktop

import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import type { VODStream, Series } from '../types';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useFocusZone } from '../contexts/FocusContext';
import { progressService, type MovieProgress, type SeriesProgress } from '../services/progressService';
import { MoviePlayer } from '../components/MoviePlayer';
import { SeriesQueuePlayer } from '../components/SeriesQueuePlayer';
import { buildEpisodeQueue, type EpisodeQueue } from '../services/seriesPlayback';
import './Home.css';

type ContinueItem =
    | { kind: 'movie'; progress: MovieProgress }
    | { kind: 'series'; progress: SeriesProgress };

interface HomeProps {
    onNavigate?: (page: string) => void;
}

interface ContentCounts {
    live: number;
    vod: number;
    series: number;
}

export function Home({ onNavigate }: HomeProps) {
    const { focusZone, setFocusZone } = useFocusZone();
    const [loading, setLoading] = useState(true);
    const [counts, setCounts] = useState<ContentCounts>({ live: 0, vod: 0, series: 0 });
    const [recentMovies, setRecentMovies] = useState<VODStream[]>([]);
    const [recentSeries, setRecentSeries] = useState<Series[]>([]);
    const [recommendations, setRecommendations] = useState<(VODStream | Series)[]>([]);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [focusedSection, setFocusedSection] = useState(0);
    const [focusedItem, setFocusedItem] = useState(0);

    // Continuar assistindo
    const [continueItems, setContinueItems] = useState<ContinueItem[]>(() => progressService.getContinueWatching());
    const [playingMovie, setPlayingMovie] = useState<MovieProgress | null>(null);
    const [seriesQueue, setSeriesQueue] = useState<EpisodeQueue | null>(null);

    const refreshContinue = useCallback(() => {
        setContinueItems(progressService.getContinueWatching());
    }, []);

    // Update clock every minute
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60000);
        return () => clearInterval(timer);
    }, []);

    // Fetch data
    useEffect(() => {
        async function fetchData() {
            try {
                setLoading(true);
                const [streams, movies, series] = await Promise.all([
                    api.getLiveStreams(),
                    api.getVODStreams(),
                    api.getSeries()
                ]);

                setCounts({
                    live: streams.length,
                    vod: movies.length,
                    series: series.length
                });

                // Get recent items (newest first based on 'added' field)
                const sortedMovies = [...movies].sort((a, b) =>
                    parseInt(b.added || '0') - parseInt(a.added || '0')
                ).slice(0, 15);

                const sortedSeries = [...series].sort((a, b) =>
                    new Date(b.last_modified || 0).getTime() - new Date(a.last_modified || 0).getTime()
                ).slice(0, 15);

                setRecentMovies(sortedMovies);
                setRecentSeries(sortedSeries);

                // Recommendations: mix of random movies and series
                const randomMovies = [...movies].sort(() => Math.random() - 0.5).slice(0, 8);
                const randomSeries = [...series].sort(() => Math.random() - 0.5).slice(0, 7);
                setRecommendations([...randomMovies, ...randomSeries].sort(() => Math.random() - 0.5));

            } catch (error) {
                console.error('Failed to fetch data:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, []);

    // Time formatting
    const formatTime = (date: Date) => {
        return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString('pt-BR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long'
        });
    };

    // Greeting based on time of day (as per original app)
    const getGreeting = () => {
        const hour = currentTime.getHours();
        if (hour < 12) return 'Bom dia';
        if (hour < 18) return 'Boa tarde';
        return 'Boa noite';
    };

    // TV Navigation - seções dinâmicas ("continue" só aparece com progresso)
    const sections = [
        { id: 'stats', items: 3 },
        ...(continueItems.length > 0 ? [{ id: 'continue', items: continueItems.length }] : []),
        { id: 'recommendations', items: recommendations.length },
        { id: 'series', items: recentSeries.length },
        { id: 'movies', items: recentMovies.length },
        { id: 'quick', items: 5 }
    ];

    const sectionIndex = (id: string) => sections.findIndex(s => s.id === id);

    const playContinueItem = async (item: ContinueItem) => {
        if (item.kind === 'movie') {
            setPlayingMovie(item.progress);
        } else {
            try {
                const queue = await buildEpisodeQueue(
                    item.progress.seriesId,
                    item.progress.seriesName,
                    item.progress.poster,
                    item.progress.season,
                    item.progress.episode
                );
                if (queue) setSeriesQueue(queue);
            } catch (err) {
                console.error('Error resuming series:', err);
            }
        }
    };

    const handleNavigate = (direction: 'up' | 'down' | 'left' | 'right') => {
        if (direction === 'up') {
            setFocusedSection(prev => Math.max(0, prev - 1));
            setFocusedItem(0);
        } else if (direction === 'down') {
            setFocusedSection(prev => Math.min(sections.length - 1, prev + 1));
            setFocusedItem(0);
        } else if (direction === 'left') {
            if (focusedItem === 0) {
                // At first item - move focus to Sidebar
                setFocusZone('sidebar');
            } else {
                setFocusedItem(prev => Math.max(0, prev - 1));
            }
        } else if (direction === 'right') {
            const maxItems = sections[focusedSection]?.items || 0;
            setFocusedItem(prev => Math.min(maxItems - 1, prev + 1));
        }
    };

    const handleEnter = () => {
        // Clamp: a seção 'continue' some quando o progresso zera
        const section = sections[Math.min(focusedSection, sections.length - 1)];
        if (section?.id === 'stats') {
            const pages = ['live', 'movies', 'series'];
            onNavigate?.(pages[focusedItem] || 'live');
        } else if (section?.id === 'continue') {
            const item = continueItems[focusedItem];
            if (item) void playContinueItem(item);
        } else if (section?.id === 'quick') {
            const pages = ['live', 'movies', 'series', 'favorites', 'settings'];
            onNavigate?.(pages[focusedItem] || 'live');
        } else if (section?.id === 'movies' || section?.id === 'recommendations') {
            onNavigate?.('movies');
        } else if (section?.id === 'series') {
            onNavigate?.('series');
        }
    };

    // Only enable navigation when content is focused and no player is open
    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        enabled: focusZone === 'content' && !playingMovie && !seriesQueue,
    });

    // Auto-scroll to focused section when it changes
    useEffect(() => {
        const section = sections[focusedSection];
        if (section) {
            const element = document.getElementById(`home-${section.id}`);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
        // sections é derivado — o id da seção focada é o que importa aqui
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusedSection, continueItems.length]);

    // Helper to get cover image
    const getCover = (item: VODStream | Series) => {
        if ('stream_id' in item) {
            // VODStream - use stream_icon as primary
            return item.stream_icon || item.cover || '';
        }
        // Series - use cover
        return item.cover || '';
    };

    const getName = (item: VODStream | Series) => {
        return item.name;
    };

    const getId = (item: VODStream | Series) => {
        return 'stream_id' in item ? item.stream_id : item.series_id;
    };

    return (
        <div className="home-page">
            {/* Background decorations */}
            <div className="home-bg-decoration home-bg-decoration-1" />
            <div className="home-bg-decoration home-bg-decoration-2" />

            {/* Header */}
            <header className="home-header">
                <div className="home-header-left">
                    <div className="home-date">{formatDate(currentTime)}</div>
                    <h1 className="home-greeting">
                        {getGreeting()}! <span className="waving-hand">👋</span>
                    </h1>
                    <p className="home-subtitle">O que você quer assistir hoje?</p>
                </div>
                <div className="home-clock">{formatTime(currentTime)}</div>
            </header>

            {/* Stats Cards */}
            <section id="home-stats" className="home-stats">
                <button
                    className={`stat-card stat-card-live ${focusedSection === 0 && focusedItem === 0 ? 'tv-focused' : ''}`}
                    onClick={() => onNavigate?.('live')}
                >
                    <div className="stat-icon">📺</div>
                    <div className="stat-value">{loading ? '...' : counts.live.toLocaleString()}</div>
                    <div className="stat-label">Canais</div>
                </button>

                <button
                    className={`stat-card stat-card-vod ${focusedSection === 0 && focusedItem === 1 ? 'tv-focused' : ''}`}
                    onClick={() => onNavigate?.('movies')}
                >
                    <div className="stat-icon">🎬</div>
                    <div className="stat-value">{loading ? '...' : counts.vod.toLocaleString()}</div>
                    <div className="stat-label">Filmes</div>
                </button>

                <button
                    className={`stat-card stat-card-series ${focusedSection === 0 && focusedItem === 2 ? 'tv-focused' : ''}`}
                    onClick={() => onNavigate?.('series')}
                >
                    <div className="stat-icon">📺</div>
                    <div className="stat-value">{loading ? '...' : counts.series.toLocaleString()}</div>
                    <div className="stat-label">Séries</div>
                </button>
            </section>

            {/* Content Rows - Matching Original App */}
            <section className="home-content">
                {/* Continue Watching */}
                {continueItems.length > 0 && (
                    <div id="home-continue" className="content-section">
                        <h2 className="section-title">▶ Continuar Assistindo</h2>
                        <div className="content-row">
                            {continueItems.map((item, index) => {
                                const isMovie = item.kind === 'movie';
                                const title = isMovie ? item.progress.name : item.progress.seriesName;
                                const subtitle = isMovie
                                    ? null
                                    : `T${item.progress.season} E${item.progress.episode}`;
                                const pct = item.progress.duration > 0
                                    ? Math.min(100, (item.progress.time / item.progress.duration) * 100)
                                    : 0;
                                const key = isMovie ? `m-${item.progress.id}` : `s-${item.progress.seriesId}`;
                                return (
                                    <button
                                        key={key}
                                        className={`content-card ${focusedSection === sectionIndex('continue') && focusedItem === index ? 'tv-focused' : ''}`}
                                        onClick={() => void playContinueItem(item)}
                                    >
                                        <div className="card-image card-image-poster">
                                            <img
                                                src={item.progress.poster || ''}
                                                alt={title}
                                                onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150"><rect fill="%231a1a2e" width="100" height="150"/><text x="50" y="80" text-anchor="middle" fill="%23666" font-size="40">🎬</text></svg>'; }}
                                            />
                                            <div className="continue-progress">
                                                <div className="continue-progress-fill" style={{ width: `${pct}%` }} />
                                            </div>
                                        </div>
                                        <div className="card-title">
                                            {title}
                                            {subtitle && <span className="continue-episode"> · {subtitle}</span>}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Recommendations */}
                <div id="home-recommendations" className="content-section">
                    <h2 className="section-title">💡 Recomendados Para Você</h2>
                    <div className="content-row">
                        {recommendations.map((item, index) => (
                            <button
                                key={getId(item)}
                                className={`content-card ${focusedSection === sectionIndex('recommendations') && focusedItem === index ? 'tv-focused' : ''}`}
                                onClick={() => onNavigate?.('stream_id' in item ? 'movies' : 'series')}
                            >
                                <div className="card-image card-image-poster">
                                    <img
                                        src={getCover(item)}
                                        alt={getName(item)}
                                        onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150"><rect fill="%231a1a2e" width="100" height="150"/><text x="50" y="80" text-anchor="middle" fill="%23666" font-size="40">🎬</text></svg>'; }}
                                    />
                                </div>
                                <div className="card-title">{getName(item)}</div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Recent Series */}
                <div id="home-series" className="content-section">
                    <h2 className="section-title">🆕 Séries Recentes</h2>
                    <div className="content-row">
                        {recentSeries.map((series, index) => (
                            <button
                                key={series.series_id}
                                className={`content-card ${focusedSection === sectionIndex('series') && focusedItem === index ? 'tv-focused' : ''}`}
                                onClick={() => onNavigate?.('series')}
                            >
                                <div className="card-image card-image-poster">
                                    <img
                                        src={series.cover}
                                        alt={series.name}
                                        onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150"><rect fill="%231a1a2e" width="100" height="150"/><text x="50" y="80" text-anchor="middle" fill="%23666" font-size="40">📺</text></svg>'; }}
                                    />
                                </div>
                                <div className="card-title">{series.name}</div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Recent Movies */}
                <div id="home-movies" className="content-section">
                    <h2 className="section-title">🎬 Filmes Recentes</h2>
                    <div className="content-row">
                        {recentMovies.map((movie, index) => (
                            <button
                                key={movie.stream_id}
                                className={`content-card ${focusedSection === sectionIndex('movies') && focusedItem === index ? 'tv-focused' : ''}`}
                                onClick={() => onNavigate?.('movies')}
                            >
                                <div className="card-image card-image-poster">
                                    <img
                                        src={movie.stream_icon || movie.cover}
                                        alt={movie.name}
                                        onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150"><rect fill="%231a1a2e" width="100" height="150"/><text x="50" y="80" text-anchor="middle" fill="%23666" font-size="40">🎬</text></svg>'; }}
                                    />
                                </div>
                                <div className="card-title">{movie.name}</div>
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            {/* Quick Access */}
            <section id="home-quick" className="home-quick-access">
                <h2 className="section-title">⚡ Acesso Rápido</h2>
                <div className="quick-grid">
                    <button
                        className={`quick-item ${focusedSection === sectionIndex('quick') && focusedItem === 0 ? 'tv-focused' : ''}`}
                        onClick={() => onNavigate?.('live')}
                    >
                        <span className="quick-icon">🔴</span>
                        <span className="quick-label">TV ao Vivo</span>
                    </button>
                    <button
                        className={`quick-item ${focusedSection === sectionIndex('quick') && focusedItem === 1 ? 'tv-focused' : ''}`}
                        onClick={() => onNavigate?.('movies')}
                    >
                        <span className="quick-icon">🎥</span>
                        <span className="quick-label">Filmes</span>
                    </button>
                    <button
                        className={`quick-item ${focusedSection === sectionIndex('quick') && focusedItem === 2 ? 'tv-focused' : ''}`}
                        onClick={() => onNavigate?.('series')}
                    >
                        <span className="quick-icon">📺</span>
                        <span className="quick-label">Séries</span>
                    </button>
                    <button
                        className={`quick-item ${focusedSection === sectionIndex('quick') && focusedItem === 3 ? 'tv-focused' : ''}`}
                        onClick={() => onNavigate?.('favorites')}
                    >
                        <span className="quick-icon">❤️</span>
                        <span className="quick-label">Favoritos</span>
                    </button>
                    <button
                        className={`quick-item ${focusedSection === sectionIndex('quick') && focusedItem === 4 ? 'tv-focused' : ''}`}
                        onClick={() => onNavigate?.('settings')}
                    >
                        <span className="quick-icon">⚙️</span>
                        <span className="quick-label">Configurações</span>
                    </button>
                </div>
            </section>

            {/* Footer */}
            <footer className="home-footer">
                <span>NeoStream TV</span>
                <span>v1.0.0</span>
            </footer>

            {/* Continue Watching: Movie Player */}
            {playingMovie && (
                <MoviePlayer
                    movieId={playingMovie.id}
                    title={playingMovie.name}
                    poster={playingMovie.poster}
                    container={playingMovie.container}
                    onClose={() => {
                        setPlayingMovie(null);
                        refreshContinue();
                    }}
                />
            )}

            {/* Continue Watching: Series Player */}
            {seriesQueue && (
                <SeriesQueuePlayer
                    queue={seriesQueue}
                    onClose={() => {
                        setSeriesQueue(null);
                        refreshContinue();
                    }}
                />
            )}
        </div>
    );
}
