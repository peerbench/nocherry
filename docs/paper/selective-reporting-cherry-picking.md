# Selective Reporting and Cherry-Picking in Science

Background literature review for the NoCherry commit-reveal protocol paper. This section motivates the protocol by documenting cherry-picking as a **structural** problem in science -- one that voluntary reforms like preregistration cannot fully solve, and that therefore requires cryptographic enforcement.

---

## 1. The Foundational Problem: Cherry-Picking and Selective Reporting

Selective reporting -- the practice of choosing which results, outcomes, or data subsets to present based on their favorability -- is not a marginal pathology of bad actors. It is a predictable consequence of incentive structures that reward positive, novel, statistically significant findings.

### Sterling (1959) -- Publication Decisions and Their Possible Effects on Inferences Drawn from Tests of Significance -- or Vice Versa

- **Authors:**
  - Theodore D. Sterling -- Tulane University
- **Link:** https://doi.org/10.1080/01621459.1959.10501497
- **Quote:** Of 294 articles published across four major psychology journals, 97% reported statistically significant results -- raising the question of where all the negative results had gone.
- **Why relevant:** The earliest systematic documentation of publication bias. Sterling identified the structural incentive problem over six decades ago: when journals preferentially publish significant results, the published literature becomes a biased sample of all research conducted. The commit-reveal protocol addresses an analogous problem -- when data holders choose which items to reveal, the revealed subset is a biased sample of all data held.

### Kerr (1998) -- HARKing: Hypothesizing After the Results Are Known

- **Authors:**
  - Norbert L. Kerr -- Michigan State University
- **Link:** https://doi.org/10.1207/s15327957pspr0203_4
- **Quote:** HARKing is "presenting a post hoc hypothesis (i.e., one based on or informed by one's results) in one's research report as if it were, in fact, an a priori hypothesis."
- **Why relevant:** Coined the term HARKing and formalized the distinction between prediction and postdiction. HARKing is the intellectual analog of what the commit-reveal protocol prevents mechanically: retroactively claiming that a data selection was planned when it was actually chosen after seeing the data.

### Fanelli (2009) -- How Many Scientists Fabricate and Falsify Research? A Systematic Review and Meta-Analysis of Survey Data

- **Authors:**
  - Daniele Fanelli -- INNOGEN and ISSTI, University of Edinburgh
- **Link:** https://doi.org/10.1371/journal.pone.0005738
- **Quote:** "Up to 33.7% admitted other questionable research practices" beyond outright fabrication, and "up to 72% [of colleagues] for other questionable research practices."
- **Why relevant:** Establishes that questionable research practices -- including selective reporting -- are not rare aberrations but are practiced by a substantial fraction of working scientists. This prevalence makes voluntary reform insufficient; the problem requires structural constraints on what can be selectively disclosed.

### John, Loewenstein & Prelec (2012) -- Measuring the Prevalence of Questionable Research Practices With Incentives for Truth Telling

- **Authors:**
  - Leslie K. John -- Harvard Business School
  - George Loewenstein -- Carnegie Mellon University
  - Drazen Prelec -- MIT Sloan School of Management
- **Link:** https://doi.org/10.1177/0956797611430953
- **Quote:** In a survey of over 2,000 psychologists with incentives for honest disclosure, 66.5% admitted failing to report all dependent measures, 58% admitted collecting more data after checking significance, and 50% admitted selectively reporting studies that "worked."
- **Why relevant:** Provides the most direct empirical evidence that selective reporting is the **norm**, not the exception, in research practice. When a majority of researchers admit to cherry-picking results, the problem is clearly structural rather than a matter of individual ethics -- and structural problems demand structural solutions.

### Wicherts, Veldkamp, Augusteijn, Bakker, van Aert & van Assen (2016) -- Degrees of Freedom in Planning, Running, Analyzing, and Reporting Psychological Studies: A Checklist to Avoid p-Hacking

