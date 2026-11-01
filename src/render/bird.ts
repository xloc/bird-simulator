import {
  ArrowHelper,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from "three";
import type { FlightModel, Wing } from "../flight/model";
import { legPose } from "../flight/legs";
import { disposeGroup } from "../world/render";

// Closed faceted sections share their edges, including while the wing twists.
function shell(sections: number, sides: number, darkFrom = sections) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(sections * sides * 3, 3));
  const indices: number[] = [];
  for (let i = 0; i < sections - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j;
      const b = i * sides + ((j + 1) % sides);
      indices.push(a, b, a + sides, b, b + sides, a + sides);
    }
  }
  const bodyCount = indices.length;
  for (let j = 1; j < sides - 1; j++) {
    indices.push(0, j + 1, j);
  }
  const endStart = indices.length;
  for (let j = 1; j < sides - 1; j++) {
    const end = (sections - 1) * sides;
    indices.push(end, end + j, end + j + 1);
  }
  if (darkFrom >= sections - 1) geometry.addGroup(0, indices.length, 0);
  else {
    const creamCount = darkFrom * sides * 6;
    geometry.addGroup(0, creamCount, 0);
    geometry.addGroup(creamCount, bodyCount - creamCount, 1);
    geometry.addGroup(bodyCount, endStart - bodyCount, 0);
    geometry.addGroup(endStart, indices.length - endStart, 1);
  }
  geometry.setIndex(indices);
  return geometry;
}

