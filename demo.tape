# Commit-Reveal Protocol Demo
# Run: vhs demo.tape

Output demo.gif
Set FontSize 14
Set Width 1000
Set Height 700
Set Theme "Catppuccin Mocha"
Set Padding 16
Set TypingSpeed 35ms
Set Shell zsh

# ── Hidden setup: alias + generate test data ──
Hide
Type "export PS1='$ '"
Enter
Sleep 200ms
Type `alias pb='node packages/pb-js/src/cli.js'`
Enter
Type "rm -rf /tmp/pb-demo && mkdir -p /tmp/pb-demo/benchmark"
Enter
Type `echo "{\"task\":\"reasoning\",\"n\":$RANDOM}" > /tmp/pb-demo/benchmark/reasoning.json`
Enter
Type `echo "{\"task\":\"coding\",\"n\":$RANDOM}" > /tmp/pb-demo/benchmark/coding.json`
Enter
Type `echo "{\"task\":\"math\",\"n\":$RANDOM}" > /tmp/pb-demo/benchmark/math.json`
Enter
Type `echo "{\"task\":\"analysis\",\"n\":$RANDOM}" > /tmp/pb-demo/benchmark/analysis.json`
Enter
Sleep 500ms
Type "clear"
Enter
Sleep 300ms
Show

# ── Launch the wizard ──
Type "pb go /tmp/pb-demo/benchmark -p 0.25"
Enter
Sleep 2s

# ── Step 1: Hash ──
Enter
Sleep 2s

# ── Step 2: Commit ──
Enter
Sleep 1.5s

# ── Step 3: Submit (wait for beacon) ──
Enter
Sleep 12s

# ── Step 4: Publish ──
Enter
Sleep 10s

# ── Step 5: Reveal ──
Enter
Sleep 5s

# ── Pause so the user can read the output before it loops ──
Sleep 15s
