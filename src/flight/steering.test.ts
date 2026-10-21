import { expect, it } from "vite-plus/test";
import { Euler } from "three";
import { BIRD, FlightModel, NEUTRAL_INPUT } from "./model";
import { DEG } from "./aerodynamics";

it("approaches a held pitch/bank target and returns toward level without flapping", () => {
  const f = new FlightModel();
  const target = { ...NEUTRAL_INPUT, pitch: 10 * DEG, roll: 20 * DEG };
  f.step(target, 1 / 120);
  expect(f.orientation.angleTo(f.previousOrientation)).toBeLessThan(DEG);
  for (let i = 1; i < 120 * 8; i++) f.step(target, 1 / 120);
  const held = new Euler().setFromQuaternion(f.orientation, "YXZ");
  expect(Math.abs(held.x / DEG - 10)).toBeLessThan(5);
  expect(Math.abs(-held.z / DEG - 20)).toBeLessThan(5);
  for (let i = 0; i < 120 * 8; i++) f.step(NEUTRAL_INPUT, 1 / 120);
  const level = new Euler().setFromQuaternion(f.orientation, "YXZ");
  expect(Math.abs(level.x / DEG)).toBeLessThan(5);
  expect(Math.abs(level.z / DEG)).toBeLessThan(5);
  for (const wing of f.wings) {
    expect(wing.manual || wing.returning).toBe(false);
    expect(Math.abs(wing.angle)).toBeLessThanOrEqual(BIRD.assistAngle);
    expect(Math.abs(wing.rate)).toBeLessThan(DEG);
  }
});

it("keeps bank near level after a small disturbance at the maximum pitch request", () => {
  const f = new FlightModel();
  f.orientation.setFromEuler(new Euler(0, 0, -DEG, "YXZ"));
  f.synchronize(NEUTRAL_INPUT);
  for (let i = 0; i < 120 * 12; i++) {
    f.step({ ...NEUTRAL_INPUT, pitch: 30 * DEG }, 1 / 120);
    const pose = new Euler().setFromQuaternion(f.orientation, "YXZ");
    expect(Math.abs(pose.z / DEG)).toBeLessThan(5);
  }
  const pose = new Euler().setFromQuaternion(f.orientation, "YXZ");
  expect(Math.abs(pose.x / DEG - 30)).toBeLessThan(3);
  expect(f.grounded).toBe(false);
});

it("recovers from abrupt independent strokes without losing the held attitude", () => {
  const f = new FlightModel();
  const target = { ...NEUTRAL_INPUT, pitch: 8 * DEG };
  for (let i = 0; i < 360; i++) f.step(target, 1 / 120);
  // Full pulls, partial reversals and releases, like a controller sampled at 60 Hz.
  const strokes = [
    [1, 1],
    [1, 1],
    [0, 0],
    [0, 0],
    [1, 0],
    [0.68, 0],
    [0, 0],
    [0, 0],
    [0, 1],
    [0, 1],
    [0, 0],
    [0, 0],
    [1, 1],
    [1, 1],
    [0, 0],
    [0, 0],
  ];
  for (let i = 0; i < 120 * 6; i++) {
    const [left, right] = strokes[Math.floor(i / 12)] ?? [0, 0];
    f.step({ ...target, left: left!, right: right! }, 1 / 120);
    const pose = new Euler().setFromQuaternion(f.orientation, "YXZ");
    expect(Math.abs(pose.z / DEG)).toBeLessThan(20);
    expect(Math.abs(pose.x / DEG - 8)).toBeLessThan(20);
  }
  const pose = new Euler().setFromQuaternion(f.orientation, "YXZ");
  expect(Math.abs(pose.x / DEG - 8)).toBeLessThan(3);
  expect(Math.abs(pose.z / DEG)).toBeLessThan(3);
  expect(f.grounded).toBe(false);
});

