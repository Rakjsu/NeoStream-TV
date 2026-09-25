// @vitest-environment jsdom
//
// 📺 A grade de canais da TV ao vivo tinha a altura de um cabeçalho que não
// existe mais.
//
// `.livetv-content` era `height: calc(100vh - 200px)` sem padding no topo. Os
// 200px descontavam um cabeçalho EM FLUXO (busca + chips de categoria) que
// virou flutuante: hoje hambúrguer, busca e a barra 🧬📅📊🎲 são
// `position: absolute` sobre a página. Resultado, em 1080p:
//  - a 1ª fileira de canais nascia em y=0, EMBAIXO do hambúrguer, da busca e
//    da barra de filtros (top: 88px);
//  - com a ficha do canal aberta (em fluxo, ~380px) a grade era empurrada
//    para baixo mas mantinha a altura fixa; a página tem `overflow: hidden`,
//    então as últimas fileiras ficavam cortadas para sempre — nem rolando.
//
// O teste monta a PÁGINA DE VERDADE (só a API do provedor é falsa), injeta as
// folhas de verdade e confere o contrato de layout sobre o DOM que o
// LiveTV.tsx renderiza: quem está em fluxo dentro da página, onde o cabeçalho
// flutuante termina, onde a grade começa, se a altura dela é o que SOBRA e se
// ela termina acima da faixa de dicas. O jsdom não calcula layout, então os
// números saem do estilo computado (a medição em Chromium real está no PR).
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { Category, LiveStream } from '../types';
import { installFakeStorage } from '../testing/fakeStorage';
import { LiveTV } from './LiveTV';

const CATEGORIAS: Category[] = [{ category_id: '1', category_name: 'Teste', parent_id: 0 }];
const CANAIS = Array.from({ length: 40 }, (_, i) => ({
    num: i + 1,
    name: `Canal ${i + 1}`,
    stream_type: 'live',
    stream_id: 1000 + i,
    stream_icon: `logo-${i + 1}.png`,
    epg_channel_id: '',
    added: '',
    category_id: '1',
    custom_sid: '',
    tv_archive: 0,
    direct_source: '',
    tv_archive_duration: 0,
})) as unknown as LiveStream[];

// Só a rede é falsa. O resto do `api` (URLs, offset do provedor) é o de
// verdade — Object.create herda os métodos da instância real.
vi.mock('../services/api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../services/api')>();
    const api = Object.create(real.api) as typeof real.api;
    api.getLiveStreams = async () => CANAIS;
    api.getLiveCategories = async () => CATEGORIAS;
    api.getShortEpg = async () => ({ epg_listings: [] });
    api.getSimpleDataTable = async () => ({ epg_listings: [] });
    return { ...real, api };
});

/** Fator de altura de linha para estimar a altura de uma linha de texto/emoji. */
const ALTURA_DE_LINHA = 1.5;

function px(valor: string, oque: string): number {
    const v = valor.trim();
    if (v === '0') return 0;
    const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v);
    if (!m) throw new Error(`${oque}: esperava um valor em px, veio "${valor}"`);
    return Number(m[1]);
}

function unico(seletor: string): HTMLElement {
    const achados = document.querySelectorAll<HTMLElement>(seletor);
    expect(achados.length, `esperava exatamente 1 "${seletor}" na página`).toBe(1);
    return achados[0];
}

const estilo = (el: Element) => getComputedStyle(el);

/** Filhos diretos da página que ocupam espaço no fluxo (nem absolute nem fixed). */
function emFluxo(pagina: HTMLElement): string[] {
    return Array.from(pagina.children)
        .filter(el => {
            const pos = estilo(el).position;
            return pos !== 'absolute' && pos !== 'fixed';
        })
        .map(el => el.className);
}

/** Onde (em px, do topo da página) termina o cabeçalho flutuante. */
function fimDoCabecalhoFlutuante(): number {
    const hamburguer = estilo(unico('.livetv-page > .category-toggle-btn'));
    expect(hamburguer.position).toBe('absolute');
    const fimHamburguer = px(hamburguer.top, 'hambúrguer top') + px(hamburguer.height, 'hambúrguer height');

    const busca = estilo(unico('.livetv-page > .search-container'));
    expect(busca.position).toBe('absolute');
    const fimBusca = px(busca.top, 'busca top') + px(estilo(unico('.search-btn')).height, 'botão de busca height');

    const barra = estilo(unico('.livetv-page > .livetv-toolbar'));
    expect(barra.position).toBe('absolute');
    const botoes = Array.from(document.querySelectorAll('.livetv-toolbar .toolbar-btn'));
    expect(botoes.length).toBeGreaterThan(0);
    const alturaBotao = Math.max(...botoes.map(b => {
        const s = estilo(b);
        return px(s.paddingTop, 'toolbar padding-top') + px(s.paddingBottom, 'toolbar padding-bottom')
            + px(s.borderTopWidth, 'toolbar borda de cima') + px(s.borderBottomWidth, 'toolbar borda de baixo')
            + px(s.fontSize, 'toolbar font-size') * ALTURA_DE_LINHA;
    }));
    const fimBarra = px(barra.top, 'barra top') + alturaBotao;

    return Math.max(fimHamburguer, fimBusca, fimBarra);
}

