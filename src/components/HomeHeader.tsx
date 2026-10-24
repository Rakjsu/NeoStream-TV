// Cabeçalho da Home: data, saudação e relógio (T117).
//
// O relógio é DONO do próprio estado. Quando a hora morava no corpo da Home,
// o tique de cada minuto re-renderizava a página inteira — todas as fileiras
// de pôsteres — só pra trocar dois dígitos. Aqui o tique re-renderiza só este
// cabeçalho, e o `memo` (sem props) impede que as setas do D-pad, que
// re-renderizam a Home a cada aperto, desçam até ele.
//
// As classes (.home-header etc.) vêm do Home.css, importado pela Home.

import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { getLocale } from '../i18n';

/** Saudação pelo horário (como no app original). */
function saudacao(agora: Date): 'home_greeting_morning' | 'home_greeting_afternoon' | 'home_greeting_evening' {
    const hora = agora.getHours();
    if (hora < 12) return 'home_greeting_morning';
    if (hora < 18) return 'home_greeting_afternoon';
    return 'home_greeting_evening';
}

/** Milissegundos até o próximo minuto cheio do relógio. */
function ateOProximoMinuto(agora: Date): number {
    return 60000 - (agora.getSeconds() * 1000 + agora.getMilliseconds());
}

export const HomeHeader = memo(function HomeHeader() {
    const { t } = useTranslation();
    const [agora, setAgora] = useState(() => new Date());

    // Formatadores refeitos quando o idioma muda: toLocale*String com opções
    // constrói um Intl.DateTimeFormat novo a cada chamada.
    const { formatoHora, formatoData } = useMemo(() => {
        const locale = getLocale();
        return {
            formatoHora: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
            formatoData: new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }),
        };
    }, [t]);

    // Tique alinhado à VIRADA do minuto. O setInterval de 60 s contava da
    // montagem: aberta às 10:00:30, a Home mostrava "10:00" até 10:01:30. O
    // reagendamento a cada tique também realinha depois de a TV dormir.
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        const agendar = () => {
            timer = setTimeout(() => {
                setAgora(new Date());
                agendar();
            }, ateOProximoMinuto(new Date()));
        };
        agendar();
        return () => clearTimeout(timer);
    }, []);

    return (
        <header className="home-header">
            <div className="home-header-left">
                <div className="home-date">{formatoData.format(agora)}</div>
                <h1 className="home-greeting">
                    {t(saudacao(agora))}! <span className="waving-hand">👋</span>
                </h1>
                <p className="home-subtitle">{t('home_subtitle')}</p>
            </div>
            <div className="home-clock">{formatoHora.format(agora)}</div>
        </header>
    );
});