- **Authors:**
  - Jelte M. Wicherts -- Tilburg University
  - Coosje L. S. Veldkamp -- Tilburg University
  - Hilde E. M. Augusteijn -- Tilburg University
  - Marjan Bakker -- Tilburg University
  - Robbie C. M. van Aert -- Tilburg University
  - Marcel A. L. M. van Assen -- Tilburg University; Utrecht University
- **Link:** https://doi.org/10.3389/fpsyg.2016.01832
- **Quote:** Identifies "34 degrees of freedom that researchers have in formulating hypotheses, and in designing, running, analyzing, and reporting of psychological research."
- **Why relevant:** Catalogues the enormous space of undisclosed choices available to researchers. Each degree of freedom is an opportunity for cherry-picking. The commit-reveal protocol eliminates the most fundamental degree of freedom in data disclosure: **which items to reveal**.

---

## 2. Outcome Switching in Clinical Trials -- Cherry-Picking with Life-or-Death Consequences

Clinical trials represent the highest-stakes instance of selective reporting. When trialists switch which outcomes they report based on significance, the resulting literature can guide clinicians toward ineffective or harmful treatments.

### Chan, Hrobjartsson, Haahr, Gotzsche & Altman (2004) -- Empirical Evidence for Selective Reporting of Outcomes in Randomized Trials: Comparison of Protocols to Published Articles

- **Authors:**
  - An-Wen Chan -- Centre for Statistics in Medicine, University of Oxford
  - Asbjorn Hrobjartsson -- Nordic Cochrane Centre, Copenhagen
  - Mette T. Haahr -- Nordic Cochrane Centre, Copenhagen
  - Peter C. Gotzsche -- Nordic Cochrane Centre, Copenhagen
  - Douglas G. Altman -- Centre for Statistics in Medicine, University of Oxford
- **Link:** https://doi.org/10.1001/jama.291.20.2457
- **Quote:** By comparing trial protocols with published reports, found that "the odds of a statistically significant outcome being fully reported were 2.4 times the odds of a non-significant outcome being fully reported."
- **Why relevant:** The landmark empirical demonstration that outcome reporting in clinical trials is systematically biased toward significance. This is cherry-picking at its most consequential: the selection of which outcomes to report is driven by the results themselves. A commit-reveal protocol applied to trial outcomes would make such switching detectable.

### Mathieu, Boutron, Moher, Altman & Ravaud (2009) -- Comparison of Registered and Published Primary Outcomes in Randomized Controlled Trials

- **Authors:**
  - Sylvain Mathieu -- INSERM U738, Universite Paris Diderot
  - Isabelle Boutron -- INSERM U738, Universite Paris Diderot
  - David Moher -- Ottawa Hospital Research Institute
  - Douglas G. Altman -- Centre for Statistics in Medicine, University of Oxford
  - Philippe Ravaud -- INSERM U738, Universite Paris Diderot
- **Link:** https://doi.org/10.1001/jama.2009.1242
- **Quote:** Found that "31% of trials had a discrepancy between the registered and published primary outcome" even after mandatory trial registration was introduced.
- **Why relevant:** Demonstrates that **even mandatory registration does not prevent outcome switching**. Researchers can and do deviate from their registered plans without disclosure. This is the critical limitation of preregistration that cryptographic commitment addresses: registration creates a record of intent, but nothing enforces fidelity to that intent.

### Goldacre, Drysdale, Dale, Milosevic, Slade, Hartley, Marston, Powell-Smith & Heneghan (2019) -- COMPare: A Prospective Cohort Study Correcting and Monitoring 58 Misreported Trials in Real Time

- **Authors:**
  - Ben Goldacre -- Centre for Evidence-Based Medicine, University of Oxford
  - Henry Drysdale -- Centre for Evidence-Based Medicine, University of Oxford
  - Aaron Dale -- Centre for Evidence-Based Medicine, University of Oxford
  - Ioan Milosevic -- Centre for Evidence-Based Medicine, University of Oxford
  - Eirion Slade -- Centre for Evidence-Based Medicine, University of Oxford
  - Philip Hartley -- Centre for Evidence-Based Medicine, University of Oxford
  - Cicely Marston -- London School of Hygiene and Tropical Medicine
  - Anna Powell-Smith -- Centre for Evidence-Based Medicine, University of Oxford
  - Carl Heneghan -- Centre for Evidence-Based Medicine, University of Oxford