/**
 * Quanto o card FOCADO sobe acima da própria caixa: o translateY negativo, o
 * que o scale cresce para cima e o anel de foco (sombra sem blur). A grade
 * tem overflow, então o que passar da borda de cima dela é cortado.
 */
function quantoOFocoSobe(card: Element): number {
    card.classList.add('tv-focused');
    try {
        const s = estilo(card);
        const transform = s.transform.trim();
        const semFuncoesConhecidas = transform.replace(/translateY\([^)]*\)|scale\([^)]*\)/g, '').trim();
        if (transform !== '' && transform !== 'none' && semFuncoesConhecidas !== '') {
            throw new Error(`transform do card focado fora do que o teste sabe medir: "${transform}"`);
        }
        const ty = /translateY\((-?\d+(?:\.\d+)?)px\)/.exec(transform);
        const subida = ty ? Math.max(0, -Number(ty[1])) : 0;
        const sc = /scale\((\d+(?:\.\d+)?)\)/.exec(transform);
        const escala = sc ? Number(sc[1]) : 1;
        const logo = card.querySelector('.channel-logo');
        if (!logo) throw new Error('card sem .channel-logo');
        const alturaDoCard = px(s.paddingTop, 'card padding-top') + px(s.paddingBottom, 'card padding-bottom')
            + px(s.borderTopWidth, 'card borda de cima') + px(s.borderBottomWidth, 'card borda de baixo')
            + px(estilo(logo).height, 'logo height');
        const crescimento = Math.max(0, escala - 1) * alturaDoCard / 2;
        // Anel = sombra sem blur; a que tem blur é brilho difuso, não o anel.
        const sombras = s.boxShadow.trim();
        const anel = sombras === '' || sombras === 'none' ? 0 : sombras.split(/,(?![^(]*\))/).reduce((maior, sombra) => {
            if (/\binset\b/.test(sombra)) return maior; // sombra interna não sai da caixa
            const medidas = sombra.replace(/(?:rgba?|hsla?)\([^)]*\)|#[0-9a-f]+|\b[a-z]+\b/gi, ' ')
                .trim().split(/\s+/).map(v => px(v, 'box-shadow do card focado'));
            const [, y = 0, blur = 0, espalha = 0] = medidas;
            return blur === 0 ? Math.max(maior, espalha - y) : maior;
        }, 0);
        return subida + crescimento + anel;
    } finally {
        card.classList.remove('tv-focused');
    }
}

beforeAll(() => {
    // O vitest não processa CSS: os `import './X.css'` viram módulo vazio.
    // Sem injetar as folhas de verdade não há cascade para medir — e o
    // caminho é relativo ao cwd (sob jsdom o import.meta.url é http).
    const folha = document.createElement('style');
    folha.textContent = [
        'src/components/CategoryMenu.css',
        'src/components/AnimatedSearchBar.css',
        'src/pages/LiveTV.css',
    ].map(f => readFileSync(f, 'utf8')).join('\n');
    document.head.appendChild(folha);

    // jsdom não implementa scrollIntoView/scrollTo; a página e o menu chamam.
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () { /* jsdom */ };
    if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function () { /* jsdom */ } as typeof Element.prototype.scrollTo;
});

afterEach(cleanup);

async function montarPagina(): Promise<HTMLElement> {
    installFakeStorage();
    render(<LiveTV />);
    await waitFor(() => expect(document.querySelectorAll('.channel-card').length).toBeGreaterThan(0));
    return unico('.livetv-page');
}

async function abrirFicha(): Promise<HTMLElement> {
    fireEvent.click(document.querySelectorAll('.channel-card')[0]);
    await waitFor(() => expect(document.querySelector('.channel-preview')).not.toBeNull());
    return unico('.livetv-page > .channel-preview');
}

