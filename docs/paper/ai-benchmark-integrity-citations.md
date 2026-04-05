# AI Benchmark Integrity and Data Contamination — Additional Citations

Additional references for the AI Benchmark Integrity section of the NoCherry commit-reveal protocol paper. These supplement the existing citations in `docs/publication-citations.md` (Section 4).

---

## 1. Benchmark Gaming and Leaderboard Manipulation

### Singh, Nan, Wang, D'Souza, Kapoor, Ustun, Koyejo, Deng, Longpre, Smith, Ermis, Fadaee & Hooker (2025) — The Leaderboard Illusion
- **Link:** https://arxiv.org/abs/2504.20879
- **Authors:**
  - Shivalika Singh — Cohere
  - Yiyang Nan — Cohere
  - Alex Wang — Cohere
  - Daniel D'Souza — Cohere
  - Sayash Kapoor — Princeton University
  - Ahmet Ustun — Cohere
  - Sanmi Koyejo — Stanford University
  - Yuntian Deng — Cohere
  - Shayne Longpre — MIT
  - Noah A. Smith — University of Washington; Allen Institute for AI
  - Beyza Ermis — Cohere
  - Marzieh Fadaee — Cohere
  - Sara Hooker — Cohere
- **Quote:** "Undisclosed private testing practices benefit a handful of providers who are able to test multiple variants before public release and retract scores if desired."
- **Why relevant:** Documents the most prominent real-world case of benchmark cherry-picking: Meta tested 27 private Llama-4 variants on Chatbot Arena and selectively published the best scores. This is precisely the attack vector that commit-reveal prevents — by committing all results before a random beacon selects which must be disclosed, selective retraction becomes impossible.

### Min, Pang, Du, Liu, Cheng & Lin (2025) — Improving Your Model Ranking on Chatbot Arena by Vote Rigging
- **Link:** https://arxiv.org/abs/2501.17858
- **Authors:**
  - Rui Min — Sea AI Lab (SAIL)
  - Tianyu Pang — Sea AI Lab (SAIL)
  - Chao Du — Sea AI Lab (SAIL)
  - Qian Liu — Sea AI Lab (SAIL)
  - Minhao Cheng — The Hong Kong University of Science and Technology
  - Min Lin — Sea AI Lab (SAIL)
- **Quote:** "Omnipresent rigging strategies can improve model rankings by rigging only hundreds of new votes."
- **Why relevant:** Demonstrates that crowdsourced evaluation platforms are vulnerable to vote manipulation — even without cherry-picking results, adversaries can actively rig the evaluation process. Commit-reveal's random selection of which results count makes targeted rigging futile. Published at ICML 2025.

### Huang, Nasr, Angelopoulos, Carlini, Chiang, Choquette-Choo, Ippolito, Jagielski, Lee, Liu, Stoica, Tramer & Zhang (2025) — Exploring and Mitigating Adversarial Manipulation of Voting-Based Leaderboards
- **Link:** https://arxiv.org/abs/2501.07493
- **Authors:**
  - Yangsibo Huang — Google
  - Milad Nasr — Google
  - Anastasios Angelopoulos — UC Berkeley
  - Nicholas Carlini — Google DeepMind
  - Wei-Lin Chiang — UC Berkeley
  - Christopher A. Choquette-Choo — Google DeepMind
  - Daphne Ippolito — Carnegie Mellon University
  - Matthew Jagielski — Google DeepMind
  - Katherine Lee — Google DeepMind
  - Ken Ziyu Liu — UC Berkeley
  - Ion Stoica — UC Berkeley
  - Florian Tramer — ETH Zurich
  - Chiyuan Zhang — Google DeepMind
- **Quote:** "An attacker can alter the leaderboard (to promote their favorite model or demote competitors) at the cost of roughly a thousand votes."
- **Why relevant:** Shows that model identity can be fingerprinted with >95% accuracy, enabling targeted vote manipulation. Even the platform operators working with the authors could only partially mitigate this. Cryptographic commit-reveal removes the human voting attack surface entirely. Published at ICML 2025.

---

## 2. Data Contamination Detection Methods and Their Limitations

### Samuel, Zhou & Zou (2024) — Towards Data Contamination Detection for Modern Large Language Models: Limitations, Inconsistencies, and Oracle Challenges
- **Link:** https://arxiv.org/abs/2409.09927
- **Authors:**
  - Vinay Samuel — Carnegie Mellon University
  - Yue Zhou — University of Illinois Chicago
  - Henry Peng Zou — University of Illinois Chicago
