# Publication Citations

Collected references for the NoCherry commit-reveal protocol publication, organized by topic.

---

## 1. Cherry-Picking, Selective Reporting & Research Integrity

### Ioannidis (2005) — Why Most Published Research Findings Are False
- **Link:** https://doi.org/10.1371/journal.pmed.0020124
- **Authors:**
  - John P. A. Ioannidis — Department of Hygiene and Epidemiology, University of Ioannina School of Medicine, Greece
- **Quote:** "A research finding is less likely to be true when the studies conducted in a field are smaller; when effect sizes are smaller; when there is a greater number and lesser preselection of tested relationships."
- **Why relevant:** The foundational paper arguing that bias, flexibility, and selective reporting make most published findings unreliable — directly motivating protocols that constrain researcher degrees of freedom.

### Simmons, Nelson & Simonsohn (2011) — False-Positive Psychology
- **Link:** https://doi.org/10.1177/0956797611417632
- **Authors:**
  - Joseph P. Simmons — Wharton School, University of Pennsylvania
  - Leif D. Nelson — Haas School of Business, University of California, Berkeley
  - Uri Simonsohn — Wharton School, University of Pennsylvania
- **Quote:** "In many cases, a researcher is more likely to falsely find evidence that an effect exists than to correctly find evidence that it does not."
- **Why relevant:** Demonstrates that undisclosed flexibility in analysis produces false positives at alarming rates — the exact problem commit-reveal random sampling eliminates by fixing the sample before analysis.

### Head, Holman, Lanfear, Kahn & Jennions (2015) — The Extent and Consequences of P-Hacking in Science
- **Link:** https://doi.org/10.1371/journal.pbio.1002106
- **Authors:**
  - Megan L. Head — Australian National University
  - Luke Holman — Australian National University
  - Rob Lanfear — Australian National University; Macquarie University
  - Andrew T. Kahn — Australian National University
  - Michael D. Jennions — Australian National University
- **Quote:** "A focus on novel, confirmatory, and statistically significant results leads to substantial bias in the scientific literature."
- **Why relevant:** Large-scale text-mining evidence that p-hacking is widespread across all scientific disciplines.

### Mayo-Wilson et al. (2017) — Cherry-picking by trialists and meta-analysts can drive conclusions about intervention efficacy
- **Link:** https://doi.org/10.1016/j.jclinepi.2017.07.014
- **Authors:**
  - Evan Mayo-Wilson — Johns Hopkins Bloomberg School of Public Health
  - Tianjing Li — Johns Hopkins Bloomberg School of Public Health
  - Nicole Fusco — Johns Hopkins Bloomberg School of Public Health
  - Lorenzo Bertizzolo — Johns Hopkins Bloomberg School of Public Health
  - Joseph K. Canner — Johns Hopkins School of Medicine
  - Terrie Cowley — The TMJ Association
  - Peter Doshi — University of Maryland School of Pharmacy
  - Jeffrey Ehmsen — Johns Hopkins School of Medicine
  - Gillian Gresham — Johns Hopkins Bloomberg School of Public Health
  - Nan Guo — Johns Hopkins Bloomberg School of Public Health
  - Jennifer A. Haythornthwaite — Johns Hopkins School of Medicine
  - James Heyward — Johns Hopkins Bloomberg School of Public Health
  - Hwanhee Hong — Johns Hopkins Bloomberg School of Public Health
  - Diana Pham — Johns Hopkins Bloomberg School of Public Health
  - Jennifer L. Payne — Johns Hopkins School of Medicine
  - Lori Rosman — Welch Medical Library, Johns Hopkins
  - Elizabeth A. Stuart — Johns Hopkins Bloomberg School of Public Health
  - Catalina Suarez-Cuervo — Johns Hopkins Bloomberg School of Public Health
  - Elizabeth Tolbert — Johns Hopkins Peabody Institute
  - Swaroop Vedula — Malone Center for Engineering in Healthcare, Johns Hopkins
  - Claire Twose — Welch Medical Library, Johns Hopkins
  - Kay Dickersin — Johns Hopkins Bloomberg School of Public Health
- **Quote:** For gabapentin pain outcomes, researchers could shift results "from effective (SMD = -0.45) to ineffective (SMD = -0.06)" simply by choosing different reported results.
- **Why relevant:** Empirical evidence that selective reporting can completely reverse conclusions about efficacy.

### Nosek, Ebersole, DeHaven & Mellor (2018) — The Preregistration Revolution
- **Link:** https://doi.org/10.1073/pnas.1708274114
- **Authors:**
  - Brian A. Nosek — Center for Open Science; University of Virginia
  - Charles R. Ebersole — University of Virginia
  - Alexander C. DeHaven — Center for Open Science
  - David T. Mellor — Center for Open Science
