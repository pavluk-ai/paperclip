import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const DOCS = [
  {
    input: path.join(repoRoot, "doc/pavluk-ai/ultimate-agent-guide.md"),
    output: path.join(repoRoot, "doc/pavluk-ai/ultimate-agent-guide.html"),
    title: "Ultimate Agent Prompt Guide for Paperclip",
    description: "Rendered companion for the Markdown source of the Ultimate Agent Prompt Guide for Paperclip.",
  },
  {
    input: path.join(repoRoot, "doc/pavluk-ai/autonomous-company-playbook.md"),
    output: path.join(repoRoot, "doc/pavluk-ai/autonomous-company-playbook.html"),
    title: "Autonomous Company Playbook",
    description: "Rendered companion for the Markdown source of the Autonomous Company Playbook.",
  },
];

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function resolveMarkedModule() {
  const directCandidates = [
    path.join(repoRoot, "node_modules/marked/lib/marked.esm.js"),
  ];
  for (const candidate of directCandidates) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // continue
    }
  }

  const pnpmDir = path.join(repoRoot, "node_modules/.pnpm");
  const entries = await readdir(pnpmDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("marked@")) continue;
    const candidate = path.join(
      pnpmDir,
      entry.name,
      "node_modules/marked/lib/marked.esm.js",
    );
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // continue
    }
  }

  throw new Error("Could not locate marked ESM bundle in node_modules");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderToc(headings) {
  return headings
    .map((heading) => {
      const indentClass =
        heading.depth === 1 ? "toc-depth-1" : heading.depth === 2 ? "toc-depth-2" : "toc-depth-3";
      return `<a class="toc-link ${indentClass}" href="#${heading.id}">${escapeHtml(heading.text)}</a>`;
    })
    .join("\n");
}

