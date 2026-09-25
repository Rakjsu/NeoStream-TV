// @vitest-environment jsdom
//
// ➕ "Incluir TV ao vivo" e "Incluir Filmes e Séries" só existiam no Login.
// Quem desmarcou uma das duas — por engano, ou porque na época não usava —
// perdia a seção do menu pra sempre: não havia linha nas Configurações, e o
// único caminho de volta era sair da conta e digitar servidor, usuário e senha
// de novo no D-pad. A troca de playlist reaplicava as flags DA ENTRADA, então
// nem ir e voltar de provedor devolvia a seção na playlist em que ela sumiu.
//
// Os testes montam a Sidebar e as Configurações de verdade, lado a lado como
// no App, e dirigem a tela pelo teclado como o controle remoto dirige.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { Sidebar } from '../components/Sidebar';
import { Settings } from './Settings';
import { playlistService } from '../services/playlistService';
import { SECOES_EVENT, sectionVisibility } from '../services/sectionVisibility';

const PLAYLISTS_KEY = 'neostream_playlists';

// O jsdom não implementa rolagem; as Configurações rolam a seção focada.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

function gravarPlaylists(ativa: string, flags: Record<string, { includeTV: boolean; includeVOD: boolean }>) {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify({
        activeId: ativa,
        playlists: Object.keys(flags).map((id, i) => ({
            id,
            alias: `prov-${id}`,
            url: `http://prov-${id}.invalid`,
            username: 'u',
            password: 'p',
            addedAt: i,
            ...flags[id],
        })),
    }));
    localStorage.setItem('includeTV', String(flags[ativa].includeTV));
    localStorage.setItem('includeVOD', String(flags[ativa].includeVOD));
}

/** Rótulos do menu lateral, na ordem (o tooltip carrega o nome do item). */
function itensDoMenu(): string[] {
    return Array.from(document.querySelectorAll('.nav-item .tooltip-label')).map(el => el.textContent || '');
}

function tecla(key: string): void {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
}

/** Rótulo da linha das Configurações que está com o foco do D-pad. */
function linhaFocada(): string | null {
    const valor = document.querySelector('.settings-row .settings-value.focused');
    return valor?.parentElement?.querySelector('.settings-label')?.textContent ?? null;
}

/** Valor mostrado na linha focada ("Ligado"/"Desligado"). */
function valorFocado(): string | null {
    return document.querySelector('.settings-row .settings-value.focused')?.textContent ?? null;
}

/** Elemento com o foco do D-pad nas Configurações (botão ou valor de linha). */
function focoDaPagina(): Element | null {
    return document.querySelector('.settings-page .focused');
}

/**
 * Desce com ↓ até a linha cujo rótulo contém `texto`. Espera a CONDIÇÃO (a
 * linha focada), não um número de voltas: se o ↓ não move mais o foco, a
 * página acabou sem a linha — e o erro diz as linhas que existem.
 */
function descerAte(texto: string): void {
    const vistas: string[] = [];
    for (;;) {
        const atual = linhaFocada();
        if (atual && atual.includes(texto)) return;
        if (atual) vistas.push(atual);
        const antes = focoDaPagina();
        tecla('ArrowDown');
        if (antes && focoDaPagina() === antes) {
            throw new Error(`não existe linha "${texto}" nas Configurações; linhas: ${vistas.join(' | ')}`);
        }
    }
}

function montarAppFalso() {
    return render(
        <>
            <Sidebar activeItem="settings" onItemSelect={() => {}} onLogout={() => {}} onProfileClick={() => {}} />
            <Settings />
        </>
    );
}

/** Rótulo do item da sidebar com o foco do D-pad (null = nenhum item do menu). */
function focadoNaSidebar(): string | null {
    return document.querySelector('.sidebar .nav-item.tv-focused .tooltip-label')?.textContent ?? null;
}