it("keeps pitch and bank bounded through slow strokes at maximum nose-up attitude", () => {
  const f = new FlightModel();
  const target = { ...NEUTRAL_INPUT, pitch: 30 * DEG };
  for (let i = 0; i < 600; i++) f.step(target, 1 / 120);
  for (let i = 0; i < 2400; i++) {
    const pull = (1 - Math.cos((Math.floor(i / 2) / 60) * 3 * Math.PI)) / 2;
    f.step({ ...target, left: pull, right: pull }, 1 / 120);
    const pose = new Euler().setFromQuaternion(f.orientation, "YXZ");
    expect(Math.abs(pose.z / DEG)).toBeLessThan(5);
    expect(Math.abs(pose.x / DEG - 30)).toBeLessThan(8);
  }
  expect(f.grounded).toBe(false);
});

it.each([
  { pitch: 15, delay: 0.06 },
  { pitch: 30, delay: 0.03 },
  { pitch: 30, delay: 0.06 },
])("coordinates staggered strokes at $pitch° pitch with a $delay s delay", ({ pitch, delay }) => {
  const f = new FlightModel();
  // The flight log had slightly different post-launch shoulder baselines.
  for (const [i, wing] of f.wings.entries()) wing.angle = wing.baseline = (-15 + i * 3.2) * DEG;
  f.synchronize(NEUTRAL_INPUT);
  for (let i = 0; i < 120 * 18; i++) {
    const t = i / 120;
    f.step(
      {
        left: Number(t % 0.6 < 0.21),
        right: Number((t + 0.6 - delay) % 0.6 < 0.21),
        pitch: pitch * DEG,
        roll: 0,
      },
      1 / 120,
    );
    if (i < 120 * 4) continue;
    const pose = new Euler().setFromQuaternion(f.orientation, "YXZ");
    const air = f.velocity.clone().applyQuaternion(f.orientation.clone().invert());
    expect(Math.abs(Math.atan2(air.x, -air.z) / DEG)).toBeLessThan(10);
    expect(Math.abs(pose.z / DEG)).toBeLessThan(3);
    expect(Math.abs(pose.x / DEG - pitch)).toBeLessThan(6);
  }
  expect(f.grounded).toBe(false);
});

it.each([1, -1])(
  "clears a persistent level-body turn after release (direction=%s)",
  (direction) => {
    const f = new FlightModel();
    // Recorded after independent strokes: level body, opposed wing angles, and a steady turn.
    f.orientation.setFromEuler(new Euler(-0.003 * DEG, 0, 0.021 * DEG * direction, "YXZ"));
    f.velocity.set(-0.923 * direction, -0.707, -7.404).applyQuaternion(f.orientation);
    f.omega.set(0.005 * DEG, 14.604 * DEG * direction, 0);
    const wings = [
      { angle: 11.29, incidence: 3.391 },
      { angle: -12.329, incidence: 4.585 },
    ];
    if (direction < 0) wings.reverse();
    f.wings.forEach((wing, i) => {
      wing.angle = wing.baseline = wings[i]!.angle * DEG;
      wing.incidence = wings[i]!.incidence * DEG;
    });
    f.tailIncidence = -2.591 * DEG;
    f.tailCant = 10.62 * DEG * direction;
    f.synchronize(NEUTRAL_INPUT);

    const settle = () => {
      for (let i = 0; i < 960; i++) {
        f.step(NEUTRAL_INPUT, 1 / 120);
        if (i < 480) continue;
        const pose = new Euler().setFromQuaternion(f.orientation, "YXZ");
        const yawRate =
          (Math.sin(pose.z) * f.omega.x + Math.cos(pose.z) * f.omega.y) / Math.cos(pose.x);
        const air = f.velocity.clone().applyQuaternion(f.orientation.clone().invert());
        expect(Math.abs(yawRate / DEG)).toBeLessThan(1);
        expect(Math.abs(Math.atan2(air.x, -air.z) / DEG)).toBeLessThan(1);
        expect(Math.abs(pose.z / DEG)).toBeLessThan(1);
      }
      for (const wing of f.wings) {
        expect(wing.manual || wing.returning).toBe(false);
        expect(Math.abs(wing.angle / DEG)).toBeLessThan(0.5);
      }
    };
    settle();
    for (let i = 0; i < 60; i++) f.step({ ...NEUTRAL_INPUT, roll: 35 * DEG * direction }, 1 / 120);
    const bank = -new Euler().setFromQuaternion(f.orientation, "YXZ").z / DEG;
    expect(bank * direction).toBeGreaterThan(15);
    settle(); // A counter-bank followed by release must not restore the original turn.
  },
);