- **Link:** https://doi.org/10.1186/s13063-019-3173-2
- **Quote:** Of 67 trials published in the five highest-impact medical journals (NEJM, Lancet, JAMA, BMJ, Annals), only 9 were perfectly reported. The remaining 58 had 301 unreported pre-specified outcomes and 357 silently added new outcomes.
- **Why relevant:** The most damning real-time audit of outcome switching ever conducted, targeting the world's most prestigious medical journals. Despite CONSORT guidelines, ICMJE registration requirements, and editorial oversight, 87% of trials were misreported. This demonstrates that **monitoring and guidelines alone are insufficient** -- the incentive to cherry-pick overwhelms voluntary compliance mechanisms.

---

## 3. Publication Bias and the File Drawer Problem

Cherry-picking operates not only within individual studies (selective reporting of outcomes) but across the literature as a whole (selective publication of studies).

### Franco, Malhotra & Simonovits (2014) -- Publication Bias in the Social Sciences: Unlocking the File Drawer

- **Authors:**
  - Annie Franco -- Stanford University
  - Neil Malhotra -- Stanford University
  - Gabor Simonovits -- Stanford University (now Central European University)
- **Link:** https://doi.org/10.1126/science.1255484
- **Quote:** "Of the studies producing null results, only 10 out of 48 (20.8%) were published, whereas 56 out of 91 (61.5%) strong results were published." Fully half of all conducted studies were never written up.
- **Why relevant:** Provides direct evidence of the file drawer effect using a known population of conducted studies (TESS program). This is cherry-picking at the study level: the published literature is a biased sample of all research conducted. The commit-reveal protocol addresses the analogous problem where disclosed data is a biased sample of all data held.

---

## 4. The Replication Crisis -- Empirical Proof That Cherry-Picking Produces Unreliable Science

The ultimate consequence of widespread selective reporting is a literature full of findings that do not replicate.

### Open Science Collaboration (2015) -- Estimating the Reproducibility of Psychological Science

- **Authors:**
  - Open Science Collaboration (270 co-authors), coordinated by Brian A. Nosek -- University of Virginia; Center for Open Science
- **Link:** https://doi.org/10.1126/science.aac4716
- **Quote:** "Ninety-seven percent of original studies had statistically significant results (p < .05), whereas only 36% of replications had statistically significant results." Replication effect sizes were on average half the magnitude of original effects.
- **Why relevant:** The landmark replication study. The gap between original claims (97% significant) and replications (36% significant) is a direct measurement of the cumulative damage caused by selective reporting, p-hacking, and publication bias. If the original results had been drawn from committed, randomly-selected analyses rather than researcher-optimized ones, the replication rate would be far higher.

### Camerer, Dreber, Holzmeister et al. (2018) -- Evaluating the Replicability of Social Science Experiments in Nature and Science Between 2010 and 2015

- **Authors:**
  - Colin F. Camerer -- California Institute of Technology
  - Anna Dreber -- Stockholm School of Economics
  - Felix Holzmeister -- University of Innsbruck
  - (18 additional co-authors from institutions across Europe and the US)
- **Link:** https://doi.org/10.1038/s41562-018-0399-z
- **Quote:** "A significant effect in the same direction as the original study was found for 13 (62%) of the 21 replications, and the effect size of the replications was on average about 50% of the original effect size."
- **Why relevant:** Extends the replication crisis to elite journals (Nature and Science). Even studies that pass the highest editorial bars show inflated effects and frequent non-replication, confirming that the problem is structural, not limited to low-quality venues.

---

## 5. Preregistration as a Partial Solution -- and Its Structural Limitations

