import { Vector3 } from "three";
import type { WorldSolid } from "./types";

type Support = { id: string; height: number };
type Hit = { time: number; axis: number; normal: number; solid: WorldSolid };

const EPSILON = 1e-8;

// Sweeping a body against a box is a point sweep against the expanded box.
function sweep(
  start: Vector3,
  delta: Vector3,
  solid: WorldSolid,
  radius: number,
  footOffset: number,
  headOffset: number,
): Hit | null {
  let entry = -Infinity;
  let exit = Infinity;
  let axis = 0;
  let normal = 0;
  for (let i = 0; i < 3; i++) {
    const min = solid.min[i]! - (i === 1 ? headOffset : radius);
    const max = solid.max[i]! + (i === 1 ? footOffset : radius);
    const origin = start.getComponent(i);
    const movement = delta.getComponent(i);
    if (Math.abs(movement) < EPSILON) {
      // Touching a face does not obstruct movement along that face.
      if (origin <= min + EPSILON || origin >= max - EPSILON) return null;
      continue;
    }
    const a = (min - origin) / movement;
    const b = (max - origin) / movement;
    const near = Math.min(a, b);
    if (near > entry) {
      entry = near;
      axis = i;
      normal = movement > 0 ? -1 : 1;
    }
    exit = Math.min(exit, Math.max(a, b));
    if (entry > exit) return null;
  }
  if (entry < -EPSILON || entry > 1 || exit < 0) return null;
  return { time: Math.max(0, entry), axis, normal, solid };
}

export class WorldCollision {
  readonly solids: WorldSolid[];

  constructor(solids: WorldSolid[] = []) {
    this.solids = solids;
  }

  supportAt(x: number, z: number, maxHeight: number): Support | null {
    let support: Support | null = maxHeight >= 0 ? { id: "ground", height: 0 } : null;
    for (const solid of this.solids) {
      const height = solid.max[1];
      if (
        x >= solid.min[0] &&
        x <= solid.max[0] &&
        z >= solid.min[2] &&
        z <= solid.max[2] &&
        height <= maxHeight &&
        (!support || height > support.height)
      ) {
        support = { id: solid.id, height };
      }
    }
    return support;
  }

  move(
    start: Vector3,
    end: Vector3,
    velocity: Vector3,
    radius: number,
    footOffset: number,
    headOffset: number,
  ): { position: Vector3; landed: Support | null } {
    const position = start.clone();
    const remaining = end.clone().sub(start);
    let landed: Support | null = null;

    // A changed body height can overlap the current floor. Move out through
    // the nearest face, without searching for a roof above the bird.
    for (const solid of this.solids) {
      let depth = Infinity;
      let axis = 0;
      let normal = 0;
      let overlaps = true;
      for (let i = 0; i < 3; i++) {
        const min = solid.min[i]! - (i === 1 ? headOffset : radius);
        const max = solid.max[i]! + (i === 1 ? footOffset : radius);
        const coordinate = position.getComponent(i);
        if (coordinate <= min + EPSILON || coordinate >= max - EPSILON) {
          overlaps = false;
          break;
        }
        if (coordinate - min < depth) {
          depth = coordinate - min;
          axis = i;
          normal = -1;
        }
        if (max - coordinate < depth) {
          depth = max - coordinate;
          axis = i;
          normal = 1;
        }
      }
      if (overlaps) {
        position.setComponent(axis, position.getComponent(axis) + normal * depth);
        if (velocity.getComponent(axis) * normal < 0) velocity.setComponent(axis, 0);
        if (remaining.getComponent(axis) * normal < 0) remaining.setComponent(axis, 0);
        if (axis === 1 && normal === 1) landed = { id: solid.id, height: solid.max[1] };
      }
    }
    if (position.y < footOffset) {
      position.y = footOffset;
      if (velocity.y < 0) velocity.y = 0;
      if (remaining.y < 0) remaining.y = 0;
      landed = { id: "ground", height: 0 };
    }

    for (let contact = 0; contact < 4; contact++) {
      let hit: Hit | null = null;
      for (const solid of this.solids) {
        const candidate = sweep(position, remaining, solid, radius, footOffset, headOffset);
        if (candidate && (!hit || candidate.time < hit.time)) hit = candidate;
      }
      const groundTime = remaining.y < 0 ? (footOffset - position.y) / remaining.y : Infinity;
      if (groundTime >= 0 && groundTime <= 1 && (!hit || groundTime < hit.time)) {
        position.addScaledVector(remaining, groundTime);
        position.y = footOffset;
        remaining.multiplyScalar(1 - groundTime);
        remaining.y = 0;
        if (velocity.y < 0) velocity.y = 0;
        landed = { id: "ground", height: 0 };
        continue;
      }
      if (!hit) {
        position.add(remaining);
        break;
      }
      position.addScaledVector(remaining, hit.time);
      remaining.multiplyScalar(1 - hit.time);
      remaining.setComponent(hit.axis, 0);
      if (velocity.getComponent(hit.axis) * hit.normal < 0) velocity.setComponent(hit.axis, 0);
      if (hit.axis === 1 && hit.normal === 1) {
        landed = { id: hit.solid.id, height: hit.solid.max[1] };
      }
    }

    if (landed) {
      const support = this.supportAt(position.x, position.z, position.y - footOffset + EPSILON);
      if (!support || Math.abs(support.height - landed.height) > EPSILON) landed = null;
    }
    return { position, landed };
  }

  cameraPosition(target: Vector3, desired: Vector3): Vector3 {
    const radius = 0.12;
    const delta = desired.clone().sub(target);
    let time = 1;
    for (const solid of this.solids) {
      const inside = [0, 1, 2].every(
        (axis) =>
          target.getComponent(axis) > solid.min[axis]! - radius &&
          target.getComponent(axis) < solid.max[axis]! + radius,
      );
      const hit = sweep(target, delta, solid, radius, radius, radius);
      if (inside) time = 0;
      else if (hit) time = Math.min(time, hit.time);
    }
    const position = target.clone().addScaledVector(delta, time);
    position.y = Math.max(radius, position.y);
    return position;
  }
}
