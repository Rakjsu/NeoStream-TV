// @vitest-environment jsdom
//
// ⏳ Categoria que existe, ocupa espaço e não é pintada.
//
// O item da lista carregava `style={{ animationDelay: `${0.1 + index * 0.03}s` }}`.
// Estilo embutido é a origem de maior prioridade do cascade, então o teto que a
// própria folha declara — `.category-item:nth-child(n+11) { animation-delay: 0.6s }`
// — nunca valia. E como a animação é `itemFadeIn ... backwards`, esse tempo todo
// é passado em `opacity: 0`: num catálogo de ~200 categorias, a última só
// aparecia aos 6,2 s.
//
// Numa TV o agravante é o cursor: `.category-item.tv-focused` só põe `background`
// e `box-shadow`, e os dois somem junto com a opacidade. Um toque no ↓ a partir
// da categoria selecionada já leva o foco para um item invisível — o anel de
// foco desaparece e a pessoa não sabe mais onde está.
//
// O teste mede o resultado do CASCADE com a folha REAL, não o texto do código.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRef } from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { CategoryMenu, type CategoryMenuHandle } from './CategoryMenu';

beforeAll(() => {
    // O vitest não processa CSS: o `import './CategoryMenu.css'` do componente
    // vira módulo vazio. Sem injetar a folha de verdade não há cascade para
    // medir — e o caminho é relativo ao cwd, porque sob jsdom o
    // `import.meta.url` é http e o `new URL(...)` estoura.
    const folha = document.createElement('style');
    folha.textContent = readFileSync('src/components/CategoryMenu.css', 'utf8');
    document.head.appendChild(folha);

    // jsdom não implementa scrollIntoView, e o componente chama assim que o
    // painel abre — sem o stub o teste morre antes de medir qualquer coisa.
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
});

afterEach(cleanup);

const categoriasFalsas = (quantas: number) =>
    Array.from({ length: quantas }, (_, i) => ({
        category_id: String(i + 1),
        category_name: `Categoria ${i + 1}`,
        parent_id: 0,
    }));

function abrirPainel(quantas: number): HTMLElement[] {
    const ref = createRef<CategoryMenuHandle>();
    render(
        <CategoryMenu
            ref={ref}
            type="vod"
            selectedCategory="all"
            categories={categoriasFalsas(quantas)}
            onSelectCategory={() => { /* não interessa aqui */ }}
        />
    );
    act(() => ref.current!.open());
    return Array.from(document.querySelectorAll<HTMLElement>('.category-item'));
}

/** Só o longhand: o jsdom não expande o shorthand `animation`. */
const atraso = (elemento: HTMLElement) => parseFloat(getComputedStyle(elemento).animationDelay);

describe('CategoryMenu — escalonamento da lista', () => {
    it('nenhuma categoria fica invisível além do teto de 0,6 s da folha', () => {
        const itens = abrirPainel(204); // + "Todos" = 205
        expect(itens).toHaveLength(205);
        expect(Math.max(...itens.map(atraso))).toBeLessThanOrEqual(0.6);
    });

    it('o escalonamento inicial continua existindo (o conserto não é zerar tudo)', () => {
        const itens = abrirPainel(7);
        expect(atraso(itens[0])).toBeCloseTo(0.1, 5);
        expect(atraso(itens[1])).toBeGreaterThan(atraso(itens[0]));
        expect(atraso(itens[5])).toBeGreaterThan(atraso(itens[1]));
    });
});
