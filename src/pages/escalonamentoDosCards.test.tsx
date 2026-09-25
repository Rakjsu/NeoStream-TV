// @vitest-environment jsdom
//
// ⏳ Card que existe, ocupa espaço e não é pintado.
//
// Favoritos e Minha Lista escalonavam a entrada dos cards com
// `style={{ animationDelay: `${index * 0.05}s` }}` — linear e SEM TETO. Como a
// animação dos cards é `... backwards` (Favoritos) / `... both` (Minha Lista),
// o card passa o atraso inteiro em `opacity: 0`: com 120 favoritos o último só
// aparecia aos 5,95 s. Filmes/Séries/TV ao Vivo já usam
// `Math.min(index * 0.03, 0.5)`.
//
// E o modo "Reduzir animações" (theme.css, `html[data-motion="reduzido"] *`)
// zerava a DURAÇÃO mas não o ATRASO: quem liga a opção de acessibilidade
// continuava esperando o atraso inteiro olhando uma tela vazia.
//
// O teste mede o resultado do CASCADE com as folhas REAIS, não o texto do código.
import { describe, it, expect, afterEach, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, cleanup } from '@testing-library/react';
import { storage, type SavedContentInput } from '../services/storage';
import { a11yService } from '../services/a11yService';
import { Favorites } from './Favorites';
import { MyList } from './MyList';

/**
 * Injeta a folha REAL no documento. O vitest não processa CSS: o
 * `import './X.css'` vira módulo vazio — sem isto não há cascade para medir.
 * Caminho relativo ao cwd, porque sob jsdom o `import.meta.url` é http.
 *
 * Contorno de UM defeito do jsdom, e só dele: uma lista de seletores que
 * contém pseudo-elemento (`html[...] *, html[...] *::before, ...`) não casa
 * com NENHUM elemento no jsdom — o navegador casa a parte `*`. Para cada regra
 * assim, acrescenta logo depois (mesma posição no cascade) a mesma declaração
 * com só os seletores sem `::`. Nada é inventado: é o que o navegador aplica.
 */
function injetarFolha(caminho: string): string[] {
    const elemento = document.createElement('style');
    elemento.textContent = readFileSync(caminho, 'utf8');
    document.head.appendChild(elemento);
    const folha = elemento.sheet!;
    const reescritas: string[] = [];
    for (let i = folha.cssRules.length - 1; i >= 0; i--) {
        const regra = folha.cssRules[i];
        if (!(regra instanceof CSSStyleRule) || !regra.selectorText.includes('::')) continue;
        const semPseudo = regra.selectorText.split(',').map(s => s.trim()).filter(s => !s.includes('::'));
        if (semPseudo.length === 0) continue;
        folha.insertRule(`${semPseudo.join(', ')} { ${regra.style.cssText} }`, i + 1);
        reescritas.push(...semPseudo);
    }
    return reescritas;
}

beforeAll(() => {
    // Falha ALTO se o contorno deixar de achar o bloco do modo reduzido: sem
    // ele, os testes de "Reduzir animações" mediriam uma folha sem a regra.
    // (Contar "> 0" não bastava: o bloco `html[data-playing]` também tem `::`.)
    expect(injetarFolha('src/theme.css')).toContain('html[data-motion="reduzido"] *');
    injetarFolha('src/pages/Favorites.css');
    injetarFolha('src/pages/MyList.css');
    // jsdom não implementa scrollIntoView (Minha Lista chama ao focar abas)
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
});

// A opção entra pela peça de verdade (a mesma que Configurações chama), não
// por um `dataset.motion` escrito à mão: o teste vigia também a ponte.
beforeEach(() => {
    localStorage.clear();
    a11yService.apply();
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    a11yService.apply();
});

const itensFalsos = (quantos: number): SavedContentInput[] =>
    Array.from({ length: quantos }, (_, i) => ({
        id: String(i + 1),
        type: 'movie' as const,
        title: `Filme ${i + 1}`,
    }));

