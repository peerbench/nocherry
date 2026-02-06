/**
 * HTML template with embedded CSS — server-side rendered, zero build step.
 */

const STEPS = [
  { num: 1, name: 'Generate Key', path: '/steps/1' },
  { num: 2, name: 'Hash Data', path: '/steps/2' },
  { num: 3, name: 'Create Commitment', path: '/steps/3' },
  { num: 4, name: 'Submit', path: '/steps/4' },
  { num: 5, name: 'Selection', path: '/steps/5' },
  { num: 6, name: 'Reveal', path: '/steps/6' },
  { num: 7, name: 'Verify', path: '/steps/7' },
];

export function page({ title, stepNumber, content, codeRefs = [], session = {} }) {
  const completedStep = session._completedStep || 0;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} - Commit-Reveal Demo</title>
  <style>${CSS}</style>
</head>
<body>
  <header>
    <a href="/" class="logo">PeerBench Commit-Reveal</a>
    <span class="badge">Interactive Demo</span>
  </header>

  ${stepNumber ? renderNav(stepNumber, completedStep) : ''}

  <main class="${stepNumber ? 'two-panel' : ''}">
    <div class="content-panel">
      <h1>${esc(title)}</h1>
      ${content}
    </div>
    ${codeRefs.length > 0 ? `
    <div class="code-panel">
      <h3>Source Code</h3>
      ${codeRefs.map(renderCodeRef).join('\n')}
    </div>` : ''}
  </main>

  <footer>
    <p>PeerBench Commit-Reveal Protocol v0.2.0</p>
  </footer>
</body>
</html>`;
}

function renderNav(current, completed) {
  return `<nav class="steps-nav">${STEPS.map(s => {
    const cls = s.num === current ? 'current' :
                s.num <= completed ? 'done' : 'future';
    const link = s.num <= completed + 1 ?
      `<a href="${s.path}">${s.num}</a>` :
      `<span>${s.num}</span>`;
    return `<div class="step ${cls}">
      <div class="circle">${link}</div>
      <div class="label">${esc(s.name)}</div>
    </div>`;
  }).join('<div class="connector"></div>')}</nav>`;
}

function renderCodeRef(ref) {
  return `<details open>
    <summary><code>${esc(ref.title)}</code></summary>
    <pre class="code-block"><code>${escCode(ref.code)}</code></pre>
    <div class="file-path">${esc(ref.path)}:${ref.startLine}-${ref.endLine}</div>
  </details>`;
}

export function jsonBlock(obj) {
  return `<pre class="json-block"><code>${escCode(JSON.stringify(obj, null, 2))}</code></pre>`;
}

export function field(label, value, mono = true) {
  const cls = mono ? 'mono' : '';
  return `<div class="field"><span class="field-label">${esc(label)}</span><span class="field-value ${cls}">${esc(String(value))}</span></div>`;
}

export function button(text, action = '') {
  return `<form method="POST"${action ? ` action="${action}"` : ''}>
    <button type="submit" class="btn">${esc(text)}</button>
  </form>`;
}

export function nextButton(step) {
  return `<a href="/steps/${step}" class="btn btn-next">Continue to Step ${step} &rarr;</a>`;
}

export function note(text) {
  return `<div class="note">${text}</div>`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escCode(s) {
  return esc(s);
}

const CSS = `
:root {
  --bg: #fafafa;
  --fg: #1a1a2e;
  --accent: #4361ee;
  --accent2: #3a0ca3;
  --success: #2ec4b6;
  --muted: #6c757d;
  --border: #dee2e6;
  --code-bg: #1e1e2e;
  --code-fg: #cdd6f4;
  --panel-bg: #fff;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.6;
  min-height: 100vh;
}

header {
  display: flex; align-items: center; gap: 12px;
  padding: 16px 24px;
  background: var(--fg);
  color: #fff;
}
header .logo {
  font-weight: 700; font-size: 1.1rem;
  color: #fff; text-decoration: none;
}
header .badge {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--accent);
  color: #fff;
}

footer {
  padding: 16px 24px;
  text-align: center;
  color: var(--muted);
  font-size: 0.85rem;
  border-top: 1px solid var(--border);
  margin-top: 40px;
}

