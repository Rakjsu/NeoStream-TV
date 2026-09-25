// A matemática da grade de programação.
//
// Um bloco mal posicionado numa TV não dá erro: desenha o programa errado no
// horário errado, e o usuário grava lembrete pra coisa errada.

import { describe, it, expect } from 'vitest';
import {
    programasNaJanela, faixaDoPrograma, noAr, alinharJanela, moverJanela,
    indiceNoInstante, instanteNaJanela, podarPorAlcance,
} from './epgGridLayout';
import type { EpgProgram } from './epgService';

const MIN = 60_000;
const H = 60 * MIN;
const PASSO = 30 * MIN;
const JANELA = 150 * MIN; // 2h30

const base = new Date(2026, 7, 21, 20, 0, 0).getTime(); // 20:00
const prog = (inicioMin: number, duracaoMin: number, title = 'P'): EpgProgram => ({
    title,
    description: '',
    start: base + inicioMin * MIN,
    end: base + (inicioMin + duracaoMin) * MIN,
});

describe('programasNaJanela', () => {
    const janelaFim = base + JANELA;

    it('pega o que cabe dentro e descarta o resto', () => {
        const lista = [
            prog(-180, 60, 'muito antes'),
            prog(0, 60, 'dentro A'),
            prog(60, 90, 'dentro B'),
            prog(180, 60, 'depois'),
        ];
        expect(programasNaJanela(lista, base, janelaFim).map(p => p.title))
            .toEqual(['dentro A', 'dentro B']);
    });

    // O caso que uma checagem só pelo `start` perde: o programa de 2h que
    // começou ANTES da janela e ainda está no ar dentro dela.
    it('não perde o programa longo que começou antes da janela', () => {
        const lista = [prog(-60, 120, 'começou antes')];
        expect(programasNaJanela(lista, base, janelaFim).map(p => p.title))
            .toEqual(['começou antes']);
    });

    it('quem termina exatamente no início da janela fica de fora', () => {
        expect(programasNaJanela([prog(-60, 60)], base, janelaFim)).toHaveLength(0);
    });

    it('quem começa exatamente no fim da janela fica de fora', () => {
        expect(programasNaJanela([prog(150, 60)], base, janelaFim)).toHaveLength(0);
    });

    it('descarta duração zero ou invertida (EPG de painel vem torto)', () => {
        const zerado: EpgProgram = { title: 'z', description: '', start: base, end: base };
        const invertido: EpgProgram = { title: 'i', description: '', start: base + H, end: base };
        expect(programasNaJanela([zerado, invertido], base, janelaFim)).toHaveLength(0);
    });

    it('ordena por horário mesmo se o provedor mandar fora de ordem', () => {
        const lista = [prog(60, 30, 'B'), prog(0, 30, 'A'), prog(120, 30, 'C')];
        expect(programasNaJanela(lista, base, janelaFim).map(p => p.title))
            .toEqual(['A', 'B', 'C']);
    });

    it('não muda a lista original', () => {
        const lista = [prog(60, 30, 'B'), prog(0, 30, 'A')];
        programasNaJanela(lista, base, janelaFim);
        expect(lista.map(p => p.title)).toEqual(['B', 'A']);
    });
});

describe('faixaDoPrograma', () => {
    it('programa no começo da janela ocupa a fatia certa', () => {
        // 30 min numa janela de 150 min = 20%
        expect(faixaDoPrograma(prog(0, 30), base, JANELA)).toEqual({ left: 0, width: 20 });
    });

    it('programa no meio começa deslocado', () => {
        // começa aos 75 min = 50%, dura 30 min = 20%
        expect(faixaDoPrograma(prog(75, 30), base, JANELA)).toEqual({ left: 50, width: 20 });
    });

    // Sem recorte, um programa de 3h numa janela de 2h30 desenharia 120% de
    // largura e vazaria por cima da coluna do canal seguinte.
    it('recorta na borda direita', () => {
        const { left, width } = faixaDoPrograma(prog(120, 180), base, JANELA);
        expect(left).toBe(80);
        expect(width).toBe(20);
        expect(left + width).toBe(100);
    });

    it('recorta na borda esquerda', () => {
        const { left, width } = faixaDoPrograma(prog(-60, 90), base, JANELA);
        expect(left).toBe(0);
        expect(width).toBe(20);
    });

    it('programa que engole a janela inteira vira a faixa toda', () => {
        expect(faixaDoPrograma(prog(-300, 900), base, JANELA)).toEqual({ left: 0, width: 100 });
    });

    it('nunca devolve largura negativa', () => {
        expect(faixaDoPrograma(prog(-300, 60), base, JANELA).width).toBe(0);
    });
});

