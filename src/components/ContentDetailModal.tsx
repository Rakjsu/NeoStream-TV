// ContentDetailModal.tsx - Premium modal matching original NeoStream app

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from '../services/api';
import { storage } from '../services/storage';
import { searchMovieByName, searchSeriesByName, fetchMovieDetails, fetchSeriesDetails, getImageUrl, formatGenres, type TMDBMovieDetails, type TMDBSeriesDetails, IMAGE_SIZE_FICHA, IMAGE_SIZE_FUNDO } from '../services/tmdb';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { fetchColecao } from '../services/tmdb';
import { indexarCatalogo, cruzarComCatalogo } from '../services/tmdbMatch';
import { abrirExterno, podeAbrirExterno } from '../services/tizenApp';
import { TrailerOverlay } from './TrailerOverlay';
import { extrairChaveYoutube } from '../services/trailer';
import { progressService } from '../services/progressService';
import type { Episode, SeriesInfo } from '../types';
import './ContentDetailModal.css';

interface ContentDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    contentId: string;
    contentType: 'series' | 'movie';
    contentData: {
        name: string;
        cover: string;
        rating?: string;
        plot?: string;
        genre?: string;
        cast?: string;
        director?: string;
        release_date?: string;
        container_extension?: string;
        /** minutos (episode_run_time do provedor) — item 28 */
        runtime?: string;
        /** id TMDB do provedor: evita match errado por nome — item 20 */
        tmdbId?: string;
        /**
         * URL de trailer que o PRÓPRIO provedor manda (item 18). O campo
         * existe no Xtream desde sempre e ninguém lia; usá-lo custa zero
         * requisição e funciona sem chave do TMDB.
         */
        youtubeTrailer?: string;
    };
    onPlay: (season?: number, episode?: number) => void;
    /** Versões do mesmo título (DUB/LEG/4K) — item 21 */
    versions?: Array<{ id: string; label: string }>;
    onSelectVersion?: (versionId: string) => void;
    /**
     * Catálogo de filmes da tela, para cruzar com a saga do TMDB (item 29).
     * Junto com `onOpenRelated`, é o que decide se a fileira existe: quatro das
     * seis telas que abrem esta ficha não têm o catálogo em mãos, e uma fileira
     * focável que não abre nada é o defeito mais comum deste repositório.
     */
    catalogoFilmes?: ReadonlyArray<{
        stream_id: number | string;
        name: string;
        tmdb_id?: string | number;
        stream_icon?: string;
    }>;
    /** Abrir outro filme do catálogo (um da saga) */
    onOpenRelated?: (streamId: string) => void;
}

function formatRuntime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours > 0 ? `${hours}h ${rest}min` : `${rest}min`;
}

/** Hora em que o filme termina se começar agora (item 28). */
function endsAtLabel(minutes: number): string {
    const end = new Date(Date.now() + minutes * 60000);
    return `${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`;
}

