---
name: pickleball-sports-vision
description: >-
  Expert biomechanics, USA Pickleball rules, computer vision stroke recognition,
  and kinematic audit standards for the Pickleball N-GO edge motion system.
  Use when analyzing, extracting, verifying, or classifying pickleball strokes,
  auditing kinematic formulas, or designing sports vision edge algorithms.
---

# Pickleball Sports Vision & Kinematic Intelligence Skill

This skill codifies domain expertise from official USA Pickleball rules, peer-reviewed sports biomechanics, open-source sports CV architectures (e.g., `PiServe`, `TrackNet`, `AI_Tennis_Coach`), and the rigorous kinematic extraction pipeline of Pickleball N-GO.

---

## 1. Core Biomechanics & Coordinate Framework

### 1.1 Isotropic Coordinate & Scale Normalization
1. **Aspect Ratio Preservation**: Raw normalized coordinates $(x, y) \in [0, 1]^2$ distort angles and speeds on non-square frames. Always map to isotropic pixel coordinates:
   $$x_{px} = x \cdot W, \quad y_{px} = y \cdot H$$
2. **Y-Up Coordinate Convention**: Standard screen coordinates place $y=0$ at the top. Biomechanics requires Y-up:
   $$\Delta y_{bio} = y_{hip} - y_{wrist}$$
   - Positive value ($\Delta y_{bio} > 0$): Wrist is **above** the hip.
   - Negative value ($\Delta y_{bio} < 0$): Wrist is **below** the hip.
3. **Degeneracy-Resistant Scale Reference ($S_{ref}$)**:
   - Calculate torso length $L_i = \|\mathbf{p}_{\text{mid\_shoulder}} - \mathbf{p}_{\text{mid\_hip}}\|$ only for valid frames ($c > 0.5$, $0.05 \cdot H < L_i < 0.6 \cdot H$).
   - Use the **temporal median** $S_{ref} = \text{median}(L_i)$ across the video or session as the normalization scale.
   - **Never** divide by instantaneous frame-by-frame shoulder width, as shoulder rotation during a stroke artificially inflates calculated velocities.
   - Speeds are expressed in **torso-lengths per second** ($\text{torso}/s$), NOT uncalibrated meters/second.

### 1.2 1-Euro Adaptive Filtering & Differentiation
- Human stroke motions exhibit two distinct regimes: low-frequency static aiming ($< 3\text{ Hz}$) and high-frequency explosive impact ($> 15\text{ Hz}$).
- Apply the 1-Euro filter ($\min\text{cutoff} = 1.5\text{ Hz}$, $\beta = 0.007$, $d\text{cutoff} = 1.0\text{ Hz}$) to coordinate time series before computing derivatives:
  $$\hat{x}_t = \alpha x_t + (1 - \alpha) \hat{x}_{t-1}, \quad \alpha = \frac{1}{1 + \frac{\tau}{\Delta t}}$$
- Teleportation rejection: Discard any inter-frame displacement exceeding $2500\text{ px/s}$ ($> 10\text{ torso/s}$ between adjacent raw frames) as tracking artifacts.

---

## 2. Official USA Pickleball Rules Enforcement

Refer to [USA Pickleball Rules Reference](./references/usa_pickleball_rules.md) for full citations.

### 2.1 Legal Volley Serve Criteria (Rule 4.A.7)
A legal underhand volley serve must satisfy three simultaneous conditions at ball contact:
1. **Upward Arc Motion (Rule 4.A.7.a)**:
   - The arm trajectory must be moving in an upward arc prior to and at impact:
     $$v_y(\text{wrist}) > +0.5\text{ torso/s}$$
2. **Paddle Head Below Wrist (Rule 4.A.7.b)**:
   - The topmost point of the paddle head must be below the highest point of the wrist joint.
   - In 2D pose estimation, forearm vector angle $\theta$ relative to horizontal must point downwards:
     $$\theta(\text{elbow} \rightarrow \text{wrist}) < 20^\circ$$
3. **Contact Below Waist (Rule 4.A.7.c)**:
   - Contact must occur below the player's waist (navel level).
   - Kinematic boundary:
     $$\text{wrist\_y\_rel\_hip} < +0.15\text{ torso}$$

### 2.2 Fault Classification
- **OVERHAND_FAULT**: Occurs when serve impact has $v_y \le 0$ (downward chop) or $\text{wrist\_y\_rel\_hip} > +0.3$ (hitting above waist level).
- **NON-VOLLEY ZONE (KITCHEN) FAULT (Rule 9)**: Player contacts ball out of the air while foot is on or inside the 7-foot kitchen line.

---

## 3. Biomechanical 3-Tier Quality Auditing

Every candidate stroke event detected by class-agnostic kinetic energy peaks is graded into three tiers before entering training or evaluation:

- **Tier A (Confirmed Ground-Truth Stroke)**:
  - Peak speed $v_{peak} \ge 3.0\text{ torso/s}$.
  - Tracking visibility confidence $\ge 0.70$.
  - Path displacement $> 0.4\text{ torso}$.
  - Usable for primary model training and high-confidence benchmarking.
- **Tier B (Marginal Stroke / Micro-Movement)**:
  - Peak speed between $1.8$ and $3.0\text{ torso/s}$ (e.g. soft kitchen touch dinks, quick block volleys).
  - Usable for low-amplitude stroke training with lower loss weight.
- **Tier C (Suspect Non-Stroke / False Positive)**:
  - Peak speed $< 1.8\text{ torso/s}$, or prolonged downward bending ($y_{wrist} < -1.2\text{ torso}$ for $> 1.0\text{ s}$ without explosive rebound, e.g. picking up balls, walking, adjusting paddle).
  - **Excluded** from stroke training; used as negative samples for false positive suppression.

---

## 4. Multi-Video Validation (LOVO) Protocol

1. **Zero Data Leakage Rule**:
   - Never split video frames randomly into train and test sets.
   - Always perform **Leave-One-Video-Out (LOVO)** or Leave-One-Subject-Out cross validation.
   - Normalization statistics (feature means $\mu$, standard deviations $\sigma$) must be computed **strictly on the training partition** and applied to the test video.
2. **Single-Video Class Caveats**:
   - Any stroke class having only one recording session must be explicitly flagged with `[Constraint: Single-video intra-session evaluation only]`. No cross-person generalization may be claimed.

---

## 5. Lightweight Edge Inference Deployment

1. **Model Parameter Budget**:
   - Neural models for browser/mobile edge deployment must have fewer than 1,000 float parameters ($< 15\text{ KB}$ JSON).
   - Pure Vanilla JS implementation with zero external dependencies.
2. **Latency Requirement**:
   - Single-stroke inference latency must be $< 0.1\text{ ms}$ on CPU ($> 10,000\text{ inferences/sec}$) to guarantee zero frame drops at 60 FPS.
