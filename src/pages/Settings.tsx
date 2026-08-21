import { useEffect, useRef, useState } from 'react';
import { storage } from '../services/storage';
import { themeService, ACCENTS, ACCENT_IDS, BACKGROUNDS, BACKGROUND_IDS, type AccentId, type BackgroundId } from '../services/themeService';
import { usageStats, type UsageSummary } from '../services/usageStats';
import { playlistService, type PlaylistEntry } from '../services/playlistService';
import { epgOffset } from '../services/epgService';
import { bootLastChannel } from '../services/liveExtras';
import { qualityCap, QUALITY_CAPS, type QualityCap } from '../services/playerPrefs';
import { playbackPrefs, BUFFER_PROFILES, BUFFER_LABELS, type BufferProfile } from '../services/playbackPrefs';
import { a11yService, TEXT_SCALES, type ContrastMode, type TextScale } from '../services/a11yService';
import { burnIn } from '../services/burnIn';
import { accountService, EXPIRY_WARN_DAYS } from '../services/accountService';
import { parentalService } from '../services/parentalService';
import { configSnapshot } from '../services/configSnapshot';
import { DATA_GROUPS, DATA_GROUP_IDS, resetGroup, groupSizeKb } from '../services/dataReset';
import { PinPrompt } from '../components/PinPrompt';
import { RemoteGuide } from '../components/RemoteGuide';
import { DiagnosticsOverlay, QrBackupOverlay } from '../components/SystemOverlays';
import { WrappedOverlay } from '../components/WrappedOverlay';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useFocusZone } from '../contexts/FocusContext';
import './Settings.css';

type FocusZone =
    | 'bg' | 'accent' | 'lang' | 'playlists'
    | 'epgoffset' | 'bootlast'
    | 'qualitycap' | 'autonext' | 'resume' | 'buffer'
    | 'contrast' | 'textscale' | 'motion' | 'burnin'
    | 'account'
    | 'parentalpin' | 'gatesettings' | 'gatekids'
    | 'guide' | 'diag' | 'qrbackup' | 'snapshot' | 'reset'
    | 'wrapped' | 'input' | 'save' | 'clear';

// A ORDEM aqui é a navegação vertical da página inteira
const ZONES: FocusZone[] = [
    'bg', 'accent', 'lang', 'playlists',
    'epgoffset', 'bootlast',
    'qualitycap', 'autonext', 'resume', 'buffer',
    'contrast', 'textscale', 'motion', 'burnin',
    'account',
    'parentalpin', 'gatesettings', 'gatekids',
    'guide', 'diag', 'qrbackup', 'snapshot', 'reset',
    'wrapped', 'input', 'save', 'clear',
];

