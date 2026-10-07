import { useEffect, useRef, useState } from 'react';
import type { Avatar } from '@tidebound/shared';
import { savedLogin, useStore } from '../store';
import { CLOTH, HAIR, HAIR_NAMES, HAT_NAMES, SKIN, drawPirate } from '../lib/avatar';
import { fitCanvas } from '../lib/canvas';
import { play } from '../lib/audio';

function randomAvatar(): Avatar {
  const r = (n: number) => Math.floor(Math.random() * n);
  return { skin: r(6), hair: r(8), hairColor: r(6), shirt: r(10), pants: r(10), hat: r(6) };
}

export function Login() {
  const saved = savedLogin();
  const [name, setName] = useState(saved.name);
  const [avatar, setAvatar] = useState<Avatar>(saved.avatar ?? randomAvatar());
  const login = useStore((s) => s.login);
  const error = useStore((s) => s.loginError);
  const status = useStore((s) => s.status);
  const token = useStore((s) => s.token);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const draw = (t: number) => {
      const c = canvas.current;
      if (!c) return;
      const ctx = fitCanvas(c, 200, 220);
      ctx.clearRect(0, 0, 200, 220);
      // little dock
      ctx.fillStyle = '#6b3f22';
      ctx.fillRect(30, 180, 140, 14);
      ctx.fillStyle = '#4a2f12';
      for (let i = 0; i < 7; i++) ctx.fillRect(34 + i * 20, 180, 2, 14);
      ctx.fillStyle = 'rgba(58,143,199,0.5)';
      ctx.fillRect(0, 194, 200, 26);
      const facing = Math.floor(t / 1600) % 4 === 3 ? 3 : Math.floor(t / 1600) % 4 === 1 ? 1 : 2;
      drawPirate(ctx, 100, 182, 110, avatar, facing, 0);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [avatar]);

  const set = (k: keyof Avatar, v: number) => { play('tap'); setAvatar({ ...avatar, [k]: v }); };
  const cycle = (k: keyof Avatar, n: number, d: number) => set(k, (avatar[k] + d + n) % n);

  const submit = () => {
    const n = name.trim();
    if (n.length < 2) return;
    play('bell');
    login(n, avatar);
  };

  return (
    <div className="login">
      <div className="panel login-card">
        <div className="hero">
          <h1>Tidebound</h1>
          <p className="fell" style={{ fontSize: 18, color: 'var(--parchment)' }}>Puzzles are the verbs. Ships are the nouns. The sea is the sentence.</p>
          <p className="muted">Pump the bilge, trim the sails, patch the hull and load the guns — every job aboard is a puzzle, and every puzzle moves the ship. Board a navy sloop with strangers, found a crew, hunt brigands across a hex ocean, and cross blades when you grapple.</p>
          <div className="row wrap" style={{ marginTop: 'auto', gap: 6 }}>
            {['🪣 Bilging', '⛵ Sailing', '🔨 Carpentry', '💣 Gunnery', '🧭 Navigation', '⚔️ Swordfight'].map((t) => <span className="pill" key={t}>{t}</span>)}
          </div>
        </div>
        <div className="form">
          <h2>Who sails today?</h2>
          <div className="row">
            <canvas ref={canvas} style={{ borderRadius: 12, background: 'rgba(0,0,0,0.25)' }} />
            <div className="col" style={{ flex: 1 }}>
              <label className="muted" style={{ fontSize: 12 }}>Pirate name</label>
              <input className="input" value={name} maxLength={20} placeholder="e.g. Marla Saltbeard" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} autoFocus />
              {token && saved.name && <div className="muted" style={{ fontSize: 12 }}>A saved pirate is on this device. Use the same name to reclaim them.</div>}
              <button className="btn secondary small" onClick={() => setAvatar(randomAvatar())}>🎲 Random look</button>
            </div>
          </div>
          <div className="avatar-opts">
            <div className="opt">Skin<div className="swatches">{SKIN.map((c, i) => <span key={c} className={`swatch ${avatar.skin === i ? 'on' : ''}`} style={{ background: c }} onClick={() => set('skin', i)} />)}</div></div>
            <div className="opt">Hair colour<div className="swatches">{HAIR.map((c, i) => <span key={c} className={`swatch ${avatar.hairColor === i ? 'on' : ''}`} style={{ background: c }} onClick={() => set('hairColor', i)} />)}</div></div>
            <div className="opt">Hair<div className="row"><button className="btn ghost small" onClick={() => cycle('hair', 8, -1)}>◀</button><span style={{ flex: 2, textAlign: 'center' }}>{HAIR_NAMES[avatar.hair]}</span><button className="btn ghost small" onClick={() => cycle('hair', 8, 1)}>▶</button></div></div>
            <div className="opt">Shirt<div className="swatches">{CLOTH.map((c, i) => <span key={c} className={`swatch ${avatar.shirt === i ? 'on' : ''}`} style={{ background: c }} onClick={() => set('shirt', i)} />)}</div></div>
            <div className="opt">Trousers<div className="swatches">{CLOTH.map((c, i) => <span key={c} className={`swatch ${avatar.pants === i ? 'on' : ''}`} style={{ background: c }} onClick={() => set('pants', i)} />)}</div></div>
            <div className="opt">Hat<div className="row"><button className="btn ghost small" onClick={() => cycle('hat', 6, -1)}>◀</button><span style={{ flex: 2, textAlign: 'center' }}>{HAT_NAMES[avatar.hat]}</span><button className="btn ghost small" onClick={() => cycle('hat', 6, 1)}>▶</button></div></div>
          </div>
          {error && <div className="tag bad" style={{ padding: 8, textTransform: 'none', letterSpacing: 0 }}>{error}</div>}
          <button className="btn" onClick={submit} disabled={name.trim().length < 2 || status !== 'open'}>
            {status === 'open' ? '⚓ Come ashore' : 'Connecting to the ocean…'}
          </button>
        </div>
      </div>
    </div>
  );
}
