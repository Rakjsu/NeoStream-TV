// VideoPlayer Component - Premium player with HLS support for TV
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FaPlay, FaPause, FaCog, FaStepForward, FaStepBackward, FaListUl, FaMoon, FaExpand } from 'react-icons/fa';
import { useHls, type StreamErrorCause } from '../../hooks/useHls';
import { useTVNavigation } from '../../hooks/useTVNavigation';
import { epgService, type EpgProgram } from '../../services/epgService';
import { aspectPrefs, ASPECT_MODES, ASPECT_LABELS, type AspectMode } from '../../services/liveExtras';
import './VideoPlayer.css';

export interface PlayerChannel {
    stream_id: number;
    name: string;
    num?: number;
    stream_icon?: string;
}

export interface VideoPlayerProps {
    src: string;
    title?: string;
    poster?: string;
    onClose?: () => void;
    isLive?: boolean;
    autoPlay?: boolean;
    resumeTime?: number | null;
    onTimeUpdate?: (currentTime: number, duration: number) => void;
    onNextEpisode?: () => void;
    onPreviousEpisode?: () => void;
    canGoNext?: boolean;
    canGoPrevious?: boolean;
    contentType?: 'movie' | 'series' | 'live';
    /** Mini-EPG do canal ao vivo (agora / a seguir) */
    liveEpg?: { now: EpgProgram | null; next: EpgProgram | null } | null;
    /** Lista de canais pro zapping (CH+/CH−, dígitos e overlay 📺) */
    channelList?: PlayerChannel[];
    currentChannelId?: number;
    onSwitchChannel?: (streamId: number) => void;
    /** Chave pra lembrar a proporção por conteúdo (ex.: "live-123") */
    contentKey?: string;
    /** Todas as tentativas de reconexão falharam (LiveTV usa pra failover de variante) */
    onStreamFailed?: () => void;
}

// Control buttons: close, prev, play, next, quality, channels, sleep, aspect
type ControlButton = 'close' | 'prev' | 'play' | 'golive' | 'next' | 'quality' | 'channels' | 'sleep' | 'aspect';
type PlayerFocus = 'controls' | 'quality-menu' | 'zap-list';

const SLEEP_CHOICES = [null, 30, 60, 90] as const;
const DIGIT_TIMEOUT_MS = 1400;
const ZAP_WINDOW = 9; // linhas visíveis no overlay de zapping
const MAX_RECONNECT_ATTEMPTS = 4;
const STALL_LIMIT_MS = 12000; // watchdog: tempo parado antes de reconectar

// Mensagem acionável por causa (R1 item 45)
const CAUSE_MESSAGES: Record<string, string> = {
    notfound: 'Canal indisponível no provedor (404). Tente outra variante ou canal.',
    network: 'Falha de rede. Verifique a conexão da TV.',
    media: 'Falha ao decodificar o vídeo (codec não suportado?).',
    stall: 'O stream congelou.',
    fatal: 'Erro no stream.',
};

// Segura o screensaver do sistema durante a reprodução (Tizen)
function holdSystemScreenSaver(hold: boolean): void {
    try {
        const webapis = (window as unknown as {
            webapis?: { appcommon?: {
                setScreenSaver: (state: number, ok?: () => void, err?: () => void) => void;
                AppCommonScreenSaverState: { SCREEN_SAVER_OFF: number; SCREEN_SAVER_ON: number };
            } };
        }).webapis;
        const appcommon = webapis?.appcommon;
        if (!appcommon) return;
        const state = hold
            ? appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF
            : appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON;
        appcommon.setScreenSaver(state, undefined, undefined);
    } catch {
        // Fora do Tizen (dev no browser) — sem screensaver pra segurar
    }
}

function formatClock(ms: number): string {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function epgProgressPct(program: EpgProgram): number {
    const total = program.end - program.start;
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, ((Date.now() - program.start) / total) * 100));
}

