# Cryptographic Foundations: Additional Citations

Additional references for the "Cryptographic Foundations: Commitment Schemes and Randomness Beacons" section. These supplement the existing citations in `docs/publication-citations.md` (Blum 1981, Naor 1991, Pedersen 1991, Micali/Rabin/Vadhan 1999, Bonneau/Clark/Goldfeder 2015, Syta et al. 2017, Yakira et al. 2020, Mondal et al. 2023, Choi/Manoj/Bonneau 2023, Kavousi et al. 2023, Lee et al. 2025, Ionescu/Olimid 2025, Canidio/Danos 2023, Don et al. 2022).

---

## 1. Commitment Scheme Security

### Halevi & Micali (1996) — Practical and Provably-Secure Commitment Schemes from Collision-Free Hashing

- **Link:** https://doi.org/10.1007/3-540-68697-5_16
- **Authors:**
  - Shai Halevi — MIT Laboratory for Computer Science
  - Silvio Micali — MIT Laboratory for Computer Science
- **Quote:** "We present a very practical string-commitment scheme which is provably secure based solely on collision-free hashing... optimal (within a small constant factor) in terms of interaction, communication, and computation."
- **Why relevant:** Provides the formal security proof that hash-based commitment schemes (the construction NoCherry uses with SHA-256) achieve computational binding and statistical hiding from collision-resistance alone. Directly justifies why SHA-256 commitments are sufficient for protocol security.

### Boneh & Naor (2000) — Timed Commitments

- **Link:** https://doi.org/10.1007/3-540-44598-6_15
- **Authors:**
  - Dan Boneh — Stanford University
  - Moni Naor — Weizmann Institute of Science
- **Quote:** "We introduce the notion of timed commitments... an extension to the standard notion of commitments in which a potential forced opening phase permits the receiver to recover (with effort) the committed value without the help of the committer."
- **Why relevant:** Extends classical commitment schemes with a time dimension. Relevant because the NoCherry protocol relies on temporal ordering (server timestamps and beacon rounds) to enforce the commitment-before-randomness property.

---

## 2. Cryptographic Timestamping Protocols

### Haber & Stornetta (1991) — How to Time-Stamp a Digital Document

- **Link:** https://doi.org/10.1007/BF00196791
- **Authors:**
  - Stuart Haber — Bellcore
  - W. Scott Stornetta — Bellcore
- **Quote:** "We propose computationally practical procedures for digital time-stamping... so that it is infeasible for a user either to back-date or to forward-date his document, even with the collusion of a time-stamping service."
- **Why relevant:** The foundational paper on cryptographic timestamping. The NoCherry protocol's server-side timestamping of commitments directly implements this concept, ensuring that commitments are provably anchored in time before the beacon randomness is revealed.

### Bayer, Haber & Stornetta (1993) — Improving the Efficiency and Reliability of Digital Time-Stamping

- **Link:** https://doi.org/10.1007/978-1-4613-9323-8_24
- **Authors:**
  - Dave Bayer — Columbia University
  - Stuart Haber — Bellcore
  - W. Scott Stornetta — Bellcore
- **Quote:** Introduces Merkle-tree-based hash linking to improve timestamping efficiency from linear to logarithmic verification.
- **Why relevant:** Extends Haber & Stornetta (1991) with hash trees for efficient batch timestamping. The same Merkle tree principle applies to batched commitment verification in the protocol, and this paper is a direct ancestor of blockchain-based timestamping.

---

## 3. The drand Protocol and Distributed VRFs

### Galindo, Liu, Ordean & Wong (2021) — Fully Distributed Verifiable Random Functions and their Application to Decentralised Random Beacons

- **Link:** https://doi.org/10.1109/EuroSP51992.2021.00017
- **ePrint:** https://eprint.iacr.org/2020/096
- **Authors:**
  - David Galindo — University of Birmingham
  - Jia Liu — University of Birmingham
  - Mihai Ordean — University of Birmingham
  - Jin-Mann Wong — University of Birmingham
- **Quote:** "We provide a systematic analysis of Distributed Verifiable Random Functions (DVRFs) and Decentralised Random Beacons (DRBs), including their syntax and definition of robustness and privacy properties."
- **Why relevant:** The closest academic treatment of the cryptographic construction underlying drand. Formally proves that threshold BLS signatures produce pseudorandom output, which is the exact mechanism the NoCherry protocol relies on for unpredictable randomness. Introduces the GLOW-DVRF construction that maps to drand's architecture.