function formatDate(epochMs: number | null): string {
    if (!epochMs) return '—';
    return new Date(epochMs).toLocaleDateString('pt-BR');
}

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
    const { focusZone: appFocusZone, setFocusZone: setAppFocusZone } = useFocusZone();
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

    // Reprodução (item 66)
    const [playback, setPlayback] = useState(() => playbackPrefs.get());
    // Acessibilidade (itens 58, 64, 65)
    const [contrast, setContrast] = useState<ContrastMode>(() => a11yService.getContrast());
    const [textScale, setTextScale] = useState<TextScale>(() => a11yService.getTextScale());
    const [reduceMotion, setReduceMotion] = useState(() => a11yService.getReduceMotion());
    // Anti burn-in (item 78)
    const [dimmer, setDimmer] = useState(() => burnIn.isEnabled());
    // Minha conta (item 56)
    const [account] = useState(() => accountService.get());
    // Controle parental (item 55)
    const [pinSet, setPinSet] = useState(() => parentalService.isSet());
    const [gates, setGates] = useState(() => parentalService.getGates());
    // 'entry'  = trava de ENTRADA da página (cancelar NÃO destranca)
    // 'unlock' = destravar as opções parentais (cancelar só fecha o diálogo)
    // 'define' = criar um PIN novo
    const [pinMode, setPinMode] = useState<'none' | 'entry' | 'unlock' | 'define'>(
        () => (parentalService.requires('settings') ? 'entry' : 'none')
    );
    // O que fazer depois de um 'unlock' bem-sucedido
    const [afterUnlock, setAfterUnlock] = useState<null | { kind: 'removepin' } | { kind: 'gate'; gate: 'settings' | 'leaveKids'; value: boolean }>(null);
    // Mexer nas travas exige ter provado o PIN nesta visita. Sem PIN definido,
    // não há o que destravar.
    const [parentalUnlocked, setParentalUnlocked] = useState(() => !parentalService.isSet());
    // Sistema (itens 57, 59, 61, 62, 63)
    const [showGuide, setShowGuide] = useState(false);
    const [showDiag, setShowDiag] = useState(false);
    const [showQr, setShowQr] = useState(false);
    const [snapshots] = useState(() => configSnapshot.list());
    const [snapshotIndex, setSnapshotIndex] = useState(0);
    const [resetIndex, setResetIndex] = useState(0);
    // Apagar dado é irreversível: o primeiro OK só arma, o segundo executa
    const [resetArmed, setResetArmed] = useState(false);

    // Estatísticas (lidas 1x ao abrir a página) + Wrapped
    const [usage] = useState<UsageSummary>(() => usageStats.summary());
    const [showWrapped, setShowWrapped] = useState(false);

    // Zonas ativas: 'wrapped' só existe quando há estatística (o botão só
    // renderiza nesse caso — zona invisível virava parada morta do D-pad)
    // Zona sem elemento na tela vira parada morta do D-pad: 'wrapped' só
    // existe com estatística e 'account' só com dados de conta salvos
    const zones: FocusZone[] = ZONES.filter(zone => {
        if (zone === 'wrapped') return usage.totalSeconds > 0;
        if (zone === 'account') return !!account;
        return true;
    });

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
        enabled: appFocusZone === 'content' && !editing && !showWrapped
            && pinMode === 'none' && !showGuide && !showDiag && !showQr,
        onNavigate: (direction) => {
            if (direction === 'up' || direction === 'down') {
                setResetArmed(false); // sair da linha cancela a confirmação
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
            } else if (focusZone === 'autonext') {
                const next = direction === 'right';
                playbackPrefs.set({ autoNextEpisode: next });
                setPlayback(prev => ({ ...prev, autoNextEpisode: next }));
            } else if (focusZone === 'resume') {
                const next = direction === 'right';
                playbackPrefs.set({ resume: next });
                setPlayback(prev => ({ ...prev, resume: next }));
            } else if (focusZone === 'buffer') {
                setPlayback(prev => {
                    const idx = Math.max(0, BUFFER_PROFILES.indexOf(prev.bufferProfile));
                    const nextIdx = direction === 'left'
                        ? Math.max(0, idx - 1)
                        : Math.min(BUFFER_PROFILES.length - 1, idx + 1);
                    const bufferProfile: BufferProfile = BUFFER_PROFILES[nextIdx];
                    playbackPrefs.set({ bufferProfile });
                    return { ...prev, bufferProfile };
                });
            } else if (focusZone === 'contrast') {
                const next: ContrastMode = direction === 'right' ? 'alto' : 'normal';
                a11yService.setContrast(next);
                setContrast(next);
            } else if (focusZone === 'textscale') {
                setTextScale(prev => {
                    const idx = Math.max(0, TEXT_SCALES.indexOf(prev));
                    const nextIdx = direction === 'left'
                        ? Math.max(0, idx - 1)
                        : Math.min(TEXT_SCALES.length - 1, idx + 1);
                    const next = TEXT_SCALES[nextIdx];
                    a11yService.setTextScale(next);
                    return next;
                });
            } else if (focusZone === 'motion') {
                const next = direction === 'right';
                a11yService.setReduceMotion(next);
                setReduceMotion(next);
            } else if (focusZone === 'burnin') {
                const next = direction === 'right';
                burnIn.setEnabled(next);
                setDimmer(next);
            } else if (focusZone === 'gatesettings' || focusZone === 'gatekids') {
                const gate = focusZone === 'gatesettings' ? 'settings' as const : 'leaveKids' as const;
                const value = direction === 'right';
                if (!parentalUnlocked) {
                    // Desligar a trava sem provar o PIN esvaziava o controle
                    // parental inteiro em duas teclas
                    setAfterUnlock({ kind: 'gate', gate, value });
                    setPinMode('unlock');
                    return;
                }
                parentalService.setGates({ [gate]: value });
                setGates(prev => ({ ...prev, [gate]: value }));
            } else if (focusZone === 'snapshot') {
                setSnapshotIndex(prev => direction === 'left'
                    ? Math.max(0, prev - 1)
                    : Math.min(Math.max(0, snapshots.length - 1), prev + 1));
            } else if (focusZone === 'reset') {
                setResetArmed(false); // trocou de grupo: desarma
                setResetIndex(prev => direction === 'left'
                    ? Math.max(0, prev - 1)
                    : Math.min(DATA_GROUP_IDS.length - 1, prev + 1));
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
            else if (focusZone === 'parentalpin') {
                if (pinSet) {
                    // Remover o PIN exige o próprio PIN
                    setAfterUnlock({ kind: 'removepin' });
                    setPinMode('unlock');
                } else {
                    setPinMode('define');
                }
            }
            else if (focusZone === 'guide') setShowGuide(true);
            else if (focusZone === 'diag') setShowDiag(true);
            else if (focusZone === 'qrbackup') setShowQr(true);
            else if (focusZone === 'snapshot') {
                if (snapshots.length === 0) {
                    setMessage('Nenhum ponto de restauração ainda.');
                } else if (configSnapshot.restore(snapshotIndex)) {
                    themeService.apply();
                    a11yService.apply();
                    setMessage('Preferências restauradas. Recarregando…');
                    setTimeout(() => window.location.reload(), 900);
                }
            }
            else if (focusZone === 'reset') {
                const group = DATA_GROUP_IDS[resetIndex];
                if (!resetArmed) {
                    setResetArmed(true);
                    setMessage(`OK de novo apaga: ${DATA_GROUPS[group].label}.`);
                } else {
                    const result = resetGroup(group);
                    setResetArmed(false);
                    setMessage(`${result.removed} registro(s) apagados. Recarregando…`);
                    setTimeout(() => window.location.reload(), 900);
                }
            }
            else if (focusZone === 'wrapped') setShowWrapped(true);
            else if (focusZone === 'input') {
                setEditing(true);
                inputRef.current?.focus();
            }
            else if (focusZone === 'save') saveKey();
            else if (focusZone === 'clear') clearKey();
        },
        onBack: () => {
            setResetArmed(false); // confirmação pendente não pode sobreviver à saída
            setAppFocusZone('sidebar');
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
            autonext: 'sec-player',
            resume: 'sec-player',
            buffer: 'sec-player',
            contrast: 'sec-a11y',
            textscale: 'sec-a11y',
            motion: 'sec-a11y',
            burnin: 'sec-a11y',
            account: 'sec-conta',
            parentalpin: 'sec-parental',
            gatesettings: 'sec-parental',
            gatekids: 'sec-parental',
            guide: 'sec-sistema',
            diag: 'sec-sistema',
            qrbackup: 'sec-sistema',
            snapshot: 'sec-sistema',
            reset: 'sec-sistema',
            wrapped: 'sec-uso',
            input: 'sec-tmdb',
            save: 'sec-tmdb',
            clear: 'sec-tmdb',
        };
        document.getElementById(sectionIds[focusZone])?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [focusZone]);

    const hasSavedKey = savedKey.length > 0;
    const expiryDays = accountService.daysUntilExpiry(account);

    // Porta de entrada: com PIN parental exigido, a página não renderiza nada
    // antes de o PIN ser aceito (item 55). Cancelar devolve o foco à sidebar —
    // a Settings não tinha caminho de volta por D-pad nenhum.
    if (pinMode === 'entry') {
        return (
            <PinPrompt
                title="Configurações protegidas"
                hint="Digite o PIN parental para continuar."
                // Cancelar devolve o foco pra sidebar mas a trava CONTINUA na
                // tela: sem isto os dois receberiam a mesma tecla
                enabled={appFocusZone === 'content'}
                onSubmit={async (pin) => {
                    const ok = await parentalService.verify(pin);
                    if (!ok) return false;
                    setParentalUnlocked(true);
                    setPinMode('none');
                    return true;
                }}
                onCancel={() => {
                    // NÃO destranca: só devolve o foco pra sidebar. Fazer
                    // setPinMode('none') aqui abria a página inteira com um
                    // toque em Voltar — o gate virava decoração.
                    setAppFocusZone('sidebar');
                }}
            />
        );
    }

    if (pinMode === 'unlock') {
        return (
            <PinPrompt
                title="Confirmar com o PIN"
                hint={afterUnlock?.kind === 'removepin'
                    ? 'Digite o PIN atual para removê-lo.'
                    : 'Digite o PIN para mudar as travas do controle parental.'}
                onSubmit={async (pin) => {
                    const ok = await parentalService.verify(pin);
                    if (!ok) return false;
                    setParentalUnlocked(true);
                    const action = afterUnlock;
                    setAfterUnlock(null);
                    setPinMode('none');
                    if (action?.kind === 'removepin') {
                        parentalService.clear();
                        setPinSet(false);
                        setParentalUnlocked(true);
                        setMessage('PIN parental removido.');
                    } else if (action?.kind === 'gate') {
                        parentalService.setGates({ [action.gate]: action.value });
                        setGates(prev => ({ ...prev, [action.gate]: action.value }));
                    }
                    return true;
                }}
                onCancel={() => {
                    // Aqui a página já está destravada: cancelar só descarta a
                    // ação pendente, sem mexer no gate de entrada
                    setAfterUnlock(null);
                    setPinMode('none');
                }}
            />
        );
    }

    if (pinMode === 'define') {
        return (
            <PinPrompt
                title="Criar PIN parental"
                hint="4 dígitos. Vale pra abrir as Configurações e pra sair do modo Kids."
                onSubmit={async (pin) => {
                    const ok = await parentalService.set(pin);
                    if (!ok) return false;
                    setPinSet(true);
                    // Quem acabou de criar o PIN já o provou
                    setParentalUnlocked(true);
                    setPinMode('none');
                    setMessage('PIN parental criado.');
                    return true;
                }}
                onCancel={() => setPinMode('none')}
            />
        );
    }

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

                    <div className="settings-row">
                        <span className="settings-label">Emendar o próximo episódio</span>
                        <span className={`settings-value ${focusZone === 'autonext' ? 'focused' : ''}`}>
                            {playback.autoNextEpisode ? 'Ligado' : 'Desligado'}
                        </span>
                    </div>

                    <div className="settings-row">
                        <span className="settings-label">Retomar de onde parou</span>
                        <span className={`settings-value ${focusZone === 'resume' ? 'focused' : ''}`}>
                            {playback.resume ? 'Ligado' : 'Desligado'}
                        </span>
                    </div>

                    <div className="settings-row">
                        <span className="settings-label">Buffer (←→ muda)</span>
                        <span className={`settings-value ${focusZone === 'buffer' ? 'focused' : ''}`}>
                            {BUFFER_LABELS[playback.bufferProfile]}
                        </span>
                    </div>
                    <p className="settings-muted">
                        Buffer maior aguenta rede instável e gasta mais memória. Aplica no próximo play.
                    </p>
                </section>

                {/* Acessibilidade (itens 58, 64, 65) */}
                <section id="sec-a11y" className="settings-section">
                    <h2 className="settings-section-title">♿ Acessibilidade</h2>

                    <div className="settings-row">
                        <span className="settings-label">Alto contraste</span>
                        <span className={`settings-value ${focusZone === 'contrast' ? 'focused' : ''}`}>
                            {contrast === 'alto' ? 'Ligado' : 'Desligado'}
                        </span>
                    </div>
                    <p className="settings-muted">
                        Fundo preto, texto mais claro e anel de foco amarelo bem mais grosso.
                    </p>

                    <div className="settings-row">
                        <span className="settings-label">Tamanho da interface (←→ muda)</span>
                        <span className={`settings-value ${focusZone === 'textscale' ? 'focused' : ''}`}>
                            {textScale}%
                        </span>
                    </div>

                    <div className="settings-row">
                        <span className="settings-label">Reduzir animações</span>
                        <span className={`settings-value ${focusZone === 'motion' ? 'focused' : ''}`}>
                            {reduceMotion ? 'Ligado' : 'Desligado'}
                        </span>
                    </div>
                    <p className="settings-muted">
                        Deixa a navegação mais responsiva em TVs antigas.
                    </p>

                    <div className="settings-row">
                        <span className="settings-label">Escurecer o menu parado (anti burn-in)</span>
                        <span className={`settings-value ${focusZone === 'burnin' ? 'focused' : ''}`}>
                            {dimmer ? 'Ligado' : 'Desligado'}
                        </span>
                    </div>
                    <p className="settings-muted">
                        Depois de 5 min sem tocar no controle a interface escurece — nunca
                        durante a reprodução. Protege painéis OLED de marcar a imagem.
                    </p>
                </section>

                {/* Minha conta (item 56) */}
                <section id="sec-conta" className="settings-section">
                    <h2 className="settings-section-title">👤 Minha conta</h2>
                    {!account ? (
                        <p className="settings-muted">
                            Os dados da conta aparecem depois do próximo login.
                        </p>
                    ) : (
                        <>
                            <div className="settings-row">
                                <span className="settings-label">Usuário</span>
                                <span className={`settings-value ${focusZone === 'account' ? 'focused' : ''}`}>
                                    {account.username || '—'}
                                </span>
                            </div>
                            <div className="settings-row">
                                <span className="settings-label">Situação</span>
                                <span className="settings-value">
                                    {account.status || '—'}{account.isTrial ? ' (teste)' : ''}
                                </span>
                            </div>
                            <div className="settings-row">
                                <span className="settings-label">Validade</span>
                                <span className="settings-value">
                                    {account.expiresAt ? formatDate(account.expiresAt) : 'sem data'}
                                    {expiryDays != null && expiryDays >= 0 && ` · ${expiryDays} dia(s)`}
                                    {expiryDays != null && expiryDays < 0 && ' · vencida'}
                                </span>
                            </div>
                            <div className="settings-row">
                                <span className="settings-label">Conexões</span>
                                <span className="settings-value">
                                    {account.activeConnections ?? '?'} de {account.maxConnections ?? '?'} em uso
                                </span>
                            </div>
                            <div className="settings-row">
                                <span className="settings-label">Cliente desde</span>
                                <span className="settings-value">{formatDate(account.createdAt)}</span>
                            </div>
                            <p className="settings-muted">
                                Lido do provedor no último login — atualiza sozinho ao entrar de novo.
                                {expiryDays != null && expiryDays <= EXPIRY_WARN_DAYS && expiryDays >= 0 &&
                                    ' A Home avisa quando estiver perto de vencer.'}
                            </p>
                        </>
                    )}
                </section>

                {/* Controle parental (item 55) */}
                <section id="sec-parental" className="settings-section">
                    <h2 className="settings-section-title">🔒 Controle parental</h2>
                    <div className="settings-row">
                        <span className="settings-label">
                            PIN de 4 dígitos (OK {pinSet ? 'remove' : 'define'})
                        </span>
                        <span className={`settings-value ${focusZone === 'parentalpin' ? 'focused' : ''}`}>
                            {pinSet ? 'Definido' : 'Não definido'}
                        </span>
                    </div>

                    <div className="settings-row">
                        <span className="settings-label">Pedir PIN pra abrir Configurações</span>
                        <span className={`settings-value ${focusZone === 'gatesettings' ? 'focused' : ''} ${pinSet ? '' : 'settings-value-off'}`}>
                            {gates.settings ? 'Ligado' : 'Desligado'}
                        </span>
                    </div>

                    <div className="settings-row">
                        <span className="settings-label">Pedir PIN pra sair de um perfil Kids</span>
                        <span className={`settings-value ${focusZone === 'gatekids' ? 'focused' : ''} ${pinSet ? '' : 'settings-value-off'}`}>
                            {gates.leaveKids ? 'Ligado' : 'Desligado'}
                        </span>
                    </div>
                    <p className="settings-muted">
                        {pinSet
                            ? 'Sem o PIN não dá pra sair do modo Kids nem mexer aqui.'
                            : 'Enquanto não houver PIN, estas travas ficam inativas — o modo Kids é contornável em dois cliques.'}
                    </p>
                </section>

                {/* Sistema (itens 57, 59, 61, 62, 63) */}
                <section id="sec-sistema" className="settings-section">
                    <h2 className="settings-section-title">🛠 Sistema</h2>

                    <div className="settings-row">
                        <span className="settings-label">Guia do controle remoto</span>
                        <span className={`settings-value ${focusZone === 'guide' ? 'focused' : ''}`}>OK abre</span>
                    </div>

                    <div className="settings-row">
                        <span className="settings-label">Diagnóstico e testes de rede</span>
                        <span className={`settings-value ${focusZone === 'diag' ? 'focused' : ''}`}>OK abre</span>
                    </div>

                    <div className="settings-row">
                        <span className="settings-label">Backup das preferências por QR</span>
                        <span className={`settings-value ${focusZone === 'qrbackup' ? 'focused' : ''}`}>OK abre</span>
                    </div>

                    <div className="settings-row">
                        <span className="settings-label">
                            Ponto de restauração {snapshots.length > 0 ? '(←→ escolhe, OK restaura)' : ''}
                        </span>
                        <span className={`settings-value ${focusZone === 'snapshot' ? 'focused' : ''}`}>
                            {snapshots.length === 0
                                ? 'nenhum ainda'
                                : `${snapshotIndex + 1}/${snapshots.length} · ${formatDate(snapshots[snapshotIndex]?.at ?? null)}`}
                        </span>
                    </div>
                    <p className="settings-muted">
                        Um retrato das preferências é guardado por semana. Restaurar recarrega o app.
                    </p>

                    <div className="settings-row">
                        <span className="settings-label">Apagar dados (←→ escolhe o grupo)</span>
                        <span className={`settings-value ${focusZone === 'reset' ? 'focused' : ''} ${resetArmed ? 'settings-value-danger' : ''}`}>
                            {DATA_GROUPS[DATA_GROUP_IDS[resetIndex]].label} · {groupSizeKb(DATA_GROUP_IDS[resetIndex])} KB
                        </span>
                    </div>
                    <p className="settings-muted">
                        {resetArmed
                            ? '⚠️ Pressione OK de novo para apagar. Sair da linha cancela.'
                            : DATA_GROUPS[DATA_GROUP_IDS[resetIndex]].description}
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

            {showGuide && <RemoteGuide onClose={() => setShowGuide(false)} />}
            {showDiag && (
                <DiagnosticsOverlay
                    onClose={() => setShowDiag(false)}
                    speedTestStreamId={storage.getLastChannel()}
                />
            )}
            {showQr && <QrBackupOverlay onClose={() => setShowQr(false)} />}
        </div>
    );
}
