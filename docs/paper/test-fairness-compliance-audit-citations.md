# Test Fairness & Compliance Audit Sampling: Additional Citations

Additional references for the "Standardized Test Fairness and Item Auditing" and "Compliance Audit Sampling" sections. These supplement the existing citations in `docs/publication-citations.md` (Dorans & Holland 1993, Zieky 2003, Zwick 2012, Martinkova et al. 2017, Saleiro et al. 2018, Chen/Lee/Li 2022, Syta et al. 2016, Cao et al. 2020, McMenamin et al. 2022).

---

## 1. Modern DIF Analysis Methods

### Magis, Beland, Tuerlinckx & De Boeck (2010) — A General Framework and an R Package for the Detection of Dichotomous Differential Item Functioning

- **Link:** https://doi.org/10.3758/BRM.42.3.847
- **Authors:**
  - David Magis — University of Liege
  - Sebastien Beland — University of Montreal
  - Francis Tuerlinckx — KU Leuven
  - Paul De Boeck — KU Leuven; University of Amsterdam
- **Quote:** "The difR package provides a general framework for the detection of dichotomous DIF, integrating nine methods including the Mantel-Haenszel, logistic regression, SIBTEST, and Lord's chi-squared approaches."
- **Why relevant:** Provides the computational toolkit for the DIF analyses that fairness review boards would run on beacon-selected item samples. Demonstrates that DIF detection is mature and automatable -- the bottleneck is which items get reviewed, not how to review them. Commit-reveal addresses the item selection bottleneck.

### Lim, Zhu, Choe & Han (2024) — Detecting Differential Item Functioning among Multiple Groups Using IRT Residual DIF Framework

- **Link:** https://doi.org/10.1111/jedm.12415
- **Authors:**
  - Hwanggyu Lim — Inha University
  - Danqi Zhu — University of Iowa
  - Edison M. Choe — University of Iowa
  - Kyung Chris T. Han — Graduate Management Admission Council
- **Quote:** "The GRDIF framework demonstrated well-controlled Type I error rates close to the nominal level of .05 and satisfactory power in detecting uniform, nonuniform, and mixed DIF across different simulated conditions."
- **Why relevant:** State-of-the-art DIF detection that extends to multiple demographic groups simultaneously. Modern methods like GRDIF can detect subtle bias patterns that older techniques miss -- but only if the items reviewed are randomly selected rather than curated by the test maker.

---

## 2. Test Security and Item Exposure Control

### van der Linden & Veldkamp (2007) — Conditional Item-Exposure Control in Adaptive Testing Using Item-Ineligibility Probabilities

- **Link:** https://doi.org/10.3102/1076998606298044
- **Authors:**
  - Wim J. van der Linden — University of Twente
  - Bernard P. Veldkamp — University of Twente
- **Quote:** "A method of conditional item-exposure control is proposed that constrains the probabilities of exposure of the items conditional on the ability level of the examinee."
- **Why relevant:** Demonstrates that testing organizations already maintain sophisticated control over which items are exposed to which examinees. The same infrastructure that controls item exposure to test-takers could be adapted for commit-reveal-based exposure to fairness auditors -- the organization commits item pool hashes, and a beacon selects which items are revealed for review.

### van der Linden (2005) — Linear Models for Optimal Test Design

- **Link:** https://doi.org/10.1007/0-387-29054-0
- **Authors:**
  - Wim J. van der Linden — University of Twente
- **Quote:** Comprehensive treatment of optimal test assembly under constraints including "content balancing, exposure control, and enemy item constraints."
- **Why relevant:** The authoritative reference on how test organizations design item selection under operational constraints. Establishes that item pools are large, structured, and algorithmically managed -- precisely the kind of system where the data holder has both the capability and incentive to steer which items external reviewers see.

### Chung & Veldkamp (2023) — Item Exposure and Utilization Control Methods for Optimal Test Assembly

