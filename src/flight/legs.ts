import { Quaternion, Vector3 } from "three";
import { clamp } from "./aerodynamics";

export const LEGS = {
  standingHeight: 0.4,
  upper: 0.19,
  lower: 0.21,
  hipX: 0.075,
  hipY: -0.08,
  hipZ: 0.08,
  footHeight: 0.012,
  footZ: 0.035,
  stepTime: 0.12,
  stepHeight: 0.065,
};

/** Two fixed-length links, with the visible joint bending toward the tail. */
export function legPose(side: number, foot: Vector3) {
  const hip = new Vector3(side * LEGS.hipX, LEGS.hipY, LEGS.hipZ);
  const direction = foot.clone().sub(hip);
  const distance = clamp(direction.length(), 0.025, LEGS.upper + LEGS.lower - 0.001);
  direction.normalize();
  const ankle = hip.clone().addScaledVector(direction, distance);
  const along = (LEGS.upper ** 2 - LEGS.lower ** 2 + distance ** 2) / (2 * distance);
  const bend = new Vector3(0, 0, 1).addScaledVector(direction, -direction.z).normalize();
  const joint = hip
    .clone()
    .addScaledVector(direction, along)
    .addScaledVector(bend, Math.sqrt(Math.max(0, LEGS.upper ** 2 - along ** 2)));
  return { hip, joint, ankle };
}

/** Stance feet stay in world space; only one foot swings at a time. */
export class BirdLegs {
  feet = [-1, 1].map((side) => ({
    side,
    position: new Vector3(),
    previous: new Vector3(),
    from: new Vector3(),
    target: new Vector3(),
    progress: 1,
    planted: false,
  }));
  private airTime = 1;
  private extension = 1;
  private groundHeight = 0;

  private standingFoot(side: number, position: Vector3, orientation: Quaternion) {
    const foot = new Vector3(side * LEGS.hipX, 0, LEGS.footZ)
      .applyQuaternion(orientation)
      .add(position);
    foot.y = this.groundHeight + LEGS.footHeight;
    return foot;
  }

  plant(position: Vector3, orientation: Quaternion, groundHeight = 0) {
    this.groundHeight = groundHeight;
    for (const foot of this.feet) {
      foot.position.copy(this.standingFoot(foot.side, position, orientation));
      foot.previous.copy(foot.position);
      foot.progress = 1;
      foot.planted = true;
    }
    this.airTime = 0;
    this.extension = 1;
  }

  get bob() {
    const swing = this.feet.find((foot) => !foot.planted);
    return swing ? -0.012 * Math.sin(swing.progress * Math.PI) : 0;
  }

  supportHeight(position: Vector3, orientation: Quaternion) {
    let height = position.y;
    for (const foot of this.feet) {
      const hip = new Vector3(foot.side * LEGS.hipX, LEGS.hipY, LEGS.hipZ)
        .applyQuaternion(orientation)
        .add(position);
      const span = Math.hypot(foot.position.x - hip.x, foot.position.z - hip.z);
      const reach = LEGS.upper + LEGS.lower - 0.02;
      const rise = Math.sqrt(Math.max(0, reach * reach - span * span));
      height = Math.min(height, foot.position.y + rise - (hip.y - position.y));
    }
    return height;
  }

  step(
    position: Vector3,
    orientation: Quaternion,
    velocity: Vector3,
    grounded: boolean,
    dt: number,
    groundHeight = 0,
  ) {
    this.groundHeight = groundHeight;
    for (const foot of this.feet) foot.previous.copy(foot.position);
    if (!grounded) {
      this.airTime += dt;
      const deployed = this.airTime < 0.06 || (velocity.y < 0 && position.y - groundHeight < 1.1);
      this.extension += ((deployed ? 1 : 0) - this.extension) * (1 - Math.exp(-30 * dt));
      for (const foot of this.feet) {
        const target = new Vector3(
          foot.side * LEGS.hipX,
          -0.16 + (LEGS.footHeight - LEGS.standingHeight + 0.16) * this.extension,
          0.24 + (LEGS.footZ - 0.24) * this.extension,
        )
          .applyQuaternion(orientation)
          .add(position);
        target.y = Math.max(groundHeight + LEGS.footHeight, target.y);
        foot.position.copy(target);
        foot.progress = 1;
        foot.planted = false;
      }
      return;
    }
    if (this.airTime > 0) this.plant(position, orientation, groundHeight);
    this.airTime = 0;
    const swing = this.feet.find((foot) => !foot.planted);
    if (swing) {
      swing.progress = Math.min(1, swing.progress + dt / LEGS.stepTime);
      const t = swing.progress;
      swing.position.lerpVectors(swing.from, swing.target, t * t * (3 - 2 * t));
      swing.position.y += Math.sin(t * Math.PI) * LEGS.stepHeight;
      swing.planted = t === 1;
      return;
    }
    const moving = Math.hypot(velocity.x, velocity.z) > 0.03;
    const candidates = this.feet
      .map((foot) => {
        const target = this.standingFoot(foot.side, position, orientation);
        target.addScaledVector(velocity, LEGS.stepTime * 1.5);
        target.y = groundHeight + LEGS.footHeight;
        return { foot, target, distance: foot.position.distanceTo(target) };
      })
      .sort((a, b) => b.distance - a.distance);
    const next = candidates[0]!;
    if (next.distance > (moving ? 0.14 : 0.035)) {
      next.foot.from.copy(next.foot.position);
      next.foot.target.copy(next.target);
      next.foot.progress = 0;
      next.foot.planted = false;
    }
  }
}
