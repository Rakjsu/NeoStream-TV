// @vitest-environment jsdom
//
// T126 — O anel de foco da grade e o índice que o D-pad move eram dois
// números diferentes.
//
// 🔵 (ocultar) e 🟡 (desfavoritar dentro de ⭐ Favoritos) tiram o card focado
// da lista sem passar pelo effect que zera o foco. A tela se protegia com um
// clamp SÓ de apresentação (`safeChannelIndex`): o anel caía no novo último
// card, mas o índice que as setas movem continuava apontando pra além do fim
// da lista. Resultado, com o anel no fim da grade:
//   - ← dava toques mortos (o índice andava, o anel não);
//   - ← mandava o foco pra barra lateral com o anel no MEIO da linha (a
//     coluna era calculada sobre o índice fantasma, que estava na coluna 0);
//   - ↑ subia pra coluna errada (andava 6 a partir do fantasma).
//
// O teste monta a PÁGINA DE VERDADE e dirige tudo pelo controle. Só a rede
// (API/EPG) e o player são dublês.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, screen, waitFor } from '@testing-library/react';
import { installFakeStorage } from '../testing/fakeStorage';
import { api } from '../services/api';
import { epgService } from '../services/epgService';
import { storage } from '../services/storage';
import { FocusContext, type FocusZone } from '../contexts/FocusContext';
import type { LiveStream, Category } from '../types';

vi.mock('../components/VideoPlayer', () => ({
    VideoPlayer: (props: { title: string }) => <div data-testid="player">{props.title}</div>,
}));

import { LiveTV } from './LiveTV';

// Nomes sem número nem sufixo de qualidade: o 🧬 agrupar variantes não pode
// juntar dois deles num card só
const NOMES = ['Alfa', 'Bravo', 'Charlie', 'Delta', 'Eco', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike'];

function canal(stream_id: number, name: string): LiveStream {
    return {
        num: stream_id,
        name,
        stream_type: 'live',
        stream_id,
        stream_icon: '',
        epg_channel_id: `epg.${stream_id}`,
        added: '',
        category_id: '1',
        custom_sid: '',
        tv_archive: 0,
        direct_source: '',
        tv_archive_duration: 0,
    };
}

const CATEGORIAS: Category[] = [{ category_id: '1', category_name: 'Variedades', parent_id: 0 }];

// Cada tecla num act ASSÍNCRONO: a página responde a promessas resolvidas
// fora do act (EPG, logos) e o useTVNavigation troca o ouvinte num effect.
// Com o act síncrono, a tecla seguinte podia chegar ao ouvinte ANTERIOR, com
// a lista de antes do 🔵 — o ↑ saía da coluna do card oculto e o teste
// falhava ~1 em 5 ("Golf" no lugar de "Lima"). Mesmo mal do #48/#49.
async function tecla(key: string) {
    await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        await Promise.resolve();
    });
}

/** Nome do card com o anel de foco (o que o usuário VÊ focado), sem o selo ⭐. */
function anel(): string | null {
    const card = document.querySelector('.channel-card.tv-focused .channel-name');
    if (!card) return null;
    return Array.from(card.childNodes)
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent ?? '')
        .join('')
        .trim();
}

let setFocusZone: ReturnType<typeof vi.fn<(zone: FocusZone) => void>>;

async function montarPagina(quantos: number) {
    const canais = NOMES.slice(0, quantos).map((nome, i) => canal(i + 1, nome));
    vi.spyOn(api, 'getLiveStreams').mockResolvedValue(canais);
    render(
        <FocusContext.Provider value={{ focusZone: 'content', setFocusZone }}>
            <LiveTV />
        </FocusContext.Provider>
    );
    // Espera a CONDIÇÃO (grade na tela com o anel no 1º card); o waitFor roda
    // dentro de act, então o ouvinte do useTVNavigation já está registrado
    await waitFor(() => expect(anel()).toBe(NOMES[0]));
    // ...e a grade com a lista DESTE teste: a TV ao vivo pinta primeiro o
    // cache de boot e só depois a resposta da API. Com a lista de outro
    // tamanho na tela, o ↓ parava antes (Foxtrot no lugar do Mike).
    await waitFor(() => expect(api.getLiveStreams).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelectorAll('.channel-card')).toHaveLength(quantos));
}

