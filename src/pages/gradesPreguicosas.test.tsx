// @vitest-environment jsdom
//
// 🖼️ As grades de Filmes, Séries e TV ao vivo baixavam TODAS as capas (T088).
//
// As capas tinham `loading="lazy"` (Filmes, Séries) ou nada (logos da TV ao
// vivo). O atributo só chegou no Chrome 76; no Tizen 5.5 (Chromium 69) ele é
// ignorado em silêncio: cada `<img>` que entra no DOM baixa e decodifica a
// imagem na hora. E a grade só CRESCE — `visibleCount` começa em ~24 e ganha
// fileiras a cada descida, nunca encolhe. Quem desce um catálogo de milhares
// de filmes acumula centenas de bitmaps decodificados (no tamanho ORIGINAL da
// imagem, não no do card) num heap de ~1 GB — o cenário que já fez o sistema
// matar o app.
//
// O teste monta as PÁGINAS DE VERDADE (só a rede do provedor é falsa) e troca o
// IntersectionObserver (Chrome 51, existe na TV) por um falso que ESTE arquivo
// controla. O contrato:
//  - nenhuma capa nasce antes de o observer dizer que o card entrou na janela
//    da grade que rola (`root` = o contêiner com overflow, não o viewport);
//  - UM observer por grade vigia todos os cards (não um por card);
//  - card que sai da janela DEVOLVE a imagem (o `<img>` sai do DOM) — é isso
//    que põe teto na memória de uma grade que só cresce;
//  - ao sair da página, nada fica vigiado e nenhum observer fica vivo.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor, fireEvent } from '@testing-library/react';
import type { RefObject } from 'react';
import { api } from '../services/api';
import { installFakeStorage } from '../testing/fakeStorage';
import type { VODStream, Series as SeriesType, LiveStream, Category } from '../types';
import { Movies } from './Movies';
import { Series } from './Series';
import { LiveTV } from './LiveTV';
import { PosterPreguicoso } from '../components/PosterPreguicoso';

// ---- IntersectionObserver falso ----------------------------------------
class ObserverFalso {
    static vivos = new Set<ObserverFalso>();
    readonly alvos = new Set<Element>();
    readonly root: Element | Document | null;
    readonly rootMargin: string;
    private readonly callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback, opcoes: IntersectionObserverInit = {}) {
        this.callback = callback;
        this.root = opcoes.root ?? null;
        this.rootMargin = opcoes.rootMargin ?? '0px';
        ObserverFalso.vivos.add(this);
    }
    observe(alvo: Element) { this.alvos.add(alvo); }
    unobserve(alvo: Element) { this.alvos.delete(alvo); }
    disconnect() { this.alvos.clear(); ObserverFalso.vivos.delete(this); }
    takeRecords(): IntersectionObserverEntry[] { return []; }
    /** O navegador avisando, num lote só, o estado de cada alvo dado. */
    avisar(alvos: Element[], dentro: boolean) {
        const entradas = alvos.map(alvo => ({
            target: alvo, isIntersecting: dentro, intersectionRatio: dentro ? 1 : 0, time: 0,
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
        }) as IntersectionObserverEntry);
        this.callback(entradas, this as unknown as IntersectionObserver);
    }
}

/** Quantos elementos ainda estão sendo vigiados, somando todos os observers. */
const vigiados = () => [...ObserverFalso.vivos].reduce((n, o) => n + o.alvos.size, 0);

/** Os cards dados entram (true) ou saem (false) da janela de quem os vigia. */
function mudarJanela(cards: Element[], dentro: boolean) {
    act(() => {
        for (const observer of [...ObserverFalso.vivos]) {
            const meus = cards.filter(c => observer.alvos.has(c));
            if (meus.length > 0) observer.avisar(meus, dentro);
        }
    });
}

/** O aviso inicial do navegador: logo depois do observe(), todo alvo, FORA. */
function avisoInicialForaDaTela() {
    act(() => {
        for (const observer of [...ObserverFalso.vivos]) observer.avisar([...observer.alvos], false);
    });
}

const capasCarregadas = (raiz: ParentNode) =>
    [...raiz.querySelectorAll('img')].filter(img => !!img.getAttribute('src'));

// ---- dados ------------------------------------------------------------
const CATEGORIAS: Category[] = [{ category_id: '1', category_name: 'Teste', parent_id: 0 }];
const TAMANHO = 200;

