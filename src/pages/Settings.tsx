import { useEffect, useRef, useState } from 'react';
import { storage } from '../services/storage';
import { themeService, ACCENTS, ACCENT_IDS, BACKGROUNDS, BACKGROUND_IDS, type AccentId, type BackgroundId } from '../services/themeService';
import { usageStats, type UsageSummary } from '../services/usageStats';
import { playlistService, type PlaylistEntry } from '../services/playlistService';
import { epgOffset } from '../services/epgService';
import { bootLastChannel } from '../services/liveExtras';
import { qualityCap, QUALITY_CAPS, type QualityCap } from '../services/playerPrefs';
import { WrappedOverlay } from '../components/WrappedOverlay';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useFocusZone } from '../contexts/FocusContext';
import './Settings.css';

type FocusZone = 'bg' | 'accent' | 'lang' | 'playlists' | 'epgoffset' | 'bootlast' | 'qualitycap' | 'wrapped' | 'input' | 'save' | 'clear';

const ZONES: FocusZone[] = ['bg', 'accent', 'lang', 'playlists', 'epgoffset', 'bootlast', 'qualitycap', 'wrapped', 'input', 'save', 'clear'];

type LanguageId = 'pt' | 'en' | 'es';
const LANGUAGES: Array<{ id: LanguageId; label: string }> = [
    { id: 'pt', label: 'Português' },
    { id: 'en', label: 'English' },
    { id: 'es', label: 'Español' },
];

interface SettingsProps {
    onAddPlaylist?: () => void;
}