---

## 4. BLS Threshold Signatures

### Boneh, Lynn & Shacham (2001) — Short Signatures from the Weil Pairing

- **Link:** https://doi.org/10.1007/3-540-45682-1_30
- **Authors:**
  - Dan Boneh — Stanford University
  - Ben Lynn — Stanford University
  - Hovav Shacham — Stanford University
- **Quote:** "We introduce a short signature scheme based on the Computational Diffie-Hellman assumption on certain elliptic curves... signatures are approximately half the size of DSA signatures with a similar level of security."
- **Why relevant:** The original BLS signature paper. drand's randomness beacon produces each round's output as a threshold BLS signature over the round number. The algebraic properties of BLS (determinism, aggregability, verifiability) are what make the beacon output both unpredictable before threshold and verifiable after.

### Boldyreva (2003) — Threshold Signatures, Multisignatures and Blind Signatures Based on the Gap-Diffie-Hellman-Group Signature Scheme

- **Link:** https://doi.org/10.1007/3-540-36288-6_3
- **Authors:**
  - Alexandra Boldyreva — Georgia Institute of Technology
- **Quote:** "We propose a robust proactive threshold signature scheme... which works in any Gap Diffie-Hellman (GDH) group."
- **Why relevant:** Provides the formal security proof for threshold BLS signatures under the Gap-DH assumption. drand requires exactly this construction: a (t,n)-threshold scheme where no coalition smaller than t can produce a valid signature (and thus predict the beacon output), while any t participants can reconstruct it.

---

## 5. Ed25519 Digital Signatures

### Bernstein, Duif, Lange, Schwabe & Yang (2012) — High-Speed High-Security Signatures

- **Link:** https://doi.org/10.1007/s13389-012-0027-1
- **Authors:**
  - Daniel J. Bernstein — University of Illinois at Chicago; Technische Universiteit Eindhoven
  - Niels Duif — Technische Universiteit Eindhoven
  - Tanja Lange — Technische Universiteit Eindhoven
  - Peter Schwabe — Academia Sinica
  - Bo-Yin Yang — Academia Sinica
- **Quote:** "This paper introduces Ed25519... producing 109000 signatures per second and verifying 71000 signatures per second on a mass-market CPU, with 32-byte public keys and 64-byte signatures."
- **Why relevant:** The Ed25519 signature scheme paper. The NoCherry protocol uses Ed25519 for the data holder's signature over the SHA-256 commitment hash, binding the commitment to a specific identity. Ed25519's deterministic signing (no per-signature randomness needed) eliminates an entire class of implementation vulnerabilities.

---

## 6. HMAC and Deterministic Pseudorandom Generation

### Bellare, Canetti & Krawczyk (1996) — Keying Hash Functions for Message Authentication

- **Link:** https://doi.org/10.1007/3-540-68697-5_1
- **Authors:**
  - Mihir Bellare — University of California, San Diego
  - Ran Canetti — IBM T.J. Watson Research Center
  - Hugo Krawczyk — IBM T.J. Watson Research Center
- **Quote:** "We present new constructions of message authentication schemes (MACs) based on a cryptographic hash function... HMAC is proven to be secure as long as the underlying hash function has some reasonable cryptographic strengths."
- **Why relevant:** The original HMAC paper. The NoCherry protocol uses HMAC-SHA256 with the beacon output as key to generate per-item Bernoulli trials for deterministic random selection. HMAC's PRF security guarantee is what ensures the selection is indistinguishable from random to anyone who does not know the beacon value in advance.

### Goldreich, Goldwasser & Micali (1986) — How to Construct Random Functions

- **Link:** https://doi.org/10.1145/6490.6503
- **Authors:**
  - Oded Goldreich — Technion, Israel Institute of Technology
  - Shafi Goldwasser — MIT
  - Silvio Micali — MIT
- **Quote:** "A constructive theory of randomness for functions, based on computational complexity, is developed, and a pseudorandom function generator is presented."
- **Why relevant:** The foundational paper defining pseudorandom functions (PRFs). Establishes that a keyed function family can be computationally indistinguishable from truly random functions. The HMAC-SHA256 construction used for per-item selection in the protocol is a concrete instantiation of a PRF; this paper provides the theoretical basis for why keying a hash function with the beacon output produces selection decisions that no adversary can predict.

### Woodage & Shumow (2019) — An Analysis of NIST SP 800-90A

