import { describe, expect, it } from "vite-plus/test";
import { Vector3 } from "three";
import { BIRD, GROUND, FlightModel, NEUTRAL_INPUT } from "./model";
import type { FlightInput, GroundInput } from "./model";
import { DEG } from "./aerodynamics";
import { LEGS, legPose } from "./legs";

const dt = 1 / 120;
const idle = { x: 0, z: 0, jump: false };
function landed(input: FlightInput = NEUTRAL_INPUT) {
  const bird = new FlightModel();
  bird.position.set(100, GROUND.height + 0.01, 0);
  bird.velocity.set(0, -3, 0);
  bird.step(input, dt);
  expect(bird.grounded).toBe(true);
  return bird;
}
function advance(
  bird: FlightModel,
  seconds: number,
  input = NEUTRAL_INPUT,
  ground: GroundInput = idle,
) {
  for (let i = 0; i < seconds / dt; i++) bird.step(input, dt, ground);
}

describe("ground locomotion", () => {
  it("absorbs a hard landing, settles upright, and keeps walking without stopping time", () => {
    const bird = new FlightModel();
    bird.position.set(100, GROUND.height + 0.01, 0);
    bird.velocity.set(0, -20, -8);
    bird.orientation.setFromAxisAngle(new Vector3(0, 0, 1), 1);
    bird.step(NEUTRAL_INPUT, dt);
    expect(bird.grounded).toBe(true);
    expect(bird.velocity.y).toBe(0);
    expect(Math.abs(bird.velocity.z)).toBeLessThanOrEqual(GROUND.walkSpeed);
    expect(bird.position.y).toBeLessThan(GROUND.height);
    advance(bird, 1.5);
    expect(bird.position.y).toBe(GROUND.height);
    expect(bird.velocity.length()).toBeLessThan(0.001);
    expect(
      new Vector3(0, 1, 0).applyQuaternion(bird.orientation).distanceTo(new Vector3(0, 1, 0)),
    ).toBeLessThan(0.01);
    expect(bird.wings.every((w) => w.fold > 100 * DEG && w.torque === 0)).toBe(true);
    const x = bird.position.x;
    advance(bird, 1, { ...NEUTRAL_INPUT, pitch: 0.5, roll: 0.8 }, { x: 1, z: 0, jump: false });
    expect(bird.position.x - x).toBeGreaterThan(1.4);
    expect(bird.velocity.length()).toBeCloseTo(GROUND.walkSpeed);
    expect(bird.heading).toBeCloseTo(-Math.PI / 2, 2);
    expect(bird.time).toBeGreaterThan(2.5);
  });

  it("plants supporting feet, keeps both links connected, and brakes without coasting", () => {
    const bird = landed();
    for (let i = 0; i < 480; i++) {
      const feet = bird.legs.feet.map((f) => ({
        position: f.position.clone(),
        planted: f.planted,
      }));
      bird.step(NEUTRAL_INPUT, dt, {
        x: i < 240 ? 0 : i < 360 ? 1 : -1,
        z: i < 240 ? -1 : 0,
        jump: false,
      });
      expect(bird.legs.feet.some((f) => f.planted)).toBe(true);
      for (const [index, foot] of bird.legs.feet.entries()) {
        if (foot.planted && feet[index]!.planted)
          expect(foot.position.distanceTo(feet[index]!.position)).toBe(0);
        const target = foot.position
          .clone()
          .sub(bird.position)
          .applyQuaternion(bird.orientation.clone().invert());
        const pose = legPose(foot.side, target);
        expect(pose.hip.distanceTo(pose.joint)).toBeCloseTo(LEGS.upper, 8);
        expect(pose.joint.distanceTo(pose.ankle)).toBeCloseTo(LEGS.lower, 8);
        expect(
          pose.ankle.distanceTo(target),
          `step ${i}, foot ${index}, target ${target.toArray().join(", ")}`,
        ).toBeLessThan(0.001);
        expect(foot.position.y).toBeGreaterThanOrEqual(LEGS.footHeight - 1e-9);
      }
    }
    const stop = bird.position.clone();
    advance(bird, 0.15);
    expect(bird.velocity.length()).toBe(0);
    expect(Math.hypot(bird.position.x - stop.x, bird.position.z - stop.z)).toBeLessThan(0.07);
  });

  it("charges in a planted crouch, jumps on release and preserves walking momentum", () => {
    const bird = landed();
    const walk = { x: 0, z: -1, jump: true };
    advance(bird, GROUND.chargeTime, NEUTRAL_INPUT, walk);
    expect(bird.grounded).toBe(true);
    expect(bird.jumpCharge).toBeCloseTo(1);
    expect(bird.position.y).toBeLessThanOrEqual(GROUND.height - GROUND.crouchDepth);
    const speed = bird.velocity.z;
    bird.step(NEUTRAL_INPUT, dt);
    expect(bird.phase).toBe("hopping");
    expect(bird.velocity.z).toBeCloseTo(speed);
    const velocity = bird.velocity.y;
    advance(bird, 0.1);
    expect(bird.velocity.y).toBeCloseTo(velocity - BIRD.gravity * 0.1);
    advance(bird, 1);
    expect(bird.grounded).toBe(true);
  });

  it("makes short taps small hops and full charges higher jumps, without auto-repeating", () => {
    const heights: number[] = [];
    for (const hold of [dt, GROUND.chargeTime]) {
      const bird = landed();
      advance(bird, 0.5);
      const feet = bird.legs.feet.map((f) => f.position.clone());
      advance(bird, hold, NEUTRAL_INPUT, { ...idle, jump: true });
      expect(bird.grounded).toBe(true);
      bird.legs.feet.forEach((f, i) => expect(f.position.equals(feet[i]!)).toBe(true));
      bird.step(NEUTRAL_INPUT, dt);
      let maxHeight = bird.position.y;
      let airtime = dt;
      while (!bird.grounded && airtime < 2) {
        // A press in the air must not queue a new jump at touchdown.
        bird.step(NEUTRAL_INPUT, dt, { ...idle, jump: true });
        maxHeight = Math.max(maxHeight, bird.position.y);
        airtime += dt;
      }
      expect(airtime).toBeLessThan(hold === dt ? 0.4 : 0.85);
      expect(bird.grounded).toBe(true);
      advance(bird, 0.3, NEUTRAL_INPUT, { ...idle, jump: true });
      bird.step(NEUTRAL_INPUT, dt);
      expect(bird.grounded).toBe(true);
      heights.push(maxHeight - GROUND.height);
    }
    expect(heights[0]).toBeCloseTo(GROUND.minJumpHeight, 1);
    expect(heights[1]).toBeCloseTo(GROUND.maxJumpHeight, 1);
  });

  it("discards an unfinished charge when pausing or resuming", () => {
    const bird = landed();
    advance(bird, 0.3, NEUTRAL_INPUT, { ...idle, jump: true });
    bird.synchronize(NEUTRAL_INPUT, { ...idle, jump: true });
    bird.step(NEUTRAL_INPUT, dt);
    expect(bird.grounded).toBe(true);
    expect(bird.jumpCharge).toBe(0);
  });

  it("requires a fresh coordinated stroke after touchdown, allowing slightly staggered fingers", () => {
    const pull = { ...NEUTRAL_INPUT, left: 1, right: 1 };
    const bird = landed(pull);
    advance(bird, 0.5, pull);
    expect(bird.grounded).toBe(true);
    bird.step(NEUTRAL_INPUT, dt);
    advance(bird, 0.05, { ...pull, right: 0 });
    expect(bird.grounded).toBe(true);
    bird.step(pull, dt);
    expect(bird.phase).toBe("launching");
    expect(bird.velocity.y).toBeCloseTo(GROUND.launchSpeed - BIRD.gravity * dt);
    advance(bird, 0.2, pull);
    expect(bird.phase).toBe("flying");
    expect(bird.wings.every((w) => w.manual)).toBe(true);
  });

  it("does not add a second leg impulse when wings engage during a jump", () => {
    const bird = landed();
    advance(bird, GROUND.chargeTime, NEUTRAL_INPUT, { ...idle, jump: true });
    bird.step(NEUTRAL_INPUT, dt);
    const velocity = bird.velocity.clone();
    bird.step({ ...NEUTRAL_INPUT, left: 1, right: 1 }, dt, { ...idle, jump: true });
    expect(bird.phase).toBe("launching");
    expect(bird.velocity.y).toBeCloseTo(velocity.y - BIRD.gravity * dt);
    expect(bird.velocity.z).toBe(velocity.z);
    advance(bird, 0.3, { ...NEUTRAL_INPUT, left: 1, right: 1 });
    expect(bird.phase).toBe("flying");
    expect(bird.wings.every((w) => w.manual)).toBe(true);
    expect(bird.jointWork).toBeGreaterThan(0);
  });

  it.each([0, 10])("maintains one continuous standing takeoff at %s° pitch", (pitch) => {
    const bird = landed();
    advance(bird, 1);
    let maxHeight = bird.position.y;
    for (let i = 0; i < 5 / dt; i++) {
      const stroke = i % 60 < 30 ? 1 : 0;
      bird.step({ ...NEUTRAL_INPUT, left: stroke, right: stroke, pitch: pitch * DEG }, dt);
      maxHeight = Math.max(maxHeight, bird.position.y);
      expect(bird.grounded).toBe(false);
    }
    expect(maxHeight).toBeGreaterThan(2);
    expect(bird.phase).toBe("flying");
    expect(bird.position.y).toBeGreaterThan(1);
  });
  it("preserves enough momentum for a jump-launch to continue into flight", () => {
    const bird = landed();
    advance(bird, GROUND.chargeTime, NEUTRAL_INPUT, { ...idle, jump: true });
    bird.velocity.z = -7;
    bird.step(NEUTRAL_INPUT, dt);
    advance(bird, 0.12);
    for (let i = 0; i < 3 / dt; i++) {
      const stroke = i % 60 < 30 ? 1 : 0;
      bird.step({ ...NEUTRAL_INPUT, left: stroke, right: stroke }, dt);
      expect(bird.grounded).toBe(false);
    }
    expect(bird.phase).toBe("flying");
    expect(bird.position.y).toBeGreaterThan(1);
  });
});
