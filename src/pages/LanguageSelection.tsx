import { useCallback, useEffect, useMemo, useState } from 'react';
import { storage } from '../services/storage';
import { useTranslation } from '../hooks/useTranslation';
import './LanguageSelection.css';

interface LanguageSelectionProps {
    onComplete: () => void;
}

export function LanguageSelection({ onComplete }: LanguageSelectionProps) {
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

    // We can't use useTVNavigation here directly if it relies on a specific generic zone, 
    // but we can implement a simple keydown listener for this specific screen.
    // This is the very first screen, so it needs to be self-contained in focus.
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'ArrowRight':
                case 'ArrowDown':
                    setFocusedIndex((prev) => (prev + 1) % languages.length);
                    break;
                case 'ArrowLeft':
                case 'ArrowUp':
                    setFocusedIndex((prev) => (prev - 1 + languages.length) % languages.length);
                    break;
                case 'Enter':
                    handleSelect(languages[focusedIndex].code);
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [focusedIndex, languages, handleSelect]);

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
