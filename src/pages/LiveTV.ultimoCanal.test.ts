import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 📺 Entrar na TV ao vivo não pode abrir uma ficha que ninguém pediu.
 *
 * O autoplay do último canal é consumido uma vez por sessão (a marca sai do
 * sessionStorage assim que é lida), mas a pré-seleção não era: **toda** visita
 * à página abria a ficha do último canal assistido. Ela é in-flow — empurra a
 * grade inteira para baixo —, o foco fica na grade e o primeiro card pode
 * nascer fora da dobra: um painel grande aparece sozinho e o anel de foco está
 * noutro lugar.
 *
 * Pior: Voltar com ficha aberta significa "fechar a ficha". Então o primeiro
 * Voltar de quem acabou de entrar era comido por ela, em vez de devolver o
 * foco à barra lateral.
 *
 * O guarda é estrutural porque a página monta `hls.js` e fala com o
 * `window.ipcRenderer`: montá-la em jsdom seria um teste maior que o conserto.
 */
const FONTE = readFileSync(join(process.cwd(), 'src', 'pages', 'LiveTV.tsx'), 'utf-8')
    .split('\r\n').join('\n');

/** Corpo do `restoreLastChannel`, do nome dele até o fim da função. */
function corpoDoRestore(): string {
    const inicio = FONTE.indexOf('const restoreLastChannel');
    expect(inicio, 'não achei o restoreLastChannel em LiveTV.tsx').toBeGreaterThan(-1);
    const fim = FONTE.indexOf('\n            };', inicio);
    expect(fim, 'não achei o fim do restoreLastChannel').toBeGreaterThan(inicio);
    return FONTE.slice(inicio, fim);
}

describe('último canal: foco sim, ficha não', () => {
    it('restaurar o último canal não abre a ficha', () => {
        expect(corpoDoRestore()).not.toContain('setSelectedChannel(');
    });

    it('o autoplay continua existindo (o conserto não é apagar a restauração)', () => {
        const corpo = corpoDoRestore();
        expect(corpo).toContain('wantsAutoplay');
        expect(corpo).toContain('setPlayingChannel(');
    });

    it('o foco é posicionado sobre a lista RENDERIZADA, não sobre a do fetch', () => {
        // `filteredStreams` já passou pelos filtros e pelo agrupamento de
        // variantes: o índice na lista crua do fetch apontaria para outro
        // canal — o foco cairia num vizinho qualquer.
        const inicio = FONTE.indexOf('const alvo = canalPraFocar.current');
        expect(inicio, 'não achei o efeito que posiciona o foco').toBeGreaterThan(-1);
        const efeito = FONTE.slice(inicio, inicio + 700);
        expect(efeito).toContain('filteredStreams.findIndex');
        expect(efeito).toContain('setFocusedChannelIndex');
        // E uma vez só: depois disso o foco é de quem está com o controle.
        expect(efeito).toContain('canalPraFocar.current = null');
    });
});