- **Quote:** "Progress in science relies in part on generating hypotheses with existing observations and testing hypotheses with new observations. This distinction between postdiction and prediction is appreciated conceptually but is not respected in practice."
- **Why relevant:** A commit-reveal random sampling protocol is a cryptographic enforcement of preregistration — making the commitment tamper-proof and the sampling verifiably random.

### Andrade (2021) — HARKing, Cherry-Picking, P-Hacking as Questionable Research Practices
- **Link:** https://doi.org/10.4088/JCP.20f13804
- **Quote:** Cherry-picking is "the presentation of favorable evidence with the concealment of unfavorable evidence."
- **Why relevant:** Comprehensive taxonomy of the specific research malpractices that a verifiable random sampling protocol is designed to prevent.

### (2023) — A Note on Cherry-Picking in Meta-Analyses
- **Link:** https://doi.org/10.3390/e25040691
- **Quote:** "It is possible to modify the results of a meta-analysis by changing the inclusion and/or exclusion criteria to select an arbitrary subset of studies."
- **Why relevant:** Shows that selective inclusion of data points can reverse the conclusions of a meta-analysis.

### (2023) — Reducing Bias, Increasing Transparency with Preregistration
- **Link:** https://doi.org/10.1038/s41562-022-01497-2
- **Quote:** "HARKing — blurring the line between prediction and postdiction — can introduce hindsight bias and undermine the interpretability of results."
- **Why relevant:** Argues that publicly committing to a plan before seeing outcomes reduces cherry-picking — precisely what commit-reveal enforces cryptographically.

---

## 2. Cryptographic Commitment Schemes

### Blum (1983) — Coin Flipping by Telephone: A Protocol for Solving Impossible Problems
- **Link:** https://doi.org/10.1145/1008908.1008911 (ACM SIGACT News 15(1):23-27, January 1983; verified via Crossref 2026-09-30. The previous DOI 10.1007/3-540-11611-8_73 returns 404 at Crossref. An earlier 1981 CRYPTO workshop version exists; cite the SIGACT News version unless the CRYPTO '81 record is verified.)
- **Authors:**
  - Manuel Blum — University of California, Berkeley
- **Why relevant:** The original paper introducing commitment schemes as a mechanism for fair coin-flipping over untrusted channels. Conceptual ancestor of all commit-reveal protocols for random selection.

### Naor (1991) — Bit Commitment Using Pseudorandomness
- **Link:** https://doi.org/10.1007/BF00196774
- **Authors:**
  - Moni Naor — Weizmann Institute of Science
- **Why relevant:** Proved that bit commitment schemes can be constructed from any pseudorandom generator, establishing the minimal complexity assumption for commitments.

### Pedersen (1991) — Non-Interactive and Information-Theoretic Secure Verifiable Secret Sharing
- **Link:** https://doi.org/10.1007/3-540-46766-1_9
- **Authors:**
  - Torben Pryds Pedersen — Aarhus University
- **Why relevant:** Introduced the Pedersen commitment scheme (information-theoretically hiding, computationally binding). Foundational construction that most modern commitment-based protocols build upon.

### Ionescu & Olimid (2025) — Commitment Schemes for Multi-Party Computation
- **Link:** https://arxiv.org/abs/2506.10721
- **Quote:** "Carefully selecting [commitment schemes] to meet the adversarial and functional requirements of MPC is essential for developing robust privacy-preserving cryptographic systems."
- **Why relevant:** Comprehensive survey of commitment scheme properties (hiding, binding) and their security guarantees.

### Canidio & Danos (2023) — Commitment Against Front Running Attacks
- **Link:** https://arxiv.org/abs/2301.13785
- **Quote:** A commit-reveal protocol "prevents severe attacks while permitting honest competition."
- **Why relevant:** Game-theoretic analysis of how commitment schemes prevent adversaries from acting on information before it should be available.

### Don, Fehr, Majenz & Schaffner (2022) — Efficient NIZKs from Commit-and-Open Protocols in the QROM
- **Link:** https://arxiv.org/abs/2202.13730
- **Quote:** Hash-based commitments achieve "tight online-extractability in the quantum random oracle model."
- **Why relevant:** Establishes post-quantum security of hash-based commitment schemes (SHA-256 etc.).

---

## 3. Verifiable Randomness & Distributed Beacons

### Micali, Rabin & Vadhan (1999) — Verifiable Random Functions
- **Link:** https://doi.org/10.1109/SFFCS.1999.814584
- **Authors:**
  - Silvio Micali — MIT
  - Michael Rabin — Harvard University
  - Salil Vadhan — MIT
- **Quote:** "VRFs efficiently combine unpredictability and verifiability by extending the Goldreich-Goldwasser-Micali construction of pseudorandom functions."
- **Why relevant:** Foundational paper defining VRFs — the cryptographic primitive allowing a party to prove their random output was computed correctly.

