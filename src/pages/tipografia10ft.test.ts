// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Piso tipográfico de 10-foot UI nas três telas em que a pessoa LÊ para
 * escolher: Home, Minha Lista e a ficha (ContentDetailModal).
 *
 * O teste mede o que a TV pinta, não o que a folha declara: TODAS as folhas de
 * `src/` entram no documento e o tamanho sai do `getComputedStyle` do jsdom,
 * que resolve cascata e especificidade. Isso importa porque as classes são
 * globais — `.card-title` existe em Home, Favoritos e Minha Lista, e
 * `.meta-badge` em Filmes, Séries e na ficha — e a folha que entra DEPOIS no
 * bundle ganha. Por isso cada checagem roda nas duas ordens: o piso não pode
 * depender da ordem em que o Vite concatena o CSS.
 *
 * A marcação abaixo é a MESMA hierarquia de classes do JSX de cada tela
 * (Home.tsx, MyList.tsx, ContentDetailModal.tsx), só com o necessário para as
 * regras casarem.
 */

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function folhasDeEstilo(dir: string): string[] {
    return readdirSync(dir).flatMap(nome => {
        const completo = path.join(dir, nome);
        if (statSync(completo).isDirectory()) return folhasDeEstilo(completo);
        return nome.endsWith('.css') ? [completo] : [];
    }).sort();
}

const FOLHAS = folhasDeEstilo(SRC);

/** Texto de leitura: 18px. Selo, contagem e apoio: 16px. */
const LEITURA = 18;
const SELO = 16;

/**
 * O jsdom não faz layout, então largura de texto sai de uma estimativa:
 * a letra média de uma sans latina mede ~0,5em (medido no Chromium:
 * "Configurações" a 18px = 116px, "Surpreenda-me" = 125px). 0,55em deixa
 * folga para a fonte da TV.
 */
const LETRA_EM = 0.55;

const HOME = `
<div class="home-page">
  <header class="home-header"><div class="home-header-left">
    <div class="home-date">quinta-feira, 25 de setembro</div>
  </div></header>
  <section class="home-stats">
    <button class="stat-card stat-card-live"><div class="stat-label">Canais</div></button>
  </section>
  <section class="home-content"><div class="content-section">
    <div class="content-row">
      <button class="content-card">
        <div class="card-image card-image-poster"></div>
        <div class="card-title">Um Filme de Nome Comprido<span class="continue-episode"> · T1 E2</span></div>
      </button>
      <button class="content-card top10-card">
        <span class="top10-rank">1</span>
        <div class="card-image card-image-poster"></div>
        <div class="card-title">Outro Filme</div>
      </button>
    </div>
  </div></section>
  <section class="home-quick-access"><div class="quick-grid">
    <button class="quick-item"><span class="quick-icon"></span><span class="quick-label">Configurações</span></button>
    <button class="quick-item"><span class="quick-icon"></span><span class="quick-label">Surpreenda-me</span></button>
  </div></section>
  <footer class="home-footer"><span>NeoStream TV</span></footer>
</div>`;

const MINHA_LISTA = `
<div class="mylist-page">
  <div class="tabs-container">
    <button class="tab active"><span>Todos</span><span class="tab-count">12</span></button>
  </div>
  <div class="cards-grid">
    <div class="card">
      <div class="card-poster"></div>
      <div class="card-info">
        <h3 class="card-title">Um Filme</h3>
        <div class="card-meta"><span>Filme</span><span>2021</span></div>
      </div>
    </div>
  </div>
  <div class="mylist-hints"><span>OK Selecionar</span><span class="hint-red">🔴 Remover</span></div>
</div>`;

const FICHA = `
<div class="modal-backdrop"><div class="modal-container"><div class="modal-content">
  <div class="modal-meta">
    <span class="meta-badge rating-badge"><span class="star">★</span>7.8</span>
    <span class="meta-badge">1h 58min</span>
  </div>
  <div class="modal-genres"><span class="genre-tag">Drama</span></div>
  <div class="modal-cast"><div class="cast-row"><div class="cast-card">
    <span class="cast-photo"></span>
    <span class="cast-name">Fulano de Tal</span>
    <span class="cast-character">Personagem</span>
  </div></div></div>
  <div class="modal-saga"><div class="saga-row">
    <button class="saga-card"><span class="saga-poster"></span><span class="saga-name">Outro Filme da Saga</span></button>
  </div></div>
  <div class="season-tabs"><button class="season-tab active">T1</button></div>
  <div class="episode-list">
    <div class="episode-item">
      <span class="episode-number default">1</span>
      <span class="episode-text"><span class="episode-title">Piloto</span></span>
    </div>
  </div>
</div></div></div>`;

