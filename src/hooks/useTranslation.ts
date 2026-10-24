import { useState, useEffect, useCallback } from 'react';
import { translations, type Language, type TranslationKey, type TranslationVars } from '../i18n';
import { storage } from '../services/storage';

export function useTranslation() {
    const [currentLang, setCurrentLang] = useState<Language>('pt');

    useEffect(() => {
        // When the hook mounts, load from storage
        const fetchLanguage = () => {
            const settings = storage.getSettings();
            // Qualquer idioma registrado em translations vale; fallback pt
            const safeLang = (settings.language in translations ? settings.language : 'pt') as Language;
            setCurrentLang(safeLang);
        };

        fetchLanguage();

        // Setup an interval or listener if needed to react to storage changes,
        // but typically a page reload happens or we pass the lang change event down.
        const handleStorageChange = () => {
            fetchLanguage();
        };

        window.addEventListener('storage', handleStorageChange);
        // Custom event for internal app changes
        window.addEventListener('neostream-lang-change', handleStorageChange);

        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('neostream-lang-change', handleStorageChange);
        };
    }, []);

    const t = useCallback((key: TranslationKey, vars?: TranslationVars): string => {
        // Fallback to Portuguese key if missing in the selected language somehow
        const template = translations[currentLang][key] || translations['pt'][key] || key;
        if (!vars) return template;
        return template.replace(/\{(\w+)\}/g, (m, name) =>
            name in vars ? String(vars[name]) : m
        );
    }, [currentLang]);

    return { t, currentLang };
}
