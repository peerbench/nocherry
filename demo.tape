# PeerBench Commit-Reveal Protocol Demo
# Run: vhs demo.tape

Output demo.gif
Set FontSize 14
Set Width 1000
Set Height 620
Set Theme "Catppuccin Mocha"
Set Padding 16
Set TypingSpeed 35ms
Set Shell zsh

# ── Hidden setup ──
Hide
Type "export PS1='$ ' && mkdir -p /tmp/pb-demo"
Enter
Sleep 500ms
Type `printf '{"model":"gpt-4","score":0.847,"task":"mmlu"}\n' > /tmp/pb-demo/result-01.json`
Enter
Type `printf '{"model":"gpt-4","score":0.912,"task":"hellaswag"}\n' > /tmp/pb-demo/result-02.json`
Enter
Type `printf '{"model":"gpt-4","score":0.763,"task":"truthfulqa"}\n' > /tmp/pb-demo/result-03.json`
Enter
Type `alias pb='node /Users/user/workspace/peerBench/commit-reveal/packages/pb-js/src/cli.js'`
Enter
Type "clear"
Enter
Sleep 300ms
Show

# ── Title ──
Type "echo '=== PeerBench Commit-Reveal Protocol ==='"
Enter
Sleep 1s

# ── Step 1: Generate Ed25519 keypair ──
Sleep 300ms
Type "echo '--- Step 1: Generate Ed25519 signing key ---'"
Enter
Sleep 300ms
Type "pb key generate"
Enter
Sleep 1.5s

# ── Step 2: Hash benchmark data ──
Type "echo '--- Step 2: Hash benchmark result files ---'"
Enter
Sleep 300ms
Type "ls /tmp/pb-demo/*.json"
Enter
Sleep 800ms
Type "pb hash file /tmp/pb-demo/result-01.json"
Enter
Sleep 1s
Type "pb hash dir /tmp/pb-demo"
Enter
Sleep 1.5s

# ── Step 3: Create commitment ──
Type "echo '--- Step 3: Create signed commitment (50% reveal) ---'"
Enter
Sleep 300ms
Type "pb commit /tmp/pb-demo -p 0.50 | tee /tmp/pb-demo/commitment.json"
Enter
Sleep 2.5s

# ── Step 4: Verify locally ──
Type "echo '--- Step 4: Verify commitment signature offline ---'"
Enter
Sleep 300ms
Type "pb verify /tmp/pb-demo/commitment.json"
Enter
Sleep 2s

# ── Step 5: Server registry ──
Type "echo '--- Step 5: Known commit-reveal servers ---'"
Enter
Sleep 300ms
Type "pb servers"
Enter
Sleep 1.5s

# ── Step 6: Submit to server ──
Type "echo '--- Step 6: Submit to server (waits for drand beacon) ---'"
Enter
Sleep 300ms
Type "pb submit /tmp/pb-demo/commitment.json"
Enter
Sleep 8s

# ── Step 7: Publish data & register mirrors ──
Type "echo '--- Step 7: Publish data & register mirrors ---'"
Enter
Sleep 300ms
Type "pb publish github /tmp/pb-demo --repo peerbench-reveals"
Enter
Sleep 5s

# ── Wrap up ──
Type "echo 'Receipt is self-contained. Anyone can verify offline.'"
Enter
Sleep 3s
