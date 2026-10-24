import { pt } from './pt';
import { en } from './en';
import { es } from './es';
import { de } from './de';

export const translations = {
    pt,
    en,
    es,
    de,
};

export type Language = keyof typeof translations;
export type TranslationKey = keyof typeof pt;
export type TranslationVars = Record<string, string | number>;

// Idioma corrente lido direto do storage — sem importar services/storage,
// assim qualquer módulo (inclusive os que o storage importa) pode traduzir
// sem criar ciclo de dependência.
export function getLanguage(): Language {
    try {
        const raw = localStorage.getItem('neostream_settings');
        const lang = raw ? JSON.parse(raw).language : 'pt';
        return lang in translations ? lang : 'pt';
    } catch {
        return 'pt';
    }
}

function fill(template: string, vars?: TranslationVars): string {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (m, name) =>
        name in vars ? String(vars[name]) : m
    );
}

const LOCALES: Record<Language, string> = {
    pt: 'pt-BR',
    en: 'en-GB',
    es: 'es-ES',
    de: 'de-DE',
};

// Locale BCP-47 da língua escolhida, pra toLocaleDateString/toLocaleTimeString.
export function getLocale(): string {
    return LOCALES[getLanguage()];
}

// Versão síncrona do useTranslation().t para código fora de componentes
// (services, hooks utilitários, constantes montadas fora do render).
// Componentes React devem preferir o hook, que re-renderiza na troca de idioma.
export function tt(key: TranslationKey, vars?: TranslationVars): string {
    const lang = getLanguage();
    const template = translations[lang][key] ?? translations.pt[key] ?? key;
    return fill(template, vars);
}
