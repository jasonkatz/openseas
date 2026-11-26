import { Fragment, type ReactNode } from "react";
import {
  ENGINE_DTS,
  FIELD_MAP,
  FUNCTIONS,
  ID_TYPES,
  SDK_TYPES_PATH,
  SETTING_MAP,
  SWAP_GEN,
  TYPE_GROUPS,
  definitionOf,
  innerAnchor,
  linked,
  memberPath,
  sdkRootPath,
  typeAnchor,
  type CodeExample,
  type Member,
  type Param,
  type SdkRoot,
  type TypeDef,
  type Value,
} from "../api/sdk/index.js";
import type { Need, Rule } from "../api/schema/index.js";
import { t } from "../content.js";
import { Code, Line } from "../md/Markdown.jsx";
import { Link } from "../router.jsx";
import { Pager } from "../Shell.jsx";
import { useTitle } from "./DocPage.jsx";
import { Crumbs, NeedTag } from "./Reference.jsx";

/** A piece of TypeScript with every name it uses linked to where that name is defined. */
function Ts({ text }: { text: string }) {
  return (
    <>
      {linked(text).map((run, i) => (run.path ? <Link key={i} to={run.path}>{run.text}</Link> : <Fragment key={i}>{run.text}</Fragment>))}
    </>
  );
}

/** A signature, set as a block. */
function Sig({ text, label }: { text: string; label?: string }) {
  return (
    <div className="sig">
      {label && <p className="values-title">{label}</p>}
      <pre tabIndex={0}><code><Ts text={text} /></code></pre>
    </div>
  );
}

function TypeTag({ text }: { text: string }) {
  return (
    <span className="type">
      <span className="type-name"><Ts text={text} /></span>
    </span>
  );
}

