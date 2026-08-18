// AnimatedSearchBar Component - Matching Original App Animations
// Features: Pulse glow, icon bounce, slide expand, border flow
// TV: tvFocused destaca o botão; ref.open() expande e foca o input (abre o IME)

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import './AnimatedSearchBar.css';

export interface AnimatedSearchBarHandle {
    open: () => void;
}

interface AnimatedSearchBarProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    /** Destaque visual quando o foco do D-pad está no botão de busca */
    tvFocused?: boolean;
}

export const AnimatedSearchBar = forwardRef<AnimatedSearchBarHandle, AnimatedSearchBarProps>(
    function AnimatedSearchBar({ value, onChange, placeholder = 'Buscar...', tvFocused = false }, ref) {
        const [isExpanded, setIsExpanded] = useState(false);
        const [isFocused, setIsFocused] = useState(false);
        const inputRef = useRef<HTMLInputElement>(null);

        useImperativeHandle(ref, () => ({
            open: () => {
                setIsExpanded(true);
                // Foca direto: se já estava expandida (busca com texto), o
                // effect [isExpanded] não re-roda e o IME não abriria de novo
                inputRef.current?.focus();
            },
        }), []);

        useEffect(() => {
            if (isExpanded && inputRef.current) {
                inputRef.current.focus();
            }
        }, [isExpanded]);

        const handleToggle = () => {
            if (isExpanded && value === '') {
                setIsExpanded(false);
            } else if (isExpanded && value !== '') {
                onChange('');
            } else {
                setIsExpanded(true);
            }
        };

        const handleBlur = () => {
            setIsFocused(false);
            if (value === '') {
                setTimeout(() => setIsExpanded(false), 200);
            }
        };

        return (
            <div className="search-container">
                <div className={`search-input-wrapper ${isFocused ? 'focused' : ''} ${isExpanded ? 'expanded' : ''}`}>
                    <input
                        ref={inputRef}
                        type="text"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        onFocus={() => setIsFocused(true)}
                        onBlur={handleBlur}
                        placeholder={placeholder}
                        className={`search-input ${isExpanded ? 'expanded' : ''}`}
                    />
                </div>

                <button
                    onClick={handleToggle}
                    className={`search-btn ${isExpanded ? 'expanded' : ''} ${tvFocused ? 'tv-focused' : ''}`}
                >
                    {isExpanded && value ? (
                        <svg
                            className="search-btn-icon clear-icon"
                            width="22"
                            height="22"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="white"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    ) : (
                        <svg
                            className="search-btn-icon"
                            width="22"
                            height="22"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="white"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <circle cx="11" cy="11" r="7" />
                            <path d="m21 21-4.35-4.35" />
                        </svg>
                    )}
                </button>
            </div>
        );
    }
);