### Bonneau, Clark & Goldfeder (2015) — On Bitcoin as a Public Randomness Source
- **Link:** https://eprint.iacr.org/2015/1015
- **Authors:**
  - Joseph Bonneau — Stanford University
  - Jeremy Clark — Concordia University
  - Steven Goldfeder — Princeton University
- **Quote:** "At least 68 bits of min-entropy are produced every 10 minutes" and manipulation has a quantifiable monetary cost.
- **Why relevant:** Demonstrates how blockchain proof-of-work can serve as a publicly verifiable randomness beacon with economic security guarantees.

### Syta et al. (2017) — Scalable Bias-Resistant Distributed Randomness (RandHound/RandHerd)
- **Link:** https://doi.org/10.1109/SP.2017.45
- **Authors:**
  - Ewa Syta — Trinity College
  - Philipp Jovanovic — EPFL
  - Eleftherios Kokoris-Kogias — EPFL
  - Nicolas Gailly — EPFL
  - Linus Gasser — EPFL
  - Ismail Khoffi — University of Bonn
  - Michael J. Fischer — Yale University
  - Bryan Ford — EPFL
- **Quote:** "RandHound and RandHerd [...] provide publicly-verifiable, unpredictable, and unbiasable randomness against Byzantine adversaries."
- **Why relevant:** Academic foundation for drand. Proves that distributed randomness beacons can be scalable and bias-resistant.

### Yakira, Asayag, Grayevsky & Keidar (2020) — Economically Viable Randomness
- **Link:** https://arxiv.org/abs/2007.03531
- **Quote:** "Following the protocol gives rise to a stable state, called Coalition-Proof Nash Equilibrium."
- **Why relevant:** Formalizes game-theoretic security of distributed commit-reveal randomness, proving participants cannot profitably deviate.

### Mondal, Rooparaghunath & Gupta (2023) — RANDGENER: Distributed Randomness Beacon from VDF
- **Link:** https://arxiv.org/abs/2310.12693
- **Quote:** Introduces "a novel n-party commit-reveal-recover DRB protocol with a novel reward and penalty mechanism."
- **Why relevant:** Extends commit-reveal with verifiable delay functions for unbiasable randomness.

### Choi, Manoj & Bonneau (2023) — SoK: Distributed Randomness Beacons
- **Link:** https://eprint.iacr.org/2023/728
- **Quote:** Systematizes protocols that "generate publicly verifiable randomness in a distributed yet secure fashion" and includes drand as a deployed system in its taxonomy.
- **Why relevant:** Comprehensive taxonomy of randomness beacon designs and their security properties.

### Kavousi, Wang & Jovanovic (2023) — SoK: Public Randomness
- **Link:** https://eprint.iacr.org/2023/1121
- **Authors:**
  - Alireza Kavousi — University College London
  - Zhipeng Wang — Imperial College London
  - Philipp Jovanovic — University College London (co-creator of drand)
- **Quote:** "Public randomness is a fundamental component in many cryptographic protocols and often plays a crucial role in ensuring their security, fairness, and transparency properties."
- **Why relevant:** Defines the formal properties (unpredictability, unbiasability, availability, public-verifiability) a randomness source must satisfy.

### Lee, Gee, Soroush, Bingol & Huang (2025) — Commit-Reveal Squared
- **Link:** https://arxiv.org/abs/2504.03936
- **Quote:** "Simple commit-reveal beacons are vulnerable to last-revealer strategies."
- **Why relevant:** Addresses security weaknesses of naive commit-reveal protocols and proposes mitigations.

---

## 4. AI Benchmark Integrity & Data Contamination

### Yang, Chiang, Zheng, Gonzalez & Stoica (2023) — Rethinking Benchmark and Contamination with Rephrased Samples
- **Link:** https://arxiv.org/abs/2311.04850
- **Authors:**
  - Shuo Yang — UC Berkeley
  - Wei-Lin Chiang — UC Berkeley
  - Lianmin Zheng — UC Berkeley
  - Joseph E. Gonzalez — UC Berkeley
  - Ion Stoica — UC Berkeley
- **Quote:** "A 13B model can easily overfit a test benchmark and achieve drastically high performance, on par with GPT-4."
- **Why relevant:** Directly demonstrates how small models can game benchmarks to match frontier models, proving that benchmark scores without verified sampling are meaningless.

### Sainz et al. (2023) — NLP Evaluation in Trouble: On the Need to Measure LLM Data Contamination
- **Link:** https://arxiv.org/abs/2310.18018
- **Authors:**
  - Oscar Sainz — University of the Basque Country UPV/EHU
  - Jon Ander Campos — Cohere
  - Iker Garcia-Ferrero — University of the Basque Country UPV/EHU
  - Julen Etxaniz — University of the Basque Country UPV/EHU
  - Oier Lopez de Lacalle — University of the Basque Country UPV/EHU
  - Eneko Agirre — University of the Basque Country UPV/EHU
