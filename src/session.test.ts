import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { Vector3 } from "three";
import { useSession } from "./session";
import type { InputSample } from "./controller/protocol";
import { DEG } from "./flight/aerodynamics";
import { NEUTRAL_PLAYER_INPUT } from "./controller/input";
import { GROUND } from "./flight/model";

const restingControls = {
  triangle: false,
  leftStick: { x: 0, y: 0 },
  rightStick: { x: 0, y: 0 },
};

const hardware = vi.hoisted(() => ({
  off: vi.fn(async () => {}),
  arm: vi.fn(async () => {}),
  update: vi.fn(),
  motionAge: 0,
  input: (_sample: InputSample) => {},
}));
vi.mock("./controller/device", () => ({
  DualSense: class {
    constructor(onInput: (sample: InputSample) => void) {
      hardware.input = onInput;
    }
    device = { productName: "Test DualSense", vendorId: 0x054c, productId: 0x0ce6 };
    writer = hardware;
    get lastMotionAt() {
      return performance.now() - hardware.motionAge;
    }
    get lastInputAt() {
      return performance.now() - hardware.motionAge;
    }
    received = 0;
    sent = 0;
    rejected = 0;
    writeMilliseconds = 0;
    transport = "usb";
    factoryCalibrated = true;
    async connect() {
      return true;
    }
    async disconnect() {
      await hardware.off();
    }
  },
}));

