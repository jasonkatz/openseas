import { useEffect } from 'react';
import { useStore } from '../store';
import { play } from '../lib/audio';

export function DuelInvite() {
  const invite = useStore((s) => s.duelInvite);
  const send = useStore((s) => s.send);
  useEffect(() => { if (invite) play('sword'); }, [invite]);
  if (!invite) return null;
  const answer = (accept: boolean) => {
    send(accept ? { t: 'duelAccept', id: invite.id } : { t: 'duelDecline', id: invite.id });
    useStore.setState({ duelInvite: null });
  };
  return (
    <div className="prompt" style={{ bottom: 'auto', top: 64, zIndex: 55, fontWeight: 700 }}>
      ⚔️ <b>{invite.fromName}</b> challenges you to a duel!
      <button className="btn small" onClick={() => answer(true)}>Draw steel</button>
      <button className="btn small ghost" onClick={() => answer(false)}>Decline</button>
    </div>
  );
}
