// Content Row Component - Horizontal carousel for TV

import { useRef, useState } from 'react';
import './ContentRow.css';

interface ContentItem {
    id: number;
    title: string;
    image: string;
    type: 'live' | 'movie' | 'series';
    rating?: number;
}

interface ContentRowProps {
    title: string;
    items: ContentItem[];
    onSelect?: (item: ContentItem) => void;
}

export function ContentRow({ title, items, onSelect }: ContentRowProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [focusedIndex, setFocusedIndex] = useState(-1);

    const scrollToIndex = (index: number) => {
        if (scrollRef.current && index >= 0) {
            const container = scrollRef.current;
            const cards = container.querySelectorAll('.content-card');
            const card = cards[index] as HTMLElement;
            if (card) {
                const containerRect = container.getBoundingClientRect();
                const cardRect = card.getBoundingClientRect();
                const scrollLeft = card.offsetLeft - containerRect.width / 2 + cardRect.width / 2;
                container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
            }
        }
    };

    const handleFocus = (index: number) => {
        setFocusedIndex(index);
        scrollToIndex(index);
    };

    return (
        <section className="content-row">
            <h2 className="content-row-title">{title}</h2>
            <div className="content-row-scroll" ref={scrollRef}>
                <div className="content-row-items">
                    {items.map((item, index) => (
                        <div
                            key={item.id}
                            className={`content-card ${focusedIndex === index ? 'tv-focused' : ''}`}
                            data-focusable="true"
                            tabIndex={0}
                            onFocus={() => handleFocus(index)}
                            onClick={() => onSelect?.(item)}
                        >
                            <div className="content-card-image-wrap">
                                {item.image ? (
                                    <img decoding="async"
                                        src={item.image}
                                        alt={item.title}
                                        className="content-card-image"
                                        loading="lazy"
                                        onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = 'none';
                                        }}
                                    />
                                ) : (
                                    <div className="content-card-placeholder">
                                        {item.type === 'live' ? '📺' : item.type === 'movie' ? '🎬' : '📺'}
                                    </div>
                                )}
                                {item.type === 'live' && (
                                    <span className="content-card-live-badge">AO VIVO</span>
                                )}
                            </div>
                            <div className="content-card-info">
                                <h3 className="content-card-title">{item.title}</h3>
                                {item.rating !== undefined && item.rating > 0 && (
                                    <div className="content-card-rating">
                                        ⭐ {item.rating.toFixed(1)}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
