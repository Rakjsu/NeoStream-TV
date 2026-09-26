// Entrada de PIN de 4 dígitos por D-pad (item 55).
//
// Na TV não dá pra contar com teclado: o teclado numérico do controle existe
// (dígitos 0-9 são registrados no boot), mas nem todo controle Samsung tem os
// números — daí o teclado na tela navegável por setas, com os dois caminhos
// vivos ao mesmo tempo.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { parentalService } from '../services/parentalService';
import type { TravaVisivel } from '../services/pinLock';
import './PinPrompt.css';

const PIN_LENGTH = 4;
// Constante do módulo: identidade estável para as dependências dos hooks
const TRAVA_PARENTAL: TravaVisivel = {
    restanteMs: () => parentalService.travaRestanteMs(),
    tentativasRestantes: () => parentalService.tentativasRestantes(),
};
// Grade 3x4: 1..9, ⌫, 0, OK
const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'] as const;
const COLUMNS = 3;
// "Esqueci o PIN" fica abaixo do teclado, fora da grade (só existe com onForgot)
const ESQUECI = PAD.length;

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
    /** Atalho para `trava` = a do PIN parental. */
    parental?: boolean;
    /**
     * Limite de tentativas do PIN que este prompt confere (T048): com ela a
     * tela mostra a espera e avisa quando faltam poucas tentativas. O PIN de
     * perfil passa a trava do perfil; sem nenhuma, só "PIN incorreto.".
     */
    trava?: TravaVisivel;
    /**
     * Falso quando o foco do app saiu desta tela (ex.: a trava de entrada das
     * Configurações continua na tela, mas o usuário voltou pra sidebar).
     * Sem isto, dois handlers globais recebiam a MESMA tecla.
     */
    enabled?: boolean;
    /**
     * PIN esquecido (T073): mostra "Esqueci o PIN" abaixo do teclado. Sem isto
     * a trava de entrada das Configurações não tinha saída nenhuma.
     */
    onForgot?: () => void;
}

export function PinPrompt({ title, hint, onSubmit, onCancel, confirmLabel, parental = false, trava: travaRecebida, enabled = true, onForgot }: PinPromptProps) {
    const trava = travaRecebida ?? (parental ? TRAVA_PARENTAL : undefined);
    const [pin, setPin] = useState('');
    const [padIndex, setPadIndex] = useState(0);
    const [error, setError] = useState('');
    const [checking, setChecking] = useState(false);
    // Espera da trava, em segundos. Sem mostrar isto o usuário via "PIN
    // incorreto" com o PIN CERTO e não tinha como saber o porquê.
    const [esperaSeg, setEsperaSeg] = useState(
        () => (trava ? Math.ceil(trava.restanteMs() / 1000) : 0)
    );

    // Conta regressiva enquanto a espera durar; acabou (ou fechou), o timer morre
    useEffect(() => {
        if (!trava || esperaSeg <= 0) return;
        const timer = window.setInterval(() => {
            setEsperaSeg(Math.ceil(trava.restanteMs() / 1000));
        }, 1000);
        return () => clearInterval(timer);
    }, [trava, esperaSeg]);

    const travado = esperaSeg > 0;

    const submit = useCallback(async (value: string) => {
        if (value.length !== PIN_LENGTH || checking) return;
        setChecking(true);
        const ok = await onSubmit(value);
        setChecking(false);
        if (ok) return;
        setPin('');
        if (!trava) {
            setError('PIN incorreto.');
            return;
        }
        // A tentativa pode ter sido a que disparou a espera
        const restante = Math.ceil(trava.restanteMs() / 1000);
        setEsperaSeg(restante);
        if (restante > 0) {
            setError('');
            return;
        }
        const faltam = trava.tentativasRestantes();
        setError(faltam <= 2
            ? `PIN incorreto. Mais ${faltam} ${faltam === 1 ? 'tentativa' : 'tentativas'} antes da espera.`
            : 'PIN incorreto.');
    }, [onSubmit, checking, trava]);

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
                // Do "Esqueci o PIN" só se volta pra cima, pro 0 do meio
                if (prev === ESQUECI) return direction === 'up' ? PAD.length - 2 : prev;
                if (direction === 'left') return prev % COLUMNS === 0 ? prev : prev - 1;
                if (direction === 'right') return prev % COLUMNS === COLUMNS - 1 ? prev : prev + 1;
                if (direction === 'up') return prev - COLUMNS < 0 ? prev : prev - COLUMNS;
                if (prev + COLUMNS >= PAD.length) return onForgot ? ESQUECI : prev;
                return prev + COLUMNS;
            });
        },
        onEnter: () => {
            // Vale também durante a espera: é justamente quem errou demais
            // que precisa do resgate
            if (padIndex === ESQUECI) {
                onForgot?.();
                return;
            }
            press(PAD[padIndex]);
        },
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

                {onForgot && (
                    <button
                        className={`pin-forgot ${padIndex === ESQUECI ? 'tv-focused' : ''}`}
                        onClick={onForgot}
                    >
                        Esqueci o PIN
                    </button>
                )}

                <div className="pin-footer">
                    {confirmLabel && <span className="pin-confirm-label">{confirmLabel}</span>}
                    <span>Números do controle também funcionam · Voltar cancela</span>
                </div>
            </div>
        </div>
    );
}

