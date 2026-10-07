import { create } from 'zustand';
import type {
  Avatar, BattleState, BuildingKind, ClientMsg, Crew, Pirate, PresenceEntry, PuzzleConfig, PuzzleId, RoomView, ServerMsg, Ship, SwordfightView, CommodityId,
} from '@tidebound/shared';
import { net } from './net';
import { setMuted } from './lib/audio';

export interface ChatMsg { id: number; from: string; fromId: string; channel: 'local' | 'crew' | 'global' | 'system'; text: string; at: number }
export interface Toast { id: number; text: string; kind: 'info' | 'good' | 'bad' }
export interface ActivePuzzle { sessionId: string; puzzle: PuzzleId; seed: number; config: PuzzleConfig; practice: boolean }
export interface PuzzleReward { puzzle: PuzzleId; points: number; performance: number; poe: number }
export interface BattleEnd { won: boolean; booty: { poe: number; goods: Partial<Record<CommodityId, number>> } | null; summary: string; at: number }

export interface AppState {
  status: 'connecting' | 'open' | 'closed';
  pirate: Pirate | null;
  token: string | null;
  crew: Crew | null;
  crews: Crew[];
  room: RoomView | null;
  presence: PresenceEntry[];
  ships: Ship[];
  chat: ChatMsg[];
  unread: number;
  toasts: Toast[];
  battle: BattleState | null;
  battleEnd: BattleEnd | null;
  swordfight: SwordfightView | null;
  puzzle: ActivePuzzle | null;
  /** Puzzle requested (waiting for seed). */
  puzzlePending: PuzzleId | null;
  lastReward: PuzzleReward | null;
  leaderboard: { name: string; puzzle: PuzzleId; best: number; rating: number }[];
  openBuilding: BuildingKind | null;
  duelInvite: { id: string; fromId: string; fromName: string } | null;
  muted: boolean;
  loginError: string | null;
  serverNow: () => number;

  // actions
  send: (m: ClientMsg) => void;
  login: (name: string, avatar: Avatar) => void;
  logout: () => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  setOpenBuilding: (b: BuildingKind | null) => void;
  setMuted: (m: boolean) => void;
  startPuzzle: (puzzle: PuzzleId, practice: boolean) => void;
  endPuzzle: () => void;
  clearReward: () => void;
  clearBattleEnd: () => void;
  clearSwordfight: () => void;
  markChatRead: () => void;
}

let nextId = 1;
const LS_TOKEN = 'tidebound.token';
const LS_NAME = 'tidebound.name';
const LS_AVATAR = 'tidebound.avatar';

export const useStore = create<AppState>((set, get) => ({
  status: 'connecting',
  pirate: null,
  token: safeGet(LS_TOKEN),
  crew: null,
  crews: [],
  room: null,
  presence: [],
  ships: [],
  chat: [],
  unread: 0,
  toasts: [],
  battle: null,
  battleEnd: null,
  swordfight: null,
  puzzle: null,
  puzzlePending: null,
  lastReward: null,
  leaderboard: [],
  openBuilding: null,
  duelInvite: null,
  muted: safeGet('tidebound.muted') === '1',
  loginError: null,
  serverNow: () => net.serverNow(),

  send: (m) => net.send(m),

  login: (name, avatar) => {
    safeSet(LS_NAME, name);
    safeSet(LS_AVATAR, JSON.stringify(avatar));
    set({ loginError: null });
    const token = get().token ?? undefined;
    net.send({ t: 'login', name, token, avatar });
  },

  logout: () => {
    safeDel(LS_TOKEN);
    set({ pirate: null, token: null, room: null, crew: null, puzzle: null, battle: null, swordfight: null });
    net.close();
    setTimeout(() => net.connect(), 200);
  },

  toast: (text, kind = 'info') => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }].slice(-5) }));
    setTimeout(() => get().dismissToast(id), 4200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setOpenBuilding: (b) => set({ openBuilding: b }),
  setMuted: (m) => { setMuted(m); safeSet('tidebound.muted', m ? '1' : '0'); set({ muted: m }); },

  startPuzzle: (puzzle, practice) => {
    set({ puzzlePending: puzzle });
    net.send({ t: 'puzzleStart', puzzle, practice });
  },
  endPuzzle: () => {
    const p = get().puzzle;
    if (p) net.send({ t: 'puzzleEnd', sessionId: p.sessionId });
    set({ puzzle: null, puzzlePending: null });
  },
  clearReward: () => set({ lastReward: null }),
  clearBattleEnd: () => set({ battleEnd: null }),
  clearSwordfight: () => set({ swordfight: null }),
  markChatRead: () => set({ unread: 0 }),
}));