function formatHours(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}min`;
    return `${minutes}min`;
}

export function Settings({ onAddPlaylist }: SettingsProps) {
    const { focusZone: appFocusZone } = useFocusZone();
    const [tmdbKey, setTmdbKey] = useState(() => storage.getTmdbApiKey());
    const [savedKey, setSavedKey] = useState(() => storage.getTmdbApiKey());
    const [message, setMessage] = useState('');
    const [editing, setEditing] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Tema
    const [background, setBackground] = useState<BackgroundId>(() => themeService.getBackground());
    const [accent, setAccent] = useState<AccentId>(() => themeService.getAccent());

    // Idioma
    const [language, setLanguage] = useState<LanguageId>(() => storage.getSettings().language);

    // Playlists (multi-provedor)
    const [playlists, setPlaylists] = useState<PlaylistEntry[]>(() => playlistService.list());
    const [activePlaylistId, setActivePlaylistId] = useState<string | null>(() => playlistService.getActiveId());

    // TV ao vivo: fuso do EPG (item 15) + boot no último canal (item 14)
    const [epgOffsetHours, setEpgOffsetHours] = useState(() => epgOffset.get());
    const [bootLast, setBootLast] = useState(() => bootLastChannel.get());
    // Teto global de qualidade (item 47): rede fraca não aguenta 1080p
    const [cap, setCap] = useState<QualityCap>(() => qualityCap.get());

    // Estatísticas (lidas 1x ao abrir a página) + Wrapped
    const [usage] = useState<UsageSummary>(() => usageStats.summary());
    const [showWrapped, setShowWrapped] = useState(false);

    // Zonas ativas: 'wrapped' só existe quando há estatística (o botão só
    // renderiza nesse caso — zona invisível virava parada morta do D-pad)
    const zones: FocusZone[] = usage.totalSeconds > 0
        ? ZONES
        : ZONES.filter(zone => zone !== 'wrapped');

    // Foco por zona + índice horizontal dentro da zona
    const [focusZone, setFocusZone] = useState<FocusZone>('bg');
    const [bgIndex, setBgIndex] = useState(() => Math.max(0, BACKGROUND_IDS.indexOf(themeService.getBackground())));
    const [accentIndex, setAccentIndex] = useState(() => Math.max(0, ACCENT_IDS.indexOf(themeService.getAccent())));
    const [langIndex, setLangIndex] = useState(() => Math.max(0, LANGUAGES.findIndex(l => l.id === storage.getSettings().language)));
    const [playlistIndex, setPlaylistIndex] = useState(0);

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

    const applyLanguage = (id: LanguageId) => {
        storage.saveSettings({ language: id });
        setLanguage(id);
        // Mesmo evento da LanguageSelection — telas traduzidas re-renderizam
        window.dispatchEvent(new Event('neostream-lang-change'));
        setMessage('Idioma alterado. Telas traduzidas aplicam na hora.');
    };

    // Trocar de playlist re-autentica do zero (reload é o caminho robusto na TV)
    const switchPlaylist = (entry: PlaylistEntry) => {
        if (entry.id === activePlaylistId) return;
        if (playlistService.setActive(entry.id)) {
            window.location.reload();
        }
    };

    const removePlaylist = (entry: PlaylistEntry) => {
        if (entry.id === activePlaylistId) {
            setMessage('A playlist ativa não pode ser removida.');
            return;
        }
        if (playlistService.remove(entry.id)) {
            setPlaylists(playlistService.list());
            setActivePlaylistId(playlistService.getActiveId());
            setMessage(`Playlist "${entry.alias}" removida.`);
        }
    };

    // Slots da zona de playlists: uma por entrada + "➕ Adicionar" no fim
    const playlistSlots = playlists.length + 1;
    const safePlaylistIndex = Math.min(playlistIndex, playlistSlots - 1);

    useTVNavigation({
        enabled: appFocusZone === 'content' && !editing && !showWrapped,
        onNavigate: (direction) => {
            if (direction === 'up' || direction === 'down') {
                setFocusZone((current) => {
                    const idx = Math.max(0, zones.indexOf(current));
                    const next = direction === 'up' ? Math.max(0, idx - 1) : Math.min(zones.length - 1, idx + 1);
                    return zones[next];
                });
                return;
            }
            // left/right dentro da zona
            if (focusZone === 'bg') {
                setBgIndex(prev => direction === 'left' ? Math.max(0, prev - 1) : Math.min(BACKGROUND_IDS.length - 1, prev + 1));
            } else if (focusZone === 'accent') {
                setAccentIndex(prev => direction === 'left' ? Math.max(0, prev - 1) : Math.min(ACCENT_IDS.length - 1, prev + 1));
            } else if (focusZone === 'lang') {
                setLangIndex(prev => direction === 'left' ? Math.max(0, prev - 1) : Math.min(LANGUAGES.length - 1, prev + 1));
            } else if (focusZone === 'playlists') {
                setPlaylistIndex(prev => direction === 'left' ? Math.max(0, prev - 1) : Math.min(playlistSlots - 1, prev + 1));
            } else if (focusZone === 'epgoffset') {
                setEpgOffsetHours(prev => {
                    const next = Math.max(-12, Math.min(12, prev + (direction === 'left' ? -1 : 1)));
                    epgOffset.set(next);
                    return next;
                });
            } else if (focusZone === 'bootlast') {
                const next = direction === 'right';
                bootLastChannel.set(next);
                setBootLast(next);
            } else if (focusZone === 'qualitycap') {
                setCap(prev => {
                    const idx = Math.max(0, QUALITY_CAPS.indexOf(prev));
                    const nextIdx = direction === 'left'
                        ? Math.max(0, idx - 1)
                        : Math.min(QUALITY_CAPS.length - 1, idx + 1);
                    const next = QUALITY_CAPS[nextIdx];
                    qualityCap.set(next);
                    return next;
                });
            } else if (focusZone === 'save' && direction === 'right') {
                setFocusZone('clear');
            } else if (focusZone === 'clear' && direction === 'left') {
                setFocusZone('save');
            }
        },
        onEnter: () => {
            if (focusZone === 'bg') applyBackground(BACKGROUND_IDS[bgIndex]);
            else if (focusZone === 'accent') applyAccent(ACCENT_IDS[accentIndex]);
            else if (focusZone === 'lang') applyLanguage(LANGUAGES[langIndex].id);
            else if (focusZone === 'playlists') {
                if (safePlaylistIndex === playlists.length) onAddPlaylist?.();
                else {
                    const entry = playlists[safePlaylistIndex];
                    if (entry) switchPlaylist(entry);
                }
            }
            else if (focusZone === 'epgoffset') {
                epgOffset.set(0);
                setEpgOffsetHours(0);
                setMessage('Fuso do EPG zerado.');
            }
            else if (focusZone === 'bootlast') {
                setBootLast(prev => {
                    bootLastChannel.set(!prev);
                    return !prev;
                });
            }
            else if (focusZone === 'qualitycap') {
                qualityCap.set(0);
                setCap(0);
                setMessage('Teto de qualidade removido. Vale no próximo play.');
            }
            else if (focusZone === 'wrapped') setShowWrapped(true);
            else if (focusZone === 'input') {
                setEditing(true);
                inputRef.current?.focus();
            }
            else if (focusZone === 'save') saveKey();
            else if (focusZone === 'clear') clearKey();
        },
        onAction: (action) => {
            // 🔴 remove a playlist focada (não-ativa)
            if (action === 'red' && focusZone === 'playlists' && safePlaylistIndex < playlists.length) {
                const entry = playlists[safePlaylistIndex];
                if (entry) removePlaylist(entry);
            }
        },
    });

    // Rola a seção da zona focada pra viewport (a página tem várias dobras)
    useEffect(() => {
        const sectionIds: Record<FocusZone, string> = {
            bg: 'sec-aparencia',
            accent: 'sec-aparencia',
            lang: 'sec-idioma',
            playlists: 'sec-playlists',
            epgoffset: 'sec-tv',
            bootlast: 'sec-tv',
            qualitycap: 'sec-player',
            wrapped: 'sec-uso',
            input: 'sec-tmdb',
            save: 'sec-tmdb',
            clear: 'sec-tmdb',
        };
        document.getElementById(sectionIds[focusZone])?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [focusZone]);

    const hasSavedKey = savedKey.length > 0;

    return (
        <div className="settings-page">
            <div className="settings-panel">
                <header className="settings-header">
                    <span className="settings-kicker">Configurações</span>
                    <h1>Aparência, uso e integrações</h1>
                </header>

                {/* Aparência */}
                <section id="sec-aparencia" className="settings-section">
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

                {/* Idioma */}
                <section id="sec-idioma" className="settings-section">
                    <h2 className="settings-section-title">🌐 Idioma</h2>
                    <p className="settings-muted">
                        Vale para as telas traduzidas (Login, Boas-vindas, menu lateral).
                    </p>
                    <div className="settings-options-row">
                        {LANGUAGES.map((lang, index) => (
                            <button
                                key={lang.id}
                                className={`settings-option ${language === lang.id ? 'selected' : ''} ${focusZone === 'lang' && langIndex === index ? 'focused' : ''}`}
                                onClick={() => applyLanguage(lang.id)}
                            >
                                {lang.label}
                            </button>
                        ))}
                    </div>
                </section>

                {/* Playlists */}
                <section id="sec-playlists" className="settings-section">
                    <h2 className="settings-section-title">📡 Playlists</h2>
                    <p className="settings-muted">
                        OK troca de provedor (recarrega o app) · 🔴 remove a playlist focada
                    </p>
                    <div className="settings-options-row settings-playlists">
                        {playlists.map((entry, index) => (
                            <button
                                key={entry.id}
                                className={`settings-option ${entry.id === activePlaylistId ? 'selected' : ''} ${focusZone === 'playlists' && safePlaylistIndex === index ? 'focused' : ''}`}
                                onClick={() => switchPlaylist(entry)}
                                title={entry.url}
                            >
                                {entry.id === activePlaylistId ? '✓ ' : ''}{entry.alias}
                                {entry.id !== activePlaylistId && (
                                    <span
                                        className="playlist-remove"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            removePlaylist(entry);
                                        }}
                                    >
                                        ✕
                                    </span>
                                )}
                            </button>
                        ))}
                        <button
                            className={`settings-option ${focusZone === 'playlists' && safePlaylistIndex === playlists.length ? 'focused' : ''}`}
                            onClick={() => onAddPlaylist?.()}
                        >
                            ➕ Adicionar
                        </button>
                    </div>
                </section>

                {/* TV ao Vivo */}
                <section id="sec-tv" className="settings-section">
                    <h2 className="settings-section-title">📺 TV ao Vivo</h2>
                    <div className="settings-row">
                        <span className="settings-label">Ajuste de fuso do EPG (←→ muda, OK zera)</span>
                        <span className={`settings-value ${focusZone === 'epgoffset' ? 'focused' : ''}`}>
                            {epgOffsetHours > 0 ? `+${epgOffsetHours}h` : epgOffsetHours < 0 ? `${epgOffsetHours}h` : 'Sem ajuste'}
                        </span>
                    </div>
                    <div className="settings-row">
                        <span className="settings-label">Ligar direto no último canal</span>
                        <span className={`settings-value ${focusZone === 'bootlast' ? 'focused' : ''}`}>
                            {bootLast ? 'Ligado' : 'Desligado'}
                        </span>
                    </div>
                </section>

                {/* Reprodução */}
                <section id="sec-player" className="settings-section">
                    <h2 className="settings-section-title">▶️ Reprodução</h2>
                    <div className="settings-row">
                        <span className="settings-label">Qualidade máxima (←→ muda, OK remove o limite)</span>
                        <span className={`settings-value ${focusZone === 'qualitycap' ? 'focused' : ''}`}>
                            {qualityCap.label(cap)}
                        </span>
                    </div>
                    <p className="settings-muted">
                        Vale pra rede fraca: o player nunca sobe além disso. Aplica no próximo play.
                    </p>
                </section>

                {/* Seu uso */}
                <section id="sec-uso" className="settings-section">
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
                            <div className="settings-actions">
                                <button
                                    className={`settings-button primary ${focusZone === 'wrapped' ? 'focused' : ''}`}
                                    onClick={() => setShowWrapped(true)}
                                >
                                    🏆 Ver retrospectiva
                                </button>
                            </div>
                        </>
                    )}
                </section>

                {/* TMDB */}
                <section id="sec-tmdb" className="settings-section">
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

            {/* Retrospectiva (Wrapped) */}
            {showWrapped && (
                <WrappedOverlay onClose={() => setShowWrapped(false)} />
            )}
        </div>
    );
}
