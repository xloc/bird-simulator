import { Quaternion, Vector3 } from "three";
import { clamp, DEG, stripForce } from "./aerodynamics";
import { POSTURE, allocateJoints, postureAcceleration, attitudeAcceleration } from "./posture";

export const BIRD = {
  mass: 0.8,
  gravity: 9.81,
  inertia: new Vector3(0.035, 0.055, 0.045),
  shoulderX: 0.08,
  shoulderZ: -0.045,
  wingLength: 0.8,
  wingArea: 0.18,
  wingIncidence: 4 * DEG,
  wingDihedral: 5 * DEG,
  bodyDragZ: 0.3,
  tailZ: 0.8, // Balance stroke pitching moments with less tail force.
  tailArea: 0.1,
  powerAlpha: 14 * DEG,
  recoveryFold: 20 * DEG,
  tailAlpha: 16 * DEG,
  strokeDown: 75 * DEG,
  jointSpeed: 16,
  assistAngle: 15 * DEG,
  assistSpeed: 8 * DEG,
  featherCommonLimit: 22 * DEG, // Can unload the 14° power stroke and still correct pitch.
  featherDifferenceLimit: 14 * DEG,
  featherTrackingSpeed: 4320 * DEG,
  featherSpeed: 720 * DEG,
  tailLimit: 35 * DEG,
  tailSpeed: 720 * DEG,
  tailCantLimit: 30 * DEG, // Retain pitch authority when recovery reverses the tail load.
  tailCantSpeed: 720 * DEG,
  triggerEngage: 0.04,
  triggerRelease: 0.02,
};

export interface FlightInput {
  left: number; // Trigger travel, 0..1. Released shoulders belong to assistance.
  right: number;
  pitch: number; // Desired nose-up attitude, radians.
  roll: number; // Desired right bank, radians.
}
export const NEUTRAL_INPUT: FlightInput = { left: 0, right: 0, pitch: 0, roll: 0 };

export interface Surface {
  position: Vector3;
  previous: Vector3;
  velocity: Vector3;
  chord: Vector3;
  normal: Vector3;
  force: Vector3;
  area: number;
  width: number;
  chordLength: number;
  alpha: number;
  speed: number;
  separated: number;
  incidence: number;
}

export interface Wing {
  side: -1 | 1;
  angle: number;
  rate: number;
  fold: number;
  incidence: number;
  shoulder: Vector3;
  surfaces: Surface[];
  torque: number;
  power: number;
  manual: boolean;
  returning: boolean;
  baseline: number;
  target: number;
}

function surface(area: number, width: number): Surface {
  return {
    position: new Vector3(),
    previous: new Vector3(),
    velocity: new Vector3(),
    chord: new Vector3(0, 0, -1),
    normal: new Vector3(0, 1, 0),
    force: new Vector3(),
    area,
    width,
    chordLength: area / width,
    alpha: 0,
    speed: 0,
    separated: 0,
    incidence: BIRD.wingIncidence,
  };
}

function wing(side: -1 | 1, strips: number): Wing {
  return {
    side,
    angle: 0,
    rate: 0,
    fold: 0,
    incidence: BIRD.wingIncidence,
    shoulder: new Vector3(side * BIRD.shoulderX, 0, BIRD.shoulderZ),
    torque: 0,
    power: 0,
    manual: false,
    returning: false,
    baseline: 0,
    target: 0,
    surfaces: Array.from({ length: strips }, (_, j) => {
      const t = (j + 0.5) / strips;
      return surface((BIRD.wingArea / strips) * (1.4 - 0.8 * t), BIRD.wingLength / strips);
    }),
  };
}

/** Travel owns shoulder progress; feathering/folding provide different power and recovery paths. */
export function triggerAngle(value: number, baseline: number) {
  const u = clamp((value - BIRD.triggerRelease) / (1 - BIRD.triggerRelease), 0, 1);
  return baseline + u * (BIRD.strokeDown - baseline);
}

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

function setWingGeometry(w: Wing) {
  const stroke = new Quaternion().setFromAxisAngle(Z, -w.side * (w.angle - BIRD.wingDihedral));
  for (let j = 0; j < w.surfaces.length; j++) {
    const s = w.surfaces[j]!;
    const feather = new Quaternion().setFromAxisAngle(X, s.incidence);
    const t = (j + 0.5) / w.surfaces.length;
    const distance = BIRD.wingLength * t;
    const outer = distance > BIRD.wingLength * 0.5;
    const fold = new Quaternion().setFromAxisAngle(Z, outer ? w.side * w.fold : 0);
    s.position.set(w.side * (outer ? distance - BIRD.wingLength * 0.5 : distance), 0, 0);
    s.position.applyQuaternion(fold);
    if (outer) s.position.x += w.side * BIRD.wingLength * 0.5;
    s.position.z += 0.04 * t * t;
    s.position.applyQuaternion(stroke).add(w.shoulder);
    s.chord.set(0, 0, -1).applyQuaternion(feather).applyQuaternion(fold).applyQuaternion(stroke);
    s.normal.set(0, 1, 0).applyQuaternion(feather).applyQuaternion(fold).applyQuaternion(stroke);
  }
}

