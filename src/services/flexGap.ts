// Detecção de suporte a `gap` em FLEXBOX (Chrome 84+).
//
// Não dá pra decidir isso por @supports: `@supports (gap: 1px)` responde
// "sim" no Chromium 69 por causa do gap de GRID, que existe desde o 66. E
// decidir por user-agent é chute. O jeito confiável é MEDIR: monta um flex
// de duas linhas com row-gap de 1px fora da tela e vê se o container ficou
// 1px mais alto.
//
// Tizen 5.5 = Chromium 69 e Tizen 6.0 = Chromium 76 (sem suporte);
// Tizen 6.5 = Chromium 85 e 7.0 = Chromium 94 (com suporte).

const FALLBACK_CLASS = 'no-flex-gap';

export function supportsFlexGap(): boolean {
    try {
        const probe = document.createElement('div');
        probe.style.display = 'flex';
        probe.style.flexDirection = 'column';
        probe.style.rowGap = '1px';
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        probe.appendChild(document.createElement('div'));
        probe.appendChild(document.createElement('div'));
        document.body.appendChild(probe);
        // Dois filhos de altura 0: só o gap pode dar altura ao container
        const supported = probe.scrollHeight === 1;
        probe.parentNode?.removeChild(probe);
        return supported;
    } catch {
        // Se nem medir dá, assume o pior: com o fallback ligado o layout fica
        // certo nos dois casos (a margem só sobra onde o gap já resolveria)
        return false;
    }
}

/** Marca o <html> quando a TV não tem gap em flexbox. Chamar no boot. */
export function applyFlexGapFallback(): void {
    if (supportsFlexGap()) return;
    document.documentElement.classList.add(FALLBACK_CLASS);
}
