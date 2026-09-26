import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A tabela "Quality gates" do README é o único lugar VERSIONADO que diz a quem
 * chega quais portões um PR tem de passar (o CLAUDE.md é config local de
 * agente, ignorado pelo git).
 *
 * Ela apodrece de dois jeitos, e os dois já aconteceram:
 *  - número fixo: a linha do `npm test` dizia "226 tests" com a suíte já três
 *    vezes maior; todo PR que acrescenta teste deixa um número desses errado;
 *  - portão fora da tabela: o CI passou a rodar o `npm audit` e a tabela não
 *    ganhou a linha — quem segue a tabela descobre o portão no CI vermelho.
 *
 * O teste lê o README e o workflow de verdade e compara os dois. `npm test` e
 * `npm run X` são resolvidos pelo package.json, então a tabela pode citar
 * `npm run check:css` enquanto o CI roda `node scripts/check-tizen-css.mjs`.
 */

const RAIZ = process.cwd();
const ler = (...partes: string[]) => readFileSync(join(RAIZ, ...partes), 'utf-8').replace(/\r\n/g, '\n');

const README = ler('README.md');
const CI = ler('.github', 'workflows', 'ci.yml');
const PACOTE = JSON.parse(ler('package.json')) as { scripts: Record<string, string> };

/** `npm test` / `npm run X` viram o corpo do script; o resto fica como está. */
function resolver(comando: string): string {
    const limpo = comando.trim().replace(/\s+/g, ' ');
    const nome = limpo === 'npm test' ? 'test' : /^npm run (\S+)$/.exec(limpo)?.[1];
    if (nome === undefined) return limpo;
    const corpo = PACOTE.scripts[nome];
    if (corpo === undefined) {
        throw new Error(`"${limpo}" é citado, mas o package.json não tem o script "${nome}".`);
    }
    return corpo.trim().replace(/\s+/g, ' ');
}

function secaoDoReadme(titulo: string): string {
    const marca = `\n## ${titulo}\n`;
    const inicio = README.indexOf(marca);
    if (inicio < 0) throw new Error(`README sem a seção "## ${titulo}".`);
    const resto = README.slice(inicio + marca.length);
    const fim = resto.search(/\n## /);
    return fim < 0 ? resto : resto.slice(0, fim);
}

/** Comando (1ª coluna) de cada linha da tabela, sem cabeçalho e separador. */
function comandosDaTabela(): string[] {
    return secaoDoReadme('Quality gates')
        .split('\n')
        .filter(linha => linha.startsWith('|'))
        .slice(2)
        .map(linha => {
            const codigo = /`([^`]+)`/.exec(linha.split('|')[1] ?? '');
            if (!codigo) throw new Error(`Linha da tabela de portões sem comando em código: ${linha}`);
            return codigo[1];
        });
}

/** Todo `run:` do workflow, menos a instalação (que não é portão). */
function passosDoCi(): string[] {
    const passos = [...CI.matchAll(/^\s*(?:-\s+)?run:\s*(.+?)\s*$/gm)].map(achado => achado[1]);
    const blocos = passos.filter(passo => /^[|>][+-]?\d*$/.test(passo));
    if (blocos.length > 0) {
        throw new Error('ci.yml tem um run: de várias linhas; ensine este teste a lê-lo antes de seguir.');
    }
    return passos.filter(passo => passo !== 'npm ci');
}

describe('README: tabela de portões', () => {
    it('lista exatamente os passos que o CI roda', () => {
        const ci = passosDoCi().map(resolver).sort();
        const readme = comandosDaTabela().map(resolver).sort();
        expect(ci.length).toBeGreaterThan(0);
        expect(readme, 'a tabela "Quality gates" do README e o ci.yml divergem').toEqual(ci);
    });

    it('não crava quantidade de testes — o número apodrece no PR seguinte', () => {
        // Até duas palavras entre o número e "tests": "703 unit tests" e
        // "700 Vitest tests" apodrecem igual a "226 tests".
        const quantidade = /\b\d[\d.,]*\+?\s+(?:[^\s|]+\s+){0,2}(tests?|testes?)\b/i;
        expect(secaoDoReadme('Quality gates')).not.toMatch(quantidade);
        for (const exemplo of ['226 tests', '700+ tests', '703 unit tests', '700 Vitest tests', '1.200 testes unitários']) {
            expect(`| \`npm test\` | ${exemplo}. |`).toMatch(quantidade);
        }
    });
});
