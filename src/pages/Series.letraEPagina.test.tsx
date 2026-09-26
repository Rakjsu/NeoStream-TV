// @vitest-environment jsdom
//
// 🔤 Séries não tinha barra A-Z nem salto de página CH± (T023).
//
// Filmes resolveu o "catálogo de milhares de títulos" com duas ferramentas —
// a barra A-Z (que FILTRA a grade pela letra) e CH+/CH− pulando uma página —
// e Séries, a tela gêmea, ficou só com o ↓ de seis em seis: chegar à letra M
// eram centenas de toques. O CSS da barra já estava em Series.css, sem JSX.
//
// Aqui roda a página DE VERDADE (Series + useTVNavigation) e as teclas saem
// como a TV manda: `key` 'Unidentified' e o keyCode verdadeiro. Só a ficha e
// o player viram botões: o que se prova é o que a PÁGINA faz quando o player
// fecha, não o player.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { api } from '../services/api';
import { progressService } from '../services/progressService';
import type { Series as SeriesType, Category } from '../types';
import { Series } from './Series';

vi.mock('../components/ContentDetailModal', async () => {
    const { createElement } = await import('react');
    return {
        ContentDetailModal: ({ isOpen, onPlay }: { isOpen: boolean; onPlay: (temporada: number, episodio: number) => void }) =>
            isOpen ? createElement('button', { className: 'stub-assistir', onClick: () => onPlay(1, 1) }, 'Assistir') : null,
    };
});
vi.mock('../components/SeriesQueuePlayer', async () => {
    const { createElement } = await import('react');
    return {
        SeriesQueuePlayer: ({ onClose }: { onClose: () => void }) =>
            createElement('button', { className: 'stub-fechar-player', onClick: onClose }, 'Fechar'),
    };
});
// A tela monta a fila por montarFilaOuAviso (T135), que chama o
// buildEpisodeQueue ORIGINAL de dentro do módulo: dublar só ele não basta
vi.mock('../services/seriesPlayback', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../services/seriesPlayback')>()),
    buildEpisodeQueue: async () => ({}),
    montarFilaOuAviso: async () => ({ fila: {}, aviso: null }),
}));

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const POR_LETRA = 4;

function serie(id: number, nome: string): SeriesType {
    return {
        num: id,
        name: nome,
        series_id: id,
        cover: 'capa.jpg', // src vazio faz o React reclamar no console
        plot: '',
        cast: '',
        director: '',
        genre: '',
        // Década 2020 (a primeira do ciclo): ligar a década não esvazia a grade
        release_date: '2021-01-01',
        last_modified: '0',
        rating: '9',
        // Nota alta: ligar "nota mínima" não pode esvaziar a grade no teste
        rating_5based: 4.5,
        backdrop_path: [],
        youtube_trailer: '',
        episode_run_time: '',
        category_id: '1',
        tmdb_id: '',
    };
}

/** Uma série que começa com dígito (vai pro "#") e POR_LETRA por letra. */
function catalogo(): SeriesType[] {
    const lista: SeriesType[] = [serie(1, '1 Numero Primeiro')];
    let id = 2;
    for (const letra of LETRAS) {
        for (let i = 1; i <= POR_LETRA; i++) lista.push(serie(id++, `${letra}serie ${i}`));
    }
    return lista;
}
const TOTAL = catalogo().length;
const idDe = (nome: string) => String(catalogo().find(s => s.name === nome)!.series_id);

// O nome da categoria dá o gênero (catalogGenres): liga o botão de gênero
const categorias: Category[] = [{ category_id: '1', category_name: 'Séries Comédia', parent_id: 0 } as Category];

/** Tecla como a TV manda: `key` inútil, keyCode verdadeiro. */
function tecla(keyCode: number): KeyboardEvent {
    const evento = new KeyboardEvent('keydown', { key: 'Unidentified', keyCode, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(evento); });
    return evento;
}
const esquerda = () => tecla(37);
const cima = () => tecla(38);
const direita = () => tecla(39);
const baixo = () => tecla(40);
const ok = () => tecla(13);
const voltar = () => tecla(10009);
const amarelo = () => tecla(405);
const chMais = () => tecla(427);
const chMenos = () => tecla(428);

const titulos = () => Array.from(document.querySelectorAll('.series-title')).map(el => el.textContent || '');
const tituloFocado = () => document.querySelector('.series-card.tv-focused .series-title')?.textContent ?? null;
const letraFocada = () => document.querySelector('.alphabet-letter.tv-focused')?.textContent ?? null;
const letraAtiva = () => document.querySelector('.alphabet-letter.active')?.textContent ?? null;

