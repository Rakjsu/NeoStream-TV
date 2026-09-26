// Series Page - Matching NeoStream Desktop Style

import { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../services/api';
import type { Series as SeriesType, Category } from '../types';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useFocusZone } from '../contexts/FocusContext';
import { mapaDeGeneros, generosDisponiveis, rotuloDoGenero } from '../services/catalogGenres';
import { CategoryMenu, type CategoryMenuHandle } from '../components/CategoryMenu';
import { AnimatedSearchBar, type AnimatedSearchBarHandle } from '../components/AnimatedSearchBar';
import { ContentDetailModal } from '../components/ContentDetailModal';
import { SeriesQueuePlayer } from '../components/SeriesQueuePlayer';
import { montarFilaOuAviso, type EpisodeQueue } from '../services/seriesPlayback';
import {
    catalogSort, sortCatalog, hideWatched, isRecentlyAdded, newEpisodes, SORT_LABELS, type CatalogSort,
    catalogFilters, matchesFilters, normalizeSearch, fuzzyMatches, searchNameOf, DECADES, MIN_RATINGS,
    type CatalogFilters,
} from '../services/catalogExtras';
import { kidsFilter } from '../services/kidsFilter';
import { progressService } from '../services/progressService';
import { storage } from '../services/storage';
import { readCatalog, writeCatalog, dropCatalog, trimSeries, trimCategory, type CachedSeries } from '../services/catalogCache';
import './Series.css';
import { ErrorScreen } from '../components/ErrorScreen';
import { PosterPreguicoso } from '../components/PosterPreguicoso';

/** Letra da barra A-Z: a inicial do nome sem acento, ou '#' (dígito, símbolo). */
function letraDe(item: SeriesType): string {
    const first = searchNameOf(item).charAt(0).toUpperCase();
    return /[A-Z]/.test(first) ? first : '#';
}