/** Só o longhand: o jsdom não expande o shorthand `animation`. */
const atraso = (elemento: HTMLElement) => parseFloat(getComputedStyle(elemento).animationDelay);

function abrirFavoritos(quantos: number): HTMLElement[] {
    itensFalsos(quantos).forEach(item => storage.addFavorite(item));
    render(<Favorites />);
    return Array.from(document.querySelectorAll<HTMLElement>('.cards-grid .card'));
}

function abrirMinhaLista(quantos: number): HTMLElement[] {
    itensFalsos(quantos).forEach(item => storage.addWatchLater(item));
    render(<MyList />);
    return Array.from(document.querySelectorAll<HTMLElement>('.cards-grid .card'));
}

describe.each([
    ['Favoritos', abrirFavoritos],
    ['Minha Lista', abrirMinhaLista],
] as const)('%s — escalonamento da entrada dos cards', (_nome, abrir) => {
    it('nenhum card fica invisível além do teto de 0,5 s, por maior que seja a lista', () => {
        const cards = abrir(120);
        expect(cards).toHaveLength(120);
        expect(Math.max(...cards.map(atraso))).toBeLessThanOrEqual(0.5);
    });

    it('o escalonamento inicial continua existindo (o conserto não é zerar tudo)', () => {
        const cards = abrir(6);
        expect(atraso(cards[0])).toBe(0);
        expect(atraso(cards[1])).toBeGreaterThan(atraso(cards[0]));
        expect(atraso(cards[5])).toBeGreaterThan(atraso(cards[1]));
    });

    it('o ritmo é o mesmo de Filmes/Séries/TV ao Vivo: 0,03 s por card até o teto', () => {
        // "Crescer" e "ter teto" não bastam: um passo de 0,3 s passaria nos dois
        // e acabava com a escada (todo card a partir do 2º entrando junto).
        const cards = abrir(24);
        cards.forEach((card, i) => {
            expect(atraso(card)).toBeCloseTo(Math.min(i * 0.03, 0.5), 5);
        });
    });

    it('com "Reduzir animações" ligado, nenhum card espera — o atraso vai a zero', () => {
        a11yService.setReduceMotion(true);
        const cards = abrir(12);
        expect(cards).toHaveLength(12);
        expect(cards.map(atraso)).toEqual(cards.map(() => 0));
    });
});

describe('Reduzir animações — o atraso de animação zera em qualquer elemento, não só nos cards', () => {
    // A regra é global (`html[data-motion="reduzido"] *`): o modal de detalhes,
    // a Sidebar e o menu de categorias também têm entradas com atraso.
    function medirAnimacao(): number {
        const alvo = document.createElement('div');
        alvo.style.animationDelay = '2s';
        document.body.appendChild(alvo);
        try {
            return parseFloat(getComputedStyle(alvo).animationDelay);
        } finally {
            alvo.remove();
        }
    }

    it('animation-delay vira 0 num elemento qualquer com atraso declarado inline', () => {
        a11yService.setReduceMotion(true);
        expect(medirAnimacao()).toBe(0);
    });

    it('sem a opção ligada, o atraso declarado continua valendo', () => {
        expect(medirAnimacao()).toBe(2);
    });
});

describe('Reduzir animações — o atraso de transição também zera', () => {
    function medirTransicao(): number {
        const alvo = document.createElement('div');
        alvo.style.transitionDelay = '2s';
        document.body.appendChild(alvo);
        try {
            return parseFloat(getComputedStyle(alvo).transitionDelay);
        } finally {
            alvo.remove();
        }
    }

    it('transition-delay vira 0 mesmo com atraso declarado inline', () => {
        a11yService.setReduceMotion(true);
        expect(medirTransicao()).toBe(0);
    });

    it('sem a opção ligada, o atraso declarado continua valendo (a regra é só do modo reduzido)', () => {
        expect(medirTransicao()).toBe(2);
    });
});
