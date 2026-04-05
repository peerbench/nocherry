# LLM Training Data Provenance and Copyright Accountability -- Additional Citations

Citations for the commit-reveal protocol applied to LLM training data transparency.
These supplement the existing references (Gebru et al., Mitchell et al., Longpre et al. 2024,
Duan et al. 2024, Freeman et al. 2024, Kyrychenko et al. 2025, Shen et al. 2026).

---

## 1. Training Data Documentation and Transparency

### Bandy & Vincent (2021) -- Addressing "Documentation Debt" in Machine Learning Research: A Retrospective Datasheet for BookCorpus

- **Link:** https://arxiv.org/abs/2105.05241
- **Authors:**
  - Jack Bandy -- Northwestern University
  - Nicholas Vincent -- Northwestern University
- **Year:** 2021
- **Venue:** NeurIPS Datasets and Benchmarks Track
- **Key quote:** BookCorpus, used to train GPT and BERT, contains evidence of copyright violations for many books, thousands of duplicated books, and significant genre skews -- yet was widely adopted with essentially no documentation.
- **Why relevant:** Demonstrates the real-world consequences of missing dataset documentation. A commit-reveal manifest would have forced disclosure of BookCorpus's composition and licensing status before training, making these issues discoverable by auditors.

### Dodge et al. (2021) -- Documenting Large Webtext Corpora: A Case Study on the Colossal Clean Crawled Corpus

- **Link:** https://arxiv.org/abs/2104.08758
- **DOI:** https://doi.org/10.18653/v1/2021.emnlp-main.98
- **Authors:**
  - Jesse Dodge -- Allen Institute for AI (AI2)
  - Maarten Sap -- University of Washington
  - Ana Marasovic -- Allen Institute for AI (AI2)
  - William Agnew -- University of Washington
  - Gabriel Ilharco -- University of Washington
  - Dirk Groeneveld -- Allen Institute for AI (AI2)
  - Margaret Mitchell -- Hugging Face
  - Matt Gardner -- Allen Institute for AI (AI2)
- **Year:** 2021
- **Venue:** EMNLP 2021
- **Key quote:** The first large-scale documentation effort for C4 revealed pervasive quality and content issues in a dataset underpinning T5 and many other models, yet no such documentation existed at training time.
- **Why relevant:** Shows that even widely-used training corpora lack basic documentation. A committed manifest with source URLs and metadata would make post-hoc auditing tractable rather than requiring heroic reverse-engineering efforts.

### Bommasani et al. (2023) -- The Foundation Model Transparency Index

- **Link:** https://arxiv.org/abs/2310.12941
- **Authors:**
  - Rishi Bommasani -- Stanford CRFM / HAI
  - Kevin Klyman -- Stanford CRFM / HAI
  - Shayne Longpre -- Stanford CRFM / HAI
  - Sayash Kapoor -- Stanford CRFM / HAI
  - Nestor Maslej -- Stanford CRFM / HAI
  - Betty Xiong -- Stanford CRFM / HAI
  - Daniel Zhang -- Stanford CRFM / HAI
  - Percy Liang -- Stanford CRFM / HAI
- **Year:** 2023
- **Key quote:** The average transparency score across 10 major foundation model developers was 37 out of 100 on 100 fine-grained transparency indicators spanning upstream resources, model details, and downstream use.
- **Why relevant:** Empirically quantifies how opaque foundation model development is. The FMTI's data-related indicators (training data sources, data labor, data licensing) directly map to what a commit-reveal manifest would make verifiable. The low scores demonstrate the gap our protocol addresses.

### Longpre et al. (2023) -- The Data Provenance Initiative: A Large Scale Audit of Dataset Licensing & Attribution in AI

- **Link:** https://arxiv.org/abs/2310.16787
- **DOI:** https://doi.org/10.1038/s42256-024-00878-8
- **Authors:**
  - Shayne Longpre -- MIT
  - Robert Mahari -- MIT
  - Anthony Chen -- MIT
  - Naana Obeng-Marnu, Damien Sileo, William Brannon, Niklas Muennighoff, Nathan Khazam, Jad Kabbara, Kartik Perisetla, Xinyi Wu, Enrico Shippole, Kurt Bollacker, Tongshuang Wu, Luis Villa, Sandy Pentland, Sara Hooker
- **Year:** 2023 (published Nature Machine Intelligence 2024)
- **Key quote:** License omission rates of 70%+ and error rates of 50%+ were observed on widely used dataset hosting sites, pointing to "a crisis in misattribution and informed use of the most popular datasets."
- **Why relevant:** Directly demonstrates the provenance crisis in AI training data. The audit found that the most popular fine-tuning datasets have unreliable or missing license metadata -- exactly the information a commit-reveal manifest requires developers to declare and that random sampling would verify.

