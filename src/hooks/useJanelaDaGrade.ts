// useJanelaDaGrade — quais cards de uma grade longa ficam MONTADOS (T020).
//
// A grade de Filmes crescia sem teto: `visibleCount` ganhava 24 cards a cada
// passo do ↓ (e do CH+, e da rolagem do mouse) e nunca encolhia. Chegar ao
// item 6 mil de uma lista de 8 mil montava 6 mil cards — os mesmos 36 mil nós
// que já fizeram o sistema encerrar o app quando o salto da barra A-Z os
// montava de uma vez. O salto foi fechado; a escada continuava aberta.
//
// Aqui a grade vira uma JANELA de fileiras inteiras, [inicio, fim), que anda
// junto com quem está sendo olhado:
//  - o índice focado (D-pad, CH±): a janela o segue no MESMO render em que o
//    foco muda, então o card focado já existe quando o efeito de scroll da
//    página o procura;
//  - a região que a tela mostra (rolagem do mouse): segue no evento `scroll`.
// O tamanho tem teto (LINHAS_MAX fileiras). O que sai de cima é trocado por um
// espaçador (`padding-top` da grade) com a altura exata das fileiras que
// faltam — medida no próprio DOM, do topo de uma fileira ao da seguinte —,
// então a posição de cada card montado é a mesma da grade inteira e o scroll
// nativo não pula quando a janela anda.
//
// Nada aqui é API nova para o Chromium 69 (Tizen 5.5): offsetTop, style e
// addEventListener existem desde sempre.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface Janela {
    /** Primeiro índice montado (sempre começo de fileira). */
    readonly inicio: number;
    /** Um depois do último índice montado. */
    readonly fim: number;
}

/** Fileiras montadas ACIMA do alvo: o que a tela mostra acima dele + a margem da capa. */
export const LINHAS_ACIMA = 4;
/** Com menos que isto de fileiras montadas abaixo do alvo, a janela estende... */
export const LINHAS_DE_FOLGA = 2;
/** ...até esta quantidade de fileiras abaixo dele (o antigo "+ cols * 4"). */
export const LINHAS_ABAIXO = 4;
/** Teto de fileiras montadas ao mesmo tempo. ~4 aparecem numa tela de 1080p. */
export const LINHAS_MAX = 16;

/**
 * A janela que contém os índices [primeiro, ultimo] com folga, sem passar de
 * LINHAS_MAX fileiras. Devolve a MESMA janela quando nada muda (o chamador
 * compara por identidade para não re-renderizar à toa).
 *
 * Histerese de propósito: descendo, o fim estende de LINHAS_ABAIXO em
 * LINHAS_ABAIXO fileiras e o topo só é cortado quando o teto estoura; subindo,
 * o topo volta fileira a fileira. Assim a janela não troca a cada tecla.
 */
export function acompanharJanela(
    janela: Janela, primeiro: number, ultimo: number, total: number, colunas: number,
): Janela {
    const cols = Math.max(1, Math.floor(colunas));
    if (total <= 0) return janela;
    const linha = (indice: number) => Math.floor(indice / cols);
    const lo = Math.min(Math.max(0, primeiro), total - 1);
    const hi = Math.min(Math.max(lo, ultimo), total - 1);
    const teto = LINHAS_MAX * cols;

    let { inicio, fim } = janela;
    // Topo: o alvo precisa de LINHAS_ACIMA fileiras montadas acima (ou do começo)
    const inicioMinimo = Math.max(0, linha(lo) - LINHAS_ACIMA) * cols;
    if (inicio > inicioMinimo) inicio = inicioMinimo;
    // Fundo: com menos de LINHAS_DE_FOLGA fileiras abaixo, estende de uma vez
    if (fim < Math.min(total, (linha(hi) + 1 + LINHAS_DE_FOLGA) * cols)) {
        fim = Math.min(total, (linha(hi) + 1 + LINHAS_ABAIXO) * cols);
    }
    // Teto: corta primeiro o que ficou acima além de LINHAS_ACIMA, depois o fundo
    if (fim - inicio > teto) {
        inicio = Math.max(inicio, inicioMinimo);
        if (fim - inicio > teto) fim = inicio + teto;
    }
    // O alvo inteiro sempre montado, mesmo passando do teto: numa tela mais
    // alta que LINHAS_MAX fileiras (janela do navegador esticada) o teto não
    // pode abrir buraco no meio do que se vê
    fim = Math.max(fim, Math.min(total, (linha(hi) + 1) * cols));

    if (inicio === janela.inicio && fim === janela.fim) return janela;
    return { inicio, fim };
}

