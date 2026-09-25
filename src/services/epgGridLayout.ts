// A matemática da grade de programação (item 1).
//
// Fica fora do componente porque é ela que erra: recorte na borda da janela,
// programa que atravessa a virada do dia, EPG fora de ordem, duração zero. Um
// bloco mal posicionado numa TV não dá erro nenhum — só desenha o programa
// errado no horário errado, e o usuário grava lembrete pra coisa errada.

import type { EpgProgram } from './epgService';

/** Programas que aparecem numa janela [inicio, fim), em ordem de relógio. */
export function programasNaJanela(
    programas: readonly EpgProgram[],
    inicio: number,
    fim: number
): EpgProgram[] {
    return programas
        // Sobreposição de intervalos: começa antes do fim da janela E termina
        // depois do começo dela. Comparar só o `start` perderia o programa de
        // duas horas que começou antes da janela e ainda está no ar.
        .filter(p => p.end > inicio && p.start < fim && p.end > p.start)
        .slice()
        .sort((a, b) => a.start - b.start);
}

export interface Faixa {
    /** % da largura da janela onde o bloco começa */
    left: number;
    /** % da largura da janela que o bloco ocupa */
    width: number;
}

/**
 * Onde o bloco fica dentro da janela, já RECORTADO nas bordas: um programa de
 * 3 h numa janela de 2 h 30 não pode vazar pra fora da faixa.
 */
export function faixaDoPrograma(
    programa: EpgProgram,
    janelaInicio: number,
    janelaMs: number
): Faixa {
    const janelaFim = janelaInicio + janelaMs;
    const inicio = Math.max(programa.start, janelaInicio);
    const fim = Math.min(programa.end, janelaFim);
    const left = ((inicio - janelaInicio) / janelaMs) * 100;
    const width = Math.max(0, ((fim - inicio) / janelaMs) * 100);
    return { left, width };
}

/** O programa está no ar neste instante? */
export function noAr(programa: EpgProgram, agora: number): boolean {
    return programa.start <= agora && programa.end > agora;
}

/** Arredonda pra baixo no passo (a régua sempre começa em :00 ou :30). */
export function alinharJanela(ms: number, passoMs: number): number {
    return Math.floor(ms / passoMs) * passoMs;
}

/**
 * Move a janela sem deixá-la vagar: o provedor guarda poucos dias de arquivo
 * pra trás e o EPG raramente passa de uma semana pra frente.
 */
export function moverJanela(
    atual: number,
    passos: number,
    passoMs: number,
    agora: number,
    diasAtras = 1,
    diasAFrente = 6
): number {
    const base = alinharJanela(agora, passoMs);
    const minimo = base - diasAtras * 86_400_000;
    const maximo = base + diasAFrente * 86_400_000;
    return Math.max(minimo, Math.min(maximo, atual + passos * passoMs));
}

/**
 * Índice do programa que corresponde a um INSTANTE — o âncora do foco na
 * grade.
 *
 * O foco não pode ser um índice de coluna: o EPG chega linha a linha, e descer
 * de canal antes de a linha carregar deixaria a lista vazia, o índice cairia
 * pra 0 e a posição no tempo se perderia. Ancorado no instante, descer mantém
 * o horário e o programa certo acende sozinho quando o EPG chega.
 *
 * Devolve -1 só quando não há programa nenhum. Buraco na grade (provedor sem
 * dado entre dois programas) cai no mais próximo, nunca em nada.
 */
export function indiceNoInstante(programas: readonly EpgProgram[], instante: number): number {
    if (programas.length === 0) return -1;
    let melhor = 0;
    let menorDistancia = Infinity;
    for (let i = 0; i < programas.length; i++) {
        const p = programas[i];
        // O `end` é EXCLUSIVO: quem termina exatamente no instante está a 1 ms
        // de distância, não a zero. Sem o +1, o instante 20:30 casava com o
        // programa que ACABOU às 20:30 em vez do que começou nele.
        const distancia = instante < p.start ? p.start - instante
            : instante >= p.end ? instante - p.end + 1
            : 0;
        if (distancia < menorDistancia) {
            menorDistancia = distancia;
            melhor = i;
        }
        if (distancia === 0) break;
    }
    return melhor;
}

/** Mantém o instante do foco dentro da janela visível. */
export function instanteNaJanela(instante: number, janelaInicio: number, janelaMs: number): number {
    return Math.max(janelaInicio, Math.min(janelaInicio + janelaMs - 1, instante));
}

/**
 * Teto de canais com EPG guardado. Numa TV de 1 GB, rolar por 500 canais
 * deixava 500 agendas de dia inteiro na memoria: o mapa so crescia, e o
 * `buscadosRef` garantia que nada era descartado (nem rebuscado).
 *
 * 40 e ~3x a faixa que a tela alcanca (7 visiveis + 3 de margem de cada lado),
 * entao rolar pra frente e voltar continua servindo do que ja esta guardado.
 */
const TETO_CANAIS_EPG = 40;

/**
 * Despeja as entradas mais distantes da faixa visivel quando o mapa passa do
 * teto. PURO. Tira do `buscados` junto: sem isso o canal despejado nunca mais
 * seria buscado e a linha dele ficaria vazia pra sempre.
 */
export function podarPorAlcance(
    epg: Map<number, EpgProgram[]>,
    channels: Array<{ stream_id: number }>,
    inicio: number,
    fim: number,
    buscados: Set<number>
): Map<number, EpgProgram[]> {
    if (epg.size <= TETO_CANAIS_EPG) return epg;

    const naFaixa = new Set(channels.slice(inicio, fim).map(canal => canal.stream_id));
    const posicao = new Map(channels.map((canal, i) => [canal.stream_id, i]));
    const centro = (inicio + fim) / 2;

    const candidatos = [...epg.keys()]
        .filter(id => !naFaixa.has(id))
        .sort((a, b) => {
            const da = Math.abs((posicao.get(a) ?? Number.MAX_SAFE_INTEGER) - centro);
            const db = Math.abs((posicao.get(b) ?? Number.MAX_SAFE_INTEGER) - centro);
            return db - da; // mais distante primeiro
        });

    for (const id of candidatos) {
        if (epg.size <= TETO_CANAIS_EPG) break;
        epg.delete(id);
        buscados.delete(id);
    }
    return epg;
}