/* Steps nav */
.steps-nav {
  display: flex; align-items: center; justify-content: center;
  padding: 20px 24px;
  gap: 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.step { text-align: center; }
.step .circle {
  width: 36px; height: 36px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 0.9rem;
  margin: 0 auto 4px;
  border: 2px solid var(--border);
  color: var(--muted);
  background: var(--panel-bg);
}
.step .circle a, .step .circle span {
  color: inherit; text-decoration: none;
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%;
}
.step.done .circle { background: var(--success); border-color: var(--success); color: #fff; }
.step.current .circle { background: var(--accent); border-color: var(--accent); color: #fff; }
.step .label { font-size: 0.7rem; color: var(--muted); white-space: nowrap; }
.step.current .label { color: var(--accent); font-weight: 600; }
.connector { width: 32px; height: 2px; background: var(--border); margin-bottom: 18px; }

/* Main layout */
main { padding: 24px; max-width: 1400px; margin: 0 auto; }
main.two-panel { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
@media (max-width: 900px) {
  main.two-panel { grid-template-columns: 1fr; }
}

.content-panel {
  background: var(--panel-bg);
  border-radius: 8px;
  padding: 24px;
  border: 1px solid var(--border);
}
.content-panel h1 {
  font-size: 1.4rem;
  margin-bottom: 16px;
  color: var(--accent2);
}
.content-panel h2 {
  font-size: 1.1rem;
  margin: 20px 0 8px;
  color: var(--fg);
}
.content-panel p { margin: 8px 0; color: #444; }

.code-panel {
  background: var(--code-bg);
  border-radius: 8px;
  padding: 20px;
  color: var(--code-fg);
  overflow-x: auto;
  max-height: calc(100vh - 200px);
  overflow-y: auto;
  position: sticky;
  top: 20px;
}
.code-panel h3 {
  font-size: 0.9rem;
  margin-bottom: 12px;
  color: #89b4fa;
  text-transform: uppercase;
  letter-spacing: 1px;
}

details { margin-bottom: 12px; }
details summary {
  cursor: pointer;
  padding: 6px 0;
  color: #89b4fa;
  font-size: 0.85rem;
}
details summary:hover { color: #b4befe; }

.code-block {
  background: #181825;
  border-radius: 4px;
  padding: 12px;
  font-size: 0.8rem;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre;
  color: var(--code-fg);
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
}
.file-path {
  font-size: 0.7rem;
  color: #585b70;
  margin-top: 4px;
}

.json-block {
  background: #f1f3f5;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  font-size: 0.8rem;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  color: #333;
}

.field {
  display: flex; gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
  align-items: baseline;
}
.field-label {
  font-size: 0.8rem;
  color: var(--muted);
  min-width: 140px;
  flex-shrink: 0;
}
.field-value {
  word-break: break-all;
  font-size: 0.9rem;
}
.field-value.mono {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.8rem;
}

.btn {
  display: inline-block;
  padding: 10px 24px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  margin-top: 16px;
  transition: background 0.15s;
}
.btn:hover { background: var(--accent2); }
.btn-next { display: inline-block; }

.note {
  background: #e8f4fd;
  border-left: 3px solid var(--accent);
  padding: 12px 16px;
  border-radius: 0 6px 6px 0;
  margin: 12px 0;
  font-size: 0.9rem;
  color: #1a1a2e;
}

.check { color: var(--success); font-weight: 700; }
.cross { color: #e63946; font-weight: 700; }

.highlight {
  background: #d4edda;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.85rem;
}

.item-list { list-style: none; padding: 0; }
.item-list li {
  padding: 8px 12px;
  border-radius: 4px;
  margin: 4px 0;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.8rem;
  background: #f8f9fa;
  border: 1px solid var(--border);
}
.item-list li.selected {
  background: #d4edda;
  border-color: var(--success);
}
.item-list li.not-selected {
  background: #f8f9fa;
  opacity: 0.7;
}

.hero {
  text-align: center;
  padding: 48px 24px;
}
.hero h1 {
  font-size: 2rem;
  margin-bottom: 12px;
}
.hero p {
  font-size: 1.1rem;
  color: #555;
  max-width: 600px;
  margin: 0 auto 24px;
}
.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin: 24px 0;
}
.feature {
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
  text-align: left;
}
.feature h3 {
  font-size: 1rem;
  margin-bottom: 6px;
  color: var(--accent2);
}
.feature p { font-size: 0.85rem; color: #666; }
`;
