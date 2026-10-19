import { Color } from "three";
import { seededRandom } from "./random";
import type { Point3, WorldData } from "./types";

/** Preserve the original woodland and winding river corridor. */
export function generateForest(seed = 1): WorldData {
  const random = seededRandom(seed);
  const world: WorldData = {
    id: "forest",
    seed,
    items: [],
    solids: [],
    groundColor: "#99aa89",
    skyColor: "#c7d9cf",
    spawn: { position: [0, 80, 0], heading: 0, grounded: false },
  };
  for (let i = 0; i < 700; i++) {
    const z = -1400 + (i % 35) * 65 + Math.sin(i * 7) * 22;
    let x = (Math.floor(i / 35) - 10) * 65 + Math.cos(i * 3) * 20;
    if (Math.abs(x - Math.sin(z / 250) * 80) < 55) x += 100;
    const height = 4 + (Math.sin(i * 12) + 1) * 5;
    const color = new Color().setHSL(
      0.39 + Math.sin(i) * 0.025,
      0.12,
      0.36 + Math.cos(i * 3) * 0.08 + (random() - 0.5) * 0.015,
    );
    world.items.push({
      shape: "cone",
      position: [x, height * 0.55, z],
      size: [height * 0.74, height, height * 0.74],
      color: `#${color.getHexString()}`,
    });
    const position: Point3 = [x, height * 0.15, z];
    const size: Point3 = [0.4, height * 0.3, 0.4];
    world.items.push({ shape: "cylinder", position, size, color: "#776c55" });
    // Trunks obstruct flight; foliage remains permeable rather than a box-shaped platform.
    world.solids.push({
      id: `tree:${i}:trunk`,
      min: [x - 0.2, 0, z - 0.2],
      max: [x + 0.2, height * 0.3, z + 0.2],
    });
  }
  return world;
}