- **Quote:** "The worst kind of data contamination happens when a Large Language Model is trained on the test split of a benchmark, and then evaluated in the same benchmark."
- **Why relevant:** Establishes that benchmark evaluation is unreliable without contamination controls.

### Deng, Zhao, Tang, Gerstein & Cohan (2023) — Investigating Data Contamination in Modern Benchmarks
- **Link:** https://arxiv.org/abs/2311.09783
- **Authors:**
  - Chunyuan Deng — Georgia Institute of Technology
  - Yilun Zhao — Yale University
  - Xiangru Tang — Yale University
  - Mark Gerstein — Yale University
  - Arman Cohan — Yale University; Allen Institute for AI
- **Quote:** "Recent observations have underscored a disparity between the inflated benchmark scores and the actual performance of LLMs."
- **Why relevant:** Even proprietary models exhibit signs of contamination — supporting the need for cryptographic proof of random test selection.

### Dong et al. (2024) — Generalization or Memorization: Data Contamination and Trustworthy Evaluation
- **Link:** https://arxiv.org/abs/2402.15938
- **Quote:** "Detecting and mitigating data contamination for LLMs faces significant challenges due to the opacity of training data."
- **Why relevant:** Commit-reveal prevents the problem at its source rather than detecting it after the fact.

### South et al. (2024) — Verifiable Evaluations of Machine Learning Models Using zkSNARKs
- **Link:** https://arxiv.org/abs/2402.02675
- **Authors:**
  - Tobin South — MIT
  - Alexander Camuto — EZKL
  - Shrey Jain — Microsoft Research
  - Shayla Nguyen — University of Adelaide
  - Robert Mahari — MIT
  - Christian Paquin — Microsoft Research
  - Jason Morton — EZKL
  - Alex "Sandy" Pentland — MIT
- **Quote:** "Zero-knowledge computational proofs of model outputs over datasets can be packaged into verifiable evaluation attestations."
- **Why relevant:** Most directly related work — uses cryptographic proofs to make AI evaluations verifiable, the same class of approach as commit-reveal.

### White et al. (2024) — LiveBench: A Challenging, Contamination-Limited LLM Benchmark
- **Link:** https://arxiv.org/abs/2406.19314
- **Authors:**
  - Colin White — Abacus.AI
  - Samuel Dooley — Abacus.AI
  - Manley Roberts — Abacus.AI
  - Arka Pal — Abacus.AI
  - Benjamin Feuer — NYU
  - Siddhartha Jain — Nvidia
  - Ravid Shwartz-Ziv — NYU
  - Neel Jain — University of Maryland
  - Khalid Saifullah — University of Maryland
  - Chinmay Hegde — NYU
  - Yann LeCun — NYU
  - Tom Goldstein — University of Maryland
  - Willie Neiswanger — USC
  - Micah Goldblum — Columbia University
- **Quote:** "Test set contamination, wherein test data from a benchmark ends up in a newer model's training set, is a well-documented obstacle for fair LLM evaluation."
- **Why relevant:** Proposes frequently-updated questions as mitigation, but this is expensive compared to cryptographic random sampling.

### Xu, Guan, Greene & Kechadi (2024) — Benchmark Data Contamination of LLMs: A Survey
- **Link:** https://arxiv.org/abs/2406.04244
- **Quote:** "Benchmark Data Contamination refers to when language models incorporate information related to evaluation benchmarks from their training data."
- **Why relevant:** Comprehensive survey establishing contamination as a systemic problem across the field.

### Reuel et al. (2024) — BetterBench: Assessing AI Benchmarks
- **Link:** https://arxiv.org/abs/2411.12990
- **Authors:**
  - Anka Reuel — Stanford University
  - Amelia Hardy — Stanford University
  - Chandler Smith — Northeastern University
  - Max Lamparth — Stanford University
  - Malcolm Hardy — Stanford University
  - Mykel J. Kochenderfer — Stanford University
- **Quote:** "Most benchmarks do not report statistical significance of their results nor allow for their results to be easily replicated."
- **Why relevant:** Systematic framework of 46 best practices, finding widespread quality issues including lack of reproducibility.

### Eriksson et al. (2025) — Can We Trust AI Benchmarks?
- **Link:** https://arxiv.org/abs/2502.06559
- **Authors:**
  - Maria Eriksson — European Commission, Joint Research Centre (JRC), Seville
  - Erasmo Purificato — JRC, Ispra
  - Arman Noroozian — JRC, Brussels
  - Joao Vinagre — JRC, Seville
  - Guillaume Chaslot — JRC, Brussels
  - Emilia Gomez — JRC, Seville
  - David Fernandez-Llorca — JRC, Seville
- **Quote:** "Users of benchmarks rarely provide the resources needed to validate and replicate their test results. This makes it possible to tweak and cherry-pick benchmark results."
- **Why relevant:** Directly documents how AI benchmark gaming through cherry-picking is a systemic problem.