/** Nome da série na posição `indice` do catálogo ordenado por nome. */
function nomeNaPosicao(indice: number): string {
    return catalogo().map(s => s.name).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))[indice];
}

function clicar(el: Element | null | undefined): void {
    if (!el) throw new Error('elemento não está na tela');
    act(() => { fireEvent.click(el); });
}
const botao = (titulo: string) => document.querySelector(`button[title="${titulo}"]`);
const letra = (l: string) => Array.from(document.querySelectorAll('.alphabet-letter')).find(el => el.textContent === l);
function buscar(texto: string): void {
    const input = document.querySelector('.search-input');
    if (!input) throw new Error('busca não está na tela');
    act(() => { fireEvent.change(input, { target: { value: texto } }); });
}

async function abrir(ordenacao?: 'name') {
    if (ordenacao) localStorage.setItem('neostream_sort_series', ordenacao);
    const tela = render(<Series />);
    // Espera a CONDIÇÃO: catálogo carregado e grade na tela (o waitFor roda
    // dentro de act, então os efeitos desse render — o ouvinte do
    // useTVNavigation com a lista carregada — já estão aplicados)
    await waitFor(() => {
        expect(document.querySelector('.series-card.tv-focused')).not.toBeNull();
    });
    return tela;
}

/** Abre a ficha da série, "assiste" e fecha o player. */
async function assistirEFechar(nome: string) {
    clicar(Array.from(document.querySelectorAll('.series-card')).find(el => el.textContent?.includes(nome)));
    clicar(document.querySelector('.stub-assistir'));
    await waitFor(() => {
        expect(document.querySelector('.stub-fechar-player')).not.toBeNull();
    });
    clicar(document.querySelector('.stub-fechar-player'));
    expect(document.querySelector('.stub-fechar-player')).toBeNull();
}

