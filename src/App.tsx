// Main App Component - NeoStream TV

import { useState, useEffect, useCallback, useRef } from 'react';
import { api, foiRebaixadoParaHttp } from './services/api';
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
import { SetupWizard } from './components/SetupWizard';
import { setupWizard } from './services/wizardState';
import { playlistService } from './services/playlistService';
import { profileService } from './services/profileService';
import { migrateScopeOnce, migrateHiddenScope } from './services/profileScope';
import { storageSchema } from './services/storageSchema';
import { accountService } from './services/accountService';
import { bootLastChannel } from './services/liveExtras';
import { reminderService, type Reminder } from './services/reminderService';
import { FocusContext, type FocusZone } from './contexts/FocusContext';
import { useTVNavigation } from './hooks/useTVNavigation';
import { useExitPrompt } from './hooks/useExitPrompt';
import { themeService } from './services/themeService';
import { a11yService } from './services/a11yService';
import { configSnapshot } from './services/configSnapshot';
import { installErrorCapture } from './services/diagnostics';
import { applyFlexGapFallback } from './services/flexGap';
import { burnIn } from './services/burnIn';
import './index.css';
import './flex-gap-fallback.css';
import './aspect-ratio-fallback.css';
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

/**
 * Aviso de lembrete (item 3): OK assiste, Voltar dispensa.
 *
 * Enquanto ele está na tela o App muda a zona de foco pra 'overlay', então as
 * páginas e a sidebar se desligam sozinhas. Sem isso o mesmo OK pausava o
 * vídeo por baixo e ainda trocava o "último canal" do usuário.
 */
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

/**
 * Aviso de "aperte Voltar de novo pra sair".
 *
 * Era JSX solto dentro do return do app principal — que as telas de idioma,
 * boas-vindas e login nunca alcançam, porque elas saem por `return` antes.
 * Resultado: nessas telas a saída podia ser armada sem nenhum aviso na tela.
 * Como componente, o mesmo aviso serve os dois caminhos.
 */
