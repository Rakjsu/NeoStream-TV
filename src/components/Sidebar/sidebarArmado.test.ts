import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * O aviso de "sair armado" é CSS puro, e CSS puro não tem quem o teste — foi
 * assim que a primeira versão da regra chegou até aqui pintando nada:
 *
 * - `border-color` num botão que declara `border: none` não desenha, porque
 *   sem `border-style` a largura computada é 0;
 * - `.logout-btn.armado` tem a mesma especificidade de `.logout-btn.tv-focused`
 *   e vem depois, então SUBSTITUI o anel de foco — e o anel novo era mais
 *   fraco que o que ele substituía.
 *
 * No caminho do D-pad o botão está sempre focado quando arma, então o estado
 * perigoso aparecia mais apagado que o ocioso. Estes testes leem o arquivo e
 * cobram a relação entre as duas regras, que é o que a tela mostra.
 */
const CSS = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'Sidebar.css'),
    'utf-8',
)

/**
 * Corpo da regra que declara `propriedade` para `seletor`.
 *
 * Procura TODOS os blocos em que o seletor aparece, não o primeiro: o
 * `.logout-btn.tv-focused` aparece duas vezes — uma agrupada com o `:hover`
 * (background/transform/color) e outra sozinha, que é a do anel. Ancorar no
 * primeiro `indexOf` pegava o bloco errado.
 */
function regra(seletor: string, propriedade = ''): string {
    const blocos: string[] = []
    for (let i = CSS.indexOf(seletor); i !== -1; i = CSS.indexOf(seletor, i + 1)) {
        const abre = CSS.indexOf('{', i)
        const fecha = CSS.indexOf('}', abre)
        if (abre === -1 || fecha === -1) continue
        // O seletor tem que estar na LISTA deste bloco, não num bloco anterior.
        if (CSS.slice(i, abre).includes('}')) continue
        const corpo = CSS.slice(abre, fecha)
        if (!propriedade || corpo.includes(propriedade)) blocos.push(corpo)
    }
    expect(blocos.length, `nenhum bloco de ${seletor} com ${propriedade || 'qualquer coisa'}`).toBeGreaterThan(0)
    return blocos[0]
}

/** Alfa do `box-shadow` declarado — é o que decide qual anel se vê. */
function alfaDoAnel(seletor: string): number {
    const m = /box-shadow:[^;]*rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/
        .exec(regra(seletor, 'box-shadow'))
    expect(m, `box-shadow com rgba não encontrado em ${seletor}`).not.toBeNull()
    return Number(m![1])
}

describe('Sidebar: o botão de sair armado', () => {
    it('o armado é mais visível que o apenas focado, não menos', () => {
        // A regra que vem depois vence, então o armado TEM que ser o mais forte
        // — é ele que avisa que o próximo OK apaga credenciais e playlists.
        expect(alfaDoAnel('.logout-btn.armado'))
            .toBeGreaterThan(alfaDoAnel('.logout-btn.tv-focused'))
    })

    it('a regra do armado vem DEPOIS da de foco', () => {
        // Mesma especificidade: quem estiver por último ganha. Se alguém mover
        // o bloco para cima, o aviso some sem quebrar mais nada.
        expect(CSS.indexOf('.logout-btn.armado {'))
            .toBeGreaterThan(CSS.indexOf('.logout-btn.tv-focused {'))
    })

    it('não tenta pintar borda num botão que declara border: none', () => {
        // `border-color` sozinho aqui é código morto com cara de aviso.
        expect(regra('.logout-btn')).toContain('border: none')
        expect(regra('.logout-btn.armado')).not.toContain('border-color')
    })
})