export class FlightModel {
  position = new Vector3(0, 80, 0);
  previousPosition = this.position.clone();
  velocity = new Vector3(0, -1, -10);
  orientation = new Quaternion();
  previousOrientation = new Quaternion();
  omega = new Vector3();
  wind = new Vector3();
  wings: [Wing, Wing];
  tail = surface(BIRD.tailArea, 0.34);
  tailTrim = 0;
  tailIncidence = 0;
  tailCant = 0;
  force = new Vector3();
  moment = new Vector3();
  jointPower = 0;
  aerodynamicPower = 0;
  jointWork = 0;
  aerodynamicWork = 0;
  time = 0;
  grounded = false;

  constructor(strips = 8) {
    this.wings = [wing(-1, strips), wing(1, strips)];
    this.tail.position.set(0, 0, BIRD.tailZ);
    this.trim();
    this.syncGeometry();
    this.loads();
  }

  private syncGeometry() {
    for (const w of this.wings) {
      for (const s of w.surfaces) s.incidence = w.incidence;
      setWingGeometry(w);
    }
    this.tail.chord
      .set(0, 0, -1)
      .applyAxisAngle(X, this.tailIncidence)
      .applyAxisAngle(Z, this.tailCant);
    this.tail.normal
      .set(0, 1, 0)
      .applyAxisAngle(X, this.tailIncidence)
      .applyAxisAngle(Z, this.tailCant);
    for (const s of this.surfaces) {
      s.previous.copy(s.position);
      s.velocity.set(0, 0, 0);
    }
  }

  get surfaces() {
    return [...this.wings[0].surfaces, ...this.wings[1].surfaces, this.tail];
  }

  private updateStroke(w: Wing, trigger: number) {
    if (!w.manual && trigger >= BIRD.triggerEngage) {
      if (!w.returning) w.baseline = w.angle;
      w.manual = true;
      w.returning = false;
    } else if (w.manual && trigger <= BIRD.triggerRelease) {
      w.manual = false;
      w.returning = true;
    }
    if (w.returning && Math.abs(w.angle - w.baseline) < 0.001 * DEG) w.returning = false;
    w.target = w.manual ? triggerAngle(trigger, w.baseline) : w.returning ? w.baseline : w.angle;
  }

  /** Preview/start/resume without inventing a fast stroke or recapturing a held pull. */
  synchronize(input: FlightInput) {
    for (const [i, w] of this.wings.entries()) {
      this.updateStroke(w, i === 0 ? input.left : input.right);
      w.angle = w.target;
      w.rate = 0;
      w.fold = 0;
    }
    this.syncGeometry();
    this.previousPosition.copy(this.position);
    this.previousOrientation.copy(this.orientation);
    this.loads();
  }

