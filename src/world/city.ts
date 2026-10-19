import { seededRandom } from "./random";
import { CITY_CHUNK_SIZE } from "./types";
export { CITY_CHUNK_SIZE } from "./types";
import type { Point3, WorldChunk, WorldData, WorldItem } from "./types";

/**
 * Seeded grid/height generation adapted from THREEx.ProceduralCity (MIT),
 * Copyright (c) 2011 Jerome Etienne. See public/THIRD_PARTY_NOTICES.txt.
 * https://github.com/jeromeetienne/threex.proceduralcity
 * Its random grid and multiplicative height distribution are expanded into
 * non-overlapping blocks, reserved parks, and five traversable building families.
 */

const palettes = {
  old: ["#a7634d", "#bd8764", "#836151", "#cead72", "#c8bca0", "#967b69", "#bba88c", "#d3bf91"],
  modern: ["#467f98", "#4e9295", "#638ea4", "#33434e", "#88aeb9", "#acd2d2", "#b18a58", "#8c989d"],
  unfinished: [
    "#9c9b91",
    "#b5b3a8",
    "#7b807d",
    "#c0bdb0",
    "#8c9089",
    "#a1a69c",
    "#a66d48",
    "#805d48",
  ],
};

// Hash signed coordinates as text so distant chunks do not wrap at 32-bit boundaries.
function coordinateSeed(seed: number, x: number, z: number): number {
  let hash = 2166136261;
  for (const character of `${seed}:${x}:${z}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
}

export function generateCityChunk(seed: number, cx: number, cz: number): WorldChunk {
  const random = seededRandom(coordinateSeed(seed, cx, cz));
  const district = (["old", "modern", "unfinished"] as const)[
    coordinateSeed(seed, Math.floor(cx / 2), Math.floor(cz / 2)) % 3
  ]!;
  const palette = palettes[district];
  const paint = () => palette[Math.floor(random() * palette.length)]!;
  const chunk: WorldChunk = {
    key: `${cx}:${cz}`,
    origin: [cx * CITY_CHUNK_SIZE, 0, cz * CITY_CHUNK_SIZE],
    items: [],
    solids: [],
  };
  const box = (
    id: string,
    position: Point3,
    size: Point3,
    color: string,
    material: WorldItem["material"] = "plain",
    solid = true,
  ) => {
    chunk.items.push({ shape: "box", position, size, color, material });
    if (solid)
      chunk.solids.push({
        id: `${chunk.key}:${district}:${id}`,
        min: position.map((value, axis) => value + chunk.origin[axis]! - size[axis]! / 2) as Point3,
        max: position.map((value, axis) => value + chunk.origin[axis]! + size[axis]! / 2) as Point3,
      });
  };
  const pool = (id: string, x: number, bottom: number, z: number, width: number, depth: number) => {
    box(`${id}:bottom`, [x, bottom + 0.12, z], [width, 0.24, depth], "#d0ded8");
    for (const side of [-1, 1]) {
      box(
        `${id}:rim-x:${side}`,
        [x + (side * width) / 2, bottom + 0.4, z],
        [0.45, 0.8, depth + 0.45],
        "#e5e0c9",
      );
      box(
        `${id}:rim-z:${side}`,
        [x, bottom + 0.4, z + (side * depth) / 2],
        [width, 0.8, 0.45],
        "#e5e0c9",
      );
    }
    // The water is shallow: only the basin/deck is solid, so a bird can wade.
    box(
      `${id}:water`,
      [x, bottom + 0.48, z],
      [width - 0.45, 0.03, depth - 0.45],
      "#54b5c2",
      "water",
      false,
    );
  };
  const tree = (id: string, x: number, z: number, height: number) => {
    box(`${id}:trunk`, [x, height * 0.2, z], [0.6, height * 0.4, 0.6], "#786653");
    chunk.items.push({
      shape: "cone",
      position: [x, height * 0.75, z],
      size: [height * 0.7, height, height * 0.7],
      color: "#527c62",
    });
  };

  // The asphalt ground is the road surface. Plots add paving and lane markings only.
  const parkColumns = Array.from({ length: 4 }, () => Math.floor(random() * 4));
  const hotelPlot = Math.floor(random() * 12);
  let building = 0;
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 4; column++) {
      const centerX = 30 + column * 60;
      const centerZ = 30 + row * 60;
      const block = `block:${row}:${column}`;
      for (const side of [-1, 1]) {
        for (const mark of [-15, 0, 15]) {
          box(
            `${block}:lane-x:${side}:${mark}`,
            [centerX + side * 26.5, 0.027, centerZ + mark],
            [0.18, 0.012, 5],
            "#d3cdb2",
            "plain",
            false,
          );
          box(
            `${block}:lane-z:${side}:${mark}`,
            [centerX + mark, 0.027, centerZ + side * 26.5],
            [5, 0.012, 0.18],
            "#d3cdb2",
            "plain",
            false,
          );
        }
      }
      box(`${block}:pavement`, [centerX, 0.06, centerZ], [46, 0.12, 46], "#b4b4a5");
      if (column === parkColumns[row]) {
        const plaza = row % 3 === 0;
        box(
          `${block}:park`,
          [centerX, 0.15, centerZ],
          [40, 0.18, 40],
          plaza ? "#c5bea5" : "#86a878",
        );
        box(`${block}:path-x`, [centerX, 0.25, centerZ], [40, 0.04, 3], "#d4ccb1");
        box(`${block}:path-z`, [centerX, 0.25, centerZ], [3, 0.04, 40], "#d4ccb1");
        if (plaza) pool(`${block}:pool`, centerX, 0.27, centerZ, 15, 10);
        for (let i = 0; i < 8; i++) {
          const side = i % 2 === 0 ? -1 : 1;
          const x = centerX + side * (12 + random() * 5);
          const z = centerZ - 16 + Math.floor(i / 2) * 10;
          tree(`${block}:tree:${i}`, x, z, 6 + random() * 5);
        }
        continue;
      }
      const families = {
        old: [0, 0, 0, 0, 1, 1, 3, 4],
        modern: [2, 2, 2, 2, 3, 3, 1, 4],
        unfinished: [4, 4, 4, 4, 4, 0, 1, 3],
      };
      const family = building === hotelPlot ? 3 : families[district][Math.floor(random() * 8)]!;
      const id = `building:${building++}:${["brick", "balcony", "office", "hotel", "open"][family]}`;
      const x = centerX + (random() - 0.5) * 2;
      const z = centerZ + (random() - 0.5) * 2;
      const width = 32 + random() * 9;
      const depth = 31 + random() * 10;
      // Products bias toward ordinary buildings, with occasional tall landmarks.
      const height =
        district === "modern"
          ? 30 + random() * random() * 100
          : district === "old"
            ? 12 + random() * random() * 38
            : 16 + random() * random() * 46;
      const base = 0.32;
      box(`${id}:foundation`, [x, 0.22, z], [width + 1, 0.2, depth + 1], "#bfc0b2");
      if (family === 0) {
        const top = base + Math.max(12, Math.round(height / 4) * 4);
        const color = paint();
        box(`${id}:body`, [x, (base + top) / 2, z], [width, top - base, depth], color, "facade");
        box(`${id}:roof`, [x, top + 0.15, z], [width + 0.6, 0.3, depth + 0.6], "#c3b49b");
        box(
          `${id}:rooftop`,
          [x - width * 0.23, top + 1.5, z - depth * 0.23],
          [width * 0.27, 2.7, depth * 0.27],
          "#9c9484",
        );
      } else if (family === 1) {
        const floors = Math.max(8, Math.floor(height / 4.6));
        const top = base + floors * 4.6;
        box(
          `${id}:core`,
          [x, (base + top) / 2, z],
          [width - 8, top - base, depth - 8],
          paint(),
          "facade",
        );
        for (let floor = 0; floor <= floors; floor++) {
          const y = base + floor * 4.6;
          // Four metre deep wraparound balconies, with open approach edges.
          box(
            `${id}:balcony:${floor}`,
            [x, y + 0.16, z],
            [width, 0.32, depth],
            floor % 3 === 0 ? "#e0d7bd" : "#c7c7b9",
          );
        }
        // Recess the supports behind slab edges; bury end caps inside the concrete.
        for (const side of [-1, 1])
          box(
            `${id}:fin:${side}`,
            [x + side * (width / 2 - 0.5), (base + top) / 2, z],
            [0.6, top - base + 0.08, 1],
            "#8b9693",
          );
      } else if (family === 2) {
        const total = 40 + height * 0.7;
        let bottom = base;
        for (let tier = 0; tier < 3; tier++) {
          const tierHeight = total * [0.42, 0.33, 0.25][tier]!;
          const w = width - tier * 8;
          const d = depth - tier * 8;
          box(
            `${id}:tier:${tier}`,
            [x, bottom + tierHeight / 2, z],
            [w, tierHeight, d],
            paint(),
            "facade",
          );
          box(
            `${id}:terrace:${tier}`,
            [x, bottom + tierHeight + 0.15, z],
            [w + 0.6, 0.3, d + 0.6],
            "#d3d4c7",
          );
          bottom += tierHeight + 0.3;
        }
      } else if (family === 3) {
        const podiumTop = base + 9;
        box(
          `${id}:podium`,
          [x, (base + podiumTop) / 2, z],
          [width, podiumTop - base, depth],
          paint(),
          "facade",
        );
        box(`${id}:deck`, [x, podiumTop + 0.16, z], [width + 0.6, 0.32, depth + 0.6], "#e5dcc4");
        const towerDepth = depth * 0.42;
        const towerZ = z - depth * 0.25;
        const towerHeight = 24 + height * 0.65;
        box(
          `${id}:tower`,
          [x, podiumTop + 0.32 + towerHeight / 2, towerZ],
          [width * 0.8, towerHeight, towerDepth],
          paint(),
          "facade",
        );
        box(
          `${id}:roof`,
          [x, podiumTop + towerHeight + 0.47, towerZ],
          [width * 0.8 + 0.5, 0.3, towerDepth + 0.5],
          "#e4d4b7",
        );
        const terraceY = podiumTop + 0.32;
        pool(
          `${id}:pool`,
          x - width * 0.19,
          terraceY,
          z + depth * 0.22,
          width * 0.34,
          depth * 0.24,
        );
      } else {
        const floors = Math.max(5, Math.floor(height / 5.2));
        const floorHeight = 5.2;
        const concrete = paint();
        for (let floor = 0; floor <= floors; floor++) {
          const y = base + floor * floorHeight;
          box(
            `${id}:slab:${floor}`,
            [x, y + 0.2, z],
            [width, 0.4, depth],
            floor === floors ? "#d2cdb9" : concrete,
          );
          if (floor === floors) continue;
          // Hide column end faces inside both slabs instead of leaving coincident caps.
          for (const side of [-1, 1]) {
            for (let column = -1; column <= 1; column++) {
              box(
                `${id}:column:${floor}:${side}:${column}`,
                [
                  x + side * (width / 2 - 1.4),
                  y + floorHeight / 2 + 0.2,
                  z + column * (depth / 2 - 1.4),
                ],
                [0.9, floorHeight - 0.4 + 0.08, 0.9],
                district === "unfinished" ? "#878b85" : paint(),
              );
            }
          }
          if (district === "unfinished" && floor % 2 === 0) {
            // Partial back walls leave the central bays and street approaches flyable.
            box(
              `${id}:unfinished-wall:${floor}`,
              [x - width * 0.28, y + 1.25, z - depth / 2 + 0.5],
              [width * 0.3, 2.1, 0.5],
              paint(),
            );
          }
          // No full-volume collider: all central bays remain flyable.
        }
        if (district === "unfinished") {
          const top = base + floors * floorHeight + 0.4;
          for (const side of [-1, 1]) {
            box(
              `${id}:unfinished-column:${side}`,
              [x + side * (width / 2 - 1.4), top + 1.2, z - depth / 2 + 1.4],
              [0.9, 2.4, 0.9],
              concrete,
            );
            for (const offset of [-0.2, 0.2])
              box(
                `${id}:rebar:${side}:${offset}`,
                [x + side * (width / 2 - 1.4) + offset, top + 3, z - depth / 2 + 1.4],
                [0.07, 1.2, 0.07],
                "#9b6044",
              );
          }
        }
      }
    }
  }
  return chunk;
}

export function generateCity(seed = 4815): WorldData {
  const initial = generateCityChunk(seed, 0, 0);
  const deck = initial.solids.find((solid) => solid.id.endsWith(":hotel:deck"))!;
  const width = deck.max[0] - deck.min[0] - 0.6;
  const depth = deck.max[2] - deck.min[2] - 0.6;
  const world: WorldData = {
    id: "city",
    seed,
    items: [],
    solids: [],
    chunks: new Map([[initial.key, initial]]),
    groundColor: "#535c60",
    skyColor: "#cbdbe0",
    spawn: {
      position: [
        (deck.min[0] + deck.max[0]) / 2 + width * 0.27,
        deck.max[1] + 0.4,
        (deck.min[2] + deck.max[2]) / 2 + depth * 0.24,
      ],
      heading: Math.PI,
      grounded: true,
    },
  };
  let centerX = Infinity;
  let centerZ = Infinity;
  world.update = (x, z) => {
    const cx = Math.floor(x / CITY_CHUNK_SIZE);
    const cz = Math.floor(z / CITY_CHUNK_SIZE);
    if (cx === centerX && cz === centerZ) return;
    centerX = cx;
    centerZ = cz;
    const chunks = world.chunks!;
    const needed = new Set<string>();
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const key = `${cx + dx}:${cz + dz}`;
        needed.add(key);
        if (!chunks.has(key)) chunks.set(key, generateCityChunk(seed, cx + dx, cz + dz));
      }
    }
    for (const key of chunks.keys()) if (!needed.has(key)) chunks.delete(key);
    // Physics retains this array reference. Only nearby chunks participate in collision checks.
    world.solids.length = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const solid of chunks.get(`${cx + dx}:${cz + dz}`)!.solids) world.solids.push(solid);
      }
    }
  };
  world.update(world.spawn.position[0], world.spawn.position[2]);
  return world;
}
