// Guarda de compatibilidade do CSS, travado no Chromium 69.
//
// O tizen/config.xml declara required_version="5.5", e Tizen 5.5 é Chromium 69.
// Três vezes seguidas o app foi pra TV com CSS que aquele motor simplesmente
// ignora — `inset` (47 usos), `gap` em flexbox (102 regras) e `aspect-ratio`
// (8 usos) —, e nenhuma das três apareceu no navegador do desenvolvimento nem
// quebrou o build. Só na TV, como layout torto e caixa preta.
//
// São dois tipos de checagem:
//
//  1. PROIBIDO — o recurso não tem compensação possível e sai do código.
//  2. COMPENSÁVEL — o recurso é o jeito CERTO de escrever e funciona nas TVs
//     novas; ele fica, desde que o seletor apareça no arquivo de fallback
//     correspondente. É aqui que mora o valor real: nada impede alguém de
//     acrescentar um `gap` novo daqui a três meses, e sem esta checagem o
//     fallback silenciosamente deixaria de cobrir o app.
//
//   node scripts/check-tizen-css.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');

/** Versão do Chromium que a TV mais velha suportada roda. */
const CHROMIUM_ALVO = 69;

/**
 * Sem compensação: sai do código. `desde` é a versão do Chrome em que o
 * recurso chegou — está aqui pro erro poder explicar o porquê.
 */
