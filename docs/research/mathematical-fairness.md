# Mathematical Fairness & Cryptographic Randomness Specification

## 1. Problem Statement: Why Conventional Web Wheels Are Biased

Most web-based random wheels fail mathematical fairness tests due to three compounding flaws:

1. **Predictable PRNG & Floating-Point Quantization (`Math.random()`)**:
   - Browser engines implement `Math.random()` using `xorshift128+` mapped to an IEEE-754 double-precision float in $[0, 1)$ with a 53-bit significand.
   - It is not cryptographically secure (internal state can be reconstructed from consecutive outputs via SMT solvers) and scaling via `Math.floor(Math.random() * N)` inherits $2^{-53}$ quantization steps.

2. **Modulo Bias (Pigeonhole Principle)**:
   - Mapping a $k$-bit unsigned integer $X \in \{0, 1, \dots, 2^k - 1\}$ to $N$ buckets via $X \bmod N$ produces a remainder $r = 2^k \bmod N$.
   - When $r \neq 0$, the first $r$ outcomes receive $\lfloor 2^k / N \rfloor + 1$ mappings while the remaining $N - r$ outcomes receive $\lfloor 2^k / N \rfloor$.
   - The Total Variation Distance (TVD) from the discrete uniform distribution $\mathcal{U}\{0, N-1\}$ is:
     $$\delta(P, \mathcal{U}) = \frac{r(N - r)}{N \cdot 2^k}$$

3. **Physics-Simulation Coupling Bias**:
   - Simulating angular velocity decay $\omega_{t+1} = \gamma \omega_t$ across `requestAnimationFrame` ticks couples the winning outcome to frame-rate jitter ($\Delta t$ variance across 60Hz/120Hz/144Hz displays or background tab throttling) and non-linear modulo wrapping $\Delta\theta \pmod{2\pi}$.

---

## 2. Provably Fair Architecture: Outcome-First Decoupled Model

To achieve **zero statistical bias ($\text{TVD} = 0$)**, the selection engine is strictly decoupled from the rendering and physics engine:

$$\text{OS CSPRNG} \longrightarrow \text{Exact Rejection Sampler} \longrightarrow \text{Winner } k^* \longrightarrow \text{Target Angle } \theta_{\text{target}} \longrightarrow \text{Time-Parametric Curve } \theta(t)$$

### 2.1 Cryptographic Entropy Source (W3C Web Crypto API)
All randomness is drawn from `crypto.getRandomValues(Uint32Array)`, which interfaces directly with the host OS Cryptographically Secure Pseudo-Random Number Generator (CSPRNG) compliant with **NIST SP 800-90A**:
- Windows: `BCryptGenRandom`
- Linux / Android: `getrandom(2)` / `/dev/urandom`
- macOS / iOS: `CCRandomGenerateBytes`

### 2.2 Unbiased Discrete Uniform Sampling (Lemire's Rejection Method)
To draw an integer $k \in \{0, 1, \dots, N-1\}$ with exact probability $P(k) = \frac{1}{N}$:
- Let $M = 2^{32}$. Compute the rejection threshold:
  $$L = M - (M \bmod N)$$
- Draw $x \sim \mathcal{U}\{0, 2^{32}-1\}$ from `crypto.getRandomValues`.
- While $x \ge L$, discard $x$ and draw again.
- Return $k^* = x \bmod N$.

Because $L$ is the largest multiple of $N$ less than or equal to $2^{32}$, every residue class modulo $N$ has **strictly** $L / N$ pre-images in $\{0, 1, \dots, L-1\}$.

### 2.3 Exact Weighted Sampling ($w_i > 0$)
When options carry custom weights $w_0, w_1, \dots, w_{N-1}$:
- User weights (supporting integers or up to 2 decimal places) are scaled to exact positive integers $W_i \in \mathbb{Z}^+$ with cumulative prefix sums:
  $$S_k = \sum_{i=0}^{k} W_i, \quad W_{\text{total}} = S_{N-1}$$
- Draw an unbiased integer $u \sim \mathcal{U}\{0, W_{\text{total}} - 1\}$ using the rejection sampler in Section 2.2 (with `BigUint64Array` fallback if $W_{\text{total}} \ge 2^{32}$).
- Locate the winning index $k^*$ via binary search ($O(\log N)$) such that:
  $$S_{k^*-1} \le u < S_{k^*}$$
- **Why Exact Integer Prefix-Sum over Floating-Point Vose's Alias Method?**
  While Vose's Alias Method (Vose 1991) achieves $O(1)$ sampling after $O(N)$ setup, its probability table relies on IEEE-754 floating-point division $p_i = \frac{N \cdot w_i}{\sum w_j}$, introducing $2^{-53}$ ULP rounding drift when $\sum w_j$ is not a power of two. Exact integer rejection + binary search guarantees **zero floating-point representation bias** while running in $< 1\,\mu\text{s}$ for $N \le 10,000$.

### 2.4 Sampling Modes: Independent (I.I.D.) vs. History-Aware (Balance & Momentum)

The engine supports two top-level modes, with two mathematical sub-models when History-Aware mode is active:

1. **Mode 1 — Independent / Memoryless Mode (`ไม่สนสถิติรอบก่อน` — I.I.D. Categorical)**:
   - Every spin is strictly independent of past outcomes.
   - Effective integer weight for slice $i$:
     $$W_i^{\text{eff}} = W_i$$
   - Exact single-spin probability:
     $$P(i) = \frac{W_i}{\sum_{j=0}^{N-1} W_j}$$

2. **Mode 2A — History-Aware: Balance / Anti-Streak (`เกลี่ยให้ทั่วถึง / ลดโอกาสซ้ำ` — Inverse-Frequency Balancing)**:
   - Incorporates past spin outcomes $c_i \in \mathbb{Z}_{\ge 0}$ (session win count for slice $i$) to dampen recently picked items and boost unpicked items.
   - Effective weight for slice $i$ after $c_i$ wins (scaled to integer resolution $S_{\text{scale}} = 10{,}000$):
     $$W_i^{\text{eff}} = \max\left(1, \; \text{round}\left(\frac{W_i \cdot S_{\text{scale}}}{1 + c_i}\right)\right)$$

3. **Mode 2B — History-Aware: Momentum / Pólya Urn (`ยิ่งออกยิ่งมาแรง / เพิ่มโอกาสซ้ำ` — Additive Reinforcement)**:
   - Follows the classical **Pólya Urn model** where each win reinforces the slice's weight by $+W_i$ (or $+1$ unit proportional to base weight):
     $$W_i^{\text{eff}} = W_i \cdot (1 + c_i)$$

- **Real-Time Probability & Proportional Sector Invariant**:
  In all modes, the exact probability and sector angle of slice $i$ are governed by:
  $$P_{\text{eff}}(i) = \frac{W_i^{\text{eff}}}{\sum_{j=0}^{N-1} W_j^{\text{eff}}}, \quad \Delta\theta_i = 2\pi \cdot P_{\text{eff}}(i)$$
  When $c_i = 0$ for all $i$ (or when session history is cleared), all three modes yield the exact same initial distribution $P(i)$.

### 2.5 Sub-Slice Landing Angle & Time-Parametric Easing
Once the winning slice $k^*$ is determined with angular span $[\alpha_{k^*}, \beta_{k^*}]$ and width $\Delta\alpha_{k^*} = \beta_{k^*} - \alpha_{k^*}$:
1. Draw a second independent CSPRNG value $u_{\text{sub}} \in [0, 1)$ to pick the landing offset inside slice $k^*$:
   $$\phi = \alpha_{k^*} + \Delta\alpha_{k^*} \cdot \left(\epsilon + (1 - 2\epsilon) u_{\text{sub}}\right)$$
   where $\epsilon = 0.04$ (4% visual guard margin from the slice border) prevents visual ambiguity on the divider line **without altering slice win probability** (since $k^*$ is already locked).
2. Compute total target rotation from current wheel angle $\theta_0$:
   $$\theta_{\text{target}} = \theta_0 + 2\pi R + \left((\theta_{\text{pointer}} - \phi - \theta_0) \bmod 2\pi\right)$$
   where $R \in \{R_{\min}, \dots, R_{\max}\}$ is the number of full revolutions.
3. Evaluate $\theta(t)$ purely as a function of normalized monotonic time $\tau = \text{clamp}\left(\frac{t - t_0}{T}, 0, 1\right)$:
   $$\theta(\tau) = \theta_0 + (\theta_{\text{target}} - \theta_0) \cdot E(\tau), \quad E(\tau) = 1 - (1 - \tau)^4$$

---

## 3. Built-In Statistical Verification (Chi-Squared Fairness Proof)

The application includes an interactive **Monte Carlo Fairness Audit** capable of executing $K = 100,000$ cryptographic draws in the browser:

1. **Observed vs. Expected Frequencies**:
   - Expected count for slice $i$: $E_i = K \cdot \frac{W_i}{W_{\text{total}}}$
   - Observed count: $O_i$
2. **Pearson's Chi-Squared Statistic ($\chi^2$)**:
   $$\chi^2 = \sum_{i=0}^{N-1} \frac{(O_i - E_i)^2}{E_i}$$
   with degrees of freedom $\nu = N - 1$.
3. **Regularized Upper Incomplete Gamma $p$-value**:
   $$p = Q\left(\frac{\nu}{2}, \frac{\chi^2}{2}\right) = \frac{\Gamma(\nu/2, \chi^2/2)}{\Gamma(\nu/2)}$$
   computed via series/continued-fraction expansion (Lentz's algorithm) so users can verify in real time that $p > 0.01$ (no statistically significant deviation from theoretical fairness).

---

## 4. Primary References
- **Lemire, D. (2019).** *Fast Random Integer Generation in an Interval.* ACM Transactions on Modeling and Computer Simulation (TOMACS), 29(1), Article 3. https://arxiv.org/abs/1805.10941
- **Vose, M. D. (1991).** *A linear algorithm for generating random numbers with a given distribution.* IEEE Transactions on Software Engineering, 17(9), 972–975.
- **NIST Special Publication 800-90A Rev. 1 (2015).** *Recommendation for Random Number Generation Using Deterministic Random Bit Generators.* National Institute of Standards and Technology.
- **W3C Web Cryptography API Specification.** `Crypto.getRandomValues()` standard. https://www.w3.org/TR/WebCryptoAPI/