/** [tela, seletor dentro da tela, piso em px] */
const PISOS: Array<[string, string, number]> = [
    ['home', '.home-page .content-card .card-title', LEITURA],
    ['home', '.home-page .stat-label', LEITURA],
    ['home', '.home-page .quick-label', LEITURA],
    ['home', '.home-page .continue-episode', SELO],
    ['home', '.home-page .home-date', SELO],
    ['home', '.home-page .home-footer', SELO],
    ['minha lista', '.mylist-page .card-info .card-title', LEITURA],
    ['minha lista', '.mylist-page .mylist-hints span', LEITURA],
    ['minha lista', '.mylist-page .tab-count', SELO],
    ['minha lista', '.mylist-page .card-meta', SELO],
    ['ficha', '.modal-content .episode-title', LEITURA],
    ['ficha', '.modal-content .saga-name', LEITURA],
    ['ficha', '.modal-content .cast-name', LEITURA],
    ['ficha', '.modal-content .meta-badge', SELO],
    ['ficha', '.modal-content .meta-badge.rating-badge', SELO],
    ['ficha', '.modal-content .genre-tag', SELO],
    ['ficha', '.modal-content .season-tab', SELO],
    ['ficha', '.modal-content .episode-number', SELO],
    ['ficha', '.modal-content .cast-character', SELO],
];

const TELAS: Record<string, string> = { home: HOME, 'minha lista': MINHA_LISTA, ficha: FICHA };

let estilos: HTMLStyleElement[] = [];

/** Troca as folhas do documento. Folha que o jsdom não entende falha ALTO. */
function carregarFolhas(ordem: string[]): void {
    for (const s of estilos) s.remove();
    estilos = ordem.map(caminho => {
        const el = document.createElement('style');
        el.textContent = readFileSync(caminho, 'utf-8');
        document.head.appendChild(el);
        const regras = el.sheet?.cssRules.length ?? 0;
        if (regras === 0) {
            throw new Error(`o jsdom não leu ${path.relative(SRC, caminho)} — o teste estaria medindo sem ela`);
        }
        return el;
    });
}

/** font-size resolvido em px (herança, em, % e rem incluídos). */
function tamanhoEmPx(el: Element): number {
    const valor = getComputedStyle(el).fontSize.trim();
    const doPai = () => (el.parentElement ? tamanhoEmPx(el.parentElement) : 16);
    if (valor === '' || valor === 'inherit') return doPai();
    if (valor === 'medium') return 16;
    const m = /^(\d*\.?\d+)(px|em|%|rem)$/.exec(valor);
    if (!m) throw new Error(`font-size que o teste não sabe resolver: "${valor}" em .${el.className}`);
    const n = Number(m[1]);
    if (m[2] === 'px') return n;
    if (m[2] === 'em') return n * doPai();
    if (m[2] === '%') return (n / 100) * doPai();
    return n * 16;
}

/** line-height resolvido em px (unitário ou px). */
function alturaDeLinhaEmPx(el: Element): number {
    const valor = getComputedStyle(el).lineHeight.trim();
    const fonte = tamanhoEmPx(el);
    if (/^\d*\.?\d+$/.test(valor)) return Number(valor) * fonte;
    const m = /^(\d*\.?\d+)px$/.exec(valor);
    if (m) return Number(m[1]);
    throw new Error(`line-height que o teste não sabe resolver: "${valor}" em .${el.className}`);
}

function px(valor: string): number {
    const m = /^(\d*\.?\d+)px$/.exec(valor.trim());
    if (!m) throw new Error(`esperava um valor em px, veio "${valor}"`);
    return Number(m[1]);
}

function montar(tela: string): void {
    document.body.innerHTML = TELAS[tela];
}

function elemento(seletor: string): Element {
    const el = document.querySelector(seletor);
    if (!el) throw new Error(`a marcação do teste não tem ${seletor}`);
    return el;
}

const ORDENS: Array<[string, string[]]> = [
    ['ordem alfabética', FOLHAS],
    ['ordem invertida', [...FOLHAS].reverse()],
];

