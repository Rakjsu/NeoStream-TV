import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Guarda da regra que pausa as animações durante a reprodução.
 *
 * É uma regra de CSS, então nada em `tsc`, `eslint` ou `vitest` a enxerga —
 * e as duas metades dela se anulam se alguém mexer numa e não na outra:
 * sem a pausa, 60 animações infinitas seguem compondo atrás do vídeo; sem a
 * exceção, o spinner do próprio player congela no meio do giro.
 */

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)));
const theme = readFileSync(path.join(RAIZ, 'theme.css'), 'utf-8');

/** Todo `.css` de src/, recursivo. */
function folhasDeEstilo(dir: string): string[] {
    return readdirSync(dir).flatMap(nome => {
        const completo = path.join(dir, nome);
        if (statSync(completo).isDirectory()) return folhasDeEstilo(completo);
        return nome.endsWith('.css') ? [completo] : [];
    });
}

describe('animações param enquanto o vídeo toca', () => {
    it('a pausa vale para TUDO — seletor universal, não uma lista de classes', () => {
        expect(theme).toContain('html[data-playing] *,');
        expect(theme).toContain('html[data-playing] *::before,');
        expect(theme).toContain('html[data-playing] *::after');
        expect(theme).toMatch(/html\[data-playing\] \*[\s\S]{0,120}animation-play-state: paused !important/);
    });

    // Sem esta exceção o player para de animar junto com o resto — e o
    // spinner congelado no meio do giro é pior que animação nenhuma.
    it('o player é exceção, e por especificidade (não por ordem)', () => {
        expect(theme).toMatch(
            /html\[data-playing\] \.video-player-container \*[\s\S]{0,200}animation-play-state: running !important/
        );
    });

    // `paused` guarda o ponto da animação; duração zero (o que o modo
    // "reduzir animações" faz) a teleporta para o fim e ela pula ao voltar.
    it('usa paused, não duração zero — a animação volta de onde parou', () => {
        const bloco = theme.slice(theme.indexOf('html[data-playing] *,'));
        const ateAProximaSecao = bloco.slice(0, bloco.indexOf('Anti burn-in'));
        expect(ateAProximaSecao).not.toContain('animation-duration');
    });

    it('ainda existe animação infinita a pausar — senão a regra virou peso morto', () => {
        const infinitas = folhasDeEstilo(RAIZ)
            .reduce((total, folha) => total + (readFileSync(folha, 'utf-8').match(/\binfinite\b/g)?.length ?? 0), 0);
        expect(infinitas).toBeGreaterThan(10);
    });
});
