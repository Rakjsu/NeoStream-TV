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
import {
    catalogSort, sortCatalog, hideWatched, isRecentlyAdded, SORT_LABELS, type CatalogSort,
    catalogFilters, matchesFilters, normalizeSearch, fuzzyMatches,
    DECADES, type CatalogFilters,
} from '../services/catalogExtras';
import { groupVodVersions, tagsOf, hasTag, versionLabel, ALL_VOD_TAGS, type VodTag } from '../services/vodVariants';
// versionLabel é usado nos botões de versão da ficha (abaixo)
import { storage } from '../services/storage';
import { kidsFilter } from '../services/kidsFilter';
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
    // playStreamId: id REAL do stream a tocar (versão escolhida); stream_id
    // continua sendo o do grupo, que é a chave de progresso/favoritos
    const [playingMovie, setPlayingMovie] = useState<(VODStream & { playStreamId?: number }) | null>(null);
    const [brokenImages, setBrokenImages] = useState<Set<number>>(new Set());
    const [visibleCount, setVisibleCount] = useState(24); // Start with reasonable default
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Ordenação / esconder assistidos / selo NOVO (Fase 3)
    const [sortMode, setSortMode] = useState<CatalogSort>(() => catalogSort.get('movies'));
    const [hideWatchedOn, setHideWatchedOn] = useState(() => hideWatched.get());
    // R3: chips de tag, filtros, versões agrupadas, menu de contexto
    const [activeTags, setActiveTags] = useState<VodTag[]>([]);
    const [filters, setFilters] = useState<CatalogFilters>(() => catalogFilters.get('movies'));
    const [contextItem, setContextItem] = useState<VODStream | null>(null);
    const [contextIndex, setContextIndex] = useState(0);
    const [toast, setToast] = useState<string | null>(null);
    // Congelado no mount: Date.now() no render viola a pureza do react-hooks
    const [nowMs] = useState(() => Date.now());

    // Focus states for TV navigation
    // 'categories' = zona do header: índice 0 é a busca, 1 é o menu de categorias
    const [focusArea, setFocusArea] = useState<'categories' | 'movies' | 'alphabet'>('movies');
    const [alphabetIndexFocus, setAlphabetIndexFocus] = useState(0);
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
                // Gate do perfil Kids (remove categorias adultas e seus filmes)
                const gated = kidsFilter.apply(streamsData, categoriesData);
                setStreams(gated.items);
                setCategories(gated.categories);
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'Erro ao carregar filmes');
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    useEffect(() => {
        if (!toast) return;
        const timeout = setTimeout(() => setToast(null), 2200);
        return () => clearTimeout(timeout);
    }, [toast]);

    // Filmes concluídos (só relidos quando o toggle liga ou um player fecha —
    // showPlayer é gatilho intencional de refresh, não dependência de dado)
    const completedMovieIds = useMemo(() => {
        return hideWatchedOn ? progressService.getCompletedMovieIds() : null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hideWatchedOn, showPlayer]);

    // ORDEM IMPORTA: filtra PRIMEIRO, agrupa DEPOIS. Agrupar antes fazia o
    // filtro olhar só o representante — o chip DUB escondia o filme inteiro
    // mesmo existindo versão DUB no grupo, e categorias perdiam títulos.
    const matchingStreams = useMemo(() => {
        const query = normalizeSearch(searchQuery);
        const hasFilters = filters.decade > 0 || filters.minRating > 0;
        let list = streams.filter((stream) => {
            const matchesSearch = !query || fuzzyMatches(stream.name || '', query);
            const matchesCategory = selectedCategory === 'all' || stream.category_id === selectedCategory;
            if (!matchesSearch || !matchesCategory) return false;
            // Chips de tag: item precisa ter TODAS as tags marcadas
            if (activeTags.length > 0 && !activeTags.every(tag => hasTag(stream.name || '', tag))) return false;
            if (hasFilters && !matchesFilters(stream, filters)) return false;
            return true;
        });
        if (completedMovieIds) {
            list = list.filter(stream => !completedMovieIds.has(String(stream.stream_id)));
        }
        return list;
    }, [streams, searchQuery, selectedCategory, completedMovieIds, activeTags, filters]);

    // Agrupa versões do mesmo filme (DUB/LEG/4K) sobre a lista JÁ filtrada
    const { groups: groupedStreams, versionsOf } = useMemo(
        () => groupVodVersions(matchingStreams),
        [matchingStreams]
    );

    // Ordenação roda por mudança de modo/dados; o filtro já aconteceu acima
    const filteredStreams = useMemo(
        () => sortCatalog(groupedStreams, sortMode),
        [groupedStreams, sortMode]
    );

    // Barra A-Z (item 23): navegável por D-pad (→ da última coluna entra)
    const alphabetIndex = useMemo(() => {
        if (sortMode !== 'name') return null;
        const map = new Map<string, number>();
        filteredStreams.forEach((stream, index) => {
            const first = normalizeSearch(stream.name || '').charAt(0).toUpperCase();
            const letter = /[A-Z]/.test(first) ? first : '#';
            if (!map.has(letter)) map.set(letter, index);
        });
        return map;
    }, [filteredStreams, sortMode]);

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
            // Header: 0 busca, 1 categorias, 2 ordenar, 3 assistidos, 4 tags, 5 filtros
            if (direction === 'left') {
                if (focusedCategoryIndex === 0) {
                    // At search - go to sidebar
                    setFocusZone('sidebar');
                } else {
                    setFocusedCategoryIndex(prev => prev - 1);
                }
            } else if (direction === 'right') {
                setFocusedCategoryIndex(prev => Math.min(5, prev + 1));
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
                // Última coluna + barra A-Z visível → entra na barra
                if (currentCol === cols - 1 && alphabetIndex && alphabetIndex.size > 1) {
                    setFocusArea('alphabet');
                    setAlphabetIndexFocus(0);
                    return;
                }
                setFocusedMovieIndex(prev => {
                    const next = Math.min(totalMovies - 1, prev + 1);
                    if (next >= visibleCount - 5) {
                        setVisibleCount(current => Math.min(current + cols * 4, totalMovies));
                    }
                    return next;
                });
            }
        } else if (focusArea === 'alphabet') {
            const letters = alphabetIndex ? [...alphabetIndex.keys()] : [];
            if (direction === 'up') setAlphabetIndexFocus(prev => Math.max(0, prev - 1));
            else if (direction === 'down') setAlphabetIndexFocus(prev => Math.min(letters.length - 1, prev + 1));
            else if (direction === 'left') setFocusArea('movies');
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

    // Salto da barra A-Z: garante que o alvo esteja RENDERIZADO antes de focar
    const jumpToIndex = (index: number) => {
        setVisibleCount(current => Math.max(current, Math.min(filteredStreams.length, index + 18)));
        setFocusArea('movies');
        setFocusedMovieIndex(index);
    };

    // Chips de tag (item 22): OK cicla nenhum → DUB → LEG → 4K → HD → nenhum
    const cycleTagFilter = () => {
        setActiveTags(prev => {
            if (prev.length === 0) return ['DUB'];
            const index = ALL_VOD_TAGS.indexOf(prev[0]);
            const next = ALL_VOD_TAGS[index + 1];
            return next && next !== 'H265' ? [next] : [];
        });
    };

    // Filtros (item 32): OK cicla década; ← → ajustam nota mínima
    const cycleFilters = () => {
        setFilters(prev => {
            const index = DECADES.indexOf(prev.decade);
            const next = { ...prev, decade: DECADES[(index + 1) % DECADES.length] };
            catalogFilters.set('movies', next);
            return next;
        });
    };

    // Menu de contexto no card (item 24): 🟡 abre sem entrar na ficha
    const openContextMenu = () => {
        const movie = filteredStreams[safeMovieIndex];
        if (!movie) return;
        setContextItem(movie);
        setContextIndex(0);
    };

    const contextActions = contextItem ? [
        {
            label: storage.isFavorite(String(contextItem.stream_id), 'movie') ? '💔 Remover dos favoritos' : '❤️ Favoritar',
            run: () => {
                const added = storage.toggleFavorite({
                    id: String(contextItem.stream_id),
                    type: 'movie',
                    title: contextItem.name,
                    poster: contextItem.stream_icon || contextItem.cover,
                    rating: contextItem.rating,
                    container: contextItem.container_extension,
                });
                setToast(added ? '❤️ Adicionado aos favoritos' : '💔 Removido dos favoritos');
            },
        },
        {
            label: storage.isInWatchLater(String(contextItem.stream_id), 'movie') ? '➖ Tirar da Minha Lista' : '➕ Minha Lista',
            run: () => {
                const added = storage.toggleWatchLater({
                    id: String(contextItem.stream_id),
                    type: 'movie',
                    title: contextItem.name,
                    poster: contextItem.stream_icon || contextItem.cover,
                    rating: contextItem.rating,
                    container: contextItem.container_extension,
                });
                setToast(added ? '➕ Salvo na Minha Lista' : '➖ Removido da Minha Lista');
            },
        },
        {
            label: '▶ Assistir agora',
            run: () => {
                setPlayingMovie(contextItem);
                setShowPlayer(true);
            },
        },
    ] : [];

    const handleEnter = () => {
        if (focusArea === 'categories') {
            if (focusedCategoryIndex === 0) {
                searchRef.current?.open();
            } else if (focusedCategoryIndex === 1) {
                categoryMenuRef.current?.open();
            } else if (focusedCategoryIndex === 2) {
                cycleSort();
            } else if (focusedCategoryIndex === 3) {
                toggleHideWatched();
            } else if (focusedCategoryIndex === 4) {
                cycleTagFilter();
            } else {
                cycleFilters();
            }
        } else if (focusArea === 'alphabet') {
            const entries = alphabetIndex ? [...alphabetIndex.entries()] : [];
            const entry = entries[alphabetIndexFocus];
            if (entry) jumpToIndex(entry[1]);
        } else if (focusArea === 'movies') {
            const movie = filteredStreams[safeMovieIndex];
            if (movie) {
                setSelectedMovie(movie);
                setShowModal(true);
            }
        }
    };

    // Only enable when content is focused and no modal/player/panel is open
    const navEnabled = focusZone === 'content' && !showModal && !showPlayer && !categoryMenuOpen && !contextItem;

    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        onAction: (action) => {
            if (action === 'yellow' && focusArea === 'movies') openContextMenu();
        },
        enabled: navEnabled,
    });

    // Menu de contexto: navegação própria
    useTVNavigation({
        enabled: !!contextItem,
        onNavigate: (direction) => {
            if (direction === 'up') setContextIndex(prev => Math.max(0, prev - 1));
            else if (direction === 'down') setContextIndex(prev => Math.min(contextActions.length - 1, prev + 1));
        },
        onEnter: () => {
            const action = contextActions[contextIndex];
            if (action) {
                action.run();
                setContextItem(null);
            }
        },
        onBack: () => setContextItem(null),
    });

    // CH+/CH- pulam uma página inteira da grade (item 25)
    useEffect(() => {
        if (!navEnabled || focusArea !== 'movies') return;
        const cols = 6;
        const pageSize = cols * 3;
        const handlePageKeys = (event: KeyboardEvent) => {
            const key = event.key || String(event.keyCode);
            const code = event.keyCode;
            const isUp = key === 'MediaChannelUp' || code === 427 || key === 'PageUp' || code === 33;
            const isDown = key === 'MediaChannelDown' || code === 428 || key === 'PageDown' || code === 34;
            if (!isUp && !isDown) return;
            event.preventDefault();
            setFocusedMovieIndex(prev => {
                const next = isUp
                    ? Math.max(0, prev - pageSize)
                    : Math.min(filteredStreams.length - 1, prev + pageSize);
                if (next >= visibleCount - cols) {
                    setVisibleCount(current => Math.min(current + pageSize, filteredStreams.length));
                }
                return next;
            });
        };
        window.addEventListener('keydown', handlePageKeys);
        return () => window.removeEventListener('keydown', handlePageKeys);
    }, [navEnabled, focusArea, filteredStreams.length, visibleCount]);

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
                <button
                    className={`toolbar-btn ${activeTags.length > 0 ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === 4 ? 'tv-focused' : ''}`}
                    onClick={cycleTagFilter}
                    title="Filtrar por Dublado/Legendado/qualidade"
                >
                    {activeTags.length > 0 ? activeTags.join('+') : '🏷 Tags'}
                </button>
                <button
                    className={`toolbar-btn ${filters.decade > 0 || filters.minRating > 0 ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === 5 ? 'tv-focused' : ''}`}
                    onClick={cycleFilters}
                    title="Filtrar por década"
                >
                    {filters.decade > 0 ? `${filters.decade}s` : '📅 Década'}
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
                        runtime: selectedMovie.episode_run_time,
                        tmdbId: selectedMovie.tmdb_id,
                    }}
                    onPlay={() => {
                        // Start video playback
                        setPlayingMovie(selectedMovie);
                        setShowPlayer(true);
                        setShowModal(false);
                    }}
                    versions={(versionsOf.get(String(selectedMovie.stream_id)) || []).map(v => ({
                        id: String(v.stream_id),
                        label: versionLabel(v.name),
                    }))}
                    onSelectVersion={(versionId) => {
                        const version = (versionsOf.get(String(selectedMovie.stream_id)) || [])
                            .find(v => String(v.stream_id) === versionId);
                        if (version) {
                            // O progresso é do GRUPO (id do representante):
                            // trocar de versão não pode zerar o "continuar
                            // assistindo" nem o hide-watched do card
                            setPlayingMovie({
                                ...version,
                                stream_id: selectedMovie.stream_id,
                                playStreamId: Number(version.stream_id),
                            });
                            setShowPlayer(true);
                            setShowModal(false);
                        }
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
                    streamId={playingMovie.playStreamId ?? playingMovie.stream_id}
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
                                    {(versionsOf.get(String(movie.stream_id))?.length ?? 0) > 1 && (
                                        <div className="version-badge">
                                            {versionsOf.get(String(movie.stream_id))!.length} versões
                                        </div>
                                    )}
                                    {tagsOf(movie.name || '').filter(t => t !== 'H265').length > 0 && (
                                        <div className="tag-badge">
                                            {tagsOf(movie.name || '').filter(t => t !== 'H265').slice(0, 2).join(' ')}
                                        </div>
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

            {/* Barra A-Z (só com ordenação por nome) */}
            {alphabetIndex && alphabetIndex.size > 1 && (
                <div className="alphabet-bar">
                    {[...alphabetIndex.entries()].map(([letter, index], position) => (
                        <button
                            key={letter}
                            className={`alphabet-letter ${focusArea === 'alphabet' && alphabetIndexFocus === position ? 'tv-focused' : ''}`}
                            onClick={() => jumpToIndex(index)}
                        >
                            {letter}
                        </button>
                    ))}
                </div>
            )}

            {toast && <div className="catalog-toast">{toast}</div>}

            {/* Menu de contexto do card (item 24) */}
            {contextItem && (
                <div className="context-overlay" onClick={() => setContextItem(null)}>
                    <div className="context-menu" onClick={(e) => e.stopPropagation()}>
                        <div className="context-title">{contextItem.name}</div>
                        {contextActions.map((action, index) => (
                            <div
                                key={action.label}
                                className={`context-item ${contextIndex === index ? 'tv-focused' : ''}`}
                                onClick={() => {
                                    action.run();
                                    setContextItem(null);
                                }}
                            >
                                {action.label}
                            </div>
                        ))}
                        <div className="context-hint">↑↓ Navegar · OK Executar · ← Fechar</div>
                    </div>
                </div>
            )}

            {/* Footer Hints */}
            <div className="movies-hints">
                <span>↑↓←→ Navegar</span>
                <span>OK Selecionar</span>
                <span>← Voltar</span>
                <span>🟡 Ações</span>
                <span>CH± Página</span>
            </div>
        </div>
    );
}
