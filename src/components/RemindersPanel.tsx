// ⏰ Meus lembretes: a lista do que está marcado, com OK pra cancelar.
//
// Lembrete nasce em três telas (guia 📊, agenda do canal, ⚽ Jogos de hoje) e
// antes não havia onde VER a lista: pra cancelar era preciso achar de novo a
// mesma célula no guia. Mesma casca e mesma navegação dos painéis da TV ao
// vivo (LivePanels): ↑↓ anda, CH± pagina, OK age, Voltar fecha.
//
// A lista nunca é histórico: o lembrete sai do serviço quando dispara (1 min
// antes do início) e o init poda o que passou da janela de limpeza. Por isso
// o painel ouve o disparo e relê — ela pode esvaziar com o painel aberto.

import { useState, useEffect, useRef } from 'react';
import { reminderService, type Reminder } from '../services/reminderService';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useFocusZone } from '../contexts/FocusContext';
import type { LiveStream } from '../types';
import './LivePanels.css';
import './RemindersPanel.css';

/** Linhas puladas por CH+/CH− (o mesmo passo dos outros painéis). */
const PAGINA = 10;

function doisDigitos(n: number): string {
    return n.toString().padStart(2, '0');
}

/** "21:00" hoje; "27/09 21:00" em outro dia — só a hora faria sábado parecer hoje. */
function quando(startMs: number, agora: number): string {
    const d = new Date(startMs);
    const hoje = new Date(agora);
    const hora = `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
    const mesmoDia = d.getFullYear() === hoje.getFullYear()
        && d.getMonth() === hoje.getMonth()
        && d.getDate() === hoje.getDate();
    return mesmoDia ? hora : `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)} ${hora}`;
}

interface RemindersPanelProps {
    /** Canal do lembrete no catálogo atual (pode ter sumido do provedor). */
    resolveChannel: (streamId: number) => LiveStream | undefined;
    onClose: () => void;
    onPlay: (channel: LiveStream) => void;
}

export function RemindersPanel({ resolveChannel, onClose, onPlay }: RemindersPanelProps) {
    const { focusZone } = useFocusZone();
    const [lista, setLista] = useState<Reminder[]>(() => reminderService.upcoming());
    // Date.now() no render viola react-hooks/purity — congelado em state e
    // renovado junto com a lista (a decisão do OK consulta o relógio na hora)
    const [agora, setAgora] = useState(() => Date.now());
    const [focusedIndex, setFocusedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    // O lembrete que dispara sai do serviço; a tela acompanha. A inscrição
    // morre junto com o painel (o cleanup devolve o cancelamento).
    useEffect(() => reminderService.subscribe(() => {
        setLista(reminderService.upcoming());
        setAgora(Date.now());
    }), []);

    useEffect(() => {
        const focused = listRef.current?.querySelector<HTMLElement>('.reminders-row.tv-focused');
        if (focused && typeof focused.scrollIntoView === 'function') focused.scrollIntoView({ block: 'nearest' });
    }, [focusedIndex, lista.length]);

    const safeIndex = Math.min(focusedIndex, Math.max(0, lista.length - 1));

    const acionar = (index: number) => {
        const reminder = lista[index];
        if (!reminder) return;
        reminderService.remove(reminder.id);
        const channel = reminderService.isOnAir(reminder) ? resolveChannel(reminder.streamId) : undefined;
        // Já no ar e o canal existe → assiste (o lembrete cumpriu o papel).
        // Futuro, ou canal que sumiu do catálogo → só cancela.
        if (channel) {
            onPlay(channel);
            return;
        }
        setLista(reminderService.upcoming());
        // O foco fica na mesma posição: cai no vizinho de baixo, não no topo
        setFocusedIndex(index);
    };

    useTVNavigation({
        onNavigate: (direction) => {
            // A dica diz "← Fechar": fecha até com a lista vazia
            if (direction === 'left') { onClose(); return; }
            if (lista.length === 0) return;
            if (direction === 'up') setFocusedIndex(Math.max(0, safeIndex - 1));
            else if (direction === 'down') setFocusedIndex(Math.min(lista.length - 1, safeIndex + 1));
        },
        onPage: (direction) => {
            if (lista.length === 0) return;
            const passo = direction === 'up' ? -PAGINA : PAGINA;
            setFocusedIndex(Math.max(0, Math.min(lista.length - 1, safeIndex + passo)));
        },
        onEnter: () => acionar(safeIndex),
        onBack: onClose,
        // O aviso de lembrete do App assume a zona 'overlay': o OK dele não
        // pode cancelar, por baixo, o lembrete focado aqui
        enabled: focusZone === 'content',
    });

    return (
        <div className="live-panel-overlay">
            <div className="live-panel">
                <div className="live-panel-header">
                    <h2 className="live-panel-title">⏰ Meus lembretes</h2>
                    <button className="live-panel-close" onClick={onClose}>✕</button>
                </div>

                <div ref={listRef} className="live-panel-list">
                    {lista.length === 0 && (
                        <div className="live-panel-empty">
                            Nenhum lembrete marcado. Marque programas com 🔔 no guia 📊, na agenda do canal ou em ⚽ Jogos de hoje.
                        </div>
                    )}
                    {lista.map((reminder, index) => {
                        const noAr = reminderService.isOnAir(reminder, agora);
                        const focado = index === safeIndex;
                        return (
                            <div
                                key={reminder.id}
                                className={`reminders-row ${focado ? 'tv-focused' : ''}`}
                                onClick={() => acionar(index)}
                            >
                                <span className="reminders-time">{quando(reminder.startMs, agora)}</span>
                                <span className="reminders-program">{reminder.programTitle}</span>
                                <span className="reminders-channel">{reminder.channelName}</span>
                                {noAr
                                    ? <span className="reminders-badge-live">NO AR</span>
                                    : focado && <span className="reminders-badge-hint">OK cancela</span>}
                            </div>
                        );
                    })}
                </div>

                <div className="live-panel-hints">
                    <span>↑↓ Navegar</span>
                    <span>CH± Página</span>
                    <span>OK Cancelar (no ar: Assistir)</span>
                    <span>← Fechar</span>
                </div>
            </div>
        </div>
    );
}
