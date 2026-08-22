// A chave do trailer (item 18).
//
// O sintoma de errar aqui é o pior tipo: o botão de trailer some para parte
// dos provedores, sem erro, sem log e sem nada que explique — porque o campo
// `youtube_trailer` do Xtream chega em três formatos diferentes.

import { describe, it, expect } from 'vitest';
import { extrairChaveYoutube } from './trailer';

const CHAVE = 'dQw4w9WgXcQ';

describe('extrairChaveYoutube', () => {
    it.each([
        CHAVE,
        `https://www.youtube.com/watch?v=${CHAVE}`,
        `http://youtube.com/watch?v=${CHAVE}&t=30s`,
        `https://youtu.be/${CHAVE}`,
        `https://www.youtube.com/embed/${CHAVE}`,
        `https://www.youtube.com/v/${CHAVE}`,
        `https://www.youtube.com/shorts/${CHAVE}`,
        `  https://youtu.be/${CHAVE}  `,
    ])('reconhece o formato: %s', (bruto) => {
        expect(extrairChaveYoutube(bruto)).toBe(CHAVE);
    });

    it('a chave pode ter hífen e underline', () => {
        expect(extrairChaveYoutube('a_b-c1234XY')).toBe('a_b-c1234XY');
    });

    // Campo vazio é o caso mais comum: a maioria dos painéis não preenche.
    // Devolver '' faz o botão não existir, que é o certo.
    it.each(['', '   ', 'null', 'N/A', 'https://exemplo.com/video.mp4'])(
        'campo sem trailer devolve vazio: %s', (bruto) => {
            expect(extrairChaveYoutube(bruto)).toBe('');
        });

    it('não confunde um pedaço de texto com a chave', () => {
        expect(extrairChaveYoutube('trailer')).toBe('');     // menos de 11
        expect(extrairChaveYoutube('a'.repeat(20))).toBe(''); // mais de 11
    });

    it('entrada nula não quebra', () => {
        expect(extrairChaveYoutube(undefined as unknown as string)).toBe('');
    });
});
