// PosterPreguicoso.tsx — capa de grade que só existe enquanto o card está perto
// da tela (T088).
//
// `loading="lazy"` só chegou no Chrome 76. No Tizen 5.5 (Chromium 69) o
// atributo é ignorado em silêncio: cada `<img>` que entra no DOM baixa e
// DECODIFICA a imagem na hora — e o bitmap decodificado tem o tamanho da
// imagem original, não o do card. As grades de Filmes, Séries e TV ao vivo só
// crescem (`visibleCount` ganha fileiras a cada descida e nunca encolhe): quem
// desce um catálogo de milhares de títulos acumulava centenas de bitmaps num
// heap de ~1 GB, o cenário que já fez o sistema matar o app.
//
// Aqui o IntersectionObserver (Chrome 51) decide duas coisas:
//  - a capa só nasce quando a moldura entra na janela da `raiz` (+ `MARGEM`);
//  - a capa MORRE quando a moldura sai dela. O `<img>` sai do DOM e o bitmap
//    fica livre pra ser recolhido; voltar ao card pede a imagem de novo (vem do
//    cache HTTP). É isso que põe teto na memória de uma grade sem teto.
//
// A moldura (`className`) é sempre renderizada — ela ocupa o espaço, mostra o
// fundo de placeholder, carrega os selos (`children`) e é quem o observer
// vigia. O `<img>` é filho DIRETO dela, como antes: o fallback de
// `aspect-ratio` (`.movie-poster > img`) depende disso.
//
// Uma grade de centenas de cards NÃO cria centenas de observers: todos os
// cards da mesma raiz dividem um só, que é desligado e esquecido quando o
// último card sai (troca de página, filtro sem resultado).

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

/**
 * Quanto ANTES de aparecer a capa já é pedida (e quanto DEPOIS de sumir ela
 * ainda fica): ~2 fileiras de capa 2:3 numa tela de 1080p. Só vertical — as
 * grades rolam pra baixo.
 */
const MARGEM = '600px 0px';

type Aviso = (naJanela: boolean) => void;

interface Vigia {
    observer: IntersectionObserver;
    avisos: Map<Element, Aviso>;
}

/**
 * Um observer por raiz (`document` = o viewport). WeakMap: a raiz de uma
 * página que já saiu não fica presa aqui — nem ela nem a grade pendurada nela.
 */
const vigias = new WeakMap<Element | Document, Vigia>();

function criarVigia(raiz: Element | null): Vigia {
    const avisos = new Map<Element, Aviso>();
    const observer = new IntersectionObserver((entradas) => {
        // Em ordem: se o mesmo card entrou e saiu no mesmo lote, vale o
        // último estado. O aviso inicial (logo depois do observe) chega
        // com isIntersecting false pros de fora — o estado já é esse.
        // (isIntersecting existe desde o Chrome 58; o alvo é o 69.)
        for (const entrada of entradas) avisos.get(entrada.target)?.(entrada.isIntersecting);
    }, { root: raiz, rootMargin: MARGEM });
    return { observer, avisos };
}

/**
 * Passa a vigiar `alvo` no observer compartilhado da `raiz`, criando-o se
 * preciso. Devolve o desarme: tira o alvo e, se era o último, desliga o
 * observer e o esquece — a próxima grade nessa raiz ganha um novo.
 */
function vigiar(alvo: Element, raiz: Element | null, aviso: Aviso): () => void {
    const chave = raiz ?? document;
    const vigia = vigias.get(chave) ?? criarVigia(raiz);
    vigias.set(chave, vigia);
    vigia.avisos.set(alvo, aviso);
    vigia.observer.observe(alvo);
    return () => {
        vigia.observer.unobserve(alvo);
        vigia.avisos.delete(alvo);
        if (vigia.avisos.size > 0) return;
        vigia.observer.disconnect();
        vigias.delete(chave);
    };
}

// Sem observer (navegador antigo demais, ambiente de teste sem DOM completo)
// carrega na hora — o comportamento de antes. Nunca deixar o card sem capa.
const temObserver = () => typeof IntersectionObserver === 'function';

interface PosterPreguicosoProps {
    /** Classe da moldura (tamanho fixo + fundo de placeholder vêm dela). */
    className: string;
    /** Sem src (ou capa já marcada como quebrada): só a moldura e os filhos. */
    src?: string | null;
    alt: string;
    /** O contêiner que ROLA a grade. Contra o viewport, a margem não
     *  anteciparia nada: o overflow do contêiner corta a fileira de baixo. */
    raiz: RefObject<Element | null>;
    onError?: () => void;
    /** Selos, placeholder etc. — vêm depois da capa, como antes. */
    children?: ReactNode;
}

export function PosterPreguicoso({ className, src, alt, raiz, onError, children }: PosterPreguicosoProps) {
    const molduraRef = useRef<HTMLDivElement>(null);
    const [naJanela, setNaJanela] = useState(() => !temObserver());
    const temCapa = !!src;

    useEffect(() => {
        // Sem capa pra baixar (sem src, ou quebrada), ninguém vigia o card.
        if (!temCapa || !temObserver()) return;
        const moldura = molduraRef.current;
        if (!moldura) return;
        return vigiar(moldura, raiz.current ?? null, setNaJanela);
    }, [temCapa, raiz]);

    return (
        <div className={className} ref={molduraRef}>
            {src && naJanela && (
                <img decoding="async" src={src} alt={alt} onError={onError} />
            )}
            {children}
        </div>
    );
}
