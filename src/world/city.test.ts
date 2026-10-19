import { describe, expect, it } from "vite-plus/test";
import { CITY_CHUNK_SIZE, generateCity, generateCityChunk } from "./city";
import { generateForest } from "./forest";
import { createWorldGroup } from "./render";
import type { Point3, WorldChunk, WorldSolid } from "./types";

function contains(solid: WorldSolid, point: Point3) {
  return point.every((value, axis) => value > solid.min[axis]! && value < solid.max[axis]!);
}

function district(chunk: WorldChunk) {
  return chunk.solids[0]!.id.split(":")[2]!;
}

function bounds(chunk: WorldChunk) {
  return chunk.items.map((item) => ({
    min: item.position.map((value, axis) => value + chunk.origin[axis]! - item.size[axis]! / 2),
    max: item.position.map((value, axis) => value + chunk.origin[axis]! + item.size[axis]! / 2),
  }));
}

describe("procedural worlds", () => {
  it("reproduces chunks independently of load order, including distant signed coordinates", () => {
    const first = generateCityChunk(42, -1_000_000_003, 3_000_000_001);
    generateCityChunk(42, 10, 9);
    expect(generateCityChunk(42, -1_000_000_003, 3_000_000_001)).toEqual(first);
    expect(generateCityChunk(43, -1_000_000_003, 3_000_000_001)).not.toEqual(first);
    expect(generateCityChunk(42, -1_000_000_003 + 2 ** 32, 3_000_000_001).items).not.toEqual(
      first.items,
    );
    expect(generateForest(42)).toEqual(generateForest(42));
  });

  it("clusters distinct old, modern and unfinished architecture into neighboring districts", () => {
    const samples = new Map<string, WorldChunk[]>();
    for (let cx = -4; cx < 4; cx += 2) {
      for (let cz = -4; cz < 4; cz += 2) {
        const chunk = generateCityChunk(4815, cx, cz);
        const zone = district(chunk);
        samples.set(zone, [...(samples.get(zone) ?? []), chunk]);
        expect(district(generateCityChunk(4815, cx + 1, cz + 1))).toBe(zone);
      }
    }
    expect(new Set(samples.keys())).toEqual(new Set(["old", "modern", "unfinished"]));
    for (const [zone, chunks] of samples) {
      const foundations = chunks.flatMap((chunk) =>
        chunk.solids.filter((solid) => solid.id.endsWith(":foundation")),
      );
      const expected = zone === "old" ? "brick" : zone === "modern" ? "office" : "open";
      expect(
        foundations.filter((solid) => solid.id.endsWith(`:${expected}:foundation`)).length /
          foundations.length,
      ).toBeGreaterThan(0.3);
      const colors = new Set(
        chunks.flatMap((chunk) =>
          chunk.items.filter((item) => item.material === "facade").map((item) => item.color),
        ),
      );
      expect(colors.size).toBeGreaterThan(4);
      if (zone === "unfinished") {
        const solids = chunks.flatMap((chunk) => chunk.solids);
        expect(solids.some((solid) => solid.id.includes(":unfinished-wall:"))).toBe(true);
        expect(solids.some((solid) => solid.id.includes(":unfinished-column:"))).toBe(true);
        expect(solids.some((solid) => solid.id.includes(":rebar:"))).toBe(true);
      }
    }
    const oldColors = new Set(
      samples
        .get("old")!
        .flatMap((chunk) =>
          chunk.items.filter((item) => item.material === "facade").map((item) => item.color),
        ),
    );
    const modernColors = samples
      .get("modern")!
      .flatMap((chunk) =>
        chunk.items.filter((item) => item.material === "facade").map((item) => item.color),
      );
    expect(modernColors.every((color) => !oldColors.has(color))).toBe(true);
    const height = (chunks: WorldChunk[]) =>
      Math.max(...chunks.flatMap((chunk) => chunk.solids.map((solid) => solid.max[1])));
    expect(height(samples.get("modern")!)).toBeGreaterThan(height(samples.get("old")!) + 30);
  });

  it("keeps plots separated over one continuous asphalt surface", () => {
    const left = generateCityChunk(42, -2, -1);
    const right = generateCityChunk(42, -1, -1);
    expect(CITY_CHUNK_SIZE).toBe(240);
    const world = generateCity();
    expect(world.groundColor).toBe("#535c60");
    // Roads have no second near-coplanar mesh over the ground, including at chunk seams.
    expect([...left.items, ...right.items].some((item) => item.color === world.groundColor)).toBe(
      false,
    );
    const foundations = [...left.solids, ...right.solids].filter((solid) =>
      solid.id.endsWith(":foundation"),
    );
    expect(foundations).toHaveLength(24);
    for (let i = 0; i < foundations.length; i++) {
      for (const other of foundations.slice(i + 1)) {
        const a = foundations[i]!;
        expect(
          a.max[0] > other.min[0] &&
            a.min[0] < other.max[0] &&
            a.max[2] > other.min[2] &&
            a.min[2] < other.max[2],
        ).toBe(false);
      }
    }
  });

  it("recesses balcony supports and embeds column caps inside their floor slabs", () => {
    const world = generateCity();
    const fin = world.solids.find((solid) => solid.id.endsWith(":balcony:fin:1"))!;
    const balcony = world.solids.find(
      (solid) => solid.id === fin.id.replace(":fin:1", ":balcony:1"),
    )!;
    expect(fin.max[0]).toBeLessThan(balcony.max[0] - 0.1);
    const columns = world.solids.filter((solid) => solid.id.includes(":open:column:1:"));
    expect(columns.length).toBeGreaterThan(0);
    for (const column of columns) {
      const prefix = column.id.split(":column:")[0];
      const lower = world.solids.find((solid) => solid.id === `${prefix}:slab:1`)!;
      const upper = world.solids.find((solid) => solid.id === `${prefix}:slab:2`)!;
      expect(column.min[1]).toBeGreaterThan(lower.min[1]);
      expect(column.min[1]).toBeLessThan(lower.max[1]);
      expect(column.max[1]).toBeGreaterThan(upper.min[1]);
      expect(column.max[1]).toBeLessThan(upper.max[1]);
    }
  });

  it("derives global collisions from local rendered dimensions at distant coordinates", () => {
    const chunk = generateCityChunk(4815, -1_000_000_003, -4_000_000_007);
    expect(chunk.origin).toEqual([-1_000_000_003 * 240, 0, -4_000_000_007 * 240]);
    const visualBounds = new Set(bounds(chunk).map((item) => JSON.stringify(item)));
    expect(new Set(chunk.solids.map((solid) => solid.id)).size).toBe(chunk.solids.length);
    for (const { id: _id, ...solid } of chunk.solids) {
      expect(visualBounds.has(JSON.stringify(solid))).toBe(true);
      solid.min.forEach((value, axis) => {
        expect(Number.isFinite(value)).toBe(true);
        expect(solid.max[axis]).toBeGreaterThan(value);
      });
    }
    for (const item of chunk.items) {
      expect(item.position[0]).toBeGreaterThanOrEqual(0);
      expect(item.position[0]).toBeLessThanOrEqual(240);
      expect(item.position[2]).toBeGreaterThanOrEqual(0);
      expect(item.position[2]).toBeLessThanOrEqual(240);
    }
  });

  it("streams a bounded neighborhood, preserves physics references and regenerates revisited chunks", () => {
    const world = generateCity();
    const chunks = world.chunks!;
    const solids = world.solids;
    const initial = chunks.get("0:0")!;
    const nearby = chunks.get("1:0")!;
    const firstSolid = solids[0];
    expect(world.items).toEqual([]);
    world.update!(200, 200);
    expect(solids[0]).toBe(firstSolid);
    world.update!(241, 30);
    expect(chunks.get("1:0")).toBe(nearby);
    for (const [x, z] of [
      [-10_000_001, 7_000_003],
      [20_000_001, -8_000_003],
      [-240.1, -0.1],
    ]) {
      world.update!(x!, z!);
      expect(world.chunks).toBe(chunks);
      expect(world.solids).toBe(solids);
      expect(chunks.size).toBe(25);
      const cx = Math.floor(x! / 240);
      const cz = Math.floor(z! / 240);
      let count = 0;
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
          count += chunks.get(`${cx + dx}:${cz + dz}`)!.solids.length;
      expect(solids).toHaveLength(count);
      expect(new Set(solids.map((solid) => solid.id)).size).toBe(count);
      expect(count).toBeLessThan(15_000);
    }
    world.update!(world.spawn.position[0], world.spawn.position[2]);
    expect(chunks.get("0:0")).toEqual(initial);
    expect(chunks.get("0:0")).not.toBe(initial);
    expect(world.spawn).toEqual(generateCity().spawn);
  });

  it("leaves open-floor bays empty and balcony edges four metres deep", () => {
    const world = generateCity();
    const slab = world.solids.find((solid) => solid.id.endsWith(":open:slab:1"))!;
    const center: Point3 = [
      (slab.min[0] + slab.max[0]) / 2,
      slab.max[1] + 2,
      (slab.min[2] + slab.max[2]) / 2,
    ];
    expect(world.solids.some((solid) => contains(solid, center))).toBe(false);
    const balcony = world.solids.find((solid) => solid.id.endsWith(":balcony:balcony:1"))!;
    const core = world.solids.find(
      (solid) => solid.id === balcony.id.replace(/:balcony:1$/, ":core"),
    )!;
    expect(core.min[0] - balcony.min[0]).toBeCloseTo(4);
    expect(core.min[2] - balcony.min[2]).toBeCloseTo(4);
  });

  it("spawns safely on a broad generated terrace with an unobstructed outward route", () => {
    for (const seed of [1, 42, 4815, 777]) {
      const world = generateCity(seed);
      const [x, y, z] = world.spawn.position;
      const support = world.solids.find(
        (solid) =>
          Math.abs(solid.max[1] - (y - 0.4)) < 0.00001 &&
          x > solid.min[0] + 2 &&
          x < solid.max[0] - 2 &&
          z > solid.min[2] + 2 &&
          z < solid.max[2] - 2,
      );
      expect(support?.id).toMatch(/:hotel:deck$/);
      expect(world.spawn.grounded).toBe(true);
      for (let step = 0; step < 15; step++)
        expect(world.solids.some((solid) => contains(solid, [x, y, z + step]))).toBe(false);
    }
  });

  it("gives pools solid bottoms and rims while keeping the water permeable", () => {
    const chunk = generateCityChunk(4815, -3, 2);
    const water = chunk.items.filter((item) => item.material === "water");
    expect(water.length).toBeGreaterThanOrEqual(3);
    for (const item of water) {
      const point = item.position.map((value, axis) => value + chunk.origin[axis]!) as Point3;
      expect(chunk.solids.some((solid) => contains(solid, point))).toBe(false);
      const [x, y, z] = point;
      expect(
        chunk.solids.some(
          (solid) =>
            solid.id.endsWith(":bottom") &&
            x > solid.min[0] &&
            x < solid.max[0] &&
            z > solid.min[2] &&
            z < solid.max[2] &&
            y - solid.max[1] > 0 &&
            y - solid.max[1] < 0.3,
        ),
      ).toBe(true);
    }
  });

  it("retains the forest scenery in a handful of instanced rendering batches", () => {
    const forest = generateForest();
    expect(forest.items).toHaveLength(1400);
    expect(forest.spawn.position).toEqual([0, 80, 0]);
    expect(createWorldGroup(forest).children).toHaveLength(4);
  });
});
