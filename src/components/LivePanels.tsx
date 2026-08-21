// Painéis da TV ao vivo (backlog itens 7 e 12):
// - "Agora nos favoritos": programa atual + progresso de cada canal ⭐
// - "Jogos de hoje": eventos esportivos detectados no EPG
// Ambos buscam EPG sob demanda, com teto de canais pra não estourar a TV.

import { useState, useEffect, useRef } from 'react';
import { epgService, type EpgProgram } from '../services/epgService';
import { collectTodaysEvents, type SportsEvent } from '../services/liveDiscovery';
import { useTVNavigation } from '../hooks/useTVNavigation';
import type { LiveStream } from '../types';
import './LivePanels.css';

const MAX_FAVORITES = 20; // teto de requisições numa TV fraca
const MAX_SPORTS_CHANNELS = 25;

function formatClock(ms: number): string {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

interface FavoritesNowPanelProps {
    channels: LiveStream[];
    onClose: () => void;
    onPlay: (channel: LiveStream) => void;
    /** Modo reordenar (item 17): ←→ movem o canal focado */
    onMove?: (channel: LiveStream, direction: -1 | 1) => void;
}

export function FavoritesNowPanel({ channels, onClose, onPlay, onMove }: FavoritesNowPanelProps) {
    const [epgByChannel, setEpgByChannel] = useState<Map<number, EpgProgram | null>>(new Map());
    const [focusedIndex, setFocusedIndex] = useState(0);
    const [reordering, setReordering] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);
    const visible = channels.slice(0, MAX_FAVORITES);

    // EPG de cada favorito, em sequência (paralelo derruba TV fraca)
    useEffect(() => {
        let cancelled = false;
        (async () => {
            for (const channel of visible) {
                if (cancelled) return;
                const epg = await epgService.getChannelEpg(channel.stream_id);
                if (cancelled) return;
                setEpgByChannel(prev => new Map(prev).set(channel.stream_id, epg.now));
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [channels.length]);

    useEffect(() => {
        const focused = listRef.current?.querySelector('.fav-now-row.tv-focused');
        focused?.scrollIntoView({ block: 'nearest' });
    }, [focusedIndex]);

    const safeIndex = Math.min(focusedIndex, Math.max(0, visible.length - 1));

    useTVNavigation({
        onNavigate: (direction) => {
            if (visible.length === 0) return;
            if (direction === 'up') setFocusedIndex(prev => Math.max(0, prev - 1));
            else if (direction === 'down') setFocusedIndex(prev => Math.min(visible.length - 1, prev + 1));
            else if (reordering && onMove && (direction === 'left' || direction === 'right')) {
                const channel = visible[safeIndex];
                if (!channel) return;
                onMove(channel, direction === 'left' ? -1 : 1);
                setFocusedIndex(prev => Math.max(0, Math.min(visible.length - 1, prev + (direction === 'left' ? -1 : 1))));
            }
        },
        onEnter: () => {
            const channel = visible[safeIndex];
            if (channel) onPlay(channel);
        },
        onBack: onClose,
        onAction: (action) => {
            // 🟡 alterna o modo reordenar (item 17)
            if (action === 'yellow' && onMove) setReordering(prev => !prev);
        },
    });

    return (
        <div className="live-panel-overlay">
            <div className="live-panel">
                <div className="live-panel-header">
                    <h2 className="live-panel-title">⭐ Agora nos favoritos</h2>
                    <button className="live-panel-close" onClick={onClose}>✕</button>
                </div>

                <div ref={listRef} className="live-panel-list">
                    {visible.length === 0 && (
                        <div className="live-panel-empty">
                            Nenhum canal favorito ainda. Marque canais com ⭐ na TV ao vivo.
                        </div>
                    )}
                    {visible.map((channel, index) => {
                        const program = epgByChannel.get(channel.stream_id);
                        const pct = program ? epgService.progressPct(program) ?? 0 : 0;
                        return (
                            <div
                                key={channel.stream_id}
                                className={`fav-now-row ${safeIndex === index ? 'tv-focused' : ''} ${reordering ? 'reordering' : ''}`}
                                onClick={() => onPlay(channel)}
                            >
                                <span className="fav-now-name">{channel.name}</span>
                                <span className="fav-now-program">
                                    {program ? program.title : (epgByChannel.has(channel.stream_id) ? 'Sem programação' : 'Carregando…')}
                                </span>
                                {program && (
                                    <>
                                        <span className="fav-now-time">
                                            {formatClock(program.start)}–{formatClock(program.end)}
                                        </span>
                                        <span className="fav-now-progress">
                                            <span className="fav-now-progress-fill" style={{ width: `${pct}%` }} />
                                        </span>
                                    </>
                                )}
                                {reordering && <span className="fav-now-move">↔</span>}
                            </div>
                        );
                    })}
                </div>

                <div className="live-panel-hints">
                    <span>↑↓ Navegar</span>
                    <span>OK Assistir</span>
                    {onMove && <span>{reordering ? '🟡 Sair de reordenar · ←→ Mover' : '🟡 Reordenar'}</span>}
                    <span>← Fechar</span>
                </div>
            </div>
        </div>
    );
}

interface SportsPanelProps {
    channels: LiveStream[];
    onClose: () => void;
    onPlay: (channel: LiveStream) => void;
    onRemind: (event: SportsEvent) => void;
    isReminded: (event: SportsEvent) => boolean;
}

export function SportsPanel({ channels, onClose, onPlay, onRemind, isReminded }: SportsPanelProps) {
    const [events, setEvents] = useState<SportsEvent[] | null>(null);
    const [focusedIndex, setFocusedIndex] = useState(0);
    const [remindTick, setRemindTick] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const entries: Array<{ channel: LiveStream; programs: EpgProgram[] }> = [];
            for (const channel of channels.slice(0, MAX_SPORTS_CHANNELS)) {
                if (cancelled) return;
                const epg = await epgService.getChannelEpg(channel.stream_id, 12);
                if (cancelled) return;
                if (epg.programs.length > 0) entries.push({ channel, programs: epg.programs });
            }
            if (!cancelled) setEvents(collectTodaysEvents(entries, Date.now()));
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [channels.length]);

    useEffect(() => {
        const focused = listRef.current?.querySelector('.sports-row.tv-focused');
        focused?.scrollIntoView({ block: 'nearest' });
    }, [focusedIndex]);

    const list = events || [];
    const safeIndex = Math.min(focusedIndex, Math.max(0, list.length - 1));

    useTVNavigation({
        onNavigate: (direction) => {
            if (list.length === 0) return;
            if (direction === 'up') setFocusedIndex(prev => Math.max(0, prev - 1));
            else if (direction === 'down') setFocusedIndex(prev => Math.min(list.length - 1, prev + 1));
        },
        onEnter: () => {
            const event = list[safeIndex];
            if (!event) return;
            // No ar → assiste; futuro → lembrete
            if (event.program.start <= Date.now()) onPlay(event.channel);
            else {
                onRemind(event);
                setRemindTick(t => t + 1);
            }
        },
        onBack: onClose,
    });

    void remindTick; // força re-render após ligar/desligar lembrete

    return (
        <div className="live-panel-overlay">
            <div className="live-panel">
                <div className="live-panel-header">
                    <h2 className="live-panel-title">⚽ Jogos de hoje</h2>
                    <button className="live-panel-close" onClick={onClose}>✕</button>
                </div>

                <div ref={listRef} className="live-panel-list">
                    {events === null && <div className="live-panel-empty">Procurando eventos no guia…</div>}
                    {events !== null && list.length === 0 && (
                        <div className="live-panel-empty">
                            Nenhum evento encontrado hoje nos canais de esporte.
                        </div>
                    )}
                    {list.map((event, index) => {
                        const live = event.program.start <= Date.now();
                        const reminded = isReminded(event);
                        return (
                            <div
                                key={`${event.channel.stream_id}-${event.program.start}`}
                                className={`sports-row ${safeIndex === index ? 'tv-focused' : ''}`}
                                onClick={() => (live ? onPlay(event.channel) : onRemind(event))}
                            >
                                <span className="sports-time">{formatClock(event.program.start)}</span>
                                <span className="sports-title">{event.program.title}</span>
                                <span className="sports-channel">{event.channel.name}</span>
                                {live
                                    ? <span className="sports-badge-live">NO AR</span>
                                    : reminded
                                        ? <span className="sports-badge-bell">🔔 Lembrete</span>
                                        : <span className="sports-badge-hint">OK lembrar</span>}
                            </div>
                        );
                    })}
                </div>

                <div className="live-panel-hints">
                    <span>↑↓ Navegar</span>
                    <span>OK Assistir / Lembrar</span>
                    <span>← Fechar</span>
                </div>
            </div>
        </div>
    );
}