  private moveJoints(input: FlightInput, dt: number) {
    const airspeed = this.velocity
      .clone()
      .sub(this.wind)
      .applyQuaternion(this.orientation.clone().invert());
    const desired = postureAcceleration(
      this.orientation,
      this.omega,
      airspeed,
      input.pitch,
      input.roll,
      BIRD.gravity,
    );
    desired.y *= POSTURE.yawWeight;
    const gyroscopic = new Vector3().crossVectors(
      this.omega,
      this.omega.clone().multiply(BIRD.inertia),
    );
    for (const [i, w] of this.wings.entries())
      this.updateStroke(w, i === 0 ? input.left : input.right);
    const previous = this.wings.map((w) => ({
      angle: w.angle,
      fold: w.fold,
      feathers: w.surfaces.map((s) => s.incidence),
    }));
    const shoulders = this.wings.map((w) => {
      if (!w.manual && !w.returning) return w.angle;
      const distance = w.target - w.angle;
      const requested = clamp(distance / 0.04, -BIRD.jointSpeed, BIRD.jointSpeed);
      const rate = w.rate + (requested - w.rate) * (1 - Math.exp(-dt / 0.01));
      // A reversal can brake, but never moves beyond the user's current target.
      return w.angle + clamp(rate * dt, Math.min(0, distance), Math.max(0, distance));
    });
    // Common/differential feathering, tail pitch, two shoulders, then tail cant for yaw.
    const current = [
      (this.wings[0].incidence + this.wings[1].incidence) / 2 - BIRD.wingIncidence,
      (this.wings[1].incidence - this.wings[0].incidence) / 2,
      this.tailIncidence - this.tailTrim,
      ...shoulders,
      this.tailCant,
    ];
    const limits = [
      BIRD.featherCommonLimit,
      BIRD.featherDifferenceLimit,
      BIRD.tailLimit,
      BIRD.assistAngle,
      BIRD.assistAngle,
      BIRD.tailCantLimit,
    ];
    const speeds = [
      BIRD.featherSpeed,
      BIRD.featherSpeed,
      BIRD.tailSpeed,
      BIRD.assistSpeed,
      BIRD.assistSpeed,
      BIRD.tailCantSpeed,
    ];
    const lower = current.map((value, i) => Math.max(-limits[i]!, value - speeds[i]! * dt));
    const upper = current.map((value, i) => Math.min(limits[i]!, value + speeds[i]! * dt));
    const tailFlow = new Vector3().crossVectors(this.omega, this.tail.position).add(airspeed);
    const tailFlowAngle = Math.atan2(
      tailFlow.y * Math.cos(this.tailCant) - tailFlow.x * Math.sin(this.tailCant),
      -tailFlow.z,
    );
    const tailLower = this.tailTrim + lower[2]!,
      tailUpper = this.tailTrim + upper[2]!;
    // Seek attached flow within the actual joint travel/rate limits, including after a stall.
    lower[2] = clamp(tailFlowAngle - BIRD.tailAlpha, tailLower, tailUpper) - this.tailTrim;
    upper[2] = clamp(tailFlowAngle + BIRD.tailAlpha, tailLower, tailUpper) - this.tailTrim;
    current[2] = clamp(current[2]!, lower[2]!, upper[2]!);
    for (let i = 0; i < 2; i++) {
      if (this.wings[i]!.manual || this.wings[i]!.returning) {
        // Preparation may slow the requested motion, never reverse it or add a stroke.
        lower[i + 3] = Math.min(previous[i]!.angle, shoulders[i]!);
        upper[i + 3] = Math.max(previous[i]!.angle, shoulders[i]!);
      }
    }

    // Every probe starts from the same joint state. Only the accepted geometry is integrated.
    const evaluate = (joints: number[]) => {
      const tracking = [0, 0];
      for (const [i, w] of this.wings.entries()) {
        const before = previous[i]!;
        w.angle = joints[i + 3]!;
        w.rate = (w.angle - before.angle) / dt;
        // Intent drives preparation even when the shoulder waits for its feathers.
        const drive = w.manual || w.returning ? (w.target - before.angle) / (10 * DEG) : 0;
        const up = clamp(-drive, 0, 1),
          down = clamp(drive, 0, 1);
        const progress = clamp((w.angle - w.baseline) / (BIRD.strokeDown - w.baseline), 0, 1);
        w.fold =
          before.fold +
          (up * Math.sin(Math.PI * progress) * BIRD.recoveryFold - before.fold) *
            (1 - Math.exp(-dt / 0.02));
        const offset = joints[0]! + w.side * joints[1]!;
        w.incidence = BIRD.wingIncidence + offset;
        for (const [j, s] of w.surfaces.entries()) s.incidence = before.feathers[j]!;
        setWingGeometry(w);
        let appliedOffset = 0;
        for (const s of w.surfaces) {
          s.velocity.copy(s.position).sub(s.previous).divideScalar(dt);
          const flow = new Vector3()
            .crossVectors(this.omega, s.position)
            .add(airspeed)
            .add(s.velocity);
          const flowAngle = Math.atan2(flow.dot(s.normal), flow.dot(s.chord)) + s.incidence;
          // Keep nominal feathering out of stall before adding the steering offset,
          // so a stalled/clipped base angle cannot swallow corrective travel.
          // Unload the returning wing: upward lift on an upward-moving wing
          // takes back stroke work. Every feather retains steering authority.
          const nominal =
            (1 - up - down) * BIRD.wingIncidence +
            up * flowAngle +
            down * (flowAngle + BIRD.powerAlpha);
          const base = clamp(nominal, flowAngle - 14 * DEG, flowAngle + 14 * DEG);
          const attachedTarget = clamp(
            base + offset,
            flowAngle - 14.5 * DEG,
            flowAngle + 14.5 * DEG,
          );
          appliedOffset += (attachedTarget - base) * s.area;
          s.incidence += clamp(
            clamp(attachedTarget, -70 * DEG, 70 * DEG) - s.incidence,
            -BIRD.featherTrackingSpeed * dt,
            BIRD.featherTrackingSpeed * dt,
          );
          tracking[i]! +=
            ((clamp(attachedTarget, -70 * DEG, 70 * DEG) - s.incidence) ** 2 * s.area) /
            BIRD.wingArea;
        }
        // Keep the steering state at the achieved feather offset. Otherwise a
        // saturated offset can hide all subsequent corrective travel from the solver.
        w.incidence = BIRD.wingIncidence + appliedOffset / BIRD.wingArea;
        setWingGeometry(w);
      }
      this.tailCant = joints[5]!;
      const tailAngle = Math.atan2(
        tailFlow.y * Math.cos(this.tailCant) - tailFlow.x * Math.sin(this.tailCant),
        -tailFlow.z,
      );
      this.tailIncidence = clamp(
        this.tailTrim + joints[2]!,
        clamp(tailAngle - BIRD.tailAlpha, tailLower, tailUpper),
        clamp(tailAngle + BIRD.tailAlpha, tailLower, tailUpper),
      );
      this.tail.chord
        .set(0, 0, -1)
        .applyAxisAngle(X, this.tailIncidence)
        .applyAxisAngle(Z, this.tailCant);
      this.tail.normal
        .set(0, 1, 0)
        .applyAxisAngle(X, this.tailIncidence)
        .applyAxisAngle(Z, this.tailCant);
      this.loads();
      const acceleration = attitudeAcceleration(
        this.orientation,
        this.omega,
        this.moment.clone().sub(gyroscopic).divide(BIRD.inertia),
      );
      acceleration.y *= POSTURE.yawWeight;
      const force = this.force
        .clone()
        .addScaledVector(Y, BIRD.mass * BIRD.gravity)
        .applyQuaternion(this.orientation.clone().invert())
        .multiplyScalar(POSTURE.forceWeight / BIRD.mass);
      return [
        ...acceleration.toArray(),
        force.y,
        -force.z,
        ...tracking.map((error) => POSTURE.featherPreparationWeight * Math.sqrt(error)),
      ];
    };
    // Prefer feathering/tail corrections. Penalize assisted shoulder speed so it settles
    // into a pose instead of supplying repetitive flaps or cancelling a manual stroke.
    const shoulderRateCost = POSTURE.shoulderRateCost / (dt * dt);
    const shoulderCost = shoulderRateCost + POSTURE.shoulderPoseCost;
    const nominal = evaluate([0, 0, current[2]!, ...shoulders, current[5]!]);
    const joints = allocateJoints(
      current,
      lower,
      upper,
      [
        POSTURE.commonFeatherCost,
        POSTURE.differentialFeatherCost,
        POSTURE.tailCost,
        ...this.wings.map((w) =>
          w.manual || w.returning ? POSTURE.strokeRateCost / (dt * dt) : shoulderCost,
        ),
        POSTURE.tailCost,
      ],
      [
        0,
        0,
        0,
        ...previous.map((w, i) =>
          this.wings[i]!.manual || this.wings[i]!.returning
            ? shoulders[i]!
            : (w.angle * shoulderRateCost) / shoulderCost,
        ),
        0,
      ],
      [...desired.toArray(), nominal[3]!, nominal[4]!, 0, 0],
      evaluate,
    );
    evaluate(joints);
    for (const w of this.wings) {
      if (!w.manual && !w.returning) {
        w.baseline = w.angle;
        w.target = w.angle;
      }
    }
    for (const s of this.surfaces) s.previous.copy(s.position);
  }

