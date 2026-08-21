// Entrada de PIN de 4 dígitos por D-pad (item 55).
//
// Na TV não dá pra contar com teclado: o teclado numérico do controle existe
// (dígitos 0-9 são registrados no boot), mas nem todo controle Samsung tem os
// números — daí o teclado na tela navegável por setas, com os dois caminhos
// vivos ao mesmo tempo.

import { useCallback, useEffect, useState } from 'react';
import { useTVNavigation } from '../hooks/useTVNavigation';
import './PinPrompt.css';

const PIN_LENGTH = 4;
// Grade 3x4: 1..9, ⌫, 0, OK
const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'] as const;
const COLUMNS = 3;

interface PinPromptProps {
    title: string;
    hint?: string;
    /** Devolve true se o PIN foi aceito; false mostra "PIN incorreto". */
    onSubmit: (pin: string) => Promise<boolean> | boolean;
    onCancel: () => void;
    /** Rótulo do que acontece ao acertar (ex.: "Abrir Configurações") */
    confirmLabel?: string;
    /**
     * Falso quando o foco do app saiu desta tela (ex.: a trava de entrada das
     * Configurações continua na tela, mas o usuário voltou pra sidebar).
     * Sem isto, dois handlers globais recebiam a MESMA tecla.
     */
    enabled?: boolean;
}

export function PinPrompt({ title, hint, onSubmit, onCancel, confirmLabel, enabled = true }: PinPromptProps) {
    const [pin, setPin] = useState('');
    const [padIndex, setPadIndex] = useState(0);
    const [error, setError] = useState('');
    const [checking, setChecking] = useState(false);

    const submit = useCallback(async (value: string) => {
        if (value.length !== PIN_LENGTH || checking) return;
        setChecking(true);
        const ok = await onSubmit(value);
        setChecking(false);
        if (!ok) {
            setError('PIN incorreto.');
            setPin('');
        }
    }, [onSubmit, checking]);

    const press = useCallback((keyId: string) => {
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
    }, [submit]);

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

                {error && <div className="pin-error">{error}</div>}

                <div className="pin-pad">
                    {PAD.map((keyId, index) => (
                        <button
                            key={keyId}
                            className={`pin-key ${keyId === 'ok' ? 'pin-key-ok' : ''} ${index === padIndex ? 'tv-focused' : ''}`}
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
