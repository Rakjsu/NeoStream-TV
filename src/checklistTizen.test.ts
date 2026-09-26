import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Guarda da seção "Build" do docs/CHECKLIST_TIZEN.md.
 *
 * O checklist é o ritual de quem gera o .wgt e instala na TV — o único momento
 * em que alguém empacota fora do CI. Se ele não mandar rodar os portões de
 * qualidade, dá pra instalar na TV um build com CSS que o Chromium 69 ignora,
 * com o orçamento de bundle estourado ou com a suíte vermelha.
 *
 * A lista de portões NÃO é fixa aqui: sai da tabela "Quality gates" do
 * README, a mesma que descreve o CI. Portão novo na tabela e esquecido no
 * checklist deixa este teste vermelho.
 */

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Comentário HTML some na renderização: um item escondido em `<!-- -->` não
// é item que alguém vá ver e marcar, então não conta.
const ler = (rel: string) =>
    readFileSync(path.join(RAIZ, rel), 'utf-8').replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');

/** Corpo de uma seção `## Titulo` de um markdown, até a próxima `## `. */
function secao(md: string, titulo: string): string {
    const linhas = md.split('\n');
    const inicio = linhas.findIndex(l => l.trim() === `## ${titulo}`);
    if (inicio < 0) throw new Error(`Seção "## ${titulo}" não encontrada`);
    const resto = linhas.slice(inicio + 1);
    const fim = resto.findIndex(l => l.startsWith('## '));
    return (fim < 0 ? resto : resto.slice(0, fim)).join('\n');
}

/** Comandos da primeira coluna da tabela "Quality gates" do README. */
function portoesDoReadme(): string[] {
    // Linhas de dados da tabela: tudo que começa com `|`, menos o cabeçalho
    // e a linha separadora `| --- | --- |`.
    const linhas = secao(ler('README.md'), 'Quality gates')
        .split('\n')
        .filter(l => l.startsWith('|'))
        .slice(2);
    // Falha ALTO se o formato mudar: tabela sumida, ou uma linha cujo portão
    // o parser não reconhece, faria o teste passar sem conferir aquele portão.
    if (linhas.length === 0) throw new Error('Tabela "Quality gates" do README sem nenhuma linha');
    return linhas.map(l => {
        const m = /^\|\s*`([^`]+)`\s*\|/.exec(l);
        if (!m) throw new Error(`Linha da tabela "Quality gates" sem portão reconhecível: ${l}`);
        return m[1];
    });
}

const build = secao(ler('docs/CHECKLIST_TIZEN.md'), 'Build');
const itens = build.split('\n').filter(l => l.startsWith('- [ ]'));

/** Índice do item do checklist que manda rodar exatamente este comando. */
const itemDe = (comando: string) => itens.findIndex(l => l.includes('`' + comando + '`'));

describe('CHECKLIST_TIZEN — seção Build', () => {
    it.each(portoesDoReadme())('manda rodar o portão do CI `%s`', portao => {
        expect(itemDe(portao), `faltou um item com \`${portao}\` na seção Build`).toBeGreaterThanOrEqual(0);
    });

    it('não manda o type-check que deixa erro passar (tsc --noEmit)', () => {
        expect(build).not.toMatch(/tsc\s+--noEmit`?\s+passa/);
        // O único `tsc` que o checklist manda rodar é o do build.
        const comandosTsc = itens.filter(l => /`npx tsc[^`]*`/.test(l)).map(l => /`(npx tsc[^`]*)`/.exec(l)![1]);
        expect(comandosTsc).toEqual(['npx tsc -b']);
    });

    it('roda o check:bundle DEPOIS do build:tizen, que é quem produz os assets que ele mede', () => {
        const buildTizen = itemDe('npm run build:tizen');
        const bundle = itemDe('npm run check:bundle');
        expect(buildTizen).toBeGreaterThanOrEqual(0);
        expect(bundle).toBeGreaterThan(buildTizen);
    });
});
