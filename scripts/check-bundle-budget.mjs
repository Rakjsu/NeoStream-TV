// Orçamento de tamanho do bundle.
//
// Numa TV de 2019 (1 GB de RAM, CPU de celular de 2015) o custo de um bundle
// grande não é a rede: é o tempo de PARSE e a memória do heap. O app já saiu
// uma vez com 31 KB de polyfill órfão e uma vez com o bundle inteiro num
// arquivo só, e nenhuma das duas coisas apareceu em lugar nenhum — build
// verde, navegador rápido, TV lenta.
//
// O teto abaixo é o tamanho de HOJE arredondado pra cima. Ele não existe pra
// ser bonito: existe pra que um `npm i <coisa-grande>` apareça no CI como uma
// falha, e não daqui a três meses como "a TV ficou lenta".
//
//   node scripts/check-bundle-budget.mjs [dist-tizen/assets]

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const alvo = join(root, process.argv[2] || join('dist-tizen', 'assets'));

/**
 * Tetos em KB (tamanho real do arquivo, que é o que a TV lê do disco;
 * o .wgt é instalado descompactado).
 */
// Medido em 21/08/2026: index.js 980 KB, polyfills.js 119 KB, style.css 141 KB.
// Os tetos são esses valores com ~5% de folga — apertado de propósito.
const ORCAMENTO = {
    /** Soma de todo JS. */
    jsTotal: 1150,
    /** O maior arquivo isolado — é ele que trava a thread principal no parse. */
    maiorJs: 1030,
    /** Todo o CSS. */
    cssTotal: 160,
};

if (!existsSync(alvo)) {
    console.error(`Sem build para conferir: ${alvo}`);
    console.error('Rode `npm run build:tizen` antes.');
    process.exit(1);
}

const kb = bytes => Math.round(bytes / 1024);
const arquivos = readdirSync(alvo)
    .filter(nome => /\.(js|css)$/.test(nome))
    .map(nome => {
        const caminho = join(alvo, nome);
        const size = statSync(caminho).size;
        return { nome, size, gzip: gzipSync(readFileSync(caminho)).length };
    })
    .sort((a, b) => b.size - a.size);

const js = arquivos.filter(f => f.nome.endsWith('.js'));
const css = arquivos.filter(f => f.nome.endsWith('.css'));
const somaJs = js.reduce((total, f) => total + f.size, 0);
const somaCss = css.reduce((total, f) => total + f.size, 0);
const maiorJs = js.length > 0 ? js[0].size : 0;

console.log(`\nBundle em ${process.argv[2] || 'dist-tizen/assets'}:`);
for (const f of arquivos) {
    console.log(`  ${String(kb(f.size)).padStart(5)} KB  (${String(kb(f.gzip)).padStart(4)} KB gz)  ${f.nome}`);
}

const medidas = [
    { rotulo: 'JS total', valor: kb(somaJs), teto: ORCAMENTO.jsTotal },
    { rotulo: 'maior JS', valor: kb(maiorJs), teto: ORCAMENTO.maiorJs },
    { rotulo: 'CSS total', valor: kb(somaCss), teto: ORCAMENTO.cssTotal },
];

console.log('');
let estourou = false;
for (const m of medidas) {
    const folga = m.teto - m.valor;
    const marca = folga < 0 ? 'ESTOUROU' : `folga ${folga} KB`;
    console.log(`  ${m.rotulo.padEnd(10)} ${String(m.valor).padStart(5)} KB / ${m.teto} KB  ${marca}`);
    if (folga < 0) estourou = true;
}

if (estourou) {
    console.error('\nO orçamento de bundle estourou.');
    console.error('Se o crescimento for legítimo, suba o teto em scripts/check-bundle-budget.mjs');
    console.error('DE PROPÓSITO e no mesmo commit — é isso que torna o aumento visível.\n');
    process.exit(1);
}
console.log('\nDentro do orçamento.\n');
