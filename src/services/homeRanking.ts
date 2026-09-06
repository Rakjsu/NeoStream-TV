/**
 * Seleção dos itens da Home sem varrer o catálogo inteiro mais vezes que o
 * necessário. PURO — nada de DOM, storage ou rede.
 *
 * A Home mostra 15 filmes recentes, 15 séries recentes e uma dúzia de
 * recomendações. Para chegar nesses ~40 cards, o código copiava e ORDENAVA o
 * catálogo inteiro três vezes, e uma delas construía um `Date` DENTRO do
 * comparador — ou seja, duas vezes por comparação, `2·n·log n` objetos numa
 * TV com ~1 GB de RAM e um catálogo que já passou de 6 mil itens (o mesmo
 * catálogo que fez o sistema encerrar o app, como registra o comentário da
 * grade de Filmes).
 *
 * Aqui a chave é calculada UMA vez por item e a escolha é linear.
 */

/**
 * Os `n` maiores por `chave`, em ordem decrescente. Estável: empate mantém a
 * ordem de entrada.
 *
 * Chave não-finita — `NaN` de uma data que não parseia, ou um infinito — vale
 * menos que qualquer número e vai para o fim. Antes isso era sorte: comparação
 * com `NaN` é sempre falsa, e o item parava onde o algoritmo de ordenação
 * deixasse — e o `Array#sort` do Chromium 69 nem é estável.
 */
export function maioresPor<T>(itens: readonly T[], chave: (item: T) => number, n: number): T[] {
    if (n <= 0) return [];
    const melhores: { item: T; peso: number }[] = [];
    for (const item of itens) {
        const bruto = chave(item);
        const peso = Number.isFinite(bruto) ? bruto : -Infinity;
        if (melhores.length >= n && peso <= melhores[melhores.length - 1].peso) continue;
        // Varredura de trás pra frente: `n` é 15, não vale um heap.
        let posicao = melhores.length;
        while (posicao > 0 && melhores[posicao - 1].peso < peso) posicao--;
        melhores.splice(posicao, 0, { item, peso });
        if (melhores.length > n) melhores.pop();
    }
    return melhores.map(melhor => melhor.item);
}

/**
 * `n` itens sorteados, sem repetir e sem tocar no array de entrada.
 *
 * O que estava aqui era `[...itens].sort(() => Math.random() - 0.5)`: copia e
 * ordena milhares de itens para ficar com oito — e nem embaralha direito, já
 * que um comparador que muda de resposta a cada chamada não produz uma
 * permutação uniforme.
 */
export function amostraAleatoria<T>(
    itens: readonly T[],
    n: number,
    sorteio: () => number = Math.random,
): T[] {
    const total = itens.length;
    const quantos = Math.min(Math.max(0, Math.floor(n)), total);
    if (quantos === 0) return [];

    const escolhidos = new Set<number>();
    const saida: T[] = [];
    // Com `quantos` muito menor que `total` (o caso real: 8 de 6 mil), colisão
    // é rara. O teto evita o laço eterno quando os dois números se aproximam.
    let tentativas = quantos * 8;
    while (saida.length < quantos && tentativas-- > 0) {
        const indice = Math.floor(sorteio() * total);
        if (indice < 0 || indice >= total || escolhidos.has(indice)) continue;
        escolhidos.add(indice);
        saida.push(itens[indice]);
    }
    // Rede de segurança: completa em ordem. Só entra em cena quando o sorteio
    // esgotou as tentativas (ou é um sorteio de teste que sempre repete).
    for (let indice = 0; saida.length < quantos && indice < total; indice++) {
        if (escolhidos.has(indice)) continue;
        escolhidos.add(indice);
        saida.push(itens[indice]);
    }
    return saida;
}