- **Link:** https://doi.org/10.1007/978-3-030-17656-3_6
- **Authors:**
  - Joanne Woodage — Royal Holloway, University of London
  - Dan Shumow — Microsoft Research
- **Quote:** "We prove the robustness of HASH-DRBG and HMAC-DRBG in the random oracle model... [and] show that if an optional input is omitted, then HMAC-DRBG does not achieve the weaker property of forward security."
- **Why relevant:** Formal security analysis of HMAC-based deterministic random bit generation. Directly applicable because the protocol's use of HMAC-SHA256(beacon_output, item_id) for Bernoulli trials is essentially a single-invocation HMAC-DRBG. The robustness proof in the ROM confirms that beacon output as HMAC key produces cryptographically strong pseudorandom selection.

### NIST (2015) — Secure Hash Standard (SHS), FIPS PUB 180-4

- **Link:** https://doi.org/10.6028/NIST.FIPS.180-4
- **Authors:**
  - National Institute of Standards and Technology (NIST)
- **Quote:** "This Standard specifies secure hash algorithms - SHA-1, SHA-224, SHA-256, SHA-384, SHA-512, SHA-512/224 and SHA-512/256 - for computing a condensed representation of electronic data."
- **Why relevant:** The federal standard defining SHA-256, the hash function used for commitments in the protocol. Provides the authoritative specification that underpins the collision-resistance assumption on which the commitment scheme's binding property depends.

---

## 7. Deterministic Shuffling

### Durstenfeld (1964) — Algorithm 235: Random Permutation

- **Link:** https://doi.org/10.1145/364520.364540
- **Authors:**
  - Richard Durstenfeld
- **Quote:** Presents an O(n) algorithm for generating a uniformly random permutation of n elements in place.
- **Why relevant:** The modern Fisher-Yates shuffle algorithm used in the protocol for batch-mode item selection. When seeded with deterministic pseudorandom bytes derived from the beacon output, this algorithm produces a verifiably uniform permutation. Any verifier can reproduce the exact same shuffle from the same seed.

---

## 8. Verifiable Delay Functions

### Boneh, Bonneau, Bunz & Fisch (2018) — Verifiable Delay Functions

- **Link:** https://doi.org/10.1007/978-3-319-96884-1_25
- **ePrint:** https://eprint.iacr.org/2018/601
- **Authors:**
  - Dan Boneh — Stanford University
  - Joseph Bonneau — New York University
  - Benedikt Bunz — Stanford University
  - Ben Fisch — Stanford University
- **Quote:** "A VDF requires a specified number of sequential steps to evaluate, yet produces a unique output that can be efficiently and publicly verified... VDFs have many applications in decentralized systems, including public randomness beacons."
- **Why relevant:** Defines VDFs as a primitive for generating trustworthy public randomness. VDFs are the primary alternative to the threshold-BLS approach used by drand. Understanding VDFs contextualizes the design choice: drand's threshold BLS provides similar unpredictability guarantees with lower latency (3-second rounds vs. VDF evaluation time), at the cost of requiring a threshold trust assumption instead of a sequential-computation assumption.

### Wesolowski (2019) — Efficient Verifiable Delay Functions

- **Link:** https://doi.org/10.1007/978-3-030-17659-4_13
- **ePrint:** https://eprint.iacr.org/2018/623
- **Authors:**
  - Benjamin Wesolowski — EPFL (Ecole Polytechnique Federale de Lausanne)
- **Quote:** "We construct a VDF... based on groups of unknown order such as an RSA group or the class group of an imaginary quadratic field... very short output and efficient verification."
- **Why relevant:** The most practical VDF construction, used by protocols like Chia and Ethereum 2.0 research. Provides concrete efficiency numbers that contextualize the tradeoff between VDF-based and threshold-BLS-based (drand) randomness beacons.

---

## 9. Commit-Reveal in Blockchain and DeFi

### Daian, Goldfeder, Kell, Li, Zhao, Bentov, Breidenbach & Juels (2020) — Flash Boys 2.0: Frontrunning in Decentralized Exchanges, Miner Extractable Value, and Consensus Instability

- **Link:** https://doi.org/10.1109/SP40000.2020.00040
- **arXiv:** https://arxiv.org/abs/1904.05234
- **Authors:**
  - Philip Daian — Cornell Tech, IC3
  - Steven Goldfeder — Cornell Tech, IC3
  - Tyler Kell — Cornell Tech, IC3
  - Yunqi Li — University of Illinois Urbana-Champaign, IC3
  - Xueyuan Zhao — Carnegie Mellon University, IC3
  - Iddo Bentov — Cornell Tech, IC3
  - Lorenz Breidenbach — ETH Zurich, IC3
  - Ari Juels — Cornell Tech, IC3