### (2024) — Cheating Automatic LLM Benchmarks: Null Models Achieve High Win Rates
- **Link:** https://arxiv.org/abs/2410.07137
- **Quote:** "A 'null model' that always outputs a constant response can cheat automatic benchmarks and achieve an 86.5% LC win rate on AlpacaEval 2.0."
- **Why relevant:** AI benchmarks are trivially gameable, proving evaluation integrity requires mechanisms that prevent optimizing for specific test instances.

---

## 5. LLM Training Data Provenance & Copyright

### Gebru et al. (2018/2021) — Datasheets for Datasets
- **Link:** https://arxiv.org/abs/1803.09010
- **Authors:**
  - Timnit Gebru — Black in AI
  - Jamie Morgenstern — University of Washington
  - Briana Vecchione — Cornell University
  - Jennifer Wortman Vaughan — Microsoft Research
  - Hanna Wallach — Microsoft Research
  - Hal Daume III — Microsoft Research; University of Maryland
  - Kate Crawford — Microsoft Research
- **Quote:** "We propose that every dataset be accompanied with a datasheet that documents its motivation, composition, collection process, recommended uses, and so on."
- **Why relevant:** Foundational dataset documentation standard — commit-reveal could serve as the cryptographic enforcement layer making datasheets verifiable rather than voluntary.

### Mitchell et al. (2018) — Model Cards for Model Reporting
- **Link:** https://arxiv.org/abs/1810.03993
- **Authors:**
  - Margaret Mitchell — Google
  - Simone Wu — Google
  - Andrew Zaldivar — Google
  - Parker Barnes — Google
  - Lucy Vasserman — Google
  - Ben Hutchinson — Google
  - Elena Spitzer — Google
  - Inioluwa Deborah Raji — University of Toronto
  - Timnit Gebru — Google
- **Quote:** "Model cards are short documents accompanying trained machine learning models that provide benchmarked evaluation in a variety of conditions."
- **Why relevant:** Documents the model side; commit-reveal documents the data side with cryptographic commitments, forming a complete accountability chain.

### Longpre et al. (2024) — Data Authenticity, Consent, & Provenance for AI are all broken
- **Link:** https://arxiv.org/abs/2404.12691
- **Authors:**
  - Shayne Longpre — MIT Media Lab
  - Robert Mahari — MIT Media Lab
  - Naana Obeng-Marnu — MIT Media Lab
  - William Brannon — MIT Media Lab
  - Tobin South — MIT Media Lab
  - Katy Gero — Harvard University
  - Sandy Pentland — MIT Media Lab
  - Jad Kabbara — MIT Media Lab
- **Quote:** "Massive, widely-sourced, and under-documented training data collections" have created problems around authenticity verification, consent, privacy, and bias.
- **Why relevant:** Directly identifies the infrastructure gap that commit-reveal fills — a cryptographic mechanism for data provenance.

### Duan et al. (2024) — Do Membership Inference Attacks Work on Large Language Models?
- **Link:** https://arxiv.org/abs/2402.07841
- **Authors:**
  - Michael Duan — University of Washington
  - Anshuman Suri — University of Virginia
  - Niloofar Mireshghallah — University of Washington
  - Sewon Min — University of Washington
  - Weijia Shi — University of Washington
  - Luke Zettlemoyer — University of Washington
  - Yulia Tsvetkov — University of Washington
  - Yejin Choi — University of Washington
  - David Evans — University of Virginia
  - Hannaneh Hajishirzi — University of Washington; Allen Institute for AI
- **Quote:** "MIAs barely outperform random guessing for most settings across varying LLM sizes and domains."
- **Why relevant:** Post-hoc detection of training data membership is unreliable, so commit-reveal's pre-training commitment approach is essential.

### Freeman, Rippe, Debenedetti & Andriushchenko (2024) — Exploring Memorization and Copyright Violation in Frontier LLMs (NYT v. OpenAI)
- **Link:** https://arxiv.org/abs/2412.06370
- **Authors:**
  - Joshua Freeman — ETH Zurich
  - Chloe Rippe — Duke University
  - Edoardo Debenedetti — ETH Zurich
  - Maksym Andriushchenko — EPFL
- **Quote:** "Both GPT and Claude models use refusal training and output filters to prevent verbatim output of the memorized articles," yet memorization remains significant.
- **Why relevant:** The NYT v. OpenAI dispute could have been resolved faster if OpenAI had made verifiable commitments about their training data.

### Kyrychenko, Mudryi & Chaklosh (2025) — Copyright in AI Pre-Training Data Filtering
- **Link:** https://arxiv.org/abs/2512.02047
- **Authors:**
  - Mariia Kyrychenko — ARIMLABS.AI; University of Texas at Tyler
  - Mykyta Mudryi — ARIMLABS.AI; Polish-Japanese Academy of Information Technology
  - Markiyan Chaklosh — ARIMLABS.AI; University of the National Education Commission in Krakow
