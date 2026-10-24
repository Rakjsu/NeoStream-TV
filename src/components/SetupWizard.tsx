// Assistente de primeira configuração (item 60).
//
// O app já tinha as duas primeiras etapas: escolher idioma (LanguageSelection)
// e entrar com a playlist (Login). Faltava o resto — tema e tamanho da
// interface ficavam escondidos nas Configurações e quase ninguém chegava lá.
// Este overlay fecha o fluxo logo depois do primeiro login e nunca mais aparece.
//
// Toda opção aqui GRAVA a escolha (SetupWizard.opcoesGravam.test.tsx). A
// etapa do TMDB saiu porque as duas opções dela não gravavam nada: a chave
// fica nas Configurações (Integração TMDB), que têm o campo de verdade, e
// digitar a chave no D-pad não cabe num passo de boas-vindas.
//
// A flag vive em chave PRÓPRIA de propósito: gravar no objeto
// `neostream_settings` faria `storage.hasSettings()` virar true cedo demais e
// o app pularia a tela de idioma no boot seguinte.

import { useCallback, useMemo, useState } from 'react';
import { useTVNavigation } from '../hooks/useTVNavigation';
import { useTranslation } from '../hooks/useTranslation';
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
import { setupWizard } from '../services/wizardState';
import './SetupWizard.css';

type StepId = 'fundo' | 'cor' | 'tamanho';

interface SetupWizardProps {
    onFinish: () => void;
}

export function SetupWizard({ onFinish }: SetupWizardProps) {
    const { t } = useTranslation();
    const STEPS = useMemo<Array<{ id: StepId; title: string; help: string }>>(() => [
        { id: 'fundo', title: t('wiz_step_bg'), help: t('wiz_step_bg_help') },
        { id: 'cor', title: t('wiz_step_accent'), help: t('wiz_step_accent_help') },
        { id: 'tamanho', title: t('wiz_step_size'), help: t('wiz_step_size_help') },
    ], [t]);
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
        return TEXT_SCALES.map(scale => ({
            label: `${scale}%`,
            selected: textScale === scale,
            apply: () => { a11yService.setTextScale(scale); setTextScale(scale); },
        }));
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
        <div className="wizard-overlay ns-surface">
            <div className="wizard-panel">
                <div className="wizard-steps">
                    <span className="wizard-done">{t('wiz_done_lang')}</span>
                    <span className="wizard-done">{t('wiz_done_playlist')}</span>
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
                    {t('wiz_footer')} {stepIndex === 0 ? t('wiz_skip') : t('wiz_prev')}
                </div>
            </div>
        </div>
    );
}
