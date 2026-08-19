// MyList Page - Watch Later List - Matching NeoStream Desktop Style

import { useCallback, useState } from 'react';
import { storage, type WatchLaterItem } from '../services/storage';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useFocusZone } from '../contexts/FocusContext';
import { kidsFilter } from '../services/kidsFilter';
import { ContentDetailModal } from '../components/ContentDetailModal';
import { MoviePlayer } from '../components/MoviePlayer';
import { SeriesQueuePlayer } from '../components/SeriesQueuePlayer';
import { buildEpisodeQueue, type EpisodeQueue } from '../services/seriesPlayback';
import './MyList.css';

interface MyListProps {
    onNavigate?: (page: string) => void;
}

export function MyList({ onNavigate }: MyListProps) {
    const [items, setItems] = useState<WatchLaterItem[]>(() => storage.getWatchLater());
    const [activeTab, setActiveTab] = useState<'all' | 'movies' | 'series'>('all');
    const [removingId, setRemovingId] = useState<string | null>(null);
    const { focusZone, setFocusZone } = useFocusZone();
    const [kidsActive] = useState(() => kidsFilter.isKidsActive());

    // Playback / modal
    const [modalItem, setModalItem] = useState<WatchLaterItem | null>(null);
    const [playingMovie, setPlayingMovie] = useState<WatchLaterItem | null>(null);
    const [seriesQueue, setSeriesQueue] = useState<EpisodeQueue | null>(null);

    // Focus states for TV navigation
    const [focusArea, setFocusArea] = useState<'tabs' | 'items'>('items');
    const [focusedTabIndex, setFocusedTabIndex] = useState(0);
    const [focusedItemIndex, setFocusedItemIndex] = useState(0);
    const [emptyFocusIndex, setEmptyFocusIndex] = useState(0);

    const loadItems = useCallback(() => {
        const saved = storage.getWatchLater();
        setItems(saved);
    }, []);

    const removeItem = (item: WatchLaterItem) => {
        setRemovingId(item.id);
        setTimeout(() => {
            storage.removeWatchLater(item.id, item.type);
            loadItems();
            setRemovingId(null);
        }, 300);
    };

    const clearAll = () => {
        storage.clearWatchLater();
        loadItems();
    };

    const movies = items.filter(item => item.type === 'movie');
    const series = items.filter(item => item.type === 'series');

    const displayItems = activeTab === 'all' ? items :
        activeTab === 'movies' ? movies : series;

    // Indice focado sempre no range (a lista encolhe ao remover itens)
    const safeItemIndex = Math.min(focusedItemIndex, Math.max(0, displayItems.length - 1));

    const tabs = ['all', 'movies', 'series'] as const;

    // Abrir item: ambos os tipos abrem a ficha (o modal resolve episódios)
    const openItem = (item: WatchLaterItem) => {
        setModalItem(item);
    };

    // Play direto do card: filme toca na hora; série abre a ficha
    const playItem = async (item: WatchLaterItem) => {
        if (item.type === 'movie') {
            setPlayingMovie(item);
        } else if (item.type === 'series') {
            openItem(item);
        }
    };

    const playSeriesEpisode = async (item: WatchLaterItem, season?: number, episode?: number) => {
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
        enabled: focusZone === 'content' && !modalItem && !playingMovie && !seriesQueue,
    });

    // Perfil Kids: listas sao globais do aparelho e podem conter conteudo
    // adulto salvo por outros perfis — bloqueadas no modo Kids
    if (kidsActive) {
        return (
            <div className="mylist-page">
                <div className="mylist-backdrop" />
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
            <div className="mylist-page">
                <div className="mylist-backdrop" />
                <div className="empty-state">
                    <div className="empty-icon-container">
                        <div className="empty-icon">📑</div>
                        <div className="empty-icon-glow" />
                    </div>
                    <h2 className="empty-title">Sua lista está vazia</h2>
                    <p className="empty-text">
                        Adicione filmes e séries para assistir depois clicando em
                        <strong> "+ Minha Lista"</strong> no modal de detalhes.
                    </p>
                    <div className="empty-suggestions">
                        <button
                            className={`suggestion-btn ${emptyFocusIndex === 0 ? 'tv-focused' : ''}`}
                            onClick={() => onNavigate?.('movies')}
                        >
                            <span>🎬</span>
                            <span>Explorar Filmes</span>
                        </button>
                        <button
                            className={`suggestion-btn ${emptyFocusIndex === 1 ? 'tv-focused' : ''}`}
                            onClick={() => onNavigate?.('series')}
                        >
                            <span>📺</span>
                            <span>Explorar Séries</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mylist-page">
            <div className="mylist-backdrop" />

            {/* Header */}
            <header className="mylist-header">
                <div className="header-title">
                    <div className="title-icon">📑</div>
                    <div>
                        <h1>Minha Lista</h1>
                        <p className="subtitle">{items.length} itens para assistir</p>
                    </div>
                </div>
                {items.length > 0 && (
                    <button className="clear-btn" onClick={clearAll}>
                        <span>🗑️</span>
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
                    <span>🎬 Filmes</span>
                    <span className="tab-count">{movies.length}</span>
                </button>
                <button
                    className={`tab ${activeTab === 'series' ? 'active' : ''} ${focusArea === 'tabs' && focusedTabIndex === 2 ? 'tv-focused' : ''}`}
                    onClick={() => setActiveTab('series')}
                >
                    <span>📺 Séries</span>
                    <span className="tab-count">{series.length}</span>
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
                                <img src={item.poster} alt={item.title} />
                            ) : (
                                <div className="poster-placeholder">
                                    {item.type === 'movie' ? '🎬' : '📺'}
                                </div>
                            )}
                            <div className="card-type">
                                {item.type === 'movie' ? '🎬' : '📺'}
                            </div>
                            <div className="card-overlay">
                                <button
                                    className="remove-btn"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeItem(item);
                                    }}
                                >
                                    🗑️
                                </button>
                                <button
                                    className="play-btn"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void playItem(item);
                                    }}
                                >
                                    ▶️
                                </button>
                            </div>
                        </div>
                        <div className="card-info">
                            <h3 className="card-title">{item.title}</h3>
                            <div className="card-meta">
                                {item.year && <span>{item.year}</span>}
                                {item.rating && <span>⭐ {item.rating}</span>}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Footer Hints */}
            <div className="mylist-hints">
                <span>↑↓←→ Navegar</span>
                <span>OK Selecionar</span>
                <span>← Voltar</span>
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
