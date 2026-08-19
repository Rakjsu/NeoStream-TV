import { useEffect, useRef, useState } from 'react';
import { storage } from '../services/storage';
import { themeService, ACCENTS, ACCENT_IDS, BACKGROUNDS, BACKGROUND_IDS, type AccentId, type BackgroundId } from '../services/themeService';
import { usageStats, type UsageSummary } from '../services/usageStats';
import { useTVNavigation } from '../hooks/useTVNavigation';
import './Settings.css';

type FocusZone = 'bg' | 'accent' | 'input' | 'save' | 'clear';

const ZONES: FocusZone[] = ['bg', 'accent', 'input', 'save', 'clear'];

function formatHours(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}min`;
    return `${minutes}min`;
}

export function Settings() {
    const [tmdbKey, setTmdbKey] = useState(() => storage.getTmdbApiKey());
    const [savedKey, setSavedKey] = useState(() => storage.getTmdbApiKey());
    const [message, setMessage] = useState('');
    const [editing, setEditing] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Tema
    const [background, setBackground] = useState<BackgroundId>(() => themeService.getBackground());
    const [accent, setAccent] = useState<AccentId>(() => themeService.getAccent());

    // Estatísticas (lidas 1x ao abrir a página)
    const [usage] = useState<UsageSummary>(() => usageStats.summary());

    // Foco por zona + índice horizontal dentro da zona
    const [focusZone, setFocusZone] = useState<FocusZone>('bg');
    const [bgIndex, setBgIndex] = useState(() => Math.max(0, BACKGROUND_IDS.indexOf(themeService.getBackground())));
    const [accentIndex, setAccentIndex] = useState(() => Math.max(0, ACCENT_IDS.indexOf(themeService.getAccent())));

    useEffect(() => {
        if (!message) return;
        const timeout = setTimeout(() => setMessage(''), 3000);
        return () => clearTimeout(timeout);
    }, [message]);

    const saveKey = () => {
        storage.saveTmdbApiKey(tmdbKey);
        const current = storage.getTmdbApiKey();
        setSavedKey(current);
        setTmdbKey(current);
        setMessage(current ? 'Chave TMDB salva neste dispositivo.' : 'Chave TMDB removida.');
    };

    const clearKey = () => {
        storage.clearTmdbApiKey();
        setTmdbKey('');
        setSavedKey('');
        setMessage('Chave TMDB removida deste dispositivo.');
    };

    const applyBackground = (id: BackgroundId) => {
        themeService.setBackground(id);
        setBackground(id);
    };

    const applyAccent = (id: AccentId) => {
        themeService.setAccent(id);
        setAccent(id);
    };

    useTVNavigation({
        enabled: !editing,
        onNavigate: (direction) => {
            if (direction === 'up' || direction === 'down') {
                setFocusZone((current) => {
                    const idx = ZONES.indexOf(current);
                    const next = direction === 'up' ? Math.max(0, idx - 1) : Math.min(ZONES.length - 1, idx + 1);
                    return ZONES[next];
                });
                return;
            }
            // left/right dentro da zona
            if (focusZone === 'bg') {
                setBgIndex(prev => direction === 'left' ? Math.max(0, prev - 1) : Math.min(BACKGROUND_IDS.length - 1, prev + 1));
            } else if (focusZone === 'accent') {
                setAccentIndex(prev => direction === 'left' ? Math.max(0, prev - 1) : Math.min(ACCENT_IDS.length - 1, prev + 1));
            } else if (focusZone === 'save' && direction === 'right') {
                setFocusZone('clear');
            } else if (focusZone === 'clear' && direction === 'left') {
                setFocusZone('save');
            }
        },
        onEnter: () => {
            if (focusZone === 'bg') applyBackground(BACKGROUND_IDS[bgIndex]);
            else if (focusZone === 'accent') applyAccent(ACCENT_IDS[accentIndex]);
            else if (focusZone === 'input') {
                setEditing(true);
                inputRef.current?.focus();
            }
            else if (focusZone === 'save') saveKey();
            else if (focusZone === 'clear') clearKey();
        },
    });

    const hasSavedKey = savedKey.length > 0;

    return (
        <div className="settings-page">
            <div className="settings-panel">
                <header className="settings-header">
                    <span className="settings-kicker">Configurações</span>
                    <h1>Aparência, uso e integrações</h1>
                </header>

                {/* Aparência */}
                <section className="settings-section">
                    <h2 className="settings-section-title">🎨 Aparência</h2>

                    <label className="settings-label">Fundo</label>
                    <div className="settings-options-row">
                        {BACKGROUND_IDS.map((id, index) => (
                            <button
                                key={id}
                                className={`settings-option ${background === id ? 'selected' : ''} ${focusZone === 'bg' && bgIndex === index ? 'focused' : ''}`}
                                onClick={() => applyBackground(id)}
                            >
                                {BACKGROUNDS[id]}
                            </button>
                        ))}
                    </div>

                    <label className="settings-label">Cor de destaque</label>
                    <div className="settings-options-row">
                        {ACCENT_IDS.map((id, index) => (
                            <button
                                key={id}
                                className={`settings-accent ${accent === id ? 'selected' : ''} ${focusZone === 'accent' && accentIndex === index ? 'focused' : ''}`}
                                style={{ backgroundColor: ACCENTS[id].hex }}
                                onClick={() => applyAccent(id)}
                                title={ACCENTS[id].label}
                            >
                                {accent === id ? '✓' : ''}
                            </button>
                        ))}
                    </div>
                </section>

                {/* Seu uso */}
                <section className="settings-section">
                    <h2 className="settings-section-title">📊 Seu uso</h2>
                    {usage.totalSeconds === 0 ? (
                        <p className="settings-muted">Assista algo e as estatísticas aparecem aqui.</p>
                    ) : (
                        <>
                            <div className="usage-cards">
                                <div className="usage-card">
                                    <span className="usage-value">{formatHours(usage.totalSeconds)}</span>
                                    <span className="usage-label">Total</span>
                                </div>
                                <div className="usage-card">
                                    <span className="usage-value">{formatHours(usage.last7Seconds)}</span>
                                    <span className="usage-label">Últimos 7 dias</span>
                                </div>
                                <div className="usage-card">
                                    <span className="usage-value">{formatHours(usage.byKind.live)}</span>
                                    <span className="usage-label">📺 TV ao vivo</span>
                                </div>
                                <div className="usage-card">
                                    <span className="usage-value">{formatHours(usage.byKind.movie)}</span>
                                    <span className="usage-label">🎬 Filmes</span>
                                </div>
                                <div className="usage-card">
                                    <span className="usage-value">{formatHours(usage.byKind.series)}</span>
                                    <span className="usage-label">📺 Séries</span>
                                </div>
                            </div>
                            {usage.topItems.length > 0 && (
                                <div className="usage-top">
                                    <span className="settings-label">Mais assistidos</span>
                                    <ol className="usage-top-list">
                                        {usage.topItems.map(item => (
                                            <li key={`${item.kind}|${item.name}`}>
                                                <span className="usage-top-name">{item.name}</span>
                                                <span className="usage-top-time">{formatHours(item.seconds)}</span>
                                            </li>
                                        ))}
                                    </ol>
                                </div>
                            )}
                        </>
                    )}
                </section>

                {/* TMDB */}
                <section className="settings-section">
                    <h2 className="settings-section-title">🎞 Integração TMDB</h2>
                    <p className="settings-muted">
                        Opcional. Com uma chave própria, o app busca sinopse, capas e metadados extras.
                    </p>
                    <label className="settings-label" htmlFor="tmdb-key">
                        Chave API TMDB
                    </label>
                    <input
                        id="tmdb-key"
                        ref={inputRef}
                        className={`settings-input ${focusZone === 'input' ? 'focused' : ''}`}
                        value={tmdbKey}
                        onChange={(event) => setTmdbKey(event.target.value)}
                        onFocus={() => {
                            setFocusZone('input');
                            setEditing(true);
                        }}
                        onBlur={() => setEditing(false)}
                        placeholder="Cole sua chave TMDB aqui"
                        autoComplete="off"
                        spellCheck={false}
                    />

                    <div className="settings-status">
                        Status: {hasSavedKey ? 'chave salva localmente neste dispositivo' : 'nenhuma chave salva'}
                    </div>

                    <div className="settings-actions">
                        <button
                            className={`settings-button primary ${focusZone === 'save' ? 'focused' : ''}`}
                            onClick={saveKey}
                        >
                            Salvar chave
                        </button>
                        <button
                            className={`settings-button secondary ${focusZone === 'clear' ? 'focused' : ''}`}
                            onClick={clearKey}
                            disabled={!hasSavedKey && !tmdbKey}
                        >
                            Remover chave
                        </button>
                    </div>

                    {message && <p className="settings-message">{message}</p>}
                </section>
            </div>
        </div>
    );
}
