# AGENTS.md

## 1. Project Purpose
**Provably Fair Web Wheel** — A zero-dependency, cryptographically fair decision wheel web application built for GitHub Pages. It uses W3C Web Crypto CSPRNG (`crypto.getRandomValues`) and exact rejection sampling (Lemire 2019) decoupled from a 3D tactile `OffscreenCanvas` rendering engine, with preset persistence, URL sharing, JSON import/export, and an in-app 100,000-spin Pearson's $\chi^2$ fairness audit.

## 2. Active Domain & Operating Persona
- **Domain**: Coding / Product / Applied Mathematics (Cryptographic Randomness & Interactive Graphics)
- **Persona**: Pragmatic Senior Systems Engineer + Mathematical Verification Specialist
- **Planning Depth**: Standard (`Scoped Spec Before Build`)

## 3. Docs Map
- [`README.md`](README.md) — Human-facing overview, project status, and how to run/deploy on GitHub Pages.
- [`docs/research/mathematical-fairness.md`](docs/research/mathematical-fairness.md) — Read when modifying random number generation, weighted sampling, sub-slice angle calculation, or the $\chi^2$ statistical test.
- [`docs/architecture/system-spec.md`](docs/architecture/system-spec.md) — Read before implementing or changing modules, security boundaries, canvas rendering pipeline, preset serialization, or edge-case handling.

## 4. Settled Decisions
1. **Definition Mode**: Scoped Spec Before Build (`docs/` committed to GitHub).
2. **Fairness & Simulation Suite**:
   - Full suite: Uniform + Weighted ($w_i \in \mathbb{Z}^+$) + Per-choice Weight & Exact Probability ($P(i)\%$) display.
   - **Dual Probability Mode Toggle**: Independent Mode (`ไม่สนสถิติรอบก่อน`, $W_i^{\text{eff}} = W_i$) vs. History-Aware Mode (`คำนวณสถิติรอบก่อน`, $W_i^{\text{eff}} \propto \frac{W_i}{1 + c_i}$).
   - Eliminate Winner toggle + History Log + 100,000-spin $\chi^2$ Goodness-of-Fit Proof in UI.
3. **Preset Persistence**: `localStorage` + Shareable URL Hash (`#preset=`) + JSON File Import/Export.
4. **Tech Stack**: Vanilla HTML5 + CSS3 + Modern ES Modules (Zero runtime dependencies) for instant GitHub Pages hosting and zero dependency rot.
5. **Visual Aesthetic & Interaction**:
   - **Design 3 (Neo-Brutalist Swiss Editorial)** with a **straight-on orthographic wheel** + 3D extruded cylindrical rim/shadow, responsive mobile-first layout, proportional slice angles, drag-to-spin + 3D tilt, Web Audio mechanical tick synthesizer, Winner Spotlight, and mid-spin Skip-to-Result.

## 5. Hard Constraints & Bans
- **NEVER** use `Math.random()` for outcome selection, weight selection, or shuffle operations. Always use `crypto.getRandomValues()` with rejection sampling.
- **NEVER** couple frame-rate physics (`dt`) to outcome determination. Winner $k^*$ must be chosen before animation begins.
- **NEVER** use `innerHTML` with user-supplied labels or preset names (strict XSS prevention).
- **NEVER** introduce AI-slop styling (no neon purple/indigo gradients, no unrequested decorative fluff).

## 6. Instructions for AI Agents
- Load only the relevant doc from `docs/` for the task at hand.
- Run `node --test` to verify mathematical fairness and serializer security after any logic change.