- **Link:** https://doi.org/10.1007/s41237-023-00214-1
- **Authors:**
  - Meichu Chung — University of Twente
  - Bernard P. Veldkamp — University of Twente
- **Quote:** "Exposure control is often used to secure test content by preventing item overexposure, and also to balance item utilization by avoiding item underexposure."
- **Why relevant:** Recent survey of exposure control methods confirming that test organizations actively manage which items are seen. This same management capability means they can selectively present well-vetted items to fairness reviewers -- commit-reveal removes this discretion.

---

## 3. External vs. Internal Fairness Review

### AERA, APA & NCME (2014) — Standards for Educational and Psychological Testing

- **Link:** https://www.testingstandards.net/uploads/7/6/6/4/76643089/standards_2014edition.pdf (ISBN 978-0-935302-35-6)
- **Authors:**
  - American Educational Research Association
  - American Psychological Association
  - National Council on Measurement in Education
- **Quote:** "Fairness is a fundamental validity concern that requires attention throughout all stages of test development and use."
- **Why relevant:** The authoritative professional standard mandating fairness review in testing. Chapter 3 on fairness establishes the professional obligation but does not specify how the item sample for review should be selected -- leaving the test maker to choose. Commit-reveal fills this procedural gap by making item selection verifiably random and externally auditable.

### Groves, Metcalf, Kennedy, Vecchione & Strait (2024) — Auditing Work: Exploring the New York City Algorithmic Bias Audit Regime

- **Link:** https://doi.org/10.1145/3630106.3658959
- **Authors:**
  - Lara Groves — Ada Lovelace Institute
  - Jacob Metcalf — Data & Society Research Institute
  - Alayna Kennedy — Independent Researcher
  - Briana Vecchione — Data & Society Research Institute
  - Andrew Strait — Ada Lovelace Institute
- **Quote:** "LL 144 has failed to create an effective auditing regime: the law fails to clearly define key aspects like AEDTs and what constitutes an independent auditor."
- **Why relevant:** Best Paper at FAccT 2024. Provides direct empirical evidence that even when audits are legally mandated, the audited entity retains discretion over scope and evidence -- exactly the problem commit-reveal addresses. The lesson generalizes from algorithmic auditing to test fairness auditing: mandating review without controlling evidence selection produces compliance theater.

---

## 4. Statistical Audit Sampling Theory

### Elder, Akresh, Glover, Higgs & Liljegren (2013) — Audit Sampling Research: A Synthesis and Implications for Future Research

- **Link:** https://doi.org/10.2308/ajpt-50394
- **Authors:**
  - Randal J. Elder — Syracuse University
  - Abraham D. Akresh — CPA/CGFM
  - Steven M. Glover — Brigham Young University
  - Julia L. Higgs — Florida Atlantic University
  - Jonathan Liljegren — Freddie Mac
- **Quote:** "Important judgments include determining if sampling applies, what type of sampling to apply, whether to use statistical or nonstatistical techniques, appropriate inputs to determine sample size, and evaluation of results."
- **Why relevant:** The definitive synthesis of audit sampling research. Documents the fundamental tension in audit sampling: auditing standards permit both statistical (random) and nonstatistical (judgmental) sampling, and the audited entity often influences which items are convenient to examine. Commit-reveal resolves this by making the selection verifiably random and independent of the auditee.

### Hall, Higson, Pierce, Price & Skousen (2013) — Haphazard Sampling: Selection Biases and the Estimation Consequences of These Biases

- **Link:** https://doi.org/10.2308/ciia-50568
- **Authors:**
  - Thomas W. Hall — University of North Carolina Wilmington
  - Andrew W. Higson — Loughborough University
  - Bethane Jo Pierce — University of Southern Indiana
  - Kenneth H. Price — University of Montana
  - Christopher J. Skousen — Utah State University