function montarSidebarFocada() {
    return render(<Sidebar activeItem="settings" focused onItemSelect={() => {}} onLogout={() => {}} onProfileClick={() => {}} />);
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Configurações: mostrar ou esconder seções do menu', () => {
    it('quem desmarcou "TV ao vivo" no login traz a seção de volta sem sair da conta', () => {
        gravarPlaylists('a', { a: { includeTV: false, includeVOD: true } });
        montarAppFalso();
        expect(itensDoMenu()).not.toContain('TV Ao Vivo');

        descerAte('TV ao vivo no menu');
        expect(valorFocado()).toBe('Desligado');
        tecla('Enter');

        // A sidebar re-renderiza na hora, sem recarregar o app.
        expect(itensDoMenu()).toContain('TV Ao Vivo');
        expect(valorFocado()).toBe('Ligado');
        expect(localStorage.getItem('includeTV')).toBe('true');
        // A outra seção não é tocada
        expect(itensDoMenu()).toEqual(expect.arrayContaining(['Filmes', 'Séries']));
        expect(localStorage.getItem('includeVOD')).toBe('true');

        // OK de novo inverte de volta (a linha lê o estado que acabou de gravar)
        tecla('Enter');
        expect(itensDoMenu()).not.toContain('TV Ao Vivo');
        expect(valorFocado()).toBe('Desligado');

        // ←→ também mudam: → liga, ← desliga
        tecla('ArrowRight');
        expect(itensDoMenu()).toContain('TV Ao Vivo');
        tecla('ArrowLeft');
        expect(itensDoMenu()).not.toContain('TV Ao Vivo');
        expect(localStorage.getItem('includeTV')).toBe('false');
    });

    it('esconder Filmes e Séries tira os dois itens do menu na hora', () => {
        gravarPlaylists('a', { a: { includeTV: true, includeVOD: true } });
        montarAppFalso();
        expect(itensDoMenu()).toEqual(expect.arrayContaining(['Filmes', 'Séries']));

        descerAte('Filmes e Séries no menu');
        expect(valorFocado()).toBe('Ligado');
        tecla('Enter');

        expect(itensDoMenu()).not.toContain('Filmes');
        expect(itensDoMenu()).not.toContain('Séries');
        expect(itensDoMenu()).toContain('TV Ao Vivo');
        expect(valorFocado()).toBe('Desligado');
        expect(localStorage.getItem('includeVOD')).toBe('false');

        // ←→ também mudam: → liga, ← desliga
        tecla('ArrowRight');
        expect(itensDoMenu()).toEqual(expect.arrayContaining(['Filmes', 'Séries']));
        tecla('ArrowLeft');
        expect(itensDoMenu()).not.toContain('Filmes');
        expect(itensDoMenu()).toContain('TV Ao Vivo');

        // Agora VOD desligado e TV ligada: o OK desta linha inverte o valor
        // DELA (liga), não o da linha de cima
        tecla('Enter');
        expect(itensDoMenu()).toEqual(expect.arrayContaining(['Filmes', 'Séries']));
        expect(valorFocado()).toBe('Ligado');
        expect(localStorage.getItem('includeVOD')).toBe('true');
    });

    it('a escolha fica com a playlist: ir a outro provedor e voltar não desfaz', () => {
        // O setActive reaplica as flags guardadas NA ENTRADA. Se a linha nova
        // só gravasse o espelho solto, voltar pra esta playlist sumiria de
        // novo com a TV ao vivo.
        gravarPlaylists('a', {
            a: { includeTV: false, includeVOD: true },
            b: { includeTV: true, includeVOD: false },
        });
        montarAppFalso();
        descerAte('TV ao vivo no menu');
        tecla('Enter');
        cleanup();

        playlistService.setActive('b');
        expect(localStorage.getItem('includeVOD')).toBe('false'); // a outra playlist não foi tocada
        playlistService.setActive('a');
        expect(localStorage.getItem('includeTV')).toBe('true');
        expect(playlistService.list().find(p => p.id === 'a')?.includeTV).toBe(true);
    });

    it('sem chave gravada e sem playlist registrada (credencial antiga), tudo aparece e a linha funciona', () => {
        // Chave ausente = seção visível, como a sidebar sempre leu. Sem
        // playlist ativa não há entrada onde espelhar: vale só o espelho.
        montarAppFalso();
        expect(itensDoMenu()).toEqual(expect.arrayContaining(['TV Ao Vivo', 'Filmes', 'Séries']));

        descerAte('TV ao vivo no menu');
        expect(valorFocado()).toBe('Ligado');
        tecla('Enter');

        expect(itensDoMenu()).not.toContain('TV Ao Vivo');
        expect(localStorage.getItem('includeTV')).toBe('false');
        expect(localStorage.getItem(PLAYLISTS_KEY)).toBeNull();
    });

    it('quota cheia no meio da gravação: vale (e se espelha) o que ficou gravado de fato', () => {
        gravarPlaylists('a', { a: { includeTV: true, includeVOD: true } });
        const original = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, chave: string, valor: string) {
            if (chave === 'includeVOD') throw new DOMException('cheio', 'QuotaExceededError');
            return original.call(this, chave, valor);
        });

        let resultado: ReturnType<typeof sectionVisibility.set> | undefined;
        expect(() => { resultado = sectionVisibility.set({ tv: false, vod: false }); }).not.toThrow();

        expect(resultado).toEqual({ tv: false, vod: true });
        const entrada = playlistService.list().find(p => p.id === 'a');
        expect(entrada?.includeTV).toBe(false);
        expect(entrada?.includeVOD).toBe(true);
    });

    it('localStorage que não deixa ler as chaves: o menu mostra as duas seções', () => {
        // Sem conseguir ler a escolha, o seguro é mostrar tudo (é o padrão de
        // quem nunca desmarcou nada), e não sumir com a TV e os Filmes.
        const original = Storage.prototype.getItem;
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, chave: string) {
            if (chave === 'includeTV' || chave === 'includeVOD') throw new DOMException('bloqueado', 'SecurityError');
            return original.call(this, chave);
        });

        expect(sectionVisibility.get()).toEqual({ tv: true, vod: true });
        render(<Sidebar activeItem="home" onItemSelect={() => {}} onLogout={() => {}} onProfileClick={() => {}} />);
        expect(itensDoMenu()).toEqual(expect.arrayContaining(['TV Ao Vivo', 'Filmes', 'Séries']));
    });
});

