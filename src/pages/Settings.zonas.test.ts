import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 🔘 Numa TV, OK é a tecla de "acionar isto".
 *
 * As Configurações são uma lista de linhas iguais percorrida com o D-pad: a
 * pessoa desce até a linha e aperta OK. Sete dessas linhas — "Próximo episódio
 * automático", "Retomar de onde parou", "Alto contraste", "Reduzir animações",
 * "Proteção de tela", e as duas travas parentais — não tinham ramo no
 * `onEnter`. Só respondiam a ←→, sem nada na tela dizendo isso, enquanto a
 * linha vizinha ("Abrir no último canal") inverte no OK. Quem aperta OK três
 * vezes em "Alto contraste" conclui que a opção está quebrada e desce.
 *
 * Este teste lê a fonte porque o defeito é de INVENTÁRIO: a `ZONES` cresceu
 * (27 zonas) e o `onEnter` não acompanhou (17 ramos). Renderizar a tela
 * provaria os ramos que existem; o que se perde é sempre o que ninguém
 * lembrou de escrever.
 */
const FONTE = readFileSync(join(process.cwd(), 'src', 'pages', 'Settings.tsx'), 'utf-8')
    // CRLF normalizado: o mesmo arquivo sai com CRLF numa máquina e LF na
    // outra, e comparar sem normalizar deixa o teste verde aqui e vermelho lá.
    .split('\r\n').join('\n');

/** Zonas em que OK não tem o que acionar — cada uma com a razão. */
const SEM_OK: Record<string, string> = {
    // "Conta" é só leitura (usuário, situação, validade, conexões). A zona
    // existe porque é ela que rola a seção pra tela pelo mapa de scroll, não
    // porque haja algo pra acionar.
    account: 'seção só de leitura; a zona existe para rolar até ela',
};

function zonasDeclaradas(): string[] {
    const inicio = FONTE.indexOf('const ZONES: FocusZone[] = [');
    const fim = FONTE.indexOf('];', inicio);
    expect(inicio, 'não achei a lista ZONES em Settings.tsx').toBeGreaterThan(-1);
    return [...FONTE.slice(inicio, fim).matchAll(/'([a-z]+)'/g)].map(achado => achado[1]);
}

function corpoDoOnEnter(): string {
    const inicio = FONTE.indexOf('onEnter: () => {');
    const fim = FONTE.indexOf('\n        onBack:', inicio);
    expect(inicio, 'não achei o onEnter em Settings.tsx').toBeGreaterThan(-1);
    expect(fim, 'não achei o onBack que fecha o onEnter').toBeGreaterThan(inicio);
    return FONTE.slice(inicio, fim);
}

describe('OK das Configurações', () => {
    const zonas = zonasDeclaradas();
    const corpo = corpoDoOnEnter();

    it('acha a lista de zonas e o corpo do onEnter (guarda contra leitura vazia)', () => {
        // Uma extração quebrada devolveria listas vazias e faria os testes
        // abaixo passarem sem olhar nada.
        expect(zonas.length).toBeGreaterThan(20);
        expect(corpo).toContain("focusZone === 'bg'");
        expect(corpo.length).toBeLessThan(FONTE.length / 2);
    });

    it('toda zona navegável tem ramo no OK', () => {
        const mudas = zonas.filter(zona => !(zona in SEM_OK) && !corpo.includes(`focusZone === '${zona}'`));
        expect(mudas, 'zonas onde OK não faz nada — dê um ramo ou registre em SEM_OK com a razão').toEqual([]);
    });

    it('a lista de exceções não apodrece', () => {
        for (const zona of Object.keys(SEM_OK)) {
            expect(zonas, `${zona} está em SEM_OK mas não é mais uma zona`).toContain(zona);
        }
    });

    it('as travas parentais continuam pedindo o PIN no OK', () => {
        // O ramo novo inverte a trava; sem o desvio pro PIN, OK desligaria o
        // controle parental inteiro em duas teclas — o mesmo buraco que o
        // caminho do ←→ já tinha tapado.
        const ramo = corpo.slice(corpo.indexOf("focusZone === 'gatesettings'"));
        expect(ramo).toContain('parentalUnlocked');
        expect(ramo).toContain("setPinMode('unlock')");
    });
});