describe('noAr', () => {
    it('o instante do início conta, o do fim não', () => {
        const p = prog(0, 60);
        expect(noAr(p, p.start)).toBe(true);
        expect(noAr(p, p.end - 1)).toBe(true);
        expect(noAr(p, p.end)).toBe(false);
        expect(noAr(p, p.start - 1)).toBe(false);
    });
});

describe('alinharJanela', () => {
    it('desce pra meia hora fechada', () => {
        const t = new Date(2026, 7, 21, 20, 47, 33).getTime();
        expect(new Date(alinharJanela(t, PASSO)).getMinutes()).toBe(30);
        expect(new Date(alinharJanela(t, PASSO)).getSeconds()).toBe(0);
    });

    it('hora fechada fica onde está', () => {
        const t = new Date(2026, 7, 21, 20, 0, 0).getTime();
        expect(alinharJanela(t, PASSO)).toBe(t);
    });
});

describe('moverJanela', () => {
    const agora = base;

    it('anda de meia em meia hora nos dois sentidos', () => {
        expect(moverJanela(base, 1, PASSO, agora)).toBe(base + PASSO);
        expect(moverJanela(base, -1, PASSO, agora)).toBe(base - PASSO);
        expect(moverJanela(base, 2, PASSO, agora)).toBe(base + 2 * PASSO);
    });

    // Sem limite, segurar a seta faz a janela vagar até 1970 — e cada passo
    // dispara uma varredura de EPG que nunca vai encontrar nada.
    it('não passa de 1 dia pra trás', () => {
        expect(moverJanela(base, -200, PASSO, agora)).toBe(base - 86_400_000);
    });

    it('não passa de 6 dias pra frente', () => {
        expect(moverJanela(base, 2000, PASSO, agora)).toBe(base + 6 * 86_400_000);
    });

    it('o limite acompanha o relógio, não a janela', () => {
        const noLimite = base - 86_400_000;
        expect(moverJanela(noLimite, -1, PASSO, agora)).toBe(noLimite);
        expect(moverJanela(noLimite, 1, PASSO, agora)).toBe(noLimite + PASSO);
    });
});

describe('indiceNoInstante', () => {
    const grade = [prog(0, 30, 'A'), prog(30, 60, 'B'), prog(90, 60, 'C')];

    it('acha o programa que contém o instante', () => {
        expect(indiceNoInstante(grade, base + 10 * MIN)).toBe(0);
        expect(indiceNoInstante(grade, base + 45 * MIN)).toBe(1);
        expect(indiceNoInstante(grade, base + 120 * MIN)).toBe(2);
    });

    it('a borda pertence ao programa que COMEÇA', () => {
        expect(indiceNoInstante(grade, base + 30 * MIN)).toBe(1);
        expect(indiceNoInstante(grade, base + 90 * MIN)).toBe(2);
    });

    // O motivo de a função existir: enquanto a linha não carregou, a lista é
    // vazia; quando chega, o foco tem que acender no horário que já estava.
    it('lista vazia devolve -1 em vez de fingir um índice', () => {
        expect(indiceNoInstante([], base)).toBe(-1);
    });

    it('antes do primeiro cai no primeiro; depois do último, no último', () => {
        expect(indiceNoInstante(grade, base - 5 * H)).toBe(0);
        expect(indiceNoInstante(grade, base + 10 * H)).toBe(2);
    });

    // Provedor que deixa buraco na grade não pode deixar o foco em lugar nenhum
    it('buraco na grade cai no mais próximo', () => {
        const comBuraco = [prog(0, 30, 'A'), prog(120, 30, 'B')];
        expect(indiceNoInstante(comBuraco, base + 40 * MIN)).toBe(0);  // perto de A
        expect(indiceNoInstante(comBuraco, base + 110 * MIN)).toBe(1); // perto de B
    });
});

