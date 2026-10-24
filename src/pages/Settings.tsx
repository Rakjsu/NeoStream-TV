import { useEffect, useRef, useState } from 'react';
import { storage } from '../services/storage';
import { themeService, ACCENTS, ACCENT_IDS, BACKGROUNDS, BACKGROUND_IDS, type AccentId, type BackgroundId } from '../services/themeService';
import { usageStats, type UsageSummary } from '../services/usageStats';
import { playlistService, type PlaylistEntry } from '../services/playlistService';
import { sectionVisibility, type SecoesVisiveis } from '../services/sectionVisibility';
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
import { PinPrompt, PinRecovery } from '../components/PinPrompt';
import { RemoteGuide } from '../components/RemoteGuide';
import { DiagnosticsOverlay, QrBackupOverlay } from '../components/SystemOverlays';
import { WrappedOverlay } from '../components/WrappedOverlay';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useTranslation } from '../hooks/useTranslation';
import { getLocale, tt, type Language } from '../i18n';
import { useFocusZone } from '../contexts/FocusContext';
import './Settings.css';

type FocusZone =
    | 'bg' | 'accent' | 'lang' | 'playlists'
    | 'showtv' | 'showvod'
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
    'showtv', 'showvod',
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
    return new Date(epochMs).toLocaleDateString(getLocale());
}

type LanguageId = Language;
const LANGUAGES: Array<{ id: LanguageId; label: string }> = [
    { id: 'pt', label: 'Português' },
    { id: 'en', label: 'English' },
    { id: 'es', label: 'Español' },
    { id: 'de', label: 'Deutsch' },
];

/**
 * Gravação de conta que não coube nem depois de podar os caches (T107). Dizer
 * "salvo" aqui era mentira: o PIN ou a playlist sumiam no boot seguinte.
 */
