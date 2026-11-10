import type { Content } from "@openseas/content";
import { STATIONS, type Station } from "@openseas/engine";
import { t } from "@openseas/boards";
import { getPath, leaves, pruneOverrides, type Overrides } from "../scenario/overrides.js";
import { valueToText } from "../bench/format.js";
import {
  DUTY_PRESETS,
  HAIL_ORDERS,
  SCRIPT_ACTIONS,
  SWORD_HANDS,
  SWORD_HAND_BOUNDS,
  baseWorld,
  type CrewSpec,
  type HailOrder,
  type ScriptAction,
  type ScriptStep,
  type VoyageScenario,
  type VoyageWorld,
} from "./scenario.js";
import { outpostName, pirateName, stationName } from "./names.js";

export interface ScenarioPanelProps {
  content: Content;
  scenario: VoyageScenario;
  onChange(next: VoyageScenario): void;
  /** The world as the overrides make it, when they validate; content's otherwise. */
  world: VoyageWorld;
}

/** The scenario, as the bench's sections: ship and lane, crew, captain, script and the world's numbers. */
export function ScenarioPanel({ content, scenario, onChange, world }: ScenarioPanelProps) {
  const set = (patch: Partial<VoyageScenario>): void => onChange({ ...scenario, ...patch });
  const base = baseWorld(content, scenario.shipClassId, scenario.laneId);
  return (
    <div className="bench-body" data-testid="voyage-scenario">
      <ShipSection content={content} scenario={scenario} set={set} base={base} />
      <CrewSection content={content} scenario={scenario} set={set} world={world} />
      <CaptainSection scenario={scenario} set={set} />
      <ScriptSection scenario={scenario} set={set} world={world} />
      {base && <WorldSection base={base} overrides={scenario.world} onChange={(w) => set({ world: w })} />}
    </div>
  );
}

type Setter = (patch: Partial<VoyageScenario>) => void;

const ENCOUNTER_KEYS = ["lane.encounterChance", "lane.raiders"] as const;

/** Which encounter choice the overrides amount to. */
function encounterChoice(world: Overrides): string {
  const chance = world["lane.encounterChance"];
  const raiders = world["lane.raiders"] as Array<{ tierId: string; weight: number }> | undefined;
  if (chance === undefined && raiders === undefined) return "content";
  if (chance === 0 && raiders === undefined) return "none";
  if (chance === 1 && Array.isArray(raiders) && raiders.length === 1) return `tier:${raiders[0]!.tierId}`;
  return "custom";
}