function filme(id: number): VODStream {
    return {
        num: id, name: `Filme ${id}`, stream_type: 'movie', stream_id: id,
        stream_icon: `http://img.test/filme-${id}.jpg`, container_extension: 'mp4',
        custom_sid: '', direct_source: '', added: '0', category_id: '1',
        rating: '', rating_5based: 0, backdrop_path: [], youtube_trailer: '',
        episode_run_time: '', cover: '', plot: '', cast: '',
    } as unknown as VODStream;
}

function serie(id: number): SeriesType {
    return {
        num: id, name: `Serie ${id}`, series_id: id, cover: `http://img.test/serie-${id}.jpg`,
        plot: '', cast: '', director: '', genre: '', release_date: '', last_modified: '0',
        rating: '', rating_5based: 0, backdrop_path: [], youtube_trailer: '',
        episode_run_time: '', category_id: '1', tmdb_id: '',
    };
}

function canal(id: number): LiveStream {
    return {
        num: id, name: `Canal ${id}`, stream_type: 'live', stream_id: id,
        stream_icon: `http://img.test/canal-${id}.png`, epg_channel_id: '', added: '',
        category_id: '1', custom_sid: '', tv_archive: 0, direct_source: '', tv_archive_duration: 0,
    };
}

const lista = <T,>(fazer: (id: number) => T) => Array.from({ length: TAMANHO }, (_, i) => fazer(i + 1));

