# Commit-Reveal Use Cases

**Why commit-reveal?** These use cases share three properties: (1) the full dataset must stay private for legitimate reasons — revealing it would destroy the system's value or enable harm, (2) the data holder has adversarial incentive to cherry-pick what reviewers see, and (3) the data is digital and modifiable, so a cryptographic commitment is needed to prevent post-selection substitution.

Simple randomness (e.g., drand alone) is sufficient when the revealed data is self-authenticating — a blood sample from athlete #47 is obviously from athlete #47. Commit-reveal is needed when the holder could swap, modify, or fabricate digital artifacts after seeing which items were selected.

---

## 1. AI Benchmark Integrity

**Why the data stays private:** If all test cases are public, model developers train on them — intentionally or through data contamination. The benchmark becomes a memorization test. Researchers have shown performance drops of 47+ percentage points when moving from public to private test sets, and demonstrated that a 13B model can match GPT-4-level scores by training on paraphrased benchmark data. The benchmark's value is its secrecy.

**The cherry-picking problem:** The model developer runs the benchmark, sees all results, and chooses which to publish. The benchmark maintainer could selectively reveal easy questions to favor a model. After the fact, nobody can distinguish genuine capability from gaming.

**How commit-reveal fixes it:** Commit all test case hashes before evaluation, beacon selects which cases and outputs are published. The developer can't cherry-pick results. The benchmark maintainer can't curate difficulty. Contamination becomes a moving target because the revealed subset changes every round.

---

## 2. Standardized Test Question Fairness Review

**Why the data stays private:** The SAT, GRE, USMLE, bar exam, and civil service exams maintain pools of tens of thousands of questions. If the pool is public, the test measures memorization, not aptitude. Question secrecy is the product.

**The cherry-picking problem:** Fairness review boards need to verify that questions aren't biased by race, gender, culture, or socioeconomic status. Currently, the test maker chooses which questions the reviewers see. A test maker facing a discrimination lawsuit has incentive to show their most carefully vetted questions, not the ones with problematic wording or cultural assumptions.

**How commit-reveal fixes it:** The test maker commits all item hashes, beacon selects which questions the review panel inspects. ETS maintains roughly 20,000 active SAT items — a 5% reveal is 1,000 questions per review cycle, enough for statistical analysis of bias, small enough to preserve pool integrity. If a selected question "can't be produced," that's a visible gap.

---

## 3. Bug Bounty and Vulnerability Disclosure Accountability

**Why the data stays private:** Platforms like HackerOne and Bugcrowd, along with internal security teams, accumulate thousands of vulnerability reports. The full database can't be published — it contains unpatched vulnerabilities, working exploit details, and affected customer information. Releasing it would directly enable attacks.

**The cherry-picking problem:** Companies claim they patch everything responsibly and don't suppress critical findings. Researchers allege companies sit on vulnerabilities, downgrade severity to avoid payouts, or quietly close reports without fixing them.

**How commit-reveal fixes it:** The company commits hashes of all incoming vulnerability reports. Beacon selects which reports an independent auditor reviews. A company claiming "median time-to-patch: 48 hours" can't curate which reports the auditor sees. If selected reports reveal buried critical vulnerabilities or dishonest severity ratings, that's on the record.

---

## 4. Compliance Audit Sampling (SOC 2, ISO 27001)

**Why the data stays private:** Security compliance audits require reviewing evidence that controls are followed — code reviews happened, access was logged, incidents were handled. The full evidence corpus is proprietary source code, internal communications, and infrastructure details that can't be handed to an external auditor wholesale.

**The cherry-picking problem:** The company being audited selects which evidence to present, naturally choosing the clean pull requests with proper approvals, not the ones that were rubber-stamped or force-merged at 2am during an outage.

**How commit-reveal fixes it:** The company commits hashes of all merge events, access logs, and incident records. Beacon selects which items the auditor reviews in detail — the full diff, review comments, approval chain, and timeline. The company can't steer auditors toward their most diligent examples. This turns compliance audits from theater into statistical sampling with teeth.

---

## 5. LLM Training Data Provenance

**Why the data stays private:** Model developers claim "we don't train on copyrighted books" or "we only use licensed data." The full training dataset can't be released — it represents the developer's core competitive investment and may itself contain licensed material that can't be redistributed.

**The cherry-picking problem:** Rightsholders and regulators want proof of what's in the training set. The developer has every incentive to show the cleanly-licensed portion and obscure the rest.

**How commit-reveal fixes it:** The developer commits a full training data manifest — file hashes, source URLs, license metadata for every document in the corpus. Beacon selects which entries an auditor reviews. The developer can't cherry-pick the cleanly-licensed portion. If a selected entry is "unavailable" or turns out to be a copyrighted book the developer denied using, that's on the record. Directly relevant to disputes like NYT v. OpenAI, where the core question is "what was in the training set?" and neither side can currently prove it.
