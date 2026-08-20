// LiveTV Page - Matching NeoStream Desktop Style
// Paridade com o desktop: EPG (get_short_epg), zapping (CH±/dígitos/overlay),
// variantes de qualidade agrupadas, ⭐ favoritos, 🙈 ocultar, 📅 só-EPG,
// 🎲 aleatório e retomada do último canal.
// Color keys: 🔴 só-EPG · 🟢 aleatório · 🟡 favorito · 🔵 ocultar

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { api } from '../services/api';
import { storage } from '../services/storage';
import { epgService, epgOffset, type ChannelEpg, type EpgProgram } from '../services/epgService';
import { zapHistory, hiddenChannels, hiddenCategories, liveToggles } from '../services/liveExtras';
import { kidsFilter } from '../services/kidsFilter';
import { useWatchSession } from '../hooks/useWatchSession';
import { groupChannelVariants, qualityLabel } from '../services/channelVariants';
import type { LiveStream, Category } from '../types';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useFocusZone } from '../contexts/FocusContext';
import { CategoryMenu, type CategoryMenuHandle } from '../components/CategoryMenu';
import { ChannelAgendaOverlay } from '../components/ChannelAgendaOverlay';
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
    // De QUAL canal é o previewEpg: na troca A→B o dado velho de A não pode
    // alimentar a ficha nem o ⏮ Reiniciar de B (timeshift do trecho errado)
    const [previewEpgFor, setPreviewEpgFor] = useState<number | null>(null);
    const [playerEpg, setPlayerEpg] = useState<ChannelEpg | null>(null);

    // Toast OSD da página (⭐/🙈/failover — R1 item 53)
    const [toast, setToast] = useState<string | null>(null);
    useEffect(() => {
        if (!toast) return;
        const timeout = setTimeout(() => setToast(null), 2500);
        return () => clearTimeout(timeout);
    }, [toast]);

    // Catch-up (itens 2/4/10): fila de programas do arquivo via timeshift
    const [archivePlayback, setArchivePlayback] = useState<{
        channel: LiveStream;
        programs: EpgProgram[];
        index: number;
    } | null>(null);
    const [showAgenda, setShowAgenda] = useState(false);

    // Categorias inteiras ocultas (item 16)
    const [hiddenCatIds, setHiddenCatIds] = useState<Set<string>>(() => hiddenCategories.get());

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
                // Gate do perfil Kids (remove categorias adultas e seus canais)
                const gated = kidsFilter.apply(streamsData, categoriesData);
                setStreams(gated.items);
                setCategories(gated.categories);

                // Retomar o último canal assistido (só pré-seleciona, não dá play)
                // Flag do boot consumida SEMPRE (mesmo sem achar o canal):
                // viva na sessão, ela dispararia autoplay em montagens futuras
                const wantsAutoplay = sessionStorage.getItem('neostream_autoplay_last') === '1';
                sessionStorage.removeItem('neostream_autoplay_last');
                const lastId = storage.getLastChannel();
                if (lastId) {
                    const found = gated.items.find(s => s.stream_id === lastId);
                    if (found) {
                        setSelectedChannel(found);
                        // Boot "ligar e assistir": o App sinaliza via sessionStorage
                        if (wantsAutoplay) {
                            setPlayingChannel(found);
                            storage.setLastChannel(found.stream_id);
                            zapHistory.push(found.stream_id);
                        }
                    }
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

        // Categorias ocultas somem da visão geral; selecionar a própria
        // categoria no menu ainda mostra (caminho pra rever/desocultar)
        if (hiddenCatIds.size > 0 && selectedCategory !== 'FAVORITES' && !hiddenCatIds.has(selectedCategory)) {
            list = list.filter(s => !hiddenCatIds.has(s.category_id));
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
    }, [streams, hiddenIds, hiddenCatIds, showOnlyHidden, onlyWithEpg, selectedCategory, favoriteChannelIds, searchQuery]);

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

    // EPG válido só se pertence ao canal selecionado ATUAL (na troca A→B o
    // dado velho de A não pode alimentar a ficha nem o ⏮ Reiniciar de B)
    const activePreviewEpg = selectedChannel && previewEpgFor === selectedChannel.stream_id
        ? previewEpg
        : null;

    // Ações da ficha (ordem dos botões navegáveis por D-pad; variantes depois).
    // 'restart' entra no FIM: o EPG chega assíncrono e inseri-lo no meio
    // mudaria o significado do índice já focado. tv_archive vem como número
    // OU string dependendo do painel — coerção obrigatória.
    const canRestart = !!(selectedChannel && Number(selectedChannel.tv_archive) > 0 && activePreviewEpg?.now);
    const previewItems: Array<'play' | 'restart' | 'fav' | 'hide' | 'agenda'> = [
        'play',
        'fav',
        'hide',
        ...(canRestart ? (['restart'] as const) : []),
        'agenda',
    ];
    const previewActionIndex = (action: 'play' | 'restart' | 'fav' | 'hide' | 'agenda') => previewItems.indexOf(action);

    // Sessão de uso do canal ao vivo (estatísticas)
    useWatchSession('live', playingChannel?.name || '');

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
        if (!selectedChannel) return;
        let cancelled = false;
        epgService.getChannelEpg(selectedChannel.stream_id).then(epg => {
            if (!cancelled) {
                setPreviewEpg(epg);
                setPreviewEpgFor(selectedChannel.stream_id);
            }
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

    // Failover: stream morreu de vez → tenta a próxima variante do grupo
    const handleStreamFailed = useCallback(() => {
        if (!playingChannel) return;
        const repId = representativeOf.get(playingChannel.stream_id) ?? playingChannel.stream_id;
        const variants = variantsOf.get(String(repId));
        if (!variants || variants.length < 2) return;
        const index = variants.findIndex(v => v.stream_id === playingChannel.stream_id);
        const next = variants[index + 1];
        if (next) {
            setToast(`⚠ Falha no stream — trocando para ${qualityLabel(next.name)}`);
            playChannel(next);
        } else {
            setToast('⚠ Todas as variantes deste canal falharam');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playingChannel, representativeOf, variantsOf]);

    // Zapping vindo do player (CH±, dígitos, overlay)
    const handleSwitchChannel = useCallback((streamId: number) => {
        const found = streams.find(s => s.stream_id === streamId);
        if (found) playChannel(found);
    }, [streams, playChannel]);

    // Ações dos atalhos coloridos
    const toggleChannelFavorite = useCallback((stream: LiveStream) => {
        const added = storage.toggleFavorite({
            id: String(stream.stream_id),
            type: 'channel',
            title: stream.name,
            poster: stream.stream_icon || undefined,
        });
        setFavTick(t => t + 1);
        setToast(added ? `⭐ ${stream.name} favoritado` : `☆ ${stream.name} removido dos favoritos`);
    }, []);

    const toggleChannelHidden = useCallback((stream: LiveStream) => {
        const set = hiddenChannels.toggle(stream.stream_id);
        setHiddenIds(new Set(set));
        setToast(set.has(stream.stream_id) ? `🙈 ${stream.name} oculto` : `👁 ${stream.name} visível de novo`);
    }, []);

    // Tocar programas do arquivo como FILA (agenda ou reiniciar): no fim de
    // cada um, avança pro próximo — e ao alcançar o programa no ar, volta ao
    // vivo (item 10)
    const playArchive = (channel: LiveStream, programs: EpgProgram[], index: number) => {
        setShowAgenda(false);
        setPlayingChannel(null);
        setArchivePlayback({ channel, programs, index });
    };

    // Programa reproduzível na fila: passado e com arquivo (campo ausente
    // conta como reproduzível — o canal já passou pelo gate de tv_archive)
    const isArchivable = (program: EpgProgram, nowMs: number) =>
        program.end <= nowMs && program.hasArchive !== false;

    const advanceArchive = () => {
        if (!archivePlayback) return;
        const nowMs = Date.now();
        // Pula programas sem arquivo no meio da fila (senão a URL dá 404 e trava)
        let nextIndex = archivePlayback.index + 1;
        while (
            nextIndex < archivePlayback.programs.length &&
            archivePlayback.programs[nextIndex].end <= nowMs &&
            archivePlayback.programs[nextIndex].hasArchive === false
        ) {
            nextIndex++;
        }
        const next = archivePlayback.programs[nextIndex];
        // Sem próximo, próximo ainda no futuro, ou próximo é o programa NO AR
        // → volta pro canal ao vivo
        if (!next || next.start > nowMs || next.end > nowMs) {
            const channel = archivePlayback.channel;
            setArchivePlayback(null);
            playChannel(channel);
            return;
        }
        setArchivePlayback({ ...archivePlayback, index: nextIndex });
    };

    const previousArchiveIndex = (): number => {
        if (!archivePlayback) return -1;
        const nowMs = Date.now();
        for (let i = archivePlayback.index - 1; i >= 0; i--) {
            if (isArchivable(archivePlayback.programs[i], nowMs)) return i;
        }
        return -1;
    };

    const previousArchive = () => {
        const prevIndex = previousArchiveIndex();
        if (!archivePlayback || prevIndex < 0) return;
        setArchivePlayback({ ...archivePlayback, index: prevIndex });
    };

    // Reiniciar o programa atual via timeshift (só quando tv_archive > 0)
    const restartProgram = () => {
        if (!selectedChannel || !activePreviewEpg?.now) return;
        const programs = activePreviewEpg.programs.length > 0 ? activePreviewEpg.programs : [activePreviewEpg.now];
        const index = Math.max(0, programs.findIndex(p => p.start === activePreviewEpg.now?.start));
        playArchive(selectedChannel, programs, index);
    };

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
            const totalPreviewItems = previewItems.length + selectedVariants.length;
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
            if (previewFocusIndex < previewItems.length) {
                const action = previewItems[previewFocusIndex];
                if (action === 'play') playChannel(selectedChannel);
                else if (action === 'restart') restartProgram();
                else if (action === 'fav') toggleChannelFavorite(selectedChannel);
                else if (action === 'hide') toggleChannelHidden(selectedChannel);
                // Sem fallback destrutivo: item novo sem branch não pode ocultar canal
                else if (action === 'agenda') setShowAgenda(true);
            } else {
                const variant = selectedVariants[previewFocusIndex - previewItems.length];
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
        enabled: focusZone === 'content' && !playingChannel && !archivePlayback && !showAgenda && !categoryMenuOpen,
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
                hiddenCategoryIds={hiddenCatIds}
                onToggleHideCategory={(id) => setHiddenCatIds(new Set(hiddenCategories.toggle(id)))}
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
                            {activePreviewEpg?.now ? (
                                <div className="preview-epg">
                                    <div className="preview-epg-now">
                                        <span className="epg-label">AGORA</span>
                                        <span className="epg-title">{activePreviewEpg.now.title}</span>
                                        <span className="epg-time">
                                            {formatClock(activePreviewEpg.now.start)} – {formatClock(activePreviewEpg.now.end)}
                                        </span>
                                    </div>
                                    <div className="preview-epg-progress">
                                        <div
                                            className="preview-epg-progress-fill"
                                            style={{ width: `${epgService.progressPct(activePreviewEpg.now) ?? 0}%` }}
                                        />
                                    </div>
                                    {activePreviewEpg.next && (
                                        <div className="preview-epg-next">
                                            <span className="epg-label">A SEGUIR</span>
                                            <span className="epg-title-next">{activePreviewEpg.next.title}</span>
                                            <span className="epg-time">{formatClock(activePreviewEpg.next.start)}</span>
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
                                            className={`variant-btn ${focusArea === 'preview' && previewFocusIndex === previewItems.length + vIndex ? 'tv-focused' : ''}`}
                                            onClick={() => playChannel(variant)}
                                        >
                                            {qualityLabel(variant.name)}
                                        </button>
                                    ))}
                                </div>
                            )}

                            <div className="preview-actions">
                                <button
                                    className={`play-button ${focusArea === 'preview' && previewFocusIndex === previewActionIndex('play') ? 'tv-focused' : ''}`}
                                    onClick={() => playChannel(selectedChannel)}
                                >
                                    ▶ Assistir
                                </button>
                                <button
                                    className={`info-button ${favoriteChannelIds.has(selectedChannel.stream_id) ? 'active' : ''} ${focusArea === 'preview' && previewFocusIndex === previewActionIndex('fav') ? 'tv-focused' : ''}`}
                                    onClick={() => toggleChannelFavorite(selectedChannel)}
                                    title="Favorito (🟡)"
                                >
                                    {favoriteChannelIds.has(selectedChannel.stream_id) ? '⭐ Favorito' : '☆ Favoritar'}
                                </button>
                                <button
                                    className={`info-button ${focusArea === 'preview' && previewFocusIndex === previewActionIndex('hide') ? 'tv-focused' : ''}`}
                                    onClick={() => toggleChannelHidden(selectedChannel)}
                                    title="Ocultar canal (🔵)"
                                >
                                    🙈 {hiddenIds.has(selectedChannel.stream_id) ? 'Mostrar' : 'Ocultar'}
                                </button>
                                {canRestart && (
                                    <button
                                        className={`info-button ${focusArea === 'preview' && previewFocusIndex === previewActionIndex('restart') ? 'tv-focused' : ''}`}
                                        onClick={restartProgram}
                                        title="Reiniciar o programa atual (catch-up)"
                                    >
                                        ⏮ Reiniciar
                                    </button>
                                )}
                                <button
                                    className={`info-button ${focusArea === 'preview' && previewFocusIndex === previewActionIndex('agenda') ? 'tv-focused' : ''}`}
                                    onClick={() => setShowAgenda(true)}
                                    title="Programação do dia"
                                >
                                    📋 Agenda
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
                                        {Number(stream.tv_archive) > 0 && <span className="channel-catchup"> ⏮</span>}
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

            {/* Agenda do dia do canal (itens 2+4) */}
            {showAgenda && selectedChannel && (
                <ChannelAgendaOverlay
                    channel={selectedChannel}
                    onClose={() => setShowAgenda(false)}
                    onPlayArchive={(programs, index) => {
                        if (selectedChannel) playArchive(selectedChannel, programs, index);
                    }}
                />
            )}

            {/* Catch-up: fila de programas do arquivo via timeshift (itens 4+10).
                start é DES-ofsetado: program.start inclui o ajuste de fuso do
                usuário, mas a URL de timeshift precisa do epoch real do provedor */}
            {archivePlayback && (() => {
                const program = archivePlayback.programs[archivePlayback.index];
                if (!program) return null;
                const realStart = program.start - epgOffset.get() * 3600 * 1000;
                // Programa NO AR: pedir só o já gravado (fim clampado ao agora);
                // painéis variam no tratamento de duração futura
                const effectiveEnd = Math.min(program.end, Date.now());
                const durationMin = Math.max(1, Math.ceil((effectiveEnd - program.start) / 60000));
                return (
                    <VideoPlayer
                        key={`${archivePlayback.channel.stream_id}-${program.start}`}
                        src={api.getTimeshiftUrl(archivePlayback.channel.stream_id, realStart, durationMin)}
                        title={`⏮ ${program.title} — ${archivePlayback.channel.name}`}
                        poster={archivePlayback.channel.stream_icon || undefined}
                        autoPlay
                        onNextEpisode={advanceArchive}
                        onPreviousEpisode={previousArchive}
                        canGoNext
                        canGoPrevious={previousArchiveIndex() >= 0}
                        onClose={() => setArchivePlayback(null)}
                    />
                );
            })()}

            {toast && <div className="livetv-toast">{toast}</div>}

            {playingChannel && !archivePlayback && (
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
                    onStreamFailed={handleStreamFailed}
                    onClose={() => setPlayingChannel(null)}
                />
            )}
        </div>
    );
}