function renderPage({ title, description, tocHtml, bodyHtml, sourcePath }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <style>
    :root {
      color-scheme: light;
      --bg: #ffffff;
      --panel: #f8fafc;
      --panel-2: #f1f5f9;
      --text: #0f172a;
      --muted: #475569;
      --border: #e2e8f0;
      --link: #2563eb;
      --link-hover: #1d4ed8;
      --code-bg: #0f172a;
      --code-text: #e2e8f0;
      --accent: #dbeafe;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.7;
    }

    .layout {
      display: grid;
      grid-template-columns: 300px minmax(0, 1fr);
      min-height: 100vh;
    }

    .sidebar {
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      padding: 24px 18px 32px;
      border-right: 1px solid var(--border);
      background: var(--panel);
    }

    .eyebrow {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 10px;
    }

    .sidebar h1 {
      margin: 0 0 10px;
      font-size: 20px;
      line-height: 1.25;
    }

    .sidebar p {
      margin: 0 0 18px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.55;
    }

    .toc {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .toc-link {
      display: block;
      padding: 7px 10px;
      border-radius: 8px;
      color: var(--muted);
      text-decoration: none;
      font-size: 14px;
    }

    .toc-link:hover,
    .toc-link.active {
      background: var(--accent);
      color: var(--link-hover);
    }

    .toc-depth-2 { padding-left: 18px; }
    .toc-depth-3 { padding-left: 28px; }

    .main {
      min-width: 0;
      padding: 48px 40px 72px;
    }

    .source {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 999px;
      background: var(--panel);
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 24px;
    }

    .article {
      max-width: 88ch;
      margin: 0 auto;
    }

    .article h1,
    .article h2,
    .article h3,
    .article h4 {
      line-height: 1.25;
      margin-top: 1.8em;
      margin-bottom: 0.6em;
      scroll-margin-top: 24px;
    }

    .article h1 { font-size: 2.4rem; margin-top: 0; }
    .article h2 { font-size: 1.7rem; padding-top: 0.2em; border-top: 1px solid var(--border); }
    .article h3 { font-size: 1.25rem; }
    .article h4 { font-size: 1.05rem; }

    .article p,
    .article ul,
    .article ol,
    .article blockquote,
    .article table,
    .article pre {
      margin: 0 0 1rem;
    }

    .article ul,
    .article ol { padding-left: 1.5rem; }
    .article li + li { margin-top: 0.25rem; }

    .article a {
      color: var(--link);
      text-decoration: none;
    }

    .article a:hover { text-decoration: underline; }

    .article code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 0.92em;
      background: var(--panel-2);
      border-radius: 6px;
      padding: 0.15em 0.35em;
    }

    .article pre {
      overflow-x: auto;
      background: var(--code-bg);
      color: var(--code-text);
      border-radius: 14px;
      padding: 16px 18px;
    }

    .article pre code {
      background: transparent;
      color: inherit;
      padding: 0;
    }

    .article blockquote {
      margin-left: 0;
      padding: 0.9rem 1rem;
      border-left: 4px solid #93c5fd;
      background: #eff6ff;
      color: #1e3a8a;
      border-radius: 0 10px 10px 0;
    }

    .article hr {
      border: 0;
      border-top: 1px solid var(--border);
      margin: 2rem 0;
    }

    .article table {
      width: 100%;
      border-collapse: collapse;
      display: block;
      overflow-x: auto;
    }

    .article th,
    .article td {
      text-align: left;
      vertical-align: top;
      border: 1px solid var(--border);
      padding: 10px 12px;
    }

    .article th {
      background: var(--panel);
      font-weight: 700;
    }

    @media (max-width: 900px) {
      .layout {
        grid-template-columns: 1fr;
      }

      .sidebar {
        position: static;
        height: auto;
        border-right: 0;
        border-bottom: 1px solid var(--border);
      }

      .main {
        padding: 28px 20px 56px;
      }
    }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="eyebrow">Rendered Companion</div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
      <nav class="toc">
${tocHtml}
      </nav>
    </aside>
    <main class="main">
      <article class="article">
        <div class="source">Source: <code>${escapeHtml(sourcePath)}</code></div>
${bodyHtml}
      </article>
    </main>
  </div>
  <script>
    const links = [...document.querySelectorAll(".toc-link")];
    const sections = links
      .map((link) => {
        const id = link.getAttribute("href")?.slice(1);
        if (!id) return null;
        const element = document.getElementById(id);
        return element ? { link, element } : null;
      })
      .filter(Boolean);

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      const id = visible.target.getAttribute("id");
      links.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === "#" + id));
    }, { rootMargin: "-20% 0px -70% 0px", threshold: [0, 1] });

    sections.forEach(({ element }) => observer.observe(element));
  </script>
</body>
</html>
`;
}

async function renderDoc(marked, config) {
  const markdown = await readFile(config.input, "utf8");
  const tokens = marked.lexer(markdown);
  const headings = [];
  const slugCounts = new Map();

  for (const token of tokens) {
    if (token.type !== "heading" || token.depth > 3) continue;
    const base = slugify(token.text) || "section";
    const count = slugCounts.get(base) ?? 0;
    slugCounts.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count + 1}`;
    headings.push({ depth: token.depth, text: token.text, id });
  }

  const headingIds = new Map(headings.map((heading) => [heading.text, heading.id]));
  const renderer = new marked.Renderer();
  renderer.heading = ({ tokens: headingTokens, depth }) => {
    const text = marked.Parser.parseInline(headingTokens);
    const plainText = headingTokens.map((token) => token.raw ?? "").join("").trim();
    const fallback = slugify(plainText) || "section";
    const id = headingIds.get(plainText) ?? fallback;
    return `<h${depth} id="${id}">${text}</h${depth}>`;
  };

  const bodyHtml = marked.parse(markdown, { renderer, gfm: true });
  const tocHtml = renderToc(headings);
  const sourcePath = path.relative(repoRoot, config.input);
  const html = renderPage({
    title: config.title,
    description: config.description,
    tocHtml,
    bodyHtml,
    sourcePath,
  });
  await writeFile(config.output, html, "utf8");
}

async function main() {
  const markedModulePath = await resolveMarkedModule();
  const { marked } = await import(pathToFileURL(markedModulePath).href);
  for (const doc of DOCS) {
    await renderDoc(marked, doc);
    console.log(`Rendered ${path.relative(repoRoot, doc.output)}`);
  }
}

await main();
