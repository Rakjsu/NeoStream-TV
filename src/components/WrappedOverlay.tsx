// Retrospectiva de uso (Wrapped lite, Fase 4b): slides com as estatísticas
// do período em tela cheia. ←→ navega, Voltar fecha.

import { useState, useMemo } from 'react';
import { usageStats, type UsageKind } from '../services/usageStats';
import { useTVNavigation } from '../hooks/useTVNavigation';
import './WrappedOverlay.css';

interface WrappedOverlayProps {
    onClose: () => void;
}

const KIND_LABELS: Record<UsageKind, string> = {
    live: '📺 TV ao vivo',
    movie: '🎬 Filmes',
    series: '🎞 Séries',
};

function formatHours(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}min`;
    return `${minutes}min`;
}

export function WrappedOverlay({ onClose }: WrappedOverlayProps) {
    const [slide, setSlide] = useState(0);
    const summary = useMemo(() => usageStats.summary(), []);

    const favoriteKind = useMemo(() => {
        const entries = Object.entries(summary.byKind) as Array<[UsageKind, number]>;
        entries.sort((a, b) => b[1] - a[1]);
        return entries[0];
    }, [summary]);

    const slides = useMemo(() => {
        const list: Array<{ title: string; big: string; sub: string }> = [
            {
                title: 'Sua retrospectiva',
                big: formatHours(summary.totalSeconds),
                sub: 'assistidos nos últimos 60 dias',
            },
        ];
        if (favoriteKind && favoriteKind[1] > 0) {
            list.push({
                title: 'Seu formato favorito',
                big: KIND_LABELS[favoriteKind[0]],
                sub: `${formatHours(favoriteKind[1])} no período`,
            });
        }
        if (summary.topItems.length > 0) {
            const top = summary.topItems[0];
            list.push({
                title: 'Campeão de tela',
                big: top.name,
                sub: `${formatHours(top.seconds)} — impossível largar`,
            });
        }
        return list;
    }, [summary, favoriteKind]);

    useTVNavigation({
        onNavigate: (direction) => {
            if (direction === 'right') setSlide(prev => Math.min(slides.length - 1, prev + 1));
            else if (direction === 'left') setSlide(prev => Math.max(0, prev - 1));
        },
        onEnter: () => {
            if (slide < slides.length - 1) setSlide(prev => prev + 1);
            else onClose();
        },
        onBack: onClose,
    });

    const current = slides[Math.min(slide, slides.length - 1)];

    return (
        <div className="wrapped-overlay">
            <div className="wrapped-slide">
                <span className="wrapped-kicker">🏆 NeoStream Wrapped</span>
                <h2 className="wrapped-title">{current.title}</h2>
                <div className="wrapped-big">{current.big}</div>
                <p className="wrapped-sub">{current.sub}</p>
                <div className="wrapped-dots">
                    {slides.map((_, index) => (
                        <span key={index} className={`wrapped-dot ${index === slide ? 'active' : ''}`} />
                    ))}
                </div>
                <div className="wrapped-hint">←→ Navegar · OK Avançar · Voltar Fechar</div>
            </div>
        </div>
    );
}
