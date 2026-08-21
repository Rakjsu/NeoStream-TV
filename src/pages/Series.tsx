// Series Page - Matching NeoStream Desktop Style

import { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../services/api';
import type { Series as SeriesType, Category } from '../types';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useFocusZone } from '../contexts/FocusContext';
import { CategoryMenu, type CategoryMenuHandle } from '../components/CategoryMenu';
import { AnimatedSearchBar, type AnimatedSearchBarHandle } from '../components/AnimatedSearchBar';
import { ContentDetailModal } from '../components/ContentDetailModal';
import { SeriesQueuePlayer } from '../components/SeriesQueuePlayer';
import { buildEpisodeQueue, type EpisodeQueue } from '../services/seriesPlayback';
import {
    catalogSort, sortCatalog, hideWatched, isRecentlyAdded, newEpisodes, SORT_LABELS, type CatalogSort,
    catalogFilters, matchesFilters, normalizeSearch, fuzzyMatches, DECADES, type CatalogFilters,
} from '../services/catalogExtras';
import { kidsFilter } from '../services/kidsFilter';
import { progressService } from '../services/progressService';
import { storage } from '../services/storage';
import './Series.css';
import { ErrorScreen } from '../components/ErrorScreen';

export function Series() {
    const { focusZone, setFocusZone } = useFocusZone();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [series, setSeries] = useState<SeriesType[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedSeries, setSelectedSeries] = useState<SeriesType | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [seriesQueue, setSeriesQueue] = useState<EpisodeQueue | null>(null);
    const [brokenImages, setBrokenImages] = useState<Set<number>>(new Set());
    const [visibleCount, setVisibleCount] = useState(24); // Start with reasonable default
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Ordenação / esconder assistidos / selo NOVO / novos episódios (Fase 3)
    const [sortMode, setSortMode] = useState<CatalogSort>(() => catalogSort.get('series'));
    const [hideWatchedOn, setHideWatchedOn] = useState(() => hideWatched.get());
    const [newEpisodesTick, setNewEpisodesTick] = useState(0);
    // R3: filtros, menu de contexto, toast
    const [filters, setFilters] = useState<CatalogFilters>(() => catalogFilters.get('series'));
    const [contextItem, setContextItem] = useState<SeriesType | null>(null);
    const [contextIndex, setContextIndex] = useState(0);
    const [toast, setToast] = useState<string | null>(null);
    // Congelado no mount: Date.now() no render viola a pureza do react-hooks
    const [nowMs] = useState(() => Date.now());

    // Focus states for TV navigation
    // 'categories' = zona do header: índice 0 é a busca, 1 é o menu de categorias
    const [focusArea, setFocusArea] = useState<'categories' | 'series'>('series');
    const [focusedCategoryIndex, setFocusedCategoryIndex] = useState(0);
    const [focusedSeriesIndex, setFocusedSeriesIndex] = useState(0);
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
                const [seriesData, categoriesData] = await Promise.all([
                    api.getSeries(),
                    api.getSeriesCategories()
                ]);
                // Gate do perfil Kids (remove categorias adultas e suas séries)
                const gated = kidsFilter.apply(seriesData, categoriesData);
                setSeries(gated.items);
                setCategories(gated.categories);
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'Erro ao carregar s�ries');
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    // Séries seguidas (favoritas ou com progresso) — pra badge de novos episódios
    const followedSeriesIds = useMemo(() => {
        const followed = progressService.getSeriesIdsWithProgress();
        for (const fav of storage.getFavorites()) {
            if (fav.type === 'series') followed.add(fav.id);
        }
        return followed;
        // newEpisodesTick força recomputo após markSeen
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [newEpisodesTick]);

    // Semeia o baseline de last_modified das séries seguidas (1x por carga)
    useEffect(() => {
        if (series.length === 0) return;
        newEpisodes.seed(
            series
                .filter(s => followedSeriesIds.has(String(s.series_id)))
                .map(s => ({ seriesId: String(s.series_id), lastModified: s.last_modified || '0' }))
        );
    }, [series, followedSeriesIds]);

    useEffect(() => {
        if (!toast) return;
        const timeout = setTimeout(() => setToast(null), 2200);
        return () => clearTimeout(timeout);
    }, [toast]);

    // Séries terminadas (só relidas quando o toggle liga ou o player fecha —
    // seriesQueue é gatilho intencional de refresh, não dependência de dado)
    const finishedSeriesIds = useMemo(() => {
        return hideWatchedOn ? progressService.getFinishedSeriesIds() : null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hideWatchedOn, seriesQueue]);

    // Ordenação roda 1x por mudança de modo/dados; o filtro (que roda a cada
    // tecla da busca) preserva a ordem — nunca re-ordenar por tecla
    const sortedSeries = useMemo(() => sortCatalog(series, sortMode), [series, sortMode]);

    // Filter series (memoizado — recalcular a cada tecla do D-pad trava TVs antigas)
    const filteredSeries = useMemo(() => {
        const query = normalizeSearch(searchQuery);
        const hasFilters = filters.decade > 0 || filters.minRating > 0;
        let list = sortedSeries.filter((s) => {
            const matchesSearch = !query || fuzzyMatches(s.name || '', query);
            const matchesCategory = selectedCategory === 'all' || s.category_id === selectedCategory;
            if (!matchesSearch || !matchesCategory) return false;
            if (hasFilters && !matchesFilters(s, filters)) return false;
            return true;
        });
        if (finishedSeriesIds) {
            // Série terminada que ganhou episódios NOVOS não se esconde —
            // é justamente o caso em que ela voltou a ter conteúdo não visto
            list = list.filter(s =>
                !finishedSeriesIds.has(String(s.series_id)) ||
                newEpisodes.has(String(s.series_id), s.last_modified || '0')
            );
        }
        return list;
    }, [sortedSeries, searchQuery, selectedCategory, finishedSeriesIds, filters]);

    // Índice focado sempre no range (lista encolhe ao esconder assistidos)
    const safeSeriesIndex = Math.min(focusedSeriesIndex, Math.max(0, filteredSeries.length - 1));

    // Lazy loading scroll - load one more row when scrolling near bottom
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            // Load more when user scrolls to 80% of the content
            if (scrollTop + clientHeight >= scrollHeight * 0.8 && visibleCount < filteredSeries.length) {
                setVisibleCount(prev => Math.min(prev + 12, filteredSeries.length));
            }
        };

        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, [filteredSeries.length, visibleCount]);

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
        setSelectedSeries(null);
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
                setFocusedCategoryIndex(prev => Math.min(4, prev + 1));
            } else if (direction === 'down') {
                setFocusArea('series');
                setFocusedSeriesIndex(0);
            }
        } else if (focusArea === 'series') {
            const cols = 6;
            const totalSeries = filteredSeries.length;
            const currentCol = focusedSeriesIndex % cols;

            if (direction === 'up') {
                if (focusedSeriesIndex < cols) {
                    setFocusArea('categories');
                } else {
                    setFocusedSeriesIndex(prev => Math.max(0, prev - cols));
                }
            } else if (direction === 'down') {
                setFocusedSeriesIndex(prev => {
                    const next = Math.min(totalSeries - 1, prev + cols);
                    // If we're getting close to the visible limit, load more
                    if (next >= visibleCount - 10) {
                        setVisibleCount(current => Math.min(current + cols * 4, totalSeries));
                    }
                    return next;
                });
            } else if (direction === 'left') {
                if (currentCol === 0) {
                    // At first column - go to sidebar
                    setFocusZone('sidebar');
                } else {
                    setFocusedSeriesIndex(prev => Math.max(0, prev - 1));
                }
            } else if (direction === 'right') {
                setFocusedSeriesIndex(prev => {
                    const next = Math.min(totalSeries - 1, prev + 1);
                    if (next >= visibleCount - 5) {
                        setVisibleCount(current => Math.min(current + cols * 4, totalSeries));
                    }
                    return next;
                });
            }
        }
    };

    // Scroll selected item into view when navigating with TV remote
    useEffect(() => {
        if (focusArea === 'series' && focusZone === 'content') {
            const container = scrollContainerRef.current;
            const focusedItem = container?.querySelector('.series-card.tv-focused') as HTMLElement;
            
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
    }, [focusedSeriesIndex, focusArea, focusZone]);

    const cycleSort = () => {
        setSortMode(prev => {
            const next = catalogSort.next(prev);
            catalogSort.set('series', next);
            return next;
        });
    };

    const toggleHideWatched = () => {
        setHideWatchedOn(prev => {
            hideWatched.set(!prev);
            return !prev;
        });
    };

    const cycleFilters = () => {
        setFilters(prev => {
            const index = DECADES.indexOf(prev.decade);
            const next = { ...prev, decade: DECADES[(index + 1) % DECADES.length] };
            catalogFilters.set('series', next);
            return next;
        });
    };

    // Menu de contexto no card (item 24)
    const openContextMenu = () => {
        const item = filteredSeries[safeSeriesIndex];
        if (!item) return;
        setContextItem(item);
        setContextIndex(0);
    };

    const contextActions = contextItem ? [
        {
            label: storage.isFavorite(String(contextItem.series_id), 'series') ? '💔 Remover dos favoritos' : '❤️ Favoritar',
            run: () => {
                const added = storage.toggleFavorite({
                    id: String(contextItem.series_id),
                    type: 'series',
                    title: contextItem.name,
                    poster: contextItem.cover,
                    rating: contextItem.rating,
                });
                setToast(added ? '❤️ Adicionado aos favoritos' : '💔 Removido dos favoritos');
            },
        },
        {
            label: storage.isInWatchLater(String(contextItem.series_id), 'series') ? '➖ Tirar da Minha Lista' : '➕ Minha Lista',
            run: () => {
                const added = storage.toggleWatchLater({
                    id: String(contextItem.series_id),
                    type: 'series',
                    title: contextItem.name,
                    poster: contextItem.cover,
                    rating: contextItem.rating,
                });
                setToast(added ? '➕ Salvo na Minha Lista' : '➖ Removido da Minha Lista');
            },
        },
    ] : [];

    const openSeriesModal = (item: SeriesType) => {
        setSelectedSeries(item);
        setShowModal(true);
        // Abrir a ficha "vê" os episódios novos — atualiza o baseline
        newEpisodes.markSeen(String(item.series_id), item.last_modified || '0');
        setNewEpisodesTick(t => t + 1);
    };

    const handleEnter = (fromInput?: boolean) => {
        // OK vindo de dentro do campo de busca já fechou o teclado; reabrir
        // aqui faria o IME do Tizen piscar sem parar
        if (fromInput) return;
        if (focusArea === 'categories') {
            if (focusedCategoryIndex === 0) {
                searchRef.current?.open();
            } else if (focusedCategoryIndex === 1) {
                categoryMenuRef.current?.open();
            } else if (focusedCategoryIndex === 2) {
                cycleSort();
            } else if (focusedCategoryIndex === 3) {
                toggleHideWatched();
            } else {
                cycleFilters();
            }
        } else if (focusArea === 'series') {
            const item = filteredSeries[safeSeriesIndex];
            if (item) openSeriesModal(item);
        }
    };

    // Only enable when content is focused and no modal/player/panel is open
    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        onAction: (action) => {
            if (action === 'yellow' && focusArea === 'series') openContextMenu();
        },
        enabled: focusZone === 'content' && !error && !showModal && !seriesQueue && !categoryMenuOpen && !contextItem,
    });

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
        onBack: () => {
            // Voltar sobe um degrau: primeiro fecha o que estiver aberto por
            // cima, depois devolve o foco pra sidebar (de lá, Voltar vai pra
            // Home e só então pede pra sair).
            if (contextItem) {
                setContextItem(null);
                return;
            }
            setFocusZone('sidebar');
        },
    });

    const handleImageError = (seriesId: number) => {
        setBrokenImages(prev => new Set(prev).add(seriesId));
    };

    // Loading State
    if (loading) {
        return (
            <div className="series-page">
                <div className="series-bg-gradient" />
                <div className="series-loading">
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
            <ErrorScreen
                icon="📺"
                title="Erro ao carregar séries"
                message={error}
                className="series-error-container"
            />
        );
    }

    return (
        <div className="series-page">
            {/* Dynamic Background */}
            <div className="series-bg-gradient" />
            {selectedSeries && selectedSeries.cover && (
                <div
                    className="series-backdrop"
                    style={{ backgroundImage: `url(${selectedSeries.cover})` }}
                />
            )}

            {/* Animated Search Bar */}
            <AnimatedSearchBar
                ref={searchRef}
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Buscar séries..."
                tvFocused={focusArea === 'categories' && focusedCategoryIndex === 0}
            />

            {/* Category Menu (Hamburger Button) */}
            <CategoryMenu
                ref={categoryMenuRef}
                categories={categories}
                selectedCategory={selectedCategory}
                onSelectCategory={setSelectedCategory}
                type="series"
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
                    className={`toolbar-btn ${filters.decade > 0 ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === 4 ? 'tv-focused' : ''}`}
                    onClick={cycleFilters}
                    title="Filtrar por década"
                >
                    {filters.decade > 0 ? `${filters.decade}s` : '📅 Década'}
                </button>
            </div>

            {/* Content Detail Modal */}
            {selectedSeries && (
                <ContentDetailModal
                    isOpen={showModal}
                    onClose={() => {
                        setShowModal(false);
                        setSelectedSeries(null);
                    }}
                    contentId={String(selectedSeries.series_id)}
                    contentType="series"
                    contentData={{
                        name: selectedSeries.name,
                        cover: selectedSeries.cover,
                        rating: selectedSeries.rating,
                        plot: selectedSeries.plot,
                        genre: selectedSeries.genre,
                        cast: selectedSeries.cast,
                        director: selectedSeries.director,
                        release_date: selectedSeries.release_date,
                        runtime: selectedSeries.episode_run_time,
                        tmdbId: selectedSeries.tmdb_id,
                    }}
                    onPlay={async (season, episode) => {
                        // Monta a fila de episódios (habilita próximo/anterior + resume)
                        try {
                            const queue = await buildEpisodeQueue(
                                selectedSeries.series_id,
                                selectedSeries.name,
                                selectedSeries.cover,
                                season,
                                episode
                            );
                            if (queue) setSeriesQueue(queue);
                        } catch (err) {
                            console.error('Error getting episode info:', err);
                        }
                        setShowModal(false);
                    }}
                />
            )}

            {/* Video Player (fila de episódios + retomada + progresso) */}
            {seriesQueue && (
                <SeriesQueuePlayer
                    queue={seriesQueue}
                    onClose={() => setSeriesQueue(null)}
                />
            )}

            {/* Series Grid */}
            <div ref={scrollContainerRef} className="series-content">
                {filteredSeries.length === 0 ? (
                    <div className="no-results">
                        <div className="no-results-icon">📺</div>
                        <p>Nenhuma série encontrada</p>
                        <span>Tente buscar por outro termo</span>
                    </div>
                ) : (
                    <div className="series-grid">
                        {filteredSeries.slice(0, visibleCount).map((item, index) => (
                            <div
                                key={item.series_id}
                                className={`series-card ${focusArea === 'series' && safeSeriesIndex === index ? 'tv-focused' : ''} ${selectedSeries?.series_id === item.series_id ? 'selected' : ''}`}
                                onClick={() => openSeriesModal(item)}
                                style={{ animationDelay: `${Math.min(index * 0.03, 0.5)}s` }}
                            >
                                <div className="series-poster">
                                    {brokenImages.has(item.series_id) ? (
                                        <div className="poster-placeholder">📺</div>
                                    ) : (
                                        <img decoding="async"
                                            src={item.cover}
                                            alt={item.name}
                                            loading="lazy"
                                            onError={() => handleImageError(item.series_id)}
                                        />
                                    )}
                                    {followedSeriesIds.has(String(item.series_id)) &&
                                        newEpisodes.has(String(item.series_id), item.last_modified || '0') ? (
                                        <div className="new-badge new-badge-episodes">NOVOS EPS</div>
                                    ) : isRecentlyAdded(item, nowMs) && (
                                        <div className="new-badge">NOVO</div>
                                    )}
                                    {item.rating && parseFloat(item.rating) > 0 && (
                                        <div className="series-rating">⭐ {item.rating}</div>
                                    )}
                                </div>
                                <div className="series-title">{item?.name || 'Série Sem Nome'}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {toast && <div className="catalog-toast">{toast}</div>}

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
            <div className="series-hints">
                <span>↑↓←→ Navegar</span>
                <span>OK Selecionar</span>
                <span>← Voltar</span>
                <span>🟡 Ações</span>
            </div>
        </div>
    );
}