---

## 2. Copyright and AI Training -- Legal Analysis

### Sobel (2017) -- Artificial Intelligence's Fair Use Crisis

- **Link:** https://doi.org/10.7916/jla.v41i1.2036
- **Authors:**
  - Benjamin L. W. Sobel -- Harvard Law School, Berkman Klein Center
- **Year:** 2017
- **Venue:** Columbia Journal of Law & the Arts, Vol. 41, No. 1, pp. 45-97
- **Key quote:** "The fair use doctrine is the copyright law mechanism most likely to facilitate machine learning's uses of protected data," yet fair use may not protect expressive machine learning applications including natural language generation.
- **Why relevant:** Early and influential legal analysis warning that fair use defenses for AI training are weaker than commonly assumed. Motivates the need for verifiable training data provenance: if fair use is uncertain, developers need auditable records of what they trained on and under what license.

### Henderson et al. (2023) -- Foundation Models and Fair Use

- **Link:** https://arxiv.org/abs/2303.15715
- **DOI:** https://doi.org/10.2139/ssrn.4404340
- **Authors:**
  - Peter Henderson -- Stanford University
  - Xuechen Li -- Stanford University
  - Dan Jurafsky -- Stanford University
  - Tatsunori Hashimoto -- Stanford University
  - Mark A. Lemley -- Stanford Law School
  - Percy Liang -- Stanford University
- **Year:** 2023
- **Venue:** Journal of Machine Learning Research, Vol. 24
- **Key quote:** "In the United States and several other countries, copyrighted content may be used to build foundation models without incurring liability due to the fair use doctrine. However, if the model produces output that is similar to copyrighted data, particularly in scenarios that affect the market of that data, fair use may no longer apply."
- **Why relevant:** Provides the technical-legal framework connecting training data composition to copyright liability. The conditional nature of fair use (depends on output similarity and market harm) means developers need verifiable records of training data to assess their own legal exposure -- and courts need those records to adjudicate disputes.

### Stober & Dornis (2025) -- Generative AI Training and Copyright Law

- **Link:** https://arxiv.org/abs/2502.15858
- **Authors:**
  - Sebastian Stober -- Otto von Guericke University Magdeburg, AI Lab
  - Tim W. Dornis -- Leibniz University Hannover, Institute for Legal Informatics
- **Year:** 2025
- **Key quote:** AI developers invoke "fair use" (US) and "text and data mining" exceptions (EU) to justify training on copyrighted works, but generative AI training fundamentally differs from traditional TDM, and training data memorization creates copyright issues independent of these exceptions.
- **Why relevant:** Provides the most current cross-jurisdictional legal analysis (US fair use vs. EU TDM) of AI training copyright issues. The paper's finding that memorization creates independent copyright liability strengthens the case for verifiable training manifests -- you cannot assess memorization risk without knowing what was in the training set.

### Buick (2025) -- Copyright and AI Training Data -- Transparency to the Rescue?

- **Link:** https://doi.org/10.1093/jiplp/jpae102
- **Authors:**
  - Adam Buick -- Ulster University
- **Year:** 2025
- **Venue:** Journal of Intellectual Property Law & Practice, Vol. 20, No. 3, pp. 182-192
- **Key quote:** AI developers frequently use copyrighted material without seeking permission from rightsholders, leading to calls for transparency requirements, but "such transparency requirements alone cannot rescue us from the difficult question of how best to respond to the fundamental challenges generative AI poses to copyright law."
- **Why relevant:** Directly argues that transparency is necessary but not sufficient for copyright accountability. Our commit-reveal protocol addresses the "necessary" part by making transparency verifiable and tamper-proof; the paper's skepticism about sufficiency motivates combining transparency with random-sampling audit to create enforcement teeth.

---

## 3. Membership Inference and Data Extraction Attacks

### Shokri et al. (2017) -- Membership Inference Attacks Against Machine Learning Models

- **Link:** https://doi.org/10.1109/SP.2017.41
- **Authors:**
  - Reza Shokri -- Cornell Tech
  - Marco Stronati -- INRIA
  - Congzheng Song -- Cornell University
  - Vitaly Shmatikov -- Cornell Tech
