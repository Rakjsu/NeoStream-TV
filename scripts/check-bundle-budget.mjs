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
    jsTotal: 1157,
    /**
     * O maior arquivo isolado — é ele que trava a thread principal no parse.
     *
     * 1030 → 1036 (e jsTotal 1150 → 1155) em 25/09/2026, leva T4 da TV: a main
     * media 1054840 bytes, sem folga, e quatro itens da leva cabem juntos aqui —
     * janela da grade de Filmes (T020, ~0,6 KB), cache de boot de Filmes e
     * Séries (T118, ~3 KB), reconexão de filme/episódio (T121, ~0,5 KB) e o
     * aviso de série sem episódio (T135, ~0,7 KB). Medido com os quatro juntos:
     * index.js 1060047 bytes (1035,2 KB), JS total 1153,7 KB. Os quatro PRs
     * levam ESTE MESMO trecho, pra entrarem em qualquer ordem sem conflito.
     *
     * 1036 → 1038 (e jsTotal 1155 → 1157) no mesmo dia, pro par que ficou do
     * re-run da leva: barra A-Z e CH± em Séries (T023, ~1,3 KB) e a sinopse
     * inteira da ficha (T115, ~0,9 KB). Medido com os dois juntos: index.js
     * 1062195 bytes (1037,3 KB). Os dois PRs levam este mesmo trecho.
     */
    maiorJs: 1038,
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