const SEM_ESPACO = () => tt('settings_no_space');

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
    const { t } = useTranslation();
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
    // Seções do menu (TV ao vivo / Filmes e Séries): antes só o Login mexia
    const [secoes, setSecoes] = useState<SecoesVisiveis>(() => sectionVisibility.get());

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
    // 'recover' = PIN esquecido: a senha da conta IPTV remove o PIN (T073)
    const [pinMode, setPinMode] = useState<'none' | 'entry' | 'unlock' | 'define' | 'recover'>(
        () => (parentalService.requires('settings') ? 'entry' : 'none')
    );
    // De qual teclado de PIN o resgate saiu: Voltar devolve pra ele
    const [resgateDe, setResgateDe] = useState<'entry' | 'unlock'>('entry');
    // O que fazer depois de um 'unlock' bem-sucedido
    const [afterUnlock, setAfterUnlock] = useState<
        | null
        | { kind: 'removepin' }
        | { kind: 'resetconta' }
        | { kind: 'gate'; gate: 'settings' | 'leaveKids'; value: boolean }
    >(null);
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
        setMessage(current ? t('settings_tmdb_saved') : t('settings_tmdb_removed'));
    };

    const clearKey = () => {
        storage.clearTmdbApiKey();
        setTmdbKey('');
        setSavedKey('');
        setMessage(t('settings_tmdb_removed_device'));
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
        setMessage(t('settings_lang_changed'));
    };

    // Mesmas chaves dos checkboxes do Login; o serviço espelha na playlist
    // ativa e avisa a sidebar, que re-renderiza na hora.
    const applySecoes = (parcial: Partial<SecoesVisiveis>) => {
        setSecoes(sectionVisibility.set(parcial));
    };

    // Trocar de playlist re-autentica do zero (reload é o caminho robusto na TV)
    const switchPlaylist = (entry: PlaylistEntry) => {
        if (entry.id === activePlaylistId) return;
        if (playlistService.setActive(entry.id)) {
            window.location.reload();
        } else {
            setMessage(SEM_ESPACO());
        }
    };

    const removePlaylist = (entry: PlaylistEntry) => {
        if (entry.id === activePlaylistId) {
            setMessage(t('settings_playlist_active_locked'));
            return;
        }
        if (playlistService.remove(entry.id)) {
            setPlaylists(playlistService.list());
            setActivePlaylistId(playlistService.getActiveId());
            setMessage(t('settings_playlist_removed', { name: entry.alias }));
        } else {
            setMessage(SEM_ESPACO());
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
            } else if (focusZone === 'showtv') {
                applySecoes({ tv: direction === 'right' });
            } else if (focusZone === 'showvod') {
                applySecoes({ vod: direction === 'right' });
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
                if (parentalService.setGates({ [gate]: value })) setGates(prev => ({ ...prev, [gate]: value }));
                else setMessage(SEM_ESPACO());
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
            else if (focusZone === 'showtv') applySecoes({ tv: !secoes.tv });
            else if (focusZone === 'showvod') applySecoes({ vod: !secoes.vod });
            else if (focusZone === 'epgoffset') {
                epgOffset.set(0);
                setEpgOffsetHours(0);
                setMessage(t('settings_epg_reset'));
            }
            else if (focusZone === 'bootlast') {
                setBootLast(prev => {
                    bootLastChannel.set(!prev);
                    return !prev;
                });
            }
            // 🔘 Numa TV, OK é a tecla de "acionar isto" — e a linha logo acima
            // ensina exatamente isso. Sem os ramos abaixo, sete linhas de cara
            // idêntica não respondiam a OK, só a ←→, sem nada na tela dizendo:
            // a pessoa no sofá parava em "Alto contraste", apertava OK três
            // vezes e concluía que a opção estava quebrada.
            else if (focusZone === 'autonext') {
                setPlayback(prev => {
                    const autoNextEpisode = !prev.autoNextEpisode;
                    playbackPrefs.set({ autoNextEpisode });
                    return { ...prev, autoNextEpisode };
                });
            }
            else if (focusZone === 'resume') {
                setPlayback(prev => {
                    const resume = !prev.resume;
                    playbackPrefs.set({ resume });
                    return { ...prev, resume };
                });
            }
            else if (focusZone === 'contrast') {
                const next: ContrastMode = contrast === 'alto' ? 'normal' : 'alto';
                a11yService.setContrast(next);
                setContrast(next);
            }
            else if (focusZone === 'motion') {
                const next = !reduceMotion;
                a11yService.setReduceMotion(next);
                setReduceMotion(next);
            }
            else if (focusZone === 'burnin') {
                const next = !dimmer;
                burnIn.setEnabled(next);
                setDimmer(next);
            }
            else if (focusZone === 'gatesettings' || focusZone === 'gatekids') {
                const gate = focusZone === 'gatesettings' ? 'settings' as const : 'leaveKids' as const;
                const value = !gates[gate];
                if (!parentalUnlocked) {
                    // Mesma trava do ←→: inverter a trava sem provar o PIN
                    // esvaziava o controle parental inteiro em duas teclas.
                    setAfterUnlock({ kind: 'gate', gate, value });
                    setPinMode('unlock');
                    return;
                }
                if (parentalService.setGates({ [gate]: value })) setGates(prev => ({ ...prev, [gate]: value }));
                else setMessage(SEM_ESPACO());
            }
            else if (focusZone === 'qualitycap') {
                qualityCap.set(0);
                setCap(0);
                setMessage(t('settings_cap_removed'));
            }
            // Réguas de vários valores: OK volta ao padrão, o mesmo que o fuso
            // do EPG e o teto de qualidade já fazem.
            else if (focusZone === 'buffer') {
                const bufferProfile: BufferProfile = 'equilibrado';
                playbackPrefs.set({ bufferProfile });
                setPlayback(prev => ({ ...prev, bufferProfile }));
                setMessage(t('settings_buffer_reset'));
            }
            else if (focusZone === 'textscale') {
                a11yService.setTextScale(100);
                setTextScale(100);
                setMessage(t('settings_textscale_reset'));
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
                    setMessage(t('settings_no_snapshot'));
                } else if (configSnapshot.restore(snapshotIndex)) {
                    themeService.apply();
                    a11yService.apply();
                    setMessage(t('settings_restored_reloading'));
                    setTimeout(() => window.location.reload(), 900);
                }
            }
            else if (focusZone === 'reset') {
                const group = DATA_GROUP_IDS[resetIndex];
                // O grupo "conta" carrega o PIN parental: apagá-lo sem provar
                // o PIN destravava o modo Kids por um caminho lateral
                if (group === 'conta' && !parentalUnlocked && parentalService.isSet()) {
                    setAfterUnlock({ kind: 'resetconta' });
                    setPinMode('unlock');
                    return;
                }
                if (!resetArmed) {
                    setResetArmed(true);
                    setMessage(t('settings_reset_confirm', { group: DATA_GROUPS[group].label }));
                } else {
                    const result = resetGroup(group);
                    setResetArmed(false);
                    setMessage(t('settings_reset_done', { n: result.removed }));
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
            showtv: 'sec-playlists',
            showvod: 'sec-playlists',
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

    // PIN esquecido (T073): sem isto a trava de entrada não tinha saída — o
    // único apagador do PIN morava DENTRO da página trancada. Só é oferecido
    // quando há senha de conta pra conferir.
    const esqueciOPin = (de: 'entry' | 'unlock') => (
        parentalService.podeResgatar()
            ? () => {
                setResgateDe(de);
                setPinMode('recover');
            }
            : undefined
    );

    if (pinMode === 'recover') {
        return (
            <PinRecovery
                enabled={appFocusZone === 'content'}
                onRecovered={() => {
                    setPinSet(false);
                    setParentalUnlocked(true);
                    setAfterUnlock(null);
                    setPinMode('none');
                    setMessage(t('settings_pin_recovered'));
                }}
                onCancel={() => setPinMode(resgateDe)}
            />
        );
    }

    // Porta de entrada: com PIN parental exigido, a página não renderiza nada
    // antes de o PIN ser aceito (item 55). Cancelar devolve o foco à sidebar —
    // a Settings não tinha caminho de volta por D-pad nenhum.
    if (pinMode === 'entry') {
        return (
            <PinPrompt
                title={t('pin_settings_title')}
                hint={t('pin_settings_hint')}
                parental
                // Cancelar devolve o foco pra sidebar mas a trava CONTINUA na
                // tela: sem isto os dois receberiam a mesma tecla
                enabled={appFocusZone === 'content'}
                onForgot={esqueciOPin('entry')}
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
                title={t('pin_confirm_title')}
                parental
                onForgot={esqueciOPin('unlock')}
                hint={afterUnlock?.kind === 'removepin'
                    ? t('pin_remove_hint')
                    : afterUnlock?.kind === 'resetconta'
                        ? t('pin_resetconta_hint')
                    : t('pin_gates_hint')}
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
                        setMessage(t('settings_pin_removed'));
                    } else if (action?.kind === 'resetconta') {
                        // PIN provado: o usuário ainda precisa confirmar
                        setResetArmed(true);
                        setMessage(t('settings_reset_confirm', { group: DATA_GROUPS.conta.label }));
                    } else if (action?.kind === 'gate') {
                        if (parentalService.setGates({ [action.gate]: action.value })) {
                            setGates(prev => ({ ...prev, [action.gate]: action.value }));
                        } else {
                            setMessage(SEM_ESPACO());
                        }
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
                title={t('pin_define_title')}
                hint={t('pin_define_hint')}
                onSubmit={async (pin) => {
                    const ok = await parentalService.set(pin);
                    if (!ok) {
                        // O PinPrompt só entrega 4 dígitos: false aqui é o PIN
                        // que não coube. Devolver false mostraria "PIN
                        // incorreto" — fecha e diz o que houve de verdade.
                        setPinMode('none');
                        setMessage(SEM_ESPACO());
                        return true;
                    }
                    setPinSet(true);
                    // Quem acabou de criar o PIN já o provou
                    setParentalUnlocked(true);
                    setPinMode('none');
                    setMessage(t('settings_pin_created'));
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
                    <span className="settings-kicker">{t('settings_kicker')}</span>
                    <h1>{t('settings_subtitle')}</h1>
                </header>

                {/* Aparência */}
                <section id="sec-aparencia" className="settings-section">
                    <h2 className="settings-section-title">{t('settings_sec_appearance')}</h2>

                    <label className="settings-label">{t('settings_background')}</label>
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

                    <label className="settings-label">{t('settings_accent')}</label>
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
                    <h2 className="settings-section-title">{t('settings_sec_language')}</h2>
                    <p className="settings-muted">
                        {t('settings_lang_note')}
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
                    <h2 className="settings-section-title">{t('settings_sec_playlists')}</h2>
                    <p className="settings-muted">
                        {t('settings_playlists_hint')}
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
                            {t('settings_add')}
                        </button>
                    </div>

                    {/* Os checkboxes "Incluir" do Login, pra quem já entrou */}
                    <div className="settings-row">
                        <span className="settings-label">{t('settings_show_tv')}</span>
                        <span className={`settings-value ${focusZone === 'showtv' ? 'focused' : ''}`}>
                            {secoes.tv ? t('common_on') : t('common_off')}
                        </span>
                    </div>
                    <div className="settings-row">
                        <span className="settings-label">{t('settings_show_vod')}</span>
                        <span className={`settings-value ${focusZone === 'showvod' ? 'focused' : ''}`}>
                            {secoes.vod ? t('common_on') : t('common_off')}
                        </span>
                    </div>
                    <p className="settings-muted">
                        {t('settings_sections_note')}
                    </p>
                </section>

                {/* TV ao Vivo */}
                <section id="sec-tv" className="settings-section">
                    <h2 className="settings-section-title">{t('settings_sec_tv')}</h2>
                    <div className="settings-row">
                        <span className="settings-label">{t('settings_epg_offset')}</span>
                        <span className={`settings-value ${focusZone === 'epgoffset' ? 'focused' : ''}`}>
                            {epgOffsetHours > 0 ? `+${epgOffsetHours}h` : epgOffsetHours < 0 ? `${epgOffsetHours}h` : t('settings_epg_none')}
                        </span>
                    </div>
                    <div className="settings-row">
                        <span className="settings-label">{t('settings_boot_last')}</span>
                        <span className={`settings-value ${focusZone === 'bootlast' ? 'focused' : ''}`}>
                            {bootLast ? t('common_on') : t('common_off')}
                        </span>
                    </div>
                </section>

                {/* Reprodução */}
                <section id="sec-player" className="settings-section">
                    <h2 className="settings-section-title">{t('settings_sec_playback')}</h2>
                    <div className="settings-row">
                        <span className="settings-label">{t('settings_quality_cap')}</span>
                        <span className={`settings-value ${focusZone === 'qualitycap' ? 'focused' : ''}`}>
                            {qualityCap.label(cap)}
                        </span>
                    </div>
                    <p className="settings-muted">
                        {t('settings_cap_note')}
                    </p>

                    <div className="settings-row">
                        <span className="settings-label">{t('settings_auto_next')}</span>
                        <span className={`settings-value ${focusZone === 'autonext' ? 'focused' : ''}`}>
                            {playback.autoNextEpisode ? t('common_on') : t('common_off')}
                        </span>
                    </div>

                    <div className="settings-row">
                        <span className="settings-label">{t('settings_resume')}</span>
                        <span className={`settings-value ${focusZone === 'resume' ? 'focused' : ''}`}>
                            {playback.resume ? t('common_on') : t('common_off')}
                        </span>
                    </div>

                    <div className="settings-row">
                        <span className="settings-label">{t('settings_buffer')}</span>
                        <span className={`settings-value ${focusZone === 'buffer' ? 'focused' : ''}`}>
                            {BUFFER_LABELS[playback.bufferProfile]}
                        </span>
                    </div>
                    <p className="settings-muted">
                        {t('settings_buffer_note')}
                    </p>
                </section>

                {/* Acessibilidade (itens 58, 64, 65) */}
                <section id="sec-a11y" className="settings-section">
                    <h2 className="settings-section-title">{t('settings_sec_a11y')}</h2>

                    <div className="settings-row">
                        <span className="settings-label">{t('settings_contrast')}</span>
                        <span className={`settings-value ${focusZone === 'contrast' ? 'focused' : ''}`}>
                            {contrast === 'alto' ? t('common_on') : t('common_off')}
                        </span>
                    </div>
                    <p className="settings-muted">
                        {t('settings_contrast_note')}
                    </p>

                    <div className="settings-row">
                        <span className="settings-label">{t('settings_textscale')}</span>
                        <span className={`settings-value ${focusZone === 'textscale' ? 'focused' : ''}`}>
                            {textScale}%
                        </span>
                    </div>

                    <div className="settings-row">
                        <span className="settings-label">{t('settings_motion')}</span>
                        <span className={`settings-value ${focusZone === 'motion' ? 'focused' : ''}`}>
                            {reduceMotion ? t('common_on') : t('common_off')}
                        </span>
                    </div>
                    <p className="settings-muted">
                        {t('settings_motion_note')}
                    </p>

                    <div className="settings-row">
                        <span className="settings-label">{t('settings_burnin')}</span>
                        <span className={`settings-value ${focusZone === 'burnin' ? 'focused' : ''}`}>
                            {dimmer ? t('common_on') : t('common_off')}
                        </span>
                    </div>
                    <p className="settings-muted">
                        {t('settings_burnin_note')}
                    </p>
                </section>

                {/* Minha conta (item 56) */}
                <section id="sec-conta" className="settings-section">
                    <h2 className="settings-section-title">{t('settings_sec_account')}</h2>
                    {!account ? (
                        <p className="settings-muted">
                            {t('settings_account_none')}
                        </p>
                    ) : (
                        <>
                            <div className="settings-row">
                                <span className="settings-label">{t('settings_user')}</span>
                                <span className={`settings-value ${focusZone === 'account' ? 'focused' : ''}`}>
                                    {account.username || '—'}
                                </span>
                            </div>
                            <div className="settings-row">
                                <span className="settings-label">{t('settings_status')}</span>
                                <span className="settings-value">
                                    {account.status || '—'}{account.isTrial ? t('settings_trial') : ''}
                                </span>
                            </div>
                            <div className="settings-row">
                                <span className="settings-label">{t('settings_expiry')}</span>
                                <span className="settings-value">
                                    {account.expiresAt ? formatDate(account.expiresAt) : t('settings_no_date')}
                                    {expiryDays != null && expiryDays >= 0 && t('settings_days', { n: expiryDays })}
                                    {expiryDays != null && expiryDays < 0 && t('settings_expired')}
                                </span>
                            </div>
                            <div className="settings-row">
                                <span className="settings-label">{t('settings_connections')}</span>
                                <span className="settings-value">
                                    {t('settings_conn_inuse', { a: account.activeConnections ?? '?', b: account.maxConnections ?? '?' })}
                                </span>
                            </div>
                            <div className="settings-row">
                                <span className="settings-label">{t('settings_since')}</span>
                                <span className="settings-value">{formatDate(account.createdAt)}</span>
                            </div>
                            {account.inseguro && (
                                <p className="settings-warning">
                                    {t('settings_insecure_warn')}
                                </p>
                            )}
                            <p className="settings-muted">
                                {t('settings_account_note')}
                                {expiryDays != null && expiryDays <= EXPIRY_WARN_DAYS && expiryDays >= 0 &&
                                    t('settings_account_expiry_note')}
                            </p>
                        </>
                    )}
                </section>

                {/* Controle parental (item 55) */}
                <section id="sec-parental" className="settings-section">
                    <h2 className="settings-section-title">{t('settings_sec_parental')}</h2>
                    <div className="settings-row">
                        <span className="settings-label">
                            {t('settings_pin_4digit', { action: pinSet ? t('common_remove') : t('common_define') })}
                        </span>
                        <span className={`settings-value ${focusZone === 'parentalpin' ? 'focused' : ''}`}>
                            {pinSet ? t('common_set') : t('common_notset')}
                        </span>
                    </div>

                    <div className="settings-row">
                        <span className="settings-label">{t('settings_gate_settings')}</span>
                        <span className={`settings-value ${focusZone === 'gatesettings' ? 'focused' : ''} ${pinSet ? '' : 'settings-value-off'}`}>
                            {gates.settings ? t('common_on') : t('common_off')}
                        </span>
                    </div>

                    <div className="settings-row">
                        <span className="settings-label">{t('settings_gate_kids')}</span>
                        <span className={`settings-value ${focusZone === 'gatekids' ? 'focused' : ''} ${pinSet ? '' : 'settings-value-off'}`}>
                            {gates.leaveKids ? t('common_on') : t('common_off')}
                        </span>
                    </div>
                    <p className="settings-muted">
                        {pinSet ? t('settings_parental_on_note') : t('settings_parental_off_note')}
                    </p>
                </section>

                {/* Sistema (itens 57, 59, 61, 62, 63) */}
                <section id="sec-sistema" className="settings-section">
                    <h2 className="settings-section-title">{t('settings_sec_system')}</h2>

                    <div className="settings-row">
                        <span className="settings-label">{t('settings_remote_guide')}</span>
                        <span className={`settings-value ${focusZone === 'guide' ? 'focused' : ''}`}>{t('settings_ok_opens')}</span>
                    </div>

                    <div className="settings-row">
                        <span className="settings-label">{t('settings_diag')}</span>
                        <span className={`settings-value ${focusZone === 'diag' ? 'focused' : ''}`}>{t('settings_ok_opens')}</span>
                    </div>

                    <div className="settings-row">
                        <span className="settings-label">{t('settings_qrbackup')}</span>
                        <span className={`settings-value ${focusZone === 'qrbackup' ? 'focused' : ''}`}>{t('settings_ok_opens')}</span>
                    </div>

                    <div className="settings-row">
                        <span className="settings-label">
                            {t('settings_restore_point')} {snapshots.length > 0 ? t('settings_restore_hint') : ''}
                        </span>
                        <span className={`settings-value ${focusZone === 'snapshot' ? 'focused' : ''}`}>
                            {snapshots.length === 0
                                ? t('settings_none_yet')
                                : `${snapshotIndex + 1}/${snapshots.length} · ${formatDate(snapshots[snapshotIndex]?.at ?? null)}`}
                        </span>
                    </div>
                    <p className="settings-muted">
                        {t('settings_snapshot_note')}
                    </p>

                    <div className="settings-row">
                        <span className="settings-label">{t('settings_reset')}</span>
                        <span className={`settings-value ${focusZone === 'reset' ? 'focused' : ''} ${resetArmed ? 'settings-value-danger' : ''}`}>
                            {DATA_GROUPS[DATA_GROUP_IDS[resetIndex]].label} · {groupSizeKb(DATA_GROUP_IDS[resetIndex])} KB
                        </span>
                    </div>
                    <p className="settings-muted">
                        {resetArmed
                            ? t('settings_reset_armed')
                            : DATA_GROUPS[DATA_GROUP_IDS[resetIndex]].description}
                    </p>
                </section>

                {/* Seu uso */}
                <section id="sec-uso" className="settings-section">
                    <h2 className="settings-section-title">{t('settings_sec_usage')}</h2>
                    {usage.totalSeconds === 0 ? (
                        <p className="settings-muted">{t('settings_usage_empty')}</p>
                    ) : (
                        <>
                            <div className="usage-cards">
                                <div className="usage-card">
                                    <span className="usage-value">{formatHours(usage.totalSeconds)}</span>
                                    <span className="usage-label">{t('settings_usage_total')}</span>
                                </div>
                                <div className="usage-card">
                                    <span className="usage-value">{formatHours(usage.last7Seconds)}</span>
                                    <span className="usage-label">{t('settings_usage_7d')}</span>
                                </div>
                                <div className="usage-card">
                                    <span className="usage-value">{formatHours(usage.byKind.live)}</span>
                                    <span className="usage-label">{t('settings_usage_live')}</span>
                                </div>
                                <div className="usage-card">
                                    <span className="usage-value">{formatHours(usage.byKind.movie)}</span>
                                    <span className="usage-label">{t('settings_usage_movies')}</span>
                                </div>
                                <div className="usage-card">
                                    <span className="usage-value">{formatHours(usage.byKind.series)}</span>
                                    <span className="usage-label">{t('settings_usage_series')}</span>
                                </div>
                            </div>
                            {usage.topItems.length > 0 && (
                                <div className="usage-top">
                                    <span className="settings-label">{t('settings_top')}</span>
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
                                    {t('settings_wrapped')}
                                </button>
                            </div>
                        </>
                    )}
                </section>

                {/* TMDB */}
                <section id="sec-tmdb" className="settings-section">
                    <h2 className="settings-section-title">{t('settings_sec_tmdb')}</h2>
                    <p className="settings-muted">
                        {t('settings_tmdb_note')}
                    </p>
                    <label className="settings-label" htmlFor="tmdb-key">
                        {t('settings_tmdb_key')}
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
                        placeholder={t('settings_tmdb_placeholder')}
                        autoComplete="off"
                        spellCheck={false}
                    />

                    <div className="settings-status">
                        Status: {hasSavedKey ? t('settings_tmdb_status_saved') : t('settings_tmdb_status_none')}
                    </div>

                    <div className="settings-actions">
                        <button
                            className={`settings-button primary ${focusZone === 'save' ? 'focused' : ''}`}
                            onClick={saveKey}
                        >
                            {t('settings_save_key')}
                        </button>
                        <button
                            className={`settings-button secondary ${focusZone === 'clear' ? 'focused' : ''}`}
                            onClick={clearKey}
                            disabled={!hasSavedKey && !tmdbKey}
                        >
                            {t('settings_remove_key')}
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
