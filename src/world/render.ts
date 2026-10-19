import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from "three";
import { seededRandom } from "./random";
import { CITY_CHUNK_SIZE, type WorldData, type WorldItem } from "./types";

/**
 * Small canvas window rows, room brightness noise, and unfiltered upscaling
 * adapted from THREEx.ProceduralCity, Copyright (c) 2011 Jerome Etienne (MIT).
 * https://github.com/jeromeetienne/threex.proceduralcity
 * See public/THIRD_PARTY_NOTICES.txt. No downloaded textures or models are required.
 */
function facadeTexture(seed: number): CanvasTexture {
  const random = seededRandom(seed);
  const small = document.createElement("canvas");
  small.width = 64;
  small.height = 128;
  const context = small.getContext("2d")!;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, small.width, small.height);
  for (let y = 2; y < small.height; y += 8) {
    for (let x = 2; x < small.width; x += 8) {
      const value = Math.floor(35 + random() * 66);
      context.fillStyle = `rgb(${value}, ${value + 17}, ${value + 24})`;
      context.fillRect(x, y, 5, 5);
      context.fillStyle = "#c0ccca";
      context.fillRect(x, y + 5, 5, 1);
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const output = canvas.getContext("2d")!;
  output.imageSmoothingEnabled = false;
  output.drawImage(small, 0, 0, canvas.width, canvas.height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** Merge facade boxes with metre-scaled UVs: one material/draw call for all towers. */
function facades(items: WorldItem[], texture: CanvasTexture): Mesh {
  const unit = new BoxGeometry().toNonIndexed();
  const source = unit.getAttribute("position");
  const normal = unit.getAttribute("normal");
  const count = source.count * items.length;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const colors = new Float32Array(count * 3);
  const color = new Color();
  items.forEach((item, index) => {
    color.set(item.color);
    for (let vertex = 0; vertex < source.count; vertex++) {
      const offset = index * source.count + vertex;
      const x = source.getX(vertex) * item.size[0];
      const y = source.getY(vertex) * item.size[1];
      const z = source.getZ(vertex) * item.size[2];
      positions.set([x + item.position[0], y + item.position[1], z + item.position[2]], offset * 3);
      normals.set([normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex)], offset * 3);
      colors.set([color.r, color.g, color.b], offset * 3);
      // Roofs sample a blank atlas pixel, side faces repeat every 24×48 metres.
      if (normal.getY(vertex) === 0) {
        const horizontal = normal.getX(vertex) === 0 ? x + item.size[0] / 2 : z + item.size[2] / 2;
        uvs.set([horizontal / 24, (y + item.size[1] / 2) / 48], offset * 2);
      } else uvs.set([0.005, 0.005], offset * 2);
    }
  });
  unit.dispose();
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return new Mesh(
    geometry,
    new MeshStandardMaterial({ map: texture, vertexColors: true, roughness: 0.78 }),
  );
}

function addItems(group: Group, items: WorldItem[], seed: number, texture?: CanvasTexture) {
  const batches = new Map<string, WorldItem[]>();
  const facadeItems: WorldItem[] = [];
  for (const item of items) {
    if (item.material === "facade") {
      facadeItems.push(item);
      continue;
    }
    const key = `${item.shape}:${item.material ?? "plain"}`;
    const batch = batches.get(key);
    if (batch) batch.push(item);
    else batches.set(key, [item]);
  }
  if (facadeItems.length > 0) group.add(facades(facadeItems, texture ?? facadeTexture(seed)));
  const transform = new Object3D();
  const color = new Color();
  for (const items of batches.values()) {
    const first = items[0]!;
    const geometry =
      first.shape === "box"
        ? new BoxGeometry()
        : first.shape === "cone"
          ? new ConeGeometry(0.5, 1, 6)
          : new CylinderGeometry(0.5, 0.5, 1, 6);
    const water = first.material === "water";
    const material = new MeshStandardMaterial({
      roughness: water ? 0.24 : 0.95,
      metalness: water ? 0.18 : 0,
      flatShading: first.shape === "cone",
    });
    const mesh = new InstancedMesh(geometry, material, items.length);
    items.forEach((item, index) => {
      transform.position.set(...item.position);
      transform.scale.set(...item.size);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      mesh.setColorAt(index, color.set(item.color));
    });
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
}

export function createWorldGroup(world: WorldData): Group {
  const group = new Group();
  group.name = `${world.id}:${world.seed}`;
  const ground = new Mesh(
    // Small triangles keep the surface stable close to the bird's feet.
    new PlaneGeometry(20000, 20000, 100, 100),
    new MeshStandardMaterial({
      color: world.groundColor,
      roughness: 1,
      // Keep shallow paving and road paint distinct even in distant aerial views.
      polygonOffset: world.id === "city",
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);
  addItems(group, world.items, world.seed);
  if (world.id === "forest") {
    // Shared river edges preserve the original continuous ribbon without tile overlaps.
    const vertices: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= 240; i++) {
      const z = -3000 + i * 25;
      const x = Math.sin(z / 250) * 80;
      vertices.push(x - 27.5, 0.2, z, x + 27.5, 0.2, z);
      if (i < 240) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    group.add(
      new Mesh(
        geometry,
        new MeshStandardMaterial({
          color: "#82aaa9",
          roughness: 0.4,
          metalness: 0.12,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      ),
    );
  }
  return group;
}

/** Release GPU resources; streaming chunks leave their shared facade atlas alive. */
export function disposeGroup(group: Group, disposeTextures = true) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  group.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    if (object instanceof InstancedMesh) object.dispose();
    if (!geometries.has(object.geometry)) {
      object.geometry.dispose();
      geometries.add(object.geometry);
    }
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (materials.has(material)) continue;
      if (
        disposeTextures &&
        material instanceof MeshStandardMaterial &&
        material.map &&
        !textures.has(material.map)
      ) {
        material.map.dispose();
        textures.add(material.map);
      }
      material.dispose();
      materials.add(material);
    }
  });
}

/** Keep chunk geometry local while simulation coordinates can travel without bounds. */
export function createWorldRenderer(world: WorldData) {
  const group = createWorldGroup(world);
  const origin = new Vector3();
  const chunks = new Map<string, Group>();
  const texture = world.chunks ? facadeTexture(world.seed) : undefined;
  function update(x: number, z: number) {
    if (!world.chunks) return;
    origin.set(
      Math.floor(x / CITY_CHUNK_SIZE) * CITY_CHUNK_SIZE,
      0,
      Math.floor(z / CITY_CHUNK_SIZE) * CITY_CHUNK_SIZE,
    );
    for (const [key, chunkGroup] of chunks) {
      if (world.chunks.has(key)) continue;
      group.remove(chunkGroup);
      disposeGroup(chunkGroup, false);
      chunks.delete(key);
    }
    for (const [key, chunk] of world.chunks) {
      let chunkGroup = chunks.get(key);
      if (!chunkGroup) {
        chunkGroup = new Group();
        chunkGroup.name = key;
        addItems(chunkGroup, chunk.items, world.seed, texture);
        chunks.set(key, chunkGroup);
        group.add(chunkGroup);
      }
      chunkGroup.position.set(
        chunk.origin[0] - origin.x,
        chunk.origin[1],
        chunk.origin[2] - origin.z,
      );
    }
  }
  update(world.spawn.position[0], world.spawn.position[2]);
  return {
    group,
    origin,
    update,
    dispose() {
      disposeGroup(group, !world.chunks);
      texture?.dispose();
      group.clear();
      chunks.clear();
    },
  };
}
