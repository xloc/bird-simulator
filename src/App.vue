<script setup lang="ts">
import { onErrorCaptured, ref } from "vue";
import { TresCanvas } from "@tresjs/core";
import FlightScene from "./components/FlightScene.vue";
import { useSession } from "./session";
import { KEYBOARD_BINDINGS } from "./controller/keyboard";
import { DEG } from "./flight/aerodynamics";
import { POSTURE } from "./flight/posture";

const session = useSession();
const sceneError = ref("");
const button =
  "rounded-lg border border-white/15 px-3 py-2 text-sm transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35";
onErrorCaptured((error) => {
  sceneError.value = error.message;
  session.stop("The flight scene stopped.");
  return false;
});
</script>

<template>
  <main
    class="flex min-h-dvh flex-col bg-[#162c31] font-sans text-[#f0eee3] scheme-dark lg:h-dvh lg:overflow-hidden"
  >
    <div class="grid flex-1 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_350px]">
      <section class="relative h-[62dvh] min-h-96 min-w-0 overflow-hidden bg-[#c7d9cf] lg:h-full">
        <TresCanvas v-if="!sceneError" clear-color="#c7d9cf" :dpr="[1, 1.75]" :antialias="true">
          <FlightScene />
        </TresCanvas>
        <div v-else class="absolute inset-0 flex items-center justify-center p-8 text-[#203c3b]">
          <p>Could not start the 3D scene: {{ sceneError }}. Check that WebGL is enabled.</p>
        </div>
        <div
          class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-6 text-[#294742]"
        >
          <div>
            <p class="text-[10px] font-semibold tracking-[0.22em]">OPEN AIR / FLIGHT 01</p>
            <p class="mt-2 font-serif text-2xl">Find your wings.</p>
          </div>
          <span
            class="rounded-full border border-[#294742]/20 bg-[#f4f1dd]/50 px-3 py-1 text-[10px] font-medium tracking-widest"
          >
            {{
              session.running
                ? session.telemetry.stalled
                  ? "SEPARATED FLOW"
                  : "IN FLIGHT"
                : session.model.grounded
                  ? "GROUNDED"
                  : "PAUSED"
            }}
          </span>
        </div>
        <div
          v-if="session.countdown"
          class="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <span
            class="flex h-24 w-24 items-center justify-center rounded-full bg-[#f4f1dd]/80 font-serif text-5xl text-[#294742]"
            >{{ session.countdown }}</span
          >
        </div>
        <div
          class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#16332d]/65 to-transparent px-6 pt-20 pb-5"
        >
          <div class="flex items-end justify-between gap-4">
            <dl
              class="grid auto-cols-[3.75rem] grid-flow-col gap-x-2.5 min-[360px]:auto-cols-[4.25rem] sm:auto-cols-[5.5rem] sm:gap-x-5 xl:auto-cols-[7rem]"
            >
              <div>
                <dt class="text-[10px] tracking-[0.12em] text-white/60 sm:tracking-[0.18em]">
                  AIRSPEED
                </dt>
                <dd
                  class="mt-1 whitespace-nowrap text-base font-light tabular-nums min-[360px]:text-lg sm:text-2xl xl:text-3xl"
                >
                  {{ session.telemetry.speed.toFixed(1) }}
                  <span class="text-xs text-white/60">m/s</span>
                </dd>
              </div>
              <div>
                <dt class="text-[10px] tracking-[0.12em] text-white/60 sm:tracking-[0.18em]">
                  ALTITUDE
                </dt>
                <dd
                  class="mt-1 whitespace-nowrap text-base font-light tabular-nums min-[360px]:text-lg sm:text-2xl xl:text-3xl"
                >
                  {{ session.telemetry.height.toFixed(0) }}
                  <span class="text-xs text-white/60">m</span>
                </dd>
              </div>
              <div class="hidden sm:block">
                <dt class="text-[10px] tracking-[0.12em] text-white/60 sm:tracking-[0.18em]">
                  VERTICAL
                </dt>
                <dd
                  class="relative mt-1 whitespace-nowrap text-base font-light tabular-nums min-[360px]:text-lg sm:text-2xl xl:text-3xl"
                >
                  <span v-if="session.telemetry.sink <= -0.05" class="absolute right-full">−</span
                  >{{ Math.abs(session.telemetry.sink).toFixed(1) }}
                  <span class="text-xs text-white/60">m/s</span>
                </dd>
              </div>
              <div
                v-for="axis in ['pitch', 'roll'] as const"
                :key="axis"
                :title="axis === 'pitch' ? 'Pitch input' : 'Bank input'"
              >
                <dt
                  class="whitespace-nowrap text-[10px] tracking-[0.12em] text-white/60 sm:tracking-[0.18em]"
                >
                  {{ axis === "pitch" ? "PITCH" : "BANK"
                  }}<span class="hidden sm:inline"> INPUT</span>
                </dt>
                <dd
                  class="relative mt-1 whitespace-nowrap text-base font-light tabular-nums min-[360px]:text-lg sm:text-2xl xl:text-3xl"
                >
                  <span v-if="session.telemetry[axis] <= -0.05" class="absolute right-full">−</span
                  >{{ Math.abs(session.telemetry[axis]).toFixed(1) }}
                  <span class="text-xs text-white/60">deg</span>
                </dd>
              </div>
            </dl>
            <span class="hidden text-xs whitespace-nowrap tabular-nums text-white/60 sm:inline"
              >{{ session.telemetry.time.toFixed(1) }} s</span
            >
          </div>
          <div class="mt-5 grid grid-cols-2 gap-4 border-t border-white/20 pt-3 sm:gap-8">
            <div v-for="side in ['left', 'right'] as const" :key="side">
              <div
                class="flex flex-col gap-1 text-[10px] tracking-widest text-white/70 sm:flex-row sm:justify-between"
              >
                <span class="whitespace-nowrap">
                  {{
                    session.mode === "controller"
                      ? side === "left"
                        ? "L2"
                        : "R2"
                      : side === "left"
                        ? "F"
                        : "J"
                  }}
                  · {{ side === "left" ? "LEFT WING" : "RIGHT WING" }}
                </span>
                <span class="whitespace-nowrap tabular-nums"
                  >{{
                    session.telemetry[side === "left" ? "leftTorque" : "rightTorque"].toFixed(2)
                  }}
                  N·m</span
                >
              </div>
              <progress
                :value="session.telemetry[side]"
                max="1"
                class="mt-2 block h-1 w-full accent-[#e0b582]"
              ></progress>
            </div>
          </div>
        </div>
      </section>

      <aside
        class="flex min-w-0 flex-col gap-7 border-t border-white/10 px-5 py-6 sm:px-6 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l lg:py-8"
      >
        <h1 class="font-serif text-3xl tracking-tight">
          bird<span class="text-[#ddac79]">.</span>
        </h1>

        <section class="space-y-3">
          <div class="flex gap-2">
            <button
              class="min-h-11 flex-1 rounded-lg bg-[#d9e4cf] px-4 py-3 text-sm font-medium text-[#233b32] transition hover:bg-[#e9eedf] disabled:cursor-not-allowed disabled:opacity-35"
              :disabled="
                !session.running &&
                !session.countdown &&
                !session.calibrating &&
                (!session.canStart || !!sceneError || session.starting)
              "
              @click="session.toggleFlight"
            >
              {{
                session.calibrating
                  ? "Cancel calibration"
                  : session.countdown
                    ? "Cancel countdown"
                    : session.running
                      ? "Pause flight"
                      : session.starting
                        ? "Starting…"
                        : "Start flight"
              }}
            </button>
            <button :class="button" @click="session.reset">Reset</button>
          </div>
          <p v-if="!session.calibrating" class="text-xs leading-relaxed text-white/60">
            {{ session.message }}
          </p>
          <p
            v-if="session.error"
            class="rounded-lg border border-[#ddac79]/30 bg-[#ddac79]/10 p-3 text-xs leading-relaxed text-[#efc49a]"
          >
            {{ session.error }}
          </p>
        </section>

        <section class="space-y-5 border-t border-white/10 pt-5">
          <div class="space-y-3">
            <h2 class="text-sm font-medium text-white/80">Controls</h2>
            <div class="flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/75">
              <label
                v-for="option in [
                  { value: 'controller', label: 'DualSense' },
                  { value: 'keyboard', label: 'Keyboard' },
                ] as const"
                :key="option.value"
                class="flex min-h-8 cursor-pointer items-center gap-2"
              >
                <input
                  type="radio"
                  name="flight-input"
                  :value="option.value"
                  :checked="session.mode === option.value"
                  :disabled="session.connecting"
                  class="accent-[#d9e4cf]"
                  @change="session.chooseMode(option.value)"
                />
                {{ option.label }}
              </label>
            </div>
          </div>

          <div v-if="session.mode === 'controller'" class="space-y-5">
            <template v-if="!session.connected">
              <button
                :disabled="session.connecting"
                :class="button"
                class="w-full"
                @click="session.connect"
              >
                {{ session.connecting ? "Connecting…" : "Connect DualSense" }}
              </button>
              <p class="text-xs leading-relaxed text-white/50">Chrome or Edge · USB or Bluetooth</p>
            </template>
            <template v-else>
              <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span class="flex items-center gap-2 text-white/65">
                  <span class="h-1.5 w-1.5 rounded-full bg-[#a6cbb0]"></span>
                  Connected · {{ session.telemetry.transport === "usb" ? "USB" : "Bluetooth" }}
                </span>
                <button
                  class="py-1 text-white/60 underline underline-offset-4 hover:text-white"
                  @click="session.disconnect"
                >
                  Disconnect
                </button>
              </div>
              <div class="flex items-center justify-between text-xs text-white/60">
                <span>Start / pause</span>
                <kbd class="font-sans">Options</kbd>
              </div>
              <p
                v-if="session.telemetry.motionAge > 250"
                class="text-xs leading-relaxed text-[#efc49a]"
              >
                Waiting for motion reports. Reconnect over USB if this continues.
              </p>
              <div v-if="session.calibrating" class="space-y-3 rounded-lg bg-white/5 p-3">
                <p class="text-sm leading-relaxed">
                  Place the controller face up on a level table and let go.
                </p>
                <p class="text-xs text-white/65">Keep it still for 2 seconds.</p>
                <progress
                  :value="session.calibrationProgress"
                  max="1"
                  class="block h-1 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-[#d9e4cf] [&::-webkit-progress-bar]:bg-white/20 [&::-webkit-progress-value]:bg-[#d9e4cf]"
                ></progress>
                <p class="text-xs tabular-nums text-white/65">
                  {{ Math.round(session.calibrationProgress * 100) }}% captured
                </p>
              </div>
              <div class="space-y-2">
                <p class="text-xs text-white/60">
                  {{ session.calibrated ? "Neutral saved" : "Neutral not measured" }}
                </p>
                <button
                  :class="button"
                  class="w-full"
                  :disabled="
                    session.running ||
                    session.starting ||
                    !!session.countdown ||
                    session.calibrating
                  "
                  @click="session.resetNeutral"
                >
                  Reset neutral point
                </button>
              </div>
              <label class="block space-y-3 text-xs text-white/70">
                <span class="flex justify-between gap-3">
                  <span>Trigger resistance</span>
                  <span class="tabular-nums"
                    >{{ Math.round(session.settings.comfort * 100) }}%</span
                  >
                </span>
                <input
                  v-model.number="session.settings.comfort"
                  type="range"
                  min="0"
                  max="1"
                  step="0.125"
                  class="block w-full accent-[#ddac79]"
                />
              </label>
              <div class="flex flex-wrap gap-x-5 gap-y-3 text-xs text-white/65">
                <label class="flex cursor-pointer items-center gap-2">
                  <input
                    v-model="session.settings.invertPitch"
                    type="checkbox"
                    class="accent-[#ddac79]"
                  />
                  Invert pitch
                </label>
                <label class="flex cursor-pointer items-center gap-2">
                  <input
                    v-model="session.settings.invertRoll"
                    type="checkbox"
                    class="accent-[#ddac79]"
                  />
                  Invert bank
                </label>
              </div>
            </template>
          </div>

          <dl
            v-else
            class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 text-xs"
          >
            <template v-for="binding in KEYBOARD_BINDINGS" :key="binding.label">
              <dt class="text-white/60">{{ binding.label }}</dt>
              <dd class="flex justify-end gap-1.5">
                <kbd
                  v-for="key in binding.keys"
                  :key="key"
                  class="flex min-h-6 min-w-6 items-center justify-center rounded border border-white/15 px-1.5 font-sans text-white/80"
                  >{{ key }}</kbd
                >
              </dd>
            </template>
          </dl>
        </section>

        <details class="border-t border-white/10 pt-5">
          <summary class="cursor-pointer text-xs text-white/55 hover:text-white/80">
            Diagnostics
          </summary>
          <div class="mt-5 space-y-5 text-xs text-white/60">
            <dl class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 tabular-nums">
              <dt>Target pitch / bank</dt>
              <dd class="text-right">
                {{ session.telemetry.pitch.toFixed(1) }}° / {{ session.telemetry.roll.toFixed(1) }}°
              </dd>
              <dt>Wing angle L / R</dt>
              <dd class="text-right">
                {{ session.telemetry.leftAngle.toFixed(1) }}° /
                {{ session.telemetry.rightAngle.toFixed(1) }}°
              </dd>
              <dt>Angle of attack</dt>
              <dd class="text-right">{{ session.telemetry.alpha.toFixed(1) }}°</dd>
              <dt>Joint work rate</dt>
              <dd class="text-right">{{ session.telemetry.jointPower.toFixed(1) }} W</dd>
              <template v-if="session.mode === 'controller' && session.connected">
                <dt>Trigger level L / R</dt>
                <dd class="text-right">
                  {{ session.telemetry.leftStrength }} / {{ session.telemetry.rightStrength }} of 8
                </dd>
                <dt>Input / output</dt>
                <dd class="text-right">
                  {{ session.telemetry.inputHz.toFixed(0) }} /
                  {{ session.telemetry.outputHz.toFixed(0) }} Hz
                </dd>
                <dt>Last write</dt>
                <dd class="text-right">{{ session.telemetry.latency.toFixed(1) }} ms</dd>
                <dt>Rejected reports</dt>
                <dd class="text-right">{{ session.telemetry.rejected }}</dd>
                <dt>Sensor scale</dt>
                <dd class="text-right">{{ session.telemetry.factory ? "Factory" : "Nominal" }}</dd>
                <dt>Table pitch / roll</dt>
                <dd class="text-right">
                  {{ session.telemetry.tablePitch.toFixed(1) }}° /
                  {{ session.telemetry.tableRoll.toFixed(1) }}°
                </dd>
              </template>
            </dl>
            <label class="flex cursor-pointer items-center gap-2">
              <input
                v-model="session.settings.showForces"
                type="checkbox"
                class="accent-[#ddac79]"
              />
              Show wing force vectors
            </label>
            <p v-if="session.recordingStatus" class="leading-relaxed text-white/50">
              {{ session.recordingStatus }}
            </p>
            <details v-if="session.mode === 'keyboard'" class="border-t border-white/10 pt-4">
              <summary class="cursor-pointer hover:text-white/80">Manual input lab</summary>
              <div class="mt-4 space-y-5">
                <label
                  v-for="side in ['left', 'right'] as const"
                  :key="side"
                  class="block space-y-2"
                >
                  <span class="flex justify-between gap-3">
                    <span>{{ side === "left" ? "Left" : "Right" }} wing</span>
                    <span>{{ Math.round(session.keyboard[side] * 100) }}%</span>
                  </span>
                  <input
                    v-model.number="session.keyboard[side]"
                    type="range"
                    min="0"
                    max="1"
                    step="0.005"
                    class="block w-full accent-[#ddac79]"
                  />
                </label>
                <label
                  v-for="axis in ['pitch', 'roll'] as const"
                  :key="axis"
                  class="block space-y-2"
                >
                  <span class="flex justify-between gap-3">
                    <span>{{ axis === "pitch" ? "Pitch" : "Bank" }}</span>
                    <span>{{ (session.keyboard[axis] / DEG).toFixed(0) }}°</span>
                  </span>
                  <input
                    v-model.number="session.keyboard[axis]"
                    type="range"
                    :min="-(axis === 'pitch' ? POSTURE.pitchLimit : POSTURE.rollLimit)"
                    :max="axis === 'pitch' ? POSTURE.pitchLimit : POSTURE.rollLimit"
                    step="0.01"
                    class="block w-full accent-[#9fbbb3]"
                  />
                </label>
                <button :class="button" class="w-full" @click="session.releaseKeys">
                  Release wings &amp; level posture
                </button>
              </div>
            </details>
          </div>
        </details>
      </aside>
    </div>
  </main>
</template>
