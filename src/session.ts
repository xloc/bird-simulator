import { computed, markRaw, onScopeDispose, reactive, ref, shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import { DualSense } from "./controller/device";
import { TorqueFeedback } from "./controller/feedback";
import { MotionFilter, TABLE_CAPTURE_SECONDS } from "./controller/motion";
import { KEYBOARD_BINDINGS, keyboardInput } from "./controller/keyboard";
import {
  loadPreferences,
  savePreferences,
  loadTableReference,
  saveTableReference,
  clearTableReference,
} from "./controller/preferences";
import { DEG, POLAR } from "./flight/aerodynamics";
import { FixedClock, InputTimeline } from "./flight/clock";
import { BIRD, FlightModel, NEUTRAL_INPUT } from "./flight/model";
import type { FlightInput } from "./flight/model";
import { POSTURE } from "./flight/posture";
import { FlightRecorder } from "./flight/recorder";

export const useSession = defineStore("session", () => {
  const model = shallowRef(markRaw(new FlightModel()));
  const clock = markRaw(new FixedClock());
  const timeline = new InputTimeline();
  let stepAt = 0;
  let lastFrameAt = 0;
  let motion = new MotionFilter();
  let device: DualSense | null = null;
  let controllerKey = "";
  let recorder: FlightRecorder | null = null;
  let lastFlightInput: FlightInput = { left: 0, right: 0, pitch: 0, roll: 0 };
  const recordingStatus = ref("");
  let rawLeft = 0;
  let rawRight = 0;
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
  const keyboard = reactive({ ...NEUTRAL_INPUT });
  const pressed = new Set<string>();
  const telemetry = reactive({
    speed: model.value.velocity.length(),
    height: 80,
    sink: model.value.velocity.y,
    time: 0,
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
      mode.value === "keyboard" ||
      (connected.value && telemetry.motionReady && telemetry.motionAge < 250),
  );
  const ready = computed(() => canStart.value && (mode.value === "keyboard" || calibrated.value));

  function input(): FlightInput {
    if (mode.value === "keyboard") return { ...keyboard };
    return {
      left: rawLeft,
      right: rawRight,
      ...motion.commands(settings.invertPitch, settings.invertRoll),
    };
  }

  function releaseKeys() {
    pressed.clear();
    Object.assign(keyboard, NEUTRAL_INPUT);
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
    const controller = new DualSense(
      (sample) => {
        rawLeft = sample.left;
        rawRight = sample.right;
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
        if (optionsPressed && connected.value && mode.value === "controller" && !document.hidden)
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
    if (!ready.value || starting.value || running.value) return;
    if (model.value.grounded) reset();
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
    model.value.synchronize(input());
    clock.accumulator = 0;
    lastFrameAt = performance.now();
    stepAt = lastFrameAt / 1000;
    timeline.reset(input());
    lastFlightInput = input();
    if (import.meta.env.DEV) {
      const recording = new FlightRecorder(
        {
          mode: mode.value,
          controller: telemetry.name,
          transport: telemetry.transport,
          factoryCalibrated: telemetry.factory,
          settings: { ...settings },
          tableReference: motion.reference,
          bird: BIRD,
          posture: POSTURE,
          polar: POLAR,
          flightModel: "coordinated-strokes-v2",
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
    message.value = "In flight.";
  }

  function reset() {
    stop("Reset to a trimmed glide. Start when you are ready.");
    model.value = markRaw(new FlightModel());
  }

  function chooseMode(value: "controller" | "keyboard") {
    if (mode.value === value) return;
    reset();
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
    if (!canStart.value) return;
    if (mode.value === "controller" && !calibrated.value) {
      beginTableCapture();
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
    if (!running.value) {
      if (mode.value === "keyboard" || connected.value) model.value.synchronize(input());
      return;
    }
    const now = performance.now();
    const delta = (now - lastFrameAt) / 1000;
    lastFrameAt = now;
    if (
      !clock.advance(delta, (dt) => {
        stepAt += dt;
        const command = timeline.sample(stepAt);
        model.value.step(command, dt);
        lastFlightInput = command;
        recorder?.sample(
          model.value,
          command,
          mode.value === "controller" && device
            ? Math.max(0, performance.now() - device.lastMotionAt)
            : 0,
          model.value.grounded,
        );
        for (let i = 0; i < 2; i++)
          feedback[i]!.update(model.value.wings[i]!.torque, settings.comfort, dt);
      })
    )
      stop("Paused after a long frame. Resume when ready.");
    if (model.value.grounded) stop("Ground reached. Reset to try another flight.");
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
      speed: f.velocity.clone().sub(f.wind).length(),
      height: f.position.y,
      sink: f.velocity.y,
      time: f.time,
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
    clock,
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
