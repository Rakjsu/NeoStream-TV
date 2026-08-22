// O que o build do Tizen POLIFILA — declarado num lugar só.
//
// Duas coisas leem esta lista, e é isso que a torna confiável:
//
//  1. `eslint.config.js` a entrega ao eslint-plugin-compat como `settings.polyfills`.
//     Sem ela o lint acusa `Object.fromEntries` (Chrome 73) como incompatível com o
//     Chromium 69 da TV — e estaria certo, se o build não o polifilasse.
//
//  2. `scripts/build-tizen.mjs` CONFERE, no bundle recém-gerado, que cada nome daqui
//     realmente aparece no polyfills.js. Sem essa conferência a lista viraria uma
//     promessa: bastaria alguém mexer no `modernPolyfills` do vite.tizen.config.ts pra
//     ela passar a silenciar um erro de verdade, em silêncio.
//
// REGRA PARA ACRESCENTAR UM NOME AQUI: rode `npm run build:tizen` e confirme que ele
// aparece em `tizen/assets/polyfills.js`. Se não aparecer, o problema é real — conserte
// o código, não a lista.
//
// E o que NÃO entra aqui: API de DOM/BOM. O core-js polifila built-in de LINGUAGEM;
// `structuredClone`, `Element.replaceChildren`, `navigator.clipboard` e afins não têm
// polyfill nenhum e simplesmente não existem na TV. É justamente para pegá-los que o
// eslint-plugin-compat vale a pena.

/** Built-ins de linguagem que o `modernPolyfills` do plugin-legacy entrega. */
export const POLYFILLS_DO_BUILD = [
    'Object.fromEntries',
];

/**
 * Como cada nome aparece dentro do bundle minificado. O core-js define o método
 * pelo nome literal (`{fromEntries: function...}`), então basta a última parte —
 * mas guardamos o par explícito pra conferência não virar adivinhação.
 */
export const MARCA_NO_BUNDLE = {
    'Object.fromEntries': 'fromEntries',
};
