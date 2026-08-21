// Estado do assistente de primeira configuração (item 60).
//
// Chave PRÓPRIA de propósito: gravar essa flag dentro de `neostream_settings`
// faria `storage.hasSettings()` virar true cedo demais e o app pularia a tela
// de seleção de idioma no boot seguinte.

const DONE_KEY = 'neostream_wizard_done';

export const setupWizard = {
    isDone(): boolean {
        return localStorage.getItem(DONE_KEY) === '1';
    },

    markDone(): void {
        try {
            localStorage.setItem(DONE_KEY, '1');
        } catch {
            // Sem gravar, o assistente reaparece no próximo boot — chato,
            // mas melhor do que travar o app numa TV com quota cheia
        }
    },

    reset(): void {
        try {
            localStorage.removeItem(DONE_KEY);
        } catch {
            // sem drama
        }
    },
};