- **Quote:** Proposes "a multilayered filtering pipeline that combines access control, content verification, machine learning classifiers, and continuous database cross-referencing."
- **Why relevant:** Highlights the verification gap in copyright filtering that commit-reveal addresses.

### Shen et al. (2026) — The Limits of AI Data Transparency Policy: Three Disclosure Fallacies
- **Link:** https://arxiv.org/abs/2601.18127
- **Authors:**
  - Judy Hanwen Shen — Stanford University
  - Ken Liu — Stanford University
  - Angelina Wang — Stanford University
  - Sarah H. Cen — Stanford University
  - Andy K. Zhang — Stanford University
  - Caroline Meinhardt — Stanford University
  - Daniel Zhang — Stanford University
  - Kevin Klyman — Stanford University
  - Rishi Bommasani — Stanford University
  - Daniel E. Ho — Stanford University
- **Quote:** Identifies "a specification gap, an enforcement gap, and an impact gap" between transparency policy intent and actual effectiveness.
- **Why relevant:** Argues transparency policies are insufficient without enforcement mechanisms — commit-reveal directly addresses the enforcement gap.

---

## 6. Standardized Test Fairness & Item Auditing

### Dorans & Holland (1993) — DIF Detection and Description: Mantel-Haenszel and Standardization
- **Link:** https://doi.org/10.1002/j.2333-8504.1992.tb01440.x
- **Authors:**
  - Neil J. Dorans — ETS (Educational Testing Service)
  - Paul W. Holland — ETS (Educational Testing Service)
- **Quote:** "An important distinction is made between DIF and Impact."
- **Why relevant:** Foundational ETS paper on internal item bias procedures — highlights the need for external, verifiably random audit mechanisms.

### Zieky (2003) — A DIF Primer
- **Link:** https://praxis.ets.org/on/demandware.static/-/Library-Sites-ets-praxisLibrary/default/pdfs/dif-primer.pdf
- **Authors:**
  - Michael Zieky — ETS (Educational Testing Service)
- **Quote:** "Because no statistic can prove that a test question is either fair or unfair, DIF is only one of the means ETS uses to help ensure tests are as fair as possible."
- **Why relevant:** Admits DIF statistics alone cannot prove fairness, underscoring the need for procedural guarantees in the audit process.

### Zwick (2012) — A Review of ETS DIF Assessment Procedures
- **Link:** https://doi.org/10.1002/j.2333-8504.2012.tb02290.x
- **Authors:**
  - Rebecca Zwick — ETS (Educational Testing Service)
- **Quote:** "The ETS C rule often displays low DIF detection rates even when samples are large."
- **Why relevant:** Even ETS's own internal DIF flagging rules have known weaknesses, motivating independent external auditing with verifiably random item selection.

### Martinkova et al. (2017) — Checking Equity: Why DIF Analysis Should Be Routine
- **Link:** https://doi.org/10.1187/cbe.16-10-0307
- **Authors:**
  - Patricia Martinkova — Czech Academy of Sciences
  - Adela Drabinova — Czech Academy of Sciences
  - Yuan-Ling Liaw — University of Washington
  - Elizabeth A. Sanders — University of Washington
  - Jenny L. McFarland — Edmonds Community College
  - Rebecca M. Price — University of Washington
- **Quote:** "DIF analysis should be used routinely to evaluate items in developing conceptual assessments."
- **Why relevant:** A commit-reveal protocol lets external auditors select items for DIF review without the test publisher steering which items are examined.

### Saleiro et al. (2018) — Aequitas: A Bias and Fairness Audit Toolkit
- **Link:** https://arxiv.org/abs/1811.05577
- **Authors:**
  - Pedro Saleiro — University of Chicago
  - Benedict Kuester — University of Chicago
  - Loren Hinkson — University of Chicago
  - Jesse London — University of Chicago
  - Abby Stevens — University of Chicago
  - Ari Anisfeld — University of Chicago
  - Kit T. Rodolfa — University of Chicago
  - Rayid Ghani — University of Chicago
- **Quote:** "An open source bias and fairness audit toolkit that is an intuitive and easy to use addition to the machine learning workflow."
- **Why relevant:** Establishes that bias auditing should be systematic. Commit-reveal guarantees the item selection for such audits is genuinely random.

### Chen, Lee & Li (2022) — Item Pool Quality Control in Educational Testing
- **Link:** https://doi.org/10.3102/10769986211059085
- **Quote:** "In standardized educational testing, test items are reused in multiple test administrations, and the psychometric properties of items should remain unchanged over time."
- **Why relevant:** Addresses detecting compromised items in a live pool — commit-reveal ensures monitoring is applied to a tamper-proof random sample.

---

## 7. Bug Bounty Accountability & Vulnerability Disclosure

