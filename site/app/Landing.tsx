import { useLoader } from "@mauroandre/velojs/hooks";
import type { LoaderArgs } from "@mauroandre/velojs";
import { Link } from "@mauroandre/velojs";
import { Mark } from "./components/Mark.js";
import { CodeWindow } from "./components/CodeWindow.js";
import { highlight } from "./components/highlighted.js";
import * as css from "./Landing.css.js";

const REPO = "https://github.com/mauro-andre/weave";
const NPM = "https://www.npmjs.com/package/@mauroandre/weave-sdk";

const QUERY = `const weave = createClient({ url, key, entities });

const orders = await weave.order.findMany(
  {
    status: "paid",                                       // { eq: "paid" }, shorthand
    items: { some: { product: { name: { ilike: "%pro%" } } } },
  },
  {
    orderBy: { customer: { name: "asc" } },
    expand:  { customer: true, items: { product: true } },
  },
);

orders[0].customer.name;          // string  — typed, you expanded it
orders[0].items[0].product.price; // number  — nested, revived, inferred`;

const ENTITY = `export default defineEntity("order", {
  ref: text().notNull().unique(),
  status: text().notNull().default("open"),
  customer: reference(customer),
  items: owned(array({
    product: reference(product),
    qty: int4().notNull(),
  })),
});`;

const RUN = `docker run -p 3000:3000 \\
  -e DATABASE_URL=postgres://… \\
  ghcr.io/mauro-andre/weave`;

export const loader = async ({}: LoaderArgs) => ({
  query: await highlight(QUERY, "tsx"),
  entity: await highlight(ENTITY, "tsx"),
  run: await highlight(RUN, "bash"),
});

const FEATURES = [
  {
    color: "teal",
    title: "No SQL, ever",
    body: "Tables, joins and migrations never surface. Every interface — GUI, code, API — speaks the same object vocabulary.",
  },
  {
    color: "green",
    title: "Think in nested objects",
    body: "Compose with owned objects and reference other entities. Read a graph by asking to expand it — no join syntax.",
  },
  {
    color: "blue",
    title: "One query language",
    body: "The same WhereInput powers a GUI click, an SDK call, and a stored access rule. Learn it once.",
  },
  {
    color: "teal",
    title: "Typed end-to-end",
    body: "Returns self-type by your expand. No hand-written result types, no codegen drift — the shape follows the query.",
  },
  {
    color: "green",
    title: "Code or GUI, mixed",
    body: "Design entities in the dashboard or in code. The server is the source of truth; weave gen mirrors it back as readable .ts.",
  },
  {
    color: "blue",
    title: "Access control as code",
    body: "Scopes shape access per entity — which verbs, which rows, which fields — stored by stable id, enforced on the server.",
  },
] as const;