function ExitToast({ visivel }: { visivel: boolean }) {
  if (!visivel) return null;
  return (
    <div className="app-exit-toast" role="status">
      Pressione Voltar de novo para sair do NeoStream
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
  // Assistente de primeira configuração (item 60): só depois do primeiro login
  const [showWizard, setShowWizard] = useState(false);
  // Remontar a LiveTV à força: é assim que o "Assistir agora" de um lembrete
  // funciona quando o usuário JÁ está na TV ao Vivo (trocar de página seria
  // um no-op e a flag de autoplay ficaria armada pra uma visita futura)
  const [liveTick, setLiveTick] = useState(0);
  // Voltar tem uma cadeia só no app inteiro: conteúdo → sidebar → Home →
  // aviso de saída → sair. A ponta dessa cadeia mora aqui porque o aviso
  // aparece em cima de qualquer página.
  const { armado: exitArmado, pedirSaida, desarmar: desarmarSaida } = useExitPrompt();


  // Enquanto o aviso está na tela ele é o dono das teclas. A zona muda JUNTO
  // com quem mostra e esconde o aviso — dentro de um effect a regra
  // react-hooks/set-state-in-effect proíbe, e o cleanup ainda por cima
  // rodaria DEPOIS do "Assistir agora", desfazendo a zona que ele escolheu.
  const zoneBeforeReminder = useRef<FocusZone>('content');
  // Espelho da zona atual: o ref é escrito em effect, nunca no render
  const focusZoneRef = useRef<FocusZone>('content');
  useEffect(() => {
    focusZoneRef.current = focusZone;
  }, [focusZone]);

  const showReminderToast = useCallback((reminder: Reminder) => {
    zoneBeforeReminder.current = focusZoneRef.current;
    setActiveReminder(reminder);
    setFocusZone('overlay');
  }, []);

  const hideReminderToast = useCallback(() => {
    setActiveReminder(null);
    // Só devolve a zona se ela ainda for a NOSSA: quem dispensou o aviso
    // abrindo outra coisa já escolheu a zona dele
    setFocusZone(zone => (zone === 'overlay' ? zoneBeforeReminder.current : zone));
  }, []);

  useEffect(() => {
    registerTizenKeys();
    // PRIMEIRO de tudo: a versão do esquema é decidida olhando se já existe
    // dado no aparelho. Rodar depois de profileService.initialize() (que grava
    // os perfis padrão) fazia TODA instalação nova parecer antiga.
    storageSchema.migrate();
    // Antes só o ProfileManager inicializava: até o usuário abrir o
    // gerenciador não havia perfil ativo e o gate Kids ficava inerte
    profileService.initialize();
    // Logo depois do initialize e ANTES de qualquer leitura de dado escopado
    // (checkAuth já lê o último canal)
    migrateScopeOnce();
    // Segunda leva: a ocultação de canais virou dado de perfil depois
    migrateHiddenScope();
    playlistService.migrate();
    themeService.apply();
    a11yService.apply();
    // Tizen 5.5/6.0 não têm `gap` em flexbox: sem isto, os itens de 102
    // containers ficam colados na TV (e só na TV)
    applyFlexGapFallback();
    // Sem console aberto numa TV, o anel de erros é a única testemunha
    installErrorCapture();
    // Menu parado por horas marca painel OLED (item 78)
    burnIn.install();
    // Retrato semanal das preferências (item 62)
    configSnapshot.maybeTake();
    // subscribe ANTES de init: o init dispara na hora os lembretes cuja
    // janela de aviso já passou, e com a ordem invertida esse disparo ia pra
    // uma lista de ouvintes VAZIA — quem ligasse a TV 20s depois da hora
    // simplesmente nunca via o aviso, e ele não era reagendado.
    const cancelar = reminderService.subscribe(reminder => showReminderToast(reminder));
    reminderService.init();
    return cancelar;
  }, [showReminderToast]);

  // O aviso some sozinho depois de 45s
  useEffect(() => {
    if (!activeReminder) return;
    const timeout = setTimeout(() => hideReminderToast(), 45000);
    return () => clearTimeout(timeout);
  }, [activeReminder, hideReminderToast]);

  // O wizard cobre a tela inteira: sem mudar a zona de foco, a página por
  // baixo (que só testa `=== 'content'`) continuaria recebendo as MESMAS
  // teclas e cada OK dispararia duas ações
  const openWizard = useCallback(() => {
    setShowWizard(true);
    setFocusZone('overlay');
  }, []);

  const closeWizard = useCallback(() => {
    setShowWizard(false);
    setFocusZone('content');
  }, []);

  // O gerenciador de perfis é aberto DE DENTRO da sidebar, e a sidebar mantém
  // o handler global de teclas vivo enquanto tiver o foco. Sem trocar a zona,
  // um ↓ movia os dois ao mesmo tempo e o OK seguinte trocava o perfil E
  // executava o "Sair" da sidebar — apagando as credenciais do aparelho.
  const openProfileManager = useCallback(() => {
    setShowProfileManager(true);
    setFocusZone('overlay');
  }, []);

  const closeProfileManager = useCallback(() => {
    setShowProfileManager(false);
    // Volta pra sidebar (não pro conteúdo): é de lá que o modal foi aberto
    setFocusZone('sidebar');
  }, []);

  const checkAuth = useCallback(async () => {
    if (!storage.hasSettings()) {
      setAuthState('languageSelection');
      return;
    }

    try {
      const credentials = storage.getCredentials();
      if (credentials) {
        // Try to authenticate with saved credentials
        // O payload traz validade, conexões e status da conta — era descartado
        const auth = await api.authenticate(credentials.url, credentials.username, credentials.password);
        accountService.save(auth, foiRebaixadoParaHttp(credentials.url, api.getBaseUrl()));
        // "Ligar e assistir": abre direto na TV ao vivo tocando o último canal
        if (bootLastChannel.get() && storage.getLastChannel()) {
          sessionStorage.setItem('neostream_autoplay_last', '1');
          setCurrentPage('live');
        }
        setAuthState('authenticated');
        if (!setupWizard.isDone()) openWizard();
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
  }, [openWizard]);

  useEffect(() => {
    void Promise.resolve().then(checkAuth);
  }, [checkAuth]);

  const handleGoToLogin = () => {
    setAuthState('login');
  };

  const handleLoginSuccess = () => {
    setAddingPlaylist(false);
    setAuthState('authenticated');
    // Primeira vez: fecha o fluxo de configuração (tema, tamanho, TMDB).
    // Ao ADICIONAR uma playlist extra o assistente não volta.
    if (!setupWizard.isDone() && !addingPlaylist) openWizard();
  };

  const handleLogout = () => {
    api.logout();
    storage.clearCredentials();
    // A credencial também vive na playlist, em texto claro: sair sem limpar
    // isso deixava a conta do dono anterior pronta pra ser reativada
    playlistService.clearAll();
    accountService.clear();
    setAuthState('welcome');
  };

  const handlePageChange = (page: string) => {
    if (page === 'search') {
      setShowGlobalSearch(true);
      setFocusZone('overlay');
      return;
    }
    desarmarSaida(); // navegar é sinal de que ele NÃO quer sair
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
    return (
      <>
        <LanguageSelection onComplete={checkAuth} onRequestExit={pedirSaida} />
        <ExitToast visivel={exitArmado} />
      </>
    );
  }

  // Welcome screen (no playlist configured)
  if (authState === 'welcome') {
    return (
      <>
        <Welcome onGoToLogin={handleGoToLogin} onRequestExit={pedirSaida} />
        <ExitToast visivel={exitArmado} />
      </>
    );
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
          onProfileClick={openProfileManager}
          onBack={() => {
            // Na sidebar, Voltar sobe um degrau: qualquer página → Home;
            // já na Home, é o pedido de saída.
            if (currentPage !== 'home') handlePageChange('home');
            else pedirSaida();
          }}
          focused={focusZone === 'sidebar'}
        />
        <main className="app-content" key={profileTick}>
          {currentPage === 'home' && <Home onNavigate={handlePageChange} onRequestExit={pedirSaida} onCancelExit={desarmarSaida} />}
          {currentPage === 'live' && <LiveTV key={liveTick} />}
          {currentPage === 'movies' && <Movies />}
          {currentPage === 'series' && <Series />}
          {currentPage === 'mylist' && <MyList onNavigate={handlePageChange} />}
          {currentPage === 'favorites' && <Favorites onNavigate={handlePageChange} />}
          {currentPage === 'settings' && <Settings onAddPlaylist={() => { setAddingPlaylist(true); setAuthState('login'); }} />}
        </main>

        {/* Aviso de saída: a Home era a dona dele, mas a cadeia de Voltar
            termina aqui e o aviso precisa aparecer com a sidebar focada. */}
        <ExitToast visivel={exitArmado} />

        {/* Profile Manager Modal */}
        {/* Aviso de lembrete — acima de tudo, com D-pad próprio */}
        {activeReminder && (
          <ReminderToast
            reminder={activeReminder}
            onWatch={() => {
              // A LiveTV consome a flag no mount e já abre tocando o canal
              sessionStorage.setItem('neostream_autoplay_last', '1');
              storage.setLastChannel(activeReminder.streamId);
              setActiveReminder(null);
              // Já estando na LiveTV, trocar de página não remontaria nada:
              // a key força o mount e o caminho de consumo da flag roda
              if (currentPage === 'live') setLiveTick(tick => tick + 1);
              else setCurrentPage('live');
              // Um overlay aberto por cima (perfis, busca, assistente) deixaria
              // o player rodando embaixo dele
              setShowProfileManager(false);
              setShowGlobalSearch(false);
              setFocusZone('content');
            }}
            onDismiss={hideReminderToast}
          />
        )}

        {showWizard && <SetupWizard onFinish={closeWizard} />}

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
            onClose={closeProfileManager}
            onProfileSwitched={() => {
              // Timers e toast de lembrete são estado EM MEMÓRIA amarrado à
              // chave do perfil anterior: sem re-armar, o aviso de um perfil
              // aparece dentro do outro
              reminderService.reset();
              hideReminderToast();
              setProfileTick(t => t + 1);
            }}
          />
        )}
      </div>
    </FocusContext.Provider>
  );
}

export default App;
