#!/usr/bin/env node
/**
 * Build script: converts docs/*.md and root *.md into a static site under dist/.
 * Each markdown file gets:
 *   /slug.html  — rendered HTML with clickable links
 *   /slug.md    — raw markdown source
 * Uses marked for Markdown→HTML. Run: node build.js
 */
import { readdir, readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { marked } from 'marked';

const ROOT_DIR = join(import.meta.dirname, '..', '..');
const DOCS_DIR = join(ROOT_DIR, 'docs');
const OUT_DIR = join(import.meta.dirname, 'dist');
const RAW_DIR = join(OUT_DIR, 'raw');

const SKIP = [
  'branding-marketing-discussion-section-ideas-scratch.md',
  'scratch_writing.md',
  'AgentsMemory.md',
  'TODO.md',
  'TODO-selection-mode.md',
  'TODO-server-hardening.md',
  'CLAUDE.md',
];

const STYLE = `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         max-width: 860px; margin: 0 auto; padding: 32px 20px; color: #1a1a2e; background: #fafafa; line-height: 1.7; }
  h1 { font-size: 1.8rem; margin: 24px 0 12px; border-bottom: 2px solid #e0e0e0; padding-bottom: 8px; }
  h2 { font-size: 1.4rem; margin: 20px 0 8px; }
  h3 { font-size: 1.15rem; margin: 16px 0 6px; }
  p { margin: 8px 0; }
  code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  pre { background: #1a1a2e; color: #e0e0e0; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 12px 0; }
  pre code { background: none; padding: 0; color: inherit; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f0f0f0; }
  blockquote { border-left: 4px solid #2563eb; padding: 8px 16px; margin: 12px 0; background: #f0f8ff; }
  ul, ol { margin: 8px 0 8px 24px; }
  img { max-width: 100%; }
  .back { font-size: 0.9rem; margin-bottom: 16px; }
  .view-toggle { font-size: 0.85rem; float: right; padding: 4px 12px; background: #fff; border: 1px solid #ddd; border-radius: 4px; }
  .section-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-top: 24px; margin-bottom: 4px; }
</style>
`;

function htmlPage(title, body, slug, showBack = false) {
  const back = showBack ? '<div class="back"><a href="/">&larr; Back to index</a></div>' : '';
  const rawLink = slug ? `<a class="view-toggle" href="/raw/${slug}.md">View raw markdown</a>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - NoCherry Docs</title>${STYLE}</head>
<body>${back}${rawLink}${body}</body>
</html>`;
}

function slugify(filename) {
  return basename(filename, extname(filename));
}

function prettyName(filename) {
  return basename(filename, extname(filename))
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/V0\.4/i, 'v0.4');
}

async function collectFiles(dir, section) {
  const files = (await readdir(dir))
    .filter(f => f.endsWith('.md') && !SKIP.includes(f))
    .sort();
  return files.map(f => ({ file: f, dir, section }));
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(RAW_DIR, { recursive: true });

  // Collect markdown files from docs/ and root
  const docsFiles = await collectFiles(DOCS_DIR, 'Specifications');
  const rootFiles = await collectFiles(ROOT_DIR, 'Project');

  const allFiles = [...rootFiles, ...docsFiles];

  // Build individual pages (rendered HTML + raw markdown)
  const entries = [];
  for (const { file, dir, section } of allFiles) {
    const md = await readFile(join(dir, file), 'utf-8');
    const html = await marked(md);
    const slug = slugify(file);
    const title = prettyName(file);
    entries.push({ slug, title, file, section });

    // Rendered HTML page
    await writeFile(join(OUT_DIR, `${slug}.html`), htmlPage(title, html, slug, true));

    // Raw markdown
    await writeFile(join(RAW_DIR, `${slug}.md`), md);
  }

  // Copy images from root, docs/, and assets/
  // Root-level images (demo.gif etc.)
  const rootAll = await readdir(ROOT_DIR);
  for (const f of rootAll) {
    if (/\.(png|jpg|jpeg|gif|svg)$/i.test(f)) {
      await copyFile(join(ROOT_DIR, f), join(OUT_DIR, f));
    }
  }

  // assets/ subfolder — preserve path so assets/nocherry_mascot1.png works
  const assetsOut = join(OUT_DIR, 'assets');
  await mkdir(assetsOut, { recursive: true });
  for (const dir of [DOCS_DIR, join(ROOT_DIR, 'assets')]) {
    try {
      const files = await readdir(dir);
      for (const f of files) {
        if (/\.(png|jpg|jpeg|gif|svg)$/i.test(f)) {
          await copyFile(join(dir, f), join(OUT_DIR, f));
          if (dir.endsWith('assets')) {
            await copyFile(join(dir, f), join(assetsOut, f));
          }
        }
      }
    } catch {}
  }

  // Build index grouped by section
  const sections = {};
  for (const e of entries) {
    (sections[e.section] ??= []).push(e);
  }

  const sectionHtml = Object.entries(sections).map(([section, items]) => {
    const list = items.map(e =>
      `<li><a href="/${e.slug}.html">${e.title}</a> <span style="color:#888;font-size:0.85rem">· <a href="/raw/${e.slug}.md" style="color:#888">raw</a></span></li>`
    ).join('\n');
    return `<div class="section-label">${section}</div><ul style="line-height:2">${list}</ul>`;
  }).join('\n');

  const indexBody = `
    <h1>NoCherry Documentation</h1>
    <p>Commit-reveal protocol specifications and reference documentation.</p>
    ${sectionHtml}
    <p style="margin-top:24px;font-size:0.85rem;color:#888">
      <a href="https://github.com/reisepass/nocherry">GitHub</a> &middot;
      <a href="https://demo.nocherry.net">Interactive Demo</a> &middot;
      <a href="https://nocherry.net">nocherry.net</a>
    </p>
  `;
  await writeFile(join(OUT_DIR, 'index.html'), htmlPage('Index', indexBody, null));

  console.log(`Built ${entries.length} pages (rendered + raw) + index → ${OUT_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