- **Quote:** "Current methods have non-trivial limitations in their assumptions and practical applications... notable difficulties exist in detecting contamination introduced during instruction fine-tuning with answer augmentation."
- **Why relevant:** Evaluates five SOTA contamination detection methods across four LLMs and eight benchmarks, finding limited consistency between techniques. This directly motivates commit-reveal: if contamination cannot be reliably detected post-hoc, the protocol must prevent its exploitation at evaluation time. Published at COLING 2025.

### Ravaut, Ding, Jiao, Chen, Li, Zhao, Qin, Xiong & Joty (2024) — A Comprehensive Survey of Contamination Detection Methods in Large Language Models
- **Link:** https://arxiv.org/abs/2404.00699
- **Authors:**
  - Mathieu Ravaut — Nanyang Technological University
  - Bosheng Ding — Salesforce Research
  - Fangkai Jiao — Nanyang Technological University
  - Hailin Chen — University of Texas at Dallas
  - Xingxuan Li — Peking University
  - Ruochen Zhao — Nanyang Technological University
  - Chengwei Qin — Nanyang Technological University
  - Caiming Xiong — Salesforce Research
  - Shafiq Joty — Salesforce Research; Nanyang Technological University
- **Quote:** "There remains a lack of methods on how to efficiently detect contamination... harder and harder to keep track of the data that LLMs have seen."
- **Why relevant:** The most comprehensive survey of contamination detection as of 2024, cataloguing the full landscape of detection approaches and their failure modes. Accepted at TMLR. Establishes that detection is fundamentally limited because training data is opaque — the exact gap that commit-reveal's prevention-based approach fills.

### Magar & Schwartz (2022) — Data Contamination: From Memorization to Exploitation
- **Link:** https://arxiv.org/abs/2203.08242
- **DOI:** https://doi.org/10.18653/v1/2022.acl-short.18
- **Authors:**
  - Inbal Magar — Hebrew University of Jerusalem
  - Roy Schwartz — Hebrew University of Jerusalem; Allen Institute for AI
- **Quote:** "Exploitation exists in some cases, but in others the models memorize the contaminated data, but do not exploit it."
- **Why relevant:** First paper to formally distinguish memorization from exploitation in contamination, showing that contaminated data can boost downstream performance even without verbatim recall. This means contamination detection methods based on memorization signatures will miss exploitation-only cases — a blind spot that commit-reveal sidesteps entirely. Published at ACL 2022.

### Mansurov, Sakip & Aji (2024) — Data Laundering: Artificially Boosting Benchmark Results through Knowledge Distillation
- **Link:** https://arxiv.org/abs/2412.15255
- **Authors:**
  - Jonibek Mansurov — MBZUAI (Mohamed bin Zayed University of Artificial Intelligence)
  - Akhmed Sakip — MBZUAI
  - Alham Fikri Aji — MBZUAI
- **Quote:** "Data Laundering enables the covert transfer of benchmark-specific knowledge through seemingly legitimate intermediate training steps... achieving up to 75% on GPQA without developing genuine reasoning capabilities."
- **Why relevant:** Introduces a new attack vector: knowledge distillation as a laundering mechanism that transfers benchmark-specific knowledge through an intermediary, making contamination undetectable by standard methods. This can occur unintentionally. Published at ACL 2025. Demonstrates that even novel contamination pathways emerge faster than detection methods can address them — strengthening the case for commit-reveal's prevention-first design.

---

## 3. Benchmark Design, Saturation, and Metric Gaming

### Schaeffer, Miranda & Koyejo (2023) — Are Emergent Abilities of Large Language Models a Mirage?
- **Link:** https://arxiv.org/abs/2304.15004
- **Authors:**
  - Rylan Schaeffer — Stanford University
  - Brando Miranda — Stanford University
  - Sanmi Koyejo — Stanford University
- **Quote:** "Emergent abilities appear due to the researcher's choice of metric rather than due to fundamental changes in model behavior with scale."
- **Why relevant:** Demonstrates that benchmark metric design itself can create illusions of capability. If the choice of grading scheme can manufacture apparent emergent abilities, then the choice of which test cases to report (cherry-picking) is an equally powerful lever. Commit-reveal neutralizes this by mandating disclosure of randomly-selected results before metric post-processing. NeurIPS 2023 Outstanding Paper Award.

### Thomas & Uminsky (2022) — Reliance on Metrics is a Fundamental Challenge for AI
- **Link:** https://doi.org/10.1016/j.patter.2022.100476
- **Authors:**
  - Rachel Thomas — University of San Francisco; fast.ai
  - David Uminsky — University of Chicago (formerly University of San Francisco)
- **Quote:** "When a measure becomes the target, it ceases to be an effective measure."
- **Why relevant:** Applies Goodhart's Law systematically to AI evaluation, showing how metric optimization leads to manipulation, gaming, and proxy failure. Published in Patterns. Commit-reveal is a structural intervention against Goodhart's Law in benchmarking: by randomly selecting which results are disclosed, the benchmark cannot be targeted.

