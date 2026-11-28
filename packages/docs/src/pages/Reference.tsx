import { Fragment, type ReactNode } from "react";
import { pretty } from "../api/pretty.js";
import {
  ALIASES,
  FIELD_TYPES,
  TYPES_PATH,
  isPage,
  needLabel,
  pageAnchor,
  pageView,
  rootNodes,
  rootPath,
  viewOf,
  type Example,
  type Field,
  type Need,
  type Node,
  type ObjectPage,
  type RootObject,
  type Section,
  type TypeView,
} from "../api/schema/index.js";
import { t } from "../content.js";
import { Code, Line } from "../md/Markdown.jsx";
import { slug } from "../md/slug.js";
import { Link } from "../router.jsx";
import { Pager } from "../Shell.jsx";
import { useTitle } from "./DocPage.jsx";

export function NeedTag({ need }: { need: Need }) {
  const label = needLabel(need);
  return <span className={`need need-${label}`}>{t(`docs.ref.${label}`)}</span>;
}

/** A type in a few words, with what narrows it, and a link where it is defined elsewhere. */
function TypeTag({ view }: { view: TypeView }) {
  const label = view.link ? <Link to={view.link.path}>{view.label}</Link> : view.label;
  return (
    <span className="type">
      <span className="type-name">{label}</span>
      {view.facts.map((fact) => (
        <span key={fact} className="type-fact">{fact}</span>
      ))}
    </span>
  );
}