Preregistration -- publicly recording a study plan before data collection -- is the scientific community's primary response to selective reporting. It is a significant step forward, but it has fundamental limitations that motivate cryptographic alternatives.

### van 't Veer & Giner-Sorolla (2016) -- Pre-registration in Social Psychology: A Discussion and Suggested Template

- **Authors:**
  - Anna E. van 't Veer -- Leiden University
  - Roger Giner-Sorolla -- University of Kent
- **Link:** https://doi.org/10.1016/j.jesp.2016.03.004
- **Quote:** "Selective reporting, failure to follow the preregistration, or multiple preregistrations of the same study are not precluded by preregistration alone."
- **Why relevant:** The authors -- who advocate for preregistration -- explicitly identify its core vulnerability: **nothing prevents researchers from deviating from or abandoning their preregistered plan**. The plan is a promise, not a constraint. A commit-reveal protocol converts the promise into a cryptographic binding: the committed data cannot be swapped after the randomness determines what must be revealed.

### Claesen, Gomes, Tuerlinckx & Vanpaemel (2021) -- Comparing Dream to Reality: An Assessment of Adherence of the First Generation of Preregistered Studies

- **Authors:**
  - Aline Claesen -- KU Leuven
  - Sara Gomes -- KU Leuven
  - Francis Tuerlinckx -- KU Leuven
  - Wolf Vanpaemel -- KU Leuven
- **Link:** https://doi.org/10.1098/rsos.211037
- **Quote:** Only 2 of 27 preregistered studies in Psychological Science contained no deviations from the registered plan. Nine studies disclosed none of their deviations.
- **Why relevant:** The most direct empirical test of whether preregistration works as intended. The answer: it mostly does not. Researchers deviate routinely and fail to disclose deviations. This is not because researchers are dishonest -- it is because preregistration relies on voluntary compliance in a high-pressure incentive environment. This finding is the strongest empirical motivation for cryptographic enforcement of data commitments.

### Pham & Oh (2021) -- Preregistration Is Neither Sufficient nor Necessary for Good Science

- **Authors:**
  - Michel Tuan Pham -- Columbia Business School
  - Travis Tae Oh -- Columbia Business School
- **Link:** https://doi.org/10.1002/jcpy.1209
- **Quote:** Argues that preregistration "does not necessarily solve the problems it aims to address and causes additional problems, including raising costs for more junior and less resourced scholars."
- **Why relevant:** Identifies the structural limitations of preregistration from an epistemological perspective. Preregistration is a social contract, and social contracts are only as strong as the willingness and ability to enforce them. The commit-reveal protocol replaces social trust with cryptographic proof.

---

## 6. Registered Reports -- Peer Review Before Results

Registered Reports represent the strongest institutional reform to date: journals review and pre-accept study methods before data collection, removing the incentive to cherry-pick results.

### Chambers (2013) -- Registered Reports: A New Publishing Initiative at Cortex

- **Authors:**
  - Christopher D. Chambers -- Cardiff University
- **Link:** https://doi.org/10.1016/j.cortex.2012.12.016
- **Quote:** Introduced the Registered Reports format where "a detailed research plan is peer-reviewed and accepted in principle for publication before collection of primary data begins."
- **Why relevant:** Founded the Registered Reports movement. The format attacks publication bias by decoupling the publication decision from the results. However, it applies only to prospective research within participating journals -- it cannot verify claims about existing datasets, historical benchmarks, or proprietary data holdings, which is the domain where commit-reveal operates.

### Nosek & Lakens (2014) -- Registered Reports: A Method to Increase the Credibility of Published Results

- **Authors:**
  - Brian A. Nosek -- University of Virginia; Center for Open Science
  - Daniel Lakens -- Eindhoven University of Technology
