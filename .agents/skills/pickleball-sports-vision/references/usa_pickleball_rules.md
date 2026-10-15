# USA Pickleball Official Rules & Kinematic Mapping Reference

Source: *USA Pickleball Official Rulebook (2024-2025 Edition)*

---

## 1. Rule 4.A: The Volley Serve

The volley serve is initiated by releasing the ball from one hand and striking the ball out of the air before it bounces.

### Rule 4.A.7: Serve Stroke Mechanics
At the moment the ball is struck by the paddle:

1. **Rule 4.A.7.a (Upward Arc)**:
   > "The server's arm must be moving in an upward arc at the time the ball is struck."
   - *Biomechanical Meaning*: The wrist / racket trajectory must have a positive vertical velocity component ($v_y > 0$ in Y-up frame) over the window $[t_{\text{contact}} - 150\text{ms}, t_{\text{contact}}]$.
   - *Violation*: Downward chop, sidearm slice with horizontal/negative vertical momentum.

2. **Rule 4.A.7.b (Paddle Head Below Wrist)**:
   > "The highest part of the paddle head must not be above the highest part of the wrist (where the wrist joint bends) at the time the paddle strikes the ball."
   - *Biomechanical Meaning*: With forearm angle $\theta_{fa}$, the paddle axis extends from the wrist. If the paddle head is below the wrist, the forearm-to-paddle vector must not angle upwards. In single-camera 2D lateral/frontal pose estimation, the angle between the elbow-wrist segment and horizontal must be constrained below $20^\circ$.

3. **Rule 4.A.7.c (Contact Below Waist)**:
   > "Contact with the ball must be made below the server's waist level. The waist is defined as the navel level."
   - *Biomechanical Meaning*: The mid-hip keypoint represents the iliac crest / greater trochanter. The anatomical navel is located approximately $0.15 \times S_{ref}$ (torso height) above the mid-hip.
   - *Rule Guardrail*:
     $$\text{Contact Height} \le y_{\text{mid\_hip}} + 0.15 \cdot S_{ref}$$
     Any impact above this threshold is flagged as `OVERHAND_FAULT`.

---

## 2. Rule 9: Non-Volley Zone (Kitchen) Rules

1. **Rule 9.B**:
   > "It is a fault if the volleying player or anything that has contact with the player touches the non-volley zone, including the non-volley line, during the volley stroke."
2. **Kinematic Meaning in Edge Vision**:
   - In frontal or corner smartphone camera setups, court homography ($H$) maps player foot keypoints (ankle / heel / toe) to the 2D court plane.
   - Volley detection checks whether any foot point crosses the 7-foot kitchen line when a volley stroke (e.g. `SMASH`, `VOLLEY_PUNCH`) is recognized before a ground bounce occurs.

---

## 3. Stroke Taxonomy

| Stroke Class | Biomechanical Signature | Reference Scale Expected Range |
| :--- | :--- | :--- |
| `UNDERHAND_LEGAL` | Upward arc ($v_y > +0.8$), contact below waist ($y_{rel} < 0.15$), acceleration positive | $v_{peak} \in [3.0, 10.0]\text{ torso/s}$ |
| `OVERHAND_FAULT` | Downward or horizontal trajectory at serve ($v_y \le 0$ or $y_{rel} > 0.3$) | $v_{peak} \in [3.0, 12.0]\text{ torso/s}$ |
| `KITCHEN_DINK` | Low contact height ($y_{rel} < -0.2$), controlled impulse, low displacement | $v_{peak} \in [1.8, 4.5]\text{ torso/s}$ |
| `SMASH` | High contact height ($y_{rel} > +0.8$), rapid downward follow-through ($v_y < -4.0$) | $v_{peak} \in [6.0, 20.0]\text{ torso/s}$ |
| `POWER_DRIVE` | Hip-to-chest level ($y_{rel} \in [-0.2, 0.4]$), large horizontal excursion ($v_x > 4.0$) | $v_{peak} \in [5.0, 15.0]\text{ torso/s}$ |
| `VOLLEY_PUNCH` | Chest-level contact, short backswing, rapid linear push | $v_{peak} \in [3.5, 9.0]\text{ torso/s}$ |
| `PASSIVE_BLOCK` | Minimal limb displacement, wrist absorbs momentum | $v_{peak} \in [1.8, 3.5]\text{ torso/s}$ |
