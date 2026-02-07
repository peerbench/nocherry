# PeerBench Commit-Reveal Protocol Demo
# Run: vhs demo.tape

Output demo.gif
Set FontSize 14
Set Width 1000
Set Height 700
Set Theme "Catppuccin Mocha"
Set Padding 16
Set TypingSpeed 35ms
Set Shell zsh

# ── Hidden setup: alias + clean slate ──
Hide
Type "export PS1='$ '"
Enter
Sleep 200ms
Type `alias pb='node /Users/user/workspace/peerBench/commit-reveal/packages/pb-js/src/cli.js'`
Enter
Type "rm -rf /tmp/pb-demo"
Enter
Type "clear"
Enter
Sleep 300ms
Show

# ── Generate random test data ──
Type "pb generate-random-data /tmp/pb-demo"
Enter
Sleep 1.5s

# ── Show what was generated ──
Type "ls /tmp/pb-demo/random_data_0/"
Enter
Sleep 1.5s

# ── Launch the wizard ──
Type "pb go /tmp/pb-demo/random_data_0"
Enter
Sleep 2s

# ── Step 1: Hash — press Enter ──
Enter
Sleep 1.5s

# ── Step 2: Commit — press Enter ──
Enter
Sleep 1.5s

# ── Step 3: Submit — press Enter, wait for beacon ──
Enter
Sleep 10s

# ── Step 4: Reveal — press Enter ──
Enter
Sleep 8s

# ── Step 5: Publish — skip with Enter (default N) ──
Enter
Sleep 2s