export function VideoPlayer({
    src,
    title,
    poster,
    onClose,
    isLive = false,
    autoPlay = false,
    resumeTime,
    onTimeUpdate,
    onNextEpisode,
    onPreviousEpisode,
    canGoNext,
    canGoPrevious,
    contentType = 'movie',
    liveEpg,
    channelList,
    currentChannelId,
    onSwitchChannel,
    contentKey,
    onStreamFailed
}: VideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const hideControlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const resumeAppliedRef = useRef(false);
    const digitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const isLiveContent = isLive || contentType === 'live';
    const canZap = isLiveContent && !!channelList?.length && !!onSwitchChannel;

    // Video state
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [buffered, setBuffered] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showControls, setShowControls] = useState(true);
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [hoverPosition, setHoverPosition] = useState(0);

    // Focus management
    const [showQualityMenu, setShowQualityMenu] = useState(false);
    const [qualityMenuIndex, setQualityMenuIndex] = useState(0);
    const [playerFocus, setPlayerFocus] = useState<PlayerFocus>('controls');
    const [focusedControl, setFocusedControl] = useState<ControlButton>('play');

    // Zapping (live)
    const [digitBuffer, setDigitBuffer] = useState('');
    const [zapIndex, setZapIndex] = useState(0);
    // EPG do canal focado no overlay de zapping (item 6)
    const [zapEpg, setZapEpg] = useState<{ id: number; title: string } | null>(null);

    useEffect(() => {
        if (playerFocus !== 'zap-list' || !channelList) return;
        const channel = channelList[zapIndex];
        if (!channel) return;
        let cancelled = false;
        const timeout = setTimeout(() => {
            epgService.getChannelEpg(channel.stream_id).then(epg => {
                if (!cancelled && epg.now) {
                    setZapEpg({ id: channel.stream_id, title: epg.now.title });
                }
            });
        }, 400); // debounce: busca quando o foco assenta
        return () => {
            cancelled = true;
            clearTimeout(timeout);
        };
    }, [playerFocus, zapIndex, channelList]);

    // Aviso "a seguir" nos últimos 5 min do programa (item 9) — tick de 30s
    const [nextSoonTick, setNextSoonTick] = useState(0);
    useEffect(() => {
        if (!isLiveContent) return;
        const interval = setInterval(() => setNextSoonTick(t => t + 1), 30000);
        return () => clearInterval(interval);
    }, [isLiveContent]);
    void nextSoonTick;
    const nextSoon = isLiveContent && liveEpg?.now && liveEpg.next &&
        liveEpg.now.end - Date.now() > 0 && liveEpg.now.end - Date.now() < 5 * 60 * 1000
        ? liveEpg.next
        : null;

    // Sleep timer
    const [sleepChoiceIndex, setSleepChoiceIndex] = useState(0);
    const [sleepUntil, setSleepUntil] = useState<number | null>(null);
    const [sleepRemainingMin, setSleepRemainingMin] = useState<number | null>(null);

    // Proporção/zoom (lembrada por conteúdo quando contentKey existe)
    const [aspectMode, setAspectMode] = useState<AspectMode>(() =>
        contentKey ? aspectPrefs.get(contentKey) : 'original'
    );

    // O player fica MONTADO durante o zapping (só o src muda) — estados
    // derivados do conteúdo precisam resetar aqui, no render (padrão React
    // de ajuste durante render; effect com setState síncrono é proibido).
    const [lastSrc, setLastSrc] = useState(src);
    if (src !== lastSrc) {
        setLastSrc(src);
        setError(null);
        setLoading(true);
        setDigitBuffer('');
        setAspectMode(contentKey ? aspectPrefs.get(contentKey) : 'original');
    }

    // Ref não pode ser escrita durante o render — resets por troca de src
    useEffect(() => {
        resumeAppliedRef.current = false;
        reconnectAttemptRef.current = 0;
        streamFailedRef.current = false;
        reloadResumeRef.current = null;
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        setReconnectAttempt(0);
        setReconnecting(false);
        setIsBehindLive(false);
    }, [src]);

    // Atrás do vivo? (pausou/atrasou num canal ao vivo → botão AO VIVO)
    const [isBehindLive, setIsBehindLive] = useState(false);

    // Reconexão com backoff (R1 itens 43/44/74): tentativa visível + watchdog
    const [reconnectAttempt, setReconnectAttempt] = useState(0);
    const [reconnecting, setReconnecting] = useState(false);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttemptRef = useRef(0);
    // VOD: posição capturada antes do reload (o pipeline recomeça em 0)
    const reloadResumeRef = useRef<number | null>(null);
    // Terminal: tentativas esgotadas — watchdog para de re-agendar
    const streamFailedRef = useRef(false);

    // HLS hook with quality support
    const {
        hlsRef,
        cleanup,
        reload,
        qualityLevels,
        currentQualityIndex,
        setQuality,
        isAutoQuality,
        setAutoQuality
    } = useHls({
        src,
        videoRef,
        autoPlay,
        isLive: isLive || contentType === 'live',
        onError: (cause) => setError(CAUSE_MESSAGES[cause || 'fatal']),
        onStreamError: (cause) => scheduleReconnect(cause || 'fatal'),
    });

    // onStreamFailed via ref: o watchdog roda num effect de deps vazias e não
    // pode capturar a closure do primeiro render (variantes do LiveTV mudam)
    const onStreamFailedRef = useRef(onStreamFailed);
    useEffect(() => {
        onStreamFailedRef.current = onStreamFailed;
    }, [onStreamFailed]);

    // Agenda uma reconexão com backoff exponencial; esgotou → erro + failover
    const scheduleReconnect = useCallback((cause: StreamErrorCause | 'stall') => {
        if (reconnectTimerRef.current || streamFailedRef.current) return; // já agendada / terminal
        const attempt = reconnectAttemptRef.current + 1;
        if (attempt > MAX_RECONNECT_ATTEMPTS) {
            streamFailedRef.current = true;
            videoRef.current?.pause();
            setReconnecting(false);
            setError(CAUSE_MESSAGES[cause] || CAUSE_MESSAGES.fatal);
            onStreamFailedRef.current?.();
            return;
        }
        reconnectAttemptRef.current = attempt;
        setReconnectAttempt(attempt);
        setReconnecting(true);
        setError(null);
        const delayMs = Math.min(16000, 2000 * Math.pow(2, attempt - 1));
        reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            // VOD volta do zero no reload — guarda a posição pra reaplicar
            const video = videoRef.current;
            if (!isLiveContent && video && video.currentTime > 5) {
                reloadResumeRef.current = video.currentTime;
            }
            reload();
        }, delayMs);
    }, [reload, isLiveContent]);

    // Voltou a tocar → zera o ciclo de reconexão
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const handlePlaying = () => {
            reconnectAttemptRef.current = 0;
            streamFailedRef.current = false;
            setReconnectAttempt(0);
            setReconnecting(false);
        };
        const handleLoadedMetadata = () => {
            // Posição do VOD capturada antes do reload do watchdog
            if (reloadResumeRef.current != null && video) {
                video.currentTime = reloadResumeRef.current;
                reloadResumeRef.current = null;
            }
        };
        video.addEventListener('playing', handlePlaying);
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        return () => {
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        };
    }, []);

    // Rede voltou (evento do sistema) → tenta na hora
    useEffect(() => {
        const handleOnline = () => {
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            if (reconnectAttemptRef.current > 0 || error) {
                setError(null);
                setReconnecting(true);
                reload();
            }
        };
        window.addEventListener('online', handleOnline);
        return () => window.removeEventListener('online', handleOnline);
         
    }, [error, reload]);

    // Watchdog anti-travamento: tocando mas o relógio do vídeo não anda
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        let lastTime = -1;
        let stalledSince = 0;
        const interval = setInterval(() => {
            if (!video) return;
            // AO VIVO: pausado ou >30s atrás do edge
            if (isLiveContent) {
                const edge = hlsRef.current?.liveSyncPosition;
                setIsBehindLive(video.paused || (typeof edge === 'number' && edge - video.currentTime > 30));
            }
            if (video.paused || video.ended) {
                stalledSince = 0;
                return;
            }
            if (video.currentTime === lastTime) {
                if (stalledSince === 0) stalledSince = Date.now();
                else if (Date.now() - stalledSince >= STALL_LIMIT_MS && !reconnectTimerRef.current) {
                    stalledSince = 0;
                    scheduleReconnect('stall');
                }
            } else {
                stalledSince = 0;
            }
            lastTime = video.currentTime;
        }, 4000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scheduleReconnect, isLiveContent]);

    // Limpa o timer de reconexão ao desmontar
    useEffect(() => {
        return () => {
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
        };
    }, []);

    // Segura o screensaver do sistema enquanto o player existe (R1 item 77)
    useEffect(() => {
        holdSystemScreenSaver(true);
        return () => holdSystemScreenSaver(false);
    }, []);

    // Build list of available control buttons
    const getControlButtons = useCallback((): ControlButton[] => {
        const buttons: ControlButton[] = ['close'];
        if (canGoPrevious && onPreviousEpisode) buttons.push('prev');
        buttons.push('play');
        if (isLiveContent && isBehindLive) buttons.push('golive');
        if (canGoNext && onNextEpisode) buttons.push('next');
        if (qualityLevels.length > 0) buttons.push('quality');
        if (canZap) buttons.push('channels');
        buttons.push('sleep');
        buttons.push('aspect');
        return buttons;
    }, [canGoPrevious, canGoNext, onPreviousEpisode, onNextEpisode, qualityLevels.length, canZap, isLiveContent, isBehindLive]);

    // ----- Zapping helpers (live) -----
    const currentChannelIndex = useMemo(() => {
        if (!channelList || currentChannelId == null) return -1;
        return channelList.findIndex(c => c.stream_id === currentChannelId);
    }, [channelList, currentChannelId]);

    const switchRelative = useCallback((delta: number) => {
        if (!canZap || !channelList || channelList.length === 0) return;
        const base = currentChannelIndex >= 0 ? currentChannelIndex : 0;
        const next = (base + delta + channelList.length) % channelList.length;
        onSwitchChannel?.(channelList[next].stream_id);
    }, [canZap, channelList, currentChannelIndex, onSwitchChannel]);

    // Digit-jump: número digitado vira canal após pequena pausa
    useEffect(() => {
        if (!digitBuffer) return;
        if (digitTimeoutRef.current) clearTimeout(digitTimeoutRef.current);
        digitTimeoutRef.current = setTimeout(() => {
            digitTimeoutRef.current = null;
            const num = Number(digitBuffer);
            setDigitBuffer('');
            // Coerção: muitos painéis Xtream mandam num como string no JSON
            const found = channelList?.find(c => Number(c.num) === num);
            if (found) onSwitchChannel?.(found.stream_id);
        }, DIGIT_TIMEOUT_MS);
        return () => {
            if (digitTimeoutRef.current) {
                clearTimeout(digitTimeoutRef.current);
                digitTimeoutRef.current = null;
            }
        };
    }, [digitBuffer, channelList, onSwitchChannel]);

    // Teclas extras do controle: CH+/CH− (427/428, PageUp/PageDown) e dígitos.
    // Só na camada de controles — com menu/overlay aberto, zapear por baixo
    // deixaria o foco dessas camadas apontando pro conteúdo errado.
    const playerFocusRef = useRef(playerFocus);
    useEffect(() => {
        playerFocusRef.current = playerFocus;
    }, [playerFocus]);
    useEffect(() => {
        if (!canZap) return;
        const handleExtraKeys = (event: KeyboardEvent) => {
            if (playerFocusRef.current !== 'controls') return;
            const key = event.key || String(event.keyCode);
            const code = event.keyCode;

            if (key === 'MediaChannelUp' || code === 427 || key === 'PageUp' || code === 33) {
                event.preventDefault();
                switchRelative(-1);
            } else if (key === 'MediaChannelDown' || code === 428 || key === 'PageDown' || code === 34) {
                event.preventDefault();
                switchRelative(1);
            } else if (/^[0-9]$/.test(key) || (code >= 48 && code <= 57) || (code >= 96 && code <= 105)) {
                event.preventDefault();
                const digit = /^[0-9]$/.test(key) ? key : String(code >= 96 ? code - 96 : code - 48);
                setDigitBuffer(prev => (prev + digit).slice(0, 4));
            }
        };
        window.addEventListener('keydown', handleExtraKeys);
        return () => window.removeEventListener('keydown', handleExtraKeys);
    }, [canZap, switchRelative]);

    // ----- Sleep timer -----
    // O estado "remaining" é setado no handler (cycleSleep) e no callback do
    // interval — nunca no corpo do effect (regra react-hooks/set-state-in-effect).
    useEffect(() => {
        if (!sleepUntil) return;
        const interval = setInterval(() => {
            const remaining = sleepUntil - Date.now();
            if (remaining <= 0) {
                videoRef.current?.pause();
                setSleepUntil(null);
                setSleepChoiceIndex(0);
                setSleepRemainingMin(null);
            } else {
                setSleepRemainingMin(Math.ceil(remaining / 60000));
            }
        }, 15000);
        return () => clearInterval(interval);
    }, [sleepUntil]);

    const cycleSleep = useCallback(() => {
        const nextIndex = (sleepChoiceIndex + 1) % SLEEP_CHOICES.length;
        setSleepChoiceIndex(nextIndex);
        const minutes = SLEEP_CHOICES[nextIndex];
        setSleepUntil(minutes ? Date.now() + minutes * 60000 : null);
        setSleepRemainingMin(minutes ?? null);
    }, [sleepChoiceIndex]);

    // ----- Proporção/zoom -----
    const cycleAspect = useCallback(() => {
        setAspectMode(prev => {
            const next = ASPECT_MODES[(ASPECT_MODES.indexOf(prev) + 1) % ASPECT_MODES.length];
            if (contentKey) aspectPrefs.set(contentKey, next);
            return next;
        });
    }, [contentKey]);

    // Voltar ao edge do ao vivo (R1 item 42)
    const seekToLive = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        const edge = hlsRef.current?.liveSyncPosition;
        if (typeof edge === 'number' && Number.isFinite(edge)) {
            video.currentTime = edge;
        } else if (Number.isFinite(video.duration)) {
            video.currentTime = video.duration;
        }
        video.play().catch(() => { });
        setIsBehindLive(false);
        // O botão golive some — foco não pode ficar órfão nele
        setFocusedControl(prev => (prev === 'golive' ? 'play' : prev));
    }, [hlsRef]);

    // ----- Overlay de zapping -----
    const openZapList = useCallback(() => {
        setPlayerFocus('zap-list');
        setZapIndex(currentChannelIndex >= 0 ? currentChannelIndex : 0);
    }, [currentChannelIndex]);

    const closeZapList = useCallback(() => {
        setPlayerFocus('controls');
    }, []);

    // Resume time - apply once when video is ready
    useEffect(() => {
        if (!resumeTime || !videoRef.current || resumeAppliedRef.current) return;

        const video = videoRef.current;

        const applyResumeTime = () => {
            if (video && resumeTime && !resumeAppliedRef.current) {
                if (Math.abs(video.currentTime - resumeTime) > 5) {
                    video.currentTime = resumeTime;
                }
                resumeAppliedRef.current = true;
            }
        };

        if (video.readyState >= 2) {
            applyResumeTime();
        } else {
            video.addEventListener('loadedmetadata', applyResumeTime, { once: true });
        }

        return () => video.removeEventListener('loadedmetadata', applyResumeTime);
    }, [resumeTime, src]);

    // Time update callback for progress tracking
    useEffect(() => {
        if (!onTimeUpdate || !videoRef.current) return;

        const video = videoRef.current;
        let lastReportedTime = 0;

        const handleTimeUpdate = () => {
            if (Math.abs(video.currentTime - lastReportedTime) >= 5) {
                onTimeUpdate(video.currentTime, video.duration || 0);
                lastReportedTime = video.currentTime;
            }
        };

        video.addEventListener('timeupdate', handleTimeUpdate);
        return () => video.removeEventListener('timeupdate', handleTimeUpdate);
    }, [onTimeUpdate]);

    // Auto go to next episode when video ends
    useEffect(() => {
        if (!videoRef.current || !onNextEpisode || !canGoNext) return;

        const video = videoRef.current;
        const handleEnded = () => onNextEpisode();

        video.addEventListener('ended', handleEnded);
        return () => video.removeEventListener('ended', handleEnded);
    }, [onNextEpisode, canGoNext]);

    // Cleanup on unmount
    useEffect(() => {
        const video = videoRef.current;
        return () => {
            cleanup();
            if (video) {
                video.pause();
                video.src = '';
                video.load();
            }
        };
    }, [cleanup]);

    // Auto-hide controls
    const resetHideControlsTimer = useCallback(() => {
        setShowControls(true);
        if (hideControlsTimeoutRef.current) {
            clearTimeout(hideControlsTimeoutRef.current);
        }
        hideControlsTimeoutRef.current = setTimeout(() => {
            if (playing && !showQualityMenu) {
                setShowControls(false);
            }
        }, 3000);
    }, [playing, showQualityMenu]);

    // Video event handlers
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handlePlay = () => setPlaying(true);
        const handlePause = () => setPlaying(false);
        const handleTimeUpdateLocal = () => setCurrentTime(video.currentTime);
        const handleDurationChange = () => setDuration(video.duration || 0);
        const handleProgress = () => {
            if (video.buffered.length > 0) {
                setBuffered(video.buffered.end(video.buffered.length - 1));
            }
        };
        const handleWaiting = () => setLoading(true);
        const handlePlaying = () => setLoading(false);
        const handleCanPlay = () => setLoading(false);
        const handleError = () => setError('Erro ao reproduzir vídeo');

        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);
        video.addEventListener('timeupdate', handleTimeUpdateLocal);
        video.addEventListener('durationchange', handleDurationChange);
        video.addEventListener('progress', handleProgress);
        video.addEventListener('waiting', handleWaiting);
        video.addEventListener('playing', handlePlaying);
        video.addEventListener('canplay', handleCanPlay);
        video.addEventListener('error', handleError);

        return () => {
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
            video.removeEventListener('timeupdate', handleTimeUpdateLocal);
            video.removeEventListener('durationchange', handleDurationChange);
            video.removeEventListener('progress', handleProgress);
            video.removeEventListener('waiting', handleWaiting);
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('canplay', handleCanPlay);
            video.removeEventListener('error', handleError);
        };
    }, []);

    // Mouse move handler for controls
    useEffect(() => {
        const handleMouseMove = () => resetHideControlsTimer();
        document.addEventListener('mousemove', handleMouseMove);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            if (hideControlsTimeoutRef.current) {
                clearTimeout(hideControlsTimeoutRef.current);
            }
        };
    }, [resetHideControlsTimer]);

    // Close handler
    const handleClose = useCallback(() => {
        if (onTimeUpdate && videoRef.current) {
            onTimeUpdate(videoRef.current.currentTime, videoRef.current.duration || 0);
        }
        cleanup();
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.src = '';
            videoRef.current.load();
        }
        onClose?.();
    }, [cleanup, onClose, onTimeUpdate]);

    // Controls
    const togglePlay = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            video.play();
        } else {
            video.pause();
        }
    }, []);

    const seek = useCallback((time: number) => {
        const video = videoRef.current;
        if (video) {
            video.currentTime = time;
        }
    }, []);

    // Quality menu handlers
    const openQualityMenu = useCallback(() => {
        setShowQualityMenu(true);
        setPlayerFocus('quality-menu');
        setQualityMenuIndex(0);
    }, []);

    const closeQualityMenu = useCallback(() => {
        setShowQualityMenu(false);
        setPlayerFocus('controls');
    }, []);

    const selectQuality = useCallback((index: number) => {
        if (index === -1) {
            setAutoQuality();
        } else {
            setQuality(index);
        }
        closeQualityMenu();
    }, [setQuality, setAutoQuality, closeQualityMenu]);

    // Execute focused control action
    const executeControlAction = useCallback(() => {
        switch (focusedControl) {
            case 'close':
                handleClose();
                break;
            case 'prev':
                onPreviousEpisode?.();
                break;
            case 'play':
                togglePlay();
                break;
            case 'next':
                onNextEpisode?.();
                break;
            case 'quality':
                openQualityMenu();
                break;
            case 'golive':
                seekToLive();
                break;
            case 'channels':
                openZapList();
                break;
            case 'sleep':
                cycleSleep();
                break;
            case 'aspect':
                cycleAspect();
                break;
        }
    }, [focusedControl, handleClose, onPreviousEpisode, togglePlay, onNextEpisode, openQualityMenu, openZapList, cycleSleep, cycleAspect, seekToLive]);

    // TV Navigation handler
    const handleNavigate = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
        resetHideControlsTimer();

        if (playerFocus === 'zap-list') {
            const total = channelList?.length || 0;
            if (direction === 'up') {
                setZapIndex(prev => Math.max(0, prev - 1));
            } else if (direction === 'down') {
                setZapIndex(prev => Math.min(total - 1, prev + 1));
            } else if (direction === 'left') {
                closeZapList();
            }
        } else if (playerFocus === 'quality-menu') {
            const totalItems = qualityLevels.length + 1;
            if (direction === 'up') {
                setQualityMenuIndex(prev => Math.max(0, prev - 1));
            } else if (direction === 'down') {
                setQualityMenuIndex(prev => Math.min(totalItems - 1, prev + 1));
            }
        } else {
            // Navigate controls with left/right
            if (direction === 'left' || direction === 'right') {
                const buttons = getControlButtons();
                // Botão focado pode ter sumido (ex.: golive após voltar ao
                // vivo) — reancora no play em vez de cair no índice 0 (close)
                const rawIndex = buttons.indexOf(focusedControl);
                const currentIndex = rawIndex === -1 ? buttons.indexOf('play') : rawIndex;
                if (direction === 'left') {
                    const newIndex = Math.max(0, currentIndex - 1);
                    setFocusedControl(buttons[newIndex]);
                } else {
                    const newIndex = Math.min(buttons.length - 1, currentIndex + 1);
                    setFocusedControl(buttons[newIndex]);
                }
            }
            // Seek with left/right when on play button
            if (focusedControl === 'play') {
                if (direction === 'left') {
                    // Only seek if already at leftmost position
                    const buttons = getControlButtons();
                    const currentIndex = buttons.indexOf(focusedControl);
                    if (currentIndex === 0 || (currentIndex === 1 && buttons[0] === 'close')) {
                        // Don't seek, just navigate
                    }
                } else if (direction === 'right') {
                    // Don't seek, just navigate
                }
            }
        }
    }, [playerFocus, qualityLevels.length, channelList?.length, focusedControl, getControlButtons, resetHideControlsTimer, closeZapList]);

    const handleEnter = useCallback(() => {
        resetHideControlsTimer();

        if (playerFocus === 'zap-list') {
            const channel = channelList?.[zapIndex];
            if (channel) {
                onSwitchChannel?.(channel.stream_id);
                closeZapList();
            }
        } else if (playerFocus === 'quality-menu') {
            if (qualityMenuIndex === 0) {
                selectQuality(-1);
            } else {
                const level = qualityLevels[qualityMenuIndex - 1];
                if (level) selectQuality(level.index);
            }
        } else {
            executeControlAction();
        }
    }, [playerFocus, qualityMenuIndex, qualityLevels, selectQuality, executeControlAction, resetHideControlsTimer, channelList, zapIndex, onSwitchChannel, closeZapList]);

    const handleBack = useCallback(() => {
        if (playerFocus === 'zap-list') {
            closeZapList();
        } else if (playerFocus === 'quality-menu') {
            closeQualityMenu();
        } else if (onClose) {
            handleClose();
        }
    }, [playerFocus, closeZapList, closeQualityMenu, handleClose, onClose]);

    // TV Navigation hook
    useTVNavigation({
        onNavigate: handleNavigate,
        onEnter: handleEnter,
        onBack: handleBack,
        enabled: true
    });

    const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isLive || contentType === 'live') return;
        const rect = e.currentTarget.getBoundingClientRect();
        const clickPosition = (e.clientX - rect.left) / rect.width;
        seek(clickPosition * duration);
    };

    const handleProgressHover = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isLive || contentType === 'live' || !progressRef.current) return;
        const rect = progressRef.current.getBoundingClientRect();
        const position = (e.clientX - rect.left) / rect.width;
        setHoverPosition(e.clientX - rect.left);
        setHoverTime(position * duration);
    };

    // Helpers
    const formatTime = (seconds: number): string => {
        if (!isFinite(seconds)) return '0:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const percentage = (value: number, total: number): number => {
        return total > 0 ? (value / total) * 100 : 0;
    };

    const getCurrentQualityLabel = (): string => {
        if (isAutoQuality) {
            const current = qualityLevels.find(l => l.index === currentQualityIndex);
            return current ? `Auto (${current.label})` : 'Auto';
        }
        const level = qualityLevels.find(l => l.index === currentQualityIndex);
        return level?.label || 'Auto';
    };

    return (
        <div
            ref={containerRef}
            className="video-player-container"
            onMouseMove={resetHideControlsTimer}
        >
            {/* Close Button */}
            {onClose && showControls && (
                <button
                    className={`video-player-close ${focusedControl === 'close' && playerFocus === 'controls' ? 'focused' : ''}`}
                    onClick={handleClose}
                >
                    ✕
                </button>
            )}

            {/* Title */}
            {title && showControls && (
                <div className="video-player-title">{title}</div>
            )}

            {/* Video Wrapper */}
            <div className="video-wrapper">
                {/* Proporção via classes (o CSS base usa !important; style
                    inline sem !important perderia — achado da revisão) */}
                <video
                    ref={videoRef}
                    className={`video-element aspect-${aspectMode}`}
                    poster={poster}
                    onClick={togglePlay}
                    playsInline
                />
            </div>

            {/* Aviso "a seguir" perto do fim do programa (item 9) */}
            {nextSoon && !showControls && liveEpg?.now && (
                <div className="next-soon-banner">
                    Em {Math.max(1, Math.ceil((liveEpg.now.end - Date.now()) / 60000))} min: {nextSoon.title}
                </div>
            )}

            {/* OSD do digit-jump (troca de canal por número) */}
            {digitBuffer && (
                <div className="digit-osd">{digitBuffer}</div>
            )}

            {/* Overlay de zapping (lista de canais) */}
            {playerFocus === 'zap-list' && channelList && channelList.length > 0 && (() => {
                const half = Math.floor(ZAP_WINDOW / 2);
                const start = Math.max(0, Math.min(zapIndex - half, channelList.length - ZAP_WINDOW));
                const visible = channelList.slice(start, start + ZAP_WINDOW);
                return (
                    <div className="zap-overlay">
                        <div className="zap-overlay-header">📺 Canais</div>
                        <div className="zap-overlay-list">
                            {visible.map((channel, i) => {
                                const realIndex = start + i;
                                return (
                                    <div
                                        key={channel.stream_id}
                                        className={`zap-item ${realIndex === zapIndex ? 'focused' : ''} ${channel.stream_id === currentChannelId ? 'current' : ''}`}
                                        onClick={() => {
                                            onSwitchChannel?.(channel.stream_id);
                                            closeZapList();
                                        }}
                                    >
                                        {channel.num != null && <span className="zap-num">{channel.num}</span>}
                                        <span className="zap-name">
                                            {channel.name}
                                            {realIndex === zapIndex && zapEpg?.id === channel.stream_id && (
                                                <span className="zap-epg-now">agora: {zapEpg.title}</span>
                                            )}
                                        </span>
                                        {channel.stream_id === currentChannelId && <span className="zap-playing">▶</span>}
                                    </div>
                                );
                            })}
                        </div>
                        <div className="zap-overlay-hint">↑↓ Navegar · OK Assistir · ← Fechar</div>
                    </div>
                );
            })()}

            {/* Central Play Button */}
            {!playing && !loading && !error && (
                <div className="central-play-button" onClick={togglePlay}>
                    <div className="central-play-icon">
                        <FaPlay />
                    </div>
                </div>
            )}

            {/* Loading Spinner */}
            {loading && (
                <div className="video-player-loading">
                    <div className="modern-spinner">
                        <div className="spinner-ring"></div>
                        <div className="spinner-ring"></div>
                        <div className="spinner-ring"></div>
                    </div>
                    <span className="loading-text">Carregando...</span>
                </div>
            )}

            {/* Reconectando (R1 item 44) */}
            {reconnecting && !error && (
                <div className="reconnect-overlay">
                    🔄 Reconectando… tentativa {reconnectAttempt}/{MAX_RECONNECT_ATTEMPTS}
                </div>
            )}

            {/* Error State */}
            {error && (
                <div className="video-player-error">
                    <p>⚠️ {error}</p>
                    {onClose && <button onClick={handleClose}>Fechar</button>}
                </div>
            )}

            {/* Quality Menu */}
            {showQualityMenu && qualityLevels.length > 0 && (
                <div className="quality-menu">
                    <div className="quality-menu-header">
                        <FaCog /> Qualidade
                    </div>
                    <div className="quality-menu-items">
                        <div
                            className={`quality-menu-item ${qualityMenuIndex === 0 ? 'focused' : ''} ${isAutoQuality ? 'selected' : ''}`}
                            onClick={() => selectQuality(-1)}
                        >
                            Auto {isAutoQuality && currentQualityIndex >= 0 && `(${qualityLevels.find(l => l.index === currentQualityIndex)?.label})`}
                        </div>
                        {qualityLevels.map((level, idx) => (
                            <div
                                key={level.index}
                                className={`quality-menu-item ${qualityMenuIndex === idx + 1 ? 'focused' : ''} ${!isAutoQuality && currentQualityIndex === level.index ? 'selected' : ''}`}
                                onClick={() => selectQuality(level.index)}
                            >
                                {level.label}
                                <span className="quality-bitrate">
                                    {Math.round(level.bitrate / 1000)} kbps
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Controls */}
            <div className={`video-player-controls ${showControls ? 'visible' : 'hidden'}`}>
                {/* Mini-EPG (live) */}
                {isLiveContent && liveEpg?.now && (
                    <div className="player-mini-epg">
                        <div className="mini-epg-row">
                            <span className="mini-epg-title">{liveEpg.now.title}</span>
                            <span className="mini-epg-time">
                                {formatClock(liveEpg.now.start)} – {formatClock(liveEpg.now.end)}
                            </span>
                        </div>
                        <div className="mini-epg-progress">
                            <div
                                className="mini-epg-progress-fill"
                                style={{ width: `${epgProgressPct(liveEpg.now)}%` }}
                            />
                        </div>
                        {liveEpg.next && (
                            <div className="mini-epg-next">A seguir: {liveEpg.next.title}</div>
                        )}
                    </div>
                )}

                {/* Progress Bar (VOD only) */}
                {!isLive && contentType !== 'live' && (
                    <div
                        ref={progressRef}
                        className="progress-container"
                        onClick={handleProgressClick}
                        onMouseMove={handleProgressHover}
                        onMouseLeave={() => setHoverTime(null)}
                    >
                        {hoverTime !== null && (
                            <div
                                className="time-preview-tooltip"
                                style={{ left: `${hoverPosition}px` }}
                            >
                                {formatTime(hoverTime)}
                            </div>
                        )}
                        <div className="progress-bar">
                            <div
                                className="progress-buffered"
                                style={{ width: `${percentage(buffered, duration)}%` }}
                            />
                            <div
                                className="progress-played"
                                style={{ width: `${percentage(currentTime, duration)}%` }}
                            />
                            <div
                                className="progress-handle"
                                style={{ left: `${percentage(currentTime, duration)}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Controls Row */}
                <div className="controls-row">
                    <div className="controls-left">
                        {/* Previous Episode */}
                        {canGoPrevious && onPreviousEpisode && (
                            <button
                                className={`control-btn ${focusedControl === 'prev' && playerFocus === 'controls' ? 'focused' : ''}`}
                                onClick={onPreviousEpisode}
                            >
                                <FaStepBackward />
                            </button>
                        )}

                        {/* Play/Pause */}
                        <button
                            className={`control-btn ${focusedControl === 'play' && playerFocus === 'controls' ? 'focused' : ''}`}
                            onClick={togglePlay}
                        >
                            {playing ? <FaPause /> : <FaPlay />}
                        </button>

                        {/* Next Episode */}
                        {canGoNext && onNextEpisode && (
                            <button
                                className={`control-btn ${focusedControl === 'next' && playerFocus === 'controls' ? 'focused' : ''}`}
                                onClick={onNextEpisode}
                            >
                                <FaStepForward />
                            </button>
                        )}

                        {/* Time / Live Badge */}
                        {isLiveContent ? (
                            isBehindLive ? (
                                <button
                                    className={`live-badge live-badge-behind ${focusedControl === 'golive' && playerFocus === 'controls' ? 'focused' : ''}`}
                                    onClick={seekToLive}
                                >
                                    <span className="live-dot" />
                                    VOLTAR AO VIVO
                                </button>
                            ) : (
                                <span className="live-badge">
                                    <span className="live-dot" />
                                    AO VIVO
                                </span>
                            )
                        ) : (
                            <span className="time-display">
                                {formatTime(currentTime)} / {formatTime(duration)}
                            </span>
                        )}
                    </div>

                    <div className="controls-right">
                        {/* Quality Button */}
                        {qualityLevels.length > 0 && (
                            <button
                                className={`control-btn quality-btn ${focusedControl === 'quality' && playerFocus === 'controls' ? 'focused' : ''}`}
                                onClick={openQualityMenu}
                                title="Qualidade"
                            >
                                <FaCog />
                                <span className="quality-label">{getCurrentQualityLabel()}</span>
                            </button>
                        )}

                        {/* Channel List Button (live) */}
                        {canZap && (
                            <button
                                className={`control-btn ${focusedControl === 'channels' && playerFocus === 'controls' ? 'focused' : ''}`}
                                onClick={openZapList}
                                title="Lista de canais"
                            >
                                <FaListUl />
                            </button>
                        )}

                        {/* Sleep Timer Button */}
                        <button
                            className={`control-btn ${sleepUntil ? 'active' : ''} ${focusedControl === 'sleep' && playerFocus === 'controls' ? 'focused' : ''}`}
                            onClick={cycleSleep}
                            title="Timer de desligamento"
                        >
                            <FaMoon />
                            {sleepRemainingMin != null && (
                                <span className="quality-label">{sleepRemainingMin}m</span>
                            )}
                        </button>

                        {/* Aspect Ratio Button */}
                        <button
                            className={`control-btn ${focusedControl === 'aspect' && playerFocus === 'controls' ? 'focused' : ''}`}
                            onClick={cycleAspect}
                            title="Proporção"
                        >
                            <FaExpand />
                            {aspectMode !== 'original' && (
                                <span className="quality-label">{ASPECT_LABELS[aspectMode]}</span>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
