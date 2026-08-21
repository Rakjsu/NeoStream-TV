// As três decisões do player que não dependem de DOM, de HLS.js nem de tempo.
//
// Elas viviam dentro de handlers de evento (`hls.on(ERROR)`, o `useCallback` do
// backoff, o `MANIFEST_PARSED`), onde nenhuma delas podia ser exercitada sem
// uma TV, um provedor e uma queda de rede na hora certa. Cada uma já causou um
// bug de verdade — e cada uma agora tem teste.

export type StreamErrorCause = 'notfound' | 'network' | 'media' | 'fatal';

/** Quantas reconexões antes de desistir e passar pro failover de variante. */
export const MAX_RECONNECT_ATTEMPTS = 4;

/**
 * Que tipo de falha é esta?
 *
 * 404/403 é o provedor dizendo "este canal não existe NESTA url": insistir só
 * gasta os ~30s do backoff antes de tentar a variante seguinte, que é a que
 * pode de fato funcionar.
 */
export function classifyStreamError(
    tipo: 'network' | 'media' | 'other',
    status?: number
): StreamErrorCause {
    if (tipo === 'network') return status === 404 || status === 403 ? 'notfound' : 'network';
    if (tipo === 'media') return 'media';
    return 'fatal';
}

/** A causa dispensa tentar de novo? */
export function isTerminalCause(cause: StreamErrorCause | 'stall'): boolean {
    return cause === 'notfound';
}

/**
 * Espera antes da próxima tentativa: 2s, 4s, 8s, 16s (e trava em 16s).
 * O teto importa — sem ele a quinta tentativa esperaria 32s numa tela que só
 * diz "Reconectando…".
 */
export function reconnectDelayMs(attempt: number): number {
    const n = Math.max(1, Math.floor(attempt));
    return Math.min(16000, 2000 * Math.pow(2, n - 1));
}

export interface NivelDeQualidade {
    index: number;
    /** 0 = o manifesto NÃO declarou RESOLUTION (comum em Xtream) */
    height: number;
}

/**
 * Qual nível travar quando o usuário definiu um teto de qualidade.
 * Devolve `null` para "não trave nada".
 *
 * BUG REAL (R5): a versão antiga filtrava `height <= cap` sobre TODOS os
 * níveis. Como `height === 0` significa "o manifesto não declarou", e não "é
 * minúsculo", qualquer canal sem RESOLUTION declarada era travado na PIOR
 * variante do provedor — e o usuário via 240p num teto de 1080p.
 */
export function chooseCappedLevel(
    levels: readonly NivelDeQualidade[],
    cap: number
): number | null {
    if (cap <= 0) return null;
    const declarados = levels.filter(nivel => nivel.height > 0);
    // Sem NENHUMA altura declarada não há o que comparar: aplicar teto aqui
    // seria escolher às cegas
    if (declarados.length === 0) return null;

    const cabem = declarados.filter(nivel => nivel.height <= cap);
    const escolhido = cabem.length > 0
        // o melhor que cabe
        ? cabem.reduce((melhor, nivel) => (nivel.height > melhor.height ? nivel : melhor))
        // nada cabe: a MENOR das declaradas é o mais perto do que se pediu
        : declarados.reduce((melhor, nivel) => (nivel.height < melhor.height ? nivel : melhor));
    return escolhido.index;
}
