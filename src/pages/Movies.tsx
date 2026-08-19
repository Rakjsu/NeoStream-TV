// Movies Page - Matching NeoStream Desktop Style

import { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../services/api';
import type { VODStream, Category } from '../types';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useFocusZone } from '../contexts/FocusContext';
import { CategoryMenu, type CategoryMenuHandle } from '../components/CategoryMenu';
import { AnimatedSearchBar, type AnimatedSearchBarHandle } from '../components/AnimatedSearchBar';
import { ContentDetailModal } from '../components/ContentDetailModal';
import { MoviePlayer } from '../components/MoviePlayer';
import { catalogSort, sortCatalog, hideWatched, isRecentlyAdded, SORT_LABELS, type CatalogSort } from '../services/catalogExtras';
import { progressService } from '../services/progressService';
import './Movies.css';

export function Movies() {
    const { focusZone, setFocusZone } = useFocusZone();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [streams, setStreams] = useState<VODStream[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedMovie, setSelectedMovie] = useState<VODStream | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [showPlayer, setShowPlayer] = useState(false);
    const [playingMovie, setPlayingMovie] = useState<VODStream | null>(null);
    const [brokenImages, setBrokenImages] = useState<Set<number>>(new Set());
    const [visibleCount, setVisibleCount] = useState(24); // Start with reasonable default
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Ordenação / esconder assistidos / selo NOVO (Fase 3)
    const [sortMode, setSortMode] = useState<CatalogSort>(() => catalogSort.get('movies'));
    const [hideWatchedOn, setHideWatchedOn] = useState(() => hideWatched.get());
    // Congelado no mount: Date.now() no render viola a pureza do react-hooks
    const [nowMs] = useState(() => Date.now());

    // Focus states for TV navigation
    // 'categories' = zona do header: índice 0 é a busca, 1 é o menu de categorias
    const [focusArea, setFocusArea] = useState<'categories' | 'movies'>('movies');
    const [focusedCategoryIndex, setFocusedCategoryIndex] = useState(0);
    const [focusedMovieIndex, setFocusedMovieIndex] = useState(0);
    const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
    const searchRef = useRef<AnimatedSearchBarHandle>(null);
    const categoryMenuRef = useRef<CategoryMenuHandle>(null);

    // Calculate initial visible count based on screen size
    useEffect(() => {
        const calculateVisibleItems = () => {
            const container = scrollContainerRef.current;
            if (!container) return;

            // Card dimensions (160px min width + 20px gap)
            const cardWidth = 180;
            const cardHeight = 290; // 2:3 aspect ratio (~240px) + title (~50px)

            const containerWidth = container.clientWidth - 32; // minus padding
            const containerHeight = window.innerHeight;

            // Calculate columns and rows that fit on screen + 1 extra row
            const cols = Math.floor(containerWidth / cardWidth);
            const rows = Math.ceil(containerHeight / cardHeight) + 1; // +1 extra row

            const initialCount = cols * rows;
            setVisibleCount(Math.max(initialCount, 12)); // Minimum 12 items
        };

        calculateVisibleItems();
        window.addEventListener('resize', calculateVisibleItems);

        return () => window.removeEventListener('resize', calculateVisibleItems);
    }, [loading]); // Recalculate when loading finishes

    // Fetch data
    useEffect(() => {
        async function fetchData() {
            try {
                setLoading(true);
                const [streamsData, categoriesData] = await Promise.all([
                    api.getVODStreams(),
                    api.getVodCategories()
                ]);
                setStreams(streamsData);
                setCategories(categoriesData);
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'Erro ao carregar filmes');
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    // Filmes concluídos (só relidos quando o toggle liga ou um player fecha —
    // showPlayer é gatilho intencional de refresh, não dependência de dado)
    const completedMovieIds = useMemo(() => {
        return hideWatchedOn ? progressService.getCompletedMovieIds() : null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hideWatchedOn, showPlayer]);

    // Ordenação roda 1x por mudança de modo/dados; o filtro (que roda a cada
    // tecla da busca) preserva a ordem — nunca re-ordenar por tecla
    const sortedStreams = useMemo(() => sortCatalog(streams, sortMode), [streams, sortMode]);

    // Filter streams (memoizado — recalcular a cada tecla do D-pad trava TVs antigas)
    const filteredStreams = useMemo(() => {
        const query = searchQuery.toLowerCase();
        let list = sortedStreams.filter((stream) => {
            const streamName = stream.name || '';
            const matchesSearch = streamName.toLowerCase().includes(query);
            const matchesCategory = selectedCategory === 'all' || stream.category_id === selectedCategory;
            return matchesSearch && matchesCategory;
        });
        if (completedMovieIds) {
            list = list.filter(stream => !completedMovieIds.has(String(stream.stream_id)));
        }
        return list;
    }, [sortedStreams, searchQuery, selectedCategory, completedMovieIds]);

    // Índice focado sempre no range (lista encolhe ao esconder assistidos)
    const safeMovieIndex = Math.min(focusedMovieIndex, Math.max(0, filteredStreams.length - 1));

    // Lazy loading scroll - load one more row when scrolling near bottom
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            // Load more when user scrolls to 80% of the content
            if (scrollTop + clientHeight >= scrollHeight * 0.8 && visibleCount < filteredStreams.length) {
                setVisibleCount(prev => Math.min(prev + 12, filteredStreams.length));
            }
        };

        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, [filteredStreams.length, visibleCount]);

    // Reset on filter change - recalculate visible count
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const cardWidth = 180;
        const cardHeight = 290;
        const containerWidth = container.clientWidth - 32;
        const containerHeight = window.innerHeight;
        const cols = Math.floor(containerWidth / cardWidth);
        const rows = Math.ceil(containerHeight / cardHeight) + 1;

        setVisibleCount(Math.max(cols * rows, 12));
        setSelectedMovie(null);
    }, [searchQuery, selectedCategory]);

    // TV Navigation
    const handleNavigate = (direction: 'up' | 'down' | 'left' | 'right') => {
        if (focusArea === 'categories') {
            // Header: 0 = busca, 1 = categorias, 2 = ordenar, 3 = esconder assistidos
            if (direction === 'left') {
                if (focusedCategoryIndex === 0) {
                    // At search - go to sidebar
                    setFocusZone('sidebar');
                } else {
                    setFocusedCategoryIndex(prev => prev - 1);
                }
            } else if (direction === 'right') {
                setFocusedCategoryIndex(prev => Math.min(3, prev + 1));
            } else if (direction === 'down') {
                setFocusArea('movies');
                setFocusedMovieIndex(0);
            }
        } else if (focusArea === 'movies') {
            const cols = 6;
            const totalMovies = filteredStreams.length;
            const currentCol = focusedMovieIndex % cols;

            if (direction === 'up') {
                if (focusedMovieIndex < cols) {
                    setFocusArea('categories');
                } else {
                    setFocusedMovieIndex(prev => Math.max(0, prev - cols));
                }
            } else if (direction === 'down') {
                setFocusedMovieIndex(prev => {
                    const next = Math.min(totalMovies - 1, prev + cols);
                    // If we're getting close to the visible limit, load more
                    if (next >= visibleCount - 10) {
                        setVisibleCount(current => Math.min(current + cols * 4, totalMovies));
                    }
                    return next;
                });
            } else if (direction === 'left') {
                if (currentCol === 0) {
                    // At first column - go to sidebar
                    setFocusZone('sidebar');
                } else {
                    setFocusedMovieIndex(prev => Math.max(0, prev - 1));
                }
            } else if (direction === 'right') {
                setFocusedMovieIndex(prev => {
                    const next = Math.min(totalMovies - 1, prev + 1);
                    if (next >= visibleCount - 5) {
                        setVisibleCount(current => Math.min(current + cols * 4, totalMovies));
                    }
                    return next;
                });
            }
        }
    };

    // Scroll selected item into view when navigating with TV remote
    useEffect(() => {
        if (focusArea === 'movies' && focusZone === 'content') {
            const container = scrollContainerRef.current;
            const focusedItem = container?.querySelector('.movie-card.tv-focused') as HTMLElement;
            
            if (container && focusedItem) {
                const containerRect = container.getBoundingClientRect();
                const itemRect = focusedItem.getBoundingClientRect();
                
                // If item is below the view
                if (itemRect.bottom > containerRect.bottom) {
                    container.scrollTop += (itemRect.bottom - containerRect.bottom) + 20;
                }
                // If item is above the view
                else if (itemRect.top < containerRect.top) {
                    container.scrollTop -= (containerRect.top - itemRect.top) + 20;
                }
            }
        }
    }, [focusedMovieIndex, focusArea, focusZone]);

    const cycleSort = () => {
        setSortMode(prev => {
            const next = catalogSort.next(prev);
            catalogSort.set('movies', next);
            return next;
        });
    };

    const toggleHideWatched = () => {
        setHideWatchedOn(prev => {
            hideWatched.set(!prev);
            return !prev;
        });
    };

    const handleEnter = () => {
        if (focusArea === 'categories') {
            if (focusedCategoryIndex === 0) {
                searchRef.current?.open();
            } else if (focusedCategoryIndex === 1) {
                categoryMenuRef.current?.open();
            } else if (focusedCategoryIndex === 2) {
                cycleSort();
            } else {
                toggleHideWatched();
            }
        } else if (focusArea === 'movies') {
            const movie = filteredStreams[safeMovieIndex];
            if (movie) {
                setSelectedMovie(movie);
                setShowModal(true);
            }
        }
    };

    // Only enable when content is focused and no modal/player/panel is open
    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        enabled: focusZone === 'content' && !showModal && !showPlayer && !categoryMenuOpen,
    });

    const handleImageError = (streamId: number) => {
        setBrokenImages(prev => new Set(prev).add(streamId));
    };

    // Loading State
    if (loading) {
        return (
            <div className="movies-page">
                <div className="movies-bg-gradient" />
                <div className="movies-loading">
                    <div className="loading-grid">
                        {Array.from({ length: 15 }).map((_, i) => (
                            <div key={i} className="skeleton-card" style={{ animationDelay: `${i * 0.05}s` }}>
                                <div className="skeleton-poster" />
                                <div className="skeleton-title" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // Error State
    if (error) {
        return (
            <div className="movies-error-container">
                <div className="error-glow" />
                <div className="error-content">
                    <div className="error-icon">🎬</div>
                    <h2>Erro ao carregar filmes</h2>
                    <p>{error}</p>
                    <button onClick={() => window.location.reload()} className="retry-button">
                        🔄 Tentar novamente
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="movies-page">
            {/* Dynamic Background */}
            <div className="movies-bg-gradient" />
            {selectedMovie && (selectedMovie.stream_icon || selectedMovie.cover) && (
                <div
                    className="movies-backdrop"
                    style={{ backgroundImage: `url(${selectedMovie.stream_icon || selectedMovie.cover})` }}
                />
            )}

            {/* Animated Search Bar */}
            <AnimatedSearchBar
                ref={searchRef}
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Buscar filmes..."
                tvFocused={focusArea === 'categories' && focusedCategoryIndex === 0}
            />

            {/* Category Menu (Hamburger Button) */}
            <CategoryMenu
                ref={categoryMenuRef}
                categories={categories}
                selectedCategory={selectedCategory}
                onSelectCategory={setSelectedCategory}
                type="vod"
                tvFocused={focusArea === 'categories' && focusedCategoryIndex === 1}
                onOpenChange={setCategoryMenuOpen}
            />

            {/* Toolbar: ordenar + esconder assistidos */}
            <div className="catalog-toolbar">
                <button
                    className={`toolbar-btn ${sortMode !== 'default' ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === 2 ? 'tv-focused' : ''}`}
                    onClick={cycleSort}
                    title="Ordenar"
                >
                    ↕ {SORT_LABELS[sortMode]}
                </button>
                <button
                    className={`toolbar-btn ${hideWatchedOn ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === 3 ? 'tv-focused' : ''}`}
                    onClick={toggleHideWatched}
                    title="Esconder assistidos"
                >
                    🙈
                </button>
            </div>

            {/* Content Detail Modal */}
            {selectedMovie && (
                <ContentDetailModal
                    isOpen={showModal}
                    onClose={() => {
                        setShowModal(false);
                        setSelectedMovie(null);
                    }}
                    contentId={String(selectedMovie.stream_id)}
                    contentType="movie"
                    contentData={{
                        name: selectedMovie.name,
                        cover: selectedMovie.stream_icon || selectedMovie.cover,
                        rating: selectedMovie.rating,
                        plot: selectedMovie.plot,
                        genre: selectedMovie.genre,
                        cast: selectedMovie.cast,
                        director: selectedMovie.director,
                        release_date: selectedMovie.release_date,
                        container_extension: selectedMovie.container_extension,
                    }}
                    onPlay={() => {
                        // Start video playback
                        setPlayingMovie(selectedMovie);
                        setShowPlayer(true);
                        setShowModal(false);
                    }}
                />
            )}

            {/* Video Player (com retomada e progresso salvo) */}
            {showPlayer && playingMovie && (
                <MoviePlayer
                    movieId={String(playingMovie.stream_id)}
                    title={playingMovie.name}
                    poster={playingMovie.stream_icon || playingMovie.cover}
                    container={playingMovie.container_extension}
                    onClose={() => {
                        setShowPlayer(false);
                        setPlayingMovie(null);
                    }}
                />
            )}

            {/* Movies Grid */}
            <div ref={scrollContainerRef} className="movies-content">
                {filteredStreams.length === 0 ? (
                    <div className="no-results">
                        <div className="no-results-icon">🎬</div>
                        <p>Nenhum filme encontrado</p>
                        <span>Tente buscar por outro termo</span>
                    </div>
                ) : (
                    <div className="movies-grid">
                        {filteredStreams.slice(0, visibleCount).map((movie, index) => (
                            <div
                                key={movie.stream_id}
                                className={`movie-card ${focusArea === 'movies' && safeMovieIndex === index ? 'tv-focused' : ''} ${selectedMovie?.stream_id === movie.stream_id ? 'selected' : ''}`}
                                onClick={() => {
                                    setSelectedMovie(movie);
                                    setShowModal(true);
                                }}
                                style={{ animationDelay: `${Math.min(index * 0.03, 0.5)}s` }}
                            >
                                <div className="movie-poster">
                                    {brokenImages.has(movie.stream_id) ? (
                                        <div className="poster-placeholder">🎬</div>
                                    ) : (
                                        <img
                                            src={movie.stream_icon || movie.cover}
                                            alt={movie.name}
                                            loading="lazy"
                                            onError={() => handleImageError(movie.stream_id)}
                                        />
                                    )}
                                    {isRecentlyAdded(movie, nowMs) && (
                                        <div className="new-badge">NOVO</div>
                                    )}
                                    {movie.rating && parseFloat(movie.rating) > 0 && (
                                        <div className="movie-rating">⭐ {movie.rating}</div>
                                    )}
                                </div>
                                <div className="movie-title">{movie?.name || 'Filme Sem Nome'}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer Hints */}
            <div className="movies-hints">
                <span>↑↓←→ Navegar</span>
                <span>OK Selecionar</span>
                <span>← Voltar</span>
            </div>
        </div>
    );
}
