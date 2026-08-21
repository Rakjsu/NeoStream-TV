import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './theme.css'
import App from './App.tsx'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { preconnectProvider } from './services/preconnect'

// Antes do render: a conexão com o provedor sobe em paralelo com o resto
preconnectProvider()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
