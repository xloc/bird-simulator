import { expect, it } from "vite-plus/test";
import { Vector3 } from "three";
import { BirdCamera } from "./camera";
import { FlightModel, GROUND, LOCOMOTION_PHASES, NEUTRAL_INPUT } from "./model";
import { DEG } from "./aerodynamics";

const dt = 1 / 120;

it.each(LOCOMOTION_PHASES)("sets look directly and recenters without drift while %s", (phase) => {
  const bird = new FlightModel();
  bird.phase = phase;
  const camera = new BirdCamera();
  camera.reset(bird);
  camera.step(bird, 0.5, 0.5, dt);
  expect(camera.yaw / DEG).toBeCloseTo(-60);
  expect(camera.pitch / DEG).toBeCloseTo(42.5);
  const position = camera.position.clone();
  for (let i = 0; i < 240; i++) camera.step(bird, 0.5, 0.5, dt);
  expect(camera.position.distanceTo(position)).toBeLessThan(1e-10);
  camera.step(bird, -0.5, -0.25, dt);
  expect(camera.yaw / DEG).toBeCloseTo(60);
  expect(camera.pitch / DEG).toBeCloseTo(8.75);
  camera.step(bird, 0, 0, dt);
  expect(camera.yaw).toBe(bird.heading);
  expect(camera.pitch / DEG).toBeCloseTo(20);
  const offset = camera.position.clone().sub(camera.target);
  expect(Math.atan2(offset.x, offset.z)).toBeCloseTo(bird.heading);
  const centered = camera.position.clone();
  camera.step(bird, 0, 0, dt);
  expect(camera.position.distanceTo(centered)).toBeLessThan(1e-10);

  bird.position.x += 10;
  bird.orientation.setFromAxisAngle(new Vector3(0, 1, 0), 45 * DEG);
  camera.step(bird, 0, 0, dt);
  expect(camera.yaw / DEG).toBeCloseTo(45);
  expect(camera.target.distanceTo(bird.position)).toBeLessThan(0.7);
});

it("keeps the same look angle through touchdown and takeoff while easing only framing", () => {
  const bird = new FlightModel();
  const camera = new BirdCamera();
  camera.reset(bird);
  camera.step(bird, 0.5, 0, dt);
  let position = camera.position.clone();
  for (const phase of ["walking", "hopping", "launching", "flying"] as const) {
    bird.phase = phase;
    camera.step(bird, 0.5, 0, dt);
    expect(camera.yaw / DEG).toBeCloseTo(-60);
    expect(camera.position.distanceTo(position)).toBeLessThan(0.2);
    position = camera.position.clone();
  }
  camera.step(bird, 0, 0, dt);
  expect(camera.yaw).toBe(bird.heading);
});

it("keeps a held walk straight as the bird and camera turn, then uses the new view for a fresh input", () => {
  const bird = new FlightModel();
  bird.phase = "walking";
  bird.position.set(0, GROUND.height, 0);
  bird.velocity.set(0, 0, 0);
  const camera = new BirdCamera();
  camera.reset(bird);
  for (let i = 0; i < 240; i++) {
    bird.step(NEUTRAL_INPUT, dt, { ...camera.walkingDirection(1, 0), jump: false });
    camera.step(bird, i > 120 ? 0.5 : 0, 0, dt);
  }
  expect(bird.position.x).toBeGreaterThan(3);
  expect(bird.position.z).toBeCloseTo(0);
  camera.walkingDirection(0, 0);
  const direction = camera.walkingDirection(0, -1);
  expect(Math.atan2(-direction.x, -direction.z)).toBeCloseTo(camera.yaw);
  expect(Math.hypot(...Object.values(camera.walkingDirection(1, -1)))).toBeCloseTo(1);
});
