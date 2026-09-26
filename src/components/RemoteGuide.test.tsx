// @vitest-environment jsdom
//
// 🎛 O guia do controle remoto é "a única documentação que ele vai ler" — e
// documentava cinco contextos quando o app atende tecla colorida em onze: o
// guia de programação (as quatro), Favoritos (🔴), Minha Lista (🔴🟡🔵), o
// painel "Agora nos favoritos" (🟡 reordenar), o menu de categorias da TV ao
// vivo (🔵 ocultar), a fileira Continuar Assistindo da Home (🔴, T029) e o
// 🔴 "canal anterior" do player ficavam de fora. E o rodapé do próprio guia
// prometia que "o rodapé de cada tela sempre mostra as dela" — falso no
// player, onde o 🔴 não aparece em lugar nenhum.
//
// Duas pontas:
//  1. o que a pessoa VÊ: o guia renderizado de verdade, seção por seção;
//  2. o contrato que impede de divergir de novo: todo arquivo de src/ que
//     atende tecla colorida tem de estar mapeado para uma seção do guia, e
//     cada cor que ele atende tem de aparecer naquela seção. Arquivo novo
//     com tecla colorida e sem seção → falha, dizendo qual arquivo e qual cor.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { RemoteGuide } from './RemoteGuide';

beforeAll(() => {
    // jsdom não implementa scrollIntoView, e o guia chama na seção atual
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
});

afterEach(cleanup);

type Cor = 'red' | 'green' | 'yellow' | 'blue';
const EMOJI: Record<Cor, string> = { red: '🔴', green: '🟢', yellow: '🟡', blue: '🔵' };

/** Título da seção → texto de cada linha (tecla + o que faz), lido do DOM. */
function secoesRenderizadas(): Map<string, string[]> {
    const { container } = render(<RemoteGuide onClose={() => { /* não interessa */ }} />);
    const secoes = new Map<string, string[]>();
    container.querySelectorAll('.guide-section').forEach(secao => {
        const titulo = secao.querySelector('.guide-section-title')?.textContent ?? '';
        const linhas = Array.from(secao.querySelectorAll('.guide-row')).map(l => l.textContent ?? '');
        secoes.set(titulo, linhas);
    });
    return secoes;
}

function coresDaSecao(linhas: string[]): Set<Cor> {
    const cores = new Set<Cor>();
    for (const cor of Object.keys(EMOJI) as Cor[]) {
        if (linhas.some(l => l.includes(EMOJI[cor]))) cores.add(cor);
    }
    return cores;
}

// ── Varredura do código: quem atende tecla colorida ─────────────────────────

const SRC = path.resolve('src');

/** Onde a tecla é DEFINIDA ou REGISTRADA, não atendida — e o próprio guia. */
const NAO_ATENDEM = new Set([
    'hooks/useTVNavigation.ts',   // traduz 403–406 em 'red'…'blue'
    'App.tsx',                    // registra as teclas no tizen.tvinputdevice
    'components/RemoteGuide.tsx', // é o guia
]);

function arquivosDeCodigo(dir: string): string[] {
    return readdirSync(dir).flatMap(nome => {
        const completo = path.join(dir, nome);
        if (statSync(completo).isDirectory()) return arquivosDeCodigo(completo);
        if (!/\.(ts|tsx)$/.test(nome) || /\.test\.(ts|tsx)$/.test(nome)) return [];
        return [completo];
    });
}

const COR_DO_CODIGO: Cor[] = ['red', 'green', 'yellow', 'blue']; // 403…406

const PADROES: Array<[RegExp, (m: RegExpExecArray) => Cor]> = [
    // onAction do useTVNavigation, seja qual for o nome do parâmetro:
    // action === 'red', acao !== 'blue', 'green' === tecla...
    [/[!=]==\s*'(red|green|yellow|blue)'/g, m => m[1] as Cor],
    [/'(red|green|yellow|blue)'\s*[!=]==/g, m => m[1] as Cor],
    // switch (acao) { case 'yellow': ... }
    [/\bcase\s+'(red|green|yellow|blue)'\s*:/g, m => m[1] as Cor],
    // listener próprio (o player): key === 'ColorF0Red' / code === 403.
    // Só nomes de tecla: `status === 403` (HTTP) não é tecla colorida.
    [/ColorF\d(Red|Green|Yellow|Blue)/g, m => m[1].toLowerCase() as Cor],
    [/\b(?:code|keyCode|which)\s*[!=]==\s*(40[3-6])\b/g, m => COR_DO_CODIGO[Number(m[1]) - 403]],
];

