// Entrada de PIN de 4 dígitos por D-pad (item 55).
//
// Na TV não dá pra contar com teclado: o teclado numérico do controle existe
// (dígitos 0-9 são registrados no boot), mas nem todo controle Samsung tem os
// números — daí o teclado na tela navegável por setas, com os dois caminhos
// vivos ao mesmo tempo.

import { useCallback, useEffect, useState } from 'react';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { parentalService } from '../services/parentalService';
import './PinPrompt.css';

const PIN_LENGTH = 4;
// Grade 3x4: 1..9, ⌫, 0, OK
const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'] as const;
const COLUMNS = 3;

/** "2 min 05 s" lê melhor que "125 s" numa tela a três metros de distância. */
function formatarEspera(segundos: number): string {
    if (segundos < 60) return `${segundos} s`;
    const min = Math.floor(segundos / 60);
    const seg = segundos % 60;
    return seg === 0 ? `${min} min` : `${min} min ${String(seg).padStart(2, '0')} s`;
}

interface PinPromptProps {
    title: string;
    hint?: string;
    /** Devolve true se o PIN foi aceito; false mostra "PIN incorreto". */
    onSubmit: (pin: string) => Promise<boolean> | boolean;
    onCancel: () => void;
    /** Rótulo do que acontece ao acertar (ex.: "Abrir Configurações") */
    confirmLabel?: string;
    /**
     * Mostrar a espera do controle parental. Fica desligado quando o prompt
     * não é do PIN parental (ex.: PIN de entrada de um perfil), que tem a
     * própria contagem.
     */
    parental?: boolean;
    /**
     * Falso quando o foco do app saiu desta tela (ex.: a trava de entrada das
     * Configurações continua na tela, mas o usuário voltou pra sidebar).
     * Sem isto, dois handlers globais recebiam a MESMA tecla.
     */
    enabled?: boolean;
}

export function PinPrompt({ title, hint, onSubmit, onCancel, confirmLabel, parental = false, enabled = true }: PinPromptProps) {
    const [pin, setPin] = useState('');
    const [padIndex, setPadIndex] = useState(0);
    const [error, setError] = useState('');
    const [checking, setChecking] = useState(false);
    // Espera do controle parental, em segundos. Sem mostrar isto o usuário via
    // "PIN incorreto" com o PIN CERTO e não tinha como saber o porquê.
    const [esperaSeg, setEsperaSeg] = useState(
        () => (parental ? Math.ceil(parentalService.travaRestanteMs() / 1000) : 0)
    );

    // Conta regressiva enquanto a espera durar
    useEffect(() => {
        if (!parental || esperaSeg <= 0) return;
        const timer = window.setInterval(() => {
            setEsperaSeg(Math.ceil(parentalService.travaRestanteMs() / 1000));
        }, 1000);
        return () => clearInterval(timer);
    }, [parental, esperaSeg]);

    const travado = esperaSeg > 0;

    const submit = useCallback(async (value: string) => {
        if (value.length !== PIN_LENGTH || checking) return;
        setChecking(true);
        const ok = await onSubmit(value);
        setChecking(false);
        if (ok) return;
        setPin('');
        if (!parental) {
            setError('PIN incorreto.');
            return;
        }
        // A tentativa pode ter sido a que disparou a espera
        const restante = Math.ceil(parentalService.travaRestanteMs() / 1000);
        setEsperaSeg(restante);
        if (restante > 0) {
            setError('');
            return;
        }
        const faltam = parentalService.tentativasRestantes();
        setError(faltam <= 2
            ? `PIN incorreto. Mais ${faltam} ${faltam === 1 ? 'tentativa' : 'tentativas'} antes da espera.`
            : 'PIN incorreto.');
    }, [onSubmit, checking, parental]);

    const press = useCallback((keyId: string) => {
        if (travado) return; // digitar durante a espera só gasta o controle
        setError('');
        if (keyId === 'del') {
            setPin(prev => prev.slice(0, -1));
            return;
        }
        if (keyId === 'ok') {
            setPin(prev => {
                void submit(prev);
                return prev;
            });
            return;
        }
        setPin(prev => {
            const next = prev.length >= PIN_LENGTH ? prev : prev + keyId;
            // 4º dígito confirma sozinho — poupa uma viagem até o OK
            if (next.length === PIN_LENGTH) void submit(next);
            return next;
        });
    }, [submit, travado]);

    // Teclado numérico do controle, em paralelo ao teclado da tela
    useEffect(() => {
        if (!enabled) return;
        const handleDigits = (event: KeyboardEvent) => {
            const key = event.key || '';
            const code = event.keyCode;
            if (/^[0-9]$/.test(key)) {
                event.preventDefault();
                press(key);
            } else if ((code >= 48 && code <= 57) || (code >= 96 && code <= 105)) {
                event.preventDefault();
                press(String(code >= 96 ? code - 96 : code - 48));
            }
        };
        window.addEventListener('keydown', handleDigits);
        return () => window.removeEventListener('keydown', handleDigits);
    }, [press, enabled]);

    useTVNavigation({
        onNavigate: (direction) => {
            setPadIndex(prev => {
                if (direction === 'left') return prev % COLUMNS === 0 ? prev : prev - 1;
                if (direction === 'right') return prev % COLUMNS === COLUMNS - 1 ? prev : prev + 1;
                if (direction === 'up') return prev - COLUMNS < 0 ? prev : prev - COLUMNS;
                return prev + COLUMNS >= PAD.length ? prev : prev + COLUMNS;
            });
        },
        onEnter: () => press(PAD[padIndex]),
        onBack: onCancel,
        enabled,
    });

    return (
        <div className="pin-overlay">
            <div className="pin-panel">
                <div className="pin-title">🔒 {title}</div>
                {hint && <div className="pin-hint">{hint}</div>}

                <div className="pin-dots">
                    {Array.from({ length: PIN_LENGTH }, (_, i) => (
                        <span key={i} className={`pin-dot ${i < pin.length ? 'filled' : ''}`} />
                    ))}
                </div>

                {travado && (
                    <div className="pin-error">
                        Muitas tentativas. Tente de novo em {formatarEspera(esperaSeg)}.
                    </div>
                )}
                {!travado && error && <div className="pin-error">{error}</div>}

                <div className="pin-pad">
                    {PAD.map((keyId, index) => (
                        <button
                            key={keyId}
                            className={`pin-key ${keyId === 'ok' ? 'pin-key-ok' : ''} ${index === padIndex ? 'tv-focused' : ''} ${travado ? 'pin-key-locked' : ''}`}
                            onClick={() => press(keyId)}
                        >
                            {keyId === 'del' ? '⌫' : keyId === 'ok' ? '✓' : keyId}
                        </button>
                    ))}
                </div>

                <div className="pin-footer">
                    {confirmLabel && <span className="pin-confirm-label">{confirmLabel}</span>}
                    <span>Números do controle também funcionam · Voltar cancela</span>
                </div>
            </div>
        </div>
    );
}