export const Component = () => {
  const { data } = useLoader<{ query: string; entity: string; run: string }>([]);
  const code = data.value;

  return (
    <div class={css.page}>
      {/* Nav */}
      <header class={css.nav}>
        <div class={css.navInner}>
          <Link to="/" class={css.brand}>
            <Mark size={26} />
            <span>Weave</span>
          </Link>
          <nav class={css.navLinks}>
            <Link to="/docs/getting-started" class={css.navLink}>
              Docs
            </Link>
            <a href={NPM} class={css.navLink} target="_blank" rel="noreferrer">
              npm
            </a>
            <a href={REPO} class={css.navGhBtn} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section class={css.hero}>
        <div class={css.glow} />
        <div class={css.heroGrid}>
          <div class={css.heroCopy}>
            <span class={css.eyebrow}>Code-first object layer over PostgreSQL</span>
            <h1 class={css.title}>
              Think in objects.
              <br />
              <span class={css.titleAccent}>Never write SQL.</span>
            </h1>
            <p class={css.lead}>
              Weave is an object abstraction over PostgreSQL. Design entities, query by nesting, and
              enforce access as code. The database speaks SQL underneath — you only ever speak
              objects.
            </p>
            <div class={css.ctaRow}>
              <Link to="/docs/getting-started" class={css.ctaPrimary}>
                Get started →
              </Link>
              <a href={REPO} class={css.ctaSecondary} target="_blank" rel="noreferrer">
                Star on GitHub
              </a>
            </div>
            <div class={css.installPill}>
              <span class={css.installPrompt}>$</span>
              npm install @mauroandre/weave-sdk
            </div>
          </div>
          <div class={css.heroCode}>
            <CodeWindow filename="orders.ts" html={code?.query} />
          </div>
        </div>
      </section>

      {/* Features */}
      <section class={css.section}>
        <div class={css.sectionHead}>
          <h2 class={css.sectionTitle}>A database that thinks like your code</h2>
          <p class={css.sectionSub}>
            Postgres gives you the durability. Weave gives you the developer experience.
          </p>
        </div>
        <div class={css.featureGrid}>
          {FEATURES.map((f) => (
            <div class={css.featureCard} key={f.title}>
              <span class={`${css.featureDot} ${css.dotColor[f.color]}`} />
              <h3 class={css.featureTitle}>{f.title}</h3>
              <p class={css.featureBody}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Two threads identity band */}
      <section class={css.threads}>
        <div class={css.threadsMark}>
          <Mark size={92} />
        </div>
        <h2 class={css.threadsTitle}>Two threads, woven</h2>
        <p class={css.threadsBody}>
          The <span class={css.blue}>relational</span> thread and the{" "}
          <span class={css.green}>object</span> thread, crossing where they meet. That interlace —
          the <span class={css.teal}>teal</span> — is the whole idea: the rigor of Postgres with the
          shape of the objects you actually work with.
        </p>
      </section>

      {/* Entities as code */}
      <section class={css.section}>
        <div class={css.split}>
          <div class={css.splitCopy}>
            <span class={css.eyebrow}>Entities as code</span>
            <h2 class={css.sectionTitle}>One file, one entity</h2>
            <p class={css.sectionSub}>
              Declare entities with the same builders the server uses — columns, owned objects,
              references. <code class={css.inlineCode}>weave push</code> diffs and applies them
              behind a risk gate; <code class={css.inlineCode}>weave gen</code> mirrors the server
              back into typed <code class={css.inlineCode}>.ts</code>.
            </p>
          </div>
          <div class={css.splitCode}>
            <CodeWindow filename="weave/entities/order.ts" html={code?.entity} />
          </div>
        </div>
      </section>

      {/* How you run it */}
      <section class={css.section}>
        <div class={css.sectionHead}>
          <h2 class={css.sectionTitle}>Two pieces, that's it</h2>
          <p class={css.sectionSub}>Run the server, install the client.</p>
        </div>
        <div class={css.runGrid}>
          <div class={css.runCard}>
            <h3 class={css.runTitle}>
              <span class={css.blue}>1.</span> The server
            </h3>
            <p class={css.runBody}>
              Engine, dashboard and API in one container. Point it at your Postgres and go.
            </p>
            <CodeWindow filename="ghcr.io" html={code?.run} />
          </div>
          <div class={css.runCard}>
            <h3 class={css.runTitle}>
              <span class={css.green}>2.</span> The SDK
            </h3>
            <p class={css.runBody}>
              Install the typed client in your app. Objects in, objects out, HTTP invisible.
            </p>
            <div class={css.installPillStatic}>
              <span class={css.installPrompt}>$</span>
              npm install @mauroandre/weave-sdk
            </div>
            <Link to="/docs/getting-started" class={css.runDocsLink}>
              Read the quickstart →
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section class={css.cta}>
        <h2 class={css.ctaTitle}>Start weaving</h2>
        <p class={css.ctaSub}>From a Postgres URL to a typed object client in minutes.</p>
        <div class={css.ctaRow}>
          <Link to="/docs/getting-started" class={css.ctaPrimary}>
            Read the docs →
          </Link>
          <a href={REPO} class={css.ctaSecondary} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
      </section>

      <footer class={css.footer}>
        <div class={css.brand}>
          <Mark size={20} />
          <span>Weave</span>
        </div>
        <span class={css.footerNote}>Code-first objects over PostgreSQL · MIT</span>
      </footer>
    </div>
  );
};
