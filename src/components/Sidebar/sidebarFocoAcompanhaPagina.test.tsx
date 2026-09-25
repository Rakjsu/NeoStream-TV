// @vitest-environment jsdom
//
// O anel de foco da sidebar tem que estar na página ABERTA quando o foco
// volta para ela.
//
// O índice focado nascia de `useState(menuItems.findIndex(... activeItem))` —
// valor inicial, lido uma vez na montagem. Como a sidebar nunca desmonta, toda
// troca de página que não passava pelo próprio D-pad dela (card de atalho da
// Home, "Ver tudo", Voltar na sidebar subindo para a Home) deixava o anel no
// item antigo. Resultado na TV: abrir Filmes pelo card da Home e apertar ← na
// borda da grade mostrava o anel em "Início" e o destaque de ativo em "Filmes";
// um OK confiando no anel voltava para a Home sem querer.
//
// Teste comportamental: monta a Sidebar de verdade, troca a página por fora
// (como o App faz) e aperta as teclas como a TV aperta.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { FocusContext, type FocusZone } from '../../contexts/FocusContext';

afterEach(() => {
    cleanup();
    localStorage.clear();
});

interface Cena {
    activeItem: string;
    focused: boolean;
}

function montar(inicial: Cena) {
    const onItemSelect = vi.fn();
    const onProfileClick = vi.fn();
    const onBack = vi.fn();
    const setFocusZone = vi.fn<(zona: FocusZone) => void>();
    const arvore = ({ activeItem, focused }: Cena) => (
        <FocusContext.Provider value={{ focusZone: focused ? 'sidebar' : 'content', setFocusZone }}>
            <Sidebar
                activeItem={activeItem}
                onItemSelect={onItemSelect}
                onLogout={() => { /* não interessa aqui */ }}
                onProfileClick={onProfileClick}
                onBack={onBack}
                focused={focused}
            />
        </FocusContext.Provider>
    );
    const r = render(arvore(inicial));
    return {
        onItemSelect,
        onProfileClick,
        onBack,
        trocar: (cena: Cena) => r.rerender(arvore(cena)),
    };
}

/** Tecla como a TV dispara: keydown no window. */
function tecla(key: string) {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
}

/** Botão com o anel de foco do D-pad (itens do menu, perfil ou sair). */
function comAnel(): Element {
    const focados = document.querySelectorAll('.tv-focused');
    expect(focados, 'tem que haver exatamente UM anel de foco').toHaveLength(1);
    return focados[0];
}

/** Botão pintado como página ativa. */
function ativo(): Element {
    const ativos = document.querySelectorAll('.nav-item.active');
    expect(ativos).toHaveLength(1);
    return ativos[0];
}

describe('Sidebar: o anel de foco acompanha a página aberta', () => {
    it('página trocada por fora (card da Home): ao voltar para a sidebar, o anel está no item ativo', () => {
        const s = montar({ activeItem: 'home', focused: false });

        // Card "Filmes" da Home: o App troca a página sem a sidebar ter foco
        s.trocar({ activeItem: 'movies', focused: false });
        // ← na borda da grade devolve o foco à sidebar
        s.trocar({ activeItem: 'movies', focused: true });

        expect(comAnel()).toBe(ativo());
        expect(comAnel().textContent).toContain('🎬');
    });

    it('OK logo depois de voltar para a sidebar NÃO leva para a página antiga', () => {
        const s = montar({ activeItem: 'home', focused: false });
        s.trocar({ activeItem: 'movies', focused: false });
        s.trocar({ activeItem: 'movies', focused: true });

        tecla('Enter');

        expect(s.onItemSelect).toHaveBeenCalledTimes(1);
        expect(s.onItemSelect).toHaveBeenCalledWith('movies');
    });

    it('Voltar na sidebar sobe para a Home: o anel vai junto para "Início"', () => {
        const s = montar({ activeItem: 'movies', focused: true });
        expect(comAnel()).toBe(ativo());

        tecla('Backspace');
        expect(s.onBack).toHaveBeenCalledTimes(1);
        // App.onBack: página ≠ Home → handlePageChange('home'), zona 'content'
        s.trocar({ activeItem: 'home', focused: false });
        s.trocar({ activeItem: 'home', focused: true });

        expect(comAnel()).toBe(ativo());
        tecla('Enter');
        expect(s.onItemSelect).toHaveBeenLastCalledWith('home');
    });

    it('a partir do item ativo, ↓ anda um item a partir DELE', () => {
        const s = montar({ activeItem: 'home', focused: false });
        s.trocar({ activeItem: 'movies', focused: false });
        s.trocar({ activeItem: 'movies', focused: true });

        tecla('ArrowDown');
        tecla('Enter');

        // search, home, live, movies, series… — o próximo depois de Filmes
        expect(s.onItemSelect).toHaveBeenLastCalledWith('series');
    });

    it('sem troca de página, a posição do anel é preservada (ex.: volta do gerenciador de perfis)', () => {
        // O ProfileManager fecha devolvendo a zona para a sidebar; o anel tem
        // que continuar no botão de perfil, não pular para a página ativa.
        const s = montar({ activeItem: 'movies', focused: true });
        // movies → series → mylist → favorites → settings → perfil
        for (let i = 0; i < 5; i++) tecla('ArrowDown');
        expect(comAnel().classList.contains('profile-btn')).toBe(true);

        s.trocar({ activeItem: 'movies', focused: false }); // abre o modal (zona overlay)
        s.trocar({ activeItem: 'movies', focused: true });  // fecha e volta

        expect(comAnel().classList.contains('profile-btn')).toBe(true);
        tecla('Enter');
        expect(s.onProfileClick).toHaveBeenCalledTimes(1);
        expect(s.onItemSelect).not.toHaveBeenCalled();
    });

    it('página ativa fora do menu filtrado não zera nem desloca o anel', () => {
        // includeVOD desligado tira Filmes/Séries da lista. Se a página ativa
        // não está no menu, o anel fica onde estava — nunca em -1 (sem anel).
        localStorage.setItem('includeVOD', 'false');
        const s = montar({ activeItem: 'live', focused: true });
        const antes = comAnel();

        s.trocar({ activeItem: 'movies', focused: true });

        expect(comAnel()).toBe(antes);
    });
});
