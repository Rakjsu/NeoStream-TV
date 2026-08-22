// Empacotamento Tizen (item 80).
//
// O `xcopy` que existia antes só COPIAVA por cima: um bundle que o build
// deixasse de produzir continuava em tizen/assets e ia parar dentro do .wgt.
// Foi o que aconteceu com polyfills.js (31 KB órfãos, referenciados por
// ninguém). Aqui o destino é limpo antes de receber os arquivos novos.
//
// A versão também deixa de ser mantida em dois lugares: package.json manda,
// e o config.xml passa a ser derivado dele.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLYFILLS_DO_BUILD, MARCA_NO_BUNDLE } from './tizen-polyfills.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist-tizen', 'assets');
const tizenDir = join(root, 'tizen');
const assetsDir = join(tizenDir, 'assets');
const configPath = join(tizenDir, 'config.xml');

function run(command) {
    execSync(command, { cwd: root, stdio: 'inherit' });
}

function humanKb(bytes) {
    return `${Math.round(bytes / 1024)} KB`;
}

// ---- 1. versão: package.json é a fonte da verdade ----
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const config = readFileSync(configPath, 'utf8');
const versionMatch = config.match(/(<widget[^>]*\sversion=")([^"]+)(")/);
if (!versionMatch) {
    console.error('config.xml sem atributo version no <widget> — abortando.');
    process.exit(1);
}
if (versionMatch[2] !== pkg.version) {
    writeFileSync(
        configPath,
        config.replace(versionMatch[0], `${versionMatch[1]}${pkg.version}${versionMatch[3]}`),
        'utf8'
    );
    console.log(`config.xml: versão ${versionMatch[2]} → ${pkg.version}`);
} else {
    console.log(`config.xml: versão ${pkg.version} (já em dia)`);
}

// ---- 2. build ----
run('npx tsc -b');
run('npx vite build --config vite.tizen.config.ts');

// ---- 3. destino limpo, depois copia ----
rmSync(assetsDir, { recursive: true, force: true });
mkdirSync(assetsDir, { recursive: true });
cpSync(distDir, assetsDir, { recursive: true });

const files = readdirSync(assetsDir)
    .map(name => ({ name, size: statSync(join(assetsDir, name)).size }))
    .sort((a, b) => b.size - a.size);
const total = files.reduce((sum, file) => sum + file.size, 0);

console.log('\ntizen/assets:');
for (const file of files) {
    console.log(`  ${humanKb(file.size).padStart(8)}  ${file.name}`);
}
console.log(`  ${humanKb(total).padStart(8)}  TOTAL\n`);

// ---- 4. o index.html aponta pra arquivos que existem? ----
// Trocar a estratégia de bundle (legacy ↔ moderno) muda os NOMES dos assets, e
// o index.html do Tizen é escrito à mão. Sem esta checagem o .wgt sai com
// <script src> apontando pro vazio e a TV mostra tela preta — sem erro visível.
const html = readFileSync(join(tizenDir, 'index.html'), 'utf8');
const referenced = [...html.matchAll(/\.\/assets\/([\w.-]+\.(?:js|css))/g)].map(m => m[1]);
const present = new Set(readdirSync(assetsDir));
const missing = [...new Set(referenced)].filter(name => !present.has(name));
if (missing.length > 0) {
    console.error(`
ERRO: tizen/index.html referencia assets que o build nao produziu: ${missing.join(', ')}`);
    console.error(`Produzidos: ${[...present].join(', ')}`);
    process.exit(1);
}
console.log(`index.html: ${[...new Set(referenced)].length} referencia(s) conferida(s).
`);

// ---- 4b. a lista de polyfills declarada bate com o bundle? ----
// O eslint-plugin-compat silencia estes nomes por CONFIAR que o build os entrega.
// Se alguém mexer no `modernPolyfills` do vite.tizen.config.ts, a confiança vira
// mentira e o lint passa a esconder um erro real — que só aparece na TV.
const polyfillFile = readdirSync(assetsDir).find(name => name.startsWith('polyfills'));
const polyfillSource = polyfillFile ? readFileSync(join(assetsDir, polyfillFile), 'utf8') : '';
const naoEntregues = POLYFILLS_DO_BUILD.filter(
    nome => !polyfillSource.includes(MARCA_NO_BUNDLE[nome] ?? nome)
);
if (naoEntregues.length > 0) {
    console.error(`
ERRO: scripts/tizen-polyfills.mjs declara polyfills que o bundle NAO entrega: ${naoEntregues.join(', ')}`);
    console.error('O eslint-plugin-compat esta silenciando estes nomes por confiar nesta lista.');
    console.error('Ou o build parou de polifilar, ou a lista esta errada. Nao ignore.');
    process.exit(1);
}
console.log(`polyfills: ${POLYFILLS_DO_BUILD.length} declarado(s) e conferido(s) no bundle.
`);

// ---- 5. o .wgt em si ----
// Empacotar exige o Tizen Studio CLI e um certificado de autor: sem assinatura
// a TV recusa a instalação, então não adianta gerar um zip aqui.
console.log('Pronto pra empacotar. Com o Tizen Studio CLI no PATH:');
console.log(`  tizen build-web -- "${tizenDir}"`);
console.log(`  tizen package -t wgt -s <seu-perfil> -- "${join(tizenDir, '.buildResult')}"`);