### Maillart, Zhao, Grossklags & Chuang (2017) — Given Enough Eyeballs, All Bugs Are Shallow?
- **Link:** https://arxiv.org/abs/1608.03445
- **Authors:**
  - Thomas Maillart — University of Geneva
  - Mingyi Zhao — Pennsylvania State University
  - Jens Grossklags — Technical University of Munich
  - John Chuang — University of California, Berkeley
- **Quote:** "As additional bugs become progressively harder to discover, monetary compensation struggles to increase proportionally."
- **Why relevant:** Highlights the incentive problem where vendors may downgrade severity to reduce payouts. Commit-reveal timestamps original severity assessments.

### Boucher & Anderson (2022) — Talking Trojan: Analyzing an Industry-Wide Disclosure
- **Link:** https://arxiv.org/abs/2209.10717
- **Authors:**
  - Nicholas Boucher — University of Cambridge
  - Ross Anderson — Universities of Cambridge & Edinburgh
- **Quote:** Examines "the coordinated disclosure process from discovery through public release" and documents how organizations handled the Trojan Source vulnerability inconsistently.
- **Why relevant:** Empirical evidence that organizations respond inconsistently to disclosures, with some suppressing or delaying.

### Wachs (2022) — Making Markets for Information Security
- **Link:** https://arxiv.org/abs/2204.06905
- **Authors:**
  - Johannes Wachs — Vienna University of Economics and Business; Complexity Science Hub Vienna
- **Quote:** "Centralized platforms that organize BBPs...make a market for information security vulnerabilities by reducing information asymmetries."
- **Why relevant:** Platforms like HackerOne control vulnerability data. Commit-reveal provides a trust-minimized alternative where report existence and timing are cryptographically verifiable.

### Gal-Or, Hydari & Telang (2024) — Merchants of Vulnerabilities
- **Link:** https://arxiv.org/abs/2404.17497
- **Authors:**
  - Esther Gal-Or — University of Pittsburgh, Katz Graduate School of Business
  - Muhammad Zia Hydari — University of Pittsburgh, Katz Graduate School of Business
  - Rahul Telang — Carnegie Mellon University, Heinz College
- **Quote:** "The optimal number of ethical hackers to invite to a BBP depends solely on the expected number of malicious hackers seeking exploitation."
- **Why relevant:** Demonstrates information asymmetry at the heart of bug bounty programs — vendors control disclosure timelines and severity assessments.

### Wang et al. (2025) — Incentives and Outcomes in Bug Bounties
- **Link:** https://arxiv.org/abs/2509.16655
- **Quote:** Analyzing Google's VRP after a reward increase of up to 200%, the study found that "the reward increase both redirected the attention of veteran researchers and attracted new top security researchers."
- **Why relevant:** When vendors can unilaterally adjust severity, researchers have no recourse. A commit-reveal log creates accountability for systematic downgrading.

---

## 8. Compliance Auditing & Cryptographic Accountability

### Syta et al. (2016) — Keeping Authorities "Honest or Bust" with Decentralized Witness Cosigning
- **Link:** https://arxiv.org/abs/1503.08768
- **Authors:**
  - Ewa Syta — Yale University
  - Iulia Tamas — Yale University
  - Dylan Visher — Yale University
  - David Isaac Wolinsky — Yale University
  - Philipp Jovanovic — EPFL
  - Linus Gasser — EPFL
  - Nicolas Gailly — EPFL
  - Ismail Khoffi — EPFL
  - Bryan Ford — EPFL
- **Quote:** "Every authoritative statement is validated and publicly logged by a diverse group of witnesses before any client will accept it."
- **Why relevant:** Foundational pattern for cryptographic accountability — making authoritative statements publicly witnessed and logged.

### Cao, Cong, Han, Hou & Yang (2020) — Blockchain Architecture for Auditing Automation
- **Link:** https://arxiv.org/abs/2005.07627
- **Authors:**
  - Sean Cao — Georgia State University
  - Lin William Cong — Cornell University
  - Meng Han — Kennesaw State University
  - Qixuan Hou — Georgia Institute of Technology
  - Baozhong Yang — Georgia State University
- **Quote:** The FutureAB system "automate[s] transaction verification without the need for a trusted third party by collaborating and sharing information while preserving data privacy."
- **Why relevant:** Demonstrates how cryptographic commitment schemes can replace trusted third parties in auditing.

### McMenamin, Daza, Fitzi & O'Donoghue (2022) — FairTraDEX: Preventing Value Extraction
- **Link:** https://arxiv.org/abs/2202.06384
- **Authors:**
  - Conor McMenamin — Universitat Pompeu Fabra; NOKIA Bell Labs
  - Vanesa Daza — Universitat Pompeu Fabra; CYBERCAT
  - Matthias Fitzi — IOHK
  - Padraic O'Donoghue