- **Quote:** "The properties of haphazard samples differ substantially from those of random samples, and estimates derived from haphazard samples tend to exhibit unpredictable error."
- **Why relevant:** Directly demonstrates that non-random audit sampling introduces systematic bias. Auditors using "haphazard" (human-selected) sampling are influenced by visual salience, page position, and listing characteristics. This is the audit-domain equivalent of cherry-picking -- commit-reveal replaces haphazard selection with cryptographically verifiable random selection.

### Chernoff (1972) — Sequential Analysis and Optimal Design

- **Link:** https://doi.org/10.1137/1.9781611970593
- **Authors:**
  - Herman Chernoff — MIT; Stanford University
- **Quote:** "The interrelated fields of design of experiments and sequential analysis" provide the theoretical foundation for "the philosophy and practice of statistics" in sequential decision-making.
- **Why relevant:** Foundational statistical theory for sequential sampling decisions -- the mathematical basis for determining how many items must be sampled to achieve a given confidence level. Commit-reveal uses this theory to calibrate reveal percentages: a 5% random sample of 20,000 SAT items yields 1,000 items, sufficient for DIF analysis at standard power levels.

---

## 5. SOC 2 / ISO 27001 Audit Methodology

### DeFond & Lennox (2011) — The Effect of SOX on Small Auditor Exits and Audit Quality

- **Link:** https://doi.org/10.1016/j.jacceco.2011.03.002
- **Authors:**
  - Mark L. DeFond — University of Southern California, Marshall School of Business
  - Clive S. Lennox — University of Bath, School of Management (now Nanyang Technological University)
- **Quote:** "Over six hundred auditors with fewer than 100 SEC clients exit the market following SOX. Compared to the non-exiting auditors, the exiting auditors are lower quality."
- **Why relevant:** Demonstrates that regulatory oversight (SOX/PCAOB inspections) improves audit quality by removing low-quality auditors. However, the paper also shows that the *mechanism* matters -- inspections work because they are externally imposed, not self-selected. Commit-reveal extends this principle to evidence selection: the company cannot curate which merge events, access logs, or incident records the auditor examines.

### Wright, Muenster, Vecchione, Qu, Cai, Smith & Matias (2024) — Null Compliance: NYC Local Law 144 and the Challenges of Algorithm Accountability

- **Link:** https://doi.org/10.1145/3630106.3658998
- **Authors:**
  - Lucas Wright — Citizens and Technology Lab, Cornell University
  - Roxana Mika Muenster — Department of Communication, Cornell University
  - Briana Vecchione — Data & Society Research Institute
  - Tianyao Qu — Department of Sociology, Cornell University
  - Pika (Senhuang) Cai — Department of Information Science, Cornell University
  - Alan Smith — Consumer Reports
  - J. Nathan Matias — Citizens and Technology Lab, Cornell University
- **Quote:** "Null compliance describes a situation in which non-compliance cannot be ascertained... LL 144 requires an audit, but is silent on the results of that audit."
- **Why relevant:** Empirical study finding that among 391 employers subject to NYC's algorithmic bias audit mandate, only 18 posted audit reports. Demonstrates that compliance regimes fail when the audited entity controls evidence disclosure. Directly parallels SOC 2 audits where the company selects which evidence to present -- commit-reveal makes non-disclosure visible by creating a committed record against which omissions can be detected.

---

## 6. Cryptographic Audit Trails

### Crosby & Wallach (2009) — Efficient Data Structures for Tamper-Evident Logging

- **Link:** https://www.usenix.org/conference/usenixsecurity09/technical-sessions/presentation/efficient-data-structures-tamper-evident
- **Authors:**
  - Scott A. Crosby — Rice University
  - Dan S. Wallach — Rice University
- **Quote:** "Where a classic hash chain might require an 800 MB trace to prove that a randomly chosen event is in a log with 80 million events, our prototype returns a 3 KB proof with the same semantics."
- **Why relevant:** Foundational work on Merkle-tree-based tamper-evident logging. The data structure enables efficient proof that a specific log entry existed at commitment time -- the cryptographic primitive underlying commit-reveal's ability to prove that a merge event or access log was committed before the beacon selected it for audit review.

