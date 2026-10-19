export const CITY_CHUNK_SIZE = 240;

export type SceneId = "forest" | "city";
export type Point3 = [number, number, number];

export interface WorldSolid {
  id: string;
  min: Point3;
  max: Point3;
}

export interface WorldItem {
  shape: "box" | "cone" | "cylinder";
  position: Point3;
  size: Point3;
  color: string;
  material?: "plain" | "facade" | "water";
}

/** Render items use local coordinates; collision boxes use world coordinates. */
export interface WorldChunk {
  key: string;
  origin: Point3;
  items: WorldItem[];
  solids: WorldSolid[];
}

export interface WorldData {
  id: SceneId;
  seed: number;
  items: WorldItem[];
  solids: WorldSolid[];
  chunks?: Map<string, WorldChunk>;
  /** Stream deterministic surroundings, preserving the solids array used by physics. */
  update?: (x: number, z: number) => void;
  groundColor: string;
  skyColor: string;
  spawn: { position: Point3; heading: number; grounded: boolean };
}

export const SCENES: { id: SceneId; name: string; description: string }[] = [
  { id: "forest", name: "Forest", description: "Open skies, a winding river, and woodland." },
  {
    id: "city",
    name: "City",
    description:
      "Old neighborhoods, modern towers, and unfinished high-rises—extending in every direction.",
  },
];
