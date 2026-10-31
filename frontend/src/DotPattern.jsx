import { useRef, useEffect } from 'react';
import { cn } from './lib/utils';

const FADE = {
  bottom: 'dot-fade-bottom',
  none: '',
  radial: 'dot-fade-radial',
  top: 'dot-fade-top',
};

const STRENGTH = { medium: 0.8, strong: 1, subtle: 0.5 };

const px = (value) => (value === undefined ? undefined : `${value}px`);

const duration = (speed) =>
  speed === undefined || speed <= 0 ? undefined : `${12 / speed}s`;

export function DotPattern({
  dotColor,
  dotSize,
  fade = 'radial',
  gap,
  glowColor,
  intensity,
  interactive = true,
  proximity,
  speed,
  className = '',
  children,
  ...rest
}) {
  const containerRef = useRef(null);
  const glow = useRef(null);

  useEffect(() => {
    if (!interactive) return;

    const handlePointerMove = (event) => {
      const node = glow.current;
      if (!node || event.pointerType === 'touch') return;
      const box = containerRef.current?.getBoundingClientRect();
      if (!box) return;
      node.style.setProperty('--dot-pattern-x', `${event.clientX - box.left}px`);
      node.style.setProperty('--dot-pattern-y', `${event.clientY - box.top}px`);
      node.setAttribute(
        'data-pointer',
        node.hasAttribute('data-pointer') ? 'move' : 'enter'
      );
    };

    const handlePointerLeave = () => {
      glow.current?.removeAttribute('data-pointer');
    };

    window.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [interactive]);

  return (
    <div
      ref={containerRef}
      className={cn('dot-pattern-container', className)}
      data-slot="dot-pattern"
      {...rest}
    >
      <div
        aria-hidden="true"
        className={cn('dot-pattern-field', FADE[fade] || '')}
        data-slot="dot-pattern-field"
        style={{
          '--dot-pattern-color': dotColor,
          '--dot-pattern-duration': duration(speed),
          '--dot-pattern-gap': px(gap),
          '--dot-pattern-glow': glowColor,
          '--dot-pattern-proximity': px(proximity),
          '--dot-pattern-size': px(dotSize),
          '--dot-pattern-strength':
            intensity === undefined ? undefined : STRENGTH[intensity],
        }}
      >
        <div
          className="dot-pattern-dots"
          data-slot="dot-pattern-dots"
        >
          {(speed === undefined || speed > 0) && (
            <div
              className="dot-pattern-wave"
              data-slot="dot-pattern-wave"
            />
          )}
        </div>
        {interactive ? (
          <div
            className="dot-pattern-lit"
            data-slot="dot-pattern-lit"
          >
            <div
              className="dot-pattern-glow"
              data-slot="dot-pattern-glow"
              ref={glow}
            />
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
