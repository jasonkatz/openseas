import { Fragment, type ReactNode } from "react";
import { pretty } from "../api/pretty.js";
import {
  ALIASES,
  FIELD_TYPES,
  TYPES_PATH,
  isPage,
  needLabel,
  pagePath,
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
import { Link } from "../router.jsx";
import { Pager } from "../Shell.jsx";
import { useTitle } from "./DocPage.jsx";

function NeedTag({ need }: { need: Need }) {
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

function Crumbs({ items }: { items: readonly { title: string; path?: string }[] }) {
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

/** A page for one object that belongs to a top-level object: every field it has, typed, and what must hold across them. */
export function ObjectRefPage({ root, page }: { root: RootObject; page: ObjectPage }) {
  useTitle(`${root.root}.${page.key}`);
  const { view } = pageView(page);
  const top = view.sections.flatMap((s) => s.nodes);
  return (
    <div className="ref" data-testid={`ref-${page.root}-${page.key}`}>
      <article className="prose ref-main">
        <header className="doc-head">
          <Crumbs items={[{ title: t("docs.area.api"), path: "/api" }, { title: root.title, path: rootPath(root.root) }, { title: page.key }]} />
          <h1><code>{page.key}</code></h1>
          <p className="ref-type">
            <TypeTag view={view} />
            <NeedTag need={page.need} />
          </p>
          <p className="lede"><Line text={page.lede} /></p>
        </header>
        {page.about?.map((p, i) => (
          <p key={i}><Line text={p} /></p>
        ))}
        {(typeof page.need !== "string" || page.absent) && (
          <ul className="notes notes-top">
            {typeof page.need !== "string" && <li className="note-when"><Line text={t("docs.ref.required_when", { when: page.need.when })} /></li>}
            {page.absent && (
              <li>
                <b>{t("docs.ref.absent")}</b> <Line text={page.absent} />
              </li>
            )}
          </ul>
        )}
        {page.ideas && (
          <p className="ideas">
            {t("docs.ref.ideas")} <Link to={page.ideas.path}>{page.ideas.title}</Link>
          </p>
        )}
        <h2 id="attributes">{t("docs.ref.attributes")}</h2>
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
            <h2 id="what-must-hold">{t("docs.ref.rules")}</h2>
            <p className="muted">{t("docs.ref.rules_blurb")}</p>
            <ul className="holds">
              {page.rules.map((rule, i) => (
                <li key={i}><Line text={rule} /></li>
              ))}
            </ul>
          </>
        )}
        <Pager area="api" path={pagePath(page)} />
      </article>
      <Examples examples={page.examples} width={52} />
    </div>
  );
}

/** A top-level object's page: what it is, every field it has, and a link to the page of each object inside it. */
export function RootRefPage({ root }: { root: RootObject }) {
  useTitle(t("docs.ref.object", { name: root.root }));
  const own = rootNodes(root);
  return (
    <div className="ref" data-testid={`ref-${root.root}`}>
      <article className="prose ref-main">
        <header className="doc-head">
          <Crumbs items={[{ title: t("docs.area.api"), path: "/api" }, { title: t("docs.ref.group.reference") }]} />
          <h1>{t("docs.ref.object", { name: root.root })}</h1>
          <p className="ref-type">
            <span className="type"><span className="type-name">object</span><span className="type-fact"><code>{root.file}</code></span></span>
          </p>
          <p className="lede"><Line text={root.lede} /></p>
        </header>
        {root.about.map((p, i) => (
          <p key={i}><Line text={p} /></p>
        ))}
        <h2 id="attributes">{t("docs.ref.attributes")}</h2>
        {root.groups.map((group) => (
          <section key={group.title} className="ref-group">
            <h3>{group.title}</h3>
            {group.note && <p className="muted"><Line text={group.note} /></p>}
            <ul className="fields">
              {group.fields.map((f) => {
                if (!isPage(f)) return <FieldRow key={f.name} node={own.get(f)!} />;
                const view = pageView(f).view;
                return (
                  <li key={f.key} className="field field-page" id={f.key.toLowerCase()}>
                    <p className="field-head">
                      <Link className="field-name" to={pagePath(f)} data-testid="ref-child"><code>{f.key}</code></Link>
                      <span className="type"><span className="type-name">{view.label}</span>{view.sections.length === 0 && view.facts.map((x) => <span key={x} className="type-fact">{x}</span>)}</span>
                      <NeedTag need={f.need} />
                    </p>
                    <p className="field-text"><Line text={f.lede} /></p>
                    {(typeof f.need !== "string" || f.absent) && (
                      <ul className="notes">
                        {typeof f.need !== "string" && <li className="note-when"><Line text={t("docs.ref.required_when", { when: f.need.when })} /></li>}
                        {f.absent && (
                          <li>
                            <b>{t("docs.ref.absent")}</b> <Line text={f.absent} />
                          </li>
                        )}
                      </ul>
                    )}
                    <p className="field-more">
                      <Link to={pagePath(f)}>{t("docs.ref.see")}</Link>
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        <h2 id="when-it-is-ready">{t("docs.ref.ready")}</h2>
        <p><Line text={root.ready.intro} /></p>
        <ul className="holds">
          {root.ready.items.map((item, i) => (
            <li key={i}><Line text={item} /></li>
          ))}
        </ul>
        {root.ready.outro && <p><Line text={root.ready.outro} /></p>}
        <Pager area="api" path={rootPath(root.root)} />
      </article>
      <Examples examples={[root.example]} width={52} />
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
          <Crumbs items={[{ title: t("docs.area.api"), path: "/api" }, { title: t("docs.ref.group.reference") }]} />
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
        <Pager area="api" path={TYPES_PATH} />
      </article>
    </div>
  );
}