describe('TV ao vivo: grade de canais x cabeçalho flutuante', () => {
    it('só a ficha e a grade ocupam fluxo na página — o resto flutua', async () => {
        const pagina = await montarPagina();
        expect(emFluxo(pagina)).toEqual(['livetv-content']);
        await abrirFicha();
        expect(emFluxo(pagina)).toEqual(['channel-preview', 'livetv-content']);
        // A faixa de dicas é fixa no rodapé (é dela que a grade desvia).
        expect(estilo(unico('.livetv-page > .livetv-hints')).position).toBe('fixed');
    });

    it('a 1ª fileira de canais começa ABAIXO do hambúrguer, da busca e da barra de filtros', async () => {
        const pagina = await montarPagina();
        const grade = unico('.livetv-page > .livetv-content');
        const topoDaGrade = px(estilo(pagina).paddingTop, 'página padding-top')
            + px(estilo(grade).marginTop, 'grade margin-top')
            + px(estilo(grade).paddingTop, 'grade padding-top');
        expect(topoDaGrade).toBeGreaterThanOrEqual(fimDoCabecalhoFlutuante());
    });

    it('o anel de foco da 1ª fileira não é cortado pela borda de cima da grade', async () => {
        // A grade rola (overflow), então corta o que passa da borda dela. O
        // card focado sobe (translateY + scale) e ganha um anel: sem folga no
        // topo da grade, a 1ª fileira focada aparece com o anel decepado.
        await montarPagina();
        const grade = unico('.livetv-page > .livetv-content');
        const card = grade.querySelector('.channel-card');
        if (!card) throw new Error('grade sem .channel-card');
        const folga = px(estilo(grade).paddingTop, 'grade padding-top')
            + px(estilo(unico('.livetv-content > .channels-grid')).paddingTop || '0', 'channels-grid padding-top');
        const sobe = quantoOFocoSobe(card);
        expect(sobe, 'a medição do foco zerou — o teste ficaria vazio').toBeGreaterThan(0);
        expect(folga).toBeGreaterThanOrEqual(sobe);
    });

    it('a ficha do canal (em fluxo) também começa abaixo do cabeçalho flutuante', async () => {
        const pagina = await montarPagina();
        const ficha = await abrirFicha();
        const topoDaFicha = px(estilo(pagina).paddingTop, 'página padding-top')
            + px(estilo(ficha).marginTop, 'ficha margin-top');
        expect(topoDaFicha).toBeGreaterThanOrEqual(fimDoCabecalhoFlutuante());
    });

    it('a altura da grade é o que SOBRA da página, com ou sem ficha — sem número mágico', async () => {
        const pagina = await montarPagina();
        const ficha = await abrirFicha();
        const grade = estilo(unico('.livetv-page > .livetv-content'));

        expect(estilo(pagina).display).toBe('flex');
        expect(estilo(pagina).flexDirection).toBe('column');
        expect(estilo(pagina).overflow).toBe('hidden');
        // A grade cresce até o fim e encolhe até caber: nenhuma altura fixa ou
        // calculada decide o tamanho dela (nem via height, nem via flex-basis).
        expect(Number(grade.flexGrow)).toBeGreaterThanOrEqual(1);
        expect(Number(grade.flexShrink)).toBeGreaterThanOrEqual(1);
        expect(['', 'auto', '0', '0px', '0%']).toContain(grade.flexBasis.trim());
        expect(['', 'auto']).toContain(grade.height.trim());
        // Sem min-height: 0 o item flex não encolhe abaixo do conteúdo e a
        // rolagem interna some (as últimas fileiras vazam pelo overflow).
        expect(px(grade.minHeight, 'grade min-height')).toBe(0);
        expect(grade.overflowY).toBe('auto');
        // Quem encolhe é a grade, nunca a ficha.
        expect(estilo(ficha).flexShrink).toBe('0');
    });

    it('a grade termina ACIMA da faixa de dicas (fixa no rodapé)', async () => {
        // O "rolar até o card focado" do LiveTV.tsx compara o card com a borda
        // de baixo da GRADE; se ela descer por trás das dicas, o card focado da
        // última fileira visível fica escondido atrás delas.
        const pagina = await montarPagina();
        const dicas = estilo(unico('.livetv-page > .livetv-hints'));
        expect(dicas.bottom).toBe('0px');
        const alturaDicas = px(dicas.paddingTop, 'dicas padding-top') + px(dicas.paddingBottom, 'dicas padding-bottom')
            + px(dicas.fontSize, 'dicas font-size') * ALTURA_DE_LINHA;
        const grade = unico('.livetv-page > .livetv-content');
        const folgaDeBaixo = px(estilo(pagina).paddingBottom, 'página padding-bottom')
            + px(estilo(grade).marginBottom, 'grade margin-bottom');
        expect(folgaDeBaixo).toBeGreaterThanOrEqual(alturaDicas);
    });
});