- **Year:** 2017
- **Venue:** IEEE Symposium on Security and Privacy
- **Key quote:** An adversary can determine whether a specific data record was part of a model's training dataset, even with only black-box access to the model.
- **Why relevant:** The foundational paper on membership inference attacks. These attacks represent the adversarial counterpart to our protocol: where MIA tries to detect training data membership after the fact (unreliably), commit-reveal requires upfront declaration of the full training set, making post-hoc detection unnecessary.

### Carlini et al. (2021) -- Extracting Training Data from Large Language Models

- **Link:** https://arxiv.org/abs/2012.07805
- **Authors:**
  - Nicholas Carlini -- Google
  - Florian Tramer -- Stanford University
  - Eric Wallace -- UC Berkeley
  - Matthew Jagielski -- Northeastern University
  - Ariel Herbert-Voss -- OpenAI; Harvard University
  - Katherine Lee -- Google
  - Adam Roberts -- Google
  - Tom Brown -- OpenAI
  - Dawn Song -- UC Berkeley
  - Ulfar Erlingsson -- Apple
  - Alina Oprea -- Northeastern University
  - Colin Raffel -- Google
- **Year:** 2021
- **Venue:** USENIX Security Symposium
- **Key quote:** "An adversary can perform a training data extraction attack to recover individual training examples by querying the language model," extracting hundreds of verbatim text sequences from GPT-2 including personally identifiable information.
- **Why relevant:** Proves that LLMs memorize and can regurgitate training data, which is central to the NYT v. OpenAI dispute. However, extraction attacks only find some memorized content -- they cannot prove what is NOT in the training set. A committed manifest provides the complete picture that extraction attacks cannot.

### Nasr et al. (2023) -- Scalable Extraction of Training Data from (Production) Language Models

- **Link:** https://arxiv.org/abs/2311.17035
- **Authors:**
  - Milad Nasr -- Google DeepMind
  - Nicholas Carlini -- Google DeepMind
  - Jonathan Hayase -- University of Washington; Google DeepMind
  - Matthew Jagielski -- Google DeepMind
  - A. Feder Cooper -- Cornell
  - Daphne Ippolito -- CMU; Google DeepMind
  - Christopher A. Choquette-Choo -- Google DeepMind
  - Eric Wallace -- UC Berkeley
  - Florian Tramer -- ETH Zurich
  - Katherine Lee -- Google DeepMind; Cornell
- **Year:** 2023
- **Key quote:** A divergence attack causes ChatGPT to "emit training data at a rate 150x higher" than normal generation, enabling extraction of gigabytes of training data from production models.
- **Why relevant:** Demonstrates that even aligned, deployed models leak training data at scale. This undercuts the "we can't tell what's in the training set" defense used in litigation. Our protocol makes this moot: if the manifest is committed before training, neither extraction attacks nor model interrogation are needed to determine training set membership.

### Wu & Cao (2025) -- Membership Inference Attacks on Large-Scale Models: A Survey

- **Link:** https://arxiv.org/abs/2503.19338
- **Authors:**
  - Hengyu Wu -- Institute of Science Tokyo
  - Yang Cao -- Institute of Science Tokyo
- **Year:** 2025
- **Key quote:** Pre-training data detection -- a special case of membership inference aimed at determining whether a given input was used to train a target LLM -- is "much more challenging than conventional MIA settings" due to the characteristics of pre-training corpora and LLM training processes.
- **Why relevant:** The most comprehensive survey of MIA against LLMs, covering attacks across pre-training, fine-tuning, alignment, and RAG stages. Its central finding -- that MIA remains unreliable for definitively proving training data membership -- is the core technical motivation for our commit-reveal approach: cryptographic commitment is more reliable than statistical inference.

---

## 4. Data Provenance Systems

### C2PA (2024) -- Coalition for Content Provenance and Authenticity Technical Specification

- **Link:** https://c2pa.org/ / https://spec.c2pa.org/
- **Organization:** Coalition for Content Provenance and Authenticity (Adobe, Microsoft, Intel, BBC, and others)
- **Year:** 2024 (v2.0, January 2024; ongoing updates through 2025)
- **Key quote:** C2PA provides "an open technical standard for publishers, creators and consumers to establish the origin and edits of digital content" through cryptographically signed metadata embedded in media files.
- **Why relevant:** C2PA solves content provenance for media files using cryptographic signatures and hash-based integrity. Our commit-reveal protocol applies analogous cryptographic techniques (hash commitments, verifiable randomness) to training data manifests. C2PA demonstrates industry willingness to adopt cryptographic provenance standards -- extending this to training data is a natural next step.

---

## 5. Regulatory Frameworks

### U.S. Executive Order 14110 (2023) -- Safe, Secure, and Trustworthy Development and Use of Artificial Intelligence

