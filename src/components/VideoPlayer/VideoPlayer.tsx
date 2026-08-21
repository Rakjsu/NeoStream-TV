// VideoPlayer Component - Premium player with HLS support for TV
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FaPlay, FaPause, FaCog, FaStepForward, FaStepBackward, FaListUl, FaMoon, FaExpand } from 'react-icons/fa';
import { useHls, type StreamErrorCause } from '../../hooks/useHls';
import { playbackPrefs } from '../../services/playbackPrefs';
import { useTVNavigation } from '../../hooks/useTVNavigation';
import { epgService, type EpgProgram } from '../../services/epgService';
import { aspectPrefs, ASPECT_MODES, ASPECT_LABELS, type AspectMode } from '../../services/liveExtras';
import {
    qualityByContent,
    qualityCap,
    subtitleSize as subtitleSizePref,
    statsOverlay,
    SUBTITLE_SIZES,
    SUBTITLE_SIZE_LABELS,
    type SubtitleSize,
} from '../../services/playerPrefs';
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
    /**
     * Pause live (item 8): o canal tem catch-up, então pausar troca pro
     * timeshift daquele instante. A página devolve a URL; null = sem suporte.
     */
    onRequestPauseLive?: (pausedAtMs: number) => string | null;
    /** Canal de rádio (item 13): UI de áudio, sem vídeo */
    isRadio?: boolean;
    /**
     * Contador de episódios emendados sozinhos (item 51). Precisa vir do PAI:
     * quem usa fila de episódios remonta o player a cada avanço (key por
     * episódio), e um contador interno voltaria a zero toda vez.
     */
    autoAdvanceCountRef?: React.MutableRefObject<number>;
}

// Control buttons: close, prev, play, next, options, channels, sleep, aspect
type ControlButton = 'close' | 'prev' | 'play' | 'golive' | 'next' | 'options' | 'channels' | 'sleep' | 'aspect';
// 'seekbar' = barra de progresso focada (seek por D-pad, item 37)
type PlayerFocus = 'controls' | 'menu' | 'zap-list' | 'seekbar';
// Uma tela por vez; 'root' lista as seções (item 39/40/41/48)
type MenuId = 'root' | 'quality' | 'audio' | 'subs' | 'subsize';

interface MenuEntry {
    label: string;
    hint?: string;
    selected?: boolean;
    run: () => void;
}

const SLEEP_CHOICES = [null, 30, 60, 90] as const;
// Seek por D-pad (item 37): passo cresce enquanto a tecla é martelada
const SEEK_REPEAT_MS = 500;   // acima disso o contador de aceleração zera
const SEEK_COMMIT_MS = 450;   // pulos são acumulados e aplicados de uma vez
const SEEK_STEPS = [10, 30, 60];
// Retomar recuando um pouco reancora o contexto da cena (item 49)
const RESUME_REWIND_SECONDS = 5;
// Episódios emendados sem NENHUM toque no controle antes de perguntar (item 51)
const AUTO_EPISODE_LIMIT = 3;
const STILL_WATCHING_TIMEOUT_MS = 90000;
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