let pinia = createPinia();
let documentStub: EventTarget & {
  hidden: boolean;
  querySelector: (selector: string) => Element | null;
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  vi.clearAllMocks();
  hardware.motionAge = 0;
  documentStub = Object.assign(new EventTarget(), {
    hidden: false,
    querySelector: vi.fn(() => null),
  });
  vi.stubGlobal("document", documentStub);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setInterval, clearInterval }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  pinia = createPinia();
  setActivePinia(pinia);
});
afterEach(() => {
  disposePinia(pinia);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function connectedSession() {
  const session = useSession();
  await session.connect();
  hardware.input({
    ...restingControls,
    left: 0,
    right: 0,
    options: false,
    transport: "usb",
    motion: { gyro: new Vector3(), acceleration: new Vector3(0, 1, 0), timestamp: 0 },
  });
  vi.advanceTimersByTime(120);
  session.queueStart();
  for (let i = 1; i <= 130; i++)
    hardware.input({
      ...restingControls,
      left: 0,
      right: 0,
      options: false,
      transport: "usb",
      motion: { gyro: new Vector3(), acceleration: new Vector3(0, 1, 0), timestamp: i * 50000 },
    });
  vi.advanceTimersByTime(120);
  return session;
}

function key(type: "keydown" | "keyup", code: string, options: Record<string, unknown> = {}) {
  const event = Object.assign(new Event(type, { cancelable: true }), { code, ...options });
  window.dispatchEvent(event);
  return event;
}

describe("keyboard flight", () => {
  it("starts with Space and holds independent strokes without key-repeat flaps", () => {
    const session = useSession();
    session.chooseMode("keyboard");
    key("keydown", "Space");
    expect(session.running).toBe(true);
    key("keydown", "Space", { repeat: true });
    expect(session.running).toBe(true);
    expect(key("keydown", "KeyF").defaultPrevented).toBe(true);
    key("keydown", "KeyJ");
    for (let i = 0; i < 120; i++) {
      key("keydown", "KeyF", { repeat: true });
      vi.advanceTimersByTime(1000 / 60);
      session.frame();
    }
    expect(session.model.wings.every((wing) => wing.manual)).toBe(true);
    expect(session.model.wings.every((wing) => Math.abs(wing.rate) < 0.01)).toBe(true);
    key("keyup", "KeyF");
    expect(session.keyboard.left).toBe(0);
    expect(session.keyboard.right).toBe(1);
    vi.advanceTimersByTime(1000 / 60);
    session.frame();
    expect(session.model.wings[0].returning).toBe(true);
    expect(session.model.wings[1].manual).toBe(true);
    expect(hardware.arm).not.toHaveBeenCalled();
  });

  it("requests bounded posture, cancels opposing keys and returns to level on release", () => {
    const session = useSession();
    session.chooseMode("keyboard");
    key("keydown", "ArrowUp");
    key("keydown", "ArrowRight");
    expect(session.keyboard.pitch / DEG).toBeCloseTo(20);
    expect(session.keyboard.roll / DEG).toBeCloseTo(35);
    key("keydown", "ArrowLeft");
    expect(session.keyboard.roll).toBe(0);
    key("keyup", "ArrowRight");
    expect(session.keyboard.roll / DEG).toBeCloseTo(-35);
    key("keyup", "ArrowLeft");
    key("keyup", "ArrowUp");
    expect(session.keyboard.pitch).toBe(0);
    expect(session.keyboard.roll).toBe(0);
  });

  it("releases held input on reset, pause, focus loss and mode changes", () => {
    const session = useSession();
    session.chooseMode("keyboard");
    for (const stop of [
      () => key("keydown", "KeyR"),
      () => key("keydown", "Space"),
      () => window.dispatchEvent(new Event("blur")),
      () => session.chooseMode("controller"),
    ]) {
      session.chooseMode("keyboard");
      key("keydown", "Space");
      key("keydown", "KeyF");
      key("keydown", "ArrowUp");
      stop();
      expect(session.running).toBe(false);
      expect(session.keyboard).toEqual(NEUTRAL_PLAYER_INPUT);
      key("keyup", "KeyF");
      key("keyup", "ArrowUp");
    }
  });

  it("leaves controller mode, browser shortcuts and form controls alone", () => {
    const session = useSession();
    expect(key("keydown", "KeyF").defaultPrevented).toBe(false);
    session.chooseMode("keyboard");
    expect(key("keydown", "KeyR", { metaKey: true }).defaultPrevented).toBe(false);
    expect(key("keydown", "KeyF", { ctrlKey: true }).defaultPrevented).toBe(false);
    const event = Object.assign(new Event("keydown", { cancelable: true }), { code: "ArrowUp" });
    Object.defineProperty(event, "target", { value: { closest: () => ({}) } });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(session.keyboard).toEqual(NEUTRAL_PLAYER_INPUT);
  });
});

describe("flight session lifecycle", () => {
  it("pauses and restores each scene's model, camera, and position when switching", async () => {
    const session = useSession();
    session.chooseMode("keyboard");
    await session.start();
    const forestModel = session.model;
    const forestCamera = session.camera;
    forestModel.position.set(14, 82, -23);
    forestCamera.yaw = 1.2;

    await session.chooseScene("city");
    expect(session.running).toBe(false);
    expect(session.sceneId).toBe("city");
    const cityModel = session.model;
    const cityCamera = session.camera;
    cityModel.position.set(40, 90, 12);
    cityCamera.yaw = -0.8;

    await session.chooseScene("forest");
    expect(session.model).toBe(forestModel);
    expect(session.camera).toBe(forestCamera);
    expect(session.model.position.toArray()).toEqual([14, 82, -23]);
    expect(session.camera.yaw).toBe(1.2);

    await session.chooseScene("city");
    expect(session.model).toBe(cityModel);
    expect(session.camera).toBe(cityCamera);
    expect(session.model.position.toArray()).toEqual([40, 90, 12]);
    expect(session.camera.yaw).toBe(-0.8);
  });

  it("resets only the active scene and retains the other scene's saved state", async () => {
    const session = useSession();
    session.model.position.set(7, 75, 9);
    const forestModel = session.model;

    await session.chooseScene("city");
    session.model.position.set(35, 60, -12);
    const cityModel = session.model;
    session.reset();
    expect(session.sceneId).toBe("city");
    expect(session.model).not.toBe(cityModel);
    expect(session.model.position.toArray()).not.toEqual([35, 60, -12]);

    await session.chooseScene("forest");
    expect(session.model).toBe(forestModel);
    expect(session.model.position.toArray()).toEqual([7, 75, 9]);
  });

  it("streams collisions with the bird and restores the spawn neighborhood on reset", async () => {
    const session = useSession();
    await session.chooseScene("city");
    const world = session.world;
    const solids = world.solids;
    const spawn = [...world.spawn.position];
    const original = solids.map((solid) => solid.id);
    session.model.position.set(-120030, 80, 240090);
    session.frame();
    expect(world.solids).toBe(solids);
    expect(session.model.world.solids).toBe(solids);
    expect(solids.map((solid) => solid.id)).not.toEqual(original);
    expect(world.chunks?.size).toBe(25);
    const roof = solids.find((solid) => solid.id.endsWith(":hotel:roof"))!;
    const x = (roof.min[0] + roof.max[0]) / 2;
    const z = (roof.min[2] + roof.max[2]) / 2;
    expect(session.model.world.supportAt(x, z, roof.max[1] + 1)?.height).toBe(roof.max[1]);

    await session.chooseScene("forest");
    await session.chooseScene("city");
    expect(session.model.position.toArray()).toEqual([-120030, 80, 240090]);
    session.reset();
    expect(session.model.position.toArray()).toEqual(spawn);
    expect(session.world.solids.map((solid) => solid.id)).toEqual(original);
    expect(session.model.world.solids).toBe(solids);
  });

  it("ignores keyboard and controller start input while a modal dialog is open", async () => {
    const session = await connectedSession();
    session.chooseMode("keyboard");
    session.model.position.set(21, 80, 6);
    vi.mocked(documentStub.querySelector).mockReturnValue({} as Element);

    key("keydown", "Space");
    key("keydown", "KeyF");
    key("keydown", "KeyR");
    expect(session.running).toBe(false);
    expect(session.keyboard).toEqual(NEUTRAL_PLAYER_INPUT);
    expect(session.model.position.toArray()).toEqual([21, 80, 6]);

    session.chooseMode("controller");
    session.queueStart();
    hardware.input({
      ...restingControls,
      left: 0,
      right: 0,
      options: true,
      transport: "usb",
      motion: null,
    });
    expect(session.running).toBe(false);
    expect(session.countdown).toBe(0);
  });

  it("keeps running and recording at the normal rate after landing, then resumes in place", async () => {
    const session = useSession();
    session.chooseMode("keyboard");
    session.model.position.set(100, GROUND.height + 0.01, 0);
    session.model.velocity.set(0, -3, 0);
    await session.start();
    for (let i = 0; i < 180; i++) {
      await vi.advanceTimersByTimeAsync(1000 / 60);
      session.frame();
    }
    expect(session.running).toBe(true);
    expect(session.telemetry.phase).toBe("walking");
    const rows = vi
      .mocked(fetch)
      .mock.calls.flatMap(([, init]) => JSON.parse(init!.body as string).rows);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.length).toBeLessThan(35);
    key("keydown", "KeyW");
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(1000 / 60);
      session.frame();
    }
    expect(session.model.velocity.z).toBeLessThan(-1);
    session.stop();
    const bird = session.model;
    const position = bird.position.clone();
    await session.start();
    expect(session.model).toBe(bird);
    expect(session.model.position.equals(position)).toBe(true);
    expect(session.model.grounded).toBe(true);
  });

  it("routes controller sticks and Triangle through walking, temporary look and a single hop", async () => {
    const session = await connectedSession();
    session.model.position.set(100, GROUND.height + 0.01, 0);
    session.model.velocity.set(0, -3, 0);
    session.camera.reset(session.model);
    await session.start();
    vi.advanceTimersByTime(20);
    session.frame();
    expect(session.model.grounded).toBe(true);
    session.stop();
    session.toggleFlight();
    expect(session.countdown).toBe(0);
    await Promise.resolve();
    expect(session.running).toBe(true);
    const send = (controls: Partial<InputSample>) =>
      hardware.input({
        ...restingControls,
        left: 0,
        right: 0,
        options: false,
        transport: "usb",
        motion: null,
        ...controls,
      });
    send({ rightStick: { x: 1, y: 0 } });
    vi.advanceTimersByTime(20);
    session.frame();
    send({ rightStick: { x: 1, y: 0 }, leftStick: { x: 0, y: -1 } });
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(1000 / 60);
      session.frame();
    }
    expect(session.camera.yaw).toBeLessThan(-0.3);
    expect(session.model.position.x).toBeGreaterThan(100);
    send({ triangle: true });
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(1000 / 60);
      session.frame();
    }
    expect(session.model.grounded).toBe(true);
    expect(session.model.jumpCharge).toBe(1);
    send({ triangle: false });
    vi.advanceTimersByTime(20);
    session.frame();
    expect(session.model.phase).toBe("hopping");
    expect(session.camera.yaw).toBeCloseTo(session.model.heading);
    for (let i = 0; i < 120; i++) {
      send({ triangle: true });
      vi.advanceTimersByTime(1000 / 60);
      session.frame();
    }
    expect(session.model.grounded).toBe(true);
    expect(session.running).toBe(true);
    expect(hardware.update).toHaveBeenLastCalledWith(0, 0);
  });

  it("keeps triggers and wing loads on their corresponding sides", async () => {
    const session = await connectedSession();
    await session.start();
    const squeeze = (left: number, right: number) => {
      hardware.input({
        ...restingControls,
        left,
        right,
        options: false,
        transport: "usb",
        motion: null,
      });
      vi.advanceTimersByTime(20);
      session.frame();
    };
    squeeze(0.8, 0);
    expect(session.model.wings[0].manual).toBe(true);
    expect(session.model.wings[1].manual).toBe(false);
    squeeze(0, 0.8);
    expect(session.model.wings[0].manual).toBe(false);
    expect(session.model.wings[1].manual).toBe(true);

    vi.spyOn(session.model, "step").mockImplementation(() => {
      session.model.wings[0].torque = -2.2;
      session.model.wings[1].torque = 0;
    });
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(1000 / 60);
      session.frame();
    }
    expect(hardware.update).toHaveBeenLastCalledWith(4, 0);
    expect(session.telemetry.leftStrength).toBe(4);
    expect(session.telemetry.rightStrength).toBe(0);
  });

  it("uses Options presses to start, pause and cancel without repeating held input", async () => {
    const session = await connectedSession();
    let timestamp = 7_000_000;
    const options = (down: boolean) =>
      hardware.input({
        ...restingControls,
        left: 0,
        right: 0,
        options: down,
        transport: "usb",
        motion: {
          gyro: new Vector3(),
          acceleration: new Vector3(0, 1, 0),
          timestamp: (timestamp += 50000),
        },
      });
    options(true);
    expect(session.countdown).toBe(3);
    for (let i = 0; i < 5; i++) options(true);
    await vi.advanceTimersByTimeAsync(3050);
    expect(session.running).toBe(true);
    options(true);
    expect(session.running).toBe(true);
    options(false);
    options(true);
    expect(session.running).toBe(false);
    expect(hardware.off).toHaveBeenCalled();
    options(false);
    options(true);
    expect(session.countdown).toBe(3);
    options(false);
    options(true);
    expect(session.countdown).toBe(0);
    await vi.advanceTimersByTimeAsync(3050);
    expect(session.running).toBe(false);
  });

  it("keeps Options within the active, visible controller session and calibration flow", async () => {
    const session = await connectedSession();
    const options = (down: boolean) =>
      hardware.input({
        ...restingControls,
        left: 0,
        right: 0,
        options: down,
        transport: "usb",
        motion: null,
      });
    documentStub.hidden = true;
    options(true);
    documentStub.hidden = false;
    options(true);
    expect(session.countdown).toBe(0);
    options(false);
    session.chooseMode("keyboard");
    options(true);
    expect(session.running).toBe(false);
    session.chooseMode("controller");
    options(true);
    expect(session.countdown).toBe(0);
    options(false);
    session.resetNeutral();
    session.stop();
    options(true);
    expect(session.calibrating).toBe(true);
    options(true);
    expect(session.calibrating).toBe(true);
    expect(session.running).toBe(false);
    options(false);
    options(true);
    expect(session.calibrating).toBe(false);
  });

  it("measures only when Start is selected and reuses the saved table pose after reload", async () => {
    const session = useSession();
    await session.connect();
    for (let i = 0; i <= 130; i++)
      hardware.input({
        ...restingControls,
        left: 0,
        right: 0,
        options: false,
        transport: "usb",
        motion: { gyro: new Vector3(), acceleration: new Vector3(0, 1, 0), timestamp: i * 50000 },
      });
    vi.advanceTimersByTime(120);
    expect(session.calibrating).toBe(false);
    expect(session.calibrated).toBe(false);
    expect(session.canStart).toBe(true);
    session.chooseMode("keyboard");
    session.chooseMode("controller");
    expect(session.calibrating).toBe(false);
    session.queueStart();
    expect(session.calibrating).toBe(true);
    expect(session.message).toContain("level table");
    expect(session.ready).toBe(false);
    await session.start();
    expect(hardware.arm).not.toHaveBeenCalled();
    const tableAngle = 0.2;
    for (let i = 131; i <= 261; i++)
      hardware.input({
        ...restingControls,
        left: 0,
        right: 0,
        options: false,
        transport: "usb",
        motion: {
          gyro: new Vector3(),
          acceleration: new Vector3(0, Math.cos(tableAngle), -Math.sin(tableAngle)),
          timestamp: i * 50000,
        },
      });
    vi.advanceTimersByTime(120);
    expect(session.ready).toBe(true);
    expect(session.calibrated).toBe(true);
    expect(session.calibrating).toBe(false);
    expect(session.telemetry.tablePitch).toBeCloseTo((tableAngle * 180) / Math.PI);
    expect(session.running).toBe(false); // Pick it up and start normally after capture.
    disposePinia(pinia);
    pinia = createPinia();
    setActivePinia(pinia);
    const restored = useSession();
    await restored.connect();
    expect(restored.calibrated).toBe(true);
    expect(restored.calibrating).toBe(false);
    hardware.input({
      ...restingControls,
      left: 0,
      right: 0,
      options: false,
      transport: "usb",
      motion: {
        gyro: new Vector3(),
        acceleration: new Vector3(0, Math.cos(tableAngle + 0.3), -Math.sin(tableAngle + 0.3)),
        timestamp: 0,
      },
    });
    vi.advanceTimersByTime(120);
    await restored.start();
    expect(restored.running).toBe(true);
    expect(restored.telemetry.pitch).toBeCloseTo((0.3 * 180) / Math.PI); // Starting does not recenter the held pose.
  });

  it("resets the saved neutral, allows cancellation, and captures a replacement at Start", async () => {
    const session = await connectedSession();
    const key = "bird-table-reference-v1:1356-3302";
    expect(localStorage.getItem(key)).not.toBeNull();
    session.resetNeutral();
    expect(localStorage.getItem(key)).toBeNull();
    expect(session.calibrating).toBe(true);
    expect(session.calibrated).toBe(false);
    const sample = (i: number) =>
      hardware.input({
        ...restingControls,
        left: 0,
        right: 0,
        options: false,
        transport: "usb",
        motion: {
          gyro: new Vector3(),
          acceleration: new Vector3(0, Math.cos(0.1), -Math.sin(0.1)),
          timestamp: i * 50000,
        },
      });
    sample(131);
    expect(session.calibrated).toBe(false);
    session.stop();
    for (let i = 132; i <= 262; i++) sample(i);
    vi.advanceTimersByTime(120);
    expect(session.calibrating).toBe(false);
    expect(session.calibrated).toBe(false);
    session.queueStart();
    for (let i = 263; i <= 393; i++) sample(i);
    vi.advanceTimersByTime(120);
    expect(session.calibrated).toBe(true);
    expect(session.telemetry.tablePitch).toBeCloseTo((0.1 * 180) / Math.PI);
    expect(JSON.parse(localStorage.getItem(key)!).up[2]).toBeCloseTo(-Math.sin(0.1));
    expect(session.running).toBe(false);
    expect(hardware.arm).not.toHaveBeenCalled();
  });

  it("remembers steering settings across reconnects and reloads", async () => {
    const session = await connectedSession();
    session.settings.comfort = 0.25;
    session.settings.invertRoll = true;
    await session.disconnect();
    await session.connect();
    disposePinia(pinia);
    pinia = createPinia();
    setActivePinia(pinia);
    const restored = useSession();
    expect(restored.settings).toMatchObject({ comfort: 0.25, invertRoll: true });
  });

  it("waits for both hands before starting and cancels a countdown on page hide", async () => {
    const session = await connectedSession();
    session.queueStart();
    await vi.advanceTimersByTimeAsync(2990);
    expect(session.running).toBe(false);
    expect(hardware.arm).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(40);
    expect(session.running).toBe(true);
    session.stop();
    session.queueStart();
    hardware.arm.mockClear();
    documentStub.hidden = true;
    documentStub.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(4000);
    expect(session.countdown).toBe(0);
    expect(session.running).toBe(false);
    expect(hardware.arm).not.toHaveBeenCalled();
  });

  it("pauses and requests effects off when motion reports become stale", async () => {
    const session = await connectedSession();
    await session.start();
    expect(session.running).toBe(true);
    hardware.motionAge = 300;
    vi.advanceTimersByTime(300);
    expect(session.running).toBe(false);
    expect(hardware.off).toHaveBeenCalled();
    expect(session.message).toContain("motion input stopped");
  });

  it("pauses on page hiding and never resumes merely because the page returns", async () => {
    const session = await connectedSession();
    await session.start();
    documentStub.hidden = true;
    documentStub.dispatchEvent(new Event("visibilitychange"));
    expect(session.running).toBe(false);
    expect(hardware.off).toHaveBeenCalled();
    documentStub.hidden = false;
    documentStub.dispatchEvent(new Event("visibilitychange"));
    expect(session.running).toBe(false);
  });

  it("invalidates a pending start when the player pauses", async () => {
    const session = await connectedSession();
    let release = () => {};
    hardware.arm.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const starting = session.start();
    session.stop();
    release();
    await starting;
    expect(session.running).toBe(false);
    expect(session.starting).toBe(false);
  });

  it("clears output and pauses on disconnect", async () => {
    const session = await connectedSession();
    await session.start();
    hardware.off.mockClear();
    await session.disconnect();
    expect(hardware.off).toHaveBeenCalled();
    expect(session.connected).toBe(false);
    expect(session.running).toBe(false);
  });

  it("runs the same manual controls without hardware and pauses on a suspended frame", async () => {
    const session = useSession();
    session.chooseMode("keyboard");
    await session.start();
    session.keyboard.left = 0.8;
    vi.advanceTimersByTime(1000 / 60);
    session.frame();
    expect(session.model.wings[0].angle).toBeGreaterThan(0);
    expect(session.model.wings[0].manual).toBe(true);
    expect(session.model.wings[1].manual).toBe(false);
    expect(Math.abs(session.model.wings[1].angle)).toBeLessThan(0.01);
    vi.advanceTimersByTime(1000);
    session.frame();
    expect(session.running).toBe(false);
    expect(hardware.update).not.toHaveBeenCalled();
  });
});