- **Link:** https://www.federalregister.gov/documents/2023/11/01/2023-24283/safe-secure-and-trustworthy-development-and-use-of-artificial-intelligence
- **Issued by:** President Joseph R. Biden, October 30, 2023
- **Year:** 2023
- **Key quote:** The order directed over 50 federal entities to engage in more than 100 specific actions, including requirements for developers of dual-use foundation models to report training-related information to the federal government and undergo red-team testing.
- **Why relevant:** Represents the most comprehensive US government attempt to mandate AI transparency, including training data reporting. The order was rescinded by President Trump in January 2025, demonstrating the fragility of executive-branch transparency mandates. A cryptographic commit-reveal protocol provides transparency guarantees that survive changes in political will -- the commitment is mathematically binding regardless of who is in office.

### EU AI Act -- Training Data Transparency Template (2025)

- **Link:** https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai
- **Regulatory text:** Regulation (EU) 2024/1689, Article 53(1)(d)
- **Year:** 2024 (regulation adopted) / 2025 (template published July 24, 2025)
- **Key quote:** From August 2, 2025, any general-purpose AI model placed on the EU market must publish a summary of training content using the European Commission's mandatory template. Non-compliance can result in fines of up to 15 million euros or 3% of global annual revenue.
- **Why relevant:** The EU AI Act creates the first legally binding requirement for training data disclosure, with the Public Summary Template (PST) requiring structured information about data sources and collection methods. However, the PST relies on self-reported summaries with no verification mechanism. Our commit-reveal protocol provides exactly the missing verification layer: developers commit a detailed manifest, and drand-based random sampling allows auditors to verify that the summary accurately reflects the actual training data.

---

## 6. Audit Mechanisms for AI Systems

### Raji et al. (2020) -- Closing the AI Accountability Gap: Defining an End-to-End Framework for Internal Algorithmic Auditing

- **Link:** https://doi.org/10.1145/3351095.3372873
- **Authors:**
  - Inioluwa Deborah Raji -- AI Now Institute; New York University
  - Andrew Smart -- Google
  - Rebecca N. White -- Google
  - Margaret Mitchell -- Google
  - Timnit Gebru -- Google
  - Ben Hutchinson -- Google
  - Jamila Smith-Loud -- Google
  - Daniel Theron -- Google
  - Parker Barnes -- Google
