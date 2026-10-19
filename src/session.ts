import { computed, markRaw, onScopeDispose, reactive, ref, shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import { DualSense } from "./controller/device";
import { TorqueFeedback } from "./controller/feedback";
import { MotionFilter, TABLE_CAPTURE_SECONDS } from "./controller/motion";
import { KEYBOARD_BINDINGS, keyboardInput } from "./controller/keyboard";
import { NEUTRAL_PLAYER_INPUT, stick } from "./controller/input";
import type { PlayerInput } from "./controller/input";
import {
  loadPreferences,
  savePreferences,
  loadTableReference,
  saveTableReference,
  clearTableReference,
} from "./controller/preferences";
import { DEG, POLAR } from "./flight/aerodynamics";
import { FixedClock, InputTimeline } from "./flight/clock";
import { BIRD, GROUND, FlightModel } from "./flight/model";
import type { FlightInput } from "./flight/model";
import { BirdCamera } from "./flight/camera";
import { POSTURE } from "./flight/posture";
import { FlightRecorder } from "./flight/recorder";
import { generateForest } from "./world/forest";
import { WorldCollision } from "./world/collision";
import { SCENES, type SceneId, type WorldData } from "./world/types";

function sceneSession(world: WorldData) {
  world.update?.(world.spawn.position[0], world.spawn.position[2]);
  const model = markRaw(new FlightModel(8, new WorldCollision(world.solids)));
  model.place(world.spawn);
  const camera = markRaw(new BirdCamera());
  camera.reset(model);
  return { world: markRaw(world), model, camera };
}

export const useSession = defineStore("session", () => {
  const initial = sceneSession(generateForest());
  const scenes = new Map<SceneId, ReturnType<typeof sceneSession>>([["forest", initial]]);
  const world = shallowRef(initial.world);
  const model = shallowRef(initial.model);
  const clock = markRaw(new FixedClock());
  const camera = shallowRef(initial.camera);
  const sceneId = computed(() => world.value.id);
  const sceneName = computed(() => SCENES.find((scene) => scene.id === sceneId.value)!.name);
  const sceneLoading = ref(false);
  const modalOpen = () => !!document.querySelector("dialog:modal");
  const timeline = new InputTimeline(NEUTRAL_PLAYER_INPUT);
  let stepAt = 0;
  let lastFrameAt = 0;
  let motion = new MotionFilter();
  let device: DualSense | null = null;
  let controllerKey = "";
  let recorder: FlightRecorder | null = null;
  let lastFlightInput: FlightInput = { left: 0, right: 0, pitch: 0, roll: 0 };
  const recordingStatus = ref("");
  const controllerInput = { ...NEUTRAL_PLAYER_INPUT };
  let optionsDown = false;
  let operation = 0;
  let scheduledAction: (() => void) | null = null;
  let actionAt = 0;
  let previousMetricsAt = performance.now();
  let previousReceived = 0;
  let previousSent = 0;
  const feedback = [new TorqueFeedback(), new TorqueFeedback()];
  const connected = ref(false);
  const connecting = ref(false);
  const running = ref(false);
  const starting = ref(false);
  const countdown = ref(0);
  const mode = ref<"controller" | "keyboard">("controller");
  const message = ref("Connect a DualSense or choose Keyboard to begin.");
  const error = ref("");
  const calibrated = ref(false);
  const calibrating = ref(false);
  const calibrationProgress = ref(0);
  const settings = reactive({
    ...loadPreferences(),
    showForces: false,
  });
  watch(settings, savePreferences, { flush: "sync" });
  const keyboard = reactive({ ...NEUTRAL_PLAYER_INPUT });
  const pressed = new Set<string>();
  const telemetry = reactive({
    speed: model.value.velocity.length(),
    height: 80,
    sink: model.value.velocity.y,
    time: 0,
    phase: model.value.phase,
    left: 0,
    right: 0,
    pitch: 0,
    roll: 0,
    leftAngle: 0,
    rightAngle: 0,
    leftTorque: 0,
    rightTorque: 0,
    leftStrength: 0,
    rightStrength: 0,
    inputHz: 0,
    outputHz: 0,
    latency: 0,
    rejected: 0,
    motionAge: Infinity,
    motionReady: false,
    tablePitch: 0,
    tableRoll: 0,
    transport: "",
    name: "",
    factory: false,
    stalled: false,
    jointPower: 0,
    alpha: 0,
  });
  const canStart = computed(
    () =>
      !sceneLoading.value &&
      (mode.value === "keyboard" ||
        (connected.value && telemetry.motionReady && telemetry.motionAge < 250)),
  );
  const ready = computed(() => canStart.value && (mode.value === "keyboard" || calibrated.value));

  const activityMessages = {
    flying: "In flight.",
    walking: "Walking.",
    hopping: "Jumping. Flap to take flight.",
    launching: "Taking off.",
  };

  function input(): PlayerInput {
    if (mode.value === "keyboard") return { ...keyboard };
    return {
      ...controllerInput,
      ...motion.commands(settings.invertPitch, settings.invertRoll),
    };
  }

  function groundInput(command: PlayerInput) {
    const direction = model.value.grounded
      ? camera.value.walkingDirection(command.walkX, command.walkY)
      : camera.value.walkingDirection(0, 0);
    return { ...direction, jump: command.jump };
  }

  function releaseKeys() {
    pressed.clear();
    Object.assign(keyboard, NEUTRAL_PLAYER_INPUT);
  }

  function stop(reason = "Paused.") {
    if (running.value) {
      recorder?.sample(model.value, lastFlightInput, telemetry.motionAge, true);
      recorder?.finish(reason);
    }
    operation++;
    running.value = false;
    starting.value = false;
    motion.calibrating = false;
    motion.resetCapture();
    calibrating.value = false;
    calibrationProgress.value = 0;
    releaseKeys();
    scheduledAction = null;
    countdown.value = 0;
    clock.accumulator = 0;
    feedback.forEach((f) => f.reset());
    telemetry.leftStrength = 0;
    telemetry.rightStrength = 0;
    void device?.writer?.off();
    message.value = reason;
  }

  async function connect() {
    if (connecting.value || connected.value) return;
    connecting.value = true;
    error.value = "";
    motion = new MotionFilter();
    calibrated.value = false;
    calibrating.value = false;
    telemetry.motionReady = false;
    optionsDown = false;
    Object.assign(controllerInput, NEUTRAL_PLAYER_INPUT);
    const controller = new DualSense(
      (sample) => {
        const walk = stick(sample.leftStick.x, sample.leftStick.y);
        const look = stick(sample.rightStick.x, sample.rightStick.y);
        Object.assign(controllerInput, {
          left: sample.left,
          right: sample.right,
          walkX: walk.x,
          walkY: walk.y,
          lookX: look.x,
          lookY: look.y,
          jump: sample.triangle,
        });
        if (sample.motion) {
          if (motion.calibrating && document.hidden) motion.resetCapture();
          else
            motion.update(sample.motion.gyro, sample.motion.acceleration, sample.motion.timestamp);
          if (!calibrated.value && motion.reference) {
            calibrated.value = true;
            calibrating.value = false;
            saveTableReference(controllerKey, motion.reference);
            message.value = "Tabletop neutral captured. Pick up the controller, then start flight.";
          }
        }
        if (running.value && mode.value === "controller")
          timeline.push(performance.now() / 1000, input());
        const optionsPressed = sample.options && !optionsDown;
        optionsDown = sample.options;
        if (
          optionsPressed &&
          connected.value &&
          mode.value === "controller" &&
          !document.hidden &&
          !modalOpen()
        )
          toggleFlight();
      },
      (detail) => {
        stop("Controller input stopped.");
        error.value = detail;
        connected.value = !!device?.device;
      },
    );
    device = controller;
    try {
      connected.value = await controller.connect();
      if (connected.value) {
        mode.value = "controller";
        controllerKey = `${controller.device!.vendorId}-${controller.device!.productId}`;
        const saved = loadTableReference(controllerKey);
        if (saved) {
          motion.restore(saved);
          calibrated.value = true;
          message.value = "Saved tabletop neutral loaded. Start when you are ready.";
        } else message.value = "Connected. Select Start flight to measure the tabletop neutral.";
      }
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : String(failure);
      try {
        await controller.disconnect();
      } catch {
        /* Preserve the original connection error. */
      }
    } finally {
      connecting.value = false;
    }
  }

  async function disconnect() {
    stop();
    try {
      await device?.disconnect();
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : String(failure);
    }
    device = null;
    connected.value = false;
    calibrated.value = false;
    calibrating.value = false;
    telemetry.motionReady = false;
    motion.calibrating = false;
    message.value = "Controller disconnected.";
  }

  function beginTableCapture() {
    stop(
      "Place the controller face up on a level table and let go. Neutral is captured automatically after 2 seconds of stillness.",
    );
    motion.beginCalibration();
    calibrated.value = false;
    calibrating.value = true;
    calibrationProgress.value = 0;
  }

  function resetNeutral() {
    if (!connected.value || running.value || starting.value) return;
    clearTableReference(controllerKey);
    motion = new MotionFilter();
    beginTableCapture();
  }

  async function start() {
    if (!ready.value || starting.value || running.value || modalOpen()) return;
    error.value = "";
    starting.value = true;
    const request = ++operation;
    if (mode.value === "controller") await device?.writer?.arm();
    if (request !== operation || document.hidden) return;
    if (
      mode.value === "controller" &&
      (!device?.device || performance.now() - device.lastMotionAt > 250)
    ) {
      stop("Motion input stopped before flight could start.");
      return;
    }
    const command = input();
    model.value.synchronize(command, groundInput(command));
    clock.accumulator = 0;
    lastFrameAt = performance.now();
    stepAt = lastFrameAt / 1000;
    timeline.reset(input());
    lastFlightInput = input();
    if (import.meta.env.DEV) {
      const recording = new FlightRecorder(
        {
          mode: mode.value,
          scene: world.value.id,
          seed: world.value.seed,
          controller: telemetry.name,
          transport: telemetry.transport,
          factoryCalibrated: telemetry.factory,
          settings: { ...settings },
          tableReference: motion.reference,
          bird: BIRD,
          ground: GROUND,
          posture: POSTURE,
          polar: POLAR,
          flightModel: "world-flight-v1",
          modelStartTimeS: model.value.time,
        },
        model.value.time,
        (status) => {
          if (recorder === recording) recordingStatus.value = status;
        },
      );
      recorder = recording;
      recordingStatus.value = "Recording flight locally…";
      recorder.sample(model.value, lastFlightInput, telemetry.motionAge);
    }
    running.value = true;
    starting.value = false;
    message.value = activityMessages[model.value.phase];
  }

  function activate(scene: ReturnType<typeof sceneSession>) {
    scene.world.update?.(scene.model.position.x, scene.model.position.z);
    world.value = scene.world;
    model.value = scene.model;
    camera.value = scene.camera;
    Object.assign(telemetry, {
      phase: scene.model.phase,
      speed: scene.model.velocity.length(),
      height: scene.model.position.y,
      sink: scene.model.velocity.y,
      time: scene.model.time,
    });
  }

  async function chooseScene(id: SceneId) {
    if (sceneLoading.value || id === sceneId.value) return;
    stop();
    sceneLoading.value = true;
    try {
      let scene = scenes.get(id);
      if (!scene) {
        const data =
          id === "city" ? (await import("./world/city")).generateCity() : generateForest();
        scene = sceneSession(data);
        scenes.set(id, scene);
      }
      activate(scene);
      message.value = `${sceneName.value} ready. Start when you are ready.`;
    } finally {
      sceneLoading.value = false;
    }
  }

  function reset() {
    stop("Reset to the scene's starting point. Start when you are ready.");
    const scene = sceneSession(world.value);
    scenes.set(sceneId.value, scene);
    activate(scene);
  }

  function chooseMode(value: "controller" | "keyboard") {
    if (mode.value === value) return;
    stop();
    mode.value = value;
    message.value =
      value === "keyboard"
        ? "Ready to fly."
        : connected.value
          ? "Ready. Start flight to use or measure the tabletop neutral."
          : "Connect a DualSense to begin.";
  }

  function schedule(action: () => void, description: string) {
    stop(`${description} in 3 seconds. Put both hands on the controller.`);
    scheduledAction = action;
    actionAt = performance.now() + 3000;
    countdown.value = 3;
  }

  function queueStart() {
    if (!canStart.value || modalOpen()) return;
    if (mode.value === "controller" && !calibrated.value) {
      beginTableCapture();
      return;
    }
    if (model.value.grounded) {
      void start();
      return;
    }
    schedule(() => {
      if (!ready.value) {
        stop("Wait for fresh motion input and the tabletop neutral measurement before starting.");
        return;
      }
      void start();
    }, "Start flight");
  }

  function toggleFlight() {
    if (running.value || countdown.value || starting.value || calibrating.value) stop();
    else if (mode.value === "controller") queueStart();
    else void start();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (
      mode.value !== "keyboard" ||
      document.hidden ||
      modalOpen() ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.("input, textarea, select, [contenteditable]")) return;
    if (event.code === "Space" && target?.closest?.("button, summary, a")) return;
    if (!KEYBOARD_BINDINGS.some((binding) => binding.codes.includes(event.code))) return;
    event.preventDefault();
    if (event.repeat) return;
    if (event.code === "Space") toggleFlight();
    else if (event.code === "KeyR") reset();
    else {
      pressed.add(event.code);
      Object.assign(keyboard, keyboardInput(pressed));
    }
  }

  function onKeyUp(event: KeyboardEvent) {
    if (!pressed.delete(event.code)) return;
    event.preventDefault();
    Object.assign(keyboard, keyboardInput(pressed));
  }

  watch(
    keyboard,
    () => {
      if (running.value && mode.value === "keyboard")
        timeline.push(performance.now() / 1000, input());
    },
    { flush: "sync" },
  );

  function frame() {
    if (sceneLoading.value || modalOpen()) return;
    world.value.update?.(model.value.position.x, model.value.position.z);
    if (!running.value) {
      if (mode.value === "keyboard" || connected.value) {
        const command = input();
        model.value.synchronize(command, groundInput(command));
      }
      return;
    }
    const now = performance.now();
    const delta = (now - lastFrameAt) / 1000;
    lastFrameAt = now;
    if (
      !clock.advance(delta, (dt) => {
        stepAt += dt;
        const command = timeline.sample(stepAt);
        const phase = model.value.phase;
        model.value.step(command, dt, groundInput(command));
        camera.value.step(model.value, command.lookX, command.lookY, dt);
        if (model.value.phase !== phase) {
          telemetry.phase = model.value.phase;
          message.value = activityMessages[model.value.phase];
        }
        lastFlightInput = command;
        recorder?.sample(
          model.value,
          command,
          mode.value === "controller" && device
            ? Math.max(0, performance.now() - device.lastMotionAt)
            : 0,
          model.value.phase !== phase,
        );
        for (let i = 0; i < 2; i++)
          if (model.value.phase === "flying")
            feedback[i]!.update(model.value.wings[i]!.torque, settings.comfort, dt);
          else feedback[i]!.reset();
      })
    )
      stop("Paused after a long frame. Resume when ready.");
  }

  // Independent of rendering: watch freshness, send latest effects, sample UI.
  const timer = window.setInterval(() => {
    const now = performance.now();
    void recorder?.flush();
    if (scheduledAction) {
      countdown.value = Math.max(0, Math.ceil((actionAt - now) / 1000));
      if (now >= actionAt) {
        const action = scheduledAction;
        scheduledAction = null;
        action();
      }
    }
    if (running.value && mode.value === "controller") {
      if (!device?.device || now - device.lastMotionAt > 250 || document.hidden)
        stop("Paused because motion input stopped.");
    }
    if (running.value && mode.value === "controller")
      device?.writer?.update(feedback[0]!.level, feedback[1]!.level);
    if (now - previousMetricsAt < 100) return;
    const elapsed = (now - previousMetricsAt) / 1000;
    const f = model.value;
    const command = input();
    Object.assign(telemetry, {
      speed: f.flying
        ? f.velocity.clone().sub(f.wind).length()
        : Math.hypot(f.velocity.x, f.velocity.z),
      height: f.position.y,
      sink: f.velocity.y,
      time: f.time,
      phase: f.phase,
      left: command.left,
      right: command.right,
      pitch: command.pitch / DEG,
      roll: command.roll / DEG,
      leftAngle: f.wings[0].angle / DEG,
      rightAngle: f.wings[1].angle / DEG,
      leftTorque: -f.wings[0].torque,
      rightTorque: -f.wings[1].torque,
      leftStrength: feedback[0]!.level,
      rightStrength: feedback[1]!.level,
      inputHz: device ? (device.received - previousReceived) / elapsed : 0,
      outputHz: device ? (device.sent - previousSent) / elapsed : 0,
      latency: device?.writeMilliseconds ?? 0,
      rejected: device?.rejected ?? 0,
      motionAge: device ? now - device.lastMotionAt : Infinity,
      motionReady: !!device?.device && motion.initialized,
      tablePitch: (motion.tableAngles?.pitch ?? 0) / DEG,
      tableRoll: (motion.tableAngles?.roll ?? 0) / DEG,
      transport: device?.transport ?? "",
      name: device?.device?.productName ?? "",
      factory: device?.factoryCalibrated ?? false,
      stalled: f.wings.some((w) => w.surfaces.some((s) => s.separated > 0.5)),
      jointPower: f.jointPower,
      alpha: f.wings[0].surfaces[3]!.alpha / DEG,
    });
    previousReceived = device?.received ?? 0;
    previousSent = device?.sent ?? 0;
    previousMetricsAt = now;
    calibrating.value = motion.calibrating;
    calibrationProgress.value = Math.min(1, motion.calibrationSeconds / TABLE_CAPTURE_SECONDS);
  }, 1000 / 60);

  const onHidden = () => {
    if (document.hidden) stop("Paused while this page is hidden.");
  };
  const onPageHide = () => stop();
  const onBlur = () => {
    if (mode.value === "keyboard") stop("Paused while the window is inactive.");
  };
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("blur", onBlur);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  onScopeDispose(() => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onHidden);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    void disconnect();
  });

  return {
    model,
    world,
    sceneId,
    sceneName,
    sceneLoading,
    chooseScene,
    clock,
    camera,
    connected,
    connecting,
    running,
    starting,
    countdown,
    mode,
    message,
    recordingStatus,
    error,
    calibrated,
    calibrating,
    calibrationProgress,
    settings,
    keyboard,
    releaseKeys,
    telemetry,
    canStart,
    ready,
    connect,
    disconnect,
    resetNeutral,
    start,
    stop,
    reset,
    chooseMode,
    toggleFlight,
    queueStart,
    frame,
  };
});
