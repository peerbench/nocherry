# Branding & Marketing Ideas — Scratch Notes

Working document. Not final. Just ideas to discuss.

---

## What Cloudflare Did (and why it worked)

Cloudflare's League of Entropy blog post is a masterclass in positioning infrastructure as public good. Key moves:

1. **Led with crime stories.** Pennsylvania lottery fraud (weighted balls), Iowa lottery insider (rigged the RNG, won 6 times over a decade). These aren't hypotheticals — they're convictions. The reader immediately understands: single points of control get exploited.

2. **Named the structural problem.** "Single-source randomness has been exploited to generate biased results." One sentence. The problem isn't bad actors — it's bad architecture.

3. **Positioned themselves as contributors, not vendors.** Cloudflare didn't sell drand. They contributed LavaRand to a consortium. The framing was civic: "we joined" not "we built."

4. **Made it superhero-fun.** "THE LEAGUE....OF....ENTROPY!!!!!!" with "Not All Heroes Wear Capes." This made cryptographic infrastructure feel like a team-up movie, not a whitepaper.

5. **Showed institutional diversity.** Five founding members with different entropy sources (lava lamps, seismic sensors, blockchain, CPU randomness). Diversity of source = diversity of trust.

6. **Quoted credible outsiders.** Iowa State Auditor, Ethereum Foundation researcher, election officials. Third-party validation, not self-promotion.

---

## The Parallel: What nocherry solves

Cloudflare's argument: "You can't trust a single source of randomness."

Our argument: **"You can't trust the person choosing what to show you."**

The structural problem is the same shape:

| League of Entropy | nocherry commit-reveal |
|---|---|
| Single RNG operator can rig outcomes | Single benchmark publisher can cherry-pick results |
| Solution: distributed, verifiable randomness | Solution: commit-then-reveal with externally-selected audit |
| Prove the lottery wasn't rigged | Prove the benchmark wasn't cherry-picked |
| Uses drand beacon | Also uses drand beacon |
| Anyone can verify beacon output | Anyone can verify the entire chain offline |

We literally use their infrastructure. We're a downstream consumer of the exact trust property they built.

---

## Narrative Angles

### Angle 1: "The anti-cherry-picking protocol"

Lead with the problem everyone already suspects: benchmark results are cherry-picked. Nobody says it out loud because there's no mechanism to prove it either way. nocherry creates that mechanism.

**Tagline candidates:**
- "You can't cherry-pick what gets audited."
- "Commit first. The beacon picks what you show."
- "Prove you didn't choose your best results."

**Opening hook (blog post / landing page):**
> When a company publishes benchmark results, they choose which results to show you. They ran the test 50 times and picked the best run. They tested on 500 cases and published the 200 that looked good. You'd never know. There's no audit trail for what was left out. nocherry changes that.

### Angle 2: "We stand on the shoulders of the League of Entropy"

Position nocherry as the natural next layer on top of drand. The League of Entropy solved verifiable randomness. We use that randomness to solve verifiable selection. This is composable infrastructure doing what composable infrastructure should do.

**Why this works:** It borrows credibility. Cloudflare, EPFL, Protocol Labs, the Ethereum Foundation — they built the randomness layer. We built a protocol on top of it. Citing them is not name-dropping; it's describing our dependency chain.

**Blog post idea:** "From verifiable randomness to verifiable audits: how drand enables anti-cherry-picking" — could be pitched to drand's own blog or newsletter. They love showcasing downstream use cases.

### Angle 3: "The receipt printer" — infrastructure framing