- **Year:** 2020
- **Venue:** ACM Conference on Fairness, Accountability, and Transparency (FAT* '20)
- **Key quote:** The proposed framework yields "a set of documents that together form an overall audit report, drawing on an organization's values or principles to assess the fit of decisions made throughout the process."
- **Why relevant:** Defines the end-to-end internal audit framework that our protocol complements. Raji et al. focus on process auditing (were good decisions made at each stage?); commit-reveal adds data auditing (can we verify what data was actually used?). The two approaches are complementary -- process audits need verifiable data provenance to be meaningful.

### Casper et al. (2024) -- Black-Box Access is Insufficient for Rigorous AI Audits

- **Link:** https://arxiv.org/abs/2401.14446
- **DOI:** https://doi.org/10.1145/3630106.3659037
- **Authors:**
  - Stephen Casper -- MIT CSAIL
  - Carson Ezell -- Harvard University
  - Charlotte Siegmann -- MIT
  - Noam Kolt -- University of Toronto
  - Taylor Lynn Curtis -- MIT CSAIL
  - Benjamin Bucknall -- Centre for the Governance of AI
  - Andreas Haupt -- MIT
  - Kevin Wei -- Harvard Law School
  - Jeremy Scheurer -- Apollo Research
  - Marius Hobbhahn -- Apollo Research
  - Lee Sharkey -- Apollo Research
  - Satyapriya Krishna -- Harvard University
  - Marvin Von Hagen -- MIT
  - Silas Alberti -- Stanford University
  - Alan Chan -- Mila, Quebec AI Institute; Centre for the Governance of AI
  - Qinyi Sun -- MIT
  - Michael Gerovitch -- MIT
  - David Bau -- Northeastern University
  - Max Tegmark -- MIT
  - David Krueger -- University of Cambridge
  - Dylan Hadfield-Menell -- MIT CSAIL
- **Year:** 2024
- **Venue:** ACM FAccT '24
- **Key quote:** "White-box access to the system's inner workings allows auditors to perform stronger attacks and more thoroughly interpret models, while outside-the-box access to training and deployment information allows auditors to scrutinize the development process."
- **Why relevant:** Directly argues that meaningful AI audits require access beyond black-box querying -- specifically "outside-the-box" access to training data and development methodology. Our commit-reveal protocol provides a mechanism for structured outside-the-box access: the committed manifest gives auditors verifiable information about training data without requiring full dataset redistribution.

### Lam et al. (2024) -- A Framework for Assurance Audits of Algorithmic Systems

- **Link:** https://arxiv.org/abs/2401.14908
- **DOI:** https://doi.org/10.1145/3630106.3658957
- **Authors:**
  - Khoa Lam -- BABL AI
  - Benjamin Lange -- BABL AI
  - Borhane Blili-Hamelin -- BABL AI
  - Jovana Davidovic -- BABL AI
  - Shea Brown -- BABL AI
  - Ali Hasan -- BABL AI
- **Year:** 2024
- **Venue:** ACM FAccT '24
- **Key quote:** Algorithmic audits should be modeled on financial audits that "provide assurance that financial statements are presented accurately," with independence rules, engagement performance standards, and quality control procedures.
- **Why relevant:** Proposes the financial-audit analogy for AI systems. Financial audits work because there are verifiable records (ledgers, receipts, bank statements). The training data equivalent -- a cryptographically committed manifest subject to random sampling -- is exactly what commit-reveal provides. This paper supplies the audit-theory foundation for our technical protocol.

### Bommasani et al. (2024) -- The 2024 Foundation Model Transparency Index

- **Link:** https://arxiv.org/abs/2407.12929
- **Authors:**
  - Rishi Bommasani -- Stanford CRFM / HAI
  - Kevin Klyman -- Stanford CRFM / HAI
  - Sayash Kapoor -- Stanford CRFM / HAI
  - Shayne Longpre -- Stanford CRFM / HAI
  - Betty Xiong -- Stanford CRFM / HAI
  - Nestor Maslej -- Stanford CRFM / HAI
  - Percy Liang -- Stanford CRFM / HAI
- **Year:** 2024
- **Key quote:** After the initial FMTI assessment pressured developers toward disclosure, average transparency scores improved but remained far from comprehensive, with training data provenance among the weakest categories.
- **Why relevant:** The longitudinal FMTI data (2023 vs. 2024) shows that voluntary transparency pressure alone produces incremental improvement but leaves critical gaps, especially around training data. This empirical finding motivates moving from voluntary disclosure to cryptographically enforced commitment, where the manifest is locked before training and auditable after.

---

## Summary Table

| # | Citation | Category | Year |
|---|----------|----------|------|
| 1 | Bandy & Vincent -- Documentation Debt / BookCorpus | Documentation & Transparency | 2021 |
| 2 | Dodge et al. -- Documenting Large Webtext Corpora (C4) | Documentation & Transparency | 2021 |
| 3 | Bommasani et al. -- Foundation Model Transparency Index | Documentation & Transparency | 2023 |
| 4 | Longpre et al. -- Data Provenance Initiative | Documentation & Transparency | 2023 |
| 5 | Sobel -- AI's Fair Use Crisis | Copyright & AI Training | 2017 |
| 6 | Henderson et al. -- Foundation Models and Fair Use | Copyright & AI Training | 2023 |
| 7 | Dornis & Stober -- Generative AI Training and Copyright Law | Copyright & AI Training | 2025 |
| 8 | Buick -- Copyright and AI Training Data: Transparency to the Rescue? | Copyright & AI Training | 2025 |
| 9 | Shokri et al. -- Membership Inference Attacks | Membership Inference | 2017 |
| 10 | Carlini et al. -- Extracting Training Data from LLMs | Data Extraction | 2021 |
| 11 | Nasr et al. -- Scalable Extraction from Production LMs | Data Extraction | 2023 |
| 12 | Wu & Cao -- MIA on Large-Scale Models: A Survey | Membership Inference | 2025 |
| 13 | C2PA -- Content Provenance and Authenticity Specification | Data Provenance Systems | 2024 |
| 14 | U.S. Executive Order 14110 | Regulatory Frameworks | 2023 |
| 15 | EU AI Act -- Training Data Transparency Template | Regulatory Frameworks | 2025 |
| 16 | Raji et al. -- Closing the AI Accountability Gap | Audit Mechanisms | 2020 |
| 17 | Casper et al. -- Black-Box Access is Insufficient | Audit Mechanisms | 2024 |
| 18 | Lam et al. -- Framework for Assurance Audits | Audit Mechanisms | 2024 |
| 19 | Bommasani et al. -- 2024 Foundation Model Transparency Index | Audit Mechanisms | 2024 |
