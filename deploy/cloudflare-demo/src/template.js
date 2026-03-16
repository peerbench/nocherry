/**
 * HTML template with embedded CSS — server-side rendered, zero build step.
 */

const STEPS = [
  { num: 1, name: 'Generate Key', path: '/steps/1' },
  { num: 2, name: 'Hash Data', path: '/steps/2' },
  { num: 3, name: 'Create Commitment', path: '/steps/3' },
  { num: 4, name: 'Submit', path: '/steps/4' },
  { num: 5, name: 'Selection', path: '/steps/5' },
  { num: 6, name: 'Publish', path: '/steps/6' },
  { num: 7, name: 'Reveal', path: '/steps/7' },
  { num: 8, name: 'Verify', path: '/steps/8' },
];

export function page({ title, stepNumber, content, codeRefs = [], rightPanel, session = {} }) {
  const completedStep = session._completedStep || 0;
  const demoMode = session._demoMode;
  const badgeText = demoMode === 'local' ? 'Local Demo' : demoMode === 'live' ? 'Live Demo' : 'Interactive Demo';
  const hasRightPanel = rightPanel || false; // codeRefs disabled for now
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
    <a href="/" class="logo">NOCHERRY</a>
    <span class="badge">${esc(badgeText)}</span>
    <a href="https://docs.nocherry.net/README.html" class="header-link">Introduction</a>
    <a href="https://docs.nocherry.net/nocherry-commit-reveal-spec-v0.4.html" class="header-link">Spec</a>
  </header>

  ${stepNumber ? renderNav(stepNumber, completedStep) : ''}

  <main class="${stepNumber && hasRightPanel ? 'two-panel' : ''}">
    <div class="content-panel">
      <h1>${esc(title)}</h1>
      ${content}
    </div>
    ${hasRightPanel ? rightPanel : ''}
  </main>

  <footer>
    <p>Commit-Reveal Protocol v0.2.0</p>
  </footer>
  ${stepNumber ? FAB_SCRIPT : ''}
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
header .header-link {
  margin-left: auto;
  color: #ccc;
  text-decoration: none;
  font-size: 0.9rem;
}
header .header-link:hover { color: #fff; }

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

/* Beacon ticker */
.beacon-ticker {
  margin-top: 20px;
  background: var(--code-bg);
  border-radius: 8px;
  padding: 16px;
  color: var(--code-fg);
}
.beacon-ticker h2 {
  font-size: 0.9rem;
  color: #89b4fa;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 12px;
}
.beacon-status {
  font-size: 0.85rem;
  color: #a6adc8;
  margin-bottom: 10px;
  min-height: 1.4em;
}
.beacon-list {
  max-height: 340px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.beacon-round {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  border-radius: 4px;
  background: #181825;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 0.8rem;
  transition: background 0.3s, box-shadow 0.3s;
}
.beacon-round .round-num {
  color: #89b4fa;
  min-width: 72px;
  font-weight: 600;
}
.beacon-round .round-rand {
  color: #a6e3a1;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.beacon-round .round-time {
  color: #585b70;
  font-size: 0.75rem;
  min-width: 48px;
  text-align: right;
}
.beacon-round.latest {
  animation: beacon-pulse 1s ease-out;
}
.beacon-round.highlighted {
  background: #1e3a2f;
  box-shadow: 0 0 8px rgba(46, 196, 182, 0.4), inset 0 0 0 1px var(--success);
}
.beacon-round.highlighted .round-num {
  color: var(--success);
}
@keyframes beacon-pulse {
  0% { background: #2a2a4a; }
  100% { background: #181825; }
}

/* Spinner */
.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid #fff;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  vertical-align: middle;
  margin-right: 6px;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

/* Receipt result (JS-rendered) */
#receipt-result {
  margin-top: 20px;
}

/* Multi-server result blocks */
.server-result {
  margin: 16px 0;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg);
}
.server-result h2, .server-result h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.server-result hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 16px 0;
}
.server-result.fade-in {
  animation: fadeIn 0.4s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Floating action button */
#fab {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 1000;
  padding: 12px 24px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 28px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  transition: background 0.15s, transform 0.1s, opacity 0.2s;
  text-decoration: none;
  display: none;
  max-width: 280px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#fab:hover { background: var(--accent2); transform: translateY(-1px); }
#fab:active { transform: translateY(0); }
`;

const FAB_SCRIPT = [
  '<div id="fab" role="presentation"></div>',
  '<script>',
  '(function() {',
  '  var fab = document.getElementById("fab");',
  '  var currentTarget = null;',
  '  var debounceTimer = null;',
  '  function isVisible(el) {',
  '    if (el.closest("noscript") || el.closest("details:not([open])")) return false;',
  '    var rect = el.getBoundingClientRect();',
  '    if (rect.width === 0 && rect.height === 0) return false;',
  '    if (el.style.display === "none") return false;',
  '    if (el.disabled) return false;',
  '    return true;',
  '  }',
  '  function findPrimaryAction() {',
  '    var cont = document.querySelectorAll(".content-panel .btn-next");',
  '    for (var i = 0; i < cont.length; i++) { if (isVisible(cont[i])) return cont[i]; }',
  '    var btns = document.querySelectorAll(".content-panel button.btn, .content-panel a.btn, #submit-btn");',
  '    for (var i = 0; i < btns.length; i++) { if (isVisible(btns[i])) return btns[i]; }',
  '    return null;',
  '  }',
  '  function updateFab() {',
  '    var target = findPrimaryAction();',
  '    if (target) {',
  '      currentTarget = target;',
  '      var text = target.textContent.trim().replace(/\\s+/g, " ");',
  '      if (text.length > 30) text = text.substring(0, 28) + "...";',
  '      fab.textContent = text;',
  '      fab.style.display = "block";',
  '    } else {',
  '      fab.style.display = "none";',
  '      currentTarget = null;',
  '    }',
  '  }',
  '  function debouncedUpdate() {',
  '    clearTimeout(debounceTimer);',
  '    debounceTimer = setTimeout(updateFab, 100);',
  '  }',
  '  fab.addEventListener("click", function(e) {',
  '    e.preventDefault();',
  '    e.stopPropagation();',
  '    if (currentTarget) {',
  '      currentTarget.click();',
  '      setTimeout(updateFab, 300);',
  '    }',
  '  });',
  '  updateFab();',
  '  setInterval(updateFab, 1000);',
  '  if (typeof MutationObserver !== "undefined") {',
  '    new MutationObserver(debouncedUpdate).observe(document.body, { childList: true, subtree: true });',
  '  }',
  '})();',
  '</' + 'script>',
].join('\n');