describe.each(ORDENS)('piso de 10-foot nas três telas (%s)', (_nome, ordem) => {
    beforeAll(() => carregarFolhas(ordem));
    afterAll(() => {
        for (const s of estilos) s.remove();
        estilos = [];
        document.body.innerHTML = '';
    });

    it.each(PISOS)('%s: %s tem pelo menos %ipx', (tela, seletor, piso) => {
        montar(tela);
        expect(tamanhoEmPx(elemento(seletor))).toBeGreaterThanOrEqual(piso);
    });

    // O título do pôster da Home tem duas linhas em altura fixa: uma linha só
    // cortava "Homem-Aranha: Sem Volta Para Casa" em duas palavras e
    // reticências, e sem a altura fixa os cards da fileira desalinhavam.
    it('home: o título do pôster quebra linha e a caixa comporta duas', () => {
        montar('home');
        const titulo = elemento('.home-page .content-card .card-title');
        const estilo = getComputedStyle(titulo);
        expect(estilo.whiteSpace).not.toBe('nowrap');
        const duasLinhas = 2 * alturaDeLinhaEmPx(titulo) + px(estilo.paddingTop) + px(estilo.paddingBottom);
        expect(px(estilo.height)).toBeGreaterThanOrEqual(duasLinhas);
    });

    // A caixa corta no padding, não no conteúdo: sem o clamp a terceira linha
    // de um nome comprido aparece pela metade nos 10px de baixo.
    it('home: o título do pôster para na segunda linha', () => {
        montar('home');
        const estilo = getComputedStyle(elemento('.home-page .content-card .card-title'));
        expect(estilo.display).toBe('-webkit-box');
        expect(estilo.getPropertyValue('-webkit-box-orient')).toBe('vertical');
        expect(estilo.getPropertyValue('-webkit-line-clamp')).toBe('2');
    });

    // Com white-space normal a quebra só acontece entre palavras: uma palavra
    // mais larga que a linha (a 18px, num card de 180px úteis ou de 92px no
    // elenco) vaza e some no overflow:hidden em vez de descer de linha.
    it.each([
        ['home', '.home-page .content-card .card-title'],
        ['ficha', '.modal-content .saga-name'],
        ['ficha', '.modal-content .cast-name'],
        ['ficha', '.modal-content .cast-character'],
    ])('%s: palavra mais larga que a linha em %s quebra em vez de sumir', (tela, seletor) => {
        montar(tela);
        expect(getComputedStyle(elemento(seletor)).overflowWrap).toBe('break-word');
    });

    // A margem negativa da fileira existe só para devolver o padding que dá
    // espaço ao scale() do foco: se as duas não andam juntas, a fileira inteira
    // sai do alinhamento com o título da seção.
    it('home: a margem negativa da fileira devolve o padding', () => {
        montar('home');
        const fileira = getComputedStyle(elemento('.home-page .content-row'));
        expect(fileira.marginTop).toBe(`-${fileira.paddingTop}`);
        expect(fileira.marginLeft).toBe(`-${fileira.paddingLeft}`);
        expect(fileira.marginRight).toBe(`-${fileira.paddingRight}`);
    });

    // O número do Top 10 é posicionado a partir do FUNDO do card, e o fundo é
    // o título: se a caixa do título cresce e o número não sobe junto, o "1"
    // pousa em cima das primeiras letras do nome do filme.
    it('home: o número do Top 10 fica acima da linha do título', () => {
        montar('home');
        const rank = elemento('.home-page .top10-card .top10-rank');
        const titulo = getComputedStyle(elemento('.home-page .top10-card .card-title'));
        const topoDoTexto = px(titulo.marginBottom) + px(titulo.height) - px(titulo.paddingTop);
        expect(px(getComputedStyle(rank).bottom)).toBeGreaterThanOrEqual(topoDoTexto);
    });

    // Com o card maior, o scale() do foco cresce mais pra cada lado: a fileira
    // rola (overflow-x), então corta no padding — a borda de foco sumiria.
    it('home: o padding da fileira comporta o card focado crescido', () => {
        montar('home');
        const card = elemento('.home-page .content-card');
        card.classList.add('tv-focused');
        const c = getComputedStyle(card);
        const escala = /scale\((\d*\.?\d+)\)/.exec(c.transform);
        if (!escala) throw new Error(`o card focado não tem scale(): "${c.transform}"`);
        const poster = getComputedStyle(elemento('.home-page .content-card .card-image-poster'));
        const titulo = getComputedStyle(elemento('.home-page .content-card .card-title'));
        const altura = px(c.borderTopWidth) + px(poster.height) + px(titulo.marginTop) + px(titulo.height)
            + px(titulo.marginBottom) + px(c.borderBottomWidth);
        const cresce = (Number(escala[1]) - 1) / 2;
        const fileira = getComputedStyle(elemento('.home-page .content-row'));
        expect(px(fileira.paddingTop)).toBeGreaterThanOrEqual(altura * cresce);
        expect(px(fileira.paddingBottom)).toBeGreaterThanOrEqual(altura * cresce);
        expect(px(fileira.paddingLeft)).toBeGreaterThanOrEqual(px(c.width) * cresce);
    });

    // Título de 18px num card de 160 mostrava ~13 letras por linha.
    it('home: o título do pôster tem largura para 16 letras por linha', () => {
        montar('home');
        const c = getComputedStyle(elemento('.home-page .content-card'));
        const titulo = elemento('.home-page .content-card .card-title');
        const t = getComputedStyle(titulo);
        const util = px(c.width) - px(c.borderLeftWidth) - px(c.borderRightWidth)
            - px(t.paddingLeft) - px(t.paddingRight);
        expect(util / (LETRA_EM * tamanhoEmPx(titulo))).toBeGreaterThanOrEqual(16);
    });

    // O pôster acompanha a largura (4:5, como o 160x200 de antes): alargar o
    // card sem subir a altura achatava a capa.
    it('home: o pôster mantém a proporção 4:5 do card', () => {
        montar('home');
        const c = getComputedStyle(elemento('.home-page .content-card'));
        const largura = px(c.width) - px(c.borderLeftWidth) - px(c.borderRightWidth);
        const poster = getComputedStyle(elemento('.home-page .content-card .card-image-poster'));
        expect(largura / px(poster.height)).toBeCloseTo(0.8, 1);
    });

    // A grade tem 6 colunas iguais dentro do max-width: com 720px a célula
    // dava 110px e "Configurações" não cabia nem a 12px.
    it('home: cada célula do acesso rápido comporta o rótulo mais comprido', () => {
        montar('home');
        const grade = getComputedStyle(elemento('.home-page .quick-grid'));
        const colunas = /repeat\((\d+),/.exec(grade.gridTemplateColumns);
        if (!colunas) throw new Error(`grade do acesso rápido fora do molde: "${grade.gridTemplateColumns}"`);
        const n = Number(colunas[1]);
        // o jsdom não desdobra o atalho `gap` em column-gap
        const vao = px([grade.getPropertyValue('column-gap'), grade.getPropertyValue('gap')]
            .find(v => /px$/.test(v.trim())) ?? 'sem gap em px');
        const item = getComputedStyle(elemento('.home-page .quick-item'));
        const celula = (px(grade.maxWidth) - (n - 1) * vao) / n
            - px(item.paddingLeft) - px(item.paddingRight) - px(item.borderLeftWidth) - px(item.borderRightWidth);
        const rotulos = Array.from(document.querySelectorAll('.home-page .quick-label'));
        const maior = Math.max(...rotulos.map(r => (r.textContent ?? '').length * LETRA_EM * tamanhoEmPx(r)));
        expect(celula).toBeGreaterThanOrEqual(maior);
    });

    // `left: 50%` limita a caixa à metade direita da tela (960px): a 18px as
    // seis legendas passavam disso e a barra quebrava em duas linhas.
    it('minha lista: a barra de legendas não fica presa à metade da tela', () => {
        montar('minha lista');
        const barra = getComputedStyle(elemento('.mylist-page .mylist-hints'));
        expect(barra.left).toBe('50%');
        expect(barra.width).toBe('max-content');
        // max-content sozinho não tem teto: com a escala de texto em 125%/150%
        // a barra passaria da borda da tela.
        expect(barra.maxWidth).toMatch(/--ns-vw/);
    });

    // Nome da saga e do elenco são cortados por max-height: subir a fonte sem
    // subir o teto deixava uma linha e meia à mostra.
    it.each([
        ['.modal-content .saga-name'],
        ['.modal-content .cast-name'],
        ['.modal-content .cast-character'],
    ])('ficha: o teto de %s comporta duas linhas inteiras', (seletor) => {
        montar('ficha');
        const el = elemento(seletor);
        expect(px(getComputedStyle(el).maxHeight)).toBeGreaterThanOrEqual(2 * alturaDeLinhaEmPx(el) - 0.5);
    });
});

/**
 * Nenhuma regra das três folhas volta para 12–13px. O ícone ▶ dentro do
 * círculo de 26px do episódio é desenho, não texto — é a única exceção.
 */
describe('as três folhas não têm texto abaixo de 14px', () => {
    const TRES = [
        path.join(SRC, 'pages', 'Home.css'),
        path.join(SRC, 'pages', 'MyList.css'),
        path.join(SRC, 'components', 'ContentDetailModal.css'),
    ];
    const EXCECOES = new Set(['.episode-play-indicator']);

    it.each(TRES.map(f => [path.relative(SRC, f).replace(/\\/g, '/'), f]))('%s', (_nome, arquivo) => {
        const texto = readFileSync(arquivo, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
        const pequenos: string[] = [];
        for (const m of texto.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
            const seletor = m[1].trim().replace(/\s+/g, ' ');
            if (EXCECOES.has(seletor)) continue;
            for (const d of m[2].matchAll(/font-size\s*:\s*(\d*\.?\d+)(px|em)/g)) {
                const n = Number(d[1]);
                if ((d[2] === 'px' && n < 14) || (d[2] === 'em' && n < 1)) {
                    pequenos.push(`${seletor} → ${d[1]}${d[2]}`);
                }
            }
        }
        expect(pequenos).toEqual([]);
    });
});
