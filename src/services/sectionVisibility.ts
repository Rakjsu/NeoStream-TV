// Quais seções do catálogo aparecem no menu lateral: TV ao vivo e Filmes/Séries.
//
// As chaves (`includeTV`/`includeVOD`) nasceram nos dois checkboxes do Login e
// eram gravadas SÓ lá: quem desmarcava uma delas perdia a seção do menu e o
// único caminho de volta era sair da conta e digitar servidor, usuário e senha
// de novo no D-pad. As Configurações passam a gravar pelas mesmas chaves, e
// este módulo é o único lugar que sabe fazer isso direito:
//  - espelha na playlist ATIVA (o `playlistService.setActive` reaplica as
//    flags da entrada; sem isto, ir a outro provedor e voltar desfazia);
//  - avisa quem desenha o menu, que lê o localStorage no render e não teria
//    motivo pra re-renderizar sozinho.

import { playlistService } from './playlistService';

/** Evento no `window` disparado a cada mudança (mesmo padrão do `neostream-lang-change`). */
export const SECOES_EVENT = 'neostream-secoes-change';

export interface SecoesVisiveis {
    tv: boolean;
    vod: boolean;
}

export const sectionVisibility = {
    get(): SecoesVisiveis {
        try {
            return {
                tv: localStorage.getItem('includeTV') !== 'false',
                vod: localStorage.getItem('includeVOD') !== 'false',
            };
        } catch {
            return { tv: true, vod: true };
        }
    },

    /** Grava a(s) seção(ões) e avisa o menu. Devolve o estado resultante. */
    set(parcial: Partial<SecoesVisiveis>): SecoesVisiveis {
        const atual = sectionVisibility.get();
        const proximo: SecoesVisiveis = {
            tv: parcial.tv !== undefined ? parcial.tv : atual.tv,
            vod: parcial.vod !== undefined ? parcial.vod : atual.vod,
        };
        try {
            localStorage.setItem('includeTV', String(proximo.tv));
            localStorage.setItem('includeVOD', String(proximo.vod));
        } catch {
            // Quota cheia: pode ter gravado só a primeira chave. O menu relê o
            // localStorage, então vale o que ficou de fato — é o que segue.
        }
        const efetivo = sectionVisibility.get();
        playlistService.setActiveSections(efetivo.tv, efetivo.vod);
        window.dispatchEvent(new Event(SECOES_EVENT));
        return efetivo;
    },
};
