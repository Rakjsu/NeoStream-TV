// A chave do trailer no YouTube (item 18).
//
// Fica fora do componente por um motivo prático: o campo `youtube_trailer` do
// Xtream chega em três formatos diferentes na vida real, e o sintoma de tratar
// só um deles é o botão de trailer sumir para parte dos provedores — sem erro,
// sem log, sem nada que explique.

/**
 * Extrai a chave de 11 caracteres a partir do que o provedor mandou.
 * Aceita a chave crua, a URL completa e o formato curto. Devolve '' quando o
 * campo está vazio ou não é reconhecível (aí o botão simplesmente não aparece).
 */
export function extrairChaveYoutube(bruto: string): string {
    const texto = (bruto || '').trim();
    if (!texto) return '';
    // Chave crua: 11 caracteres do alfabeto do YouTube
    if (/^[\w-]{11}$/.test(texto)) return texto;
    const porQuery = /[?&]v=([\w-]{11})/.exec(texto);
    if (porQuery) return porQuery[1];
    const porCaminho = /(?:youtu\.be\/|\/embed\/|\/v\/|\/shorts\/)([\w-]{11})/.exec(texto);
    if (porCaminho) return porCaminho[1];
    return '';
}