export function Series() {
    const { focusZone, setFocusZone } = useFocusZone();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [series, setSeries] = useState<SeriesType[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    // true enquanto a grade mostra a lista de ontem (catalogCache, T118)
    const [doCache, setDoCache] = useState(false);
    // Gênero (item 31): extraído do NOME da categoria — ver catalogGenres.ts
    const [genero, setGenero] = useState<string | null>(null);
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
    const [focusArea, setFocusArea] = useState<'categories' | 'series' | 'alphabet'>('series');
    const [alphabetIndexFocus, setAlphabetIndexFocus] = useState(0);
    // Letra escolhida na barra A-Z (null = todas) — mesma ferramenta de Filmes
    const [letterFilter, setLetterFilter] = useState<string | null>(null);
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
            // Stale-while-revalidate (T118), o mesmo da TV ao vivo: a lista de
            // ontem entra na hora e a de hoje troca por baixo quando chega.
            const cachedSeries = readCatalog<CachedSeries>('series');
            const cachedCategories = readCatalog<Category>('series-cats');
            let servedFromCache = false;
            if (cachedSeries && cachedCategories) {
                // Podado: completa o que o tipo exige e a grade não usa. Sinopse,
                // elenco etc. chegam com o fetch logo atrás.
                const restored = cachedSeries.map(item => ({
                    ...item,
                    plot: '',
                    cast: '',
                    director: '',
                    genre: '',
                    backdrop_path: [],
                    youtube_trailer: '',
                    episode_run_time: '',
                } satisfies SeriesType));
                const gatedCache = kidsFilter.apply(restored, cachedCategories);
                setSeries(gatedCache.items);
                setCategories(gatedCache.categories);
                setDoCache(true);
                setLoading(false);
                servedFromCache = true;
            }

            try {
                if (!servedFromCache) setLoading(true);
                const [seriesData, categoriesData] = await Promise.all([
                    api.getSeries(),
                    api.getSeriesCategories()
                ]);
                // Os dois andam juntos: sem as categorias o cache nunca é
                // servido, e a lista sozinha só ocuparia a quota
                if (writeCatalog('series', seriesData, trimSeries)) {
                    if (!writeCatalog('series-cats', categoriesData, trimCategory)) dropCatalog('series');
                } else {
                    dropCatalog('series-cats');
                }
                // Gate do perfil Kids (remove categorias adultas e suas séries)
                const gated = kidsFilter.apply(seriesData, categoriesData);
                setSeries(gated.items);
                setCategories(gated.categories);
                setDoCache(false);
                // Ficha aberta sobre um item do cache: troca pelo completo, senão
                // ela ficaria sem sinopse, elenco e trailer
                if (servedFromCache) {
                    const porId = new Map(gated.items.map(item => [item.series_id, item]));
                    setSelectedSeries(atual => (atual && porId.get(atual.series_id)) || atual);
                }
            } catch (err: unknown) {
                // Com o cache na tela, cair a rede não apaga o que o usuário já
                // está navegando
                if (servedFromCache) return;
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
        // Só com a lista FRESCA: semear com o last_modified de ontem faria a
        // série recém-seguida ganhar selo de "episódio novo" assim que a de
        // hoje chegasse, sem episódio novo nenhum
        if (series.length === 0 || doCache) return;
        newEpisodes.seed(
            series
                .filter(s => followedSeriesIds.has(String(s.series_id)))
                .map(s => ({ seriesId: String(s.series_id), lastModified: s.last_modified || '0' }))
        );
    }, [series, followedSeriesIds, doCache]);

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

    const generoPorCategoria = useMemo(() => mapaDeGeneros(categories), [categories]);
    const generosDoCatalogo = useMemo(() => generosDisponiveis(categories), [categories]);

    // Botões da barra ancorados por id (o de gênero é condicional; índice
    // posicional com item condicional já mandou o foco pro botão errado aqui)
    const toolbarItems = [
        'sort', 'hidewatched', 'decade',
        ...(generosDoCatalogo.length > 0 ? ['genero'] : []),
        'nota',
    ] as const;
    const HEADER_BASE = 2; // 0 = busca, 1 = menu de categorias
    const toolbarFocusIndex = (item: string) =>
        HEADER_BASE + toolbarItems.indexOf(item as typeof toolbarItems[number]);
    const maxHeaderIndex = HEADER_BASE + toolbarItems.length - 1;

    // Filter series (memoizado — recalcular a cada tecla do D-pad trava TVs antigas)
    // Lista SEM o filtro de letra: é dela que a barra A-Z tira as letras
    const seriesSemLetra = useMemo(() => {
        const query = normalizeSearch(searchQuery);
        const hasFilters = filters.decade > 0 || filters.minRating > 0;
        let list = sortedSeries.filter((s) => {
            const matchesSearch = !query || fuzzyMatches(searchNameOf(s), query);
            const matchesCategory = selectedCategory === 'all' || s.category_id === selectedCategory;
            if (!matchesSearch || !matchesCategory) return false;
            if (hasFilters && !matchesFilters(s, filters)) return false;
            if (genero && generoPorCategoria.get(s.category_id) !== genero) return false;
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
    }, [sortedSeries, searchQuery, selectedCategory, finishedSeriesIds, filters, genero, generoPorCategoria]);

    // O filtro de letra é uma lente sobre a lista ATUAL: qualquer filtro que
    // muda a lista debaixo dele solta a letra — senão a grade ficava vazia com
    // a letra presa e nada na tela explicando por quê (lição de Filmes).
    // A chave cita TODOS os filtros; ajuste durante o render, porque effect
    // com setState é proibido pela regra react-hooks/set-state-in-effect.
    // O 🙈 entra pelo tamanho das terminadas: a lista só existe com ele ligado
    // (-1 = desligado) e o tamanho muda quando uma série termina no player.
    const chaveDosFiltros = [
        searchQuery, selectedCategory, sortMode,
        filters.decade, filters.minRating, genero,
        finishedSeriesIds?.size ?? -1,
    ].join('|');
    const [lastFilterKey, setLastFilterKey] = useState(chaveDosFiltros);
    if (chaveDosFiltros !== lastFilterKey) {
        setLastFilterKey(chaveDosFiltros);
        if (letterFilter !== null) setLetterFilter(null);
    }

    const filteredSeries = useMemo(() => {
        if (!letterFilter) return seriesSemLetra;
        return seriesSemLetra.filter(item => letraDe(item) === letterFilter);
    }, [seriesSemLetra, letterFilter]);

    // Barra A-Z: só com ordenação por nome (em outra ordem a letra não leva a
    // lugar nenhum) e sobre a lista SEM a letra — ao escolher "S" a barra
    // continua com todas, senão não haveria como voltar às outras
    const letrasDaBarra = useMemo(() => {
        if (sortMode !== 'name') return null;
        const letras = Array.from(new Set(seriesSemLetra.map(letraDe)));
        // Com uma letra só a barra não ajuda em nada: nem aparece nem recebe foco
        return letras.length > 1 ? letras : null;
    }, [sortMode, seriesSemLetra]);

    // Grade vazia numa TV e indistinguivel de defeito: dizer QUAIS filtros
    // estao ligados e o que fecha a duvida
    const filtrosLigados = [
        searchQuery ? `busca "${searchQuery}"` : '',
        selectedCategory !== 'all' ? 'categoria' : '',
        genero ? `genero ${rotuloDoGenero(genero)}` : '',
        letterFilter ? `letra ${letterFilter}` : '',
        filters.decade > 0 ? `${filters.decade}s` : '',
        filters.minRating > 0 ? `nota ${filters.minRating}+` : '',
        hideWatchedOn ? 'esconder assistidos' : '',
    ].filter(Boolean);

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
                setFocusedCategoryIndex(prev => Math.min(maxHeaderIndex, prev + 1));
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
                // Última coluna + barra A-Z visível → entra na barra
                if (currentCol === cols - 1 && letrasDaBarra) {
                    setFocusArea('alphabet');
                    setAlphabetIndexFocus(0);
                    return;
                }
                setFocusedSeriesIndex(prev => {
                    const next = Math.min(totalSeries - 1, prev + 1);
                    if (next >= visibleCount - 5) {
                        setVisibleCount(current => Math.min(current + cols * 4, totalSeries));
                    }
                    return next;
                });
            }
        } else if (focusArea === 'alphabet') {
            const ultima = (letrasDaBarra?.length ?? 1) - 1;
            if (direction === 'up') setAlphabetIndexFocus(prev => Math.max(0, prev - 1));
            else if (direction === 'down') setAlphabetIndexFocus(prev => Math.min(ultima, prev + 1));
            else if (direction === 'left') setFocusArea('series');
        }
    };

    // CH+/CH− pulam uma página inteira da grade (3 fileiras). Vai pelo onPage
    // do useTVNavigation: o ouvinte é o do hook (some junto com ele) e a tecla
    // é reconhecida pelo keyCode quando a TV manda `key` 'Unidentified'.
    const paginar = (direction: 'up' | 'down') => {
        if (focusArea !== 'series') return;
        const cols = 6;
        const pageSize = cols * 3;
        const total = filteredSeries.length;
        if (total === 0) return;
        const next = direction === 'up'
            ? Math.max(0, safeSeriesIndex - pageSize)
            : Math.min(total - 1, safeSeriesIndex + pageSize);
        setFocusedSeriesIndex(next);
        // O card de destino tem de estar MONTADO, senão o foco some da tela
        if (next >= visibleCount - cols) {
            setVisibleCount(Math.min(next + 1 + pageSize, total));
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

    // Gênero (item 31): OK cicla pelos gêneros que o catálogo tem
    const cycleGenero = () => {
        if (generosDoCatalogo.length === 0) return;
        setGenero(atual => {
            const i = generosDoCatalogo.findIndex(g => g.id === atual);
            return i + 1 >= generosDoCatalogo.length ? null : generosDoCatalogo[i + 1].id;
        });
    };

    // Nota mínima (item 32): existia em matchesFilters e nenhuma tela escrevia
    const cycleNota = () => {
        setFilters(prev => {
            const i = MIN_RATINGS.indexOf(prev.minRating);
            const next = { ...prev, minRating: MIN_RATINGS[(i + 1) % MIN_RATINGS.length] };
            catalogFilters.set('series', next);
            return next;
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

    /**
     * Pular pra uma letra FILTRA a grade em vez de rolar até ela: rolar
     * montaria milhares de cards no mesmo frame num catálogo grande (o que
     * já derrubou a TV em Filmes). OK na letra ativa desliga o filtro.
     */
    const jumpToLetter = (letter: string) => {
        setLetterFilter(prev => (prev === letter ? null : letter));
        setFocusArea('series');
        setFocusedSeriesIndex(0);
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
            } else {
                // Sem fallback destrutivo (lição da R2)
                const item = toolbarItems[focusedCategoryIndex - HEADER_BASE];
                if (item === 'sort') cycleSort();
                else if (item === 'hidewatched') toggleHideWatched();
                else if (item === 'decade') cycleFilters();
                else if (item === 'genero') cycleGenero();
                else if (item === 'nota') cycleNota();
            }
        } else if (focusArea === 'alphabet') {
            const letter = letrasDaBarra?.[alphabetIndexFocus];
            if (letter) jumpToLetter(letter);
        } else if (focusArea === 'series') {
            const item = filteredSeries[safeSeriesIndex];
            if (item) openSeriesModal(item);
        }
    };

    // Only enable when content is focused and no modal/player/panel is open
    // Mesmo buraco do Movies: sem onBack no hook principal, Voltar na grade
    // nao fazia nada (o unico onBack estava no menu de contexto, que so liga
    // com o menu aberto).
    const handleBack = () => {
        if (focusArea !== 'series') {
            setFocusArea('series');
            return;
        }
        // Decada/nota minima ficam: sao preferencia gravada, nao filtro do
        // momento.
        if (searchQuery || letterFilter || genero || selectedCategory !== 'all') {
            setSearchQuery('');
            setLetterFilter(null);
            setGenero(null);
            setSelectedCategory('all');
            setFocusedSeriesIndex(0);
            return;
        }
        setFocusZone('sidebar');
    };

    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        onBack: handleBack,
        onPage: paginar,
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
            // A dica do menu diz "← Fechar"
            else if (direction === 'left') setContextItem(null);
        },
        onEnter: () => {
            const action = contextActions[contextIndex];
            if (action) {
                action.run();
                setContextItem(null);
            }
        },
        // Este hook só existe com o menu aberto (enabled: !!contextItem), então
        // Voltar aqui é sempre "fecha o menu". O degrau da PÁGINA está no hook
        // principal, acima.
        onBack: () => setContextItem(null),
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
                    className={`toolbar-btn ${sortMode !== 'default' ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('sort') ? 'tv-focused' : ''}`}
                    onClick={cycleSort}
                    title="Ordenar"
                >
                    ↕ {SORT_LABELS[sortMode]}
                </button>
                <button
                    className={`toolbar-btn ${hideWatchedOn ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('hidewatched') ? 'tv-focused' : ''}`}
                    onClick={toggleHideWatched}
                    title="Esconder assistidos"
                >
                    🙈
                </button>
                <button
                    className={`toolbar-btn ${filters.decade > 0 ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('decade') ? 'tv-focused' : ''}`}
                    onClick={cycleFilters}
                    title="Filtrar por década"
                >
                    {filters.decade > 0 ? `${filters.decade}s` : '📅 Década'}
                </button>
                {generosDoCatalogo.length > 0 && (
                    <button
                        className={`toolbar-btn ${genero ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('genero') ? 'tv-focused' : ''}`}
                        onClick={cycleGenero}
                        title="Filtrar por gênero"
                    >
                        {genero ? rotuloDoGenero(genero) : '🎭 Gênero'}
                    </button>
                )}
                <button
                    className={`toolbar-btn ${filters.minRating > 0 ? 'active' : ''} ${focusArea === 'categories' && focusedCategoryIndex === toolbarFocusIndex('nota') ? 'tv-focused' : ''}`}
                    onClick={cycleNota}
                    title="Nota mínima"
                >
                    {filters.minRating > 0 ? `⭐ ${filters.minRating}+` : '⭐ Nota'}
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
                        // Item 18: o campo existe no Xtream e ninguém lia
                        youtubeTrailer: selectedSeries.youtube_trailer,
                    }}
                    onPlay={async (season, episode) => {
                        // Monta a fila de episódios (habilita próximo/anterior + resume)
                        const { fila, aviso } = await montarFilaOuAviso(
                            selectedSeries.series_id,
                            selectedSeries.name,
                            selectedSeries.cover,
                            season,
                            episode
                        );
                        // T135: a ficha só fecha quando há o que tocar. Antes
                        // ela fechava SEMPRE — sem fila, o OK devolvia a pessoa
                        // pra grade sem nada acontecido. O aviso vai pra ficha.
                        if (!fila) return aviso;
                        setSeriesQueue(fila);
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
                        <span>
                            {filtrosLigados.length > 0
                                ? `Filtros ligados: ${filtrosLigados.join(' · ')}`
                                : 'Tente buscar por outro termo'}
                        </span>
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
                                {/* A capa só existe com o card perto da tela: `loading="lazy"`
                                    não existe no Chromium 69 e a grade só cresce (T088). */}
                                <PosterPreguicoso
                                    className="series-poster"
                                    src={brokenImages.has(item.series_id) ? null : item.cover}
                                    alt={item.name}
                                    raiz={scrollContainerRef}
                                    onError={() => handleImageError(item.series_id)}
                                >
                                    {brokenImages.has(item.series_id) && (
                                        <div className="poster-placeholder">📺</div>
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
                                </PosterPreguicoso>
                                <div className="series-title">{item?.name || 'Série Sem Nome'}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Barra A-Z (só com ordenação por nome) */}
            {letrasDaBarra && (
                <div className="alphabet-bar">
                    {letrasDaBarra.map((letter, position) => (
                        <button
                            key={letter}
                            className={`alphabet-letter ${letterFilter === letter ? 'active' : ''} ${focusArea === 'alphabet' && alphabetIndexFocus === position ? 'tv-focused' : ''}`}
                            onClick={() => jumpToLetter(letter)}
                        >
                            {letter}
                        </button>
                    ))}
                </div>
            )}

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
                <span>CH± Página</span>
            </div>
        </div>
    );
}
