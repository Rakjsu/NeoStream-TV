// Login Page - Premium design with full TV navigation
// Tizen-compatible: no readOnly, no type=password (uses CSS masking)
import { useState, useRef, useEffect, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import { FaTv, FaServer, FaUser, FaLock, FaSignInAlt, FaStar, FaArrowLeft, FaGlobe } from 'react-icons/fa';
import { api } from '../services/api';
import { storage } from '../services/storage';
import { playlistService } from '../services/playlistService';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useTranslation } from '../hooks/useTranslation';
import './Login.css';
import { accountService } from '../services/accountService';
import { foiRebaixadoParaHttp, normalizarUrlDoServidor } from '../services/api';

interface LoginProps {
    onLoginSuccess: () => void;
    /** Fluxo ➕ Adicionar playlist: não pré-preencher com a credencial ativa */
    startBlank?: boolean;
    onLanguageSelect?: () => void;
}

// Navigation order: 0=url, 1=username, 2=password, 3=includeTV, 4=includeVOD, 5=lang, 6=back, 7=submit
const MAX_FOCUS = 7;

export function Login({ onLoginSuccess, onLanguageSelect, startBlank = false }: LoginProps) {
    const { t } = useTranslation();
    const [url, setUrl] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [includeTV, setIncludeTV] = useState(true);
    const [includeVOD, setIncludeVOD] = useState(true);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [focusedField, setFocusedField] = useState(0);
    const [editingField, setEditingField] = useState<number | null>(null);

    const urlRef = useRef<HTMLInputElement>(null);
    const usernameRef = useRef<HTMLInputElement>(null);
    const passwordRef = useRef<HTMLInputElement>(null);

    // Check for saved credentials on mount
    useEffect(() => {
        if (startBlank) return;
        const saved = storage.getCredentials();
        if (saved) {
            setUrl(saved.url || '');
            setUsername(saved.username || '');
            setPassword(saved.password || '');
        }
    }, [startBlank]);

    // Listen for focus/blur on inputs to track editing state reliably
    useEffect(() => {
        const inputs = [urlRef.current, usernameRef.current, passwordRef.current];

        const handleFocus = (e: FocusEvent) => {
            const target = e.target as HTMLInputElement;
            if (target === urlRef.current) setEditingField(0);
            else if (target === usernameRef.current) setEditingField(1);
            else if (target === passwordRef.current) setEditingField(2);
        };

        const handleBlur = () => {
            setEditingField(null);
        };

        inputs.forEach(input => {
            if (input) {
                input.addEventListener('focus', handleFocus);
                input.addEventListener('blur', handleBlur);
            }
        });

        return () => {
            inputs.forEach(input => {
                if (input) {
                    input.removeEventListener('focus', handleFocus);
                    input.removeEventListener('blur', handleBlur);
                }
            });
        };
    }, []);

    const handleLogin = useCallback(async () => {
        if (!url || !username || !password) {
            setError(t('login_error_empty'));
            return;
        }

        setLoading(true);
        setError('');

        try {
            const auth = await api.authenticate(url, username, password);
            // O app tenta HTTP quando o HTTPS falha (TV velha, CA antiga). Se
            // isso aconteceu, a senha passa a trafegar em texto claro na URL
            // de toda requisição — e o aviso precisa sobreviver ao Login, que
            // desmonta no instante seguinte. Fica guardado com a conta e
            // aparece em Configurações → Minha conta.
            accountService.save(auth, foiRebaixadoParaHttp(url, api.getBaseUrl()));
            localStorage.setItem('includeTV', includeTV.toString());
            localStorage.setItem('includeVOD', includeVOD.toString());
            // Guarda a URL LIMPA: o link m3u que o provedor manda carrega
            // usuário e senha na query, e era ele que voltava visível em
            // texto claro no campo Servidor na próxima abertura do Login
            const urlLimpa = normalizarUrlDoServidor(url);
            storage.saveCredentials({ url: urlLimpa, username, password });
            playlistService.registerFromLogin({ url: urlLimpa, username, password });
            onLoginSuccess();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : '';
            if (message.includes('Invalid URL') || message.includes('invalid url')) {
                setError(t('login_error_invalid_url'));
            } else if (message.includes('fetch') || message.includes('ENOTFOUND') || message.includes('ECONNREFUSED')) {
                setError(t('login_error_connection'));
            } else if (message.includes('401') || message.includes('Unauthorized') || message.includes('authentication')) {
                setError(t('login_error_auth'));
            } else if (message.includes('timeout')) {
                setError(t('login_error_timeout'));
            } else {
                setError(message || t('login_error_generic'));
            }
        } finally {
            setLoading(false);
        }
    }, [includeTV, includeVOD, onLoginSuccess, password, t, url, username]);

    const handleBack = () => {
        window.location.reload();
    };

    // Blur all inputs - used when closing keyboard
    const blurAllInputs = useCallback(() => {
        urlRef.current?.blur();
        usernameRef.current?.blur();
        passwordRef.current?.blur();
    }, []);

    const stopEditingInput = useCallback(() => {
        blurAllInputs();
        setEditingField(null);
        window.setTimeout(() => {
            const active = document.activeElement as HTMLElement | null;
            if (active?.tagName === 'INPUT') {
                active.blur();
            }
        }, 0);
    }, [blurAllInputs]);

    const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
        const key = event.key || String(event.keyCode);
        if (
            key === 'Enter' ||
            key === '13' ||
            key === '29443' ||
            key === 'Select' ||
            key === 'Done' ||
            key === 'Go' ||
            key === '10009' ||
            key === '461' ||
            key === 'XF86Back' ||
            key === 'Escape'
        ) {
            event.preventDefault();
            event.stopPropagation();
            stopEditingInput();
        }
    }, [stopEditingInput]);

    const handleEnter = useCallback(() => {
        // If editing an input, blur it (close keyboard)
        if (editingField !== null) {
            stopEditingInput();
            return;
        }

        // Handle action based on focused field
        switch (focusedField) {
            case 0: // URL input - start editing
                urlRef.current?.focus();
                break;
            case 1: // Username input
                usernameRef.current?.focus();
                break;
            case 2: // Password input
                passwordRef.current?.focus();
                break;
            case 3: // Include TV checkbox
                setIncludeTV(v => !v);
                break;
            case 4: // Include VOD checkbox
                setIncludeVOD(v => !v);
                break;
            case 5: // Language button
                if (onLanguageSelect) onLanguageSelect();
                break;
            case 6: // Back button
                handleBack();
                break;
            case 7: // Submit button
                handleLogin();
                break;
        }
    }, [editingField, focusedField, stopEditingInput, onLanguageSelect, handleLogin]);

    const handleBackAction = useCallback(() => {
        // If editing, just blur (close keyboard)
        if (editingField !== null) {
            stopEditingInput();
            return;
        }
        handleBack();
    }, [editingField, stopEditingInput]);

    useTVNavigation({
        onNavigate: (direction) => {
            // Don't navigate if editing an input
            if (editingField !== null) return;

            if (direction === 'up') {
                setFocusedField(Math.max(0, focusedField - 1));
            }
            if (direction === 'down') {
                setFocusedField(Math.min(MAX_FOCUS, focusedField + 1));
            }
            if (direction === 'left' && focusedField >= 5) {
                setFocusedField(5);
            }
            if (direction === 'right' && focusedField >= 5) {
                setFocusedField(Math.min(MAX_FOCUS, focusedField + 1));
            }
        },
        onEnter: handleEnter,
        onBack: handleBackAction,
    });

    useEffect(() => {
        if (editingField !== null) return;
        urlRef.current?.blur();
        usernameRef.current?.blur();
        passwordRef.current?.blur();
    }, [editingField]);

    // Get current language label
    const LANG_LABELS: Record<string, string> = { pt: 'PT-BR', en: 'EN', es: 'ES' };
    const currentLang = LANG_LABELS[storage.getSettings().language] || 'PT-BR';

    return (
        <div className="login-container">
            {/* Animated Background */}
            <div className="login-bg">
                <div className="login-orb login-orb-1" />
                <div className="login-orb login-orb-2" />
                <div className="login-orb login-orb-3" />
                <div className="login-grid" />
            </div>

            {/* Content */}
            <div className="login-content">
                {/* Logo */}
                <div className="login-logo">
                    <div className="login-logo-bg">
                        <FaTv className="login-logo-icon" />
                    </div>
                    <h1 className="login-title">NeoStream</h1>
                    <div className="login-badge">
                        <FaStar size={12} />
                        <span style={{ marginLeft: '8px' }}>IPTV LOGIN</span>
                    </div>
                </div>

                <form onSubmit={(e) => { e.preventDefault(); blurAllInputs(); }} className="login-form">
                    {error && (
                        <div className="login-error">
                            <span>❌</span>
                            <span>{error}</span>
                        </div>
                    )}


                    {/* URL Input */}
                    <div className="login-field">
                        <label>{t('login_server')}</label>
                        <div
                            className={`login-input-wrap ${focusedField === 0 ? 'focused' : ''} ${editingField === 0 ? 'editing' : ''}`}
                            onClick={() => { setFocusedField(0); urlRef.current?.focus(); }}
                        >
                            <FaServer size={18} />
                            <input
                                ref={urlRef}
                                type="text"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                placeholder="http://example.com:8080"
                                disabled={loading}
                                tabIndex={-1}
                                onKeyDown={handleInputKeyDown}
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                            />
                            {focusedField === 0 && editingField !== 0 && (
                                <span className="login-input-hint">{t('login_hint_edit')}</span>
                            )}
                        </div>
                    </div>

                    {/* Username Input */}
                    <div className="login-field">
                        <label>{t('login_user')}</label>
                        <div
                            className={`login-input-wrap ${focusedField === 1 ? 'focused' : ''} ${editingField === 1 ? 'editing' : ''}`}
                            onClick={() => { setFocusedField(1); usernameRef.current?.focus(); }}
                        >
                            <FaUser size={18} />
                            <input
                                ref={usernameRef}
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                disabled={loading}
                                tabIndex={-1}
                                onKeyDown={handleInputKeyDown}
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                            />
                            {focusedField === 1 && editingField !== 1 && (
                                <span className="login-input-hint">{t('login_hint_edit')}</span>
                            )}
                        </div>
                    </div>

                    {/* Password Input - type="text" with CSS masking for Tizen compatibility */}
                    <div className="login-field">
                        <label>{t('login_password')}</label>
                        <div
                            className={`login-input-wrap ${focusedField === 2 ? 'focused' : ''} ${editingField === 2 ? 'editing' : ''}`}
                            onClick={() => { setFocusedField(2); passwordRef.current?.focus(); }}
                        >
                            <FaLock size={18} />
                            <input
                                ref={passwordRef}
                                type="text"
                                className="login-password-input"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                disabled={loading}
                                tabIndex={-1}
                                onKeyDown={handleInputKeyDown}
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                            />
                            {focusedField === 2 && editingField !== 2 && (
                                <span className="login-input-hint">{t('login_hint_edit')}</span>
                            )}
                        </div>
                    </div>

                    {/* Checkboxes for TV and VOD */}
                    <div className="login-checkboxes">
                        <div
                            className={`login-checkbox ${focusedField === 3 ? 'focused' : ''}`}
                            onClick={() => setIncludeTV(!includeTV)}
                            tabIndex={-1}
                        >
                            <span className={`login-checkbox-mark ${includeTV ? 'checked' : ''}`}>
                                {includeTV && '✓'}
                            </span>
                            <span>{t('login_include_tv')}</span>
                        </div>

                        <div
                            className={`login-checkbox ${focusedField === 4 ? 'focused' : ''}`}
                            onClick={() => setIncludeVOD(!includeVOD)}
                            tabIndex={-1}
                        >
                            <span className={`login-checkbox-mark ${includeVOD ? 'checked' : ''}`}>
                                {includeVOD && '✓'}
                            </span>
                            <span>{t('login_include_vod')}</span>
                        </div>
                    </div>

                    {/* Buttons */}
                    <div className="login-buttons">
                        {/* Language Button */}
                        <button
                            type="button"
                            onClick={() => onLanguageSelect?.()}
                            className={`login-btn login-btn-lang ${focusedField === 5 ? 'focused' : ''}`}
                            disabled={loading}
                            tabIndex={-1}
                        >
                            <FaGlobe size={18} />
                            <span>{currentLang}</span>
                        </button>

                        <button
                            type="button"
                            onClick={handleBack}
                            className={`login-btn login-btn-secondary ${focusedField === 6 ? 'focused' : ''}`}
                            disabled={loading}
                            tabIndex={-1}
                        >
                            <FaArrowLeft size={18} />
                            <span>{t('login_back')}</span>
                        </button>

                        <button
                            type="button"
                            onClick={handleLogin}
                            className={`login-btn login-btn-primary ${focusedField === 7 ? 'focused' : ''}`}
                            disabled={loading}
                            tabIndex={-1}
                        >
                            {loading ? (
                                <>
                                    <div className="login-spinner" />
                                    <span>{t('login_authenticating')}</span>
                                </>
                            ) : (
                                <>
                                    <FaSignInAlt size={18} />
                                    <span>{t('login_submit')}</span>
                                </>
                            )}
                        </button>
                    </div>
                </form>

                {/* Navigation hint for TV */}
                <div className="login-hint">
                    <span>{t('login_hint_nav')}</span>
                    <span>•</span>
                    <span>{t('login_hint_select')}</span>
                    <span>•</span>
                    <span>{t('login_hint_back')}</span>
                </div>
            </div>
        </div>
    );
}
