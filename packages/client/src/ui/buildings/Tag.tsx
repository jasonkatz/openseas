import type { CSSProperties, ReactNode } from 'react';

type Variant = 'plain' | 'good' | 'bad' | 'gold';

/** `.tag` recoloured for the parchment panels, where the stock chip is parchment-on-parchment. */
const COLORS: Record<Variant, CSSProperties> = {
  plain: { background: 'rgba(42,29,15,0.12)', color: '#4a2f12' },
  good: { background: 'rgba(63,185,80,0.28)', color: '#1d5a26' },
  bad: { background: 'rgba(229,72,77,0.22)', color: '#8a1a1e' },
  gold: { background: 'rgba(200,155,60,0.4)', color: '#5a3d10' },
};

export function Tag({ variant = 'plain', children, style }: { variant?: Variant; children: ReactNode; style?: CSSProperties }) {
  return <span className="tag" style={{ ...COLORS[variant], ...style }}>{children}</span>;
}