Cloudflare positioned themselves as infrastructure contributors, not product builders. We can do the same. A commit-reveal server is a "timestamped receipt printer" (the spec's own words). It's boring infrastructure that makes trust possible.

**Framing:**
> A commit-reveal server does three things: records when you committed, waits for a beacon round you couldn't have predicted, and tells you what to reveal. That's it. It's a receipt printer. But those receipts are self-contained cryptographic proofs that work forever, even if the server goes offline.

**Why this works:** Infrastructure framing attracts operators. "Run a nocherry server" is the equivalent of "join the League of Entropy." It's a civic contribution to an ecosystem of trust.

### Angle 4: Crime/scandal stories (Cloudflare's playbook)

Cloudflare opened with lottery fraud. We need our equivalent: benchmark fraud, data cherry-picking, publication bias. These exist but are less dramatic than lottery convictions.

**Possible examples to research:**
- LLM benchmark contamination scandals (models trained on test data)
- Retracted papers due to selective data reporting
- Benchmark results that couldn't be reproduced by third parties
- Companies claiming SOTA on benchmarks and then quietly not releasing the test conditions
- Medical/pharma trial result cherry-picking (publication bias is well-documented)
- Any instance where "we ran it N times and showed you the best one" was proven

**The Iowa Lottery parallel:**
> Eddie Tipton was the security director of the Iowa Lottery. He rigged the random number generator. He won six times. It took a decade to catch him.
>
> In AI benchmarking, there's no Eddie Tipton. There doesn't need to be. The system itself is the vulnerability: the person running the benchmark is the person choosing which results to publish. No conspiracy required — just human nature and no audit trail.

### Angle 5: "Voluntary transparency with teeth"

Most transparency initiatives are toothless: you publish what you choose to publish. nocherry adds a mechanism where transparency has cryptographic enforcement on the selection step.

**Key distinction:** nocherry doesn't force anyone to reveal anything. It makes non-compliance visible. If the beacon says "reveal items 3, 7, and 12" and you only reveal 3 and 7, everyone can see that 12 is missing. Social accountability backed by math.

---

## Audience-Specific Messaging

### For AI/ML researchers and benchmark maintainers

**Problem they feel:** "Everyone games benchmarks. We know it. We can't prove it."

**Message:** "Commit your test cases before running the model. The beacon picks which results you publish. If you skip one, everyone sees the gap."

**Channel:** Academic conferences, ML Twitter/X, Arxiv companion posts, HELM/lm-eval-harness integrations.

### For open-source infrastructure operators

**Problem they feel:** "I want to contribute to trust infrastructure but blockchain is too heavy."

**Message:** "Run a commit-reveal server. It's a single Node.js process with SQLite. Free-tier Cloudflare Workers deployment included. You become part of a network of timestamped receipt printers."

**Channel:** Hacker News, dev blogs, Cloudflare Workers showcase, self-hosting communities.

### For institutions (universities, standards bodies, regulators)

**Problem they feel:** "We need reproducibility and auditability mechanisms that don't require trusting the reporter."

**Message:** "The commit-reveal protocol provides cryptographic proof of temporal ordering, data integrity, and unbiased selection. All verification runs offline. No vendor lock-in. The spec is 15 pages."

**Channel:** Standards body workshops, reproducibility initiatives, institutional partnerships.

### For drand / League of Entropy community

**Problem they feel:** "We built this amazing randomness infrastructure. Where are the applications?"

**Message:** "nocherry is a complete application built on drand quicknet. Every commit-reveal cycle consumes a beacon round. We're a real downstream user, not a demo."

**Channel:** drand blog, League of Entropy Slack/Discord, conference talks where drand members present.

---

## Concrete Outreach Ideas

### 1. Guest post on drand blog

**Pitch:** "We built an anti-cherry-picking protocol on top of drand. Here's how it works and why drand's properties matter for it."

They actively seek ecosystem stories. This is easy to pitch because it validates their infrastructure.

### 2. Hacker News launch post

**Title options:**
- "Show HN: Commit-reveal protocol using drand — you can't cherry-pick what gets audited"
- "Show HN: Anti-cherry-picking for benchmarks, built on the League of Entropy"

**What HN cares about:** Open source, clever crypto, no blockchain hype, practical infrastructure. The "receipt printer" framing plays well here. The drand connection is interesting trivia. The spec being 15 pages (not 150) signals seriousness.

### 3. Conference lightning talk

**Title:** "Three seconds to fairness: using drand beacons for verifiable audit selection"

**Venue options:** Real World Crypto, CCC, FOSDEM, NeurIPS (reproducibility track), any ML conference with a benchmarking workshop.

### 4. Integration with existing benchmark frameworks

If nocherry plugs into lm-eval-harness, HELM, or similar — that's the killer demo. Not "here's our protocol" but "here's your existing workflow, now with cryptographic audit trails."

### 5. "Run a server" call to action

Mirror Cloudflare's "join the League" framing. Maintain a public server list. Make it easy to deploy (it already is — Cloudflare Workers free tier). Track "receipts issued" as a community metric.

---

## Name / Brand Notes

"nocherry" is good because:
- Instantly communicates the value prop (no cherry-picking)
- Memorable, slightly playful (like "League of Entropy")
- Works as both a noun ("use nocherry") and an adjective ("nocherry-verified")
- Short, no ambiguity in spelling

Possible sub-brands:
- **nocherry server** — the receipt printer
- **nocherry verify** — the CLI verification tool
- **nocherry-verified** — a badge/label for benchmark results that went through the protocol

---

## Things to Avoid

1. **Don't position as blockchain.** We use drand but we're not a blockchain project. No tokens, no consensus, no gas fees. Just hashes and signatures.

2. **Don't oversell.** The spec's "What This Does NOT Prove" section (14.2) is honest about limits. Marketing should be too. We don't prove data quality. We don't prove completeness of the dataset. We prove integrity and unbiased selection of what was committed.

3. **Don't make it about AI only.** The protocol is domain-agnostic. AI benchmarks are the first use case, but clinical trials, election audits, academic reproducibility, supply chain attestation — all valid. Keep the door open.

4. **Don't require trust in us.** The whole point is that verification is offline and self-contained. If we ever say "trust our server," we've lost the plot. Servers are receipt printers. Proofs are self-contained. Anyone can run a server.

