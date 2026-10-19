# Aerodynamic model

This is the implemented flight model for the [bird simulator](01-bird-simulator.md). It combines a rigid body, two articulated wings, a controllable tail and quasi-steady aerodynamic forces. Wing movement supplies mechanical work through the same force model that produces gliding and steering.

Geometry and joint parameters live in [model.ts](../src/flight/model.ts), coefficient curves in [aerodynamics.ts](../src/flight/aerodynamics.ts), and attitude control/allocation in [posture.ts](../src/flight/posture.ts).

## Coordinates and state

Use SI units and radians internally. Body axes are +X right, +Y up and −Z forward. Positive pitch is nose-up about +X; positive bank is right-wing-down about −Z. The body-to-world rotation matrix `R` comes from the orientation quaternion.

Body state consists of world position `x`, world velocity `v`, orientation and body angular velocity `ω`. Joint state includes each shoulder's stroke angle, outer-wing fold, strip feather incidences, tail pitch and tail cant. Increasing either shoulder angle means a downstroke.

Key parameters are:

| Quantity | Current value |
| --- | --- |
| Mass / air density / gravity | 0.8 kg / 1.225 kg/m³ / 9.81 m/s² |
| Body inertia diagonal, X/Y/Z | 0.035 / 0.055 / 0.045 kg·m² |
| Shoulder positions | (±0.08, 0, −0.045) m |
| Length / area of each wing | 0.8 m / 0.18 m² |
| Wing discretization | 8 tapered strips per side |
| Held incidence / fixed dihedral | 4° / 5° |
| Tail area / aft position | 0.1 m² / Z = 0.8 m |
| Manual downstroke limit | 75° |
| Released-shoulder assistance | ±15°, at up to 8°/s |
| Maximum recovery fold | 20° at the outer-half hinge |
| Physics timestep | 1/120 s |

## Trigger mapping and geometry

Each trigger reports travel `u ∈ [0,1]`. Engagement at 0.04 captures the current shoulder angle as baseline `b`; release at 0.02 begins the return to that baseline. Re-engaging before recovery finishes preserves `b`.

While engaged, the target is

\[
p = \operatorname{clamp}\left(\frac{u-0.02}{0.98},0,1\right),
\qquad
\theta^* = b + p(75^\circ-b).
\]

A bounded, smoothed joint rate approaches this target, with a maximum of 16 rad/s. During manual movement or recovery, posture allocation can choose only within the interval from the previous angle to the proposed step. It may slow or stop progress, but cannot reverse it or add travel beyond the target. After return, the released shoulder becomes available for slow posture adjustment.

For side sign `σ = −1` on the left and `+1` on the right, the stroke rotation about body Z is `−σ(θ − dihedral)`. The outer half folds about a midspan hinge. Each strip has a pressure-center position `r_j`, chord direction `c_j`, normal `n_j` and area `A_j`, all derived from these joints.

Pressure-center velocity relative to the body is the finite difference of its position. This includes stroke and fold motion. Feathering rotates about the pressure center, so it changes force orientation without translating that center. Folding changes geometry, not the assigned strip area. The renderer uses these same positions and bases.

## Local airflow and force

Wind is a uniform world-space vector `w`, initially zero. In body coordinates, each surface's velocity relative to air is

\[
u_j = R^T(v-w) + \omega \times r_j + \dot r_j.
\]

Let `s_j = c_j × n_j` be the unit span direction. The strip model discards spanwise flow:

\[
u_{\perp j}=u_j-s_j(u_j\cdot s_j),\qquad
V_j=|u_{\perp j}|,\qquad
\alpha_j=\operatorname{atan2}(-u_{\perp j}\cdot n_j,\;u_{\perp j}\cdot c_j).
\]

For nonzero speed, with `û_j = u⊥j / V_j`,

\[
F_j=\tfrac12\rho V_j^2 A_j
\left[C_L(\alpha_j)(s_j\times\hat u_j)-C_D(\alpha_j)\hat u_j\right].
\]