- **Link:** https://doi.org/10.1027/1864-9335/a000192
- **Quote:** Described Registered Reports as a format where "the introduction and methods are peer-reviewed before data collection commences, after which authors can receive an in-principle acceptance."
- **Why relevant:** Articulates the core logic of Registered Reports: commitment before data eliminates the ability to cherry-pick results. The commit-reveal protocol implements this same logic cryptographically, extending it beyond academic journals to any domain where a data holder must demonstrate that a disclosed subset was not selectively chosen.

### Scheel, Schijen & Lakens (2021) -- An Excess of Positive Results: Comparing the Standard Psychology Literature With Registered Reports

- **Authors:**
  - Anne M. Scheel -- Eindhoven University of Technology
  - Mitchell R. M. J. Schijen -- Eindhoven University of Technology
  - Daniel Lakens -- Eindhoven University of Technology
- **Link:** https://doi.org/10.1177/25152459211007467
- **Quote:** Found "96% positive results in standard reports but only 44% positive results in Registered Reports" -- a 52 percentage-point gap.
- **Why relevant:** The single most compelling piece of evidence that selective reporting inflates positive results in the standard literature. When the opportunity to cherry-pick is removed (via Registered Reports), the rate of positive findings drops by more than half. This 96%-vs-44% contrast quantifies the damage cherry-picking does and demonstrates that removing the ability to selectively report transforms the output distribution. The commit-reveal protocol achieves an analogous transformation for data disclosure.

### Chambers & Tzavella (2022) -- The Past, Present and Future of Registered Reports

- **Authors:**
  - Christopher D. Chambers -- Cardiff University
  - Loukia Tzavella -- Cardiff University
- **Link:** https://doi.org/10.1038/s41562-021-01193-7
- **Quote:** "Registered Reports are a form of empirical publication in which study proposals are peer reviewed and pre-accepted before research is undertaken, offering a remedy for a range of reporting and publication biases."
- **Why relevant:** The most comprehensive review of the Registered Reports movement, documenting its adoption across 300+ journals. While celebrating its success, the paper implicitly highlights its scope limitation: Registered Reports work within the journal system for prospective studies. They do not cover retrospective claims, proprietary data audits, or domains outside academic publishing -- the gaps that cryptographic commit-reveal fills.

---

## 7. Synthesis: Why Voluntary Solutions Are Insufficient and Cryptographic Enforcement Is Needed

The literature above reveals a consistent pattern:

1. **Cherry-picking is structural, not individual.** When incentives reward favorable results, a majority of researchers engage in selective reporting (John et al. 2012; Fanelli 2009). The problem is not bad actors but rational actors in a poorly designed system.

2. **Voluntary reforms help but do not solve the problem.** Preregistration is widely circumvented (Claesen et al. 2021). Outcome switching persists even after mandatory trial registration (Mathieu et al. 2009; Goldacre et al. 2019). The 34 researcher degrees of freedom identified by Wicherts et al. (2016) cannot all be constrained by guidelines.

3. **The damage is measurable.** The replication crisis (Open Science Collaboration 2015; Camerer et al. 2018) and the 96%-vs-44% positive result gap between standard and Registered Reports (Scheel et al. 2021) quantify the distortion that selective reporting introduces.

4. **Institutional solutions have limited scope.** Registered Reports work within the journal system for prospective research (Chambers & Tzavella 2022). They cannot verify claims about data that already exists -- AI benchmark results, training data manifests, test question pools, compliance records -- where the data holder controls what is disclosed.

The commit-reveal protocol addresses the gap that voluntary solutions cannot fill. By requiring cryptographic commitment to data before external randomness determines what must be revealed, it converts the social norm of honest reporting into a **verifiable cryptographic guarantee**. The data holder cannot:
- Choose which items to reveal (selection is determined by the randomness beacon)
- Alter committed data after seeing the selection (hash commitments are binding)
- Claim commitment was made at a different time (temporal ordering is beacon-anchored)

This is not a replacement for preregistration or Registered Reports -- it is the enforcement layer they lack. Where those reforms say "you should commit to your analysis plan," the commit-reveal protocol says "you **have** committed to your data, and the randomness that selects what you reveal is beyond your control."