interface PinRecoveryProps {
    /** A senha conferiu e o PIN foi removido. */
    onRecovered: () => void;
    /** Voltar: devolve ao teclado do PIN, com a trava de pé. */
    onCancel: () => void;
    enabled?: boolean;
}

/**
 * Resgate do PIN parental esquecido (T073): a senha da conta IPTV — a mesma
 * do login — remove o PIN e nada mais. Campo de texto comum com máscara por
 * CSS, como no Login: o Tizen tem bugs com type="password".
 */
export function PinRecovery({ onRecovered, onCancel, enabled = true }: PinRecoveryProps) {
    const [senha, setSenha] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    // Quem chega aqui depois de errar o PIN demais já encontra a espera
    const [erro, setErro] = useState(() => {
        const espera = Math.ceil(parentalService.travaRestanteMs() / 1000);
        return espera > 0 ? `Muitas tentativas. Tente de novo em ${formatarEspera(espera)}.` : '';
    });

    const conferir = (valor: string) => {
        if (parentalService.resgatarComSenhaDaConta(valor)) {
            onRecovered();
            return;
        }
        setSenha('');
        const espera = Math.ceil(parentalService.travaRestanteMs() / 1000);
        setErro(espera > 0
            ? `Muitas tentativas. Tente de novo em ${formatarEspera(espera)}.`
            : 'A senha não confere com a da conta.');
    };

    useTVNavigation({
        onEnter: (fromInput) => {
            // O valor vem do próprio campo: o OK do IME pode chegar antes de
            // o React refazer este ouvinte com o texto novo
            const valor = inputRef.current?.value ?? senha;
            if (valor) {
                conferir(valor);
                return;
            }
            // Campo vazio: OK abre o teclado. Vindo DE DENTRO do campo, não
            // reabre — refocar ali deixa o IME do Tizen num laço sem saída
            if (!fromInput) inputRef.current?.focus();
        },
        onBack: onCancel,
        enabled,
    });

    return (
        <div className="pin-overlay">
            <div className="pin-panel">
                <div className="pin-title">🔑 Esqueci o PIN</div>
                <div className="pin-hint">
                    Digite a senha da sua conta IPTV — a mesma do login. Se ela conferir, o PIN
                    parental é removido e nada mais é apagado.
                </div>

                <input
                    ref={inputRef}
                    type="text"
                    className="pin-recover-input tv-focused"
                    aria-label="Senha da conta IPTV"
                    value={senha}
                    onChange={(e) => { setSenha(e.target.value); setErro(''); }}
                    tabIndex={-1}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                />

                {erro && <div className="pin-error">{erro}</div>}

                <div className="pin-footer">
                    <span>OK abre o teclado e confere · Voltar cancela</span>
                </div>
            </div>
        </div>
    );
}