### Karwowski, Hayman, Bai, Kiendlhofer, Griffin & Skalse (2023) — Goodhart's Law in Reinforcement Learning
- **Link:** https://arxiv.org/abs/2310.09144
- **Authors:**
  - Jacek Karwowski — University of Oxford
  - Oliver Hayman — University of Oxford
  - Xingjian Bai — University of Oxford
  - Klaus Kiendlhofer — University of Oxford
  - Charlie Griffin — University of Oxford
  - Joar Skalse — University of Oxford
- **Quote:** "Increasing optimisation of an imperfect proxy beyond some critical point decreases performance on the true objective."
- **Why relevant:** Provides the first large-scale empirical demonstration of Goodhart's Law in RL, with a geometric explanation for why proxy optimization breaks down. Published at ICLR 2024. Directly formalizes the theoretical failure mode that benchmark gaming exploits: once a benchmark score becomes the optimization target, its correlation with actual capability degrades.

### Akhtar, Reuel, Soni, Ahuja, Ammanamanchi et al. (2026) — When AI Benchmarks Plateau: A Systematic Study of Benchmark Saturation
- **Link:** https://arxiv.org/abs/2602.16763
- **Authors:**
  - Mubashara Akhtar — Queen Mary University of London (first author; 37 authors total including Anka Reuel, Stella Biderman, Sanmi Koyejo, Zeerak Talat, Irene Solaiman)
- **Quote:** "Nearly half of the benchmarks exhibit saturation, with rates increasing as benchmarks age. Hiding test data (public vs. private) shows no protective effect."
- **Why relevant:** The finding that keeping test sets private does not prevent saturation is devastating for the standard held-out test set approach. This directly motivates commit-reveal's alternative: rather than hiding the test set (which fails), use cryptographic random sampling to prevent selective reporting from a known test set.

### Chen, Chen, Li, Jiang, Wan, He, Ran, Gu, Li, Xie & Ray (2025) — Recent Advances in Large Language Model Benchmarks against Data Contamination: From Static to Dynamic Evaluation
- **Link:** https://arxiv.org/abs/2502.17521
- **Authors:**
  - Simin Chen — Columbia University
  - Yiming Chen — National University of Singapore
  - Zexin Li — University of California, Riverside
  - Yifan Jiang — University of Southern California
  - Zhongwei Wan — The Ohio State University
  - Yixin He — University of Southern California
  - Dezhi Ran — Peking University
  - Tianle Gu — Tsinghua University
  - Haizhou Li — National University of Singapore; CUHK Shenzhen
  - Tao Xie — Peking University
  - Baishakhi Ray — Columbia University
- **Quote:** "A critical gap — the lack of standardized criteria for evaluating dynamic benchmarks."
- **Why relevant:** Comprehensive survey of the shift from static to dynamic benchmarks as a contamination countermeasure, finding that dynamic benchmarks are expensive and lack standardized evaluation criteria. Published at EMNLP 2025. Commit-reveal offers a complementary approach: rather than continuously regenerating test data (dynamic benchmarks), ensure that results from existing test data cannot be cherry-picked.

---

## 4. Held-Out Test Set Management and Leaderboard Probing

### Blum & Hardt (2015) — The Ladder: A Reliable Leaderboard for Machine Learning Competitions
- **Link:** https://arxiv.org/abs/1502.04585
- **Authors:**
  - Avrim Blum — Carnegie Mellon University
  - Moritz Hardt — Carnegie Mellon University (now Max Planck Institute for Intelligent Systems)
- **Quote:** "As participants are allowed to repeatedly evaluate their submissions on the leaderboard, they may begin to overfit to the holdout data that supports the leaderboard."
- **Why relevant:** Foundational theoretical work on adaptive overfitting to held-out test sets through repeated evaluation. Published at ICML 2015. The Ladder algorithm adds noise to leaderboard scores to prevent information leakage, but this only slows probing — it does not prevent selective reporting of the best submission. Commit-reveal solves the complementary problem: ensuring that all committed results are subject to random audit.

### Whitehill (2017) — Climbing the Kaggle Leaderboard by Exploiting the Log-Loss Oracle
- **Link:** https://arxiv.org/abs/1707.01825
- **Authors:**
  - Jacob Whitehill — Worcester Polytechnic Institute
