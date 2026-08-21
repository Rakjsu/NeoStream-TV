// Assistente de primeira configuração (item 60).
//
// O app já tinha as duas primeiras etapas: escolher idioma (LanguageSelection)
// e entrar com a playlist (Login). Faltava o resto — tema e TMDB ficavam
// escondidos nas Configurações e quase ninguém chegava lá. Este overlay fecha
// o fluxo logo depois do primeiro login e nunca mais aparece.
//
// A flag vive em chave PRÓPRIA de propósito: gravar no objeto
// `neostream_settings` faria `storage.hasSettings()` virar true cedo demais e
// o app pularia a tela de idioma no boot seguinte.

import { useCallback, useMemo, useState } from 'react';
import { useTVNavigation } from '../hooks/useTVNavigation';
import {
    themeService,
    ACCENTS,
    ACCENT_IDS,
    BACKGROUNDS,
    BACKGROUND_IDS,
    type AccentId,
    type BackgroundId,
} from '../services/themeService';
import { a11yService, TEXT_SCALES, type TextScale } from '../services/a11yService';
import { storage } from '../services/storage';
import { setupWizard } from '../services/wizardState';
import './SetupWizard.css';

type StepId = 'fundo' | 'cor' | 'tamanho' | 'tmdb';

const STEPS: Array<{ id: StepId; title: string; help: string }> = [
    { id: 'fundo', title: 'Fundo da tela', help: 'AMOLED deixa o preto realmente preto e economiza energia em telas OLED.' },
    { id: 'cor', title: 'Cor de destaque', help: 'É a cor do foco: o que mostra onde você está na tela.' },
    { id: 'tamanho', title: 'Tamanho da interface', help: 'Se você assiste de longe ou enxerga pouco, aumente aqui.' },
    { id: 'tmdb', title: 'Capas e sinopses (opcional)', help: 'Com uma chave do TMDB o app busca capas e sinopses melhores. Dá pra fazer depois nas Configurações.' },
];

interface SetupWizardProps {
    onFinish: () => void;
}

export function SetupWizard({ onFinish }: SetupWizardProps) {
    const [stepIndex, setStepIndex] = useState(0);
    const [background, setBackground] = useState<BackgroundId>(() => themeService.getBackground());
    const [accent, setAccent] = useState<AccentId>(() => themeService.getAccent());
    const [textScale, setTextScale] = useState<TextScale>(() => a11yService.getTextScale());
    const [optionIndex, setOptionIndex] = useState(0);

    const step = STEPS[stepIndex];

    // Opções da etapa atual, já com o efeito de escolher cada uma
    const options = useMemo<Array<{ label: string; apply: () => void; selected: boolean; color?: string }>>(() => {
        if (step.id === 'fundo') {
            return BACKGROUND_IDS.map(id => ({
                label: BACKGROUNDS[id],
                selected: background === id,
                apply: () => { themeService.setBackground(id); setBackground(id); },
            }));
        }
        if (step.id === 'cor') {
            return ACCENT_IDS.map(id => ({
                label: ACCENTS[id].label,
                color: ACCENTS[id].hex,
                selected: accent === id,
                apply: () => { themeService.setAccent(id); setAccent(id); },
            }));
        }
        if (step.id === 'tamanho') {
            return TEXT_SCALES.map(scale => ({
                label: `${scale}%`,
                selected: textScale === scale,
                apply: () => { a11yService.setTextScale(scale); setTextScale(scale); },
            }));
        }
        return [
            { label: 'Tenho uma chave — configuro depois', selected: false, apply: () => { } },
            { label: 'Não vou usar TMDB', selected: !storage.getTmdbApiKey(), apply: () => { } },
        ];
    }, [step.id, background, accent, textScale]);

    const goNext = useCallback(() => {
        if (stepIndex < STEPS.length - 1) {
            setStepIndex(prev => prev + 1);
            setOptionIndex(0);
            return;
        }
        setupWizard.markDone();
        onFinish();
    }, [stepIndex, onFinish]);

    const goBack = useCallback(() => {
        if (stepIndex === 0) {
            // Sair no primeiro passo é uma escolha legítima: quem já sabe
            // mexer não deve ser obrigado a passar por tudo
            setupWizard.markDone();
            onFinish();
            return;
        }
        setStepIndex(prev => prev - 1);
        setOptionIndex(0);
    }, [stepIndex, onFinish]);

    useTVNavigation({
        onNavigate: (direction) => {
            if (direction === 'left') setOptionIndex(prev => Math.max(0, prev - 1));
            else if (direction === 'right') setOptionIndex(prev => Math.min(options.length - 1, prev + 1));
            else if (direction === 'down') goNext();
            else if (direction === 'up' && stepIndex > 0) goBack();
        },
        onEnter: () => {
            options[optionIndex]?.apply();
            goNext();
        },
        onBack: goBack,
    });

    return (
        <div className="wizard-overlay">
            <div className="wizard-panel">
                <div className="wizard-steps">
                    <span className="wizard-done">✓ Idioma</span>
                    <span className="wizard-done">✓ Playlist</span>
                    {STEPS.map((item, index) => (
                        <span
                            key={item.id}
                            className={`wizard-step ${index === stepIndex ? 'current' : ''} ${index < stepIndex ? 'past' : ''}`}
                        >
                            {index < stepIndex ? '✓ ' : ''}{item.title}
                        </span>
                    ))}
                </div>

                <h1 className="wizard-title">{step.title}</h1>
                <p className="wizard-help">{step.help}</p>

                <div className="wizard-options">
                    {options.map((option, index) => (
                        <button
                            key={option.label}
                            className={`wizard-option ${option.selected ? 'selected' : ''} ${index === optionIndex ? 'tv-focused' : ''}`}
                            style={option.color ? { borderColor: option.color } : undefined}
                            onClick={() => { option.apply(); goNext(); }}
                        >
                            {option.color && <span className="wizard-swatch" style={{ backgroundColor: option.color }} />}
                            {option.label}
                        </button>
                    ))}
                </div>

                <div className="wizard-footer">
                    ◀ ▶ escolhe · OK confirma e avança · Voltar {stepIndex === 0 ? 'pula tudo' : 'volta um passo'}
                </div>
            </div>
        </div>
    );
}
