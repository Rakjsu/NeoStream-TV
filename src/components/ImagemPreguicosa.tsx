// ImagemPreguicosa.tsx — carregamento preguiçoso que EXISTE no Chromium 69.
//
// `loading="lazy"` só chegou no Chrome 76. No Tizen 5.5 (Chromium 69) o
// atributo é ignorado em silêncio: uma lista de 24 episódios pedia as 24
// miniaturas de uma vez com ~4 linhas na tela (T031). O IntersectionObserver
// existe desde o Chrome 51 — é ele que decide quando a imagem nasce.
//
// A moldura (`className`) é renderizada sempre: é ela que ocupa o espaço e
// mostra o fundo de placeholder, e é ela que o observer vigia. O `<img>` só
// aparece quando a moldura entra na janela da `raiz`.
//
// `raiz` importa: dentro de uma lista que rola sozinha (overflow), a `margem`
// (`rootMargin`) só alarga a caixa da RAIZ. Contra o viewport ela alargaria a
// tela, mas a lista continuaria cortando o item de baixo no próprio overflow —
// a próxima linha nunca seria pedida antes de aparecer.

import { useEffect, useRef, useState, type RefObject } from 'react';

interface ImagemPreguicosaProps {
    /** Classe da moldura (tamanho fixo + fundo de placeholder vêm dela). */
    className: string;
    src?: string | null;
    /** Elemento que rola e em cuja janela a imagem precisa entrar. */
    raiz?: RefObject<Element | null>;
    /** `rootMargin`: quanto ANTES de aparecer a imagem já é pedida. */
    margem?: string;
}

// Sem observer (navegador antigo demais, ambiente de teste sem DOM completo)
// carrega na hora — o comportamento de antes. Nunca deixar a moldura vazia.
const temObserver = () => typeof IntersectionObserver === 'function';

export function ImagemPreguicosa({ className, src, raiz, margem = '0px' }: ImagemPreguicosaProps) {
    const molduraRef = useRef<HTMLSpanElement>(null);
    const [naTela, setNaTela] = useState(() => !temObserver());

    useEffect(() => {
        if (naTela || !src) return;
        const moldura = molduraRef.current;
        if (!moldura) return;
        const observer = new IntersectionObserver((entradas) => {
            // O navegador avisa TODO alvo logo depois do observe(), inclusive
            // os que estão fora — esses chegam com isIntersecting false.
            // (isIntersecting existe desde o Chrome 58; o alvo é o 69.)
            if (entradas.some(e => e.isIntersecting)) setNaTela(true);
        }, { root: raiz?.current ?? null, rootMargin: margem });
        observer.observe(moldura);
        // Desarma quando a imagem já veio (naTela muda e o efeito é refeito,
        // saindo no `return` lá de cima) e quando a moldura desmonta.
        return () => observer.disconnect();
    }, [naTela, src, raiz, margem]);

    return (
        <span className={className} ref={molduraRef}>
            {src && naTela && (
                <img
                    src={src}
                    alt=""
                    // Imagem quebrada é comum: o provedor aponta pra um host
                    // que já saiu do ar. Some sem deixar o ícone quebrado.
                    onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                />
            )}
        </span>
    );
}