beforeEach(() => {
    localStorage.clear();
    vi.spyOn(api, 'getSeries').mockResolvedValue(catalogo());
    vi.spyOn(api, 'getSeriesCategories').mockResolvedValue(categorias);
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('Séries — barra A-Z', () => {
    it('com ordenação por nome, → da última coluna entra na barra e OK filtra a grade pela letra', async () => {
        await abrir('name');

        const barra = document.querySelector('.alphabet-bar');
        expect(barra).not.toBeNull();
        const letras = Array.from(document.querySelectorAll('.alphabet-letter')).map(el => el.textContent);
        expect(letras).toEqual(['#', ...LETRAS]);
        // Com o foco na grade, nenhuma letra aparece focada
        expect(letraFocada()).toBeNull();

        // Da coluna 0 até a 5 (última), e mais um → entra na barra
        for (let i = 0; i < 5; i++) direita();
        expect(tituloFocado()).toBe(nomeNaPosicao(5));
        direita();
        expect(letraFocada()).toBe('#');
        expect(document.querySelector('.series-card.tv-focused')).toBeNull();

        // A barra tem pontas: ↑ no '#' fica no '#', ↓ além do Z fica no Z
        cima();
        expect(letraFocada()).toBe('#');
        for (let i = 0; i < LETRAS.length + 5; i++) baixo();
        expect(letraFocada()).toBe('Z');
        for (let i = 0; i < LETRAS.length - 13; i++) cima();

        // No M (posição 13: '#', A, B, ..., M)
        expect(letraFocada()).toBe('M');
        ok();

        // A grade mostra SÓ as séries do M, o foco voltou pro primeiro card
        expect(titulos()).toEqual(['Mserie 1', 'Mserie 2', 'Mserie 3', 'Mserie 4']);
        expect(tituloFocado()).toBe('Mserie 1');
        expect(letraFocada()).toBeNull();
        expect(letraAtiva()).toBe('M');
        // A barra continua com TODAS as letras: senão não haveria como voltar
        expect(document.querySelectorAll('.alphabet-letter').length).toBe(LETRAS.length + 1);

        // Voltar na grade desfaz o filtro de letra
        voltar();
        expect(letraAtiva()).toBeNull();
        expect(titulos()[0]).toBe('1 Numero Primeiro');

        // Entrar de novo na barra começa do '#', não da última letra usada
        for (let i = 0; i < 5; i++) direita();
        expect(tituloFocado()).toBe(nomeNaPosicao(5));
        direita();
        expect(letraFocada()).toBe('#');
    });

    it('nome com acento fica na letra sem acento (Élite no E, não no #)', async () => {
        vi.mocked(api.getSeries).mockResolvedValue([serie(1, 'Ágata'), serie(2, 'Bserie 1'), serie(3, 'Élite')]);
        await abrir('name');
        expect(Array.from(document.querySelectorAll('.alphabet-letter')).map(el => el.textContent)).toEqual(['A', 'B', 'E']);
        clicar(letra('E'));
        expect(titulos()).toEqual(['Élite']);
    });

    it('sem ordenação por nome a barra não aparece (a letra não ajudaria a achar nada)', async () => {
        await abrir();
        expect(document.querySelector('.alphabet-bar')).toBeNull();
        // → na última coluna segue na grade, não cai numa barra invisível
        for (let i = 0; i < 6; i++) direita();
        expect(tituloFocado()).toBe(catalogo()[6].name);
    });

    it('com uma letra só no catálogo a barra não aparece nem recebe foco', async () => {
        vi.mocked(api.getSeries).mockResolvedValue(
            Array.from({ length: 12 }, (_, i) => serie(i + 1, `Aserie ${i + 1}`)),
        );
        await abrir('name');
        expect(document.querySelector('.alphabet-bar')).toBeNull();
        for (let i = 0; i < 6; i++) direita();
        expect(tituloFocado()).toBe(nomeNaPosicaoDe(12, 6));
    });

    // Cada filtro que muda a lista debaixo da letra tem de soltá-la: com a
    // letra presa a grade ficava vazia (ou filtrada sem a barra na tela) e
    // nada explicava por quê
    it.each([
        ['busca', () => buscar('serie')],
        ['categoria', () => {
            clicar(document.querySelector('.category-toggle-btn'));
            clicar(Array.from(document.querySelectorAll('.category-item')).find(el => el.textContent?.includes('Séries Comédia')));
        }],
        ['ordenação', () => clicar(botao('Ordenar'))],
        ['esconder assistidos', () => clicar(botao('Esconder assistidos'))],
        ['década', () => clicar(botao('Filtrar por década'))],
        ['gênero', () => clicar(botao('Filtrar por gênero'))],
        ['nota mínima', () => clicar(botao('Nota mínima'))],
    ])('mudar %s solta a letra', async (_nome, mudar) => {
        await abrir('name');
        clicar(letra('M'));
        expect(letraAtiva()).toBe('M');
        expect(titulos().every(t => t.startsWith('M'))).toBe(true);

        mudar();
        expect(letraAtiva()).toBeNull();
        expect(titulos().some(t => !t.startsWith('M'))).toBe(true);
    });

    it('série terminada no player (com 🙈 ligado) muda a lista e solta a letra', async () => {
        let terminadas = new Set<string>();
        vi.spyOn(progressService, 'getFinishedSeriesIds').mockImplementation(() => new Set(terminadas));
        await abrir('name');
        clicar(botao('Esconder assistidos'));
        clicar(letra('M'));
        expect(titulos()).toEqual(['Mserie 1', 'Mserie 2', 'Mserie 3', 'Mserie 4']);

        terminadas = new Set([idDe('Mserie 1')]);
        await assistirEFechar('Mserie 1');

        expect(letraAtiva()).toBeNull();
        expect(titulos()).not.toContain('Mserie 1');
        expect(titulos().some(t => !t.startsWith('M'))).toBe(true);
    });

    it('grade vazia com a letra ainda ligada diz que a letra está ligada', async () => {
        // Mesmo número de terminadas, outras séries: a chave não enxerga a
        // troca e a letra fica. A tela vazia tem de dizer por quê.
        let terminadas = new Set(['997', '998', '999', '1000']);
        vi.spyOn(progressService, 'getFinishedSeriesIds').mockImplementation(() => new Set(terminadas));
        await abrir('name');
        clicar(botao('Esconder assistidos'));
        clicar(letra('M'));

        terminadas = new Set(['Mserie 1', 'Mserie 2', 'Mserie 3', 'Mserie 4'].map(idDe));
        await assistirEFechar('Mserie 1');

        expect(titulos()).toEqual([]);
        expect(document.querySelector('.no-results')?.textContent).toContain('letra M');
        // ...e a barra continua na tela (tirada da lista SEM a letra): dá pra
        // escolher outra letra dali mesmo
        expect(letra('A')).toBeDefined();
    });

    it('escolher a mesma letra de novo desliga o filtro', async () => {
        await abrir('name');
        clicar(letra('Z'));
        expect(letraAtiva()).toBe('Z');
        expect(titulos()).toEqual(['Zserie 1', 'Zserie 2', 'Zserie 3', 'Zserie 4']);
        clicar(letra('Z'));
        expect(letraAtiva()).toBeNull();
        expect(titulos()[0]).toBe('1 Numero Primeiro');
    });
});

/** Posição `indice` de um catálogo "Aserie 1..n" ordenado por nome. */
function nomeNaPosicaoDe(n: number, indice: number): string {
    return Array.from({ length: n }, (_, i) => `Aserie ${i + 1}`)
        .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))[indice];
}

