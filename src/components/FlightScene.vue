<script setup lang="ts">
import { onUnmounted, watch } from "vue";
import { useLoop } from "@tresjs/core";
import { Group, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { useSession } from "../session";
import { createBirdRenderer } from "../render/bird";
import { createWorldRenderer } from "../world/render";

const session = useSession();
const birdRenderer = createBirdRenderer(session.model);
const bird = birdRenderer.group;

const environment = new Group();
let worldRenderer: ReturnType<typeof createWorldRenderer>;
watch(
  () => session.world,
  (world) => {
    worldRenderer?.dispose();
    environment.clear();
    worldRenderer = createWorldRenderer(world);
    environment.add(worldRenderer.group);
  },
  { immediate: true },
);

const camera = new PerspectiveCamera(48, 1, 0.05, 3500);
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
  worldRenderer.update(renderedPosition.x, renderedPosition.z);
  bird.position.copy(renderedPosition).sub(worldRenderer.origin);
  bird.quaternion.copy(renderedRotation);
  birdRenderer.update(f, alpha, session.settings.showForces);
  camera.position.copy(session.camera.previousPosition).lerp(session.camera.position, alpha);
  camera.position.sub(worldRenderer.origin);
  cameraTarget
    .copy(session.camera.previousTarget)
    .lerp(session.camera.target, alpha)
    .sub(worldRenderer.origin);
  camera.lookAt(cameraTarget);
});

onUnmounted(() => {
  birdRenderer.dispose();
  worldRenderer.dispose();
});
</script>

<template>
  <primitive :object="camera" />
  <TresFog
    :args="[
      session.world.skyColor,
      session.world.id === 'city' ? 120 : 180,
      session.world.id === 'city' ? 450 : 1300,
    ]"
  />
  <TresHemisphereLight :args="['#f7f0dc', '#5d7568', 2.5]" />
  <TresDirectionalLight :position="[150, 200, 70]" :intensity="3" color="#ffe2b2" />
  <primitive :object="environment" />
  <primitive :object="bird" />
</template>