  /** Sum surface forces and moments in body coordinates, then rotate total force. */
  loads() {
    const inverse = this.orientation.clone().invert();
    const airspeed = this.velocity.clone().sub(this.wind).applyQuaternion(inverse);
    const bodyForce = new Vector3();
    this.moment.set(0, 0, 0);
    this.jointPower = 0;
    this.aerodynamicPower = 0;
    for (const s of this.surfaces) {
      const flow = new Vector3().crossVectors(this.omega, s.position).add(airspeed).add(s.velocity);
      const result = stripForce(flow, s.chord, s.normal, s.area, s === this.tail ? 2.57 : 7);
      s.force.copy(result.force);
      s.alpha = result.alpha;
      s.speed = result.speed;
      s.separated = result.separated;
      bodyForce.add(s.force);
      this.moment.add(new Vector3().crossVectors(s.position, s.force));
      this.jointPower -= s.force.dot(s.velocity);
      this.aerodynamicPower += s.force.dot(flow);
    }
    // Aft body side area produces passive yaw damping/weathercock stability.
    const dragPoint = new Vector3(0, 0, BIRD.bodyDragZ);
    const bodyFlow = new Vector3().crossVectors(this.omega, dragPoint).add(airspeed);
    const drag = bodyFlow
      .clone()
      .multiply(
        new Vector3(
          bodyFlow.length() * 0.035,
          Math.abs(bodyFlow.y) * 0.025,
          Math.abs(bodyFlow.z) * 0.007,
        ),
      )
      .multiplyScalar(-0.5 * 1.225);
    bodyForce.add(drag);
    this.moment.add(new Vector3().crossVectors(dragPoint, drag));
    this.aerodynamicPower += drag.dot(bodyFlow);
    for (const w of this.wings) {
      w.torque = 0;
      for (const s of w.surfaces) {
        const moment = new Vector3().crossVectors(s.position.clone().sub(w.shoulder), s.force);
        w.torque += -w.side * moment.z;
      }
      w.power = -w.torque * w.rate;
    }
    this.force.copy(bodyForce).applyQuaternion(this.orientation);
    this.force.y -= BIRD.mass * BIRD.gravity;
  }

