<script setup lang="ts">
import { ref } from "vue";
import { SCENES, type SceneId } from "../world/types";
import { useSession } from "../session";

defineProps<{ buttonClass: string }>();

const session = useSession();
const dialog = ref<HTMLDialogElement>();

function open() {
  session.stop();
  dialog.value?.showModal();
}

async function choose(id: SceneId) {
  await session.chooseScene(id);
  dialog.value?.close();
}
</script>

<template>
  <div>
    <p>Scene · {{ session.sceneName }}</p>
    <button :class="buttonClass" class="w-full" @click="open">Choose scene</button>
  </div>

  <dialog
    ref="dialog"
    class="fixed inset-0 max-h-[80dvh] w-[min(90vw,48rem)] place-self-center overflow-y-auto"
    @cancel="session.stop()"
  >
    <form method="dialog">
      <div class="flex h-16 items-center justify-between">
        <h2>Choose a scene</h2>
        <button type="submit" :class="buttonClass">Close</button>
      </div>
    </form>
    <div class="grid sm:grid-cols-2">
      <button
        v-for="scene in SCENES"
        :key="scene.id"
        :disabled="session.sceneLoading"
        :class="buttonClass"
        class="flex min-h-32 flex-col items-center justify-center"
        @click="choose(scene.id)"
      >
        <span>{{ scene.name }}{{ scene.id === session.sceneId ? " · Selected" : "" }}</span>
        <span>{{ scene.description }}</span>
      </button>
    </div>
  </dialog>
</template>
