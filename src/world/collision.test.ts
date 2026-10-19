import { expect, it } from "vite-plus/test";
import { Vector3 } from "three";
import { WorldCollision } from "./collision";
import type { WorldSolid } from "./types";

const slab: WorldSolid = { id: "balcony", min: [-5, 19.5, -5], max: [5, 20, 5] };
const roof: WorldSolid = { id: "roof", min: [-5, 29.5, -5], max: [5, 30, 5] };
const world = new WorldCollision([slab, roof]);

it("finds the highest floor below the feet without selecting overhead roofs", () => {
  expect(world.supportAt(0, 0, 25)).toEqual({ id: "balcony", height: 20 });
  expect(world.supportAt(0, 0, 35)).toEqual({ id: "roof", height: 30 });
  expect(world.supportAt(0, 0, 19)).toEqual({ id: "ground", height: 0 });
  expect(world.supportAt(0, 0, -1)).toBeNull();
  expect(world.supportAt(5.01, 0, 25)).toEqual({ id: "ground", height: 0 });
});

it("lands on a thin balcony beneath a higher roof at high speed", () => {
  const velocity = new Vector3(2, -100, 0);
  const result = world.move(new Vector3(0, 25, 0), new Vector3(2, 5, 0), velocity, 0.3, 0.5, 0.4);
  expect(result.position.toArray()).toEqual([2, 20.5, 0]);
  expect(result.landed).toEqual({ id: "balcony", height: 20 });
  expect(velocity.toArray()).toEqual([2, 0, 0]);
});

it("lands on the roof when descending from above", () => {
  const result = world.move(
    new Vector3(0, 40, 0),
    new Vector3(0, 10, 0),
    new Vector3(0, -30, 0),
    0.3,
    0.5,
    0.4,
  );
  expect(result.position.y).toBe(30.5);
  expect(result.landed?.id).toBe("roof");
});

it("passes beneath a balcony without being lifted to its top", () => {
  const result = world.move(
    new Vector3(-10, 18, 0),
    new Vector3(10, 18, 0),
    new Vector3(20, 0, 0),
    0.3,
    0.5,
    0.4,
  );
  expect(result.position.toArray()).toEqual([10, 18, 0]);
  expect(result.landed).toBeNull();
});

it("stops high speed ascent at the underside and preserves sideways motion", () => {
  const velocity = new Vector3(2, 100, 0);
  const result = world.move(new Vector3(0, 10, 0), new Vector3(2, 40, 0), velocity, 0.3, 0.5, 0.4);
  expect(result.position.x).toBeCloseTo(2);
  expect(result.position.y).toBeCloseTo(19.1);
  expect(velocity.toArray()).toEqual([2, 0, 0]);
  expect(result.landed).toBeNull();
});

it("slides along a thin wall without tunneling or reporting a landing", () => {
  const collision = new WorldCollision([{ id: "wall", min: [2, 0, -10], max: [2.1, 50, 10] }]);
  const velocity = new Vector3(100, 0, 3);
  const result = collision.move(
    new Vector3(0, 10, 0),
    new Vector3(20, 10, 3),
    velocity,
    0.3,
    0.5,
    0.4,
  );
  expect(result.position.distanceTo(new Vector3(1.7, 10, 3))).toBeLessThan(1e-10);
  expect(velocity.toArray()).toEqual([0, 0, 3]);
  expect(result.landed).toBeNull();
});

it("walks across a top face and loses support beyond the roof edge", () => {
  const result = world.move(
    new Vector3(4, 30.5, 0),
    new Vector3(6, 30.5, 0),
    new Vector3(2, 0, 0),
    0.3,
    0.5,
    0.4,
  );
  expect(result.position.toArray()).toEqual([6, 30.5, 0]);
  expect(world.supportAt(6, 0, 30)).toEqual({ id: "ground", height: 0 });
});

it("resolves a corner and continues moving along its free axis", () => {
  const collision = new WorldCollision([
    { id: "wall-x", min: [2, 0, -10], max: [3, 10, 10] },
    { id: "wall-z", min: [-10, 0, 2], max: [10, 10, 3] },
  ]);
  const velocity = new Vector3(10, 1, 10);
  const result = collision.move(
    new Vector3(0, 2, 0),
    new Vector3(10, 3, 10),
    velocity,
    0.3,
    0.5,
    0.4,
  );
  expect(result.position.distanceTo(new Vector3(1.7, 3, 1.7))).toBeLessThan(1e-10);
  expect(velocity.toArray()).toEqual([0, 1, 0]);
});

it("clamps a ground landing and permits tangent movement on the next step", () => {
  const collision = new WorldCollision();
  const velocity = new Vector3(1, -10, 0);
  const result = collision.move(
    new Vector3(0, 1, 0),
    new Vector3(1, -5, 0),
    velocity,
    0.3,
    0.5,
    0.4,
  );
  expect(result.position.toArray()).toEqual([1, 0.5, 0]);
  expect(result.landed).toEqual({ id: "ground", height: 0 });
  expect(velocity.toArray()).toEqual([1, 0, 0]);
});

it("resolves a small initial floor overlap without selecting the overhead roof", () => {
  const result = world.move(
    new Vector3(0, 20.4, 0),
    new Vector3(1, 20.4, 0),
    new Vector3(1, -1, 0),
    0.3,
    0.5,
    0.4,
  );
  expect(result.position.toArray()).toEqual([1, 20.5, 0]);
  expect(result.landed?.id).toBe("balcony");
});

it("allows tangent and exiting motion from an expanded wall boundary", () => {
  const collision = new WorldCollision([{ id: "wall", min: [2, 0, -10], max: [3, 10, 10] }]);
  const start = new Vector3(1.7, 2, 0);
  expect(
    collision
      .move(start, new Vector3(0, 2, 1), new Vector3(-1, 0, 1), 0.3, 0.5, 0.4)
      .position.toArray(),
  ).toEqual([0, 2, 1]);
  expect(
    collision
      .move(start, new Vector3(1.7, 2, 1), new Vector3(0, 0, 1), 0.3, 0.5, 0.4)
      .position.toArray(),
  ).toEqual([1.7, 2, 1]);
  expect(collision.cameraPosition(new Vector3(1.88, 2, 0), new Vector3(0, 2, 1)).toArray()).toEqual(
    [0, 2, 1],
  );
});

it("shortens the camera sightline before a wall and keeps its radius above floors", () => {
  const collision = new WorldCollision([{ id: "wall", min: [2, 0, -10], max: [3, 10, 10] }]);
  const position = collision.cameraPosition(new Vector3(0, 2, 0), new Vector3(10, 2, 0));
  expect(position.x).toBeCloseTo(1.88);
  expect(position.y).toBe(2);
  expect(world.cameraPosition(new Vector3(0, 25, 0), new Vector3(0, 15, 0)).y).toBeCloseTo(20.12);
  expect(new WorldCollision().cameraPosition(new Vector3(0, 1, 0), new Vector3(0, -2, 0)).y).toBe(
    0.12,
  );
});
