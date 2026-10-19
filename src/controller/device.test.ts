import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DualSense } from "./device";
import type { InputSample } from "./protocol";

function hardware(bluetooth = false) {
  const device = Object.assign(new EventTarget(), {
    productName: "Test DualSense",
    opened: true,
    collections: [{ outputReports: [{ reportId: bluetooth ? 0x31 : 2 }] }],
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    receiveFeatureReport: vi.fn(async () => new DataView(new ArrayBuffer(41))),
    sendReport: vi.fn(async (_id: number, _data: Uint8Array) => {}),
  });
  const hid = Object.assign(new EventTarget(), { requestDevice: vi.fn(async () => [device]) });
  vi.stubGlobal("navigator", { hid });
  return { device, hid };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("WebHID adapter", () => {
  it("requests motion reports, receives actual report events, and resets before closing", async () => {
    const { device } = hardware();
    const samples: InputSample[] = [];
    const errors = vi.fn();
    const adapter = new DualSense((sample) => samples.push(sample), errors);
    expect(await adapter.connect()).toBe(true);
    expect(device.receiveFeatureReport).toHaveBeenCalledWith(5);
    const bytes = new Uint8Array(63);
    bytes[4] = 100;
    bytes[5] = 200;
    new DataView(bytes.buffer).setUint32(27, 12000, true);
    device.dispatchEvent(
      Object.assign(new Event("inputreport"), { reportId: 1, data: new DataView(bytes.buffer) }),
    );
    expect(samples[0]!.left).toBe(100 / 255);
    expect(samples[0]!.right).toBe(200 / 255);
    await adapter.writer!.arm();
    adapter.writer!.update(2, 3);
    await adapter.disconnect();
    const [id, bytesOut] = device.sendReport.mock.calls.at(-1)!;
    expect(id).toBe(2);
    expect(bytesOut[10]).toBe(5);
    expect(bytesOut[21]).toBe(5);
    expect(device.close).toHaveBeenCalledOnce();
    expect(errors).not.toHaveBeenCalled();
  });

  it("detects Bluetooth output framing from the descriptor before full input arrives", async () => {
    const { device, hid } = hardware(true);
    const errors = vi.fn();
    const adapter = new DualSense(() => {}, errors);
    await adapter.connect();
    expect(adapter.transport).toBe("bluetooth");
    expect(device.sendReport.mock.calls[0]![0]).toBe(0x31);
    expect(device.sendReport.mock.calls[0]![1].length).toBe(77);
    hid.dispatchEvent(Object.assign(new Event("disconnect"), { device }));
    expect(adapter.device).toBeNull();
    expect(adapter.writer).toBeNull();
    expect(errors).toHaveBeenCalledOnce();
  });

  it("does not count repeated sensor timestamps as fresh motion", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const { device } = hardware();
    const adapter = new DualSense(
      () => {},
      () => {},
    );
    await adapter.connect();
    const data = new DataView(new ArrayBuffer(63));
    data.setUint32(27, 12000, true);
    const report = () =>
      device.dispatchEvent(Object.assign(new Event("inputreport"), { reportId: 1, data }));
    report();
    const lastMotion = adapter.lastMotionAt;
    vi.advanceTimersByTime(300);
    report();
    expect(adapter.lastInputAt).toBeGreaterThan(lastMotion);
    expect(adapter.lastMotionAt).toBe(lastMotion);
    await adapter.disconnect();
  });
});