describe('instanteNaJanela', () => {
    it('deixa em paz o que já está dentro', () => {
        const dentro = base + 40 * MIN;
        expect(instanteNaJanela(dentro, base, JANELA)).toBe(dentro);
    });

    it('puxa de volta o que saiu pelos lados', () => {
        expect(instanteNaJanela(base - H, base, JANELA)).toBe(base);
        expect(instanteNaJanela(base + 10 * H, base, JANELA)).toBe(base + JANELA - 1);
    });

    // O fim da janela é exclusivo: devolver janelaFim cravado deixaria o foco
    // no primeiro programa da janela SEGUINTE, que não está na tela.
    it('nunca devolve o limite superior cravado', () => {
        expect(instanteNaJanela(base + JANELA, base, JANELA)).toBeLessThan(base + JANELA);
    });
});

describe('podarPorAlcance', () => {
    const canais = Array.from({ length: 200 }, (_, i) => ({ stream_id: i + 1 }));
    const programas = [{ title: 'x', description: '', start: 0, end: 1 }];

    /** Mapa com EPG dos canais de id `ids`. */
    const mapaCom = (ids: number[]) => new Map(ids.map(id => [id, programas]));

    it('abaixo do teto não mexe em nada', () => {
        const epg = mapaCom([1, 2, 3]);
        const buscados = new Set([1, 2, 3]);
        expect(podarPorAlcance(epg, canais, 0, 10, buscados).size).toBe(3);
        expect(buscados.size).toBe(3);
    });

    it('acima do teto despeja até voltar ao teto', () => {
        const ids = Array.from({ length: 60 }, (_, i) => i + 1);
        const epg = mapaCom(ids);
        const buscados = new Set(ids);
        // Faixa visível no fim da lista: os canais 1..50 estão longe.
        const podado = podarPorAlcance(epg, canais, 100, 110, buscados);
        expect(podado.size).toBe(40);
        expect(buscados.size).toBe(40);
    });

    // O canal que está na tela não pode perder o EPG — a linha ficaria vazia
    // na frente do usuário.
    it('nunca despeja quem está na faixa visível', () => {
        const ids = Array.from({ length: 60 }, (_, i) => i + 1);
        const epg = mapaCom(ids);
        const buscados = new Set(ids);
        const podado = podarPorAlcance(epg, canais, 0, 12, buscados);
        for (let id = 1; id <= 12; id++) expect(podado.has(id)).toBe(true);
    });

    // O `buscados` é o que impede a rebusca. Despejar do mapa sem tirar de lá
    // deixaria a linha daquele canal vazia PARA SEMPRE.
    it('o despejado sai também do conjunto de já-buscados', () => {
        const ids = Array.from({ length: 60 }, (_, i) => i + 1);
        const epg = mapaCom(ids);
        const buscados = new Set(ids);
        const podado = podarPorAlcance(epg, canais, 100, 110, buscados);
        for (const id of ids) {
            expect(podado.has(id)).toBe(buscados.has(id));
        }
    });

    it('despeja o mais distante da faixa primeiro', () => {
        const ids = [1, 2, 3, ...Array.from({ length: 45 }, (_, i) => i + 100)];
        const epg = mapaCom(ids);
        const buscados = new Set(ids);
        // Faixa em torno do 120: os canais 1..3 são os mais distantes.
        const podado = podarPorAlcance(epg, canais, 115, 125, buscados);
        expect(podado.has(1)).toBe(false);
        expect(podado.has(2)).toBe(false);
        expect(podado.has(120)).toBe(true);
    });
});
