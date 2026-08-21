// Agenda do dia do canal (backlog itens 2+4): programação completa via
// get_simple_data_table, navegável por D-pad. Programas passados com arquivo
// (catch-up) tocam via timeshift; o atual mostra NO AR.

import { useState, useEffect, useRef } from 'react';
import { epgService, type EpgProgram } from '../services/epgService';
import { useTVNavigation } from '../hooks/useTVNavigation';
import type { LiveStream } from '../types';
import './ChannelAgendaOverlay.css';

interface ChannelAgendaOverlayProps {
    channel: LiveStream;
    onClose: () => void;
    /** Tocar um programa do arquivo (a página monta a URL de timeshift) */
    onPlayArchive: (programs: EpgProgram[], index: number) => void;
    /** Liga/desliga lembrete de programa futuro (item 3); devolve se ficou ativo */
    onToggleReminder?: (program: EpgProgram) => boolean;
    isReminded?: (program: EpgProgram) => boolean;
}

function formatClock(ms: number): string {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function ChannelAgendaOverlay({ channel, onClose, onPlayArchive, onToggleReminder, isReminded }: ChannelAgendaOverlayProps) {
    const [programs, setPrograms] = useState<EpgProgram[] | null>(null);
    const [focusedIndex, setFocusedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);
    // Date.now() no render viola react-hooks/purity — congelado em state
    // e atualizado por tick de 30s (o NO AR acompanha o relógio)
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [reminderTick, setReminderTick] = useState(0);
    void reminderTick; // força re-render depois de ligar/desligar lembrete
    useEffect(() => {
        const interval = setInterval(() => setNowMs(Date.now()), 30000);
        return () => clearInterval(interval);
    }, []);

    const channelHasArchive = Number(channel.tv_archive) > 0;

    useEffect(() => {
        let cancelled = false;
        epgService.getDayEpg(channel.stream_id).then(list => {
            if (cancelled) return;
            setPrograms(list);
            // Foco inicial no programa NO AR (ou no último passado)
            const now = Date.now();
            const currentIndex = list.findIndex(p => p.start <= now && p.end > now);
            if (currentIndex >= 0) setFocusedIndex(currentIndex);
            else if (list.length > 0) setFocusedIndex(list.length - 1);
        });
        return () => { cancelled = true; };
    }, [channel.stream_id]);

    // Mantém o item focado visível
    useEffect(() => {
        const focused = listRef.current?.querySelector('.agenda-item.tv-focused');
        focused?.scrollIntoView({ block: 'nearest' });
    }, [focusedIndex]);

    const isPlayable = (program: EpgProgram): boolean => {
        const isPastOrCurrent = program.start < nowMs;
        return isPastOrCurrent && channelHasArchive && (program.hasArchive !== false);
    };

    useTVNavigation({
        onNavigate: (direction) => {
            if (!programs || programs.length === 0) return;
            if (direction === 'up') setFocusedIndex(prev => Math.max(0, prev - 1));
            else if (direction === 'down') setFocusedIndex(prev => Math.min(programs.length - 1, prev + 1));
        },
        onEnter: () => {
            if (!programs) return;
            const program = programs[focusedIndex];
            if (!program) return;
            if (isPlayable(program)) {
                onPlayArchive(programs, focusedIndex);
            } else if (program.start > nowMs && onToggleReminder) {
                // Programa futuro: OK vira 🔔 lembrete (item 3)
                onToggleReminder(program);
                setReminderTick(t => t + 1);
            }
        },
        onBack: onClose,
    });

    const now = nowMs;

    return (
        <div className="agenda-overlay">
            <div className="agenda-panel">
                <div className="agenda-header">
                    <h2 className="agenda-title">📋 {channel.name}</h2>
                    <button className="agenda-close" onClick={onClose}>✕</button>
                </div>

                <div ref={listRef} className="agenda-list">
                    {programs === null && (
                        <div className="agenda-empty">Carregando programação...</div>
                    )}
                    {programs !== null && programs.length === 0 && (
                        <div className="agenda-empty">Sem programação disponível para este canal.</div>
                    )}
                    {programs?.map((program, index) => {
                        const isCurrent = program.start <= now && program.end > now;
                        const isPast = program.end <= now;
                        const playable = isPlayable(program);
                        return (
                            <div
                                key={`${program.start}-${index}`}
                                className={`agenda-item ${focusedIndex === index ? 'tv-focused' : ''} ${isCurrent ? 'current' : ''} ${isPast && !playable ? 'past-locked' : ''}`}
                                onClick={() => playable && onPlayArchive(programs, index)}
                            >
                                <span className="agenda-time">
                                    {formatClock(program.start)}–{formatClock(program.end)}
                                </span>
                                <span className="agenda-name">{program.title}</span>
                                {isCurrent && <span className="agenda-badge-live">NO AR</span>}
                                {playable && !isCurrent && <span className="agenda-badge-replay">⏮ Replay</span>}
                                {program.start > now && onToggleReminder && (
                                    <span className="agenda-badge-bell">
                                        {isReminded?.(program) ? '🔔 Lembrete' : 'OK lembrar'}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="agenda-hints">
                    <span>↑↓ Navegar</span>
                    <span>OK Replay / 🔔 Lembrete</span>
                    <span>← Fechar</span>
                </div>
            </div>
        </div>
    );
}
