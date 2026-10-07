import { ISLAND_BY_ID } from '@tidebound/shared';
import { useStore } from '../../store';
import { play } from '../../lib/audio';
import { DockPanel } from './DockPanel';
import { TavernPanel } from './TavernPanel';
import { ShipwrightPanel } from './ShipwrightPanel';
import { MarketPanel } from './MarketPanel';
import { BankPanel } from './BankPanel';
import { PalacePanel } from './PalacePanel';

/** Modal shown while standing inside one of the island's buildings. */
export function BuildingPanel() {
  const kind = useStore((s) => s.openBuilding);
  const islandId = useStore((s) => (s.room?.kind === 'island' ? s.room.islandId : null));
  const setOpenBuilding = useStore((s) => s.setOpenBuilding);
  const island = islandId ? ISLAND_BY_ID[islandId] : undefined;
  if (!kind || !island) return null;
  const building = island.buildings.find((b) => b.kind === kind);
  const close = () => { play('tap'); setOpenBuilding(null); };

  let body: React.ReactNode;
  switch (kind) {
    case 'dock': body = <DockPanel island={island} />; break;
    case 'tavern': body = <TavernPanel />; break;
    case 'shipwright': body = <ShipwrightPanel />; break;
    case 'market': body = <MarketPanel island={island} />; break;
    case 'bank': body = <BankPanel />; break;
    case 'palace': body = <PalacePanel island={island} />; break;
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="panel parchment modal" style={kind === 'palace' ? { width: 'min(900px, 100%)' } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div>
            <h2 style={{ lineHeight: 1 }}>{building?.name ?? kind}</h2>
            <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{island.name} · {kind}</div>
          </div>
          <button className="btn ghost small x" onClick={close} aria-label="Close" style={{ color: 'var(--ink)', borderColor: '#8a6a3c' }}>✕</button>
        </div>
        <div className="panel-body">{body}</div>
      </div>
    </div>
  );
}