export function createBirdRenderer(model: FlightModel) {
  const group = new Group();
  const cream = new MeshStandardMaterial({ color: "#f4e5c8", roughness: 0.9, flatShading: true });
  const dark = new MeshStandardMaterial({ color: "#34484a", roughness: 0.9, flatShading: true });
  const copper = new MeshStandardMaterial({ color: "#c77b45", roughness: 0.9, flatShading: true });
  const plumage = [cream, dark];

  // One silhouette from the crown through the breast to the rump.
  const rings = [
    [-0.46, 0.085, 0.045, 0.055],
    [-0.36, 0.105, 0.105, 0.105],
    [-0.24, 0.055, 0.105, 0.12],
    [-0.09, 0.005, 0.145, 0.15],
    [0.11, -0.005, 0.15, 0.14],
    [0.29, 0.015, 0.105, 0.09],
    [0.4, 0.025, 0.025, 0.035],
  ];
  const body = shell(rings.length, 8);
  const bodyPoints = body.getAttribute("position");
  rings.forEach(([z, y, width, height], i) => {
    for (let j = 0; j < 8; j++) {
      const angle = (j / 8) * Math.PI * 2;
      bodyPoints.setXYZ(i * 8 + j, Math.cos(angle) * width!, y! + Math.sin(angle) * height!, z!);
    }
  });
  body.computeVertexNormals();
  group.add(new Mesh(body, plumage));
  const beak = new Mesh(new ConeGeometry(0.046, 0.16, 4), copper);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.075, -0.515);
  group.add(beak);
  const jewel = new OctahedronGeometry(1);
  for (const side of [-1, 1]) {
    const eye = new Mesh(jewel, dark);
    eye.scale.set(0.009, 0.013, 0.018);
    eye.position.set(side * 0.099, 0.13, -0.365);
    group.add(eye);
  }

  const axis = new Vector3(0, 1, 0);
  const direction = new Vector3();
  function placeLink(mesh: Mesh, start: Vector3, end: Vector3) {
    direction.copy(end).sub(start);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.scale.y = direction.length();
    mesh.quaternion.setFromUnitVectors(axis, direction.normalize());
  }
  const upperGeometry = new CylinderGeometry(0.033, 0.02, 1, 4);
  const lowerGeometry = new CylinderGeometry(0.016, 0.011, 1, 4);
  const footGeometry = new ConeGeometry(0.045, 0.13, 3);
  footGeometry.rotateX(-Math.PI / 2);
  footGeometry.scale(1, 0.22, 1);
  footGeometry.translate(0, 0, -0.025);
  const legs = [-1, 1].map((side) => {
    const upper = new Mesh(upperGeometry, cream);
    const lower = new Mesh(lowerGeometry, copper);
    const joint = new Mesh(jewel, copper);
    joint.scale.setScalar(0.023);
    const foot = new Mesh(footGeometry, copper);
    group.add(upper, lower, joint, foot);
    return { side, upper, lower, joint, foot };
  });

  // Visual sections describe a tapered wing with three angular tip feathers.
  // They sample the physical strips, but do not expose those strips as separate plates.
  const stations = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.6875, 0.75, 0.8125, 0.875, 0.9375, 1];
  const wings = model.wings.map(() => {
    const geometry = shell(stations.length, 4, 5);
    const mesh = new Mesh(geometry, plumage);
    // The small deforming mesh stays inside the moving bird's immediate bounds.
    mesh.frustumCulled = false;
    group.add(mesh);
    return geometry;
  });
  const center = new Vector3();
  const chord = new Vector3();
  const normal = new Vector3();
  const span = new Vector3();
  const point = new Vector3();
  const tucked = new Vector3();
  function updateWing(geometry: BufferGeometry, wing: Wing) {
    const points = geometry.getAttribute("position");
    // The physics fold is a coarse hinge. Close the visual plumage against the
    // body at large folds instead of exposing intersecting inner/outer plates.
    const tuck = Math.max(0, Math.min(1, (wing.fold - Math.PI / 3) / (Math.PI / 2)));
    stations.forEach((t, station) => {
      const sample = t * wing.surfaces.length - 0.5;
      const index = Math.max(0, Math.min(wing.surfaces.length - 2, Math.floor(sample)));
      const mix = Math.max(0, Math.min(1, sample - index));
      const a = wing.surfaces[index]!;
      const b = wing.surfaces[index + 1]!;
      center.copy(a.position).lerp(b.position, mix);
      chord.copy(a.chord).lerp(b.chord, mix).normalize();
      normal.copy(a.normal).lerp(b.normal, mix).normalize();
      span.crossVectors(chord, normal).normalize();
      if (t === 0) center.addScaledVector(span, -wing.side * a.width * 0.5);
      if (t === 1) center.addScaledVector(span, wing.side * b.width * 0.5);
      const length =
        (a.chordLength + (b.chordLength - a.chordLength) * mix) * (t === 1 ? 0.12 : 1.12);
      center.addScaledVector(chord, -0.05 * t * t);
      const tip = station > 5 && station % 2 === 0 ? 1.18 : 0.88;
      const thickness = 0.018 * (1 - t) + 0.002;
      const section = [
        [0.28 * length, 0],
        [0, thickness],
        [-0.72 * length * tip, 0],
        [0, -thickness * 0.5],
      ];
      section.forEach(([along, up], j) => {
        point.copy(center).addScaledVector(chord, along!).addScaledVector(normal, up!);
        tucked.set(
          wing.side * (0.13 + 0.045 * Math.sin(Math.PI * t) - 0.06 * t * t + up!),
          -0.035 - 0.035 * t - along! * 0.68,
          -0.1 + 0.5 * t,
        );
        point.lerp(tucked, tuck);
        // Reverse winding on the left wing so both shells face outward.
        const vertex = station * 4 + (wing.side < 0 ? (4 - j) % 4 : j);
        points.setXYZ(vertex, point.x, point.y, point.z);
      });
    });
    points.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  const tailGeometry = shell(3, 4, 1);
  const tailPoints = tailGeometry.getAttribute("position");
  for (const [i, [z, width, thickness]] of [
    [0, 0.045, 0.012],
    [0.37, 0.14, 0.018],
    [0.6, 0.205, 0.004],
  ].entries()) {
    tailPoints.setXYZ(i * 4, width!, 0, z!);
    tailPoints.setXYZ(i * 4 + 1, 0, thickness!, z!);
    tailPoints.setXYZ(i * 4 + 2, -width!, 0, z!);
    tailPoints.setXYZ(i * 4 + 3, 0, -thickness!, z!);
  }
  tailGeometry.computeVertexNormals();
  const tail = new Mesh(tailGeometry, plumage);
  tail.position.set(0, 0.025, 0.29);
  group.add(tail);
  const basis = new Matrix4();
  const inverse = new Quaternion();
  const footTarget = new Vector3();
  const arrows = model.wings.flatMap((wing) =>
    wing.surfaces.map(() => {
      const arrow = new ArrowHelper(
        new Vector3(0, 1, 0),
        new Vector3(),
        0.4,
        wing.side < 0 ? "#d49b65" : "#62bdb3",
        0.06,
        0.025,
      );
      group.add(arrow);
      return arrow;
    }),
  );

  function update(flight: FlightModel, alpha: number, showForces: boolean) {
    // Scene rendering supplies the interpolated rotation and scene-relative position.
    inverse.copy(group.quaternion).invert();
    point.copy(flight.previousPosition).lerp(flight.position, alpha);
    legs.forEach((leg, i) => {
      const foot = flight.legs.feet[i]!;
      footTarget.copy(foot.previous).lerp(foot.position, alpha).sub(point).applyQuaternion(inverse);
      const pose = legPose(leg.side, footTarget);
      placeLink(leg.upper, pose.hip, pose.joint);
      placeLink(leg.lower, pose.joint, pose.ankle);
      leg.joint.position.copy(pose.joint);
      leg.foot.position.copy(pose.ankle);
      leg.foot.rotation.x =
        flight.flying && flight.position.y - flight.surfaceHeight > 1.1 ? -0.6 : 0;
    });
    flight.wings.forEach((wing, i) => updateWing(wings[i]!, wing));
    const surface = flight.tail;
    span.crossVectors(surface.chord, surface.normal).normalize();
    basis.makeBasis(span, surface.normal, chord.copy(surface.chord).negate());
    tail.quaternion.setFromRotationMatrix(basis);
    let index = 0;
    for (const wing of flight.wings)
      for (const surface of wing.surfaces) {
        const arrow = arrows[index++]!;
        arrow.visible = showForces;
        arrow.position.copy(surface.position);
        if (surface.force.length() > 0.001) {
          arrow.setDirection(direction.copy(surface.force).normalize());
          arrow.setLength(Math.min(1.5, surface.force.length() * 0.35), 0.06, 0.025);
        }
      }
  }

  return {
    group,
    update,
    dispose() {
      disposeGroup(group);
      arrows.forEach((arrow) => arrow.dispose());
    },
  };
}