- **Quote:** Uses "set-membership in zero-knowledge protocols and an escrow-enforced commit-reveal protocol" to replicate safeguards typically provided by trusted third parties.
- **Why relevant:** Shows how commit-reveal prevents information-based manipulation in adversarial settings.

### Kuznetsov et al. (2024) — Scalable Zero-Knowledge Proofs for Verifying Cryptographic Hashing
- **Link:** https://arxiv.org/abs/2407.03511
- **Quote:** Proposes "a methodology for producing and verifying zero-knowledge proofs to confirm computational integrity of cryptographic hashing."
- **Why relevant:** Enables third-party verification that committed hashes were computed correctly without revealing the underlying data.

---

## 9. Papers Citing or Building on drand

### Choi, Manoj & Bonneau (2023) — SoK: Distributed Randomness Beacons
- **Link:** https://eprint.iacr.org/2023/728
- **Quote:** Compares protocols noting that "DFINITY and Drand" both use "a chain of unique signatures" and includes drand as a deployed system in its taxonomy.
- **Why relevant:** Comprehensive SoK that classifies drand among deployed randomness beacon systems and evaluates its security properties.

### Kavousi, Wang & Jovanovic (2023) — SoK: Public Randomness
- **Link:** https://eprint.iacr.org/2023/1121
- **Quote:** Discusses drand as a deployed instance of threshold-BLS-based public randomness. Co-author Philipp Jovanovic is a co-creator of drand.
- **Why relevant:** Broad survey situating drand within the wider landscape of public randomness generation.

### Bacho, Lenzen, Loss, Ochsenreither & Papachristoudis (2024) — GRandLine: Adaptively Secure DKG and Randomness Beacon
- **Link:** https://doi.org/10.1145/3658644.3690287 (also https://eprint.iacr.org/2023/1887)
- **Quote:** "We compare our protocol to the state-of-the-art randomness beacon protocols OptRand, BRandPiper, and Drand, and observe that it vastly outperforms them."
- **Why relevant:** Uses drand as the production-grade baseline against which new randomness beacon protocols are measured.

### Das, Krishnan, Isaac & Ren (2022) — SPURT: Scalable Distributed Randomness Beacon with Transparent Setup
- **Link:** https://doi.org/10.1109/SP46214.2022.9833580 (also https://eprint.iacr.org/2021/100)
- **Quote:** "We chose Drand as it has been deployed." Notes SPURT has "5x higher bandwidth usage than Drand" but removes the need for DKG.
- **Why relevant:** Directly benchmarks against drand and acknowledges it as the key deployed system in the field.

### Raikwar & Gligoroski (2022) — SoK: Decentralized Randomness Beacon Protocols
- **Link:** https://doi.org/10.1007/978-3-031-22301-3_21 (also https://arxiv.org/abs/2205.13333)
- **Quote:** Classifies drand among threshold-signature-based beacon protocols and evaluates it against formal security definitions of "Unpredictability, Bias-resistance, Availability, and Public Verifiability."
- **Why relevant:** Systematization of knowledge paper that evaluates drand's security properties against formal definitions.

### Choi, Arun, Tyagi & Bonneau (2023) — Bicorn: An Optimistically Efficient Distributed Randomness Beacon
- **Link:** https://doi.org/10.1007/978-3-031-47754-6_14 (also https://eprint.iacr.org/2023/221)
- **Quote:** Bicorn is a "commit-reveal-recover" protocol positioned as an alternative to threshold-BLS approaches like drand that require expensive DKG setup.
- **Why relevant:** Proposes a simpler alternative to drand, explicitly comparing against drand's setup requirements and trust model.

### Han, Lin & Yu (2020) — RandChain: A Scalable and Fair Decentralised Randomness Beacon
- **Link:** https://eprint.iacr.org/2020/1033
- **Quote:** Existing DRBs including drand require "at least O(n^2) communication complexity without trusted party."
- **Why relevant:** Uses drand's collaborative model as the baseline to improve upon in terms of scalability.

### Dharanikota et al. (2020) — Breeding Unicorns: Developing Trustworthy and Scalable Randomness Beacons
- **Link:** https://doi.org/10.1371/journal.pone.0232261
- **Quote:** "The standalone drand randomness beacon uses essentially the same approach, with a set of participants threshold-BLS-signing a counter in each round."
- **Why relevant:** Directly describes drand's threshold-BLS mechanism and compares it to VDF-based alternative designs.

### Bonneau, Bunz, Christ & Efron (2024) — How Much Public Randomness Do Modern Consensus Protocols Need?
- **Link:** https://eprint.iacr.org/2024/1794
- **Quote:** Proves tight bounds: "no consensus protocol can simultaneously be efficient, be adaptively secure, and use O(log n) bits of beacon entropy."
- **Why relevant:** Studies the theoretical limits of how much randomness from beacons like drand is needed, directly relevant to drand's role in production systems.
