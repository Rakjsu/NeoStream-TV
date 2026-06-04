// LiveTV Page - Matching NeoStream Desktop Style

import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import type { LiveStream, Category } from '../types';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { CategoryMenu } from '../components/CategoryMenu';
import { AnimatedSearchBar } from '../components/AnimatedSearchBar';
import { VideoPlayer } from '../components/VideoPlayer';
import './LiveTV.css';

export function LiveTV() {
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

    // Focus states for TV navigation
    const [focusArea, setFocusArea] = useState<'categories' | 'search' | 'channels'>('channels');
    const [focusedCategoryIndex, setFocusedCategoryIndex] = useState(0);
    const [focusedChannelIndex, setFocusedChannelIndex] = useState(0);

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

    // Lazy loading scroll will be defined after filteredStreams

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
    }, [searchQuery, selectedCategory]);

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
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'Erro ao carregar canais');
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    // Filter streams
    const filteredStreams = streams.filter((stream) => {
        const streamName = stream.name || '';
        const matchesSearch = streamName.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === 'all' || stream.category_id === selectedCategory;
        return matchesSearch && matchesCategory;
    });

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

    // TV Navigation
    const handleNavigate = (direction: 'up' | 'down' | 'left' | 'right') => {
        if (focusArea === 'categories') {
            if (direction === 'left') {
                setFocusedCategoryIndex(prev => Math.max(0, prev - 1));
            } else if (direction === 'right') {
                setFocusedCategoryIndex(prev => Math.min(categories.length, prev + 1));
            } else if (direction === 'down') {
                setFocusArea('channels');
                setFocusedChannelIndex(0);
            }
        } else if (focusArea === 'channels') {
            const cols = 6;
            const totalChannels = filteredStreams.length;

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
                setFocusedChannelIndex(prev => Math.max(0, prev - 1));
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
                setSelectedCategory('all');
            } else {
                setSelectedCategory(categories[focusedCategoryIndex - 1]?.category_id || 'all');
            }
        } else if (focusArea === 'channels') {
            const channel = filteredStreams[focusedChannelIndex];
            if (channel) {
                setSelectedChannel(channel);
                setPlayingChannel(channel);
            }
        }
    };

    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        enabled: !playingChannel,
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
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Buscar canais..."
            />

            {/* Category Menu (Hamburger Button) */}
            <CategoryMenu
                categories={categories}
                selectedCategory={selectedCategory}
                onSelectCategory={setSelectedCategory}
                type="live"
            />

            {/* Channel Preview (when selected) */}
            {selectedChannel && (
                <div className="channel-preview">
                    <div className="preview-header">
                        <h2 className="preview-title">{selectedChannel.name}</h2>
                        <button className="preview-close" onClick={() => setSelectedChannel(null)}>✕</button>
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
                        <div className="preview-actions">
                            <button className="play-button" onClick={() => setPlayingChannel(selectedChannel)}>
                                ▶ Assistir
                            </button>
                            <button className="info-button">
                                ℹ Informações
                            </button>
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
                                className={`channel-card ${focusArea === 'channels' && focusedChannelIndex === index ? 'tv-focused' : ''} ${selectedChannel?.stream_id === stream.stream_id ? 'selected' : ''}`}
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
                                    <div className="channel-name">{stream?.name || 'Canal Sem Nome'}</div>
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
                <span>OK Selecionar</span>
                <span>← Voltar</span>
            </div>

            {playingChannel && (
                <VideoPlayer
                    src={getLivePlaybackUrl(playingChannel)}
                    title={playingChannel.name}
                    poster={playingChannel.stream_icon}
                    isLive
                    autoPlay
                    contentType="live"
                    onClose={() => setPlayingChannel(null)}
                />
            )}
        </div>
    );
}
