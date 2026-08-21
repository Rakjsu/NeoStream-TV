// Main App Component - NeoStream TV

import { useState, useEffect, useCallback } from 'react';
import { api } from './services/api';
import { storage } from './services/storage';
import { Welcome } from './pages/Welcome';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { LiveTV } from './pages/LiveTV';
import { Movies } from './pages/Movies';
import { Series } from './pages/Series';
import { Favorites } from './pages/Favorites';
import { MyList } from './pages/MyList';
import { Settings } from './pages/Settings';
import { LanguageSelection } from './pages/LanguageSelection';
import { Sidebar } from './components/Sidebar';
import { ProfileManager } from './components/ProfileManager';
import { GlobalSearch } from './components/GlobalSearch';
import { playlistService } from './services/playlistService';
import { bootLastChannel } from './services/liveExtras';
import { reminderService, type Reminder } from './services/reminderService';
import { FocusContext, type FocusZone } from './contexts/FocusContext';
import { useTVNavigation } from './hooks/useTVNavigation';
import { themeService } from './services/themeService';
import './index.css';
import './App.css';
import './components/LivePanels.css';

type Page = 'home' | 'live' | 'movies' | 'series' | 'mylist' | 'favorites' | 'settings';
type AuthState = 'loading' | 'languageSelection' | 'welcome' | 'login' | 'authenticated' | 'offline';

// No Tizen real, teclas além de setas/OK/Back (CH±, dígitos, color keys,
// media keys) só chegam ao web app se registradas via tvinputdevice.
const TIZEN_KEYS = [
  'ChannelUp', 'ChannelDown',
  'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'MediaPlayPause', 'MediaPause', 'MediaPlay', 'MediaStop',
  // O player trata estas no seek/troca de episódio (item 38) — sem registrar
  // aqui, o pressionamento nunca chega ao web app na TV real
  'MediaRewind', 'MediaFastForward', 'MediaTrackPrevious', 'MediaTrackNext',
];

function registerTizenKeys() {
  const tizen = (window as unknown as { tizen?: { tvinputdevice?: { registerKey: (key: string) => void } } }).tizen;
  if (!tizen?.tvinputdevice) return;
  for (const key of TIZEN_KEYS) {
    try {
      tizen.tvinputdevice.registerKey(key);
    } catch {
      // Tecla não suportada nesse modelo — segue o baile
    }
  }
}

function OfflineRetry({ onRetry, onOtherLogin }: { onRetry: () => void; onOtherLogin: () => void }) {
  // 0 = tentar de novo, 1 = usar outro login (o erro pode ser do provedor,
  // não da rede — sem esta saída a tela virava beco sem saída)
  const [focusedIndex, setFocusedIndex] = useState(0);

  useTVNavigation({
    onNavigate: (direction) => {
      if (direction === 'left' || direction === 'up') setFocusedIndex(0);
      else if (direction === 'right' || direction === 'down') setFocusedIndex(1);
    },
    onEnter: () => {
      if (focusedIndex === 0) onRetry();
      else onOtherLogin();
    },
    onBack: onOtherLogin,
  });

  // Rede da TV voltou (evento do sistema) → tenta sozinho
  useEffect(() => {
    window.addEventListener('online', onRetry);
    return () => window.removeEventListener('online', onRetry);
  }, [onRetry]);

  return (
    <div className="app-loading">
      <div className="app-loading-logo">📡</div>
      <p className="app-loading-text">Sem conexão com o servidor</p>
      <p className="app-offline-hint">
        Suas credenciais foram mantidas. Verifique a rede da TV e pressione OK
        para tentar de novo — ou use outro login se o problema for do provedor.
      </p>
      <div className="app-offline-actions">
        <button
          className={`app-offline-retry ${focusedIndex === 0 ? 'tv-focused' : ''}`}
          onClick={onRetry}
        >
          🔄 Tentar novamente
        </button>
        <button
          className={`app-offline-retry app-offline-secondary ${focusedIndex === 1 ? 'tv-focused' : ''}`}
          onClick={onOtherLogin}
        >
          👤 Usar outro login
        </button>
      </div>
    </div>
  );
}

/** Aviso de lembrete (item 3): OK assiste, Voltar dispensa. */
function ReminderToast({ reminder, onWatch, onDismiss }: {
  reminder: Reminder;
  onWatch: () => void;
  onDismiss: () => void;
}) {
  useTVNavigation({ onEnter: onWatch, onBack: onDismiss });
  return (
    <div className="reminder-toast">
      <span className="reminder-toast-text">
        🔔 {reminder.programTitle} começa já em {reminder.channelName}
      </span>
      <button className="app-offline-retry tv-focused" onClick={onWatch}>
        ▶ Assistir agora
      </button>
      <span className="reminder-toast-hint">OK assiste · Voltar dispensa</span>
    </div>
  );
}