export function ContentDetailModal({
    isOpen,
    onClose,
    contentId,
    contentType,
    contentData,
    onPlay,
    versions,
    onSelectVersion,
    catalogoFilmes,
    onOpenRelated
}: ContentDetailModalProps) {
    const [seriesInfo, setSeriesInfo] = useState<SeriesInfo | null>(null);
    const [selectedSeason, setSelectedSeason] = useState(1);
    const [selectedEpisode, setSelectedEpisode] = useState(1);
    const [loading, setLoading] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const [, setRefresh] = useState(0);
    const modalRef = useRef<HTMLDivElement>(null);

    // TMDB data states.
    //
    // O dado guarda a IDENTIDADE de quem ele descreve. Antes era só o dado, e
    // isso bastava enquanto o contentId nunca trocava com a ficha aberta. A
    // fileira da saga (item 29) criou esse caminho: escolher outro filme troca
    // o conteúdo sem desmontar a ficha, e o pôster, a sinopse, o elenco e a
    // CHAVE DO TRAILER do filme anterior continuavam na tela durante todo o
    // fetch novo. Pior: `buildSavedItem` lê daqui, então dois toques em
    // "Assistir Depois" GRAVAVAM o pôster e a nota do filme errado sob o id do
    // novo. A guarda `cancelado` mata a resposta velha; ela não mata o estado.
    const chaveDoConteudo = `${contentType}:${contentId}`;
    const [tmdbState, setTmdbState] = useState<{
        chave: string;
        dados: TMDBMovieDetails | TMDBSeriesDetails | null;
    }>({ chave: '', dados: null });
    const tmdbData = tmdbState.chave === chaveDoConteudo ? tmdbState.dados : null;
    const [tmdbLoading, setTmdbLoading] = useState(false);

    // Focus management for TV navigation
    type FocusZone = 'play' | 'watchLater' | 'favorite' | 'close' | 'season' | 'episode' | 'version' | 'collection' | 'trailer';
    const [focusZone, setFocusZone] = useState<FocusZone>('play');
    const [seasonFocusIndex, setSeasonFocusIndex] = useState(0);
    const [episodeFocusIndex, setEpisodeFocusIndex] = useState(0);
    // A janela da lista tem ~180px: sem rolar, do 3º episódio em diante o
    // destaque saía da área visível e o usuário navegava às cegas
    const episodeListRef = useRef<HTMLDivElement>(null);
    // A ficha rola: `.modal-content` corta em 90% da altura da tela. Enquanto
    // ela tinha só sinopse + episódios os botões cabiam sempre; com elenco,
    // saga e sinopse por episódio eles passam a ficar ABAIXO da dobra — e o
    // foco ficava destacado num botão que não estava na tela, sem nada
    // indicando que era só rolar. Este ref é o que traz a linha de volta.
    const actionsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (focusZone !== 'episode') return;
        const lista = episodeListRef.current;
        // Por CLASSE, não por índice de filho: qualquer coisa acrescentada
        // dentro da lista (cabeçalho, esqueleto de carregamento, um wrapper)
        // faria `children[i]` apontar pro elemento errado — e o sintoma seria
        // a lista rolando pro episódio errado, em silêncio.
        const item = lista?.querySelectorAll('.episode-item')[episodeFocusIndex] as HTMLElement | undefined;
        item?.scrollIntoView({ block: 'nearest' });
    }, [focusZone, episodeFocusIndex]);

    const [versionFocusIndex, setVersionFocusIndex] = useState(0);
    const hasVersions = !!(versions && versions.length > 1 && onSelectVersion);

    // ---- Trailer (item 18) ----
    // A chave vem primeiro do PROVEDOR (custo zero) e só depois do TMDB, que
    // agora chega de graça no mesmo append_to_response da ficha.
    const [trailerAberto, setTrailerAberto] = useState(false);
    const trailerKey = useMemo(() => {
        const doProvedor = extrairChaveYoutube(contentData.youtubeTrailer || '');
        return doProvedor || tmdbData?.trailerKey || '';
    }, [contentData.youtubeTrailer, tmdbData]);

    // Na TV o botão só existe se a TV souber abrir um app externo — ver a nota
    // em services/tizenApp.abrirExterno. No navegador o embed sempre serve.
    const naTv = typeof __BUILD_TARGET__ === 'string' && __BUILD_TARGET__ === 'tizen';
    const hasTrailer = !!trailerKey && (!naTv || podeAbrirExterno());

    // ---- Elenco (item 34, versão reduzida) ----
    // Faixa VISÍVEL, sem foco próprio. Torná-la navegável exigiria uma
    // requisição /person/{id}/combined_credits por ator focado, um índice
    // sobre milhares de itens do catálogo, e só funcionaria nas duas telas que
    // passam o catálogo. Aqui o elenco é informação, como os selos de gênero.
    // Sem chave do TMDB cai no `cast` que o próprio provedor manda.
    const elenco = useMemo(() => {
        const doTmdb = tmdbData?.cast;
        if (doTmdb && doTmdb.length > 0) return doTmdb;
        const doProvedor = (contentData.cast || '')
            .split(',')
            .map(nome => nome.trim())
            .filter(Boolean)
            .slice(0, 12);
        return doProvedor.map((nome, i) => ({
            id: -(i + 1), name: nome, character: '', profile_path: null,
        }));
    }, [tmdbData, contentData.cast]);

    // Quantos CABEM na faixa. A ficha tem ~528px úteis ao lado do pôster e
    // cada card ocupa 104px: mostrar doze deixaria sete fora da tela, e a
    // faixa não é focável — seriam sete atores que nenhuma tecla alcança.
    const elencoVisivel = useMemo(() => elenco.slice(0, 5), [elenco]);

    // ---- Saga / coleção (item 29) ----
    // Só os filmes da saga que o usuário TEM. Mostrar os que ele não tem seria
    // uma vitrine de coisas que não abrem.
    const [sagaState, setSagaState] = useState<{
        chave: string;
        nome: string;
        itens: Array<{ stream_id: number | string; name: string; stream_icon?: string }>;
    } | null>(null);
    // Mesma regra do tmdbData: a saga do filme ANTERIOR não pode ficar na tela
    const saga = sagaState?.chave === chaveDoConteudo ? sagaState : null;
    const [collectionFocusIndex, setCollectionFocusIndex] = useState(0);
    const collectionRowRef = useRef<HTMLDivElement>(null);
    // A MESMA expressão governa a zona de foco e o JSX. Predicado duplicado
    // que diverge = zona inalcançável, ou foco parado no vazio.
    const hasCollection = !!(saga && saga.itens.length > 0 && onOpenRelated);

    useEffect(() => {
        if (focusZone !== 'collection') return;
        const item = collectionRowRef.current?.querySelectorAll('.saga-card')[collectionFocusIndex] as HTMLElement | undefined;
        item?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [focusZone, collectionFocusIndex]);

    // Reset do foco ao abrir E ao trocar de conteúdo. Só `[isOpen]` não
    // bastava: escolher outra versão do mesmo filme troca o contentId sem
    // fechar a ficha, e o foco continuava numa zona do conteúdo anterior.
    useEffect(() => {
        if (isOpen) {
            setFocusZone('play');
            setSeasonFocusIndex(0);
            setEpisodeFocusIndex(0);
            setVersionFocusIndex(0);
            setCollectionFocusIndex(0);
        }
    }, [isOpen, contentId]);

    // Fetch series info
    useEffect(() => {
        if (!isOpen || contentType !== 'series') return;

        setLoading(true);
        api.getSeriesInfo(Number(contentId))
            .then(data => {
                setSeriesInfo(data);
                // Abrir sempre em T1E1 ignorava o progresso que já está salvo:
                // quem parou no E14 da T2 reencontrava "Assistir T1 E1"
                const progresso = progressService.getSeries(String(contentId));
                const temporadas = Object.keys(data?.episodes || {});
                const temporadaValida = progresso
                    && temporadas.includes(String(progresso.season))
                    && !progresso.seriesCompleted;
                if (temporadaValida && progresso) {
                    setSelectedSeason(progresso.season);
                    setSelectedEpisode(progresso.episode);
                    const lista = data?.episodes?.[progresso.season] || [];
                    const idx = lista.findIndex(ep => Number(ep.episode_num) === progresso.episode);
                    setEpisodeFocusIndex(idx >= 0 ? idx : 0);
                    const idxTemporada = temporadas.indexOf(String(progresso.season));
                    if (idxTemporada >= 0) setSeasonFocusIndex(idxTemporada);
                } else {
                    setSelectedSeason(1);
                    setSelectedEpisode(1);
                    setEpisodeFocusIndex(0);
                }
            })
            .catch(err => {
                console.error('Error fetching series info:', err);
                setSeriesInfo(null);
            })
            .finally(() => setLoading(false));
    }, [isOpen, contentId, contentType]);

    // Fetch TMDB data
    useEffect(() => {
        if (!isOpen || !contentData.name) return;

        setTmdbLoading(true);
        // Guarda de corrida: trocar de versão dispara um fetch novo antes de o
        // anterior voltar. Sem isto, a resposta ATRASADA do filme antigo
        // sobrescrevia a do novo — pôster e sinopse do título errado na ficha.
        let cancelado = false;
        // Congelado na entrada: se o conteúdo trocar no meio, a resposta que
        // voltar é gravada sob a chave DELA e o render simplesmente a ignora
        const chave = chaveDoConteudo;
        const fetchTMDB = async () => {
            try {
                // Extract year from release_date if available
                const year = contentData.release_date?.split('-')[0];

                // tmdb_id do provedor é match EXATO — busca por nome erra em
                // títulos genéricos/traduzidos (item 20)
                const providerTmdbId = contentData.tmdbId && Number(contentData.tmdbId) > 0
                    ? String(contentData.tmdbId)
                    : null;
                if (contentType === 'movie') {
                    const data = providerTmdbId
                        ? (await fetchMovieDetails(providerTmdbId)) || (await searchMovieByName(contentData.name, year))
                        : await searchMovieByName(contentData.name, year);
                    if (!cancelado) setTmdbState({ chave, dados: data });
                } else {
                    const data = providerTmdbId
                        ? (await fetchSeriesDetails(providerTmdbId)) || (await searchSeriesByName(contentData.name, year))
                        : await searchSeriesByName(contentData.name, year);
                    if (!cancelado) setTmdbState({ chave, dados: data });
                }
            } catch (err) {
                console.error('Error fetching TMDB data:', err);
                if (!cancelado) setTmdbState({ chave, dados: null });
            } finally {
                if (!cancelado) setTmdbLoading(false);
            }
        };

        fetchTMDB();
        return () => { cancelado = true; };
    }, [isOpen, contentData.name, contentData.release_date, contentData.tmdbId, contentType, chaveDoConteudo]);

    // ---- Saga (item 29): +1 requisição, e SÓ para filme que pertence a uma ----
    const sagaId = contentType === 'movie'
        ? (tmdbData as TMDBMovieDetails | null)?.belongs_to_collection?.id
        : undefined;

    useEffect(() => {
        if (!isOpen || !sagaId || !catalogoFilmes || catalogoFilmes.length === 0 || !onOpenRelated) {
            setSagaState(null);
            return;
        }
        let cancelado = false;
        const chave = chaveDoConteudo;
        fetchColecao(sagaId)
            .then(colecao => {
                if (cancelado || !colecao) {
                    if (!cancelado) setSagaState(null);
                    return;
                }
                const itens = cruzarComCatalogo(
                    colecao.parts,
                    indexarCatalogo(catalogoFilmes),
                    contentId
                );
                // Uma saga com um filme só é o filme que já está na tela:
                // a fileira ficaria vazia e ainda roubaria um degrau do D-pad
                setSagaState(itens.length > 0 ? { chave, nome: colecao.name, itens } : null);
            })
            .catch(() => { if (!cancelado) setSagaState(null); });
        return () => { cancelado = true; };
    }, [isOpen, sagaId, catalogoFilmes, onOpenRelated, contentId, chaveDoConteudo]);

    // Close with animation
    const handleClose = useCallback(() => {
        setIsClosing(true);
        setTimeout(() => {
            setIsClosing(false);
            onClose();
        }, 250);
    }, [onClose]);

    // Close on escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleClose();
        };
        if (isOpen) {
            window.addEventListener('keydown', handleEscape);
        }
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, handleClose]);

    // Close when clicking outside
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === modalRef.current) {
            handleClose();
        }
    };

    // Calculate navigation items
    const seasons = useMemo(
        () => seriesInfo?.episodes ? Object.keys(seriesInfo.episodes).sort((a, b) => Number(a) - Number(b)) : [],
        [seriesInfo]
    );
    const episodes = useMemo(
        () => seriesInfo?.episodes?.[selectedSeason] || [],
        [seriesInfo, selectedSeason]
    );

    // A lista só cresce quando há o que mostrar (item 36). Metade dos painéis
    // Xtream não manda nada por episódio: nesses, linhas altas e vazias seriam
    // uma piora — menos episódios na tela em troca de espaço em branco.
    const episodiosComDetalhe = useMemo(() => ({
        temSinopse: episodes.some(ep => (ep.info?.plot || '').trim().length > 0),
        temImagem: episodes.some(ep => !!ep.info?.movie_image),
    }), [episodes]);
    const listaRica = episodiosComDetalhe.temSinopse || episodiosComDetalhe.temImagem;

    useEffect(() => {
        if (focusZone !== 'play' && focusZone !== 'watchLater' && focusZone !== 'favorite'
            && focusZone !== 'trailer') return;
        actionsRef.current?.scrollIntoView({ block: 'nearest' });
        // As dependencias incluem o que CRESCE depois: elenco, saga e a lista
        // de episodios chegam por rede, segundos depois do foco ja estar nos
        // botoes. So `[focusZone]` rolava antes da ficha crescer, e o efeito
        // nunca mais rodava — o foco acabava num botao fora da tela.
    }, [focusZone, elencoVisivel.length, saga?.itens.length, episodes.length, listaRica]);


    // TV Navigation handlers
    const handleNavigate = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
        if (!isOpen) return;

        if (contentType === 'series') {
            // Series modal navigation
            if (focusZone === 'play') {
                if (direction === 'right') setFocusZone('watchLater');
                else if (direction === 'up' && seasons.length > 0) setFocusZone('season');
                else if (direction === 'down' && episodes.length > 0) setFocusZone('episode');
            } else if (focusZone === 'watchLater') {
                if (direction === 'left') setFocusZone('play');
                else if (direction === 'right') setFocusZone('favorite');
                else if (direction === 'up') setFocusZone('close');
            } else if (focusZone === 'favorite') {
                if (direction === 'left') setFocusZone('watchLater');
                else if (direction === 'right' && hasTrailer) setFocusZone('trailer');
                else if (direction === 'up') setFocusZone('close');
            } else if (focusZone === 'trailer') {
                if (direction === 'left') setFocusZone('favorite');
                else if (direction === 'up') setFocusZone('close');
            } else if (focusZone === 'close') {
                if (direction === 'down') setFocusZone('play');
            } else if (focusZone === 'season') {
                if (direction === 'left') {
                    setSeasonFocusIndex(prev => Math.max(0, prev - 1));
                } else if (direction === 'right') {
                    setSeasonFocusIndex(prev => Math.min(seasons.length - 1, prev + 1));
                } else if (direction === 'down') {
                    setFocusZone('episode');
                } else if (direction === 'up') {
                    setFocusZone('play');
                }
            } else if (focusZone === 'episode') {
                if (direction === 'up') {
                    if (episodeFocusIndex === 0) {
                        setFocusZone('season');
                    } else {
                        setEpisodeFocusIndex(prev => Math.max(0, prev - 1));
                    }
                } else if (direction === 'down') {
                    if (episodeFocusIndex < episodes.length - 1) {
                        setEpisodeFocusIndex(prev => prev + 1);
                    } else {
                        setFocusZone('play');
                    }
                } else if (direction === 'left' || direction === 'right') {
                    // Sair da lista pelos lados: descer 24 episódios até o fim
                    // pra chegar no botão Assistir custava até 20 teclas
                    setFocusZone('play');
                }
            }
        } else {
            // Movie modal navigation. A cadeia vertical, de cima pra baixo,
            // é a MESMA ordem do DOM: close → saga → versões → ações.
            // Toda aresta usa o mesmo predicado que o JSX usa pra renderizar.
            const acimaDasAcoes: FocusZone = hasVersions ? 'version'
                : hasCollection ? 'collection' : 'close';
            const abaixoDoClose: FocusZone = hasCollection ? 'collection'
                : hasVersions ? 'version' : 'play';

            if (focusZone === 'play') {
                if (direction === 'right') setFocusZone('watchLater');
                else if (direction === 'up') setFocusZone(acimaDasAcoes);
            } else if (focusZone === 'collection') {
                if (direction === 'left') setCollectionFocusIndex(prev => Math.max(0, prev - 1));
                else if (direction === 'right') setCollectionFocusIndex(prev => Math.min((saga?.itens.length || 1) - 1, prev + 1));
                else if (direction === 'down') setFocusZone(hasVersions ? 'version' : 'play');
                else if (direction === 'up') setFocusZone('close');
            } else if (focusZone === 'version') {
                if (direction === 'left') setVersionFocusIndex(prev => Math.max(0, prev - 1));
                else if (direction === 'right') setVersionFocusIndex(prev => Math.min((versions?.length || 1) - 1, prev + 1));
                else if (direction === 'down') setFocusZone('play');
                else if (direction === 'up') setFocusZone(hasCollection ? 'collection' : 'close');
            } else if (focusZone === 'watchLater') {
                if (direction === 'left') setFocusZone('play');
                else if (direction === 'right') setFocusZone('favorite');
                else if (direction === 'up') setFocusZone('close');
            } else if (focusZone === 'favorite') {
                if (direction === 'left') setFocusZone('watchLater');
                else if (direction === 'right' && hasTrailer) setFocusZone('trailer');
                else if (direction === 'up') setFocusZone('close');
            } else if (focusZone === 'trailer') {
                if (direction === 'left') setFocusZone('favorite');
                else if (direction === 'up') setFocusZone('close');
            } else if (focusZone === 'close') {
                if (direction === 'down') setFocusZone(abaixoDoClose);
            }
        }
    }, [isOpen, focusZone, contentType, seasons.length, episodes.length, episodeFocusIndex,
        hasVersions, versions?.length, hasCollection, saga?.itens.length, hasTrailer]);

    // Item completo pra salvar em Favoritos/Minha Lista (com pôster e título —
    // a página de listas depende desses campos pra renderizar o card)
    const buildSavedItem = useCallback(() => ({
        id: contentId,
        type: contentType,
        title: contentData.name,
        poster: (tmdbData?.poster_path ? getImageUrl(tmdbData.poster_path, IMAGE_SIZE_FICHA) : contentData.cover) || undefined,
        rating: tmdbData?.vote_average ? tmdbData.vote_average.toFixed(1) : contentData.rating,
        year: contentData.release_date?.split('-')[0],
        container: contentData.container_extension,
    }), [contentId, contentType, contentData, tmdbData]);

    const handleEnter = useCallback(() => {
        if (!isOpen) return;

        if (focusZone === 'play') {
            onPlay(
                contentType === 'series' ? selectedSeason : undefined,
                contentType === 'series' ? selectedEpisode : undefined
            );
        } else if (focusZone === 'watchLater') {
            storage.toggleWatchLater(buildSavedItem());
            setRefresh(r => r + 1);
        } else if (focusZone === 'favorite') {
            storage.toggleFavorite(buildSavedItem());
            setRefresh(r => r + 1);
        } else if (focusZone === 'trailer') {
            if (!trailerKey) return;
            // Na TV, entrega a URL pro sistema e sai do caminho; no navegador,
            // abre o embed. Nunca um iframe na TV: ver services/tizenApp.
            if (naTv) {
                abrirExterno(`https://www.youtube.com/watch?v=${encodeURIComponent(trailerKey)}`);
            } else {
                setTrailerAberto(true);
            }
        } else if (focusZone === 'collection') {
            const filme = saga?.itens[collectionFocusIndex];
            if (filme && onOpenRelated) onOpenRelated(String(filme.stream_id));
        } else if (focusZone === 'version') {
            const version = versions?.[versionFocusIndex];
            if (version && onSelectVersion) onSelectVersion(version.id);
        } else if (focusZone === 'close') {
            handleClose();
        } else if (focusZone === 'season') {
            setSelectedSeason(Number(seasons[seasonFocusIndex]));
            setSelectedEpisode(1);
            setEpisodeFocusIndex(0);
        } else if (focusZone === 'episode') {
            const ep = episodes[episodeFocusIndex];
            if (ep) {
                // OK no episódio TOCA. Antes só selecionava, e o usuário
                // ainda tinha que achar o botão Assistir lá embaixo.
                setSelectedEpisode(Number(ep.episode_num));
                onPlay(selectedSeason, Number(ep.episode_num));
            }
        }
    }, [isOpen, focusZone, contentType, selectedSeason, selectedEpisode, buildSavedItem, seasons,
        seasonFocusIndex, episodes, episodeFocusIndex, onPlay, handleClose, versions,
        versionFocusIndex, onSelectVersion, saga, collectionFocusIndex, onOpenRelated,
        trailerKey, naTv]);

    const handleBack = useCallback(() => {
        handleClose();
    }, [handleClose]);

    // TV Navigation hook
    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        onBack: handleBack,
        // O overlay do trailer tem hook PRÓPRIO. O listener do useTVNavigation
        // é global no window: dois hooks ligados = uma tecla, duas ações — a
        // armadilha mais recorrente deste repositório.
        enabled: isOpen && !trailerAberto
    });

    // Helper function for episode titles
    const getEpisodeTitle = (ep: Episode): string => {
        const epNum = Number(ep.episode_num);
        const rawTitle = ep.title || '';

        const cleanTitle = rawTitle
            .replace(/^(.*?)[\s-–—]*S\d+[\s:.]*E\d+[\s:.–—]*/i, '')
            .replace(/\s*(?:\[|\()?S\d+[\s.-]*E\d+(?:\]|\))?\s*/gi, '')
            .replace(/Episode\s*\d+/gi, '')
            .replace(/^\d+\.?\s*/, '')
            .trim();

        const genericPatterns = [
            /^ep\s*\d+$/i,
            /^\d+$/,
            /^episode$/i
        ];
        const isValidTitle = cleanTitle.length > 0 && !genericPatterns.some(p => p.test(cleanTitle));

        return isValidTitle ? cleanTitle : `Episódio ${epNum}`;
    };
    if (!isOpen) return null;

    // Duração/termina às (item 28) e classificação indicativa (item 35)
    const runtimeMinutes = (() => {
        const fromTmdb = (tmdbData as { runtime?: number } | null)?.runtime;
        if (typeof fromTmdb === 'number' && fromTmdb > 0) return fromTmdb;
        const fromProvider = Number(contentData.runtime);
        if (Number.isFinite(fromProvider) && fromProvider > 0) {
            // Alguns painéis mandam segundos em vez de minutos
            return fromProvider > 400 ? Math.round(fromProvider / 60) : Math.round(fromProvider);
        }
        return 0;
    })();
    const certification = (tmdbData as { certification?: string } | null)?.certification || null;

    // Use TMDB data if available, fallback to IPTV data
    const overview = tmdbData?.overview || contentData.plot || 'Sem descrição disponível.';
    const rating = tmdbData?.vote_average ? tmdbData.vote_average.toFixed(1) : contentData.rating;
    const genres = tmdbData?.genres ? formatGenres(tmdbData.genres) : contentData.genre;
    const backdropUrl = tmdbData?.backdrop_path ? getImageUrl(tmdbData.backdrop_path, IMAGE_SIZE_FUNDO) : null;
    const posterUrl = tmdbData?.poster_path ? getImageUrl(tmdbData.poster_path, IMAGE_SIZE_FICHA) : contentData.cover;

    return (
        <div
            ref={modalRef}
            className={`modal-backdrop ${isClosing ? 'closing' : ''}`}
            onClick={handleBackdropClick}
        >
            <div className={`modal-container ${isClosing ? 'closing' : ''}`}>
                {/* Close Button */}
                <button className={`modal-close-btn ${focusZone === 'close' ? 'focused' : ''}`} onClick={handleClose}>
                    X
                </button>

                {/* Backdrop from TMDB */}
                {backdropUrl && (
                    <div
                        className="modal-backdrop-image"
                        style={{ backgroundImage: `url(${backdropUrl})` }}
                    />
                )}

                {/* Poster */}
                <div className="modal-poster">
                    <img decoding="async"
                        src={posterUrl || contentData.cover}
                        alt={contentData.name}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <div className="poster-gradient" />
                    {tmdbLoading && (
                        <div className="tmdb-loading-overlay">
                            <div className="tmdb-loading-spinner" />
                        </div>
                    )}
                </div>

                {/* Content */}
                <div className="modal-content">
                    {/* Title */}
                    <h2 className="modal-title">{contentData.name}</h2>

                    {/* Meta Badges */}
                    <div className="modal-meta">
                        {rating && (
                            <span className="meta-badge rating-badge">
                                <span className="star">★</span>
                                {rating}
                            </span>
                        )}
                        <span className={`meta-badge ${contentType === 'series' ? 'type-badge-series' : 'type-badge-movie'}`}>
                            {contentType === 'series' ? 'Série' : 'Filme'}
                        </span>
                        {runtimeMinutes > 0 && (
                            <span className="meta-badge">
                                {formatRuntime(runtimeMinutes)}
                                {contentType === 'movie' && ` · termina ${endsAtLabel(runtimeMinutes)}`}
                            </span>
                        )}
                        {certification && (
                            <span className="meta-badge cert-badge">{certification}</span>
                        )}
                        {contentType === 'series' && seasons.length > 0 && (
                            <span className="meta-badge season-badge">
                                {seasons.length} {seasons.length > 1 ? 'Temporadas' : 'Temporada'}
                            </span>
                        )}
                    </div>

                    {/* Genres */}
                    {genres && (
                        <div className="modal-genres">
                            {genres.split(',').map((genre: string, i: number) => (
                                <span key={i} className="genre-tag">{genre.trim()}</span>
                            ))}
                        </div>
                    )}

                    {/* Overview */}
                    <p className="modal-overview">{overview}</p>

                    {/* Elenco (item 34). Não é focável de propósito — ver a
                        nota em `elenco`. Sem `<button>`, sem zona de D-pad. */}
                    {elencoVisivel.length > 0 && (
                        <div className="modal-cast">
                            <span className="modal-cast-label">🎭 Elenco</span>
                            <div className="cast-row">
                                {elencoVisivel.map(pessoa => (
                                    <div className="cast-card" key={pessoa.id} title={pessoa.name}>
                                        <span className="cast-photo">
                                            {pessoa.profile_path && (
                                                <img
                                                    src={getImageUrl(pessoa.profile_path, 'w185') || ''}
                                                    alt=""
                                                    loading="lazy"
                                                    onError={(e) => {
                                                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                                                    }}
                                                />
                                            )}
                                        </span>
                                        <span className="cast-name">{pessoa.name}</span>
                                        {pessoa.character && (
                                            <span className="cast-character">{pessoa.character}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Saga / coleção (item 29) — só os filmes que o usuário TEM.
                        A condição é a MESMA de `hasCollection`, que governa a
                        zona de foco: predicados que divergem deixam uma fileira
                        que o D-pad não alcança, ou o foco parado no vazio. */}
                    {hasCollection && saga && (
                        <div className="modal-saga">
                            <span className="modal-saga-label">
                                📚 {saga.nome} · {saga.itens.length} na sua lista
                            </span>
                            <div className="saga-row" ref={collectionRowRef}>
                                {saga.itens.map((filme, index) => (
                                    <button
                                        key={filme.stream_id}
                                        className={`saga-card ${focusZone === 'collection' && collectionFocusIndex === index ? 'focused' : ''}`}
                                        onClick={() => onOpenRelated?.(String(filme.stream_id))}
                                        title={filme.name}
                                    >
                                        <span className="saga-poster">
                                            {filme.stream_icon && (
                                                <img
                                                    src={filme.stream_icon}
                                                    alt=""
                                                    loading="lazy"
                                                    onError={(e) => {
                                                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                                                    }}
                                                />
                                            )}
                                        </span>
                                        <span className="saga-name">{filme.name}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Series: Season & Episode Selector */}
                    {contentType === 'series' && !loading && seasons.length > 0 && (
                        <>
                            {/* Season Tabs */}
                            <div className="season-tabs">
                                {seasons.map((season, idx) => (
                                    <button
                                        key={season}
                                        className={`season-tab ${selectedSeason === Number(season) ? 'active' : ''} ${focusZone === 'season' && seasonFocusIndex === idx ? 'focused' : ''}`}
                                        onClick={() => {
                                            setSelectedSeason(Number(season));
                                            setSelectedEpisode(1);
                                        }}
                                    >
                                        T{season}
                                    </button>
                                ))}
                            </div>

                            {/* Episode List */}
                            <div
                                className={`episode-list ${listaRica ? 'rica' : ''}`}
                                ref={episodeListRef}
                            >
                                {episodes.map((ep, index: number) => {
                                    const epNum = Number(ep.episode_num);
                                    const isSelected = epNum === selectedEpisode;

                                    return (
                                        <div
                                            key={ep.id || index}
                                            className={`episode-item ${isSelected ? 'selected' : ''} ${focusZone === 'episode' && episodeFocusIndex === index ? 'focused' : ''}`}
                                            onClick={() => setSelectedEpisode(epNum)}
                                        >
                                            <span className="episode-number default">{epNum}</span>
                                            {episodiosComDetalhe.temImagem && (
                                                <span className="episode-thumb">
                                                    {ep.info?.movie_image && (
                                                        <img
                                                            src={ep.info.movie_image}
                                                            alt=""
                                                            loading="lazy"
                                                            // Miniatura quebrada é comum: o provedor
                                                            // aponta pra um host que já saiu do ar.
                                                            // Some sem deixar o ícone de imagem quebrada.
                                                            onError={(e) => {
                                                                (e.currentTarget as HTMLImageElement).style.display = 'none';
                                                            }}
                                                        />
                                                    )}
                                                </span>
                                            )}
                                            <span className="episode-text">
                                                <span className="episode-title">{getEpisodeTitle(ep)}</span>
                                                {episodiosComDetalhe.temSinopse && (
                                                    <span className="episode-plot">
                                                        {(ep.info?.plot || '').trim() || 'Sem sinopse.'}
                                                    </span>
                                                )}
                                            </span>
                                            {isSelected && (
                                                <span className="episode-play-indicator">▶</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    {/* Loading for series info */}
                    {contentType === 'series' && loading && (
                        <div className="modal-loading">
                            <div className="loading-spinner" />
                            Carregando episódios...
                        </div>
                    )}

                    {/* Versões do mesmo título (item 21) */}
                    {versions && versions.length > 1 && onSelectVersion && (
                        <div className="modal-versions">
                            <span className="modal-versions-label">Versões:</span>
                            {versions.map((version, index) => (
                                <button
                                    key={version.id}
                                    className={`version-btn ${version.id === contentId ? 'active' : ''} ${focusZone === 'version' && versionFocusIndex === index ? 'tv-focused' : ''}`}
                                    onClick={() => onSelectVersion(version.id)}
                                >
                                    {version.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="modal-actions" ref={actionsRef}>
                        {/* Play Button */}
                        <button
                            className={`action-btn play-btn ${focusZone === 'play' ? 'focused' : ''}`}
                            onClick={() => {
                                onPlay(
                                    contentType === 'series' ? selectedSeason : undefined,
                                    contentType === 'series' ? selectedEpisode : undefined
                                );
                            }}
                        >
                            <span className="icon">▶</span>
                            {contentType === 'series'
                                ? `Assistir T${selectedSeason} E${selectedEpisode}`
                                : 'Assistir Filme'
                            }
                        </button>

                        {/* Watch Later Button */}
                        <button
                            className={`action-btn secondary-btn ${storage.isInWatchLater(contentId, contentType) ? 'active' : ''} ${focusZone === 'watchLater' ? 'focused' : ''}`}
                            onClick={() => {
                                storage.toggleWatchLater(buildSavedItem());
                                setRefresh(r => r + 1);
                            }}
                        >
                            {storage.isInWatchLater(contentId, contentType) ? '✓' : '+'}
                            {storage.isInWatchLater(contentId, contentType) ? 'Salvo' : 'Assistir Depois'}
                        </button>

                        {/* Favorite Button */}
                        <button
                            className={`action-btn favorite-btn ${storage.isFavorite(contentId, contentType) ? 'active' : ''} ${focusZone === 'favorite' ? 'focused' : ''}`}
                            onClick={() => {
                                storage.toggleFavorite(buildSavedItem());
                                setRefresh(r => r + 1);
                            }}
                            title={storage.isFavorite(contentId, contentType) ? 'Remover dos Favoritos' : 'Adicionar aos Favoritos'}
                        >
                            {storage.isFavorite(contentId, contentType) ? '♥' : '♡'}
                        </button>

                        {/* Trailer (item 18). A MESMA expressão `hasTrailer`
                            governa este botão e a zona de foco: na TV ele só
                            existe quando o aparelho sabe abrir um app externo. */}
                        {hasTrailer && (
                            <button
                                className={`action-btn favorite-btn ${focusZone === 'trailer' ? 'focused' : ''}`}
                                onClick={() => {
                                    if (naTv) {
                                        abrirExterno(`https://www.youtube.com/watch?v=${encodeURIComponent(trailerKey)}`);
                                    } else {
                                        setTrailerAberto(true);
                                    }
                                }}
                                title="Ver o trailer"
                            >
                                ▶
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* No navegador o trailer abre aqui; na TV quem abre é o sistema */}
            {trailerAberto && trailerKey && (
                <TrailerOverlay
                    youtubeKey={trailerKey}
                    title={contentData.name}
                    onClose={() => setTrailerAberto(false)}
                />
            )}
        </div>
    );
}
