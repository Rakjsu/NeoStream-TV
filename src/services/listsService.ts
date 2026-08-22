// Listas pessoais nomeadas (item 30): "Maratona de sexta", "Ver com a família".
//
// DUAS decisões de desenho que valem mais que o código:
//
// 1. `neostream_watch_later` continua sendo a lista padrão, byte por byte.
//    Listas nomeadas são uma chave NOVA. Zero migração significa zero risco de
//    perder a lista que o usuário já tem — e neste repo migração de chave já
//    apagou dado de quem tinha perfil próprio.
//
// 2. Nome vem de sugestões, não de digitação. Digitar texto livre num D-pad
//    depende do IME nativo do Tizen, que já rendeu quatro armadilhas
//    documentadas (input descontrolado, Enter dentro do campo, guarda de
//    150 ms no Voltar, teclado que reabre sozinho). Seis sugestões navegáveis
//    por ←→ entregam o recurso sem nenhuma delas.

import { scopedKey } from './profileScope';
import { readJson, writeJson } from './safeStorage';
import type { SavedContentItem, SavedContentInput } from './storage';

const KEY = () => scopedKey('neostream_lists');

/** Nomes oferecidos ao criar. Ordem = ordem de navegação por ←→. */
export const NOMES_SUGERIDOS: readonly string[] = [
    'Maratona de sexta',
    'Ver com a família',
    'Clássicos',
    'Assistir sozinho',
    'Comédia da madrugada',
    'Rever',
];

/**
 * Tetos. A quota é de ~5 MB no aparelho inteiro e cada item guarda pôster,
 * título e nota: sem teto, uma lista vira o serviço que derruba os outros.
 */
export const MAX_LISTAS = 12;
export const MAX_ITENS_POR_LISTA = 200;

export interface ListaNomeada {
    id: string;
    nome: string;
    criadaEm: number;
    itens: SavedContentItem[];
}

function novoId(): string {
    // Sem Date.now() sozinho: criar duas listas no mesmo milissegundo (clique
    // duplo do controle) geraria ids iguais
    return `l${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function ler(): ListaNomeada[] {
    const bruto = readJson<unknown>(KEY(), []);
    if (!Array.isArray(bruto)) return [];
    return (bruto as Array<Partial<ListaNomeada>>)
        .filter(lista => lista && lista.id && lista.nome)
        .map(lista => ({
            id: String(lista.id),
            nome: String(lista.nome),
            criadaEm: Number(lista.criadaEm) || 0,
            itens: Array.isArray(lista.itens)
                ? (lista.itens as Array<Partial<SavedContentItem>>)
                    .filter(item => item && item.id != null && item.type != null)
                    .map(item => ({
                        ...item,
                        id: String(item.id),
                        type: item.type as SavedContentItem['type'],
                        title: item.title || 'Sem título',
                        addedAt: item.addedAt || 0,
                    }))
                : [],
        }));
}

function gravar(listas: ListaNomeada[]): void {
    writeJson(KEY(), listas);
}

/**
 * Nome livre a partir de uma sugestão: "Clássicos", "Clássicos 2", "Clássicos 3".
 * Sem isso, escolher a mesma sugestão duas vezes criaria duas listas com o
 * mesmo nome e nenhuma forma de distingui-las na tela.
 */
export function nomeDisponivel(sugestao: string, existentes: readonly string[]): string {
    const usados = new Set(existentes.map(nome => nome.trim().toLowerCase()));
    if (!usados.has(sugestao.trim().toLowerCase())) return sugestao;
    for (let n = 2; n <= MAX_LISTAS + 1; n++) {
        const tentativa = `${sugestao} ${n}`;
        if (!usados.has(tentativa.toLowerCase())) return tentativa;
    }
    return `${sugestao} ${Date.now().toString(36)}`;
}

export const listsService = {
    list(): ListaNomeada[] {
        return ler().sort((a, b) => a.criadaEm - b.criadaEm);
    },

    get(id: string): ListaNomeada | null {
        return ler().find(lista => lista.id === id) || null;
    },

    /** Cria e devolve a lista, ou null se já bateu o teto. */
    create(sugestao: string): ListaNomeada | null {
        const listas = ler();
        if (listas.length >= MAX_LISTAS) return null;
        const nova: ListaNomeada = {
            id: novoId(),
            nome: nomeDisponivel(sugestao, listas.map(lista => lista.nome)),
            criadaEm: Date.now(),
            itens: [],
        };
        listas.push(nova);
        gravar(listas);
        return nova;
    },

    remove(id: string): void {
        gravar(ler().filter(lista => lista.id !== id));
    },

    /** true se o item está na lista. */
    has(id: string, itemId: string, tipo: SavedContentItem['type']): boolean {
        const lista = this.get(id);
        return !!lista?.itens.some(item => item.id === itemId && item.type === tipo);
    },

    /**
     * Liga/desliga o item na lista; devolve true se ficou DENTRO.
     * Id colide entre filme e série, então tudo aqui é chaveado por id+tipo —
     * a mesma regra dos favoritos.
     */
    toggleItem(id: string, item: SavedContentInput): boolean {
        const listas = ler();
        const lista = listas.find(entrada => entrada.id === id);
        if (!lista) return false;

        const indice = lista.itens.findIndex(
            guardado => guardado.id === item.id && guardado.type === item.type
        );
        if (indice >= 0) {
            lista.itens.splice(indice, 1);
            gravar(listas);
            return false;
        }
        // Teto por lista: o mais ANTIGO sai, que é o que a pessoa esqueceu
        if (lista.itens.length >= MAX_ITENS_POR_LISTA) lista.itens.shift();
        lista.itens.push({ ...item, addedAt: Date.now() });
        gravar(listas);
        return true;
    },

    /** Em quantas listas nomeadas este item está (selo no card). */
    countListsWith(itemId: string, tipo: SavedContentItem['type']): number {
        return ler().filter(
            lista => lista.itens.some(item => item.id === itemId && item.type === tipo)
        ).length;
    },
};