// ---- montagem ---------------------------------------------------------
let observerOriginal: unknown;
beforeAll(() => {
    // jsdom não implementa scrollIntoView/scrollTo, e as páginas chamam
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () { /* jsdom */ };
    if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function () { /* jsdom */ } as typeof Element.prototype.scrollTo;
    observerOriginal = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

beforeEach(() => {
    installFakeStorage();
    sessionStorage.clear();
    ObserverFalso.vivos.clear();
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = ObserverFalso;
    vi.spyOn(api, 'getVODStreams').mockResolvedValue(lista(filme));
    vi.spyOn(api, 'getVodCategories').mockResolvedValue(CATEGORIAS);
    vi.spyOn(api, 'getSeries').mockResolvedValue(lista(serie));
    vi.spyOn(api, 'getSeriesCategories').mockResolvedValue(CATEGORIAS);
    vi.spyOn(api, 'getLiveStreams').mockResolvedValue(lista(canal));
    vi.spyOn(api, 'getLiveCategories').mockResolvedValue(CATEGORIAS);
    vi.spyOn(api, 'getShortEpg').mockResolvedValue({ epg_listings: [] });
    vi.spyOn(api, 'getSimpleDataTable').mockResolvedValue({ epg_listings: [] });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = observerOriginal;
});

interface Grade {
    nome: string;
    montar: () => ReturnType<typeof render>;
    /** Contêiner que ROLA — tem de ser a `root` do observer. */
    rolagem: string;
    /** A moldura da capa dentro de cada card (é ela que o observer vigia). */
    moldura: string;
    /** O src que a capa do card de título `titulo` deve ter. */
    capaDe: (titulo: string) => string;
    titulo: string;
    /** O que a moldura mostra quando a capa falha. */
    placeholder: string;
}

const GRADES: Grade[] = [
    {
        nome: 'Filmes', montar: () => render(<Movies />),
        rolagem: '.movies-content', moldura: '.movie-card .movie-poster', titulo: '.movie-title',
        capaDe: t => `http://img.test/filme-${t.replace('Filme ', '')}.jpg`,
        placeholder: '.poster-placeholder',
    },
    {
        nome: 'Séries', montar: () => render(<Series />),
        rolagem: '.series-content', moldura: '.series-card .series-poster', titulo: '.series-title',
        capaDe: t => `http://img.test/serie-${t.replace('Serie ', '')}.jpg`,
        placeholder: '.poster-placeholder',
    },
    {
        nome: 'TV ao vivo', montar: () => render(<LiveTV />),
        rolagem: '.livetv-content', moldura: '.channel-card .channel-logo', titulo: '.channel-name',
        capaDe: t => `http://img.test/canal-${t.replace('Canal ', '')}.png`,
        placeholder: '.channel-placeholder',
    },
];

/** As molduras que estão no DOM AGORA (a grade recalcula o tamanho ao carregar). */
const moldurasDe = (grade: Grade) => [...document.querySelectorAll(grade.moldura)];

/** Monta a página e espera a CONDIÇÃO: cards na tela. */
async function abrir(grade: Grade) {
    const pagina = grade.montar();
    await waitFor(() => expect(moldurasDe(grade).length).toBeGreaterThan(0));
    return pagina;
}

/**
 * Espera a CONDIÇÃO "cada card na tela está vigiado". A página recalcula
 * `visibleCount` num efeito logo depois de carregar (a grade pode encolher),
 * então a conta é contra o DOM de agora, nunca contra uma lista guardada.
 */
async function esperarVigia(grade: Grade) {
    await waitFor(() => {
        const n = moldurasDe(grade).length;
        expect(n).toBeGreaterThan(0);
        expect(vigiados()).toBe(n);
    });
}

/** O título do card que contém `moldura` (pra saber qual capa ela deve ter). */
function tituloDoCard(grade: Grade, moldura: Element): string {
    const card = moldura.parentElement!;
    const el = card.querySelector(grade.titulo);
    if (!el) throw new Error(`card sem "${grade.titulo}" — o teste não sabe qual capa esperar`);
    return (el.textContent || '').trim();
}

describe.each(GRADES)('$nome: capas só baixam quando o card entra na janela da grade', (grade) => {
    it('nenhuma capa nasce antes do aviso do observer; UM observer vigia a grade inteira', async () => {
        await abrir(grade);

        // Antes: cada card já nascia com o <img src> (24+ downloads de uma vez)
        expect(capasCarregadas(document), 'capa baixada antes de o card aparecer').toHaveLength(0);

        // O observer nasce num efeito: espera a CONDIÇÃO, não um número de voltas
        await esperarVigia(grade);
        expect(ObserverFalso.vivos.size, 'um observer por card não escala numa grade de milhares').toBe(1);
        const [observer] = [...ObserverFalso.vivos];
        // A raiz é o contêiner que rola: contra o viewport, a margem não
        // anteciparia a próxima fileira (o overflow do contêiner a corta).
        expect(observer.root).toBe(document.querySelector(grade.rolagem));
        // E pede um pouco ANTES de aparecer (fileira seguinte já a caminho)
        expect(parseFloat(observer.rootMargin)).toBeGreaterThan(0);

        // O navegador avisa todo alvo logo após o observe(), os de fora também
        avisoInicialForaDaTela();
        expect(capasCarregadas(document)).toHaveLength(0);
    });

    it('card que entra ganha a capa certa; card que SAI devolve a imagem', async () => {
        await abrir(grade);
        await esperarVigia(grade);
        avisoInicialForaDaTela();

        const primeiras = moldurasDe(grade).slice(0, 6);
        mudarJanela(primeiras, true);
        const carregadas = capasCarregadas(document);
        expect(carregadas).toHaveLength(6);
        for (const moldura of primeiras) {
            const img = moldura.querySelector(':scope > img');
            expect(img, 'a capa é filha DIRETA da moldura (o fallback de aspect-ratio depende disso)').not.toBeNull();
            expect(img!.getAttribute('src')).toBe(grade.capaDe(tituloDoCard(grade, moldura)));
            // O resto do <img> de antes continua: nome pro leitor de tela, decodificação fora da thread
            expect(img!.getAttribute('alt')).toBe(tituloDoCard(grade, moldura));
            expect(img!.getAttribute('decoding')).toBe('async');
        }

        // Rolou pra baixo: as 3 primeiras saíram da janela (+ margem)
        mudarJanela(primeiras.slice(0, 3), false);
        expect(capasCarregadas(document)).toHaveLength(3);
        for (const moldura of primeiras.slice(0, 3)) {
            expect(moldura.querySelector('img'), 'card fora da janela segurando o bitmap').toBeNull();
        }
        // ...e continuam vigiadas: voltar pra cima traz a capa de novo
        expect(vigiados()).toBe(moldurasDe(grade).length);
        mudarJanela(primeiras.slice(0, 1), true);
        expect(capasCarregadas(document)).toHaveLength(4);
    });

    it('sair da página desliga tudo: nenhum card vigiado, nenhum observer vivo', async () => {
        const pagina = await abrir(grade);
        await esperarVigia(grade);

        pagina.unmount();

        expect(vigiados()).toBe(0);
        expect(ObserverFalso.vivos.size).toBe(0);
    });
});

describe('capa quebrada e navegador sem IntersectionObserver', () => {
    it.each(GRADES)('$nome: capa que falha vira o placeholder e o card para de ser vigiado', async (grade) => {
        await abrir(grade);
        await esperarVigia(grade);
        const [quebrada, vizinha] = moldurasDe(grade);
        mudarJanela([quebrada, vizinha], true);

        const img = quebrada.querySelector('img')!;
        act(() => { fireEvent.error(img); });

        // A TV ao vivo junta os logos quebrados numa janela curta antes de
        // repintar (T012): espera a CONDICAO, nao o mesmo tique.
        await waitFor(() => {
            expect(quebrada.querySelector('img')).toBeNull();
            expect(quebrada.querySelector(`:scope > ${grade.placeholder}`)).not.toBeNull();
            // Nada a baixar ali: o observer larga o card (num efeito, depois do repaint)
            expect(vigiados()).toBe(moldurasDe(grade).length - 1);
            expect([...ObserverFalso.vivos][0].alvos.has(quebrada)).toBe(false);
        }, { timeout: 3000 });
        // O vizinho não foi afetado
        expect(vizinha.querySelector('img')).not.toBeNull();
    });

    it.each(GRADES)('$nome: sem IntersectionObserver carrega na hora, como antes (nunca fica sem capa)', async (grade) => {
        delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
        await abrir(grade);
        await waitFor(() => expect(capasCarregadas(document)).toHaveLength(moldurasDe(grade).length));
        for (const moldura of moldurasDe(grade)) {
            expect(moldura.querySelector(':scope > img')!.getAttribute('src'))
                .toBe(grade.capaDe(tituloDoCard(grade, moldura)));
        }
    });
});

describe('PosterPreguicoso: o observer compartilhado', () => {
    function Grade({ raiz, n }: { raiz: RefObject<Element | null>; n: number }) {
        return (
            <>
                {Array.from({ length: n }, (_, i) => (
                    <PosterPreguicoso key={i} className="moldura" src={`http://img.test/${i}.jpg`} alt="" raiz={raiz} />
                ))}
            </>
        );
    }

    it('grade que esvazia desliga e ESQUECE o observer: a próxima, na mesma raiz, ganha um novo', () => {
        // O caso real: filtro sem resultado desmonta todos os cards, mas o
        // contêiner que rola (a raiz) continua o mesmo elemento.
        const raiz = { current: document.createElement('div') };
        const { container, rerender } = render(<Grade raiz={raiz} n={3} />);
        expect(ObserverFalso.vivos.size).toBe(1);
        const [primeiro] = [...ObserverFalso.vivos];
        expect(primeiro.root).toBe(raiz.current);
        expect(primeiro.alvos.size).toBe(3);

        rerender(<Grade raiz={raiz} n={0} />);
        expect(ObserverFalso.vivos.size, 'observer vivo sem ninguém pra vigiar').toBe(0);

        rerender(<Grade raiz={raiz} n={2} />);
        expect(ObserverFalso.vivos.size).toBe(1);
        const [segundo] = [...ObserverFalso.vivos];
        expect(segundo, 'reusou o observer já desligado').not.toBe(primeiro);
        expect(segundo.root).toBe(raiz.current);
        expect(segundo.alvos.size).toBe(2);
        // ...e ele funciona: quem entra na janela ganha a capa
        mudarJanela([...container.querySelectorAll('.moldura')], true);
        expect(capasCarregadas(container)).toHaveLength(2);
    });

    it('grade que ENCOLHE para 1 card mantém o observer: o card que sobrou ainda ganha a capa', () => {
        // O caso real: filtro com um resultado só. O observer só pode morrer
        // quando o ÚLTIMO card sai — não quando sobra um.
        const raiz = { current: document.createElement('div') };
        const { container, rerender } = render(<Grade raiz={raiz} n={3} />);
        const [observer] = [...ObserverFalso.vivos];

        rerender(<Grade raiz={raiz} n={1} />);
        expect(ObserverFalso.vivos.size, 'desligou o observer com um card ainda na grade').toBe(1);
        expect([...ObserverFalso.vivos][0]).toBe(observer);
        expect(observer.alvos.size).toBe(1);

        mudarJanela([...container.querySelectorAll('.moldura')], true);
        expect(capasCarregadas(container), 'o card que sobrou ficou sem capa').toHaveLength(1);
    });
});

// Execução: npx vitest run src/pages/gradesPreguicosas.test.tsx