- **Quote:** "With less than 100 oracle queries... we were able to infer the ground-truth labels of all the test examples perfectly... achieving a log-loss of 0.00000 without ever training a classifier."
- **Why relevant:** Demonstrates a practical attack that extracts all ground-truth test labels from a competition leaderboard using only the scoring API. Achieved rank #4 out of 848 Kaggle contestants without building any model. This is the extreme case of test set information leakage through repeated evaluation — the exact failure mode that commit-reveal prevents by requiring commitment before any evaluation feedback.

### Recht, Roelofs, Schmidt & Shankar (2019) — Do ImageNet Classifiers Generalize to ImageNet?
- **Link:** https://arxiv.org/abs/1902.10811
- **Authors:**
  - Benjamin Recht — UC Berkeley
  - Rebecca Roelofs — UC Berkeley (now Google)
  - Ludwig Schmidt — UC Berkeley (now University of Washington)
  - Vaishaal Shankar — UC Berkeley (now Amazon)
- **Quote:** "Both benchmarks have been the focus of intense research for almost a decade, raising the danger of overfitting to excessively re-used test sets."
- **Why relevant:** Built new test sets for CIFAR-10 and ImageNet and found 3-15% accuracy drops on fresh data, demonstrating that years of community-wide optimization against a fixed test set leads to implicit overfitting — even without deliberate gaming. Published at ICML 2019. This motivates commit-reveal's random sampling: even honest repeated evaluation degrades test set validity over time.

---

## 5. Cryptographic and Verifiable Evaluation Approaches

### Balan, Learney & Wood (2025) — A Framework for Cryptographic Verifiability of End-to-End AI Pipelines
- **Link:** https://arxiv.org/abs/2503.22573
- **Authors:**
  - Kar Balan — DECaDE Centre, University of Surrey
  - Robert Learney — Digital Catapult, London
  - Tim Wood — Digital Catapult, London
- **Quote:** "Cryptographic proofs alongside AI-generated assets allow downstream verification of their provenance and correctness."
- **Why relevant:** Proposes a framework for end-to-end cryptographic verifiability of AI pipelines — from data sourcing through training and inference. Published at ACM IWSPA 2025. Commit-reveal addresses a specific critical stage in this pipeline (evaluation integrity), and this framework provides the broader architectural context showing how cryptographic verification can span the entire AI lifecycle.

---

## Summary Table

| # | Citation | Year | Category | Key Contribution |
|---|----------|------|----------|-----------------|
| 1 | Singh et al. — The Leaderboard Illusion | 2025 | Gaming | Documents selective variant testing on Chatbot Arena |
| 2 | Min et al. — Vote Rigging | 2025 | Gaming | Shows crowdsourced leaderboards can be rigged with hundreds of votes |
| 3 | Huang et al. — Adversarial Manipulation of Voting Leaderboards | 2025 | Gaming | Demonstrates model fingerprinting enables targeted vote manipulation |
| 4 | Samuel et al. — Contamination Detection Limitations | 2024 | Detection | Five detection methods are inconsistent and have non-trivial limitations |
| 5 | Ravaut et al. — Comprehensive Survey of Contamination Detection | 2024 | Detection | Most complete survey; detection fundamentally limited by training data opacity |
| 6 | Magar & Schwartz — From Memorization to Exploitation | 2022 | Detection | Distinguishes memorization from exploitation; detection misses exploitation-only cases |
| 7 | Mansurov et al. — Data Laundering | 2024 | Detection | Knowledge distillation launders benchmark knowledge undetectably |
| 8 | Schaeffer et al. — Emergent Abilities Mirage | 2023 | Metrics | Metric choice alone can manufacture apparent capabilities |
| 9 | Thomas & Uminsky — Reliance on Metrics | 2022 | Metrics | Goodhart's Law applied to AI evaluation systematically |
| 10 | Karwowski et al. — Goodhart's Law in RL | 2023 | Metrics | First large-scale empirical demonstration of Goodhart's Law in RL |
| 11 | Akhtar et al. — Benchmark Saturation | 2026 | Design | Half of benchmarks saturated; hiding test data shows no protective effect |
| 12 | Chen et al. — Static to Dynamic Evaluation | 2025 | Design | Dynamic benchmarks lack standards; expensive alternative to commit-reveal |
| 13 | Blum & Hardt — The Ladder | 2015 | Held-out | Theoretical framework for adaptive overfitting to leaderboards |
| 14 | Whitehill — Climbing Kaggle via Log-Loss Oracle | 2017 | Held-out | Extracts all test labels from leaderboard with <100 queries |
| 15 | Recht et al. — Do ImageNet Classifiers Generalize | 2019 | Held-out | Fresh test sets reveal 3-15% accuracy drops from implicit overfitting |
| 16 | Balan et al. — Cryptographic Verifiability of AI Pipelines | 2025 | Crypto | End-to-end framework for cryptographic AI pipeline verification |
