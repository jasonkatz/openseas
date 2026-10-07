import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

/** One-time contextual tips keyed on game state. Dismissed tips are remembered per device. */
const TIPS: { id: string; when: (s: ReturnType<typeof useStore.getState>) => boolean; text: string }[] = [
  { id: 'ashore', when: (s) => s.room?.kind === 'island', text: 'Welcome ashore! Walk with WASD or click. The harbour office at the bottom of the island has ships you can board — navy sloops are free.' },
  { id: 'deck', when: (s) => s.room?.kind === 'ship' && s.room.ship.status.kind === 'docked', text: 'You\'re on deck. Click a station to work its puzzle. The captain (⭐) sets the course with "Set sail" — or hires deckhands to fill empty stations.' },
  { id: 'sea', when: (s) => s.room?.kind === 'ship' && s.room.ship.status.kind === 'sailing', text: 'Under way! Sails make her faster, Bilge keeps her dry, Guns load cannons for a fight. Brigands roam the open water…' },
  { id: 'battle', when: (s) => !!s.battle, text: 'Battle! The captain queues up to four moves and broadsides per 20s turn. Everyone else: keep puzzling — the ship needs sail power and loaded guns. Grapple when adjacent to board.' },
  { id: 'sword', when: (s) => !!s.swordfight, text: 'Boarding action! Drop pairs, cluster colours, and land a ★ breaker next to its colour to clear the cluster and send sword strikes at the brigands.' },
];

export function Tips() {
  const [tip, setTip] = useState<{ id: string; text: string } | null>(null);
  const seen = useRef<Set<string>>(new Set(JSON.parse(safeGet('tidebound.tips') ?? '[]') as string[]));

  useEffect(() => useStore.subscribe((s) => {
    if (tip) return;
    for (const t of TIPS) {
      if (!seen.current.has(t.id) && t.when(s)) { setTip({ id: t.id, text: t.text }); break; }
    }
  }), [tip]);

  if (!tip) return null;
  const dismiss = () => {
    seen.current.add(tip.id);
    try { localStorage.setItem('tidebound.tips', JSON.stringify([...seen.current])); } catch { /* ignore */ }
    setTip(null);
  };
  return (
    <div className="prompt" style={{ bottom: 18, left: 'auto', right: 14, transform: 'none', maxWidth: 440, zIndex: 50, fontWeight: 600, lineHeight: 1.35 }}>
      <span style={{ fontSize: 20 }}>🦜</span>
      <span>{tip.text}</span>
      <button className="btn small" onClick={dismiss}>Aye</button>
    </div>
  );
}

function safeGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