### Schneier & Kelsey (1999) — Secure Audit Logs to Support Computer Forensics

- **Link:** https://doi.org/10.1145/317087.317089
- **Authors:**
  - Bruce Schneier — Counterpane Systems
  - John Kelsey — Counterpane Systems
- **Quote:** "We describe a computationally cheap method for making all log entries generated prior to the compromise of the system impossible for the attacker to read, and also impossible to undetectably modify or destroy."
- **Why relevant:** Early work on cryptographically secured audit logs using hash chains. Establishes the principle that log integrity must be maintained even when the system generating the logs is compromised -- directly applicable to compliance auditing where the company (the "system") controls the logs that the auditor must verify.

---

## 7. Algorithmic Auditing

### Raji, Smart, White, Mitchell, Gebru, Hutchinson, Smith-Loud, Theron & Barnes (2020) — Closing the AI Accountability Gap: Defining an End-to-End Framework for Internal Algorithmic Auditing

- **Link:** https://doi.org/10.1145/3351095.3372873
- **Authors:**
  - Inioluwa Deborah Raji — University of Toronto
  - Andrew Smart — Google
  - Rebecca N. White — Google
  - Margaret Mitchell — Google
  - Timnit Gebru — Google
  - Ben Hutchinson — Google
  - Jamila Smith-Loud — Google
  - Daniel Theron — Google
  - Parker Barnes — Google
- **Quote:** "While external audits have become common, it remains challenging for practitioners to identify the harmful repercussions of their own systems prior to deployment, and once deployed, emergent issues can become difficult or impossible to trace back to their source."
- **Why relevant:** Defines the internal algorithmic audit framework (SMACTR) and documents the gap between internal and external auditing. The paper highlights that internal audits are necessary but insufficient because the auditing organization controls scope and evidence. Commit-reveal addresses this for any domain where the audited party selects what reviewers see.

### Lam, Lange, Blili-Hamelin, Davidovic, Brown & Hasan (2024) — A Framework for Assurance Audits of Algorithmic Systems

- **Link:** https://doi.org/10.1145/3630106.3658957
- **Authors:**
  - Khoa Lam — BABL AI
  - Benjamin Lange — BABL AI; University of Bonn
  - Borhane Blili-Hamelin — BABL AI
  - Jovana Davidovic — BABL AI; University of Iowa
  - Shea Brown — BABL AI
  - Ali Hasan — BABL AI; Tufts University
- **Quote:** "We propose the criterion audit... modeling elements of this approach after financial auditing practices, and argue that AI audits should similarly provide assurance to their stakeholders."
- **Why relevant:** Bridges financial auditing methodology and algorithmic auditing. The paper explicitly models algorithm audits on financial audit assurance practices -- the same domain where commit-reveal improves evidence selection. Their framework assumes the auditor can request evidence; commit-reveal ensures the evidence request is random and verifiable rather than negotiated.

### Sandvig, Hamilton, Karahalios & Langbort (2014) — Auditing Algorithms: Research Methods for Detecting Discrimination on Internet Platforms

- **Link:** https://websites.umich.edu/~csandvig/research/Auditing%20Algorithms%20--%20Sandvig%20--%20ICA%202014%20Data%20and%20Discrimination%20Preconference.pdf
- **Authors:**
  - Christian Sandvig — University of Michigan
  - Kevin Hamilton — University of Illinois at Urbana-Champaign
  - Karrie Karahalios — University of Illinois at Urbana-Champaign
  - Cedric Langbort — University of Illinois at Urbana-Champaign
- **Quote:** "Algorithm auditing allows researchers to understand algorithms 'from the outside,' testing them for problems and harms without cooperation from online platform providers."
- **Why relevant:** The foundational paper defining "algorithm audit" as a research methodology. Introduces the critical distinction between audits that require cooperation from the system operator and those that do not. Commit-reveal occupies a middle ground: the data holder cooperates by committing hashes, but cannot control which items are selected for review -- achieving auditability without full transparency.