beforeEach(() => {
    // jsdom não implementa scrollIntoView; o menu de categorias chama ao abrir.
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = function () { /* jsdom */ };
    }
    installFakeStorage();
    sessionStorage.clear();
    setFocusZone = vi.fn<(zone: FocusZone) => void>();
    vi.spyOn(api, 'getLiveCategories').mockResolvedValue(CATEGORIAS);
    vi.spyOn(api, 'getLiveStreamUrl').mockImplementation(id => `http://provedor.invalid/live/${id}.ts`);
    vi.spyOn(epgService, 'getChannelEpg').mockResolvedValue({ now: null, next: null, programs: [] });
});

afterEach(async () => {
    cleanup();
    // A carga da página desmontada ainda termina depois do cleanup e grava a
    // lista no cache de boot (writeCatalog). Sem esperar aqui, ela caía no
    // armazenamento NOVO do próximo teste, que abria pintando a lista deste
    // (Foxtrot/Alfa no lugar do Mike/Golf, ~1 em 5 rodadas).
    await new Promise(resolve => setTimeout(resolve, 0));
    vi.restoreAllMocks();
});

describe('TV ao vivo: o anel de foco e o índice das setas são o MESMO número (T126)', () => {
    it('ocultar o último card da grade e apertar ← anda um card, não foge pra barra lateral', async () => {
        // 13 canais: 2 linhas cheias de 6 + "Mike" sozinho na coluna 0 da 3ª
        await montarPagina(13);
        await tecla('ArrowDown');
        await tecla('ArrowDown');
        expect(anel()).toBe('Mike');

        // 🔵 oculta o Mike: o anel cai no novo último card, Lima (coluna 5)
        await tecla('ColorF3Blue');
        expect(screen.queryByText('Mike')).toBeNull();
        expect(anel()).toBe('Lima');

        // ← com o anel na coluna 5 vai pra coluna 4. Antes a coluna era
        // calculada sobre o índice do Mike (coluna 0) e o foco ia pra sidebar.
        await tecla('ArrowLeft');
        expect(setFocusZone).not.toHaveBeenCalledWith('sidebar');
        expect(anel()).toBe('Kilo');
    });

    it('depois de ocultar o último card, ↑ sobe na MESMA coluna que o anel mostra', async () => {
        await montarPagina(13);
        await tecla('ArrowDown');
        await tecla('ArrowDown');
        await tecla('ColorF3Blue');
        expect(anel()).toBe('Lima');

        // Lima está na linha 2, coluna 5 → ↑ é Foxtrot (linha 1, coluna 5).
        // Antes subia 6 a partir do índice fantasma e caía em Golf (coluna 0).
        await tecla('ArrowUp');
        expect(anel()).toBe('Foxtrot');
        expect(setFocusZone).not.toHaveBeenCalled();
    });

    it('várias ocultações seguidas no fim da grade: cada ← move o anel (nenhum toque morto)', async () => {
        // 12 canais: 2 linhas cheias; o anel vai pro último (Lima, coluna 5)
        await montarPagina(12);
        await tecla('ArrowDown');
        for (let i = 0; i < 5; i++) await tecla('ArrowRight');
        expect(anel()).toBe('Lima');

        // Quatro 🔵 seguidos: Lima, Kilo, Juliet e India somem; o anel acaba em Hotel
        for (const nome of ['Lima', 'Kilo', 'Juliet', 'India']) {
            expect(anel()).toBe(nome);
            await tecla('ColorF3Blue');
            expect(screen.queryByText(nome)).toBeNull();
        }
        expect(anel()).toBe('Hotel');

        // Hotel é linha 1, coluna 1: o PRIMEIRO ← já tem de ir pro Golf
        await tecla('ArrowLeft');
        expect(anel()).toBe('Golf');
        // e o segundo (coluna 0) é o que sai pra barra lateral
        expect(setFocusZone).not.toHaveBeenCalled();
        await tecla('ArrowLeft');
        expect(setFocusZone).toHaveBeenCalledWith('sidebar');
        expect(anel()).toBe('Golf');
    });

    it('a grade encolheu pra uma linha só: ↑ vai pro cabeçalho, não pro primeiro card', async () => {
        // 8 canais: Hotel é linha 1, coluna 1
        await montarPagina(8);
        await tecla('ArrowDown');
        await tecla('ArrowRight');
        expect(anel()).toBe('Hotel');

        // Ocultar Hotel e Golf: sobram 6 canais, uma linha só; o anel cai em Foxtrot
        await tecla('ColorF3Blue');
        expect(anel()).toBe('Golf');
        await tecla('ColorF3Blue');
        expect(anel()).toBe('Foxtrot');

        // Foxtrot está na PRIMEIRA linha: ↑ sai da grade pro cabeçalho.
        // Antes o índice fantasma (7, linha 1) fazia ↑ "subir uma linha" e o
        // anel saltava pro Bravo (7 - 6), sem chegar ao cabeçalho neste toque.
        await tecla('ArrowUp');
        expect(anel()).toBeNull();
        // O cabeçalho entra pela busca (índice 0 da zona)
        expect(document.querySelector('.search-btn.tv-focused')).not.toBeNull();
    });

    it('🟡 dentro de ⭐ Favoritos: desfavoritar o último card e apertar ← anda um card', async () => {
        // Os 7 primeiros canais já são favoritos (o mesmo storage que o 🟡 usa)
        for (let id = 1; id <= 7; id++) {
            storage.toggleFavorite({ id: String(id), type: 'channel', title: NOMES[id - 1] });
        }
        await montarPagina(13);

        // Escolhe ⭐ Favoritos pelo controle: ↑ cabeçalho, → menu, OK, ↓, OK
        await tecla('ArrowUp');
        await tecla('ArrowRight');
        await tecla('Enter');
        await waitFor(() => expect(document.querySelector('.category-panel.open')).not.toBeNull());
        await tecla('ArrowDown');
        await tecla('Enter');
        // O painel fecha no fim da animação (timer de 300 ms do menu); só aí a
        // página volta a ouvir o controle. Teto folgado pra máquina carregada.
        await waitFor(() => expect(document.querySelector('.category-panel')).toBeNull(), { timeout: 3000 });
        expect(screen.queryByText('India')).toBeNull();

        // Golf é o 7º favorito: linha 1, coluna 0
        await tecla('ArrowDown');
        await tecla('ArrowDown');
        expect(anel()).toBe('Golf');

        // 🟡 desfavorita o Golf: ele some da ⭐ e o anel cai em Foxtrot (coluna 5)
        await tecla('ColorF2Yellow');
        expect(screen.queryByText('Golf')).toBeNull();
        expect(anel()).toBe('Foxtrot');

        // Antes a coluna vinha do índice do Golf (coluna 0) e o ← ia pra sidebar
        await tecla('ArrowLeft');
        expect(setFocusZone).not.toHaveBeenCalled();
        expect(anel()).toBe('Eco');
    });

    it('as setas que já funcionavam continuam: → e ↓ no fim da grade encolhida ficam no último card', async () => {
        await montarPagina(13);
        await tecla('ArrowDown');
        await tecla('ArrowDown');
        await tecla('ColorF3Blue');
        expect(anel()).toBe('Lima');

        await tecla('ArrowRight');
        expect(anel()).toBe('Lima');
        await tecla('ArrowDown');
        expect(anel()).toBe('Lima');
        // E daí o ← segue andando normalmente
        await tecla('ArrowLeft');
        expect(anel()).toBe('Kilo');
        expect(setFocusZone).not.toHaveBeenCalled();
    });

    it('com a grade intacta, ↑ sobe UMA linha por vez na mesma coluna e só a 1ª linha vai pro cabeçalho', async () => {
        // 13 canais: Mike é linha 2, coluna 0
        await montarPagina(13);
        await tecla('ArrowDown');
        await tecla('ArrowDown');
        expect(anel()).toBe('Mike');

        // ↑ anda 6 a partir do anel: linha 2 → linha 1 (não pula pra 1ª linha)
        await tecla('ArrowUp');
        expect(anel()).toBe('Golf');
        // Golf (índice 6) ainda está na linha 1: ↑ vai pro Alfa, não pro cabeçalho
        await tecla('ArrowUp');
        expect(anel()).toBe('Alfa');
        // Só da 1ª linha o ↑ sai da grade
        await tecla('ArrowUp');
        expect(anel()).toBeNull();
        expect(document.querySelector('.search-btn.tv-focused')).not.toBeNull();
        expect(setFocusZone).not.toHaveBeenCalled();
    });
});