function ShipSection({ content, scenario, set, base }: { content: Content; scenario: VoyageScenario; set: Setter; base: VoyageWorld | null }) {
  const choice = encounterChoice(scenario.world);
  const setEncounter = (v: string): void => {
    const w: Record<string, unknown> = { ...scenario.world };
    for (const k of ENCOUNTER_KEYS) delete w[k];
    if (v === "none") w["lane.encounterChance"] = 0;
    else if (v.startsWith("tier:")) {
      w["lane.encounterChance"] = 1;
      w["lane.raiders"] = [{ tierId: v.slice(5), weight: 1 }];
    }
    set({ world: base ? pruneOverrides(base, w) : w });
  };
  const lane = base?.lane;
  const newSeed = (): string => `voyage-${Math.floor(Math.random() * 1e6).toString(36)}`;
  return (
    <section className="bench-section">
      <h3>{t("harness.voyage.ship_title")}</h3>
      <div className="bench-fields">
        <label className="bench-row">
          <span>{t("harness.voyage.ship_class")}</span>
          <select value={scenario.shipClassId} onChange={(e) => set({ shipClassId: e.target.value })} data-testid="voyage-ship">
            {content.world.shipClasses.map((c) => (
              <option key={c.id} value={c.id}>
                {t(c.nameKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="bench-row">
          <span>{t("harness.voyage.lane")}</span>
          <select value={scenario.laneId} onChange={(e) => set({ laneId: e.target.value })} data-testid="voyage-lane">
            {content.world.lanes.map((r) => (
              <option key={r.id} value={r.id}>
                {t("harness.voyage.lane_option", { from: outpostName(r.from), to: outpostName(r.to), seconds: r.durationSeconds })}
              </option>
            ))}
          </select>
        </label>
        <label className="bench-row">
          <span>{t("harness.voyage.raiders")}</span>
          <select value={choice} onChange={(e) => setEncounter(e.target.value)} data-testid="voyage-encounter">
            <option value="content">
              {lane
                ? t("harness.voyage.raiders_content", {
                    chance: Math.round(lane.encounterChance * 100),
                    tiers: lane.raiders.map((b) => `${t(`raider.${b.tierId}`)} ${b.weight}`).join(", "),
                  })
                : t("harness.voyage.raiders_content_short")}
            </option>
            {content.world.raiderTiers.map((tier) => (
              <option key={tier.id} value={`tier:${tier.id}`}>
                {t("harness.voyage.raiders_always", { tier: t(tier.nameKey) })}
              </option>
            ))}
            <option value="none">{t("harness.voyage.raiders_none")}</option>
            {choice === "custom" && <option value="custom">{t("harness.voyage.raiders_custom")}</option>}
          </select>
        </label>
        <label className="bench-row">
          <span>{t("harness.voyage.hail")}</span>
          <select value={scenario.hail} onChange={(e) => set({ hail: e.target.value as HailOrder })} data-testid="voyage-hail">
            {HAIL_ORDERS.map((h) => (
              <option key={h} value={h}>
                {t(`harness.voyage.hail_${h}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="bench-row">
          <span>{t("harness.seed")}</span>
          <span className="bench-inline">
            <input type="text" value={scenario.seed} onChange={(e) => set({ seed: e.target.value })} spellCheck={false} data-testid="voyage-seed" />
            <button type="button" className="btn btn-ghost btn-mini" onClick={() => set({ seed: newSeed() })}>
              {t("harness.seed_random")}
            </button>
          </span>
        </div>
      </div>
    </section>
  );
}

const num = (v: string, fallback: number): number => {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? fallback : Math.round(n);
};

function dutyPreset(c: CrewSpec): string {
  return DUTY_PRESETS.find((p) => p.duty === c.duty && p.spread === c.spread)?.id ?? "custom";
}
function swordPreset(c: CrewSpec): string {
  return (Object.entries(SWORD_HANDS).find(([, h]) => h.skill === c.sword.skill && h.thinkTicks === c.sword.thinkTicks)?.[0] as string | undefined) ?? "custom";
}

function CrewSection({ content, scenario, set, world }: { content: Content; scenario: VoyageScenario; set: Setter; world: VoyageWorld }) {
  const crew = scenario.crew;
  const stations = STATIONS.filter((s) => world.ship.stations.includes(s));
  const blades = content.puzzles.swordfight.config.blades;
  const update = (i: number, patch: Partial<CrewSpec>): void => set({ crew: crew.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const remove = (i: number): void =>
    set({
      crew: crew.filter((_, k) => k !== i),
      script: scenario.script.filter((s) => s.who !== i).map((s) => (s.who > i ? { ...s, who: s.who - 1 } : s)),
    });
  const add = (): void => {
    const free = stations.find((s) => !crew.some((c) => c.station === s)) ?? null;
    set({ crew: [...crew, { name: "", station: free, duty: 100, spread: 15, sword: SWORD_HANDS.able }] });
  };
  // Who boots up to make up the number, and where they go, as the reducer will seat them.
  const hands = Math.max(0, Math.min(world.ship.maxCrew, world.ship.minCrew) - crew.length);
  const open = world.ship.botStations.filter((s) => !crew.some((c) => c.station === s));
  const seated = open.slice(0, hands);

  return (
    <section className="bench-section">
      <h3>{t("harness.voyage.crew_title")}</h3>
      <p className="muted small">{t("harness.voyage.crew_blurb")}</p>
      <ol className="vcrew" data-testid="voyage-crew">
        {crew.map((c, i) => (
          <li key={i} className="vcrew-row" data-testid={`voyage-pirate-${i + 1}`}>
            <div className="bench-inline bench-inline-between">
              <span className="bench-inline">
                {i === 0 && <span className="vchip vchip-captain">{t("harness.voyage.captain_chip")}</span>}
                <input
                  type="text"
                  className="vcrew-name"
                  value={c.name}
                  placeholder={pirateName(crew.map((x) => ({ ...x, name: "" })), i)}
                  onChange={(e) => update(i, { name: e.target.value })}
                  aria-label={t("harness.voyage.crew_name")}
                />
              </span>
              {crew.length > 1 && (
                <button type="button" className="field-reset" onClick={() => remove(i)} aria-label={t("harness.voyage.crew_remove")} title={t("harness.voyage.crew_remove")}>
                  ×
                </button>
              )}
            </div>
            <label className="bench-row">
              <span>{t("harness.voyage.crew_station")}</span>
              <select value={c.station ?? ""} onChange={(e) => update(i, { station: (e.target.value || null) as Station | null })} data-testid={`voyage-pirate-${i + 1}-station`}>
                <option value="">{t("harness.voyage.no_station")}</option>
                {stations.map((s) => (
                  <option key={s} value={s} disabled={crew.some((o, k) => k !== i && o.station === s)}>
                    {stationName(s)}
                  </option>
                ))}
              </select>
            </label>
            <div className="bench-row">
              <span>{t("harness.voyage.crew_duty")}</span>
              <span className="bench-inline">
                <select
                  value={dutyPreset(c)}
                  onChange={(e) => {
                    const p = DUTY_PRESETS.find((d) => d.id === e.target.value);
                    if (p) update(i, { duty: p.duty, spread: p.spread });
                  }}
                  data-testid={`voyage-pirate-${i + 1}-duty-preset`}
                >
                  {DUTY_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {t(`harness.voyage.duty_${p.id}`, { duty: p.duty })}
                    </option>
                  ))}
                  {dutyPreset(c) === "custom" && <option value="custom">{t("harness.voyage.custom")}</option>}
                </select>
                <input className="vnum" type="number" min={0} max={1000} value={c.duty} onChange={(e) => update(i, { duty: num(e.target.value, c.duty) })} aria-label={t("harness.voyage.crew_duty_mean")} data-testid={`voyage-pirate-${i + 1}-duty`} />
                <span className="muted small">±</span>
                <input className="vnum" type="number" min={0} max={200} value={c.spread} onChange={(e) => update(i, { spread: num(e.target.value, c.spread) })} aria-label={t("harness.voyage.crew_duty_spread")} />
              </span>
            </div>
            <div className="bench-row">
              <span>{t("harness.voyage.crew_sword")}</span>
              <span className="bench-inline">
                <select
                  value={swordPreset(c)}
                  onChange={(e) => {
                    const h = SWORD_HANDS[e.target.value as keyof typeof SWORD_HANDS];
                    if (h) update(i, { sword: { ...h, blade: c.sword.blade } });
                  }}
                >
                  {Object.keys(SWORD_HANDS).map((k) => (
                    <option key={k} value={k}>
                      {t(`harness.voyage.sword_${k}`)}
                    </option>
                  ))}
                  {swordPreset(c) === "custom" && <option value="custom">{t("harness.voyage.custom")}</option>}
                </select>
                <select value={c.sword.blade} onChange={(e) => update(i, { sword: { ...c.sword, blade: Number(e.target.value) } })} aria-label={t("harness.voyage.crew_blade")}>
                  {blades.map((b, k) => (
                    <option key={b.id} value={k}>
                      {t(`swordfight.blade.${b.id}`)}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            <details className="bench-details">
              <summary className="small muted">{t("harness.voyage.crew_sword_detail", { skill: c.sword.skill, ticks: c.sword.thinkTicks })}</summary>
              <div className="bench-fields">
                <label className="bench-row">
                  <span>{t("harness.voyage.crew_skill")}</span>
                  <input className="vnum" type="number" min={SWORD_HAND_BOUNDS.skill.min} max={SWORD_HAND_BOUNDS.skill.max} value={c.sword.skill} onChange={(e) => update(i, { sword: { ...c.sword, skill: num(e.target.value, c.sword.skill) } })} />
                </label>
                <label className="bench-row">
                  <span>{t("harness.voyage.crew_think")}</span>
                  <input className="vnum" type="number" min={SWORD_HAND_BOUNDS.thinkTicks.min} max={SWORD_HAND_BOUNDS.thinkTicks.max} value={c.sword.thinkTicks} onChange={(e) => update(i, { sword: { ...c.sword, thinkTicks: num(e.target.value, c.sword.thinkTicks) } })} />
                </label>
              </div>
            </details>
          </li>
        ))}
      </ol>
      <div className="bench-actions">
        <button type="button" className="btn btn-ghost btn-mini" onClick={add} disabled={crew.length >= world.ship.maxCrew} data-testid="voyage-add-pirate">
          {t("harness.voyage.crew_add")}
        </button>
      </div>
      <p className="muted small" data-testid="voyage-bots">
        {hands === 0
          ? t("harness.voyage.bots_none", { min: world.ship.minCrew })
          : t("harness.voyage.bots", {
              count: hands,
              min: world.ship.minCrew,
              stations: seated.length ? seated.map(stationName).join(", ") : t("harness.voyage.bots_on_deck"),
              lo: world.rules.botOutput.min,
              hi: world.rules.botOutput.max,
            })}
      </p>
    </section>
  );
}

function CaptainSection({ scenario, set }: { scenario: VoyageScenario; set: Setter }) {
  const cap = scenario.captain;
  return (
    <section className="bench-section">
      <h3>{t("harness.voyage.captain_title")}</h3>
      <div className="bench-fields">
        <label className="bench-row">
          <span>{t("harness.voyage.battle_plots")}</span>
          <select value={scenario.helm} onChange={(e) => set({ helm: e.target.value === "you" ? "you" : "ai" })} data-testid="voyage-helm">
            <option value="ai">{t("harness.voyage.helm_ai")}</option>
            <option value="you">{t("harness.voyage.helm_you")}</option>
          </select>
        </label>
        <label className="bench-row">
          <span>{t("harness.voyage.captain_accuracy")}</span>
          <input className="vnum" type="number" min={0} max={100} value={cap.accuracy} onChange={(e) => set({ captain: { ...cap, accuracy: num(e.target.value, cap.accuracy) } })} />
        </label>
        <label className="bench-row">
          <span>{t("harness.voyage.captain_aggression")}</span>
          <input className="vnum" type="number" min={0} max={100} value={cap.aggression} onChange={(e) => set({ captain: { ...cap, aggression: num(e.target.value, cap.aggression) } })} />
        </label>
      </div>
      <p className="muted small">{t("harness.voyage.captain_blurb")}</p>
    </section>
  );
}

function ScriptSection({ scenario, set, world }: { scenario: VoyageScenario; set: Setter; world: VoyageWorld }) {
  const script = scenario.script;
  const stations = STATIONS.filter((s) => world.ship.stations.includes(s));
  const update = (i: number, patch: Partial<ScriptStep>): void => set({ script: script.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  return (
    <section className="bench-section">
      <h3>{t("harness.voyage.script_title")}</h3>
      <p className="muted small">{t("harness.voyage.script_blurb")}</p>
      {script.length > 0 && (
        <ol className="vscript" data-testid="voyage-script">
          {script.map((s, i) => (
            <li key={i} className="bench-inline">
              <label className="bench-inline small">
                {t("harness.voyage.script_turn")}
                <input className="vnum" type="number" min={1} value={s.turn} onChange={(e) => update(i, { turn: num(e.target.value, s.turn) })} />
              </label>
              <select value={s.who} onChange={(e) => update(i, { who: Number(e.target.value) })} aria-label={t("harness.voyage.script_who")}>
                {scenario.crew.map((_, k) => (
                  <option key={k} value={k}>
                    {pirateName(scenario.crew, k)}
                  </option>
                ))}
              </select>
              <select value={s.action} onChange={(e) => update(i, { action: e.target.value as ScriptAction })} aria-label={t("harness.voyage.script_action")}>
                {SCRIPT_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {t(`harness.voyage.script_${a}`)}
                  </option>
                ))}
              </select>
              {s.action === "station" && (
                <select value={s.station ?? ""} onChange={(e) => update(i, { station: (e.target.value || null) as Station | null })} aria-label={t("harness.voyage.crew_station")}>
                  <option value="">{t("harness.voyage.no_station")}</option>
                  {stations.map((st) => (
                    <option key={st} value={st}>
                      {stationName(st)}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="field-reset" onClick={() => set({ script: script.filter((_, k) => k !== i) })} aria-label={t("harness.voyage.script_remove")} title={t("harness.voyage.script_remove")}>
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="bench-actions">
        <button
          type="button"
          className="btn btn-ghost btn-mini"
          onClick={() => set({ script: [...script, { turn: Math.max(1, ...script.map((s) => s.turn + 1), 5), who: 0, action: "away", station: null }] })}
          data-testid="voyage-add-step"
        >
          {t("harness.voyage.script_add")}
        </button>
      </div>
    </section>
  );
}

/** Fields that name things rather than tune them; shown in content, never edited. */
const FIXED = new Set(["ship.id", "ship.nameKey", "ship.price", "ship.hull", "lane.id", "lane.from", "lane.to"]);
const fixed = (path: string): boolean => FIXED.has(path) || /^tiers\.[^.]+\.(id|nameKey|shipClassId)$/.test(path);

function WorldSection({ base, overrides, onChange }: { base: VoyageWorld; overrides: Overrides; onChange(next: Overrides): void }) {
  const groups: Array<{ id: string; title: string; prefix: string }> = [
    { id: "rules", title: t("harness.voyage.world_rules"), prefix: "rules" },
    { id: "ship", title: t("harness.voyage.world_ship"), prefix: "ship" },
    { id: "lane", title: t("harness.voyage.world_lane"), prefix: "lane" },
    ...Object.values(base.tiers).map((tier) => ({ id: `tier-${tier.id}`, title: t("harness.voyage.world_tier", { tier: t(tier.nameKey) }), prefix: `tiers.${tier.id}` })),
  ];
  const all = leaves(base).filter((f) => !fixed(f.path));
  const set = (path: string, value: unknown): void => onChange(pruneOverrides(base, { ...overrides, [path]: value }));
  const unset = (path: string): void => {
    const next: Record<string, unknown> = { ...overrides };
    delete next[path];
    onChange(next);
  };
  const changed = Object.keys(overrides).length;
  return (
    <section className="bench-section">
      <div className="bench-inline bench-inline-between">
        <h3>{t("harness.voyage.world_title")}</h3>
        {changed > 0 && (
          <button type="button" className="btn btn-ghost btn-mini" onClick={() => onChange({})} data-testid="voyage-world-reset">
            {t("harness.config_reset")}
          </button>
        )}
      </div>
      <p className="muted small">{t("harness.voyage.world_blurb", { count: changed })}</p>
      {groups.map((g) => {
        const fields = all.filter((f) => f.path.startsWith(`${g.prefix}.`));
        const n = fields.filter((f) => f.path in overrides).length;
        return (
          <details key={g.id} className="bench-details" data-testid={`voyage-world-${g.id}`}>
            <summary>
              {g.title}
              {n > 0 && <span className="vchip">{n}</span>}
            </summary>
            <ul className="config-fields">
              {fields.map(({ path, value: was }) => {
                const value = path in overrides ? overrides[path] : getPath(base, path);
                const id = `world-${path.replace(/\./g, "-")}`;
                return (
                  <li key={path} className={`config-field ${path in overrides ? "is-overridden" : ""}`}>
                    <label htmlFor={id} title={path}>
                      {path.slice(g.prefix.length + 1)}
                    </label>
                    <WorldField id={id} base={was} value={value} onChange={(v) => set(path, v)} />
                    {path in overrides && (
                      <button type="button" className="field-reset" onClick={() => unset(path)} title={t("harness.config_reset_field")} aria-label={t("harness.config_reset_field")}>
                        ↺
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </section>
  );
}

function WorldField({ id, base, value, onChange }: { id: string; base: unknown; value: unknown; onChange(v: unknown): void }) {
  if (typeof base === "number") {
    return (
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={typeof value === "number" && Number.isFinite(value) ? value : ""}
        data-testid={`field-${id}`}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(e.target.value === "" || !Number.isFinite(n) ? Number.NaN : n);
        }}
      />
    );
  }
  return (
    <input
      id={id}
      type="text"
      value={valueToText(value)}
      data-testid={`field-${id}`}
      onChange={(e) => {
        try {
          onChange(JSON.parse(e.target.value));
        } catch {
          onChange(e.target.value);
        }
      }}
    />
  );
}
