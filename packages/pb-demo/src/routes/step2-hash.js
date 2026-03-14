import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import * as wasm from 'pb-wasm';
import { page, field, button, nextButton, note } from '../template.js';
import { codeRef } from '../code-refs.js';

const route = new Hono();

const refs = [
  codeRef('crates/pb-core/src/hash.rs', 1, 25, 'Rust: SHA-256 hash_bytes'),
  codeRef('packages/pb-wasm/src/lib.rs', 9, 12, 'WASM: hashBytes binding'),
];

function generateRandomItems(count) {
  const labels = [
    'Benchmark result: GPT-4o on MMLU subset',
    'Benchmark result: Claude on HumanEval',
    'Benchmark result: Gemini on GSM8K',
    'Benchmark result: Llama on TruthfulQA',
    'Benchmark result: Mistral on ARC-Challenge',
    'Evaluation: latency p99 = 1247ms',
    'Evaluation: throughput 342 tokens/s',
    'Evaluation: accuracy 0.873 on held-out set',
  ];
  const items = [];
  for (let i = 0; i < count; i++) {
    const label = labels[i % labels.length];
    const noise = randomBytes(8).toString('hex');
    items.push(`${label} [run=${noise}]`);
  }
  return items;
}

route.get('/', (c) => {
  const session = c.get('session');
  if (!session.keypair) return c.redirect('/steps/1');

  const hashes = session.itemHashes;

  let content;
  if (!hashes) {
    content = `
      <p>The commit-reveal protocol deals in <strong>SHA-256 hashes</strong>. Your actual data stays
      private — only the hashes go into the commitment. Later, when items are selected for reveal,
      you publish the data and anyone can verify <code>SHA-256(data) == committed_hash</code>.</p>

      <h2>Option A: Generate Random Data</h2>
      <p>Create random benchmark-style data items to commit.</p>
      <form method="POST" style="display:flex;align-items:center;gap:12px;margin:8px 0">
        <input type="hidden" name="mode" value="random">
        <label style="font-size:0.9rem;color:#444">Number of items:</label>
        <select name="count" style="padding:6px 12px;border-radius:4px;border:1px solid #ccc;font-size:0.9rem">
          <option value="3">3</option>
          <option value="5" selected>5</option>
          <option value="10">10</option>
          <option value="25">25</option>
          <option value="50">50</option>
        </select>
        <button type="submit" class="btn" style="margin-top:0">Generate &amp; Hash</button>
      </form>

      <h2 style="margin-top:24px">Option B: Enter Your Own Data</h2>
      <p>Type or paste data items, one per line. Each line becomes a separate item that gets hashed.</p>
      <form method="POST">
        <input type="hidden" name="mode" value="custom">
        <textarea name="data" rows="8"
          style="width:100%;padding:12px;font-family:'SF Mono','Fira Code','Consolas',monospace;font-size:0.85rem;border:1px solid #ccc;border-radius:6px;resize:vertical;background:#f8f9fa"></textarea>
        <button type="submit" class="btn">Hash Custom Data</button>
      </form>

      ${note('In a real scenario, these could be benchmark test cases, model evaluation results, research data files — any content you want to commit to.')}
    `;
  } else {
    content = `
      <p>Each item has been hashed with SHA-256:</p>
      ${hashes.map((h, i) => {
        const label = session.sampleData[i];
        const short = label.length > 60 ? label.substring(0, 60) + '...' : label;
        return `
          <div style="margin:12px 0">
            <div style="font-size:0.85rem;color:#666">Item ${i + 1}: <code>${short}</code></div>
            ${field('SHA-256', h)}
          </div>`;
      }).join('')}
      ${hashes.length > 10 ? `<p style="color:var(--muted);font-size:0.85rem">Showing all ${hashes.length} items.</p>` : ''}
      ${note('These 64-character hex strings are the only thing the server sees. The actual data remains with you until reveal.')}
      <div style="display:flex;gap:12px;align-items:center;margin-top:16px">
        ${nextButton(3)}
        <form method="POST" action="/steps/2/reset" style="margin:0">
          <button type="submit" class="btn" style="background:var(--muted);margin-top:16px">Start Over</button>
        </form>
      </div>
    `;
  }

  return c.html(page({ title: 'Step 2: Hash Data', stepNumber: 2, content, codeRefs: refs, session }));
});

route.post('/', async (c) => {
  const session = c.get('session');
  const body = await c.req.parseBody();
  const mode = body.mode;

  let dataItems;
  if (mode === 'custom') {
    const raw = (body.data || '').trim();
    if (!raw) return c.redirect('/steps/2');
    dataItems = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (dataItems.length === 0) return c.redirect('/steps/2');
  } else {
    const count = Math.min(Math.max(parseInt(body.count) || 5, 1), 100);
    dataItems = generateRandomItems(count);
  }

  session.sampleData = dataItems;
  session.itemHashes = dataItems.map(d =>
    wasm.hashBytes(new TextEncoder().encode(d))
  );
  session._completedStep = Math.max(session._completedStep || 0, 2);
  return c.redirect('/steps/2');
});

route.post('/reset', (c) => {
  const session = c.get('session');
  delete session.sampleData;
  delete session.itemHashes;
  delete session.commitment;
  delete session.receipt;
  delete session.reveal;
  session._completedStep = Math.min(session._completedStep || 0, 1);
  return c.redirect('/steps/2');
});

export default route;
