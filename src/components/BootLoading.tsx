// Tela de boot enquanto o app confere a credencial salva com o provedor.
//
// Era logo + spinner + a palavra "NeoStream", sem um único ouvinte de tecla:
// num Wi-Fi de TV ruim ficava até ~15 s sem dizer o que fazia e sem aceitar
// Voltar — o usuário concluía que travou e desligava a TV no botão.

import { useEffect, useState } from 'react';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useTranslation } from '../hooks/useTranslation';

/** Depois disto o boot avisa que está demorando mais que o normal. */
const BOOT_DEMORANDO_MS = 8000;

export function BootLoading({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const [demorando, setDemorando] = useState(false);

  // Voltar desiste da tentativa e cai na tela de "sem conexão", que já tem
  // "tentar de novo" e "usar outro login"
  useTVNavigation({ onBack: onCancel });

  // O cronômetro morre com a tela: se o login termina antes, nada dispara
  useEffect(() => {
    const timer = setTimeout(() => setDemorando(true), BOOT_DEMORANDO_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="app-loading" role="status" aria-live="polite">
      <div className="app-loading-logo">
        <svg viewBox="0 0 24 24" fill="none" width="64" height="64">
          <path d="M4 5C4 4.44772 4.44772 4 5 4H19C19.5523 4 20 4.44772 20 5V15C20 15.5523 19.5523 16 19 16H5C4.44772 16 4 15.5523 4 15V5Z" stroke="currentColor" strokeWidth="2" />
          <path d="M8 20H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 16V20" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
      <div className="app-loading-spinner" />
      <p className="app-loading-text">{t('boot_connecting')}</p>
      {demorando && <p className="app-offline-hint">{t('boot_slow')}</p>}
      <p className="app-offline-hint">{t('boot_back_hint')}</p>
    </div>
  );
}
