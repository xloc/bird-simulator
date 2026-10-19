import { expect, it } from "vite-plus/test";
import { generateCity } from "../world/city";
import { WorldCollision } from "../world/collision";
import type { WorldSolid } from "../world/types";
import { BirdCamera } from "./camera";
import { LEGS } from "./legs";
import { BIRD, FlightModel, GROUND, NEUTRAL_INPUT } from "./model";

const dt = 1 / 120;
const idle = { x: 0, z: 0, jump: false };
const platform: WorldSolid = { id: "platform", min: [-5, 19.6, -5], max: [5, 20, 5] };
const city = generateCity();

function onPlatform() {
  const bird = new FlightModel(8, new WorldCollision([platform]));
  bird.place({ position: [0, 20 + GROUND.height, 0], heading: 0, grounded: true });
  return bird;
}

it("lands on an elevated roof and keeps the body and planted feet above it", () => {
  const roof = city.solids.find((solid) => solid.id.endsWith(":brick:roof"))!;
  const height = roof.max[1];
  const bird = new FlightModel(8, new WorldCollision(city.solids));
  bird.position.set(
    (roof.min[0] + roof.max[0]) / 2,
    height + GROUND.height + 0.04,
    (roof.min[2] + roof.max[2]) / 2 + 5,
  );
  bird.velocity.set(0, -10, 0);
  bird.step(NEUTRAL_INPUT, dt);
  expect(bird.grounded).toBe(true);
  expect(bird.groundHeight).toBeCloseTo(height);
  expect(bird.velocity.y).toBe(0);
  for (let step = 0; step < 120; step++) bird.step(NEUTRAL_INPUT, dt);
  expect(bird.position.y).toBeCloseTo(height + GROUND.height);
  for (const foot of bird.legs.feet) {
    expect(foot.planted).toBe(true);
    expect(foot.position.y).toBeCloseTo(height + LEGS.footHeight);
  }
});

it("walks with at least one fixed supporting foot on an elevated platform", () => {
  const bird = onPlatform();
  for (let step = 0; step < 180; step++) {
    const previous = bird.legs.feet.map((foot) => ({
      position: foot.position.clone(),
      planted: foot.planted,
    }));
    bird.step(NEUTRAL_INPUT, dt, { ...idle, x: 1 });
    expect(bird.grounded).toBe(true);
    expect(bird.groundHeight).toBe(20);
    expect(bird.legs.feet.some((foot) => foot.planted)).toBe(true);
    bird.legs.feet.forEach((foot, index) => {
      expect(foot.position.y).toBeGreaterThanOrEqual(20 + LEGS.footHeight - 1e-8);
      if (foot.planted && previous[index]!.planted) {
        expect(foot.position.distanceTo(previous[index]!.position)).toBe(0);
        expect(foot.position.y).toBeCloseTo(20 + LEGS.footHeight);
      }
    });
  }
  expect(bird.position.x).toBeGreaterThan(2);
  expect(bird.position.y).toBeGreaterThan(20.25);
});

it("charges a jump relative to the platform and returns to the same surface", () => {
  const bird = onPlatform();
  for (let step = 0; step < GROUND.chargeTime / dt; step++) {
    bird.step(NEUTRAL_INPUT, dt, { ...idle, jump: true });
  }
  expect(bird.position.y).toBeCloseTo(20 + GROUND.height - GROUND.crouchDepth);
  bird.step(NEUTRAL_INPUT, dt);
  expect(bird.phase).toBe("hopping");
  let apex = bird.position.y;
  for (let step = 0; step < 120 && !bird.grounded; step++) {
    bird.step(NEUTRAL_INPUT, dt);
    apex = Math.max(apex, bird.position.y);
  }
  expect(apex - 20 - GROUND.height).toBeCloseTo(GROUND.maxJumpHeight, 1);
  expect(bird.grounded).toBe(true);
  expect(bird.groundHeight).toBe(20);
});

