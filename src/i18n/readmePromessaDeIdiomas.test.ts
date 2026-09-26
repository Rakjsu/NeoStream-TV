import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * O README não pode prometer mais idiomas do que o app entrega (T094).
 *
 * A primeira tela do app é a escolha de idioma, e o README vendia
 * "Portuguese, English, and Spanish language resources" como recurso
 * entregue. Só quem importa `useTranslation` segue o idioma escolhido; o
 * resto é português cravado no JSX. Quem escolhe English cai em português na
 * Home — e nas Configurações, onde tentaria desfazer.
 *
 * O teste não guarda lista de telas: ele DESCOBRE no código quem traduz e
 * quais páginas não traduzem, e cobra do README a frase que bate com isso.
 * Traduziu uma tela nova? O teste pede o nome dela no README. Traduziu todas
 * as páginas? O teste pede para tirar a ressalva e o item do Roadmap.
 */

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(RAIZ, 'src');
const README = readFileSync(path.join(RAIZ, 'README.md'), 'utf8').replace(/\r\n/g, '\n');

const IMPORTA_TRADUCAO = /from\s+['"][./]*(?:[\w-]+\/)*useTranslation['"]/;
const RESSALVA = 'the rest of the interface is portuguese';

function fontes(dir: string): string[] {
    return readdirSync(dir).flatMap(nome => {
        const completo = path.join(dir, nome);
        if (statSync(completo).isDirectory()) return fontes(completo);
        if (!/\.tsx?$/.test(nome) || /\.test\.tsx?$/.test(nome) || nome.endsWith('.d.ts')) return [];
        return [completo];
    });
}

/** "LanguageSelection.tsx" -> "language selection" */
function nomeLegivel(arquivo: string): string {
    return path.basename(arquivo).replace(/\.tsx?$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function secao(titulo: string): string {
    const inicio = README.indexOf(`\n${titulo}\n`);
    if (inicio < 0) throw new Error(`README sem a seção "${titulo}" — o teste precisa ser atualizado junto`);
    const resto = README.slice(inicio + titulo.length + 2);
    const fim = resto.search(/^#{2,3} /m);
    return fim < 0 ? resto : resto.slice(0, fim);
}

function bullets(texto: string): string[] {
    // bullet de uma linha ou quebrado em linhas indentadas
    return texto.split(/\n(?=- )/).filter(b => b.startsWith('- ')).map(b => b.replace(/\s*\n\s*/g, ' ').trim());
}

function bulletsDeIdioma(titulo: string): string[] {
    return bullets(secao(titulo)).filter(b => /English/.test(b) && /Spanish/.test(b));
}

const traduzidos = fontes(SRC).filter(f => IMPORTA_TRADUCAO.test(readFileSync(f, 'utf8')));
const paginas = readdirSync(path.join(SRC, 'pages'))
    .filter(n => n.endsWith('.tsx') && !/\.test\.tsx$/.test(n))
    .map(n => path.join(SRC, 'pages', n));
const paginasSemTraducao = paginas.filter(p => !traduzidos.includes(p)).map(nomeLegivel);

describe('README x idiomas de verdade (T094)', () => {
    it('a descoberta enxerga o código (senão o teste passaria calado)', () => {
        expect(traduzidos.length).toBeGreaterThan(0);
        expect(paginas.length).toBeGreaterThan(0);
    });

    const bulletIdiomas = () => {
        const achados = bulletsDeIdioma('### System');
        if (achados.length !== 1) {
            throw new Error(`esperava 1 bullet de idiomas em "### System", achei ${achados.length}: ${JSON.stringify(achados)}`);
        }
        return achados[0].toLowerCase();
    };

    // A lista de telas traduzidas é o trecho entre "Translated so far:" e o ";".
    // Procurar no bullet inteiro deixaria passar "Settings" (o bullet já diz
    // "in Settings" por outro motivo).
    const listaDeTraduzidas = () => {
        const achado = /translated so far:(.*?);/.exec(bulletIdiomas());
        if (!achado) throw new Error('o bullet de idiomas perdeu o trecho "Translated so far: ...;" — o teste precisa ser atualizado junto');
        return achado[1];
    };
    const cita = (texto: string, nome: string) => new RegExp(`\\b${nome}\\b`).test(texto);

    it('cita cada tela que de fato segue o idioma escolhido', () => {
        const lista = listaDeTraduzidas();
        const faltando = traduzidos.map(nomeLegivel).filter(nome => !cita(lista, nome));
        expect(faltando).toEqual([]);
    });

    it('não cita como traduzida tela que não segue o idioma', () => {
        const lista = listaDeTraduzidas();
        const nomesTraduzidos = traduzidos.map(nomeLegivel);
        const prometidasSemTraducao = [...new Set(fontes(SRC).map(nomeLegivel))]
            .filter(nome => cita(lista, nome) && !nomesTraduzidos.includes(nome));
        expect(prometidasSemTraducao).toEqual([]);
    });

    it('avisa que o resto é português enquanto houver página sem tradução', () => {
        const ressalva = bulletIdiomas().includes(RESSALVA);
        expect(ressalva, `páginas sem tradução: ${JSON.stringify(paginasSemTraducao)}`).toBe(paginasSemTraducao.length > 0);
    });

    it('o Roadmap traz a tradução do resto enquanto ela não existe', () => {
        const noRoadmap = bulletsDeIdioma('## Roadmap').length > 0;
        expect(noRoadmap, `páginas sem tradução: ${JSON.stringify(paginasSemTraducao)}`).toBe(paginasSemTraducao.length > 0);
    });
});

describe('README não crava número de testes (T094)', () => {
    // Todo PR acrescenta teste: um número fixo no README envelhece no PR seguinte
    // (estava "226" com centenas a mais na suíte).
    // Qualquer formato de badge do shields.io (rótulo-mensagem-cor): "tests-226",
    // "708-tests", "tests-708 passing"... A cor fica de fora (um hex pode ter dígito).
    it('no badge', () => {
        const badgesComNumeroDeTestes = (README.match(/img\.shields\.io\/badge\/[^)\s]*/g) ?? [])
            .map(url => decodeURIComponent(url.replace(/^img\.shields\.io\/badge\//, '')).split('-').slice(0, 2).join(' '))
            .filter(texto => /tests?\b/i.test(texto) && /\d/.test(texto));
        expect(badgesComNumeroDeTestes).toEqual([]);
    });

    // "226 tests", "708 Vitest tests", "1,024 unit tests"...
    it('no texto (tabela de portões)', () => {
        expect(README.match(/\b\d[\d,.]*\s+(?:[\w-]+\s+){0,2}tests?\b/gi)).toBeNull();
    });
});
