import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { InstancedMesh, Mesh, MeshStandardMaterial } from "three";
import { createWorldRenderer } from "./render";
import { CITY_CHUNK_SIZE, type WorldChunk, type WorldData } from "./types";

function chunk(key: string, x: number, z: number): WorldChunk {
  return {
    key,
    origin: [x, 0, z],
    items: [
      {
        shape: "box",
        position: [24, 15, 24],
        size: [20, 30, 20],
        color: "#888888",
        material: "facade",
      },
      { shape: "box", position: [24, 31, 24], size: [22, 2, 22], color: "#777777" },
    ],
    solids: [],
  };
}

function world(chunks: WorldChunk[]): WorldData {
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({ fillRect() {}, drawImage() {} }),
    }),
  });
  return {
    id: "city",
    seed: 42,
    items: [],
    solids: [],
    chunks: new Map(chunks.map((entry) => [entry.key, entry])),
    groundColor: "#888888",
    skyColor: "#cccccc",
    spawn: { position: chunks[0]!.origin, heading: 0, grounded: true },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("streamed world rendering", () => {
  it("keeps chunk geometry local and reuses retained meshes when the origin moves far away", () => {
    const far = CITY_CHUNK_SIZE * 1_000_000_000;
    const data = world([chunk("far", far, -far), chunk("next", far + CITY_CHUNK_SIZE, -far)]);
    const renderer = createWorldRenderer(data);
    const first = renderer.group.getObjectByName("far")!;
    const next = renderer.group.getObjectByName("next")!;
    expect(renderer.origin.toArray()).toEqual([far, 0, -far]);
    expect(first.position.toArray()).toEqual([0, 0, 0]);
    expect(next.position.toArray()).toEqual([CITY_CHUNK_SIZE, 0, 0]);
    const geometry = (first.children[0] as Mesh).geometry;
    const positions = geometry.getAttribute("position");
    expect(Math.max(...positions.array)).toBeLessThan(100);

    renderer.update(far + CITY_CHUNK_SIZE + 0.25, -far);
    expect(renderer.group.getObjectByName("far")).toBe(first);
    expect((first.children[0] as Mesh).geometry).toBe(geometry);
    expect(first.position.toArray()).toEqual([-CITY_CHUNK_SIZE, 0, 0]);
    expect(next.position.toArray()).toEqual([0, 0, 0]);
    renderer.dispose();
  });

  it("disposes evicted GPU resources and keeps the shared facade atlas until scene teardown", () => {
    const data = world([chunk("first", 0, 0), chunk("next", CITY_CHUNK_SIZE, 0)]);
    const renderer = createWorldRenderer(data);
    const first = renderer.group.getObjectByName("first")!;
    const next = renderer.group.getObjectByName("next")!;
    const facade = first.children[0] as Mesh;
    const atlas = (facade.material as MeshStandardMaterial).map!;
    expect(((next.children[0] as Mesh).material as MeshStandardMaterial).map).toBe(atlas);
    const disposed = { geometry: 0, material: 0, instances: 0, atlas: 0 };
    facade.geometry.addEventListener("dispose", () => disposed.geometry++);
    (facade.material as MeshStandardMaterial).addEventListener(
      "dispose",
      () => disposed.material++,
    );
    const instances = first.children[1] as InstancedMesh;
    instances.addEventListener("dispose", () => disposed.instances++);
    atlas.addEventListener("dispose", () => disposed.atlas++);

    data.chunks!.delete("first");
    data.chunks!.set("third", chunk("third", CITY_CHUNK_SIZE * 2, 0));
    renderer.update(CITY_CHUNK_SIZE, 0);
    expect(renderer.group.getObjectByName("first")).toBeUndefined();
    expect(renderer.group.getObjectByName("next")).toBe(next);
    const third = renderer.group.getObjectByName("third")!;
    expect(((third.children[0] as Mesh).material as MeshStandardMaterial).map).toBe(atlas);
    expect(renderer.group.children).toHaveLength(3); // ground and the two current chunks
    expect(disposed).toEqual({ geometry: 1, material: 1, instances: 1, atlas: 0 });
    renderer.dispose();
    expect(disposed.atlas).toBe(1);
    expect(renderer.group.children).toHaveLength(0);
  });
});
