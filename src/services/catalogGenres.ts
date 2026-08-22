// Gênero do catálogo, extraído do NOME da categoria (item 31).
//
// Por que não pelo TMDB: o gênero do TMDB só existiria para quem cadastrou uma
// chave da API — que é opcional e a maioria não tem — e chegaria uma ficha por
// vez, com cache de 120 entradas contra catálogos de milhares de títulos. Um
// filtro que só funciona para parte do catálogo e para parte dos usuários não
// é um filtro; é uma armadilha.
//
// Pelo nome da categoria funciona offline, para todo mundo, no catálogo
// inteiro e de graça: painéis Xtream já organizam o VOD por gênero
// ("Ação | 2024", "FILMES - COMÉDIA", "Séries Doramas"). O vocabulário abaixo
// é o mesmo que o CategoryMenu já usava para escolher o rótulo de cada
// categoria — aqui ele deixa de estar preso dentro de um componente.
//
// Módulo PURO: sem DOM, sem rede, sem armazenamento.

export interface Genero {
    id: string;
    rotulo: string;
    /** Trechos (já em minúsculas, sem acento) que identificam o gênero */
    pistas: readonly string[];
}

/**
 * Ordem importa: a primeira pista que casar vence. "Anime" TEM que vir antes
 * de "Animação" — senão todo anime cairia em Animação, e anime é dos gêneros
 * mais procurados numa lista IPTV.
 */
export const GENEROS: readonly Genero[] = [
    { id: 'acao', rotulo: 'Ação', pistas: ['acao', 'action'] },
    { id: 'aventura', rotulo: 'Aventura', pistas: ['aventura', 'adventure'] },
    { id: 'anime', rotulo: 'Anime', pistas: ['anime'] },
    { id: 'animacao', rotulo: 'Animação', pistas: ['animacao', 'animacoes', 'animation', 'desenho'] },
    { id: 'comedia', rotulo: 'Comédia', pistas: ['comedia', 'comedy'] },
    { id: 'crime', rotulo: 'Crime', pistas: ['crime', 'policial', 'policia'] },
    { id: 'documentario', rotulo: 'Documentário', pistas: ['documentario', 'documentary', 'docs'] },
    { id: 'drama', rotulo: 'Drama', pistas: ['drama'] },
    // Ficção antes de Fantasia por causa de "Sci-Fi & Fantasy", que é o nome
    // de gênero do próprio TMDB e cita os dois: quem manda é o primeiro termo
    { id: 'ficcao', rotulo: 'Ficção', pistas: ['ficcao', 'sci-fi', 'scifi', 'sci fi'] },
    { id: 'fantasia', rotulo: 'Fantasia', pistas: ['fantasia', 'fantasy'] },
    { id: 'guerra', rotulo: 'Guerra', pistas: ['guerra', 'war'] },
    { id: 'infantil', rotulo: 'Infantil', pistas: ['infantil', 'kids', 'crianca'] },
    // 'show' solto não entra: "REALITY SHOW" viraria categoria de música
    { id: 'musica', rotulo: 'Música', pistas: ['musica', 'music', 'shows'] },
    { id: 'romance', rotulo: 'Romance', pistas: ['romance', 'romantico'] },
    { id: 'suspense', rotulo: 'Suspense', pistas: ['suspense', 'thriller'] },
    { id: 'terror', rotulo: 'Terror', pistas: ['terror', 'horror'] },
    { id: 'novela', rotulo: 'Novela', pistas: ['novela', 'dorama', 'turca'] },
];

/** Minúsculas e sem acento — as mesmas regras da busca do catálogo. */
function normalizar(texto: string): string {
    return texto
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

/**
 * A pista aparece como PALAVRA (admitindo até duas letras de flexão no fim)?
 *
 * `includes` cru não serve, e o motivo é bem concreto: "ANIMAÇÃO" normaliza
 * para `animacao`, que CONTÉM `acao` — sem fronteira, todo desenho do catálogo
 * ia parar no gênero Ação. É o mesmo defeito que já tinha escondido o vídeo de
 * "TV Amazonas" atrás da tela de rádio, agora em outro lugar.
 *
 * O rabo de até 2 letras existe pra plural e flexão ("documentarioS",
 * "policiaIS", "animeS") sem abrir mão da fronteira: com ele, "WARNER" NÃO
 * casa com a pista `war` (sobram três letras) — e "WARNER CHANNEL" é um nome
 * de categoria comum de verdade.
 *
 * As regexes são memoizadas porque isto roda por categoria e por pista: são
 * ~40 pistas, e um catálogo grande tem centenas de categorias.
 */
const regexDaPista = new Map<string, RegExp>();
function casaComoPalavra(nome: string, pista: string): boolean {
    let regex = regexDaPista.get(pista);
    if (!regex) {
        // Sem escape: nenhuma pista da tabela tem metacaractere de regex — o
        // hífen de "sci-fi" é literal fora de classe de caracteres. Se um dia
        // entrar uma pista com ponto ou parêntese, escape aqui.
        regex = new RegExp(`(^|[^a-z0-9])${pista}[a-z]{0,2}([^a-z0-9]|$)`);
        regexDaPista.set(pista, regex);
    }
    return regex.test(nome);
}

/**
 * O gênero de uma categoria, ou null quando o nome não diz nada
 * ("LANÇAMENTOS 2024", "4K", "COLEÇÕES").
 */
export function generoDaCategoria(nomeDaCategoria: string): string | null {
    const nome = normalizar(nomeDaCategoria || '');
    if (!nome) return null;
    for (const genero of GENEROS) {
        if (genero.pistas.some(pista => casaComoPalavra(nome, pista))) return genero.id;
    }
    return null;
}

/**
 * Mapa categoria → gênero, calculado uma vez por lista de categorias.
 * O filtro roda sobre milhares de itens: refazer a varredura de pistas por
 * item travaria a grade numa TV.
 */
export function mapaDeGeneros(
    categorias: ReadonlyArray<{ category_id: string; category_name: string }>
): Map<string, string> {
    const mapa = new Map<string, string>();
    for (const categoria of categorias) {
        const genero = generoDaCategoria(categoria.category_name);
        if (genero) mapa.set(categoria.category_id, genero);
    }
    return mapa;
}

/**
 * Só os gêneros que o catálogo DESTE provedor realmente tem, na ordem de
 * GENEROS. Oferecer "Guerra" numa lista que não tem nenhum filme de guerra é
 * pior que não oferecer: o usuário escolhe e recebe uma grade vazia.
 */
export function generosDisponiveis(
    categorias: ReadonlyArray<{ category_id: string; category_name: string }>
): Genero[] {
    const presentes = new Set(mapaDeGeneros(categorias).values());
    return GENEROS.filter(genero => presentes.has(genero.id));
}

/** Rótulo do gênero pelo id (para o botão da barra de filtros). */
export function rotuloDoGenero(id: string): string {
    return GENEROS.find(genero => genero.id === id)?.rotulo || id;
}
