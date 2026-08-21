// useHls hook - Manages HLS.js for streaming playback with quality selection
import { useEffect, useRef, useCallback, useState, type MutableRefObject, type RefObject } from 'react';
import Hls from 'hls.js';
import { qualityCap } from '../services/playerPrefs';

export interface QualityLevel {
    index: number;
    height: number;
    width: number;
    bitrate: number;
    label: string;
}

export type StreamErrorCause = 'notfound' | 'network' | 'media' | 'fatal';

/** Faixa embutida no stream (áudio ou legenda) — itens 39 e 40 */
export interface MediaTrack {
    id: number;
    label: string;
    lang?: string;
}

interface UseHlsOptions {
    src: string;
    videoRef: RefObject<HTMLVideoElement | null>;
    onError?: (cause?: StreamErrorCause) => void;
    onStreamError?: (cause?: StreamErrorCause) => void; // For live TV fallback
    autoPlay?: boolean;
    /** Live usa buffers menores — TVs Tizen antigas têm ~1GB de RAM */
    isLive?: boolean;
}

interface UseHlsReturn {
    hlsRef: MutableRefObject<Hls | null>;
    cleanup: () => void;
    /** Re-inicializa o pipeline do zero (mesmo src) — usado pelo retry */
    reload: () => void;
    qualityLevels: QualityLevel[];
    currentQualityIndex: number;
    setQuality: (index: number) => void;
    isAutoQuality: boolean;
    setAutoQuality: () => void;
    /** Faixas de áudio embutidas (dublado/original/SAP) — item 39 */
    audioTracks: MediaTrack[];
    currentAudioTrack: number;
    setAudioTrack: (id: number) => void;
    /** Legendas embutidas; -1 = desligadas — item 40 */
    subtitleTracks: MediaTrack[];
    currentSubtitleTrack: number;
    setSubtitleTrack: (id: number) => void;
}

