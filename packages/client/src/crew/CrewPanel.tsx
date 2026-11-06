import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { CrewFlagWire, CrewInfo, CrewMember, CrewRank, CrewWhere } from "@openseas/protocol";
import { content, t, usePirate } from "@openseas/boards";
import { Chat } from "../island/Chat.jsx";
import { islandName } from "../names.js";
import { useCrew, describeCrewNotice, type CrewTab } from "../state/CrewProvider.jsx";
import { useShip } from "../state/ShipProvider.jsx";
import { useSocial } from "../state/SocialProvider.jsx";
import { Flag, FlagEditor, randomFlag } from "./Flag.jsx";

const rules = content.world.crews;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}' -]*$/u;

/** A crew name the server will take, as far as the client can tell: tidied, the right length, words only. */
export function crewNameProblem(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < rules.name.min) return t("crew.name_short", { min: rules.name.min });
  if (name.length > rules.name.max) return t("crew.name_long", { max: rules.name.max });
  if (!NAME_RE.test(name)) return t("crew.name_chars");
  return null;
}

/** A button that asks once more before it does something that cannot be undone. */
export function ConfirmButton({ label, confirm, onConfirm, className = "btn btn-ghost btn-small", testId }: { label: string; confirm: string; onConfirm(): void; className?: string; testId?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className} ${armed ? "is-armed" : ""}`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
      data-testid={testId}
      data-armed={armed ? "1" : "0"}
    >
      {armed ? confirm : label}
    </button>
  );
}

export function RankChip({ rank }: { rank: CrewRank }) {
  return (
    <b className={`rank-chip rank-${rank}`}>
      <RankMark rank={rank} /> {t(`crew.rank.${rank}`)}
    </b>
  );
}

/** Each rank has its own mark, so ranks read apart without color: a star, a chevron pair, a single bar. */
function RankMark({ rank }: { rank: CrewRank }) {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
      {rank === "commodore" && <path d="M8 1.5l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.2 4.1 13.3 5 9 1.7 6l4.4-.5z" />}
      {rank === "officer" && <path d="M3 9l5-4 5 4M3 13l5-4 5 4" fill="none" />}
      {rank === "sailor" && <path d="M3 8h10" fill="none" strokeWidth="2.4" />}
    </svg>
  );
}

export function whereText(w: CrewWhere): string {
  switch (w.kind) {
    case "offline":
      return t("crew.where_offline");
    case "ashore":
      return t("crew.where_ashore", { island: islandName(w.islandId) });
    case "aboard":
      return w.islandId
        ? t("crew.where_docked", { ship: w.shipName, island: islandName(w.islandId) })
        : t("crew.where_at_sea", { ship: w.shipName, island: islandName(w.to ?? ""), percent: Math.round(w.progress / 10) });
  }
}

/** The crew card: the pirate's crew, or the ways into one. Opens over the scene from the top bar or the tavern. */
export function CrewPanel({ tab, onTab }: { tab: CrewTab; onTab(tab: CrewTab): void }) {
  const { crew, listCrews, refresh, error, clearError } = useCrew();
  const { socketStatus } = usePirate();
  const online = socketStatus === "open";

  // Where everyone is changes as they sail: look again while the card is open.
  useEffect(() => {
    if (!online) return;
    refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [online, refresh]);
  useEffect(() => {
    if (tab === "board" && online) listCrews();
  }, [tab, online, listCrews]);

  return (
    <div className="crew-panel" data-testid="crew-panel" data-in-crew={crew ? "1" : "0"}>
      {crew ? <CrewHead crew={crew} /> : <NoCrewHead />}
      <Tabs tab={tab} onTab={onTab} inCrew={crew !== null} />
      {error && (
        <p className="error" role="alert" onClick={clearError} data-testid="crew-error">
          {t(`error.${error}`)}
        </p>
      )}
      {tab === "crew" && (crew ? <Members crew={crew} /> : <JoinOrFound />)}
      {tab === "chat" && crew && <Chat channel="crew" />}
      {tab === "board" && <CrewBoard />}
      {!online && <p className="note">{t("app.offline")}</p>}
    </div>
  );
}

function Tabs({ tab, onTab, inCrew }: { tab: CrewTab; onTab(tab: CrewTab): void; inCrew: boolean }) {
  const { unread } = useSocial();
  const { invites } = useCrew();
  const items: { id: CrewTab; label: string; badge: number }[] = inCrew
    ? [
        { id: "crew", label: t("crew.tab_crew"), badge: invites.length },
        { id: "chat", label: t("crew.tab_chat"), badge: unread.crew },
        { id: "board", label: t("crew.tab_board"), badge: 0 },
      ]
    : [
        { id: "crew", label: t("crew.tab_join"), badge: invites.length },
        { id: "board", label: t("crew.tab_board"), badge: 0 },
      ];
  return (
    <div className="tabs" role="tablist">
      {items.map((i) => (
        <button key={i.id} role="tab" aria-selected={tab === i.id} className={`tab ${tab === i.id ? "is-on" : ""}`} onClick={() => onTab(i.id)} data-testid={`crew-tab-${i.id}`}>
          {i.label}
          {i.badge > 0 && tab !== i.id && <span className="badge">{i.badge}</span>}
        </button>
      ))}
    </div>
  );
}

function CrewHead({ crew }: { crew: CrewInfo }) {
  const { rank } = useCrew();
  const founded = new Date(crew.foundedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  return (
    <header className="crew-head">
      <Flag flag={crew.flag} size={46} className="flag-big" />
      <div className="crew-title">
        <h2 data-testid="crew-name">{crew.name}</h2>
        <small className="muted">
          {rank && <RankChip rank={rank} />} {t("crew.founded", { date: founded })}
        </small>
      </div>
      <ul className="crew-stats" aria-label={t("crew.stats_label")}>
        <li>
          <b>{crew.members.length}</b>
          <small>{t("crew.stat_members")}</small>
        </li>
        <li>
          <b>{crew.stats.voyages}</b>
          <small>{t("crew.stat_voyages")}</small>
        </li>
        <li>
          <b>{crew.stats.victories}</b>
          <small>{t("crew.stat_victories")}</small>
        </li>
        <li>
          <b>{crew.stats.booty}</b>
          <small>{t("crew.stat_booty")}</small>
        </li>
      </ul>
    </header>
  );
}

function NoCrewHead() {
  return (
    <header className="crew-head crew-head-none">
      <svg className="crew-glyph" viewBox="0 0 48 48" width="44" height="44" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 42V6" />
        <path d="M10 8h26l-6 8 6 8H10" />
      </svg>
      <div className="crew-title">
        <h2>{t("crew.none_title")}</h2>
        <small className="muted">{t("crew.none_blurb")}</small>
      </div>
    </header>
  );
}

function Members({ crew }: { crew: CrewInfo }) {
  const { pirate } = usePirate();
  const { rank, invite, uninvite, leave, log, invites } = useCrew();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const me = pirate?.id ?? "";
  const officer = rank === "commodore" || rank === "officer";
  const alone = crew.members.length === 1;

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!name.trim()) return;
    invite(name.trim());
    setName("");
  };

  return (
    <>
      <ul className="members" data-testid="crew-members">
        {crew.members.map((m) => (
          <MemberRow key={m.pirateId} m={m} me={me} myRank={rank} />
        ))}
      </ul>

      {officer && (
        <div className="section">
          <h3 className="section-head">{t("crew.invite_head")}</h3>
          <form className="chat-form" onSubmit={submit}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("crew.invite_placeholder")} maxLength={64} aria-label={t("crew.invite_placeholder")} autoComplete="off" data-testid="crew-invite-name" />
            <button className="btn btn-brass btn-small" type="submit" disabled={!name.trim()} data-testid="crew-invite-send">
              {t("crew.invite_send")}
            </button>
          </form>
          <p className="muted small">{t("crew.invite_hint")}</p>
          {crew.invited.length > 0 && (
            <ul className="invited" data-testid="crew-invited">
              {crew.invited.map((i) => (
                <li key={i.pirateId}>
                  <span>
                    {i.name} <small className="muted">{t("crew.invited_waiting")}</small>
                  </span>
                  <button className="btn btn-ghost btn-small" onClick={() => uninvite(i.pirateId)} data-testid={`crew-uninvite-${i.pirateId}`}>
                    {t("crew.invited_withdraw")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {rank === "commodore" && (
        <div className="section">
          <div className="row between section-row">
            <h3 className="section-head">{t("crew.flag_head")}</h3>
            <button className="btn btn-ghost btn-small" onClick={() => setEditing((x) => !x)} aria-expanded={editing} data-testid="crew-flag-edit">
              {editing ? t("crew.flag_done") : t("crew.flag_change")}
            </button>
          </div>
          {editing && <FlagChange crew={crew} onDone={() => setEditing(false)} />}
        </div>
      )}

      {invites.length > 0 && <Invitations />}

      {log.length > 0 && (
        <div className="section">
          <h3 className="section-head">{t("crew.log_head")}</h3>
          <ul className="log" data-testid="crew-log">
            {log.map((l) => (
              <li key={l.id}>{describeCrewNotice(l.notice)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="section row">
        <ConfirmButton
          label={t("crew.leave")}
          confirm={alone ? t("crew.leave_disband") : rank === "commodore" ? t("crew.leave_hand_over") : t("crew.leave_sure")}
          onConfirm={leave}
          testId="crew-leave"
        />
      </div>
    </>
  );
}

function MemberRow({ m, me, myRank }: { m: CrewMember; me: string; myRank: CrewRank | null }) {
  const { showProfile, setRank, remove } = useCrew();
  const { boardShip } = useShip();
  const [open, setOpen] = useState(false);
  const mine = m.pirateId === me;
  const canManage = !mine && (myRank === "commodore" || (myRank === "officer" && m.rank === "sailor"));
  return (
    <li className={`member ${mine ? "is-me" : ""} ${m.where.kind === "offline" ? "is-offline" : ""}`} data-testid={`crew-member-${m.pirateId}`} data-rank={m.rank}>
      <div className="member-main">
        <i className={`dot ${m.where.kind === "offline" ? "pip-off" : "pip-live"}`} aria-hidden="true" />
        <span className="member-name">
          <button className="pirate-link" onClick={() => showProfile({ pirateId: m.pirateId })}>
            {m.name}
          </button>
          {mine && <small className="muted"> ({t("ship.you")})</small>} <RankChip rank={m.rank} />
          <br />
          <small className="muted where" data-testid="crew-where">
            {whereText(m.where)}
          </small>
        </span>
        {m.where.kind === "aboard" && m.where.joinable && (
          <button className="btn btn-brass btn-small" onClick={() => boardShip((m.where as { shipId: string }).shipId)} data-testid={`crew-join-${m.pirateId}`}>
            {m.where.islandId ? t("crew.join_docked") : t("crew.join_at_sea")}
          </button>
        )}
        {canManage && (
          <button className="icon-btn icon-btn-small" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t("crew.manage", { name: m.name })} data-testid={`crew-manage-${m.pirateId}`}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
        )}
      </div>
      {open && canManage && (
        <div className="member-actions">
          {myRank === "commodore" && m.rank !== "officer" && (
            <button className="btn btn-ghost btn-small" onClick={() => setRank(m.pirateId, "officer")} data-testid={`crew-officer-${m.pirateId}`}>
              {t("crew.make_officer")}
            </button>
          )}
          {myRank === "commodore" && m.rank === "officer" && (
            <button className="btn btn-ghost btn-small" onClick={() => setRank(m.pirateId, "sailor")} data-testid={`crew-sailor-${m.pirateId}`}>
              {t("crew.make_sailor")}
            </button>
          )}
          {myRank === "commodore" && (
            <ConfirmButton label={t("crew.hand_over")} confirm={t("crew.hand_over_sure", { name: m.name })} onConfirm={() => setRank(m.pirateId, "commodore")} testId={`crew-commodore-${m.pirateId}`} />
          )}
          <ConfirmButton label={t("crew.put_out")} confirm={t("crew.put_out_sure", { name: m.name })} onConfirm={() => remove(m.pirateId)} testId={`crew-remove-${m.pirateId}`} />
        </div>
      )}
    </li>
  );
}

function FlagChange({ crew, onDone }: { crew: CrewInfo; onDone(): void }) {
  const { setFlag } = useCrew();
  const [flag, setDraft] = useState<CrewFlagWire>(crew.flag);
  return (
    <>
      <FlagEditor flag={flag} onChange={setDraft} />
      <div className="row">
        <button
          className="btn btn-brass btn-small"
          onClick={() => {
            setFlag(flag);
            onDone();
          }}
          data-testid="crew-flag-save"
        >
          {t("crew.flag_hoist")}
        </button>
      </div>
    </>
  );
}

function Invitations() {
  const { invites, answer, crew } = useCrew();
  return (
    <div className="section">
      <h3 className="section-head">{t("crew.invites_head")}</h3>
      <ul className="invites" data-testid="crew-invites">
        {invites.map((i) => (
          <li key={i.crew.id} className="invite">
            <Flag flag={i.crew.flag} size={30} />
            <span className="invite-text">
              <b>{i.crew.name}</b>
              <br />
              <small className="muted">{t("crew.invite_from", { by: i.by, count: i.members })}</small>
            </span>
            <span className="invite-actions">
              {crew ? (
                <ConfirmButton label={t("crew.accept")} confirm={t("crew.accept_switch", { crew: crew.name })} onConfirm={() => answer(i.crew.id, true)} className="btn btn-brass btn-small" testId={`crew-accept-${i.crew.id}`} />
              ) : (
                <button className="btn btn-brass btn-small" onClick={() => answer(i.crew.id, true)} data-testid={`crew-accept-${i.crew.id}`}>
                  {t("crew.accept")}
                </button>
              )}
              <button className="btn btn-ghost btn-small" onClick={() => answer(i.crew.id, false)} data-testid={`crew-decline-${i.crew.id}`}>
                {t("crew.decline")}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function JoinOrFound() {
  const { pirate } = usePirate();
  const { invites, found } = useCrew();
  const [name, setName] = useState("");
  const [flag, setDraft] = useState<CrewFlagWire>(() => randomFlag());
  const [touched, setTouched] = useState(false);
  const problem = crewNameProblem(name);
  const coins = pirate?.balance ?? 0;
  const short = Math.max(0, rules.foundingFee - coins);
  const nameRef = useRef<HTMLInputElement>(null);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    setTouched(true);
    if (problem || short > 0) return;
    found(name.trim().replace(/\s+/g, " "), flag);
  };

  return (
    <>
      {invites.length > 0 ? (
        <Invitations />
      ) : (
        <div className="section">
          <h3 className="section-head">{t("crew.invites_head")}</h3>
          <p className="muted small" data-testid="crew-no-invites">
            {t("crew.no_invites", { name: pirate?.name ?? "" })}
          </p>
        </div>
      )}
      <form className="section found-form" onSubmit={submit} data-testid="crew-found-form">
        <h3 className="section-head">{t("crew.found_head")}</h3>
        <p className="muted small">{rules.foundingFee > 0 ? t("crew.found_blurb", { coins: rules.foundingFee }) : t("crew.found_blurb_free")}</p>
        <label className="field">
          <span>{t("crew.name_label")}</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={t("crew.name_placeholder")}
            maxLength={rules.name.max + 8}
            autoComplete="off"
            data-testid="crew-found-name"
          />
        </label>
        {touched && problem && name.length > 0 && <p className="error small">{problem}</p>}
        <FlagEditor flag={flag} onChange={setDraft} />
        <PreviewLine name={name.trim() || t("crew.name_placeholder")}>
          <Flag flag={flag} size={22} />
        </PreviewLine>
        {short > 0 && <p className="note">{t("crew.found_short", { coins: short })}</p>}
        <button className="btn btn-brass btn-wide" type="submit" disabled={short > 0 || problem !== null} data-testid="crew-found">
          {rules.foundingFee > 0 ? t("crew.found_button", { coins: rules.foundingFee }) : t("crew.found_button_free")}
        </button>
      </form>
    </>
  );
}

/** How the crew will look where it is seen: its flag beside its name, as on the notice board. */
function PreviewLine({ name, children }: { name: string; children: ReactNode }) {
  return (
    <p className="crew-preview muted small">
      {children} <b>{name}</b> · {t("crew.preview_note")}
    </p>
  );
}

/** Every crew on the ocean, the most plunder first. */
function CrewBoard() {
  const { rows, crew } = useCrew();
  if (!rows) return <p className="muted small">{t("app.loading")}</p>;
  if (rows.length === 0) return <p className="muted small" data-testid="crew-board-empty">{t("crew.board_empty")}</p>;
  return (
    <ol className="crew-board" data-testid="crew-board">
      {rows.map((r, i) => (
        <li key={r.id} className={r.id === crew?.id ? "is-mine" : ""}>
          <span className="place">{i + 1}</span>
          <Flag flag={r.flag} size={24} />
          <span className="board-name">
            <b>{r.name}</b>
            <br />
            <small className="muted">{t("crew.board_line", { members: r.members, voyages: r.stats.voyages, victories: r.stats.victories })}</small>
          </span>
          <b className="board-booty">{t("world.coins", { coins: r.stats.booty })}</b>
        </li>
      ))}
    </ol>
  );
}