describe('Séries — CH+/CH− pulam uma página da grade', () => {
    it('CH− desce 3 fileiras (18 cards) e o card focado está NA TELA; CH+ volta', async () => {
        await abrir('name');
        expect(tituloFocado()).toBe(nomeNaPosicao(0));

        const evento = chMenos();
        expect(evento.defaultPrevented).toBe(true);
        expect(tituloFocado()).toBe(nomeNaPosicao(18));

        chMenos();
        expect(tituloFocado()).toBe(nomeNaPosicao(36));
        const montados = titulos().length;

        chMais();
        expect(tituloFocado()).toBe(nomeNaPosicao(18));
        // Voltar uma página não desmonta o que já estava na tela
        expect(titulos().length).toBeGreaterThanOrEqual(montados);
        chMais();
        chMais();
        expect(tituloFocado()).toBe(nomeNaPosicao(0));

        // Fim do catálogo: CH− para no último, não some com o foco
        for (let i = 0; i < 10; i++) chMenos();
        expect(tituloFocado()).toBe(nomeNaPosicao(TOTAL - 1));
        // ...e o foco PARA mesmo no último: ↑ sobe uma fileira dali
        cima();
        expect(tituloFocado()).toBe(nomeNaPosicao(TOTAL - 1 - 6));
    });

    it('com o foco na barra A-Z, CH± não mexe na grade por baixo', async () => {
        await abrir('name');
        for (let i = 0; i < 6; i++) direita();
        expect(letraFocada()).toBe('#');
        chMenos();
        esquerda();
        expect(tituloFocado()).toBe(nomeNaPosicao(5));
    });

    it('com a grade vazia, CH− não estraga o foco de quando a lista voltar', async () => {
        await abrir('name');
        buscar('xyzxyz');
        expect(titulos()).toEqual([]);
        chMenos();
        buscar('');
        expect(tituloFocado()).toBe(nomeNaPosicao(0));
    });

    it('a dica do rodapé anuncia o CH±', async () => {
        await abrir();
        expect(document.querySelector('.series-hints')?.textContent).toContain('CH± Página');
    });

    it('com o menu de contexto aberto, CH± não mexe na grade por baixo', async () => {
        await abrir('name');
        amarelo();
        expect(document.querySelector('.context-menu')).not.toBeNull();
        chMenos();
        voltar(); // fecha o menu
        expect(document.querySelector('.context-menu')).toBeNull();
        expect(tituloFocado()).toBe(nomeNaPosicao(0));
    });

    it('nenhum ouvinte de keydown sobra depois de desmontar a tela', async () => {
        const adicionados: EventListenerOrEventListenerObject[] = [];
        const removidos: EventListenerOrEventListenerObject[] = [];
        const add = window.addEventListener.bind(window);
        const remove = window.removeEventListener.bind(window);
        vi.spyOn(window, 'addEventListener').mockImplementation((tipo, fn, opcoes) => {
            if (tipo === 'keydown') adicionados.push(fn as EventListenerOrEventListenerObject);
            add(tipo, fn as EventListenerOrEventListenerObject, opcoes);
        });
        vi.spyOn(window, 'removeEventListener').mockImplementation((tipo, fn, opcoes) => {
            if (tipo === 'keydown') removidos.push(fn as EventListenerOrEventListenerObject);
            remove(tipo, fn as EventListenerOrEventListenerObject, opcoes);
        });

        const tela = await abrir('name');
        chMenos();
        tela.unmount();

        const sobrando = adicionados.filter(fn => {
            const vezesAdd = adicionados.filter(x => x === fn).length;
            const vezesRemove = removidos.filter(x => x === fn).length;
            return vezesAdd > vezesRemove;
        });
        expect(sobrando).toEqual([]);
    });
});

// Execução: npx vitest run src/pages/Series.letraEPagina.test.tsx