  step(input: FlightInput, dt: number) {
    if (this.grounded) return;
    this.previousPosition.copy(this.position);
    this.previousOrientation.copy(this.orientation);
    this.moveJoints(input, dt);
    // Integrate only accepted loads, never the allocator's trial poses.
    this.jointWork += this.jointPower * dt;
    this.aerodynamicWork += this.aerodynamicPower * dt;
    this.velocity.addScaledVector(this.force, dt / BIRD.mass);
    this.position.addScaledVector(this.velocity, dt);
    const angularMomentum = this.omega.clone().multiply(BIRD.inertia);
    const acceleration = this.moment
      .clone()
      .sub(new Vector3().crossVectors(this.omega, angularMomentum))
      .divide(BIRD.inertia);
    this.omega.addScaledVector(acceleration, dt);
    const rate = this.omega.length();
    if (rate > 0)
      this.orientation
        .multiply(
          new Quaternion().setFromAxisAngle(this.omega.clone().divideScalar(rate), rate * dt),
        )
        .normalize();
    this.time += dt;
    if (this.position.y <= 0.8) {
      this.position.y = 0.8;
      this.grounded = true;
    }
  }

  get energy() {
    return (
      0.5 * BIRD.mass * this.velocity.lengthSq() +
      BIRD.mass * BIRD.gravity * this.position.y +
      0.5 * this.omega.dot(this.omega.clone().multiply(BIRD.inertia))
    );
  }

  /** Solve force balance and pitch moment for a descending, level-body glide. */
  private trim() {
    this.syncGeometry();
    let speed = 10;
    let descent = 0.08;
    let tail = -0.03;
    const residual = (v: number, gamma: number, beta: number) => {
      this.velocity.set(0, -v * Math.sin(gamma), -v * Math.cos(gamma));
      this.tailIncidence = beta;
      this.syncGeometry();
      this.loads();
      return [this.force.y, this.force.z, this.moment.x];
    };
    for (let iteration = 0; iteration < 15; iteration++) {
      const f = residual(speed, descent, tail);
      if (Math.hypot(...f) < 1e-9) break;
      const v = residual(speed + 0.001, descent, tail);
      const g = residual(speed, descent + 0.0001, tail);
      const b = residual(speed, descent, tail + 0.0001);
      const rows = f.map((r, i) => [
        (v[i]! - r) / 0.001,
        (g[i]! - r) / 0.0001,
        (b[i]! - r) / 0.0001,
        -r,
      ]);
      for (let col = 0; col < 3; col++) {
        const pivot = rows[col]![col]!;
        if (Math.abs(pivot) < 1e-10) throw new Error("Glide trim is singular");
        for (let j = col; j < 4; j++) rows[col]![j]! /= pivot;
        for (let i = 0; i < 3; i++) {
          if (i === col) continue;
          const factor = rows[i]![col]!;
          for (let j = col; j < 4; j++) rows[i]![j]! -= factor * rows[col]![j]!;
        }
      }
      speed = clamp(speed + rows[0]![3]!, 4, 20);
      descent = clamp(descent + rows[1]![3]!, 0.01, 0.3);
      tail = clamp(tail + rows[2]![3]!, -0.3, 0.3);
    }
    this.tailTrim = tail;
    if (Math.hypot(...residual(speed, descent, tail)) > 0.001)
      throw new Error("Could not trim initial glide");
  }
}