function coresNoFonte(fonte: string): Set<Cor> {
    const cores = new Set<Cor>();
    for (const [padrao, cor] of PADROES) {
        for (const m of fonte.matchAll(padrao)) cores.add(cor(m));
    }
    return cores;
}

function quemAtendeTeclaColorida(): Map<string, Set<Cor>> {
    const achados = new Map<string, Set<Cor>>();
    for (const arquivo of arquivosDeCodigo(SRC)) {
        const relativo = path.relative(SRC, arquivo).split(path.sep).join('/');
        if (NAO_ATENDEM.has(relativo)) continue;
        const cores = coresNoFonte(readFileSync(arquivo, 'utf8'));
        if (cores.size > 0) achados.set(relativo, cores);
    }
    return achados;
}

/**
 * Arquivo que atende tecla colorida → título da seção do guia que a explica.
 * Arquivo novo que atenda tecla colorida e não esteja aqui derruba o teste.
 */
const SECAO_DO_ARQUIVO: Record<string, string> = {
    'pages/Home.tsx': 'Início',
    'pages/LiveTV.tsx': 'TV ao Vivo',
    'components/CategoryMenu.tsx': 'Menu de categorias (TV ao Vivo)',
    'components/LivePanels.tsx': 'Agora nos favoritos (TV ao Vivo)',
    'components/EpgGrid.tsx': 'Guia de programação',
    'pages/Movies.tsx': 'Filmes e Séries',
    'pages/Series.tsx': 'Filmes e Séries',
    'pages/Favorites.tsx': 'Favoritos',
    'pages/MyList.tsx': 'Minha Lista',
    'components/VideoPlayer/VideoPlayer.tsx': 'Durante a reprodução',
    'pages/Settings.tsx': 'Configurações',
};

