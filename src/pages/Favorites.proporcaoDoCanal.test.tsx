// @vitest-environment jsdom
//
// ⭐ O canal aberto pelos Favoritos esquecia a proporção do canal (T005).
//
// A TV ao vivo e a Busca Global abrem o canal com `contentKey` =
// `live-<stream_id>`, e é por ela que o VideoPlayer lembra a proporção e a
// qualidade manual. O player ao vivo dos Favoritos não passava chave: o canal
// que o usuário esticou na TV ao vivo abria com tarja preta pelos Favoritos, e
// o que ele escolhia ali se perdia ao fechar.
//
// O teste monta os Favoritos DE VERDADE, com o VideoPlayer DE VERDADE, e abre
// o canal pelo controle (OK no card).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { installFakeStorage } from '../testing/fakeStorage';
import { api } from '../services/api';
import { storage } from '../services/storage';
import { aspectPrefs } from '../services/liveExtras';
import { FocusContext } from '../contexts/FocusContext';
import { Favorites } from './Favorites';

const OK = 13;
function tecla(keyCode: number): void {
    act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '', keyCode, bubbles: true, cancelable: true }));
    });
}

const video = () => document.querySelector('video.video-element');
function proporcao(): string | null {
    const m = video()?.className.match(/\baspect-(\w+)/);
    return m ? m[1] : null;
}

function abrirPrimeiroFavorito() {
    render(
        <FocusContext.Provider value={{ focusZone: 'content', setFocusZone: () => { /* não interessa */ } }}>
            <Favorites />
        </FocusContext.Provider>
    );
    tecla(OK);
    expect(video(), 'o OK no card não abriu o player do canal').not.toBeNull();
}

beforeEach(() => {
    installFakeStorage();
    vi.spyOn(api, 'getLiveStreamUrl').mockImplementation(id => `http://provedor.invalid/live/${id}.ts`);
    // jsdom não implementa mídia; o player só precisa que as chamadas existam.
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.playing;
});

describe('Favoritos: canal ao vivo usa a proporção do canal', () => {
    it('abre com a proporção escolhida na TV ao vivo, e o que se escolhe aqui vale lá', () => {
        // Favorito de canal como a TV ao vivo grava (id = stream_id em texto)
        storage.addFavorite({ id: '7', type: 'channel', title: 'Canal Sete' });
        // O que o player da TV ao vivo grava ao esticar o canal 7
        aspectPrefs.set('live-7', 'stretch');

        abrirPrimeiroFavorito();
        expect(video()?.getAttribute('src')).toBe('http://provedor.invalid/live/7.ts');
        expect(proporcao()).toBe('stretch');

        const botao = document.querySelector('button[title="Proporção"]');
        expect(botao, 'botão de proporção não está na tela').not.toBeNull();
        act(() => { fireEvent.click(botao!); });
        expect(proporcao()).toBe('fill');
        // É daqui que a TV ao vivo lê a proporção do canal 7
        expect(aspectPrefs.get('live-7')).toBe('fill');
    });

    it('outro canal não herda a proporção', () => {
        storage.addFavorite({ id: '8', type: 'channel', title: 'Canal Oito' });
        aspectPrefs.set('live-7', 'stretch');

        abrirPrimeiroFavorito();
        expect(proporcao()).toBe('original');
    });
});