export function useHls({
    src,
    videoRef,
    onError,
    onStreamError,
    autoPlay = false,
    isLive = false
}: UseHlsOptions): UseHlsReturn {
    const hlsRef = useRef<Hls | null>(null);
    const srcRef = useRef<string>('');
    const onErrorRef = useRef(onError);
    const onStreamErrorRef = useRef(onStreamError);
    const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Escolha manual de faixa precisa sobreviver ao reload() (retry, watchdog,
    // volta do standby): o pipeline é recriado do zero e o hls.js reescolhe a
    // faixa default. Amarrada ao src pra NÃO vazar pro canal seguinte.
    const preferredTracksSrcRef = useRef<string>('');
    const preferredAudioRef = useRef<number | null>(null);
    const preferredSubtitleRef = useRef<number | null>(null);

    // Re-init sob demanda (retry/watchdog): bump re-roda o effect principal
    const [reloadTick, setReloadTick] = useState(0);

    // Quality state
    const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
    const [currentQualityIndex, setCurrentQualityIndex] = useState(-1); // -1 = auto
    const [isAutoQuality, setIsAutoQuality] = useState(true);

    // Faixas embutidas (itens 39/40)
    const [audioTracks, setAudioTracks] = useState<MediaTrack[]>([]);
    const [currentAudioTrack, setCurrentAudioTrack] = useState(-1);
    const [subtitleTracks, setSubtitleTracks] = useState<MediaTrack[]>([]);
    const [currentSubtitleTrack, setCurrentSubtitleTrack] = useState(-1);

    const destroyHlsInstance = useCallback(() => {
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
        }
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
    }, []);

    useEffect(() => {
        onErrorRef.current = onError;
        onStreamErrorRef.current = onStreamError;
    }, [onError, onStreamError]);

    const cleanup = useCallback(() => {
        destroyHlsInstance();
        setQualityLevels([]);
        setCurrentQualityIndex(-1);
        setIsAutoQuality(true);
        setAudioTracks([]);
        setCurrentAudioTrack(-1);
        setSubtitleTracks([]);
        setCurrentSubtitleTrack(-1);
    }, [destroyHlsInstance]);

    const reload = useCallback(() => {
        srcRef.current = ''; // fura o guard de mesmo-src
        setReloadTick(t => t + 1);
    }, []);

    // Set quality level
    const setQuality = useCallback((index: number) => {
        if (hlsRef.current) {
            hlsRef.current.currentLevel = index;
            setCurrentQualityIndex(index);
            setIsAutoQuality(index === -1);
        }
    }, []);

    // Set auto quality
    const setAutoQuality = useCallback(() => {
        if (hlsRef.current) {
            hlsRef.current.currentLevel = -1;
            setCurrentQualityIndex(-1);
            setIsAutoQuality(true);
        }
    }, []);

    // Troca a faixa de áudio (dublado ↔ original)
    const setAudioTrack = useCallback((id: number) => {
        if (!hlsRef.current) return;
        preferredAudioRef.current = id;
        hlsRef.current.audioTrack = id;
        setCurrentAudioTrack(id);
    }, []);

    // -1 desliga a legenda. subtitleDisplay tem que acompanhar: só mudar o
    // índice deixa a faixa selecionada porém invisível em algumas builds.
    const setSubtitleTrack = useCallback((id: number) => {
        if (!hlsRef.current) return;
        preferredSubtitleRef.current = id;
        hlsRef.current.subtitleDisplay = id >= 0;
        hlsRef.current.subtitleTrack = id;
        setCurrentSubtitleTrack(id);
    }, []);

    // Helper to create quality label
    const getQualityLabel = (height: number, bitrate = 0): string => {
        // Playlist de mídia única (o caso mais comum em Xtream) não declara
        // RESOLUTION — "0p" no menu não diz nada a ninguém
        if (!height) return bitrate > 0 ? `${Math.round(bitrate / 1000)} kbps` : 'Padrão';
        if (height >= 2160) return '4K';
        if (height >= 1440) return '1440p';
        if (height >= 1080) return '1080p';
        if (height >= 720) return '720p';
        if (height >= 480) return '480p';
        if (height >= 360) return '360p';
        return `${height}p`;
    };

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !src) return;

        // Avoid re-initializing if same src
        if (srcRef.current === src && hlsRef.current) {
            return;
        }

        // Cleanup previous instance
        destroyHlsInstance();
        // Conteúdo diferente = escolhas anteriores não valem mais. reload()
        // mantém o mesmo src, então a preferência sobrevive a ele de propósito.
        if (preferredTracksSrcRef.current !== src) {
            preferredTracksSrcRef.current = src;
            preferredAudioRef.current = null;
            preferredSubtitleRef.current = null;
        }
        srcRef.current = src;

        // Reset video state
        video.pause();
        video.src = '';
        video.removeAttribute('src');
        video.load();

        // Check if source is HLS
        const isHls = src.includes('.m3u8');

        if (isHls) {
            if (Hls.isSupported()) {
                // Live usa buffers curtos: 90s de back-buffer em RAM derruba
                // TVs Tizen antigas (OOM). VOD mantém buffer maior pra seek.
                const hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: false,
                    backBufferLength: isLive ? 30 : 90,
                    maxBufferLength: isLive ? 30 : 60,
                    maxMaxBufferLength: isLive ? 60 : 600,
                    // Teto em BYTES além dos segundos: stream 4K de bitrate
                    // alto estourava a RAM de TVs de 1GB só com o buffer
                    maxBufferSize: isLive ? 30 * 1000 * 1000 : 60 * 1000 * 1000,
                    startLevel: -1, // Auto quality selection
                });

                hls.loadSource(src);
                hls.attachMedia(video);

                // Legenda só aparece quando o usuário escolhe (item 40)
                hls.subtitleDisplay = false;

                // Faixas de áudio embutidas (item 39)
                hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
                    setAudioTracks(data.audioTracks.map((track, index) => ({
                        id: index,
                        label: track.name || track.lang || `Faixa ${index + 1}`,
                        lang: track.lang,
                    })));
                    // Reconexão não pode desfazer o "Dublado" que o usuário escolheu
                    const wanted = preferredAudioRef.current;
                    if (wanted != null && wanted >= 0 && wanted < data.audioTracks.length) {
                        hls.audioTrack = wanted;
                        setCurrentAudioTrack(wanted);
                    } else {
                        setCurrentAudioTrack(hls.audioTrack);
                    }
                });
                hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
                    setCurrentAudioTrack(data.id);
                });

                // Legendas embutidas (item 40)
                hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
                    setSubtitleTracks(data.subtitleTracks.map((track, index) => ({
                        id: index,
                        label: track.name || track.lang || `Legenda ${index + 1}`,
                        lang: track.lang,
                    })));
                    const wanted = preferredSubtitleRef.current;
                    if (wanted != null && wanted >= 0 && wanted < data.subtitleTracks.length) {
                        hls.subtitleDisplay = true;
                        hls.subtitleTrack = wanted;
                        setCurrentSubtitleTrack(wanted);
                    }
                });
                hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_event, data) => {
                    // O hls.js seleciona sozinho a faixa DEFAULT=YES mesmo com
                    // subtitleDisplay=false. Reportar esse id deixaria o menu
                    // dizendo "Português" com a tela sem legenda nenhuma.
                    setCurrentSubtitleTrack(hls.subtitleDisplay ? data.id : -1);
                });

                // Capture quality levels when manifest is parsed
                hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
                    const levels: QualityLevel[] = data.levels.map((level, index) => ({
                        index,
                        height: level.height,
                        width: level.width,
                        bitrate: level.bitrate,
                        label: getQualityLabel(level.height, level.bitrate),
                    }));

                    // Sort by height descending (best first)
                    levels.sort((a, b) => b.height - a.height);
                    setQualityLevels(levels);

                    // Teto global de qualidade (item 47). height === 0 significa
                    // "o manifesto não declarou RESOLUTION" — e não "é enorme".
                    // Sem NENHUMA altura declarada não dá pra aplicar teto: fazer
                    // isso travaria o canal inteiro na pior variante do provedor.
                    const cap = qualityCap.get();
                    const withHeight = data.levels
                        .map((level, index) => ({ index, height: level.height || 0 }))
                        .filter(entry => entry.height > 0);
                    if (cap > 0 && withHeight.length > 0) {
                        const allowed = withHeight.filter(entry => entry.height <= cap);
                        // Nada cabe no teto: fica com a MENOR das declaradas,
                        // que é o mais perto do que o usuário pediu
                        const chosen = allowed.length > 0
                            ? allowed.reduce((best, entry) => (entry.height > best.height ? entry : best))
                            : withHeight.reduce((best, entry) => (entry.height < best.height ? entry : best));
                        hls.autoLevelCapping = chosen.index;
                    }

                    if (autoPlay) {
                        video.play().catch(() => { });
                    }
                });

                // Track quality changes
                hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
                    setCurrentQualityIndex(data.level);
                });

                // Falhas fatais de rede consecutivas: sinal de recuperação
                // (fragmento carregado) zera o contador
                let networkFatalCount = 0;
                hls.on(Hls.Events.FRAG_LOADED, () => {
                    networkFatalCount = 0;
                });

                hls.on(Hls.Events.ERROR, (_event, data) => {
                    if (data.fatal) {
                        // Causa granular pro player mostrar mensagem acionável
                        const status = (data.response as { code?: number } | undefined)?.code;
                        const cause: StreamErrorCause =
                            data.type === Hls.ErrorTypes.NETWORK_ERROR
                                ? (status === 404 || status === 403 ? 'notfound' : 'network')
                                : data.type === Hls.ErrorTypes.MEDIA_ERROR ? 'media' : 'fatal';
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                console.error('[HLS] Network error, trying to recover...');
                                networkFatalCount++;
                                // 404/403 não se recupera com retry; e com MSE o
                                // video.error NUNCA seta em erro de rede — o
                                // callback tem que ser entregue diretamente
                                if (cause === 'notfound' || networkFatalCount >= 2) {
                                    if (retryTimeoutRef.current) {
                                        clearTimeout(retryTimeoutRef.current);
                                        retryTimeoutRef.current = null;
                                    }
                                    onStreamErrorRef.current?.(cause);
                                    break;
                                }
                                hls.startLoad();
                                // Persistiu sem novo fragmento? Entrega o erro
                                if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
                                retryTimeoutRef.current = setTimeout(() => {
                                    retryTimeoutRef.current = null;
                                    if (hlsRef.current === hls && networkFatalCount > 0) {
                                        onStreamErrorRef.current?.(cause);
                                    }
                                }, 5000);
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                console.error('[HLS] Media error, trying to recover...');
                                hls.recoverMediaError();
                                break;
                            default:
                                console.error('[HLS] Fatal error:', data);
                                cleanup();
                                onErrorRef.current?.(cause);
                                onStreamErrorRef.current?.(cause);
                                break;
                        }
                    }
                });

                hlsRef.current = hls;
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                // Safari native HLS support (no quality selection)
                video.src = src;
                if (autoPlay) {
                    video.addEventListener('loadedmetadata', () => {
                        video.play().catch(() => { });
                    }, { once: true });
                }
            }
        } else {
            // Direct video source (MP4, etc.)
            video.src = src;
            if (autoPlay) {
                video.addEventListener('loadedmetadata', () => {
                    video.play().catch(() => { });
                }, { once: true });
            }
        }

        return () => {
            cleanup();
            srcRef.current = '';
        };
     
    }, [src, autoPlay, isLive, cleanup, destroyHlsInstance, videoRef, reloadTick]);

    return {
        hlsRef,
        cleanup,
        reload,
        qualityLevels,
        currentQualityIndex,
        setQuality,
        isAutoQuality,
        setAutoQuality,
        audioTracks,
        currentAudioTrack,
        setAudioTrack,
        subtitleTracks,
        currentSubtitleTrack,
        setSubtitleTrack
    };
}