- **Quote:** "We highlight the large, complex MEV extraction ecosystem... a general phenomenon where miners (or validators) can extract value by arbitrarily reordering, inserting, or censoring transactions."
- **Why relevant:** Defines the front-running and MEV problems that motivate commit-reveal schemes in adversarial environments. The same threat model applies to any system where an adversary who sees data before committing can manipulate outcomes -- including benchmark evaluation. The NoCherry commit-reveal protocol prevents precisely this class of attack in the research integrity domain.

### Momeni, Gorbunov & Zhang (2022) — FairBlock: Preventing Blockchain Front-Running with Minimal Overheads

- **Link:** https://doi.org/10.1007/978-3-031-25538-0_14
- **ePrint:** https://eprint.iacr.org/2022/1066
- **Authors:**
  - Peyman Momeni — University of Waterloo
  - Sergey Gorbunov — University of Waterloo; Algorand
  - Bohan Zhang — University of Waterloo
- **Quote:** Uses "identity-based encryption to prevent front-running with minimal bandwidth overheads" via a commit-then-decrypt pattern.
- **Why relevant:** Demonstrates an alternative to commit-reveal for achieving transaction fairness, using threshold identity-based encryption. Contextualizes the design space: NoCherry's commit-reveal + external beacon approach achieves similar fairness guarantees with simpler cryptographic assumptions (hash functions + signatures rather than IBE).

### Schindler, Judmayer, Stifter & Weippl (2020) — HydRand: Efficient Continuous Distributed Randomness

- **Link:** https://doi.org/10.1109/SP40000.2020.00003
- **ePrint:** https://eprint.iacr.org/2018/319
- **Authors:**
  - Philipp Schindler — SBA Research; TU Wien
  - Aljosha Judmayer — SBA Research
  - Nicholas Stifter — SBA Research; TU Wien
  - Edgar Weippl — SBA Research; University of Vienna
- **Quote:** "We present HydRand, a novel distributed protocol based on publicly-verifiable secret sharing (PVSS) to ensure unpredictability, bias-resistance, and public-verifiability of a continuous sequence of random beacon values."
- **Why relevant:** Presents an alternative PVSS-based randomness beacon with O(n^2) communication complexity. Provides a comparison point for drand's threshold-BLS approach: HydRand achieves guaranteed output delivery (liveness under Byzantine faults) while drand relies on threshold availability. Both produce publicly verifiable randomness suitable for the NoCherry protocol's needs.

---

## Summary

| # | Citation | Topic | Year |
|---|----------|-------|------|
| 1 | Halevi & Micali | Hash-based commitment security proofs | 1996 |
| 2 | Boneh & Naor | Timed commitments | 2000 |
| 3 | Haber & Stornetta | Cryptographic timestamping | 1991 |
| 4 | Bayer, Haber & Stornetta | Merkle-tree timestamping | 1993 |
| 5 | Galindo et al. | DVRFs and drand's cryptographic foundation | 2021 |
| 6 | Boneh, Lynn & Shacham | BLS signatures | 2001 |
| 7 | Boldyreva | Threshold BLS security proof | 2003 |
| 8 | Bernstein et al. | Ed25519 signatures | 2012 |
| 9 | Bellare, Canetti & Krawczyk | HMAC construction and security | 1996 |
| 10 | Goldreich, Goldwasser & Micali | Pseudorandom functions (PRF theory) | 1986 |
| 11 | Woodage & Shumow | HMAC-DRBG formal security analysis | 2019 |
| 12 | NIST FIPS 180-4 | SHA-256 standard | 2015 |
| 13 | Durstenfeld | Fisher-Yates shuffle algorithm | 1964 |
| 14 | Boneh, Bonneau, Bunz & Fisch | Verifiable delay functions (definition) | 2018 |
| 15 | Wesolowski | Efficient VDF construction | 2019 |
| 16 | Daian et al. | Front-running and MEV (motivation for commit-reveal) | 2020 |
| 17 | Momeni, Gorbunov & Zhang | FairBlock (alternative to commit-reveal) | 2022 |
| 18 | Schindler et al. | HydRand (PVSS-based randomness beacon) | 2020 |
