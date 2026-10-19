import { Vector3 } from "three";
import { clamp, DEG } from "./aerodynamics";
import type { FlightModel } from "./model";

/** Stick position sets a temporary look angle in every locomotion mode. */
export class BirdCamera {
  yaw = 0;
  pitch = 20 * DEG;
  position = new Vector3();
  target = new Vector3();
  previousPosition = new Vector3();
  previousTarget = new Vector3();
  private distance = 4.6;
  private lead = 0.6;
  private walkYaw: number | null = null;

  reset(bird: FlightModel) {
    this.yaw = bird.heading;
    this.pitch = 20 * DEG;
    this.distance = bird.flying ? 4.6 : 2.4;
    this.lead = bird.flying ? 0.6 : 0;
    this.walkYaw = null;
    this.place(bird);
    this.previousPosition.copy(this.position);
    this.previousTarget.copy(this.target);
  }

  /** Keep a held movement direction steady while the view follows the turning bird. */
  walkingDirection(x: number, y: number) {
    if (x === 0 && y === 0) {
      this.walkYaw = null;
      return { x: 0, z: 0 };
    }
    this.walkYaw ??= this.yaw;
    const length = Math.max(1, Math.hypot(x, y));
    return {
      x: (x * Math.cos(this.walkYaw) + y * Math.sin(this.walkYaw)) / length,
      z: (-x * Math.sin(this.walkYaw) + y * Math.cos(this.walkYaw)) / length,
    };
  }

  step(bird: FlightModel, lookX: number, lookY: number, dt: number) {
    this.previousPosition.copy(this.position);
    this.previousTarget.copy(this.target);
    this.yaw = bird.heading - lookX * 120 * DEG;
    this.pitch = clamp((20 + lookY * 45) * DEG, -30 * DEG, 70 * DEG);
    // Ease only the change in framing on takeoff/landing, never the look input or follow position.
    const blend = 1 - Math.exp(-8 * dt);
    this.distance += ((bird.flying ? 4.6 : 2.4) - this.distance) * blend;
    this.lead += ((bird.flying ? 0.6 : 0) - this.lead) * blend;
    this.place(bird);
  }

  private place(bird: FlightModel) {
    const anchor = bird.position.clone().add(new Vector3(0, 0.12, 0));
    this.target.copy(anchor);
    this.target.add(
      new Vector3(-Math.sin(bird.heading), 0, -Math.cos(bird.heading)).multiplyScalar(this.lead),
    );
    this.target.copy(bird.world.cameraPosition(anchor, this.target));
    const offset = new Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).multiplyScalar(this.distance);
    this.position.copy(bird.world.cameraPosition(this.target, this.target.clone().add(offset)));
    this.position.y = Math.max(0.35, this.position.y);
  }
}