describe('RemoteGuide — toda tela que atende tecla colorida está no guia', () => {
    it('a varredura enxerga quem atende tecla colorida (sem isto o contrato passaria vazio)', () => {
        const achados = quemAtendeTeclaColorida();
        // Âncoras que existem há muitas rodadas: se a varredura parar de
        // achá-las, o regex quebrou e o contrato abaixo não prova nada.
        expect(achados.get('pages/LiveTV.tsx')).toEqual(new Set(['red', 'green', 'yellow', 'blue']));
        expect(achados.get('components/EpgGrid.tsx')).toEqual(new Set(['red', 'green', 'yellow', 'blue']));
        expect(achados.get('components/VideoPlayer/VideoPlayer.tsx')).toEqual(new Set(['red']));
    });

    it('a varredura reconhece a tecla escrita de outro jeito — e não confunde HTTP 403 com 🔴', () => {
        // Tela nova não precisa chamar o parâmetro de `action` para ser vista
        expect(coresNoFonte(`onAction: (tecla) => { if (tecla === 'green') go(); }`)).toEqual(new Set(['green']));
        expect(coresNoFonte(`if ('blue' !== a) return;`)).toEqual(new Set(['blue']));
        expect(coresNoFonte(`switch (acao) { case 'yellow': abrir(); break; }`)).toEqual(new Set(['yellow']));
        expect(coresNoFonte(`if (event.keyCode === 406) x();`)).toEqual(new Set(['blue']));
        expect(coresNoFonte(`if (key === 'ColorF1Green') x();`)).toEqual(new Set(['green']));
        expect(coresNoFonte(`return status === 404 || status === 403 ? 'notfound' : 'network';`)).toEqual(new Set());
    });

    it('nenhum arquivo atende tecla colorida sem seção no guia — e o mapa não guarda arquivo morto', () => {
        const achados = quemAtendeTeclaColorida();
        const semSecao = [...achados.keys()].filter(a => !(a in SECAO_DO_ARQUIVO));
        expect(semSecao, 'arquivo novo atende tecla colorida: documente no RemoteGuide e mapeie aqui').toEqual([]);
        const mortos = Object.keys(SECAO_DO_ARQUIVO).filter(a => !achados.has(a));
        expect(mortos, 'arquivo mapeado não atende mais tecla colorida: tire do guia e daqui').toEqual([]);
    });

    it('cada cor que o arquivo atende aparece na seção dele', () => {
        const secoes = secoesRenderizadas();
        const faltando: string[] = [];
        for (const [arquivo, cores] of quemAtendeTeclaColorida()) {
            const titulo = SECAO_DO_ARQUIVO[arquivo];
            if (!titulo) continue; // o teste anterior já acusa
            const linhas = secoes.get(titulo);
            if (!linhas) {
                faltando.push(`${arquivo}: o guia não tem a seção "${titulo}"`);
                continue;
            }
            const noGuia = coresDaSecao(linhas);
            for (const cor of cores) {
                if (!noGuia.has(cor)) faltando.push(`${arquivo}: ${EMOJI[cor]} fora da seção "${titulo}"`);
            }
        }
        expect(faltando).toEqual([]);
    });

    it('o guia não ensina cor que nenhuma tela da seção atende', () => {
        // A volta do contrato: um 🟢 inventado em Favoritos manda a pessoa
        // apertar uma tecla que não faz nada ("guia errado é pior que guia nenhum").
        const atendidas = new Map<string, Set<Cor>>();
        for (const [arquivo, cores] of quemAtendeTeclaColorida()) {
            const titulo = SECAO_DO_ARQUIVO[arquivo];
            if (!titulo) continue;
            const acc = atendidas.get(titulo) ?? new Set<Cor>();
            cores.forEach(c => acc.add(c));
            atendidas.set(titulo, acc);
        }
        const sobrando: string[] = [];
        for (const [titulo, linhas] of secoesRenderizadas()) {
            for (const cor of coresDaSecao(linhas)) {
                if (!atendidas.get(titulo)?.has(cor)) sobrando.push(`"${titulo}": ${EMOJI[cor]} no guia, mas nenhuma tela dela atende`);
            }
        }
        expect(sobrando).toEqual([]);
    });

    it('o guia diz o que cada tecla faz nas telas que faltavam', () => {
        const secoes = secoesRenderizadas();
        const texto = (titulo: string) => (secoes.get(titulo) ?? []).join(' | ');

        // EpgGrid: 🔴 moverJanela(-2) volta, 🟢 moverJanela(2) avança — a direção importa
        expect(texto('Guia de programação')).toMatch(/🔴[^|]*[Vv]oltar uma hora/);
        expect(texto('Guia de programação')).toMatch(/🟢[^|]*[Aa]vançar uma hora/);
        expect(texto('Guia de programação')).toMatch(/🟡[^|]*agora/i);
        expect(texto('Guia de programação')).toMatch(/🔵[^|]*[Aa]ssistir/);
        expect(texto('Favoritos')).toMatch(/🔴[^|]*[Rr]emover/);
        expect(texto('Minha Lista')).toMatch(/🔴[^|]*[Rr]emover/);
        expect(texto('Minha Lista')).toMatch(/🟡[^|]*suas listas/);
        // MyList: o primeiro 🔵 só arma; quem não sabe disso acha que a tecla falhou
        expect(texto('Minha Lista')).toMatch(/🔵[^|]*apagar a lista[^|]*duas vezes/i);
        expect(texto('Agora nos favoritos (TV ao Vivo)')).toMatch(/🟡[^|]*reordenar/i);
        expect(texto('Menu de categorias (TV ao Vivo)')).toMatch(/🔵[^|]*categoria/);
        expect(texto('Início')).toMatch(/🔴[^|]*Continuar Assistindo/);
        expect(texto('Durante a reprodução')).toMatch(/🔴[^|]*canal anterior/);
    });

    it('o rodapé não promete que o rodapé de cada tela mostra as teclas dela', () => {
        const { container } = render(<RemoteGuide onClose={() => { /* não interessa */ }} />);
        const rodape = container.querySelector('.guide-footer')?.textContent ?? '';
        // O 🔴 "canal anterior" do player não aparece em rodapé nenhum
        expect(rodape).not.toMatch(/sempre mostra/);
        expect(rodape).toMatch(/cores mudam|mudam de função/);
    });

    it('▼ percorre até a última seção e ▲ volta à primeira', () => {
        const { container } = render(<RemoteGuide onClose={() => { /* não interessa */ }} />);
        const secoes = container.querySelectorAll('.guide-section');
        const atual = () => Array.from(secoes).findIndex(s => s.classList.contains('current'));
        for (let i = 0; i < secoes.length + 2; i++) {
            act(() => { fireEvent.keyDown(window, { key: 'ArrowDown', keyCode: 40 }); });
        }
        expect(atual()).toBe(secoes.length - 1);
        for (let i = 0; i < secoes.length + 2; i++) {
            act(() => { fireEvent.keyDown(window, { key: 'ArrowUp', keyCode: 38 }); });
        }
        expect(atual()).toBe(0);
    });
});
