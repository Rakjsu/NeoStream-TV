// @vitest-environment jsdom
//
// ⏸️ Fechar o menu de categorias deixava o controle morto por 300 ms.
//
// O Voltar (ou o OK numa categoria) punha o painel em `isClosing` e DESLIGAVA o
// hook do menu na hora (`enabled: isOpen && !isClosing`), mas a página só era
// avisada (`onOpenChange(false)`) no fim do setTimeout de 300 ms da animação.
// Nesse intervalo ninguém ouvia o controle: o ↓ ou o OK de quem aperta de novo
// "pra garantir" simplesmente sumiam — nas três telas de catálogo.
//
// O conserto mantém o menu ouvindo durante a animação: qualquer tecla nesse
// intervalo encerra o fechamento NA HORA (painel some, página religa) e é
// consumida pelo menu — nada vaza pra grade com o painel ainda na tela, e um
// OK repetido não seleciona outra categoria. O timer da animação é desarmado
// quando o fechamento termina antes, e no desmonte.
//
// Teste comportamental: o CategoryMenu de verdade, o useTVNavigation de
// verdade e uma "página" mínima que liga/desliga o próprio hook pelo
// onOpenChange, exatamente como LiveTV/Filmes/Séries fazem.
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { createRef, useState } from 'react';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { CategoryMenu, type CategoryMenuHandle } from './CategoryMenu';
import { useTVNavigation } from '../hooks/useTVNavigation';

beforeAll(() => {
    // jsdom não implementa scrollIntoView; o menu chama ao abrir.
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
});

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const categorias = [
    { category_id: '10', category_name: 'Ação', parent_id: 0 },
    { category_id: '20', category_name: 'Drama', parent_id: 0 },
];

function montar() {
    const ref = createRef<CategoryMenuHandle>();
    const onOpenChange = vi.fn();
    const onSelectCategory = vi.fn();
    const onToggleHideCategory = vi.fn();
    const teclasDaPagina: string[] = [];

    function Pagina() {
        const [menuAberto, setMenuAberto] = useState(false);
        // Igual às páginas: o hook delas fica desligado enquanto o menu diz
        // que está aberto.
        useTVNavigation({
            onNavigate: (d) => { teclasDaPagina.push(d); },
            onEnter: () => { teclasDaPagina.push('enter'); },
            enabled: !menuAberto,
        });
        return (
            <CategoryMenu
                ref={ref}
                type="vod"
                selectedCategory="all"
                categories={categorias}
                onSelectCategory={onSelectCategory}
                onToggleHideCategory={onToggleHideCategory}
                onOpenChange={(aberto) => {
                    onOpenChange(aberto);
                    setMenuAberto(aberto);
                }}
            />
        );
    }

    const utils = render(<Pagina />);
    act(() => ref.current!.open());
    // abrir registra o true; os testes olham só o que vem depois
    onOpenChange.mockClear();
    return { ...utils, onOpenChange, onSelectCategory, onToggleHideCategory, teclasDaPagina };
}

const tecla = (key: string, keyCode: number) => {
    act(() => { fireEvent.keyDown(window, { key, keyCode }); });
};
const voltar = () => tecla('XF86Back', 10009);
const baixo = () => tecla('ArrowDown', 40);
const ok = () => tecla('Enter', 13);

const painel = () => document.querySelector('.category-panel');

describe('CategoryMenu — fechar não deixa o controle morto', () => {
    it('uma tecla durante a animação encerra o fechamento na hora e a página volta a ouvir', () => {
        const { onOpenChange, teclasDaPagina } = montar();

        voltar();
        expect(painel()?.className).toContain('closing');

        // ainda dentro dos 300 ms da animação
        act(() => { vi.advanceTimersByTime(100); });
        baixo();

        // o menu respondeu: fechou de vez e avisou a página, sem esperar o timer
        expect(painel()).toBeNull();
        expect(onOpenChange).toHaveBeenCalledTimes(1);
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
        // a tecla que encerrou a animação foi consumida pelo menu, não vazou
        expect(teclasDaPagina).toEqual([]);

        // e a próxima já anda na grade
        baixo();
        expect(teclasDaPagina).toEqual(['down']);
    });

    it('o timer da animação é desarmado quando o fechamento termina antes (sem aviso em dobro)', () => {
        const { onOpenChange } = montar();

        voltar();
        expect(vi.getTimerCount()).toBe(1);
        voltar(); // o Voltar "mais forte" de quem acha que não pegou

        expect(vi.getTimerCount()).toBe(0);
        act(() => { vi.advanceTimersByTime(1000); });
        expect(onOpenChange).toHaveBeenCalledTimes(1);
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
    });

    it('OK repetido durante a animação não seleciona outra categoria', () => {
        const { onSelectCategory, onOpenChange, teclasDaPagina } = montar();

        baixo(); // foco em "Ação"
        ok();    // seleciona e começa a fechar
        expect(onSelectCategory).toHaveBeenCalledTimes(1);
        expect(onSelectCategory).toHaveBeenLastCalledWith('10');

        ok();    // o OK "de novo, pra garantir", ainda na animação
        expect(onSelectCategory).toHaveBeenCalledTimes(1);
        expect(painel()).toBeNull();
        expect(onOpenChange).toHaveBeenCalledTimes(1);
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
        expect(teclasDaPagina).toEqual([]);

        ok();    // já na página
        expect(onSelectCategory).toHaveBeenCalledTimes(1);
        expect(teclasDaPagina).toEqual(['enter']);
    });

    it('🔵 durante a animação não oculta categoria num painel que está sumindo: encerra o fechamento', () => {
        const { onToggleHideCategory, onOpenChange } = montar();

        baixo(); // foco em "Ação"
        voltar();
        tecla('ColorF3Blue', 406);

        expect(onToggleHideCategory).not.toHaveBeenCalled();
        expect(painel()).toBeNull();
        expect(onOpenChange).toHaveBeenCalledTimes(1);
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('sem tecla nenhuma, a animação corre os 300 ms e a página só religa no fim', () => {
        const { onOpenChange, teclasDaPagina } = montar();

        voltar();
        act(() => { vi.advanceTimersByTime(299); });
        expect(painel()?.className).toContain('closing');
        expect(onOpenChange).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(1); });
        expect(painel()).toBeNull();
        expect(onOpenChange).toHaveBeenCalledTimes(1);
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
        expect(vi.getTimerCount()).toBe(0);
        expect(teclasDaPagina).toEqual([]);
    });

    it('desmontar no meio da animação desarma o timer: nada dispara depois', () => {
        // As páginas renderizam o menu sem condição: ele só desmonta junto
        // com elas (trocar de tela), e aí não há página viva pra avisar.
        const { unmount, onOpenChange } = montar();

        voltar();
        expect(vi.getTimerCount()).toBe(1);
        unmount();

        expect(vi.getTimerCount()).toBe(0);
        act(() => { vi.advanceTimersByTime(1000); });
        expect(onOpenChange).not.toHaveBeenCalled();
    });
});