it("launches from a city terrace after clearing its surface", () => {
  const bird = new FlightModel(8, new WorldCollision(city.solids));
  bird.place(city.spawn);
  const start = bird.position.clone();
  const pull = { ...NEUTRAL_INPUT, left: 1, right: 1 };
  bird.step(pull, dt);
  expect(bird.phase).toBe("launching");
  expect(bird.velocity.y).toBeCloseTo(GROUND.launchSpeed - BIRD.gravity * dt);
  for (let step = 0; step < 30 && bird.phase !== "flying"; step++) bird.step(pull, dt);
  expect(bird.phase).toBe("flying");
  expect(bird.position.y).toBeGreaterThan(start.y + 0.5);
  expect(bird.position.z).toBeGreaterThan(start.z);
});

it("leaves a platform edge into a glide without a jump impulse", () => {
  const bird = onPlatform();
  bird.place({ position: [4.98, 20 + GROUND.height, 0], heading: 0, grounded: true });
  bird.velocity.set(GROUND.walkSpeed, 0, 0);
  for (let step = 0; step < 10 && bird.grounded; step++)
    bird.step(NEUTRAL_INPUT, dt, { ...idle, x: 1 });
  expect(bird.phase).toBe("launching");
  expect(bird.velocity.y).toBe(0);
  expect(bird.position.x).toBeGreaterThan(5);
  for (let step = 0; step < 40 && bird.phase !== "flying"; step++) bird.step(NEUTRAL_INPUT, dt);
  expect(bird.phase).toBe("flying");
  expect(bird.position.y).toBeLessThan(20 + GROUND.height);
  expect(bird.velocity.y).toBeLessThan(0);
});

it("stops fast airborne wall and underside impacts without landing", () => {
  for (const ceiling of [false, true]) {
    const solid: WorldSolid = ceiling
      ? { id: "ceiling", min: [-5, 21, -5], max: [5, 21.1, 5] }
      : { id: "wall", min: [0.4, 0, -5], max: [0.5, 30, 5] };
    const bird = new FlightModel(8, new WorldCollision([solid]));
    bird.position.set(0, ceiling ? 20.6 : 20, 0);
    bird.phase = "hopping";
    bird.velocity.set(ceiling ? 0 : 100, ceiling ? 100 : 0, 2);
    bird.step(NEUTRAL_INPUT, dt);
    expect(bird.grounded).toBe(false);
    expect(bird.position.z).toBeCloseTo(2 * dt);
    if (ceiling) {
      expect(bird.position.y).toBeCloseTo(20.78);
      expect(bird.velocity.y).toBe(0);
    } else {
      expect(bird.position.x).toBeCloseTo(0.22);
      expect(bird.velocity.x).toBe(0);
    }
  }
});

it("lands inside an actual open-floor building beneath its higher floors", () => {
  const slab = city.solids.find((solid) => solid.id.endsWith(":open:slab:1"))!;
  const bird = new FlightModel(8, new WorldCollision(city.solids));
  bird.position.set(
    (slab.min[0] + slab.max[0]) / 2,
    slab.max[1] + GROUND.height + 0.04,
    (slab.min[2] + slab.max[2]) / 2,
  );
  bird.velocity.set(0, -10, 0);
  bird.step(NEUTRAL_INPUT, dt);
  expect(bird.grounded).toBe(true);
  expect(bird.groundHeight).toBeCloseTo(slab.max[1]);
  expect(bird.position.y).toBeLessThan(slab.max[1] + GROUND.height);
});

it("clips the following camera against a generated building while keeping the view target outside", () => {
  const body = city.solids.find((solid) => solid.id.endsWith(":brick:body"))!;
  const bird = new FlightModel(8, new WorldCollision(city.solids));
  bird.place({
    position: [(body.min[0] + body.max[0]) / 2, (body.min[1] + body.max[1]) / 2, body.max[2] + 0.3],
    heading: Math.PI,
    grounded: false,
  });
  const camera = new BirdCamera();
  camera.reset(bird);
  expect(camera.target.z).toBeGreaterThan(body.max[2]);
  expect(camera.position.z).toBeCloseTo(body.max[2] + 0.12);
  expect(camera.position.distanceTo(camera.target)).toBeLessThan(2);
  expect(camera.previousPosition.equals(camera.position)).toBe(true);
});