function Values({ view }: { view: TypeView }) {
  if (!view.values) return null;
  return (
    <div className="values">
      <p className="values-title">{t("docs.ref.values")}</p>
      <dl>
        {view.values.map((v) => (
          <div key={String(v.value)}>
            <dt><code>{typeof v.value === "string" ? v.value : String(v.value)}</code></dt>
            <dd><Line text={v.description} /></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Keys({ view }: { view: TypeView }) {
  if (!view.keys) return null;
  return (
    <div className="values">
      <p className="values-title">{t("docs.ref.keys")}</p>
      <dl>
        <div>
          <dt><code>{view.keys.key}</code></dt>
          <dd><Line text={view.keys.note} /></dd>
        </div>
        {view.keys.fixed?.map((v) => (
          <div key={String(v.value)}>
            <dt><code>{String(v.value)}</code></dt>
            <dd><Line text={v.description} /></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const sectionTitle = (s: Section): ReactNode => {
  if (s.kind === "child") return t("docs.ref.child");
  if (s.kind === "each") return t("docs.ref.each", { name: s.name });
  if (s.kind === "every") return t("docs.ref.every", { name: s.name });
  return s.name;
};

/** What sits inside a type: its values, its keys, and the fields of whatever it holds. */
function Inside({ view, open }: { view: TypeView; open: boolean }) {
  const forms = view.sections.filter((s) => s.kind === "one" || s.kind === "form");
  const rest = view.sections.filter((s) => s.kind !== "one" && s.kind !== "form");
  return (
    <>
      {view.note && <p className="field-note"><Line text={view.note} /></p>}
      <Keys view={view} />
      <Values view={view} />
      {forms.length > 0 && (
        <div className="forms">
          <p className="values-title">{t("docs.ref.one_of")}</p>
          {forms.map((s) => (
            <div key={s.name} className="form">
              <p className="form-head">
                <span className="form-name">{s.kind === "form" ? <code>{s.name}</code> : s.name}</span>
                {s.view && <TypeTag view={s.view} />}
              </p>
              {s.note && <p className="form-note"><Line text={s.note} /></p>}
              {s.view && <Inside view={s.view} open />}
              {s.nodes.length > 0 && <Fields nodes={s.nodes} />}
            </div>
          ))}
        </div>
      )}
      {rest.map((s) => (
        <details key={s.kind + s.name} className={`children ${s.view ? "children-entry" : ""}`} open={open}>
          <summary>{sectionTitle(s)}</summary>
          {s.note && <p className="form-note"><Line text={s.note} /></p>}
          {s.view && (
            <div className="entry">
              <p className="form-head"><TypeTag view={s.view} /></p>
              <Inside view={s.view} open />
            </div>
          )}
          {s.nodes.length > 0 && <Fields nodes={s.nodes} />}
        </details>
      ))}
    </>
  );
}

function Notes({ field }: { field: Field }) {
  const rules = field.rules ?? [];
  if (typeof field.need === "string" && !field.absent && rules.length === 0) return null;
  return (
    <ul className="notes">
      {typeof field.need !== "string" && (
        <li className="note-when"><Line text={t("docs.ref.required_when", { when: field.need.when })} /></li>
      )}
      {field.absent && (
        <li>
          <b>{t("docs.ref.absent")}</b> <Line text={field.absent} />
        </li>
      )}
      {rules.map((rule, i) => (
        <li key={i} className={`note-${rule.kind}`}>
          <b>{t(`docs.ref.${rule.kind}`)}</b> <Line text={lower(rule.text)} />
        </li>
      ))}
    </ul>
  );
}

/** A rule reads on from its label: "Never together with phases." */
const lower = (text: string): string => (/^[A-Z][a-z ]/.test(text) && !/^[A-Z] or /.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text);

function FieldRow({ node }: { node: Node }) {
  const { field, view } = node;
  return (
    <li className="field" id={node.anchor}>
      <p className="field-head">
        <a className="field-name" href={`#${node.anchor}`}><code>{node.path}</code></a>
        <TypeTag view={view} />
        <NeedTag need={field.need} />
      </p>
      <p className="field-text"><Line text={field.description} /></p>
      <Notes field={field} />
      <Inside view={view} open />
    </li>
  );
}

function Fields({ nodes }: { nodes: readonly Node[] }) {
  return (
    <ul className="fields">
      {nodes.map((node) => (
        <FieldRow key={node.anchor} node={node} />
      ))}
    </ul>
  );
}

function Examples({ examples, width }: { examples: readonly Example[]; width: number }) {
  return (
    <aside className="ref-side" aria-label={t("docs.ref.examples")}>
      {examples.map((e) => (
        <div key={e.title} className="example">
          <Code code={pretty(e.value, width)} lang="json" title={e.title} />
          {e.note && <p className="example-note"><Line text={e.note} /></p>}
        </div>
      ))}
    </aside>
  );
}

export function Crumbs({ items }: { items: readonly { title: string; path?: string }[] }) {
  return (
    <p className="eyebrow crumbs">
      {items.map((item, i) => (
        <Fragment key={item.title}>
          {i > 0 && <span aria-hidden="true"> / </span>}
          {item.path ? <Link to={item.path}>{item.title}</Link> : item.title}
        </Fragment>
      ))}
    </p>
  );
}

export interface TocGroup {
  readonly title: string;
  readonly items: readonly { readonly name: string; readonly anchor: string }[];
}

/** Where a group's heading is on a reference page. */
export const groupAnchor = (title: string): string => `group-${slug(title)}`;

/** A reference page's table of contents: each group of the page, and under it every key or member the group holds. */
export function Toc({ groups, tail = [] }: { groups: readonly TocGroup[]; tail?: readonly { title: string; anchor: string }[] }) {
  return (
    <nav className="ref-toc" aria-label={t("docs.ref.contents")} data-testid="ref-toc">
      <h2 id="contents">{t("docs.ref.contents")}</h2>
      <ol>
        {groups.map((group) => (
          <li key={group.title}>
            <a href={`#${groupAnchor(group.title)}`}>{group.title}</a>
            <ol>
              {group.items.map((item) => (
                <li key={item.anchor}>
                  <a href={`#${item.anchor}`}><code>{item.name}</code></a>
                </li>
              ))}
            </ol>
          </li>
        ))}
        {tail.map((item) => (
          <li key={item.anchor}>
            <a href={`#${item.anchor}`}>{item.title}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** What a field's need and absence say, where they say anything. */
function PageNotes({ page, top }: { page: ObjectPage; top?: boolean }) {
  if (typeof page.need === "string" && !page.absent) return null;
  return (
    <ul className={`notes ${top ? "notes-top" : ""}`}>
      {typeof page.need !== "string" && <li className="note-when"><Line text={t("docs.ref.required_when", { when: page.need.when })} /></li>}
      {page.absent && (
        <li>
          <b>{t("docs.ref.absent")}</b> <Line text={page.absent} />
        </li>
      )}
    </ul>
  );
}

/** One object that belongs to a top-level object, as a section of its page: every field it has, typed, what must hold across them, and its examples beside it. */
function ObjectSection({ page }: { page: ObjectPage }) {
  const { view } = pageView(page);
  const top = view.sections.flatMap((s) => s.nodes);
  const anchor = pageAnchor(page);
  return (
    <section className="ref ref-section" id={anchor} data-testid={`ref-${page.root}-${page.key}`}>
      <div className="prose ref-main">
        <h3 className="ref-key">
          <a href={`#${anchor}`} data-testid="ref-child"><code>{page.key}</code></a>
        </h3>
        <p className="ref-type">
          <TypeTag view={view} />
          <NeedTag need={page.need} />
        </p>
        <p className="lede"><Line text={page.lede} /></p>
        {page.about?.map((p, i) => (
          <p key={i}><Line text={p} /></p>
        ))}
        <PageNotes page={page} top />
        {page.ideas && (
          <p className="ideas">
            {t("docs.ref.ideas")} <Link to={page.ideas.path}>{page.ideas.title}</Link>
          </p>
        )}
        {top.length > 3 && (
          <nav className="jump" aria-label={t("docs.ref.jump")}>
            {top.map((n) => (
              <a key={n.anchor} href={`#${n.anchor}`}><code>{n.field.name}</code></a>
            ))}
          </nav>
        )}
        <div className="ref-fields" data-testid="ref-fields">
          <Inside view={view} open />
        </div>
        {page.rules && (
          <>
            <h4>{t("docs.ref.rules")}</h4>
            <p className="muted">{t("docs.ref.rules_blurb")}</p>
            <ul className="holds">
              {page.rules.map((rule, i) => (
                <li key={i}><Line text={rule} /></li>
              ))}
            </ul>
          </>
        )}
      </div>
      <Examples examples={page.examples} width={52} />
    </section>
  );
}

/** A group's fields in the order the file is written, cut into runs: single values listed together, each object a section. */
function runsOf(fields: readonly (Field | ObjectPage)[]): (Field[] | ObjectPage)[] {
  const out: (Field[] | ObjectPage)[] = [];
  for (const f of fields) {
    const last = out.at(-1);
    if (isPage(f)) out.push(f);
    else if (Array.isArray(last)) last.push(f);
    else out.push([f]);
  }
  return out;
}

/** A top-level object's page: what it is, and everything in it, down to the last field of the last object inside it. */
export function RootRefPage({ root }: { root: RootObject }) {
  useTitle(t("docs.ref.object", { name: root.root }));
  const own = rootNodes(root);
  return (
    <div className="ref-page" data-testid={`ref-${root.root}`}>
      <div className="ref">
        <article className="prose ref-main">
          <header className="doc-head">
            <Crumbs items={[{ title: t("docs.area.reference"), path: "/reference" }, { title: t("docs.ref.group.documents") }]} />
            <h1>{t("docs.ref.object", { name: root.root })}</h1>
            <p className="ref-type">
              <span className="type"><span className="type-name">object</span><span className="type-fact"><code>{root.file}</code></span></span>
            </p>
            <p className="lede"><Line text={root.lede} /></p>
          </header>
          {root.about.map((p, i) => (
            <p key={i}><Line text={p} /></p>
          ))}
          <Toc
            groups={root.groups.map((group) => ({
              title: group.title,
              items: group.fields.map((f) => (isPage(f) ? { name: f.key, anchor: pageAnchor(f) } : { name: f.name, anchor: own.get(f)!.anchor })),
            }))}
            tail={[{ title: t("docs.ref.ready"), anchor: "when-it-is-ready" }]}
          />
        </article>
        <Examples examples={[root.example]} width={52} />
      </div>
      {root.groups.map((group) => (
        <Fragment key={group.title}>
          <div className="ref ref-group-head">
            <div className="prose ref-main">
              <h2 id={groupAnchor(group.title)}>{group.title}</h2>
              {group.note && <p className="muted"><Line text={group.note} /></p>}
            </div>
          </div>
          {runsOf(group.fields).map((run) =>
            Array.isArray(run) ? (
              <div key={run[0]!.name} className="ref">
                <div className="prose ref-main ref-group">
                  <ul className="fields">
                    {run.map((f) => (
                      <FieldRow key={f.name} node={own.get(f)!} />
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <ObjectSection key={run.key} page={run} />
            ),
          )}
        </Fragment>
      ))}
      <div className="ref">
        <div className="prose ref-main">
          <h2 id="when-it-is-ready">{t("docs.ref.ready")}</h2>
          <p><Line text={root.ready.intro} /></p>
          <ul className="holds">
            {root.ready.items.map((item, i) => (
              <li key={i}><Line text={item} /></li>
            ))}
          </ul>
          {root.ready.outro && <p><Line text={root.ready.outro} /></p>}
          <Pager area="reference" path={rootPath(root.root)} />
        </div>
      </div>
    </div>
  );
}

const PRIMITIVES: readonly (readonly [string, string, string])[] = [
  ["string", "Text, in double quotes.", "\"paths\""],
  ["integer", "A whole number, with no decimal point. The reference gives its least and most where it has them.", "120"],
  ["number", "A number that may have a decimal point. Only a skin and a theme use one: a puzzle's numbers are all whole.", "0.088"],
  ["boolean", "True or false, written without quotes.", "true"],
  ["enum", "One of a fixed set of values, each listed and explained where the field is. Most are strings. A few are whole numbers.", "\"still\""],
  ["array", "A list in square brackets, in order. The reference always says what it is a list of, and how many it may hold.", "[\"clear\", \"loop\"]"],
  ["object", "Keys and values in braces. Either its keys are fixed, and each is listed, or the author chooses them, and the reference says what a key is.", "{ \"kind\": \"still\" }"],
];

const READING: readonly (readonly [string, string])[] = [
  ["required", "The key is always written. A list with nothing in it is written `[]`, and an object with nothing in it `{}`."],
  ["optional", "The key may be left out. The field says what leaving it out means."],
  ["conditional", "The key is written in one case and refused in every other. The field says which case, and what it may never sit beside."],
];

/** The value types the reference uses, each down to what it is in JSON. */
export function TypesPage() {
  useTitle(t("docs.ref.types_title"));
  const none = { slug: (text: string) => text };
  return (
    <div className="doc" data-testid="ref-types">
      <article className="prose">
        <header className="doc-head">
          <Crumbs items={[{ title: t("docs.area.reference"), path: "/reference" }, { title: t("docs.ref.group.documents") }]} />
          <h1>{t("docs.ref.types_title")}</h1>
          <p className="lede">{t("docs.ref.types_lede")}</p>
        </header>
        <h2 id="reading-the-reference">{t("docs.ref.types_reading")}</h2>
        <ul className="fields">
          {READING.map(([need, text]) => (
            <li key={need} className="field">
              <p className="field-head"><NeedTag need={need === "conditional" ? { when: "" } : (need as Need)} /></p>
              <p className="field-text"><Line text={text} /></p>
            </li>
          ))}
        </ul>
        <h2 id="primitive-values">{t("docs.ref.types_primitives")}</h2>
        <ul className="fields">
          {PRIMITIVES.map(([name, text, example]) => (
            <li key={name} className="field" id={name}>
              <p className="field-head"><span className="field-name"><code>{name}</code></span><span className="type"><span className="type-fact"><code>{example}</code></span></span></p>
              <p className="field-text"><Line text={text} /></p>
            </li>
          ))}
        </ul>
        <h2 id="named-types">{t("docs.ref.types_named")}</h2>
        <ul className="fields">
          {ALIASES.map((a) => (
            <li key={a.name} className="field" id={a.name.replace(/\s+/g, "-")}>
              <p className="field-head">
                <a className="field-name" href={`#${a.name.replace(/\s+/g, "-")}`}><code>{a.name}</code></a>
                <span className="type"><span className="type-name">{a.primitive}</span></span>
              </p>
              <p className="field-text"><Line text={a.description} /></p>
              {a.detail?.map((d, i) => (
                <p key={i} className="field-text"><Line text={d} /></p>
              ))}
              <p className="written">
                <span className="values-title">{t("docs.ref.types_examples")}</span>
                {a.examples.map((e) => (
                  <code key={e}>{e}</code>
                ))}
              </p>
            </li>
          ))}
        </ul>
        <h2 id="field-types">{t("docs.ref.types_fields")}</h2>
        <div className="ref-fields">
          <Values view={{ ...viewOf({ kind: "enum", values: Object.entries(FIELD_TYPES).map(([value, description]) => ({ value, description })) }, "", none) }} />
        </div>
        <Pager area="reference" path={TYPES_PATH} />
      </article>
    </div>
  );
}