interface Opcoes {
    /** Quantos itens a lista tem agora. */
    total: number;
    /** Índice focado pelo D-pad (já limitado ao tamanho da lista). */
    foco: number;
    /** Colunas da grade (o CSS e o D-pad da página usam o mesmo número). */
    colunas: number;
    /** O contêiner que ROLA (overflow), para seguir a rolagem do mouse. */
    rolagemRef: RefObject<HTMLElement | null>;
}

export function useJanelaDaGrade({ total, foco, colunas, rolagemRef }: Opcoes) {
    const cols = Math.max(1, Math.floor(colunas));
    // De saída, LINHAS_ABAIXO fileiras: com 6 colunas a fileira tem ~1/4 da
    // largura da tela de altura, então 4 fileiras cobrem qualquer tela deitada
    const [janela, setJanela] = useState<Janela>(() => ({ inicio: 0, fim: LINHAS_ABAIXO * cols }));
    const gradeRef = useRef<HTMLDivElement>(null);
    /** Distância do topo de uma fileira ao da seguinte (altura + gap), em px. */
    const passoRef = useRef(0);

    // Segue o foco no MESMO render em que ele muda (ajuste durante o render,
    // o padrão do repo; efeito com setState é proibido pelo lint). Também
    // quando a lista muda de tamanho: uma janela que ficou além do fim da
    // lista nova montaria uma grade vazia.
    const chave = `${foco}|${total}|${cols}`;
    const [chaveSeguida, setChaveSeguida] = useState(chave);
    if (chaveSeguida !== chave) {
        setChaveSeguida(chave);
        const seguida = acompanharJanela(janela, foco, foco, total, cols);
        if (seguida !== janela) setJanela(seguida);
    }

    // Espaçador: as fileiras NÃO montadas acima ocupam o mesmo espaço de antes.
    // Antes da pintura, senão a grade pisca um quadro deslocada. O padding vai
    // PRIMEIRO, com o passo já conhecido, e só depois se mede de novo: medir
    // antes forçaria um layout com a grade encolhida no meio do caminho.
    useLayoutEffect(() => {
        const grade = gradeRef.current;
        if (!grade) return;
        const linhasAcima = Math.floor(janela.inicio / cols);
        const aplicar = () => {
            const altura = linhasAcima > 0 && passoRef.current > 0 ? `${linhasAcima * passoRef.current}px` : '';
            if (grade.style.paddingTop !== altura) grade.style.paddingTop = altura;
        };
        aplicar();
        const itens = grade.children;
        if (itens.length > cols) {
            const passo = (itens[cols] as HTMLElement).offsetTop - (itens[0] as HTMLElement).offsetTop;
            if (passo > 0 && passo !== passoRef.current) {
                passoRef.current = passo;
                aplicar();
            }
        }
    });

    // Rolagem do mouse: a janela segue a região que a tela mostra. O D-pad
    // também rola (o efeito de scroll da página), e cai aqui do mesmo jeito —
    // a região contém o foco, então as duas regras concordam.
    useEffect(() => {
        const rolagem = rolagemRef.current;
        if (!rolagem) return;
        const aoRolar = () => {
            const grade = gradeRef.current;
            const passo = passoRef.current;
            if (!grade || passo <= 0 || total <= 0) return;
            const topo = rolagem.scrollTop - grade.offsetTop;
            const linhaTopo = Math.max(0, Math.floor(topo / passo));
            const linhaFundo = Math.max(linhaTopo, Math.floor((topo + rolagem.clientHeight) / passo));
            setJanela(atual => acompanharJanela(atual, linhaTopo * cols, linhaFundo * cols + cols - 1, total, cols));
        };
        rolagem.addEventListener('scroll', aoRolar);
        return () => rolagem.removeEventListener('scroll', aoRolar);
    }, [rolagemRef, total, cols]);

    return { inicio: janela.inicio, fim: janela.fim, gradeRef };
}