/** Relógio do modo rádio: a tela fica parada, então o horário é o conteúdo. */
function RadioClock() {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), 30000);
        return () => clearInterval(interval);
    }, []);
    return (
        <div className="radio-clock">
            {now.getHours().toString().padStart(2, '0')}:{now.getMinutes().toString().padStart(2, '0')}
        </div>
    );
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
    onStreamFailed,
    onRequestPauseLive,
    isRadio = false,
    autoAdvanceCountRef
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
    const [menu, setMenu] = useState<MenuId | null>(null);
    const [menuIndex, setMenuIndex] = useState(0);
    const [playerFocus, setPlayerFocus] = useState<PlayerFocus>('controls');
    const [focusedControl, setFocusedControl] = useState<ControlButton>('play');

    // Preferências persistidas do player (itens 41 e 48)
    const [subSize, setSubSize] = useState<SubtitleSize>(() => subtitleSizePref.get());
    const [showStats, setShowStats] = useState(() => statsOverlay.get());
    const [stats, setStats] = useState<{
        bitrate: number; width: number; height: number; dropped: number; buffer: number;
    } | null>(null);

    // Seek acelerado por D-pad (item 37): alvo em ref (o commit roda num
    // timeout e precisa do valor mais recente), display em estado
    const seekTargetRef = useRef<number | null>(null);
    const seekCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const seekAccelRef = useRef({ last: 0, count: 0 });
    const [seekDisplay, setSeekDisplay] = useState<{ target: number; step: number } | null>(null);

    // "Ainda está assistindo?" (item 51): conta episódios emendados sozinhos.
    // Qualquer interação com o controle zera a contagem — quem está ali
    // assistindo de verdade não precisa levar pergunta na cara.
    const localAutoAdvanceRef = useRef(0);
    const autoAdvanceRef = autoAdvanceCountRef ?? localAutoAdvanceRef;
    const [stillWatching, setStillWatching] = useState(false);

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
        setPausedLiveSrc(null);
    }, [src]);

    // Atrás do vivo? (pausou/atrasou num canal ao vivo → botão AO VIVO)
    const [isBehindLive, setIsBehindLive] = useState(false);
    // Pause live (item 8): URL de timeshift criada ao pausar o ao vivo
    const [pausedLiveSrc, setPausedLiveSrc] = useState<string | null>(null);
    // Espelho em ref: listeners de deps vazias precisam do valor atual
    const pausedLiveSrcRef = useRef<string | null>(null);
    useEffect(() => {
        pausedLiveSrcRef.current = pausedLiveSrc;
    }, [pausedLiveSrc]);

    // Reconexão com backoff (R1 itens 43/44/74): tentativa visível + watchdog
    const [reconnectAttempt, setReconnectAttempt] = useState(0);
    const [reconnecting, setReconnecting] = useState(false);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttemptRef = useRef(0);
    // VOD: posição capturada antes do reload (o pipeline recomeça em 0)
    const reloadResumeRef = useRef<number | null>(null);
    // Terminal: tentativas esgotadas — watchdog para de re-agendar
    const streamFailedRef = useRef(false);

    // Enquanto pausado-no-vivo, a fonte é o timeshift daquele instante
    const effectiveSrc = pausedLiveSrc || src;

    // HLS hook with quality support
    const {
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
    } = useHls({
        src: effectiveSrc,
        videoRef,
        // Ao trocar pro timeshift da PAUSA o autoplay não pode disparar —
        // senão o vídeo volta a tocar sozinho e a pausa não acontece
        autoPlay: autoPlay && !pausedLiveSrc,
        isLive: isLive || contentType === 'live',
        onError: (cause) => setError(CAUSE_MESSAGES[cause || 'fatal']),
        onStreamError: (cause) => scheduleReconnect(cause || 'fatal'),
    });

    // Qualidade manual lembrada por conteúdo (item 46). Guardada por ALTURA:
    // o índice do nível muda entre variantes do mesmo canal.
    const qualityAppliedRef = useRef<string>('');
    useEffect(() => {
        // reload() (retry/watchdog/standby) zera os níveis sem trocar o src:
        // liberar a trava aqui é o que faz a preferência voltar depois dele
        if (qualityLevels.length === 0) {
            qualityAppliedRef.current = '';
            return;
        }
        if (qualityAppliedRef.current === effectiveSrc) return;
        qualityAppliedRef.current = effectiveSrc;
        const savedHeight = qualityByContent.get(contentKey);
        if (savedHeight == null) return;
        // O teto global ganha da preferência por canal: quem limitou a
        // qualidade fez isso por causa da rede, não por causa deste canal
        const cap = qualityCap.get();
        if (cap > 0 && savedHeight > cap) return;
        const match = qualityLevels.find(level => level.height === savedHeight);
        if (match) setQuality(match.index);
    }, [qualityLevels, effectiveSrc, contentKey, setQuality]);

    // Estatísticas do stream (item 48) — só roda com o overlay ligado
    useEffect(() => {
        if (!showStats) return;
        const interval = setInterval(() => {
            const video = videoRef.current;
            if (!video) return;
            const hls = hlsRef.current;
            const level = hls && hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : null;
            const quality = typeof video.getVideoPlaybackQuality === 'function'
                ? video.getVideoPlaybackQuality()
                : null;
            const bufferEnd = video.buffered.length > 0
                ? video.buffered.end(video.buffered.length - 1)
                : video.currentTime;
            setStats({
                bitrate: level?.bitrate || 0,
                width: level?.width || video.videoWidth || 0,
                height: level?.height || video.videoHeight || 0,
                dropped: quality?.droppedVideoFrames ?? 0,
                buffer: Math.max(0, bufferEnd - video.currentTime),
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [showStats, hlsRef]);

    // Volta do standby / troca de fonte da TV (item 52): o pipeline do MSE
    // morre em silêncio enquanto a página fica escondida — o vídeo volta
    // congelado sem disparar nenhum erro. Re-inicializa se a ausência foi longa.
    useEffect(() => {
        let hiddenAt = 0;
        let hiddenWhilePlaying = false;
        const handleVisibility = () => {
            if (document.hidden) {
                hiddenAt = Date.now();
                hiddenWhilePlaying = !!videoRef.current && !videoRef.current.paused;
                return;
            }
            const away = hiddenAt ? Date.now() - hiddenAt : 0;
            hiddenAt = 0;
            if (away < 20000) return;
            // Pausado antes do standby → o usuário quis parar; re-inicializar
            // aqui faria o vídeo voltar a tocar sozinho
            if (!hiddenWhilePlaying) return;
            const video = videoRef.current;
            if (!isLiveContent && video && video.currentTime > 5) {
                reloadResumeRef.current = video.currentTime;
            }
            reload();
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [reload, isLiveContent]);

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
            // Cinto e suspensório do pause live: a fonte de pausa nunca
            // pode começar tocando (o usuário acabou de apertar pausa)
            if (pausedLiveSrcRef.current && video && !video.paused) {
                video.pause();
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
        // ⚙ sempre aparece: mesmo sem níveis de qualidade ele dá acesso a
        // áudio, legenda e estatísticas
        buttons.push('options');
        if (canZap) buttons.push('channels');
        buttons.push('sleep');
        buttons.push('aspect');
        return buttons;
    }, [canGoPrevious, canGoNext, onPreviousEpisode, onNextEpisode, canZap, isLiveContent, isBehindLive]);

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
        // Volta pro stream ao vivo de verdade (larga o timeshift da pausa)
        setPausedLiveSrc(null);
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
        // "Retomar de onde parou" é opcional (item 66): quem prefere sempre
        // do começo não quer ser jogado no meio do filme
        if (!playbackPrefs.get().resume) return;
        if (!resumeTime || !videoRef.current || resumeAppliedRef.current) return;

        const video = videoRef.current;

        const applyResumeTime = () => {
            if (video && resumeTime && !resumeAppliedRef.current) {
                // Recuar alguns segundos reancora a cena (item 49)
                const target = Math.max(0, resumeTime - RESUME_REWIND_SECONDS);
                if (Math.abs(video.currentTime - target) > 5) {
                    video.currentTime = target;
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

    // Fim do vídeo = assistido (item 50). Sem isso, o último timeupdate podia
    // ficar 5s antes do fim e o título nunca saía de "Continuar assistindo".
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !onTimeUpdate) return;
        const handleEnded = () => {
            const total = video.duration || 0;
            if (total > 0) onTimeUpdate(total, total);
        };
        video.addEventListener('ended', handleEnded);
        return () => video.removeEventListener('ended', handleEnded);
    }, [onTimeUpdate]);

    // Auto go to next episode when video ends
    useEffect(() => {
        if (!videoRef.current || !onNextEpisode || !canGoNext) return;

        const video = videoRef.current;
        const handleEnded = () => {
            // Emendar o próximo é opcional (item 66); o botão ⏭ continua valendo
            if (!playbackPrefs.get().autoNextEpisode) return;
            autoAdvanceRef.current += 1;
            if (autoAdvanceRef.current >= AUTO_EPISODE_LIMIT) {
                // Não emenda: pergunta e para de consumir banda até responder
                setStillWatching(true);
                return;
            }
            onNextEpisode();
        };

        video.addEventListener('ended', handleEnded);
        return () => video.removeEventListener('ended', handleEnded);
    }, [onNextEpisode, canGoNext, autoAdvanceRef]);

    // Sem resposta = a TV ficou ligada sozinha: fecha o player
    useEffect(() => {
        if (!stillWatching) return;
        const timeout = setTimeout(() => handleCloseRef.current?.(), STILL_WATCHING_TIMEOUT_MS);
        return () => clearTimeout(timeout);
    }, [stillWatching]);

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

    // handleClose é declarado depois; o timeout do "ainda está assistindo"
    // precisa da versão mais recente sem virar dependência circular
    const handleCloseRef = useRef<(() => void) | null>(null);

    // Auto-hide controls
    const resetHideControlsTimer = useCallback(() => {
        // Qualquer sinal de vida zera a contagem de episódios emendados
        autoAdvanceRef.current = 0;
        setShowControls(true);
        if (hideControlsTimeoutRef.current) {
            clearTimeout(hideControlsTimeoutRef.current);
        }
        hideControlsTimeoutRef.current = setTimeout(() => {
            // Esconder a barra com ela FOCADA deixaria o seek às cegas
            if (playing && !menu && playerFocusRef.current !== 'seekbar') {
                setShowControls(false);
            }
        }, 3000);
    }, [playing, menu, autoAdvanceRef]);

    // Video event handlers
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handlePlay = () => setPlaying(true);
        const handlePause = () => setPlaying(false);
        const handleTimeUpdateLocal = () => setCurrentTime(video.currentTime);
        // Stream sem duração conhecida chega como Infinity: deixar isso passar
        // habilitava a barra de seek com ←→ que não faziam nada
        const handleDurationChange = () =>
            setDuration(Number.isFinite(video.duration) ? video.duration : 0);
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

    useEffect(() => {
        handleCloseRef.current = handleClose;
    }, [handleClose]);

    /** Confirma que ainda há alguém assistindo e emenda o próximo episódio. */
    const confirmStillWatching = useCallback(() => {
        autoAdvanceRef.current = 0;
        setStillWatching(false);
        onNextEpisode?.();
    }, [onNextEpisode, autoAdvanceRef]);

    // Controls
    const togglePlay = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            video.play();
            return;
        }
        video.pause();
        // Canal ao vivo com catch-up: troca pro timeshift do instante da
        // pausa, então retomar continua de onde parou (item 8)
        if (isLiveContent && !pausedLiveSrc && onRequestPauseLive) {
            const url = onRequestPauseLive(Date.now());
            if (url) {
                setPausedLiveSrc(url);
                setIsBehindLive(true);
            }
        }
         
    }, [isLiveContent, pausedLiveSrc, onRequestPauseLive]);

    const seek = useCallback((time: number) => {
        const video = videoRef.current;
        if (video) {
            video.currentTime = time;
        }
    }, []);

    // Aplica de uma vez o pulo acumulado. Cada tecla mexer no currentTime
    // faria o HLS re-buscar segmento a segmento e travar a TV.
    const commitSeek = useCallback(() => {
        const video = videoRef.current;
        const target = seekTargetRef.current;
        seekTargetRef.current = null;
        if (seekCommitRef.current) {
            clearTimeout(seekCommitRef.current);
            seekCommitRef.current = null;
        }
        setSeekDisplay(null);
        if (video && target != null) {
            video.currentTime = target;
        }
    }, []);

    /** Um passo de seek; martelar a tecla acelera 10s → 30s → 1min (item 37). */
    const nudgeSeek = useCallback((direction: -1 | 1) => {
        const video = videoRef.current;
        if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
        const now = Date.now();
        const accel = seekAccelRef.current;
        accel.count = now - accel.last < SEEK_REPEAT_MS ? accel.count + 1 : 1;
        accel.last = now;
        const step = accel.count > 10 ? SEEK_STEPS[2] : accel.count > 4 ? SEEK_STEPS[1] : SEEK_STEPS[0];
        const base = seekTargetRef.current ?? video.currentTime;
        const target = Math.max(0, Math.min(video.duration, base + direction * step));
        seekTargetRef.current = target;
        setSeekDisplay({ target, step });
        if (seekCommitRef.current) clearTimeout(seekCommitRef.current);
        seekCommitRef.current = setTimeout(commitSeek, SEEK_COMMIT_MS);
    }, [commitSeek]);

    // Sair do player no meio de um seek deixaria o timeout pendente
    useEffect(() => {
        return () => {
            if (seekCommitRef.current) clearTimeout(seekCommitRef.current);
        };
    }, []);

    // Teclas de mídia do controle (item 38). Registradas no boot do App via
    // tvinputdevice; sem este listener elas não faziam nada no player.
    useEffect(() => {
        const handleMediaKeys = (event: KeyboardEvent) => {
            const video = videoRef.current;
            if (!video) return;
            const key = event.key || '';
            const code = event.keyCode;

            if (key === 'MediaPlayPause' || code === 10252) {
                event.preventDefault();
                togglePlay();
            } else if (key === 'MediaPlay' || code === 415) {
                event.preventDefault();
                if (video.paused) togglePlay();
            } else if (key === 'MediaPause' || code === 19) {
                event.preventDefault();
                if (!video.paused) togglePlay();
            } else if (key === 'MediaStop' || code === 413) {
                event.preventDefault();
                handleClose();
            } else if (key === 'MediaRewind' || code === 412) {
                event.preventDefault();
                if (!isLiveContent) nudgeSeek(-1);
            } else if (key === 'MediaFastForward' || code === 417) {
                event.preventDefault();
                if (!isLiveContent) nudgeSeek(1);
            } else if (key === 'MediaTrackNext' || code === 10233) {
                event.preventDefault();
                if (canGoNext) onNextEpisode?.();
            } else if (key === 'MediaTrackPrevious' || code === 10232) {
                event.preventDefault();
                if (canGoPrevious) onPreviousEpisode?.();
            }
        };
        window.addEventListener('keydown', handleMediaKeys);
        return () => window.removeEventListener('keydown', handleMediaKeys);
    }, [togglePlay, handleClose, nudgeSeek, isLiveContent, canGoNext, canGoPrevious, onNextEpisode, onPreviousEpisode]);

    // ----- Menu de opções (qualidade / áudio / legenda / stats) -----
    const openMenu = useCallback((id: MenuId) => {
        setMenu(id);
        setMenuIndex(0);
        setPlayerFocus('menu');
    }, []);

    const closeMenu = useCallback(() => {
        setMenu(null);
        setPlayerFocus('controls');
    }, []);

    const selectQuality = useCallback((index: number) => {
        if (index === -1) {
            setAutoQuality();
            qualityByContent.set(contentKey, null);
        } else {
            setQuality(index);
            // Lembra por ALTURA pra sobreviver à troca de variante (item 46)
            const level = qualityLevels.find(entry => entry.index === index);
            if (level) qualityByContent.set(contentKey, level.height);
        }
        closeMenu();
    }, [setQuality, setAutoQuality, closeMenu, contentKey, qualityLevels]);

    const toggleStats = useCallback(() => {
        setShowStats(prev => {
            statsOverlay.set(!prev);
            return !prev;
        });
    }, []);

    const currentAudioLabel = audioTracks.find(track => track.id === currentAudioTrack)?.label || '—';
    const currentSubLabel = currentSubtitleTrack >= 0
        ? (subtitleTracks.find(track => track.id === currentSubtitleTrack)?.label || 'Ligada')
        : 'Desligadas';

    // Itens do menu aberto. A raiz só mostra o que o stream realmente oferece —
    // linha morta em menu de TV é pior que ausência.
    const menuEntries = useMemo<MenuEntry[]>(() => {
        if (menu === 'root') {
            const entries: MenuEntry[] = [];
            if (qualityLevels.length > 0) {
                entries.push({
                    label: 'Qualidade',
                    hint: isAutoQuality ? 'Auto' : (qualityLevels.find(l => l.index === currentQualityIndex)?.label || 'Auto'),
                    run: () => openMenu('quality'),
                });
            }
            if (audioTracks.length > 1) {
                entries.push({ label: 'Áudio', hint: currentAudioLabel, run: () => openMenu('audio') });
            }
            if (subtitleTracks.length > 0) {
                entries.push({ label: 'Legendas', hint: currentSubLabel, run: () => openMenu('subs') });
                entries.push({
                    label: 'Tamanho da legenda',
                    hint: SUBTITLE_SIZE_LABELS[subSize],
                    run: () => openMenu('subsize'),
                });
            }
            entries.push({
                label: 'Estatísticas do stream',
                hint: showStats ? 'Ligadas' : 'Desligadas',
                run: toggleStats,
            });
            return entries;
        }
        if (menu === 'quality') {
            return [
                {
                    label: 'Auto',
                    hint: isAutoQuality && currentQualityIndex >= 0
                        ? qualityLevels.find(l => l.index === currentQualityIndex)?.label
                        : undefined,
                    selected: isAutoQuality,
                    run: () => selectQuality(-1),
                },
                ...qualityLevels.map(level => ({
                    label: level.label,
                    hint: `${Math.round(level.bitrate / 1000)} kbps`,
                    selected: !isAutoQuality && currentQualityIndex === level.index,
                    run: () => selectQuality(level.index),
                })),
            ];
        }
        if (menu === 'audio') {
            return audioTracks.map(track => ({
                label: track.label,
                hint: track.lang,
                selected: track.id === currentAudioTrack,
                run: () => { setAudioTrack(track.id); closeMenu(); },
            }));
        }
        if (menu === 'subs') {
            return [
                {
                    label: 'Desligadas',
                    selected: currentSubtitleTrack < 0,
                    run: () => { setSubtitleTrack(-1); closeMenu(); },
                },
                ...subtitleTracks.map(track => ({
                    label: track.label,
                    hint: track.lang,
                    selected: track.id === currentSubtitleTrack,
                    run: () => { setSubtitleTrack(track.id); closeMenu(); },
                })),
            ];
        }
        if (menu === 'subsize') {
            return SUBTITLE_SIZES.map(size => ({
                label: SUBTITLE_SIZE_LABELS[size],
                selected: size === subSize,
                run: () => {
                    subtitleSizePref.set(size);
                    setSubSize(size);
                    closeMenu();
                },
            }));
        }
        return [];
    }, [menu, qualityLevels, isAutoQuality, currentQualityIndex, audioTracks, currentAudioTrack,
        subtitleTracks, currentSubtitleTrack, subSize, showStats, currentAudioLabel, currentSubLabel,
        openMenu, selectQuality, setAudioTrack, setSubtitleTrack, closeMenu, toggleStats]);

    // As listas vêm do useHls, que as ESVAZIA em todo reload() (retry,
    // watchdog de travamento, volta do standby) — não só na troca de canal.
    // Sem isto, o foco continuava em 'menu' com o overlay já fora da tela:
    // ↑↓ e OK mortos, e Voltar abrindo menu em vez de fechar o player.
    // Ajuste durante o render (mesmo padrão do lastSrc); effect com setState
    // é proibido pela regra react-hooks/set-state-in-effect.
    const [lastEntryCount, setLastEntryCount] = useState(menuEntries.length);
    if (menuEntries.length !== lastEntryCount) {
        setLastEntryCount(menuEntries.length);
        if (menuEntries.length === 0) {
            setMenu(null);
            setMenuIndex(0);
            if (playerFocus === 'menu') setPlayerFocus('controls');
        } else if (menuIndex > menuEntries.length - 1) {
            setMenuIndex(menuEntries.length - 1);
        }
    }

    const MENU_TITLES: Record<MenuId, string> = {
        root: 'Opções',
        quality: 'Qualidade',
        audio: 'Áudio',
        subs: 'Legendas',
        subsize: 'Tamanho da legenda',
    };

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
            case 'options':
                openMenu('root');
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
    }, [focusedControl, handleClose, onPreviousEpisode, togglePlay, onNextEpisode, openMenu, openZapList, cycleSleep, cycleAspect, seekToLive]);

    // TV Navigation handler
    const handleNavigate = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
        if (stillWatching) return; // só OK (continuar) ou Voltar (sair)
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
        } else if (playerFocus === 'menu') {
            const total = menuEntries.length;
            if (direction === 'up') {
                setMenuIndex(prev => Math.max(0, prev - 1));
            } else if (direction === 'down') {
                setMenuIndex(prev => Math.min(total - 1, prev + 1));
            } else if (direction === 'left') {
                // ← volta pra raiz (ou fecha, se já está nela)
                if (menu && menu !== 'root') openMenu('root'); else closeMenu();
            }
        } else if (playerFocus === 'seekbar') {
            // Barra focada: ←→ pulam com aceleração, ↓ volta pros botões
            if (direction === 'left') nudgeSeek(-1);
            else if (direction === 'right') nudgeSeek(1);
            else if (direction === 'down') {
                commitSeek();
                setPlayerFocus('controls');
            }
        } else {
            // ↑ sobe pra barra de progresso (só VOD tem barra)
            if (direction === 'up' && !isLiveContent && duration > 0) {
                setPlayerFocus('seekbar');
                return;
            }
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
    }, [playerFocus, menu, menuEntries.length, channelList?.length, focusedControl, getControlButtons,
        resetHideControlsTimer, closeZapList, openMenu, closeMenu, nudgeSeek, commitSeek, isLiveContent,
        duration, stillWatching]);

    const handleEnter = useCallback(() => {
        if (stillWatching) {
            confirmStillWatching();
            return;
        }
        resetHideControlsTimer();

        if (playerFocus === 'zap-list') {
            const channel = channelList?.[zapIndex];
            if (channel) {
                onSwitchChannel?.(channel.stream_id);
                closeZapList();
            }
        } else if (playerFocus === 'menu') {
            menuEntries[menuIndex]?.run();
        } else if (playerFocus === 'seekbar') {
            // OK confirma o pulo pendente; sem pulo, é play/pause
            if (seekTargetRef.current != null) commitSeek();
            else togglePlay();
        } else {
            executeControlAction();
        }
    }, [playerFocus, menuIndex, menuEntries, executeControlAction, resetHideControlsTimer,
        channelList, zapIndex, onSwitchChannel, closeZapList, commitSeek, togglePlay,
        stillWatching, confirmStillWatching]);

    const handleBack = useCallback(() => {
        if (stillWatching) {
            handleClose();
            return;
        }
        if (playerFocus === 'zap-list') {
            closeZapList();
        } else if (playerFocus === 'menu') {
            // Voltar sobe um nível antes de fechar — submenu não pode
            // jogar o usuário direto pra fora do player
            if (menu && menu !== 'root') openMenu('root');
            else closeMenu();
        } else if (playerFocus === 'seekbar') {
            commitSeek();
            setPlayerFocus('controls');
        } else if (onClose) {
            handleClose();
        }
    }, [playerFocus, closeZapList, closeMenu, openMenu, menu, commitSeek, handleClose, onClose, stillWatching]);

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
                    className={`video-element aspect-${aspectMode} sub-${subSize} ${isRadio ? 'radio-hidden' : ''}`}
                    poster={isRadio ? undefined : poster}
                    onClick={togglePlay}
                    playsInline
                />
                {/* Modo rádio (item 13): sem imagem no stream — logo + relógio */}
                {isRadio && (
                    <div className="radio-stage">
                        {poster
                            ? <img className="radio-logo" src={poster} alt={title || 'Rádio'} />
                            : <div className="radio-logo radio-logo-fallback">📻</div>}
                        <div className="radio-name">{title}</div>
                        <RadioClock />
                        <div className="radio-hint">CH+ / CH− trocam de estação</div>
                    </div>
                )}
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

            {/* Ainda está assistindo? (item 51) */}
            {stillWatching && (
                <div className="still-watching">
                    <div className="still-watching-title">Ainda está assistindo?</div>
                    <div className="still-watching-sub">
                        {AUTO_EPISODE_LIMIT} episódios seguidos sem toque no controle.
                    </div>
                    <button className="still-watching-btn" onClick={confirmStillWatching}>
                        ▶ Continuar
                    </button>
                    <div className="still-watching-hint">OK continua · Voltar sai</div>
                </div>
            )}

            {/* Pulo acumulado do seek por D-pad (item 37) */}
            {seekDisplay && (
                <div className="seek-osd">
                    <span className="seek-osd-target">{formatTime(seekDisplay.target)}</span>
                    <span className="seek-osd-step">passo de {seekDisplay.step}s</span>
                </div>
            )}

            {/* Estatísticas do stream (item 48) */}
            {showStats && stats && (
                <div className="stats-overlay">
                    <div>{stats.width}×{stats.height}</div>
                    <div>{stats.bitrate > 0 ? `${Math.round(stats.bitrate / 1000)} kbps` : '— kbps'}</div>
                    <div>buffer {stats.buffer.toFixed(1)}s</div>
                    <div>drops {stats.dropped}</div>
                </div>
            )}

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

            {/* Pausado no ao vivo (item 8) */}
            {pausedLiveSrc && !playing && (
                <div className="paused-live-badge">
                    ⏸ Pausado — retomar continua de onde parou
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

            {/* Menu de opções (qualidade / áudio / legendas / stats) */}
            {menu && menuEntries.length > 0 && (
                <div className="quality-menu">
                    <div className="quality-menu-header">
                        <FaCog /> {MENU_TITLES[menu]}
                    </div>
                    <div className="quality-menu-items">
                        {menuEntries.map((entry, index) => (
                            <div
                                key={`${entry.label}-${index}`}
                                className={`quality-menu-item ${menuIndex === index ? 'focused' : ''} ${entry.selected ? 'selected' : ''}`}
                                onClick={entry.run}
                            >
                                {entry.label}
                                {entry.hint && <span className="quality-bitrate">{entry.hint}</span>}
                            </div>
                        ))}
                    </div>
                    <div className="quality-menu-hint">OK escolhe · ← Voltar</div>
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
                        className={`progress-container ${playerFocus === 'seekbar' ? 'seek-focused' : ''}`}
                        onClick={handleProgressClick}
                        onMouseMove={handleProgressHover}
                        onMouseLeave={() => setHoverTime(null)}
                    >
                        {playerFocus === 'seekbar' && (
                            <div className="seek-hint">← → pulam · OK confirma · ↓ volta</div>
                        )}
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
                                style={{ width: `${percentage(seekDisplay?.target ?? currentTime, duration)}%` }}
                            />
                            <div
                                className="progress-handle"
                                style={{ left: `${percentage(seekDisplay?.target ?? currentTime, duration)}%` }}
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
                        {/* Options Button (qualidade, áudio, legendas, stats) */}
                        <button
                            className={`control-btn quality-btn ${focusedControl === 'options' && playerFocus === 'controls' ? 'focused' : ''}`}
                            onClick={() => openMenu('root')}
                            title="Opções"
                        >
                            <FaCog />
                            {qualityLevels.length > 0 && (
                                <span className="quality-label">{getCurrentQualityLabel()}</span>
                            )}
                        </button>

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