function App() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [focusZone, setFocusZone] = useState<FocusZone>('content');
  const [showProfileManager, setShowProfileManager] = useState(false);
  // Troca de perfil remonta a página atual (refetch com o gate kids certo)
  const [profileTick, setProfileTick] = useState(0);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  // Fluxo ➕ Adicionar playlist: Login abre em branco
  const [addingPlaylist, setAddingPlaylist] = useState(false);
  // Lembretes vivem no App: disparam em QUALQUER página (na LiveTV só,
  // o aviso morria ao sair da página e o timer era recriado a cada volta)
  const [activeReminder, setActiveReminder] = useState<Reminder | null>(null);

  useEffect(() => {
    registerTizenKeys();
    playlistService.migrate();
    themeService.apply();
    reminderService.init();
    return reminderService.subscribe(reminder => setActiveReminder(reminder));
  }, []);

  // O aviso some sozinho depois de 45s
  useEffect(() => {
    if (!activeReminder) return;
    const timeout = setTimeout(() => setActiveReminder(null), 45000);
    return () => clearTimeout(timeout);
  }, [activeReminder]);

  const checkAuth = useCallback(async () => {
    if (!storage.hasSettings()) {
      setAuthState('languageSelection');
      return;
    }

    try {
      const credentials = storage.getCredentials();
      if (credentials) {
        // Try to authenticate with saved credentials
        await api.authenticate(credentials.url, credentials.username, credentials.password);
        // "Ligar e assistir": abre direto na TV ao vivo tocando o último canal
        if (bootLastChannel.get() && storage.getLastChannel()) {
          sessionStorage.setItem('neostream_autoplay_last', '1');
          setCurrentPage('live');
        }
        setAuthState('authenticated');
      } else {
        // No credentials saved - show welcome screen
        setAuthState('welcome');
      }
    } catch (err) {
      console.error('Auto-login failed:', err);
      // Credencial INVÁLIDA → limpa e volta ao Welcome. Falha de REDE (Wi-Fi
      // da TV ainda subindo no boot é comum) → mantém a credencial e oferece
      // retry — apagar aqui obrigava a redigitar tudo no D-pad.
      const message = err instanceof Error ? err.message : '';
      if (message.includes('incorretos')) {
        storage.clearCredentials();
        setAuthState('welcome');
      } else {
        setAuthState('offline');
      }
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(checkAuth);
  }, [checkAuth]);

  const handleGoToLogin = () => {
    setAuthState('login');
  };

  const handleLoginSuccess = () => {
    setAddingPlaylist(false);
    setAuthState('authenticated');
  };

  const handleLogout = () => {
    api.logout();
    storage.clearCredentials();
    setAuthState('welcome');
  };

  const handlePageChange = (page: string) => {
    if (page === 'search') {
      setShowGlobalSearch(true);
      setFocusZone('overlay');
      return;
    }
    setCurrentPage(page as Page);
    setFocusZone('content'); // Reset focus to content when changing pages
  };

  // Loading screen
  if (authState === 'loading') {
    return (
      <div className="app-loading">
        <div className="app-loading-logo">
          <svg viewBox="0 0 24 24" fill="none" width="64" height="64">
            <path d="M4 5C4 4.44772 4.44772 4 5 4H19C19.5523 4 20 4.44772 20 5V15C20 15.5523 19.5523 16 19 16H5C4.44772 16 4 15.5523 4 15V5Z" stroke="currentColor" strokeWidth="2" />
            <path d="M8 20H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 16V20" stroke="currentColor" strokeWidth="2" />
          </svg>
        </div>
        <div className="app-loading-spinner" />
        <p className="app-loading-text">NeoStream</p>
      </div>
    );
  }

  // Sem rede no boot: credencial preservada, retry por OK
  if (authState === 'offline') {
    return (
      <OfflineRetry
        onRetry={() => {
          setAuthState('loading');
          void checkAuth();
        }}
        onOtherLogin={() => setAuthState('welcome')}
      />
    );
  }

  // Language selection screen (first time user)
  if (authState === 'languageSelection') {
    return <LanguageSelection onComplete={checkAuth} />;
  }

  // Welcome screen (no playlist configured)
  if (authState === 'welcome') {
    return <Welcome onGoToLogin={handleGoToLogin} />;
  }

  // Login screen
  if (authState === 'login') {
    return <Login onLoginSuccess={handleLoginSuccess} startBlank={addingPlaylist} onLanguageSelect={() => setAuthState('languageSelection')} />;
  }

  // Main app with sidebar
  return (
    <FocusContext.Provider value={{ focusZone, setFocusZone }}>
      <div className="app">
        <Sidebar
          activeItem={currentPage}
          onItemSelect={handlePageChange}
          onLogout={handleLogout}
          onProfileClick={() => setShowProfileManager(true)}
          focused={focusZone === 'sidebar'}
        />
        <main className="app-content" key={profileTick}>
          {currentPage === 'home' && <Home onNavigate={handlePageChange} />}
          {currentPage === 'live' && <LiveTV />}
          {currentPage === 'movies' && <Movies />}
          {currentPage === 'series' && <Series />}
          {currentPage === 'mylist' && <MyList onNavigate={handlePageChange} />}
          {currentPage === 'favorites' && <Favorites onNavigate={handlePageChange} />}
          {currentPage === 'settings' && <Settings onAddPlaylist={() => { setAddingPlaylist(true); setAuthState('login'); }} />}
        </main>

        {/* Profile Manager Modal */}
        {/* Aviso de lembrete — acima de tudo, com D-pad próprio */}
        {activeReminder && (
          <ReminderToast
            reminder={activeReminder}
            onWatch={() => {
              // A LiveTV consome a flag e já abre tocando o canal
              sessionStorage.setItem('neostream_autoplay_last', '1');
              storage.setLastChannel(activeReminder.streamId);
              setActiveReminder(null);
              setCurrentPage('live');
              setFocusZone('content');
            }}
            onDismiss={() => setActiveReminder(null)}
          />
        )}

        {showGlobalSearch && (
          <GlobalSearch
            onClose={() => {
              setShowGlobalSearch(false);
              setFocusZone('content');
            }}
          />
        )}

        {showProfileManager && (
          <ProfileManager
            onClose={() => setShowProfileManager(false)}
            onProfileSwitched={() => setProfileTick(t => t + 1)}
          />
        )}
      </div>
    </FocusContext.Provider>
  );
}

export default App;
