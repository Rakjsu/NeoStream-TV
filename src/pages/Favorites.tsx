// Favorites Page - Matching NeoStream Desktop Style

import { useCallback, useState } from 'react';
import { storage, type FavoriteItem } from '../services/storage';
import { api } from '../services/api';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useFocusZone } from '../contexts/FocusContext';
import { kidsFilter } from '../services/kidsFilter';
import { ContentDetailModal } from '../components/ContentDetailModal';
import { MoviePlayer } from '../components/MoviePlayer';
import { SeriesQueuePlayer } from '../components/SeriesQueuePlayer';
import { VideoPlayer } from '../components/VideoPlayer';
import { buildEpisodeQueue, type EpisodeQueue } from '../services/seriesPlayback';
import './Favorites.css';

interface FavoritesProps {
    onNavigate?: (page: string) => void;
}

export function Favorites({ onNavigate }: FavoritesProps) {
    const [items, setItems] = useState<FavoriteItem[]>(() => storage.getFavorites());
    const [activeTab, setActiveTab] = useState<'all' | 'movies' | 'series' | 'channels'>('all');
    const [removingId, setRemovingId] = useState<string | null>(null);
    const { focusZone, setFocusZone } = useFocusZone();
    const [kidsActive] = useState(() => kidsFilter.isKidsActive());

    // Playback / modal
    const [modalItem, setModalItem] = useState<FavoriteItem | null>(null);
    const [playingMovie, setPlayingMovie] = useState<FavoriteItem | null>(null);
    const [playingChannel, setPlayingChannel] = useState<FavoriteItem | null>(null);
    const [seriesQueue, setSeriesQueue] = useState<EpisodeQueue | null>(null);

    // Focus states for TV navigation
    const [focusArea, setFocusArea] = useState<'tabs' | 'items'>('items');
    const [focusedTabIndex, setFocusedTabIndex] = useState(0);
    const [focusedItemIndex, setFocusedItemIndex] = useState(0);
    const [emptyFocusIndex, setEmptyFocusIndex] = useState(0);

    const loadItems = useCallback(() => {
        const saved = storage.getFavorites();
        setItems(saved);
    }, []);

    const removeItem = (item: FavoriteItem) => {
        setRemovingId(item.id);
        setTimeout(() => {
            storage.removeFavorite(item.id, item.type);
            loadItems();
            setRemovingId(null);
        }, 300);
    };

    const clearAll = () => {
        storage.clearFavorites();
        loadItems();
    };

    const movies = items.filter(item => item.type === 'movie');
    const series = items.filter(item => item.type === 'series');
    const channels = items.filter(item => item.type === 'channel');

    const displayItems = activeTab === 'all' ? items :
        activeTab === 'movies' ? movies :
            activeTab === 'series' ? series : channels;

    // Indice focado sempre no range (a lista encolhe ao remover itens)
    const safeItemIndex = Math.min(focusedItemIndex, Math.max(0, displayItems.length - 1));

    const tabs = ['all', 'movies', 'series', 'channels'] as const;

    // Abrir item: canal toca direto; filme/série abrem a ficha
    const openItem = (item: FavoriteItem) => {
        if (item.type === 'channel') {
            setPlayingChannel(item);
        } else {
            setModalItem(item);
        }
    };

    const playSeriesEpisode = async (item: FavoriteItem, season?: number, episode?: number) => {
        try {
            const queue = await buildEpisodeQueue(item.id, item.title, item.poster, season, episode);
            if (queue) {
                setSeriesQueue(queue);
                setModalItem(null);
            }
        } catch (err) {
            console.error('Error building episode queue:', err);
        }
    };

    // TV Navigation
    const handleNavigate = (direction: 'up' | 'down' | 'left' | 'right') => {
        if (kidsActive) {
            if (direction === 'left') setFocusZone('sidebar');
            return;
        }
        if (items.length === 0) {
            if (direction === 'left') {
                if (emptyFocusIndex === 0) setFocusZone('sidebar');
                else setEmptyFocusIndex(0);
            } else if (direction === 'right') {
                setEmptyFocusIndex(1);
            }
            return;
        }

        if (focusArea === 'tabs') {
            if (direction === 'left') {
                if (focusedTabIndex === 0) setFocusZone('sidebar');
                else setFocusedTabIndex(prev => Math.max(0, prev - 1));
            } else if (direction === 'right') {
                setFocusedTabIndex(prev => Math.min(tabs.length - 1, prev + 1));
            } else if (direction === 'down') {
                setFocusArea('items');
                setFocusedItemIndex(0);
            }
        } else if (focusArea === 'items') {
            const cols = 6;
            const total = displayItems.length;

            if (direction === 'up') {
                if (focusedItemIndex < cols) {
                    setFocusArea('tabs');
                } else {
                    setFocusedItemIndex(prev => Math.max(0, prev - cols));
                }
            } else if (direction === 'down') {
                setFocusedItemIndex(prev => Math.min(total - 1, prev + cols));
            } else if (direction === 'left') {
                if (focusedItemIndex % cols === 0) setFocusZone('sidebar');
                else setFocusedItemIndex(prev => Math.max(0, prev - 1));
            } else if (direction === 'right') {
                setFocusedItemIndex(prev => Math.min(total - 1, prev + 1));
            }
        }
    };

    const handleEnter = () => {
        if (kidsActive) return;
        if (items.length === 0) {
            onNavigate?.(emptyFocusIndex === 0 ? 'movies' : 'series');
            return;
        }

        if (focusArea === 'tabs') {
            setActiveTab(tabs[focusedTabIndex]);
        } else if (focusArea === 'items') {
            const item = displayItems[safeItemIndex];
            if (item) openItem(item);
        }
    };

    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        enabled: focusZone === 'content' && !modalItem && !playingMovie && !playingChannel && !seriesQueue,
    });

    // Perfil Kids: listas sao globais do aparelho e podem conter conteudo
    // adulto salvo por outros perfis — bloqueadas no modo Kids
    if (kidsActive) {
        return (
            <div className="favorites-page">
                <div className="favorites-backdrop" />
                <div className="empty-state">
                    <div className="empty-icon-container">
                        <div className="empty-icon">👶</div>
                        <div className="empty-icon-glow" />
                    </div>
                    <h2 className="empty-title">Indisponível no perfil Kids</h2>
                    <p className="empty-text">
                        Troque para um perfil adulto para acessar esta página.
                    </p>
                </div>
            </div>
        );
    }

    // Empty State
    if (items.length === 0) {
        return (
            <div className="favorites-page">
                <div className="favorites-backdrop" />
                <div className="empty-state">
                    <div className="empty-icon-container">
                        <div className="empty-icon">♥</div>
                        <div className="empty-icon-glow" />
                    </div>
                    <h2 className="empty-title">Nenhum favorito ainda</h2>
                    <p className="empty-text">
                        Seus filmes, séries e canais favoritos aparecerão aqui.
                        Clique no <strong>coração</strong> em qualquer conteúdo para adicionar aos favoritos.
                    </p>
                    <div className="empty-suggestions">
                        <button
                            className={`suggestion-btn ${emptyFocusIndex === 0 ? 'tv-focused' : ''}`}
                            onClick={() => onNavigate?.('movies')}
                        >
                            <span>Filmes</span>
                            <span>Explorar Filmes</span>
                        </button>
                        <button
                            className={`suggestion-btn ${emptyFocusIndex === 1 ? 'tv-focused' : ''}`}
                            onClick={() => onNavigate?.('series')}
                        >
                            <span>Séries</span>
                            <span>Explorar Séries</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="favorites-page">
            <div className="favorites-backdrop" />

            {/* Header */}
            <header className="favorites-header">
                <div className="header-title">
                    <div className="title-icon">♥</div>
                    <div>
                        <h1>Meus Favoritos</h1>
                        <p className="subtitle">{items.length} itens salvos</p>
                    </div>
                </div>
                {items.length > 0 && (
                    <button className="clear-btn" onClick={clearAll}>
                        <span>Excluir</span>
                        <span>Limpar Tudo</span>
                    </button>
                )}
            </header>

            {/* Tabs */}
            <div className="tabs-container">
                <button
                    className={`tab ${activeTab === 'all' ? 'active' : ''} ${focusArea === 'tabs' && focusedTabIndex === 0 ? 'tv-focused' : ''}`}
                    onClick={() => setActiveTab('all')}
                >
                    <span>Todos</span>
                    <span className="tab-count">{items.length}</span>
                </button>
                <button
                    className={`tab ${activeTab === 'movies' ? 'active' : ''} ${focusArea === 'tabs' && focusedTabIndex === 1 ? 'tv-focused' : ''}`}
                    onClick={() => setActiveTab('movies')}
                >
                    <span>Filmes</span>
                    <span className="tab-count">{movies.length}</span>
                </button>
                <button
                    className={`tab ${activeTab === 'series' ? 'active' : ''} ${focusArea === 'tabs' && focusedTabIndex === 2 ? 'tv-focused' : ''}`}
                    onClick={() => setActiveTab('series')}
                >
                    <span>Séries</span>
                    <span className="tab-count">{series.length}</span>
                </button>
                <button
                    className={`tab ${activeTab === 'channels' ? 'active' : ''} ${focusArea === 'tabs' && focusedTabIndex === 3 ? 'tv-focused' : ''}`}
                    onClick={() => setActiveTab('channels')}
                >
                    <span>Canais</span>
                    <span className="tab-count">{channels.length}</span>
                </button>
            </div>

            {/* Cards Grid */}
            <div className="cards-grid">
                {displayItems.map((item, index) => (
                    <div
                        key={`${item.type}-${item.id}`}
                        className={`card ${removingId === item.id ? 'removing' : ''} ${focusArea === 'items' && safeItemIndex === index ? 'tv-focused' : ''}`}
                        style={{ animationDelay: `${index * 0.05}s` }}
                        onClick={() => openItem(item)}
                    >
                        <div className="card-poster">
                            {item.poster ? (
                                <img decoding="async" src={item.poster} alt={item.title} />
                            ) : (
                                <div className="poster-placeholder">
                                    {item.type === 'movie' ? 'Filme' : item.type === 'series' ? 'Série' : 'Canal'}
                                </div>
                            )}
                            <div className="card-type">
                                {item.type === 'movie' ? 'Filme' : item.type === 'series' ? 'Série' : 'Canal'}
                            </div>
                            <div className="card-overlay">
                                <button
                                    className="remove-btn"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeItem(item);
                                    }}
                                >
                                    Excluir
                                </button>
                            </div>
                        </div>
                        <div className="card-info">
                            <h3 className="card-title">{item.title}</h3>
                            <div className="card-meta">
                                {item.year && <span>{item.year}</span>}
                                {item.rating && <span>★ {item.rating}</span>}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Footer Hints */}
            <div className="favorites-hints">
                <span>Setas Navegar</span>
                <span>OK Selecionar</span>
                <span>Voltar</span>
            </div>

            {/* Content Detail Modal */}
            {modalItem && (
                <ContentDetailModal
                    isOpen={true}
                    onClose={() => { setModalItem(null); loadItems(); }}
                    contentId={modalItem.id}
                    contentType={modalItem.type === 'series' ? 'series' : 'movie'}
                    contentData={{
                        name: modalItem.title,
                        cover: modalItem.poster || '',
                        rating: modalItem.rating,
                        container_extension: modalItem.container,
                    }}
                    onPlay={(season, episode) => {
                        if (modalItem.type === 'movie') {
                            setPlayingMovie(modalItem);
                            setModalItem(null);
                        } else {
                            void playSeriesEpisode(modalItem, season, episode);
                        }
                    }}
                />
            )}

            {/* Movie Player */}
            {playingMovie && (
                <MoviePlayer
                    movieId={playingMovie.id}
                    title={playingMovie.title}
                    poster={playingMovie.poster}
                    container={playingMovie.container}
                    onClose={() => setPlayingMovie(null)}
                />
            )}

            {/* Live Channel Player */}
            {playingChannel && (
                <VideoPlayer
                    src={api.getLiveStreamUrl(Number(playingChannel.id))}
                    title={playingChannel.title}
                    poster={playingChannel.poster}
                    isLive
                    autoPlay
                    contentType="live"
                    onClose={() => setPlayingChannel(null)}
                />
            )}

            {/* Series Player */}
            {seriesQueue && (
                <SeriesQueuePlayer
                    queue={seriesQueue}
                    onClose={() => setSeriesQueue(null)}
                />
            )}
        </div>
    );
}