const PROIBIDOS = [
    {
        nome: 'inset',
        desde: 87,
        regex: /(^|[;{\s])inset\s*:/,
        saida: 'use as 4 longhand: top / right / bottom / left',
    },
    {
        nome: 'clamp()',
        desde: 79,
        regex: /:\s*[^;{}]*\bclamp\(/,
        saida: 'use um valor fixo, ou min-width/max-width',
    },
    {
        nome: 'min()/max() em valor',
        desde: 79,
        regex: /:\s*[^;{}]*[\s(]m(in|ax)\(\s*[^;{}]*,/,
        saida: 'use min-width/max-width, que são propriedades e não funções',
    },
    {
        nome: ':is()',
        desde: 88,
        regex: /:is\(/,
        saida: 'escreva os seletores separados por vírgula',
    },
    {
        nome: ':where()',
        desde: 88,
        regex: /:where\(/,
        saida: 'escreva os seletores separados por vírgula',
    },
    {
        nome: 'content-visibility',
        desde: 85,
        regex: /(^|[;{\s])content-visibility\s*:/,
        saida: 'remova — não há equivalente; o ganho não existe em TV velha',
    },
    {
        nome: 'color-mix()',
        desde: 111,
        regex: /color-mix\(/,
        saida: 'calcule a cor final e escreva o hex',
    },
    {
        nome: 'text-wrap',
        desde: 114,
        regex: /(^|[;{\s])text-wrap\s*:/,
        saida: 'remova — é só refinamento tipográfico',
    },
    {
        nome: '::backdrop',
        desde: 37,
        regex: /::backdrop/,
        saida: 'o <dialog> nativo não é usado no app; pinte um fundo próprio',
        // (fica na lista porque `dialog` + `::backdrop` é o reflexo de quem
        // vem do navegador moderno, e no Tizen o showModal simplesmente falha)
    },
];

/** Arquivos que EXISTEM para compensar a falta de suporte. */
const FALLBACKS = {
    gap: 'flex-gap-fallback.css',
    aspectRatio: 'aspect-ratio-fallback.css',
};

function arquivosCss(dir) {
    return readdirSync(dir).flatMap(nome => {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) return arquivosCss(caminho);
        return nome.endsWith('.css') ? [caminho] : [];
    });
}

/** O fallback cobre este seletor? Basta a primeira alternativa da lista. */
function cobre(textoFallback, seletor, prefixo) {
    return seletor.split(',').some(parte => {
        const alvo = parte.trim();
        return alvo && textoFallback.includes(`${prefixo}${alvo}`);
    });
}

const erros = [];
const lista = arquivosCss(srcDir);
const gapFallback = readFileSync(join(srcDir, FALLBACKS.gap), 'utf8');
const arFallback = readFileSync(join(srcDir, FALLBACKS.aspectRatio), 'utf8');
const ehFallbackFile = caminho => Object.values(FALLBACKS).some(nome => caminho.endsWith(nome));

for (const caminho of lista) {
    const curto = relative(root, caminho).replace(/\\/g, '/');
    const linhas = readFileSync(caminho, 'utf8').split('\n');
    const ehFallback = ehFallbackFile(caminho);

    // Dentro de um @supports o recurso moderno é intencional: o navegador bom
    // usa e a TV cai na regra alternativa.
    let profundidadeSupports = 0;
    let chavesNoSupports = 0;

    let seletor = '';
    let temFlex = false;
    let linhaGap = null;
    let linhaAspect = null;

    linhas.forEach((linha, i) => {
        const num = i + 1;
        const texto = linha.replace(/\/\*.*?\*\//g, '');

        if (/@supports/.test(texto)) {
            profundidadeSupports++;
            chavesNoSupports = 0;
        }
        if (profundidadeSupports > 0) {
            chavesNoSupports += (texto.match(/\{/g) || []).length;
            chavesNoSupports -= (texto.match(/\}/g) || []).length;
            if (chavesNoSupports <= 0) profundidadeSupports = 0;
        }
        const conferir = !ehFallback && profundidadeSupports === 0;

        if (conferir) {
            for (const proibido of PROIBIDOS) {
                if (proibido.regex.test(texto)) {
                    erros.push(
                        `${curto}:${num}  ${proibido.nome} chegou no Chrome ${proibido.desde}, `
                        + `a TV roda ${CHROMIUM_ALVO}\n      → ${proibido.saida}\n      ${linha.trim()}`
                    );
                }
            }
        }

        // ---- rastreio de regra, pros compensáveis ----
        const abre = texto.match(/^([^{}]*[^{}\s])\s*\{\s*$/);
        if (abre) {
            seletor = abre[1].trim();
            temFlex = false;
            linhaGap = null;
            linhaAspect = null;
        }
        if (/display\s*:\s*(inline-)?flex/.test(texto)) temFlex = true;
        // gap: 0 não separa nada — não precisa de compensação
        if (/(^|[;{\s])(gap|row-gap|column-gap)\s*:/.test(texto)
            && !/:\s*0(px|rem|em|%)?\s*(;|$)/.test(texto)) linhaGap = num;
        if (/(^|[;{\s])aspect-ratio\s*:/.test(texto)) linhaAspect = num;

        if (/\}/.test(texto) && seletor) {
            // `gap` em GRID funciona desde o Chrome 66; só flex precisa disto
            if (conferir && temFlex && linhaGap !== null
                && !cobre(gapFallback, seletor, '.no-flex-gap ')) {
                erros.push(
                    `${curto}:${linhaGap}  gap em flexbox sem fallback (chegou no Chrome 84, `
                    + `a TV roda ${CHROMIUM_ALVO})\n      → acrescente `
                    + `\`html.no-flex-gap ${seletor.split(',')[0].trim()}\` em src/${FALLBACKS.gap}`
                );
            }
            if (conferir && linhaAspect !== null && !cobre(arFallback, seletor, '')) {
                erros.push(
                    `${curto}:${linhaAspect}  aspect-ratio sem fallback (chegou no Chrome 88, `
                    + `a TV roda ${CHROMIUM_ALVO})\n      → acrescente `
                    + `\`${seletor.split(',')[0].trim()}\` com altura explícita em `
                    + `src/${FALLBACKS.aspectRatio}`
                );
            }
            seletor = '';
            temFlex = false;
            linhaGap = null;
            linhaAspect = null;
        }
    });
}

console.log(`CSS conferido contra Chromium ${CHROMIUM_ALVO}: ${lista.length} arquivo(s).`);
if (erros.length > 0) {
    console.error(`\n${erros.length} problema(s) de compatibilidade:\n`);
    for (const erro of erros) console.error(`  ${erro}\n`);
    console.error('Estes recursos NÃO quebram o build e NÃO aparecem no navegador —');
    console.error('eles só somem na TV, como layout torto. Por isso a checagem existe.\n');
    process.exit(1);
}
console.log('Nenhum recurso fora do alcance da TV.');