export function savedLogin(): { name: string; avatar: Avatar | null } {
  let avatar: Avatar | null = null;
  try { const a = safeGet(LS_AVATAR); if (a) avatar = JSON.parse(a) as Avatar; } catch { /* ignore */ }
  return { name: safeGet(LS_NAME) ?? '', avatar };
}

function safeGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
function safeDel(k: string): void { try { localStorage.removeItem(k); } catch { /* ignore */ } }

/** Wire network messages into the store. Called once from main.tsx. */
export function bindNet(): void {
  setMuted(useStore.getState().muted);
  net.onStatus = (status) => {
    useStore.setState({ status });
    if (status === 'open') {
      // Auto re-login after reconnect.
      const { token } = useStore.getState();
      const saved = savedLogin();
      if (token && saved.name) net.send({ t: 'login', name: saved.name, token, avatar: saved.avatar ?? undefined });
    }
  };
  net.on((msg: ServerMsg) => {
    const s = useStore.getState();
    switch (msg.t) {
      case 'welcome':
        safeSet(LS_TOKEN, msg.token);
        useStore.setState({ pirate: msg.pirate, token: msg.token, loginError: null, puzzle: null, puzzlePending: null, battle: null, swordfight: null });
        break;
      case 'error':
        if (!s.pirate) useStore.setState({ loginError: msg.msg });
        else s.toast(msg.msg, 'bad');
        break;
      case 'toast': s.toast(msg.text, msg.kind ?? 'info'); break;
      case 'room': {
        const presence = msg.view.kind === 'island' ? msg.view.pirates : [];
        useStore.setState({ room: msg.view, presence, battle: msg.view.kind === 'ship' ? msg.view.battle : null, openBuilding: null });
        if (msg.view.kind === 'island') useStore.setState({ ships: msg.view.ships, swordfight: null });
        break;
      }
      case 'presence':
        if (s.room?.kind === 'island' && s.room.islandId === msg.islandId) useStore.setState({ presence: msg.pirates });
        break;
      case 'presenceLeave':
        useStore.setState({ presence: s.presence.filter((p) => p.id !== msg.id) });
        break;
      case 'chat': {
        const m: ChatMsg = { id: nextId++, from: msg.from, fromId: msg.fromId, channel: msg.channel, text: msg.text, at: msg.at };
        useStore.setState({ chat: [...s.chat, m].slice(-200), unread: s.unread + 1 });
        break;
      }
      case 'pirate': useStore.setState({ pirate: msg.pirate }); break;
      case 'crew': useStore.setState({ crew: msg.crew }); break;
      case 'crews': useStore.setState({ crews: msg.crews }); break;
      case 'ship':
        if (s.room?.kind === 'ship' && s.room.ship.id === msg.ship.id) useStore.setState({ room: { ...s.room, ship: msg.ship } });
        break;
      case 'ships': useStore.setState({ ships: msg.ships }); break;
      case 'puzzleSeed':
        useStore.setState({ puzzle: { sessionId: msg.sessionId, puzzle: msg.puzzle, seed: msg.seed, config: msg.config, practice: s.puzzlePending === msg.puzzle ? !(s.pirate?.location.kind === 'ship' && s.pirate.location.station === msg.puzzle) : true }, puzzlePending: null });
        break;
      case 'puzzleVerified': break;
      case 'puzzleReward': useStore.setState({ lastReward: { puzzle: msg.puzzle, points: msg.points, performance: msg.performance, poe: msg.poe } }); break;
      case 'battle': useStore.setState({ battle: msg.state, battleEnd: s.battle && s.battle.id !== msg.state.id ? null : s.battleEnd }); break;
      case 'battleEnd': useStore.setState({ battleEnd: { ...msg, at: Date.now() } }); break;
      case 'swordfight': useStore.setState({ swordfight: msg.view, puzzle: s.swordfight ? s.puzzle : null, puzzlePending: null, duelInvite: null, openBuilding: null }); break;
      case 'swordfightEnd': break;
      case 'duelInvite': useStore.setState({ duelInvite: { id: msg.id, fromId: msg.fromId, fromName: msg.fromName } }); break;
      case 'duelCancel': if (s.duelInvite?.id === msg.id) useStore.setState({ duelInvite: null }); break;
      case 'leaderboard': useStore.setState({ leaderboard: msg.rows }); break;
      case 'pong': break;
    }
  });
  net.connect();
}