describe('Sidebar: o foco do D-pad quando uma seção entra ou sai', () => {
    it('com a sidebar parada nas Configurações, esconder seções não leva o foco pro "Sair"', () => {
        // O foco da sidebar é um ÍNDICE na lista filtrada. Com tudo visível,
        // Configurações é o 8º item; tirar Filmes e Séries encolhe a lista em
        // dois e o mesmo índice passava a apontar pro botão de sair.
        gravarPlaylists('a', { a: { includeTV: true, includeVOD: true } });
        montarSidebarFocada();
        expect(focadoNaSidebar()).toBe('Configurações');

        act(() => { sectionVisibility.set({ vod: false }); });

        expect(itensDoMenu()).not.toContain('Filmes');
        expect(focadoNaSidebar()).toBe('Configurações');
        expect(document.querySelector('.logout-btn.tv-focused')).toBeNull();

        // E a volta da seção também não desloca o foco
        act(() => { sectionVisibility.set({ vod: true }); });
        expect(focadoNaSidebar()).toBe('Configurações');
    });

    it('foco no Perfil continua no Perfil (não escorrega pro Sair)', () => {
        gravarPlaylists('a', { a: { includeTV: true, includeVOD: true } });
        montarSidebarFocada();
        tecla('ArrowDown'); // Configurações → Perfil
        expect(document.querySelector('.profile-btn.tv-focused')).not.toBeNull();

        act(() => { sectionVisibility.set({ vod: false }); });

        expect(document.querySelector('.profile-btn.tv-focused')).not.toBeNull();
        expect(document.querySelector('.logout-btn.tv-focused')).toBeNull();
    });

    it('foco no Sair continua no Sair (não sobe pro Perfil)', () => {
        gravarPlaylists('a', { a: { includeTV: true, includeVOD: true } });
        montarSidebarFocada();
        tecla('ArrowDown'); // Configurações → Perfil
        tecla('ArrowDown'); // → Sair
        expect(document.querySelector('.logout-btn.tv-focused')).not.toBeNull();

        act(() => { sectionVisibility.set({ vod: false }); });

        expect(document.querySelector('.logout-btn.tv-focused')).not.toBeNull();
        expect(document.querySelector('.profile-btn.tv-focused')).toBeNull();

        // E com a seção de volta (a lista cresce), segue no Sair
        act(() => { sectionVisibility.set({ vod: true }); });
        expect(document.querySelector('.logout-btn.tv-focused')).not.toBeNull();
    });

    it('foco num item que continua no menu fica nele, mesmo mudando de posição', () => {
        gravarPlaylists('a', { a: { includeTV: true, includeVOD: true } });
        montarSidebarFocada();
        tecla('ArrowUp'); // Configurações → Favoritos
        tecla('ArrowUp'); // → Minha Lista (6º com tudo visível; 4º sem Filmes e Séries)
        expect(focadoNaSidebar()).toBe('Minha Lista');

        act(() => { sectionVisibility.set({ vod: false }); });

        expect(focadoNaSidebar()).toBe('Minha Lista');
    });

    it('se o item focado some do menu, o foco volta pro item da página aberta', () => {
        gravarPlaylists('a', { a: { includeTV: true, includeVOD: true } });
        montarSidebarFocada();
        // Configurações → Favoritos → Minha Lista → Séries → Filmes
        for (let passo = 0; passo < 4; passo++) tecla('ArrowUp');
        expect(focadoNaSidebar()).toBe('Filmes');

        act(() => { sectionVisibility.set({ vod: false }); });

        expect(focadoNaSidebar()).toBe('Configurações');
    });

    it('a sidebar solta o listener do sinal quando desmonta', () => {
        const add = vi.spyOn(window, 'addEventListener');
        const remove = vi.spyOn(window, 'removeEventListener');
        const { unmount } = render(<Sidebar activeItem="home" onItemSelect={() => {}} onLogout={() => {}} onProfileClick={() => {}} />);

        const armados = add.mock.calls.filter(([nome]) => nome === SECOES_EVENT).map(([, fn]) => fn);
        expect(armados).toHaveLength(1);

        unmount();
        const soltos = remove.mock.calls.filter(([nome]) => nome === SECOES_EVENT).map(([, fn]) => fn);
        expect(soltos).toEqual(armados);
    });
});