function Cases({ values, title }: { values: readonly Value[] | undefined; title?: string }) {
  if (!values?.length) return null;
  return (
    <div className="values">
      <p className="values-title">{title ?? t("docs.ref.values")}</p>
      <dl>
        {values.map((v) => (
          <div key={v.value}>
            <dt><code>{v.value}</code></dt>
            <dd><Line text={v.description} /></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A rule reads on from its label: "Never change anything." */
const lower = (text: string): string => (/^[A-Z][a-z ]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text);

function Rules({ absent, rules, need }: { absent?: string | undefined; rules?: readonly Rule[] | undefined; need?: Need | undefined }) {
  const when = need && typeof need !== "string" ? need.when : undefined;
  if (!absent && !rules?.length && !when) return null;
  return (
    <ul className="notes">
      {when && <li className="note-when"><Line text={t("docs.ref.required_when", { when })} /></li>}
      {absent && (
        <li>
          <b>{t("docs.ref.absent")}</b> <Line text={absent} />
        </li>
      )}
      {rules?.map((rule, i) => (
        <li key={i} className={`note-${rule.kind}`}>
          <b>{t(`docs.ref.${rule.kind}`)}</b> <Line text={lower(rule.text)} />
        </li>
      ))}
    </ul>
  );
}

function ParamRow({ param, anchor }: { param: Param; anchor?: string | undefined }) {
  return (
    <li className="field" id={anchor}>
      <p className="field-head">
        <span className="field-name"><code>{param.name}</code></span>
        <TypeTag text={param.type} />
        {param.name !== "…" && <NeedTag need={param.optional ? "optional" : "required"} />}
      </p>
      <p className="field-text"><Line text={param.description} /></p>
      <Rules absent={param.absent} rules={param.rules} />
      <Cases values={param.values} />
      {param.fields && (
        <details className="children" open>
          <summary>{t("docs.sdk.fields")}</summary>
          <ul className="fields">
            {param.fields.map((f) => (
              <ParamRow key={f.name} param={f} />
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

function Params({ params, owner }: { params: readonly Param[]; owner?: string }) {
  return (
    <ul className="fields">
      {params.map((p) => (
        <ParamRow key={p.name} param={p} anchor={owner ? innerAnchor(owner, p.name) : undefined} />
      ))}
    </ul>
  );
}

/** A plain list of sentences: what the loop has done, what is refused. */
function Refused({ items }: { items: readonly string[] }) {
  return (
    <ul className="plain">
      {items.map((item, i) => (
        <li key={i}><Line text={item} /></li>
      ))}
    </ul>
  );
}

const kindOf = (member: Member): string => (member.kind === "hook" ? t(member.given === "context" ? "docs.sdk.kind.hook_on" : "docs.sdk.kind.hook_ask") : t(`docs.sdk.kind.${member.kind}`));

/** A member defined inside another's page: a draw's `even`, an event builder's `arrive`, a board's `at`. */
function Inner({ member, owner }: { member: Member; owner: string }) {
  const anchor = innerAnchor(owner, member.name);
  return (
    <li className="field member" id={anchor} data-testid="sdk-inner">
      <p className="field-head">
        <a className="field-name" href={`#${anchor}`}><code>{owner}.{member.name}</code></a>
        <span className="type"><span className="type-fact">{kindOf(member)}</span></span>
      </p>
      <Sig text={member.signature} />
      <p className="field-text"><Line text={member.description} /></p>
      {member.about?.map((p, i) => (
        <p key={i} className="field-text"><Line text={p} /></p>
      ))}
      <Rules rules={member.rules} />
      {member.params && member.params.length > 0 && (
        <details className="children" open>
          <summary>{t("docs.sdk.params")}</summary>
          <Params params={member.params} />
        </details>
      )}
      {member.returns && (
        <div className="returns">
          <p className="values-title">{t(member.kind === "property" ? "docs.sdk.type" : "docs.sdk.returns")}</p>
          <p className="field-head"><TypeTag text={member.returns.type} /></p>
          {member.returns.description && <p className="field-text"><Line text={member.returns.description} /></p>}
          <Cases values={member.returns.values} title={t("docs.sdk.cases")} />
        </div>
      )}
      {member.refused && (
        <div className="returns">
          <p className="values-title">{t("docs.sdk.refused")}</p>
          <Refused items={member.refused} />
        </div>
      )}
    </li>
  );
}

function Examples({ examples }: { examples: readonly CodeExample[] }) {
  return (
    <aside className="ref-side" aria-label={t("docs.ref.examples")}>
      {examples.map((e) => (
        <div key={e.title} className="example">
          <Code code={e.code} lang="ts" title={e.title} />
          {e.note && <p className="example-note"><Line text={e.note} /></p>}
        </div>
      ))}
    </aside>
  );
}

function Preview() {
  return (
    <aside className="callout callout-preview">
      <span className="callout-label">{t("docs.callout.preview")}</span>
      <p><Line text={t("docs.sdk.preview")} /></p>
    </aside>
  );
}

/** The page of one hook, or of one member of a view or a context: its signature, and everything about calling it. */
export function SdkMemberPage({ root, member }: { root: SdkRoot; member: Member }) {
  useTitle(root.root === "hooks" ? member.name : `${root.root}.${member.name}`);
  const hook = member.kind === "hook";
  return (
    <div className="ref" data-testid={`sdk-${root.root}-${member.name}`}>
      <article className="prose ref-main">
        <header className="doc-head">
          <Crumbs items={[{ title: t("docs.area.api"), path: "/api" }, { title: root.title, path: sdkRootPath(root.root) }, { title: member.name }]} />
          <h1><code>{member.name}</code></h1>
          <p className="ref-type">
            <span className="type"><span className="type-fact">{kindOf(member)}</span></span>
            {hook && member.need && <NeedTag need={member.need} />}
          </p>
          <p className="lede"><Line text={member.description} /></p>
        </header>
        <Sig text={member.signature} label={t("docs.sdk.signature")} />
        {member.each && (
          <>
            <Sig text={member.each.signature} label={t("docs.sdk.each")} />
            <p className="muted"><Line text={member.each.note} /></p>
          </>
        )}
        {member.about?.map((p, i) => (
          <p key={i}><Line text={p} /></p>
        ))}
        {hook && (
          <ul className="notes notes-top">
            {member.need && typeof member.need !== "string" && <li className="note-when"><Line text={t("docs.ref.required_when", { when: member.need.when })} /></li>}
            {member.absent && (
              <li>
                <b>{t("docs.ref.absent")}</b> <Line text={member.absent} />
              </li>
            )}
          </ul>
        )}
        {hook && (
          <>
            <h2 id="when-it-is-asked">{t("docs.sdk.asked")}</h2>
            <dl className="asked">
              <div>
                <dt>{t("docs.sdk.stage")}</dt>
                <dd data-testid="sdk-stage">{member.stages?.length ? member.stages.map((s) => <Link key={s} to="/api/rules#the-loop" className="stage">{s}</Link>) : t("docs.sdk.stage_none")}</dd>
              </div>
              <div>
                <dt>{t("docs.sdk.how_often")}</dt>
                <dd><Line text={member.asked ?? ""} /></dd>
              </div>
              <div>
                <dt>{t("docs.sdk.given")}</dt>
                <dd><Line text={t(`docs.sdk.given.${member.given ?? "values"}`)} /></dd>
              </div>
            </dl>
            {member.before && (
              <>
                <h3 id="before-it-is-asked">{t("docs.sdk.before")}</h3>
                <Refused items={member.before} />
              </>
            )}
          </>
        )}
        {member.kind !== "property" && (
          <>
            <h2 id="parameters">{t("docs.sdk.params")}</h2>
            {member.params?.length ? <div className="ref-fields" data-testid="sdk-params"><Params params={member.params} owner="param" /></div> : <p className="muted">{t("docs.sdk.no_params")}</p>}
          </>
        )}
        {member.returns && (
          <>
            <h2 id="returns">{t("docs.sdk.returns")}</h2>
            <div className="returns returns-top" data-testid="sdk-returns">
              <p className="field-head"><TypeTag text={member.returns.type} /></p>
              <p className="field-text"><Line text={member.returns.description} /></p>
              <Cases values={member.returns.values} title={t("docs.sdk.cases")} />
            </div>
          </>
        )}
        {hook && member.after && (
          <>
            <h3 id="after-it-returns">{t("docs.sdk.after")}</h3>
            <Refused items={member.after} />
          </>
        )}
        {member.rules && (
          <>
            <h2 id="what-must-hold">{t("docs.sdk.rules")}</h2>
            <Rules rules={member.rules} />
          </>
        )}
        {member.refused && (
          <>
            <h2 id="refused-when">{t("docs.sdk.refused")}</h2>
            <p className="muted">{t("docs.sdk.refused_blurb")}</p>
            <Refused items={member.refused} />
          </>
        )}
        {member.members?.map((group) => (
          <section key={group.title} className="ref-group">
            <h2 id={group.title.toLowerCase().replace(/\W+/g, "-")}>{group.title}</h2>
            {group.note && <p><Line text={group.note} /></p>}
            <nav className="jump" aria-label={group.title}>
              {group.members.map((m) => (
                <a key={m.name} href={`#${innerAnchor(group.name, m.name)}`}><code>{m.name}</code></a>
              ))}
            </nav>
            <ul className="fields">
              {group.members.map((m) => (
                <Inner key={m.name} member={m} owner={group.name} />
              ))}
            </ul>
          </section>
        ))}
        <Pager area="api" path={memberPath(root.root, member)} />
      </article>
      <Examples examples={member.examples ?? []} />
    </div>
  );
}

function RootRow({ root, member }: { root: SdkRoot; member: Member }): ReactNode {
  const to = member.page ? memberPath(root.root, member) : member.from ? `${sdkRootPath("view")}${memberPagePath(member)}` : undefined;
  const anchor = member.name.toLowerCase();
  return (
    <li className={`field ${member.page ? "field-page" : ""}`} id={anchor}>
      <p className="field-head">
        {member.page ? (
          <Link className="field-name" to={to!} data-testid="sdk-child"><code>{member.name}</code></Link>
        ) : (
          <a className="field-name" href={`#${anchor}`}><code>{member.name}</code></a>
        )}
        <span className="type"><span className="type-fact">{kindOf(member)}</span></span>
        {member.kind === "hook" && member.need && <NeedTag need={member.need} />}
      </p>
      <Sig text={member.signature} />
      <p className="field-text"><Line text={member.description} /></p>
      {!member.page && !member.from && member.about?.map((p, i) => <p key={i} className="field-text"><Line text={p} /></p>)}
      {member.kind === "hook" && <Rules absent={member.absent} need={member.need} />}
      {!member.page && !member.from && <Rules rules={member.rules} />}
      {!member.page && !member.from && <Cases values={member.returns?.values} title={t("docs.sdk.cases")} />}
      {member.page && (
        <p className="field-more">
          <Link to={to!}>{t("docs.sdk.open")}</Link>
        </p>
      )}
      {member.from && (
        <p className="field-more">
          <Link to={to!}>{t("docs.sdk.from_view")}</Link>
        </p>
      )}
    </li>
  );
}

/** Where a view's member is defined: its own page, or its row on the view's page. */
const VIEW_PAGES = new Set(["board", "zone", "next", "sideOf", "seatsOf"]);
const memberPagePath = (member: Member): string => (VIEW_PAGES.has(member.name) ? `/${member.name}` : `#${member.name.toLowerCase()}`);

/** The page of the rules object, a view or a context: every member it has, with a link to the page of each. */
export function SdkRootPage({ root }: { root: SdkRoot }) {
  useTitle(root.title);
  return (
    <div className="ref" data-testid={`sdk-${root.root}`}>
      <article className="prose ref-main">
        <header className="doc-head">
          <Crumbs items={[{ title: t("docs.area.api"), path: "/api" }, { title: t("docs.sdk.group") }]} />
          <h1>{root.title}</h1>
          <p className="ref-type">
            <span className="type"><span className="type-name">{root.name}{"<P, S>"}</span><span className="type-fact"><code>@openseas/engine</code></span></span>
          </p>
          <p className="lede"><Line text={root.lede} /></p>
        </header>
        <Preview />
        {root.about.map((p, i) => (
          <p key={i}><Line text={p} /></p>
        ))}
        <h2 id="members">{t(root.root === "hooks" ? "docs.sdk.hooks" : "docs.sdk.members")}</h2>
        {root.groups.map((group) => (
          <section key={group.title} className="ref-group">
            <h3>{group.title}</h3>
            {group.note && <p className="muted"><Line text={group.note} /></p>}
            <ul className="fields">
              {group.members.map((m) => (
                <RootRow key={m.name} root={root} member={m} />
              ))}
            </ul>
          </section>
        ))}
        {root.holds && (
          <>
            <h2 id="what-holds">{root.holds.title}</h2>
            <ul className="holds">
              {root.holds.items.map((item, i) => (
                <li key={i}><Line text={item} /></li>
              ))}
            </ul>
          </>
        )}
        <Pager area="api" path={sdkRootPath(root.root)} />
      </article>
      <Examples examples={[root.example]} />
    </div>
  );
}

function TypeRow({ def }: { def: TypeDef }) {
  const anchor = typeAnchor(def.name);
  return (
    <li className="field member" id={anchor} data-testid="sdk-type">
      <p className="field-head">
        <a className="field-name" href={`#${anchor}`}><code>{def.name}</code></a>
      </p>
      <p className="field-text"><Line text={def.description} /></p>
      <Sig text={definitionOf(def)} label={t("docs.sdk.declared")} />
      {def.detail?.map((d, i) => (
        <p key={i} className="field-text"><Line text={d} /></p>
      ))}
      <Cases values={def.values} />
      {def.fields && (
        <details className="children" open>
          <summary>{t("docs.sdk.fields")}</summary>
          <Params params={def.fields} />
        </details>
      )}
      {def.forms && (
        <div className="forms">
          <p className="values-title">{t("docs.ref.one_of")}</p>
          {def.forms.map((form) => (
            <div key={form.label} className="form">
              <p className="form-head">
                <span className="form-name">{form.label}</span>
                <TypeTag text={form.type} />
              </p>
              <p className="form-note"><Line text={form.description} /></p>
              {form.fields && <Params params={form.fields} />}
            </div>
          ))}
        </div>
      )}
      {def.examples && (
        <p className="written">
          <span className="values-title">{t("docs.sdk.written")}</span>
          {def.examples.map((e) => (
            <code key={e}>{e}</code>
          ))}
        </p>
      )}
    </li>
  );
}

function MapTable({ rows }: { rows: readonly (readonly [string, string, string])[] }) {
  return (
    <div className="table-scroll" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th>{t("docs.sdk.in_puzzle")}</th>
            <th>{t("docs.sdk.in_rules")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map(([from, to, note]) => (
            <tr key={from}>
              <td><code>{from}</code></td>
              <td><code><Ts text={to} /></code></td>
              <td><Line text={note} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The two functions and every type of the SDK, each down to what it is made of, and the declarations whole. */
export function SdkTypesPage() {
  useTitle(t("docs.sdk.types_title"));
  return (
    <div className="doc" data-testid="sdk-types">
      <article className="prose">
        <header className="doc-head">
          <Crumbs items={[{ title: t("docs.area.api"), path: "/api" }, { title: t("docs.sdk.group") }]} />
          <h1>{t("docs.sdk.types_title")}</h1>
          <p className="lede">{t("docs.sdk.types_lede")}</p>
        </header>
        <Preview />
        <h2 id="functions">{t("docs.sdk.functions")}</h2>
        <ul className="fields">
          {FUNCTIONS.map((fn) => (
            <li key={fn.name} className="field member" id={typeAnchor(fn.name)} data-testid="sdk-function">
              <p className="field-head">
                <a className="field-name" href={`#${typeAnchor(fn.name)}`}><code>{fn.name}</code></a>
                <span className="type"><span className="type-fact">{kindOf(fn)}</span></span>
              </p>
              <Sig text={fn.signature} />
              <p className="field-text"><Line text={fn.description} /></p>
              {fn.about?.map((p, i) => (
                <p key={i} className="field-text"><Line text={p} /></p>
              ))}
              <details className="children" open>
                <summary>{t("docs.sdk.params")}</summary>
                <Params params={fn.params ?? []} />
              </details>
              {fn.returns && (
                <div className="returns">
                  <p className="values-title">{t("docs.sdk.returns")}</p>
                  <p className="field-head"><TypeTag text={fn.returns.type} /></p>
                  <p className="field-text"><Line text={fn.returns.description} /></p>
                </div>
              )}
              {fn.examples?.map((e) => (
                <Code key={e.title} code={e.code} lang="ts" title={e.title} />
              ))}
            </li>
          ))}
        </ul>
        {TYPE_GROUPS.map((group, i) => (
          <section key={group.title} className="ref-group">
            <h2 id={group.title.toLowerCase().replace(/[^a-z]+/g, "-")}>{group.title}</h2>
            {group.note && <p><Line text={group.note} /></p>}
            <ul className="fields">
              {group.types.map((def) => (
                <TypeRow key={def.name} def={def} />
              ))}
            </ul>
            {i === 0 && (
              <>
                <h3 id="a-generated-type">{t("docs.sdk.generated")}</h3>
                <p><Line text={t("docs.sdk.generated_blurb")} /></p>
                <Code code={SWAP_GEN.trim()} lang="ts" title="swap.puzzle.gen.ts" />
                <h3 id="ids">{t("docs.sdk.ids")}</h3>
                <p><Line text={t("docs.sdk.ids_blurb")} /></p>
                <div className="ref-fields">
                  <Cases values={ID_TYPES} title={t("docs.sdk.ids")} />
                </div>
              </>
            )}
          </section>
        ))}
        <h2 id="how-a-field-reaches-the-rules">{t("docs.sdk.field_map")}</h2>
        <p><Line text={t("docs.sdk.field_map_blurb")} /></p>
        <MapTable rows={FIELD_MAP} />
        <h2 id="how-a-setting-reaches-the-rules">{t("docs.sdk.setting_map")}</h2>
        <p><Line text={t("docs.sdk.setting_map_blurb")} /></p>
        <MapTable rows={SETTING_MAP} />
        <h2 id="the-whole-surface">{t("docs.sdk.surface")}</h2>
        <p><Line text={t("docs.sdk.surface_blurb")} /></p>
        <Code code={ENGINE_DTS.trim()} lang="ts" title="engine.d.ts" tall />
        <Pager area="api" path={SDK_TYPES_PATH} />
      </article>
    </div>
  );
}
