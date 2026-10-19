<script setup lang="ts">
import { onUnmounted } from "vue";
import { useLoop } from "@tresjs/core";
import {
  ArrowHelper,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { useSession } from "../session";
import { legPose } from "../flight/legs";

const session = useSession();
const bird = new Group();
const cream = new MeshStandardMaterial({ color: "#f4e5c8", roughness: 0.85 });
const dark = new MeshStandardMaterial({ color: "#34484a", roughness: 0.95 });
const copper = new MeshStandardMaterial({ color: "#c77b45", roughness: 0.75 });
const sphere = new SphereGeometry(1, 20, 12);
const box = new BoxGeometry(1, 1, 1);
const body = new Mesh(sphere, cream);
body.scale.set(0.13, 0.13, 0.34);
bird.add(body);
const head = new Mesh(sphere, cream);
head.scale.set(0.105, 0.11, 0.13);
head.position.set(0, 0.08, -0.33);
bird.add(head);
const beak = new Mesh(new ConeGeometry(0.045, 0.17, 5), copper);
beak.rotation.x = -Math.PI / 2;
beak.position.set(0, 0.06, -0.49);
bird.add(beak);
for (const side of [-1, 1]) {
  const eye = new Mesh(sphere, dark);
  eye.scale.setScalar(0.015);
  eye.position.set(side * 0.092, 0.11, -0.38);
  bird.add(eye);
}
const limbAxis = new Vector3(0, 1, 0);
function placeLink(mesh: Mesh, start: Vector3, end: Vector3) {
  const direction = end.clone().sub(start);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.scale.y = direction.length();
  mesh.quaternion.setFromUnitVectors(limbAxis, direction.normalize());
}
const legs = [-1, 1].map((side) => {
  const upper = new Mesh(new CylinderGeometry(0.026, 0.018, 1, 8), cream);
  const lower = new Mesh(new CylinderGeometry(0.012, 0.009, 1, 8), copper);
  const hip = new Mesh(sphere, cream);
  hip.scale.setScalar(0.032);
  const joint = new Mesh(sphere, copper);
  joint.scale.setScalar(0.022);
  const foot = new Group();
  const ankle = new Mesh(sphere, copper);
  ankle.scale.setScalar(0.015);
  foot.add(ankle);
  for (const end of [
    new Vector3(-0.038, -0.006, -0.085),
    new Vector3(0, -0.006, -0.115),
    new Vector3(0.038, -0.006, -0.085),
    new Vector3(0, -0.006, 0.055),
  ]) {
    const toe = new Mesh(new CylinderGeometry(0.004, 0.007, 1, 6), copper);
    placeLink(toe, new Vector3(), end);
    foot.add(toe);
  }
  bird.add(upper, lower, hip, joint, foot);
  return { side, upper, lower, hip, joint, foot };
});
const feathers = session.model.surfaces.map((_, i) => {
  const mesh = new Mesh(box, i % 8 > 5 ? dark : cream);
  bird.add(mesh);
  return mesh;
});
const arrows = session.model.wings.flatMap((w) =>
  w.surfaces.map(() => {
    const arrow = new ArrowHelper(
      new Vector3(0, 1, 0),
      new Vector3(),
      0.4,
      w.side < 0 ? "#d49b65" : "#62bdb3",
      0.06,
      0.025,
    );
    bird.add(arrow);
    return arrow;
  }),
);

const forest = new Group();
const treeCount = 700;
const trees = new InstancedMesh(
  new ConeGeometry(1, 1, 5),
  new MeshStandardMaterial({ color: "#5b7970", flatShading: true }),
  treeCount,
);
const trunks = new InstancedMesh(
  new CylinderGeometry(0.15, 0.2, 1, 4),
  new MeshStandardMaterial({ color: "#776c55" }),
  treeCount,
);
const transform = new Object3D();
for (let i = 0; i < treeCount; i++) {
  const z = -1400 + (i % 35) * 65 + Math.sin(i * 7) * 22;
  let x = (Math.floor(i / 35) - 10) * 65 + Math.cos(i * 3) * 20;
  if (Math.abs(x - Math.sin(z / 250) * 80) < 55) x += 100;
  const height = 4 + (Math.sin(i * 12) + 1) * 5;
  transform.position.set(x, height * 0.55, z);
  transform.scale.set(height * 0.37, height, height * 0.37);
  transform.rotation.y = i * 1.3;
  transform.updateMatrix();
  trees.setMatrixAt(i, transform.matrix);
  trees.setColorAt(
    i,
    new Color().setHSL(0.39 + Math.sin(i) * 0.025, 0.12, 0.36 + Math.cos(i * 3) * 0.08),
  );
  transform.position.y = height * 0.15;
  transform.scale.set(1, height * 0.3, 1);
  transform.updateMatrix();
  trunks.setMatrixAt(i, transform.matrix);
}
forest.add(trees, trunks);
const water = new MeshStandardMaterial({
  color: "#82aaa9",
  roughness: 0.4,
  metalness: 0.12,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});
// Shared edges avoid overlapping water tiles. Separation and depth bias keep
// the ribbon above the ground even at shallow viewing angles in the distance.
const riverGeometry = new BufferGeometry();
const riverVertices: number[] = [];
const riverIndices: number[] = [];
for (let i = 0; i <= 240; i++) {
  const z = -3000 + i * 25;
  const x = Math.sin(z / 250) * 80;
  riverVertices.push(x - 27.5, 0.2, z, x + 27.5, 0.2, z);
  if (i < 240) {
    const a = i * 2;
    riverIndices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
}
riverGeometry.setAttribute("position", new Float32BufferAttribute(riverVertices, 3));
riverGeometry.setIndex(riverIndices);
riverGeometry.computeVertexNormals();
forest.add(new Mesh(riverGeometry, water));

const camera = new PerspectiveCamera(48, 1, 0.5, 3500);
const renderedPosition = new Vector3();
const renderedRotation = new Quaternion();
const cameraTarget = new Vector3();
const { onBeforeRender } = useLoop();
onBeforeRender(() => {
  session.frame();
  const f = session.model;
  const alpha = session.running ? session.clock.alpha : 1;
  renderedPosition.copy(f.previousPosition).lerp(f.position, alpha);
  renderedRotation.copy(f.previousOrientation).slerp(f.orientation, alpha);
  bird.position.copy(renderedPosition);
  bird.quaternion.copy(renderedRotation);
  const inverseRotation = renderedRotation.clone().invert();
  legs.forEach((leg, i) => {
    const foot = f.legs.feet[i]!;
    const target = foot.previous
      .clone()
      .lerp(foot.position, alpha)
      .sub(renderedPosition)
      .applyQuaternion(inverseRotation);
    const pose = legPose(leg.side, target);
    placeLink(leg.upper, pose.hip, pose.joint);
    placeLink(leg.lower, pose.joint, pose.ankle);
    leg.hip.position.copy(pose.hip);
    leg.joint.position.copy(pose.joint);
    leg.foot.position.copy(pose.ankle);
    leg.foot.rotation.x = f.flying && f.position.y > 1.1 ? -0.6 : 0;
  });
  f.surfaces.forEach((s, i) => {
    const span = new Vector3().crossVectors(s.chord, s.normal).normalize();
    const matrix = new Matrix4().makeBasis(span, s.normal, s.chord.clone().negate());
    feathers[i]!.quaternion.setFromRotationMatrix(matrix);
    feathers[i]!.position.copy(s.position).addScaledVector(s.chord, -s.chordLength * 0.25);
    feathers[i]!.scale.set(s.width * 1.03, 0.012, s.chordLength);
    const arrow = arrows[i];
    if (arrow) {
      arrow.visible = session.settings.showForces;
      arrow.position.copy(s.position);
      if (s.force.length() > 0.001) {
        arrow.setDirection(s.force.clone().normalize());
        arrow.setLength(Math.min(1.5, s.force.length() * 0.35), 0.06, 0.025);
      }
    }
  });
  camera.position.copy(session.camera.previousPosition).lerp(session.camera.position, alpha);
  cameraTarget.copy(session.camera.previousTarget).lerp(session.camera.target, alpha);
  camera.lookAt(cameraTarget);
});

onUnmounted(() => {
  const geometries = new Set();
  const materials = new Set();
  for (const group of [bird, forest])
    group.traverse((object) => {
      if (object instanceof Mesh) {
        if (!geometries.has(object.geometry)) {
          object.geometry.dispose();
          geometries.add(object.geometry);
        }
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          if (!materials.has(material)) {
            material.dispose();
            materials.add(material);
          }
        }
      }
    });
  arrows.forEach((arrow) => arrow.dispose());
});
</script>

<template>
  <primitive :object="camera" />
  <TresFog :args="['#c7d9cf', 180, 1300]" />
  <TresHemisphereLight :args="['#f7f0dc', '#5d7568', 2.5]" />
  <TresDirectionalLight :position="[150, 200, 70]" :intensity="3" color="#ffe2b2" />
  <TresMesh :rotation="[-Math.PI / 2, 0, 0]">
    <!-- Smaller triangles prevent the ground from obscuring feet at close viewing distances. -->
    <TresPlaneGeometry :args="[20000, 20000, 100, 100]" />
    <TresMeshStandardMaterial color="#99aa89" :roughness="1" />
  </TresMesh>
  <primitive :object="forest" />
  <primitive :object="bird" />
</template>