At zero speed the force is zero. Lift is perpendicular to relative flow; drag opposes it. Stroke velocity therefore changes both the magnitude and direction of the aerodynamic force, allowing a moving wing to produce propulsion as well as lift.

### Lift, drag and separation

A smooth blend covers attached and separated flow:

\[
a=\frac{2\pi}{1+2/(e\,AR)},\quad
t=\operatorname{clamp}\left(\frac{|\alpha|-12^\circ}{13^\circ},0,1\right),\quad
f=t^2(3-2t),\quad C_{L,a}=a\alpha,
\]

\[
C_L=(1-f)C_{L,a}+f\,1.8\sin\alpha\cos\alpha,
\]

\[
C_D=0.012+(1-f)\,0.005C_{L,a}^2
+f\,1.8\sin^2\alpha
+(1-f)\frac{C_L^2}{\pi e\,AR}.
\]

Here `e = 0.8`; reference aspect ratios are 7 for wing strips and 2.57 for the tail. These are fixed model approximations, not aspect ratios recomputed from each narrow strip. Separation blends from 12° to 25°; the force model remains defined beyond stall.

### Tail and body drag

The tail uses the same strip-force calculation, with local velocity from body translation and rotation. Tail pitch changes incidence; cant rotates the force sideways for yaw control. Joint travel/rate limits and an angle-of-attack target bound constrain both.

Body drag acts at `r_b = (0,0,0.3) m`. For its local relative velocity `u_b = Rᵀ(v−w) + ω × r_b`,

\[
F_b=-\tfrac12\rho
\begin{bmatrix}
0.035|u_b|u_{b,x}\\
0.025|u_{b,y}|u_{b,y}\\
0.007|u_{b,z}|u_{b,z}
\end{bmatrix}.
\]

This force also contributes a moment about the center of mass.

## Feather and fold coordination

Coordination follows the remaining requested shoulder movement, so feathers can prepare even when shoulder movement is temporarily slowed. For each wing,

\[
d=\operatorname{clamp}\left(\frac{\theta^*-\theta_{\mathrm{previous}}}{10^\circ},-1,1\right),
\quad d_+=\max(d,0),\quad d_-=\max(-d,0).
\]

Wings that have finished returning and belong to assistance use `d = 0`. If `β_flow` is the local zero-angle-of-attack feather incidence, the nominal incidence is

\[
\beta_{\mathrm{nominal}}
=(1-d_+-d_-)4^\circ
+d_+(\beta_{\mathrm{flow}}+14^\circ)
+d_-\beta_{\mathrm{flow}}.
\]

Thus power strokes seek approximately 14° angle of attack, recovery seeks approximately zero, and held wings tend toward their 4° incidence. Recovery unloads both inner and outer strips; all strips retain steering offsets.

The nominal target is bounded relative to local flow before common/differential steering is added. Final feather targets seek angle of attack within ±14.5°, subject to feather travel and rate limits. These are targets, not guarantees during rapid changes or saturation. Steering state tracks the applied offset to avoid accumulating unusable correction.

During recovery, outer-wing fold follows `d₋ sin(πp) × 20°`, where `p` is normalized shoulder progress from baseline to the downstroke limit. Folding peaks partway through recovery and settles to zero at rest.

Feathering, folding and tail adjustment use finite response rates. No phase oscillator or elapsed-time flap schedule drives the shoulders.

## Attitude control and joint allocation

Pitch and bank targets come from controller posture. Proportional attitude-error feedback plus angular-rate damping requests bounded angular acceleration. A coordinated-turn yaw-rate request follows bank and airspeed, with sideslip correction; it does not hold a heading.

The allocator controls six joint quantities: common feather offset, differential feather offset, tail pitch, left shoulder, right shoulder and tail cant. At each step it evaluates actual aerodynamic loads and estimates how small joint changes affect them. A bounded least-squares solve seeks:

- The requested pitch, bank and yaw accelerations.
- Upward and forward body-axis forces close to those of the nominal coordinated stroke.
- Prepared feathers and limited unnecessary joint movement.

Feather and tail corrections are preferred over shoulder movement. Released shoulders are constrained to slow adjustments near the extended pose; manual shoulders stay within the player's proposed movement. Coupled shoulder solving preserves symmetry for symmetric inputs. A nonlinear load check accepts only an improvement over the current candidate.

This makes control authority depend on wing geometry, airflow and stall. It does not inject torque directly, set the body's orientation, or optimize a promised altitude/energy gain. All corrections act through the aerodynamic surfaces.

## Body integration and trim

Summing all surface forces, including the tail, gives world force and body moment:

\[
F_W=R\left(\sum_jF_j+F_b\right)-mg\hat y,
\qquad
M_B=\sum_jr_j\times F_j+r_b\times F_b.
\]

The rigid-body equations are

\[
\dot x=v,\qquad
m\dot v=F_W,\qquad
\dot\omega=I^{-1}\left(M_B-\omega\times I\omega\right).
\]

Fixed 120 Hz steps use semi-implicit velocity/position updates and a normalized quaternion increment from body angular velocity. Rendering interpolation never changes simulation state.

The initial level-body glide solves force balance and pitch moment for airspeed, descent angle and tail trim with extended wings. It begins at 80 m. Reaching a center height of 0.8 m ends the attempt; ground contact is not a landing solver.

## Shoulder torque, work and feedback

For shoulder position `h_i` and downstroke axis `a_i = (0,0,−σ_i)`,

\[
\tau_i=a_i\cdot\sum_{j\in i}(r_j-h_i)\times F_j,
\qquad
P_{\mathrm{stroke},i}=-\tau_i\dot\theta_i.
\]

This is aerodynamic torque about the shoulder, distinct from the total body roll moment. Upward lift on an extended wing opposes its downstroke, producing negative aerodynamic shoulder torque.

Total joint power includes folding as well as stroke motion:

\[
P_{\mathrm{joint}}=-\sum_jF_j\cdot\dot r_j,
\qquad
P_{\mathrm{air}}=\sum_jF_j\cdot u_j+F_b\cdot u_b\leq0.
\]

In still air, before ground contact, the mechanical energy budget is

\[
E=\tfrac12m|v|^2+mgy+\tfrac12\omega\cdot I\omega,
\qquad
\Delta E\approx\int(P_{\mathrm{joint}}+P_{\mathrm{air}})\,dt.
\]

The difference is numerical integration error. Cumulative joint work and aerodynamic loss are integrated from accepted loads at every physics step, excluding allocator trial evaluations.

Useful propulsion depends on the complete power-and-recovery cycle: positive downstroke work must exceed recovery and aerodynamic losses. Recovery unloading and the drag polar allow repeated manual strokes to sustain a climb. Pitch and airflow determine how that energy becomes speed or height. All joint movement, including posture assistance, participates in the work accounting; there is no separate thrust boost.

Trigger resistance uses `max(0, −τ_i)`, normalized by 2.2 N·m and scaled by the comfort ceiling. A 60 ms filter and hysteresis produce levels 0–8; default comfort limits output to level 4. Effects-off bypasses this load filter. Feedback strength does not alter the force model, and opposite-signed loads remain diagnostic values rather than bidirectional hardware torque.

## Model limits and verification

This is a quasi-steady approximation with prescribed wing motion and fixed body inertia. It omits wake history, wing interaction, detailed tail downwash, dynamic stall, added mass, feather flexibility and wing inertial reaction. It is not a species-validated model.

Focused checks cover dissipative drag, force/torque signs, trim, manual stroke ownership, attitude tracking, complete stroke-cycle energy, sustained climb, timestep sensitivity and render-rate independence. Energy is evaluated from full-rate work counters rather than sparsely sampled power peaks. These checks establish model behavior; physical controller feel is assessed through flight.
