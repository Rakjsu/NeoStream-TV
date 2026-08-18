// LiveTV Page - Matching NeoStream Desktop Style
// Paridade com o desktop: EPG (get_short_epg), zapping (CH±/dígitos/overlay),
// variantes de qualidade agrupadas, ⭐ favoritos, 🙈 ocultar, 📅 só-EPG,
// 🎲 aleatório e retomada do último canal.
// Color keys: 🔴 só-EPG · 🟢 aleatório · 🟡 favorito · 🔵 ocultar

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { api } from '../services/api';
import { storage } from '../services/storage';
import { epgService, type ChannelEpg } from '../services/epgService';
import { zapHistory, hiddenChannels, liveToggles } from '../services/liveExtras';
import { groupChannelVariants, qualityLabel } from '../services/channelVariants';
import type { LiveStream, Category } from '../types';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useFocusZone } from '../contexts/FocusContext';
import { CategoryMenu, type CategoryMenuHandle } from '../components/CategoryMenu';
import { AnimatedSearchBar, type AnimatedSearchBarHandle } from '../components/AnimatedSearchBar';
import { VideoPlayer, type PlayerChannel } from '../components/VideoPlayer';
import './LiveTV.css';

function formatClock(ms: number): string {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function LiveTV() {
    const { focusZone, setFocusZone } = useFocusZone();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [streams, setStreams] = useState<LiveStream[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedChannel, setSelectedChannel] = useState<LiveStream | null>(null);
    const [playingChannel, setPlayingChannel] = useState<LiveStream | null>(null);
    const [brokenImages, setBrokenImages] = useState<Set<number>>(new Set());
    const [visibleCount, setVisibleCount] = useState(24);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Filtros/toggles persistidos
    const [onlyWithEpg, setOnlyWithEpg] = useState(() => liveToggles.getOnlyWithEpg());
    const [groupVariantsOn, setGroupVariantsOn] = useState(() => liveToggles.getGroupVariants());
    const [hiddenIds, setHiddenIds] = useState<Set<number>>(() => hiddenChannels.get());
    const [showOnlyHidden, setShowOnlyHidden] = useState(false);
    const [favTick, setFavTick] = useState(0);

    // EPG
    const [previewEpg, setPreviewEpg] = useState<ChannelEpg | null>(null);
    const [playerEpg, setPlayerEpg] = useState<ChannelEpg | null>(null);

    // Focus states for TV navigation
    // 'categories' = zona do header: índice 0 é a busca, 1 é o menu de categorias
    // 'preview' = botões da ficha do canal (Assistir/⭐/🙈/variantes)
    const [focusArea, setFocusArea] = useState<'categories' | 'channels' | 'preview'>('channels');
    const [focusedCategoryIndex, setFocusedCategoryIndex] = useState(0);
    const [focusedChannelIndex, setFocusedChannelIndex] = useState(0);
    const [previewFocusIndex, setPreviewFocusIndex] = useState(0);
    const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
    const searchRef = useRef<AnimatedSearchBarHandle>(null);
    const categoryMenuRef = useRef<CategoryMenuHandle>(null);

    // Calculate initial visible count based on screen size
    useEffect(() => {
        const calculateVisibleItems = () => {
            const container = scrollContainerRef.current;
            if (!container) return;

            // Card dimensions
            const cardWidth = 220; // larger for live tv
            const cardHeight = 80;

            const containerWidth = container.clientWidth - 32;
            const containerHeight = window.innerHeight;

            const cols = Math.floor(containerWidth / cardWidth);
            const rows = Math.ceil(containerHeight / cardHeight) + 1;

            const initialCount = cols * rows;
            setVisibleCount(Math.max(initialCount, 15));
        };

        calculateVisibleItems();
        window.addEventListener('resize', calculateVisibleItems);

        return () => window.removeEventListener('resize', calculateVisibleItems);
    }, [loading]);

    // Reset on filter change
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const cardWidth = 220;
        const cardHeight = 80;
        const containerWidth = container.clientWidth - 32;
        const containerHeight = window.innerHeight;
        const cols = Math.floor(containerWidth / cardWidth);
        const rows = Math.ceil(containerHeight / cardHeight) + 1;

        setVisibleCount(Math.max(cols * rows, 15));
        setSelectedChannel(null);
        setFocusedChannelIndex(0);
        setFocusArea(prev => (prev === 'preview' ? 'channels' : prev));
    }, [searchQuery, selectedCategory, onlyWithEpg, showOnlyHidden]);

    // Fetch data
    useEffect(() => {
        async function fetchData() {
            try {
                setLoading(true);
                const [streamsData, categoriesData] = await Promise.all([
                    api.getLiveStreams(),
                    api.getLiveCategories()
                ]);
                setStreams(streamsData);
                setCategories(categoriesData);

                // Retomar o último canal assistido (só pré-seleciona, não dá play)
                const lastId = storage.getLastChannel();
                if (lastId) {
                    const found = streamsData.find(s => s.stream_id === lastId);
                    if (found) setSelectedChannel(found);
                }
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'Erro ao carregar canais');
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    // Canais favoritos (categoria virtual FAVORITES)
    const favoriteChannelIds = useMemo(() => {
        return new Set(
            storage.getFavorites()
                .filter(f => f.type === 'channel')
                .map(f => Number(f.id))
        );
        // favTick força recomputo após toggle
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [favTick]);

    // Cadeia de filtros (memoizada — lista pode ter milhares de canais)
    const processedStreams = useMemo(() => {
        let list = streams;

        if (showOnlyHidden) {
            list = list.filter(s => hiddenIds.has(s.stream_id));
        } else if (hiddenIds.size > 0) {
            list = list.filter(s => !hiddenIds.has(s.stream_id));
        }

        if (onlyWithEpg) {
            list = list.filter(s => !!s.epg_channel_id);
        }

        if (selectedCategory === 'FAVORITES') {
            list = list.filter(s => favoriteChannelIds.has(s.stream_id));
        } else if (selectedCategory !== 'all') {
            list = list.filter(s => s.category_id === selectedCategory);
        }

        const query = searchQuery.toLowerCase();
        if (query) {
            list = list.filter(s => (s.name || '').toLowerCase().includes(query));
        }

        return list;
    }, [streams, hiddenIds, showOnlyHidden, onlyWithEpg, selectedCategory, favoriteChannelIds, searchQuery]);

    // Agrupamento de variantes FHD/HD/SD (port do desktop)
    const { groups: filteredStreams, variantsOf } = useMemo(() => {
        if (!groupVariantsOn) {
            return { groups: processedStreams, variantsOf: new Map<string, LiveStream[]>() };
        }
        return groupChannelVariants(processedStreams);
    }, [processedStreams, groupVariantsOn]);

    // Lista de canais pro player (zapping)
    const playerChannelList = useMemo<PlayerChannel[]>(
        () => filteredStreams.map(s => ({
            stream_id: s.stream_id,
            name: s.name,
            num: s.num,
            stream_icon: s.stream_icon,
        })),
        [filteredStreams]
    );

    // Variante tocando → representante do grupo (senão o CH± e o overlay
    // do player não acham o canal atual na lista agrupada)
    const representativeOf = useMemo(() => {
        const map = new Map<number, number>();
        for (const [repId, variants] of variantsOf) {
            for (const variant of variants) {
                map.set(variant.stream_id, Number(repId));
            }
        }
        return map;
    }, [variantsOf]);

    const playerCurrentChannelId = playingChannel
        ? (representativeOf.get(playingChannel.stream_id) ?? playingChannel.stream_id)
        : undefined;

    // Índice focado sempre dentro do range (a lista encolhe ao ocultar/
    // desfavoritar/agrupar sem passar pelo effect de reset)
    const safeChannelIndex = Math.min(focusedChannelIndex, Math.max(0, filteredStreams.length - 1));

    // Variantes de qualidade do canal selecionado (botões da ficha)
    const selectedVariants = selectedChannel
        ? variantsOf.get(String(selectedChannel.stream_id)) || []
        : [];

    // Lazy loading scroll
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            if (scrollTop + clientHeight >= scrollHeight * 0.8 && visibleCount < filteredStreams.length) {
                setVisibleCount(prev => Math.min(prev + 12, filteredStreams.length));
            }
        };

        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, [filteredStreams.length, visibleCount]);

    // EPG da ficha do canal selecionado
    useEffect(() => {
        if (!selectedChannel) {
            setPreviewEpg(null);
            return;
        }
        let cancelled = false;
        epgService.getChannelEpg(selectedChannel.stream_id).then(epg => {
            if (!cancelled) setPreviewEpg(epg);
        });
        return () => { cancelled = true; };
    }, [selectedChannel]);

    // EPG do canal tocando (mini-EPG do player, atualiza a cada 60s)
    useEffect(() => {
        if (!playingChannel) {
            setPlayerEpg(null);
            return;
        }
        let cancelled = false;
        const load = () => {
            epgService.getChannelEpg(playingChannel.stream_id).then(epg => {
                if (!cancelled) setPlayerEpg(epg);
            });
        };
        load();
        const interval = setInterval(load, 60000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [playingChannel]);

    // Reproduzir canal (registra último canal + histórico de zapping)
    const playChannel = useCallback((stream: LiveStream) => {
        setSelectedChannel(stream);
        setPlayingChannel(stream);
        storage.setLastChannel(stream.stream_id);
        zapHistory.push(stream.stream_id);
    }, []);

    // Zapping vindo do player (CH±, dígitos, overlay)
    const handleSwitchChannel = useCallback((streamId: number) => {
        const found = streams.find(s => s.stream_id === streamId);
        if (found) playChannel(found);
    }, [streams, playChannel]);

    // Ações dos atalhos coloridos
    const toggleChannelFavorite = useCallback((stream: LiveStream) => {
        storage.toggleFavorite({
            id: String(stream.stream_id),
            type: 'channel',
            title: stream.name,
            poster: stream.stream_icon || undefined,
        });
        setFavTick(t => t + 1);
    }, []);

    const toggleChannelHidden = useCallback((stream: LiveStream) => {
        setHiddenIds(new Set(hiddenChannels.toggle(stream.stream_id)));
    }, []);

    const randomZap = useCallback(() => {
        const pool = filteredStreams.filter(s => s.stream_id !== playingChannel?.stream_id);
        if (pool.length === 0) return;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        playChannel(pick);
    }, [filteredStreams, playingChannel, playChannel]);

    const toggleOnlyEpg = useCallback(() => {
        setOnlyWithEpg(prev => {
            liveToggles.setOnlyWithEpg(!prev);
            return !prev;
        });
    }, []);

    const toggleGroupVariants = useCallback(() => {
        setGroupVariantsOn(prev => {
            liveToggles.setGroupVariants(!prev);
            return !prev;
        });
    }, []);

    // TV Navigation
    const handleNavigate = (direction: 'up' | 'down' | 'left' | 'right') => {
        if (focusArea === 'categories') {
            // Header: 0 = busca, 1 = menu de categorias
            if (direction === 'left') {
                if (focusedCategoryIndex === 0) {
                    setFocusZone('sidebar');
                } else {
                    setFocusedCategoryIndex(0);
                }
            } else if (direction === 'right') {
                setFocusedCategoryIndex(1);
            } else if (direction === 'down') {
                setFocusArea('channels');
                setFocusedChannelIndex(0);
            }
        } else if (focusArea === 'preview') {
            const totalPreviewItems = 3 + selectedVariants.length;
            if (direction === 'left') {
                setPreviewFocusIndex(prev => Math.max(0, prev - 1));
            } else if (direction === 'right') {
                setPreviewFocusIndex(prev => Math.min(totalPreviewItems - 1, prev + 1));
            } else if (direction === 'down' || direction === 'up') {
                setFocusArea('channels');
            }
        } else if (focusArea === 'channels') {
            const cols = 6;
            const totalChannels = filteredStreams.length;
            const currentCol = focusedChannelIndex % cols;

            if (direction === 'up') {
                if (focusedChannelIndex < cols) {
                    setFocusArea('categories');
                } else {
                    setFocusedChannelIndex(prev => Math.max(0, prev - cols));
                }
            } else if (direction === 'down') {
                setFocusedChannelIndex(prev => {
                    const next = Math.min(totalChannels - 1, prev + cols);
                    if (next >= visibleCount - 6) {
                        setVisibleCount(current => Math.min(current + cols * 4, totalChannels));
                    }
                    return next;
                });
            } else if (direction === 'left') {
                if (currentCol === 0) {
                    setFocusZone('sidebar');
                } else {
                    setFocusedChannelIndex(prev => Math.max(0, prev - 1));
                }
            } else if (direction === 'right') {
                setFocusedChannelIndex(prev => {
                    const next = Math.min(totalChannels - 1, prev + 1);
                    if (next >= visibleCount - 3) {
                        setVisibleCount(current => Math.min(current + cols * 4, totalChannels));
                    }
                    return next;
                });
            }
        }
    };

    // Scroll selected item into view securely
    useEffect(() => {
        if (focusArea === 'channels') {
            const container = scrollContainerRef.current;
            const focusedItem = container?.querySelector('.channel-card.tv-focused') as HTMLElement;

            if (container && focusedItem) {
                const containerRect = container.getBoundingClientRect();
                const itemRect = focusedItem.getBoundingClientRect();

                // Keep some padding for smooth view
                if (itemRect.bottom > containerRect.bottom) {
                    container.scrollTop += (itemRect.bottom - containerRect.bottom) + 80;
                } else if (itemRect.top < containerRect.top) {
                    container.scrollTop -= (containerRect.top - itemRect.top) + 80;
                }
            }
        }
    }, [focusedChannelIndex, focusArea]);

    const handleEnter = () => {
        if (focusArea === 'categories') {
            if (focusedCategoryIndex === 0) {
                searchRef.current?.open();
            } else {
                categoryMenuRef.current?.open();
            }
        } else if (focusArea === 'preview') {
            if (!selectedChannel) return;
            if (previewFocusIndex === 0) {
                playChannel(selectedChannel);
            } else if (previewFocusIndex === 1) {
                toggleChannelFavorite(selectedChannel);
            } else if (previewFocusIndex === 2) {
                toggleChannelHidden(selectedChannel);
            } else {
                const variant = selectedVariants[previewFocusIndex - 3];
                if (variant) playChannel(variant);
            }
        } else if (focusArea === 'channels') {
            const channel = filteredStreams[safeChannelIndex];
            if (channel) {
                // 1º OK abre a ficha com foco no "Assistir"; 2º OK dá play
                setSelectedChannel(channel);
                setFocusArea('preview');
                setPreviewFocusIndex(0);
            }
        }
    };

    const handleBack = () => {
        if (focusArea === 'preview' || selectedChannel) {
            setSelectedChannel(null);
            setFocusArea('channels');
        }
    };

    // Color keys: 🔴 só-EPG · 🟢 aleatório · 🟡 favorito · 🔵 ocultar
    const handleAction = (action: string) => {
        if (action === 'red') {
            toggleOnlyEpg();
        } else if (action === 'green') {
            randomZap();
        } else if (action === 'yellow' || action === 'blue') {
            const channel = (focusArea === 'channels' && filteredStreams[safeChannelIndex]) || selectedChannel;
            if (channel) {
                if (action === 'yellow') toggleChannelFavorite(channel);
                else toggleChannelHidden(channel);
            }
        }
    };

    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        onBack: handleBack,
        onAction: handleAction,
        enabled: focusZone === 'content' && !playingChannel && !categoryMenuOpen,
    });

    const handleImageError = (streamId: number) => {
        setBrokenImages(prev => new Set(prev).add(streamId));
    };

    const getLivePlaybackUrl = (stream: LiveStream) => {
        return stream.direct_source || api.getLiveStreamUrl(stream.stream_id);
    };

    // Loading State with Animation
    if (loading) {
        return (
            <div className="livetv-loading-container">
                <div className="livetv-bg-gradient" />
                <div className="livetv-bg-glow" />

                <div className="loading-icon-wrapper">
                    {[0, 1, 2].map(i => (
                        <div key={i} className="loading-ring" style={{ animationDelay: `${i * 0.5}s` }} />
                    ))}
                    <div className="loading-tv-icon">📺</div>
                </div>

                <div className="loading-text">
                    <span>Carregando canais</span>
                    <div className="loading-dots">
                        {[0, 1, 2].map(i => (
                            <span key={i} className="loading-dot" style={{ animationDelay: `${i * 0.2}s` }} />
                        ))}
                    </div>
                </div>

                <div className="loading-skeleton-grid">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                        <div key={i} className="skeleton-card">
                            <div className="skeleton-icon" />
                            <div className="skeleton-text">
                                <div className="skeleton-line skeleton-line-long" />
                                <div className="skeleton-line skeleton-line-short" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Error State
    if (error) {
        return (
            <div className="livetv-error-container">
                <div className="error-icon">📡</div>
                <h2>Erro ao carregar canais</h2>
                <p>{error}</p>
                <button onClick={() => window.location.reload()} className="retry-button">
                    🔄 Tentar novamente
                </button>
            </div>
        );
    }

    return (
        <div className="livetv-page">
            {/* Animated Background */}
            <div className="livetv-bg-gradient" />
            <div className="livetv-bg-glow" />

            {/* Animated Search Bar */}
            <AnimatedSearchBar
                ref={searchRef}
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Buscar canais..."
                tvFocused={focusArea === 'categories' && focusedCategoryIndex === 0}
            />

            {/* Category Menu (Hamburger Button) */}
            <CategoryMenu
                ref={categoryMenuRef}
                categories={categories}
                selectedCategory={selectedCategory}
                onSelectCategory={setSelectedCategory}
                type="live"
                tvFocused={focusArea === 'categories' && focusedCategoryIndex === 1}
                onOpenChange={setCategoryMenuOpen}
                extraCategories={[{ category_id: 'FAVORITES', category_name: '⭐ Favoritos', parent_id: 0 }]}
            />

            {/* Toolbar de filtros */}
            <div className="livetv-toolbar">
                <button
                    className={`toolbar-btn ${groupVariantsOn ? 'active' : ''}`}
                    onClick={toggleGroupVariants}
                    title="Agrupar variantes de qualidade (FHD/HD/SD)"
                >
                    🧬
                </button>
                <button
                    className={`toolbar-btn ${onlyWithEpg ? 'active' : ''}`}
                    onClick={toggleOnlyEpg}
                    title="Só canais com EPG (🔴)"
                >
                    📅
                </button>
                <button
                    className="toolbar-btn"
                    onClick={randomZap}
                    title="Canal aleatório (🟢)"
                >
                    🎲
                </button>
                {hiddenIds.size > 0 && (
                    <button
                        className={`toolbar-btn ${showOnlyHidden ? 'active' : ''}`}
                        onClick={() => setShowOnlyHidden(prev => !prev)}
                        title="Ver canais ocultos"
                    >
                        🙈 {hiddenIds.size}
                    </button>
                )}
            </div>

            {/* Channel Preview (when selected) */}
            {selectedChannel && (
                <div className="channel-preview">
                    <div className="preview-header">
                        <h2 className="preview-title">{selectedChannel.name}</h2>
                        <button
                            className="preview-close"
                            onClick={() => {
                                setSelectedChannel(null);
                                setFocusArea('channels');
                            }}
                        >✕</button>
                    </div>
                    <div className="preview-content">
                        <div className="preview-video">
                            <div className="preview-placeholder">
                                {brokenImages.has(selectedChannel.stream_id) ? (
                                    <span className="placeholder-emoji">📺</span>
                                ) : (
                                    <img
                                        src={selectedChannel?.stream_icon || ''}
                                        alt={selectedChannel?.name || 'Canal'}
                                        onError={() => handleImageError(selectedChannel.stream_id)}
                                    />
                                )}
                            </div>
                            <div className="live-badge">
                                <span className="live-dot" />
                                AO VIVO
                            </div>
                        </div>
                        <div className="preview-details">
                            {/* EPG agora / a seguir */}
                            {previewEpg?.now ? (
                                <div className="preview-epg">
                                    <div className="preview-epg-now">
                                        <span className="epg-label">AGORA</span>
                                        <span className="epg-title">{previewEpg.now.title}</span>
                                        <span className="epg-time">
                                            {formatClock(previewEpg.now.start)} – {formatClock(previewEpg.now.end)}
                                        </span>
                                    </div>
                                    <div className="preview-epg-progress">
                                        <div
                                            className="preview-epg-progress-fill"
                                            style={{ width: `${epgService.progressPct(previewEpg.now) ?? 0}%` }}
                                        />
                                    </div>
                                    {previewEpg.next && (
                                        <div className="preview-epg-next">
                                            <span className="epg-label">A SEGUIR</span>
                                            <span className="epg-title-next">{previewEpg.next.title}</span>
                                            <span className="epg-time">{formatClock(previewEpg.next.start)}</span>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="preview-epg preview-epg-empty">Sem programação disponível</div>
                            )}

                            {/* Variantes de qualidade */}
                            {selectedVariants.length > 1 && (
                                <div className="preview-variants">
                                    {selectedVariants.map((variant, vIndex) => (
                                        <button
                                            key={variant.stream_id}
                                            className={`variant-btn ${focusArea === 'preview' && previewFocusIndex === 3 + vIndex ? 'tv-focused' : ''}`}
                                            onClick={() => playChannel(variant)}
                                        >
                                            {qualityLabel(variant.name)}
                                        </button>
                                    ))}
                                </div>
                            )}

                            <div className="preview-actions">
                                <button
                                    className={`play-button ${focusArea === 'preview' && previewFocusIndex === 0 ? 'tv-focused' : ''}`}
                                    onClick={() => playChannel(selectedChannel)}
                                >
                                    ▶ Assistir
                                </button>
                                <button
                                    className={`info-button ${favoriteChannelIds.has(selectedChannel.stream_id) ? 'active' : ''} ${focusArea === 'preview' && previewFocusIndex === 1 ? 'tv-focused' : ''}`}
                                    onClick={() => toggleChannelFavorite(selectedChannel)}
                                    title="Favorito (🟡)"
                                >
                                    {favoriteChannelIds.has(selectedChannel.stream_id) ? '⭐ Favorito' : '☆ Favoritar'}
                                </button>
                                <button
                                    className={`info-button ${focusArea === 'preview' && previewFocusIndex === 2 ? 'tv-focused' : ''}`}
                                    onClick={() => toggleChannelHidden(selectedChannel)}
                                    title="Ocultar canal (🔵)"
                                >
                                    🙈 {hiddenIds.has(selectedChannel.stream_id) ? 'Mostrar' : 'Ocultar'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Channels Grid - Horizontal Cards */}
            <div ref={scrollContainerRef} className="livetv-content">
                {filteredStreams.length === 0 ? (
                    <div className="no-results">
                        <div className="no-results-icon">📺</div>
                        <p>Nenhum canal encontrado</p>
                        <span>Tente buscar por outro termo</span>
                    </div>
                ) : (
                    <div className="channels-grid">
                        {filteredStreams.slice(0, visibleCount).map((stream, index) => (
                            <div
                                key={stream.stream_id}
                                className={`channel-card ${focusArea === 'channels' && safeChannelIndex === index ? 'tv-focused' : ''} ${selectedChannel?.stream_id === stream.stream_id ? 'selected' : ''}`}
                                onClick={() => setSelectedChannel(stream)}
                                style={{ animationDelay: `${Math.min(index * 0.03, 0.5)}s` }}
                            >
                                <div className="channel-logo">
                                    {brokenImages.has(stream.stream_id) ? (
                                        <span className="channel-placeholder">📺</span>
                                    ) : (
                                        <img
                                            src={stream?.stream_icon || ''}
                                            alt={stream?.name || 'Canal'}
                                            onError={() => handleImageError(stream.stream_id)}
                                        />
                                    )}
                                </div>
                                <div className="channel-info">
                                    <div className="channel-name">
                                        {favoriteChannelIds.has(stream.stream_id) && <span className="channel-fav">⭐ </span>}
                                        {stream?.name || 'Canal Sem Nome'}
                                    </div>
                                </div>
                                <div className="channel-live-indicator" />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer Hints */}
            <div className="livetv-hints">
                <span>↑↓←→ Navegar</span>
                <span>OK Ficha / Assistir</span>
                <span>← Voltar</span>
                <span className="hint-red">🔴 Só EPG</span>
                <span className="hint-green">🟢 Aleatório</span>
                <span className="hint-yellow">🟡 Favorito</span>
                <span className="hint-blue">🔵 Ocultar</span>
            </div>

            {playingChannel && (
                <VideoPlayer
                    src={getLivePlaybackUrl(playingChannel)}
                    title={playingChannel.name}
                    poster={playingChannel.stream_icon}
                    isLive
                    autoPlay
                    contentType="live"
                    liveEpg={playerEpg}
                    channelList={playerChannelList}
                    currentChannelId={playerCurrentChannelId}
                    onSwitchChannel={handleSwitchChannel}
                    contentKey={`live-${playingChannel.stream_id}`}
                    onClose={() => setPlayingChannel(null)}
                />
            )}
        </div>
    );
}
