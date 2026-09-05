import { useCallback, useMemo, useState } from 'react';
import { storage } from '../services/storage';
import { useTranslation } from '../hooks/useTranslation';
import { useTVNavigation } from '../hooks/useTVNavigation';
import './LanguageSelection.css';

interface LanguageSelectionProps {
    onComplete: () => void;
    /** Voltar aqui é a primeira tela do app: pede saída (dois toques). */
    onRequestExit?: () => void;
}

export function LanguageSelection({ onComplete, onRequestExit }: LanguageSelectionProps) {
    const { t } = useTranslation();
    const [focusedIndex, setFocusedIndex] = useState(0);

    const languages = useMemo(() => [
        { code: 'pt' as const, label: t('language_pt'), icon: 'BR' },
        { code: 'en' as const, label: t('language_en'), icon: 'US' },
        { code: 'es' as const, label: t('language_es'), icon: 'ES' },
    ], [t]);

    const handleSelect = useCallback((code: 'pt' | 'en' | 'es') => {
        // Save to storage
        storage.saveSettings({ language: code });
        // Fire event so hooks update immediately
        window.dispatchEvent(new Event('neostream-lang-change'));
        // Proceed to next step in App.tsx
        onComplete();
    }, [onComplete]);

    // Este é o PRIMEIRO contato do usuário com o app, e era a única tela que
    // ouvia o teclado à mão: o switch só conhecia 'ArrowRight'/'Enter' e afins,
    // que são nomes de tecla de NAVEGADOR. O controle da Samsung manda keycodes
    // (setas 37-40, OK 13/29443/Select, Voltar 10009/461) — nenhum casava, e a
    // tela ficava inerte no controle. O hook já tem a tabela inteira.
    useTVNavigation({
        onNavigate: direction => {
            if (direction === 'right' || direction === 'down') {
                setFocusedIndex(prev => (prev + 1) % languages.length);
            } else if (direction === 'left' || direction === 'up') {
                setFocusedIndex(prev => (prev - 1 + languages.length) % languages.length);
            }
        },
        onEnter: () => handleSelect(languages[focusedIndex].code),
        onBack: onRequestExit,
    });

    return (
        <div className="language-selection-container">
            <div className="language-selection-glass">
                {/* Animated Background Elements */}
                <div className="language-orb orb-1"></div>
                <div className="language-orb orb-2"></div>

                <div className="language-selection-content">
                    <div className="language-selection-header">
                        <svg viewBox="0 0 24 24" fill="none" width="64" height="64" className="language-logo">
                            <path d="M4 5C4 4.44772 4.44772 4 5 4H19C19.5523 4 20 4.44772 20 5V15C20 15.5523 19.5523 16 19 16H5C4.44772 16 4 15.5523 4 15V5Z" stroke="currentColor" strokeWidth="2" />
                            <path d="M8 20H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            <path d="M12 16V20" stroke="currentColor" strokeWidth="2" />
                        </svg>
                        <h1 className="language-title">NeoStream</h1>
                        <p className="language-subtitle">{t('language_selection_title')}</p>
                    </div>

                    <div className="language-options">
                        {languages.map((lang, index) => (
                            <button
                                key={lang.code}
                                className={`language-btn ${focusedIndex === index ? 'focused' : ''}`}
                                onClick={() => handleSelect(lang.code as 'pt' | 'en' | 'es')}
                                onMouseEnter={() => setFocusedIndex(index)}
                            >
                                <span className="language-icon">{lang.icon}</span>
                                <span className="language-label">{lang.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
