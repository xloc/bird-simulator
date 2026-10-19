import { EffectWriter } from "./feedback";
import { defaultCalibration, outputReport, parseInput, readCalibration } from "./protocol";
import type { InputSample, Transport } from "./protocol";

export class DualSense {
  device: HIDDevice | null = null;
  transport: Transport = "usb";
  calibration = defaultCalibration();
  factoryCalibrated = false;
  writer: EffectWriter | null = null;
  lastInputAt = 0;
  lastMotionAt = 0;
  private lastMotionTimestamp: number | null = null;
  received = 0;
  rejected = 0;
  sent = 0;
  writeMilliseconds = 0;
  sequence = 0;

  private onInput: (sample: InputSample) => void;
  private onError: (message: string) => void;

  constructor(onInput: (sample: InputSample) => void, onError: (message: string) => void) {
    this.onInput = onInput;
    this.onError = onError;
  }

  private input = (event: HIDInputReportEvent) => {
    const sample = parseInput(event.reportId, event.data, this.calibration);
    if (!sample) {
      this.rejected++;
      return;
    }
    this.lastInputAt = performance.now();
    this.received++;
    this.transport = sample.transport;
    if (sample.motion && sample.motion.timestamp !== this.lastMotionTimestamp) {
      this.lastMotionAt = this.lastInputAt;
      this.lastMotionTimestamp = sample.motion.timestamp;
    }
    this.onInput(sample);
  };

  private disconnected = (event: HIDConnectionEvent) => {
    if (event.device !== this.device) return;
    // The device is gone, so effects-off cannot be delivered.
    this.device.removeEventListener("inputreport", this.input);
    navigator.hid.removeEventListener("disconnect", this.disconnected);
    this.device = null;
    this.writer = null;
    this.onError("Controller disconnected. Reconnect to continue.");
  };

  async connect() {
    if (!("hid" in navigator))
      throw new Error("WebHID is unavailable. Open localhost in desktop Chrome or Edge.");
    const devices = await navigator.hid.requestDevice({
      filters: [
        { vendorId: 0x054c, productId: 0x0ce6, usagePage: 1, usage: 5 },
        { vendorId: 0x054c, productId: 0x0df2, usagePage: 1, usage: 5 },
      ],
    });
    const device = devices[0];
    if (!device) return false;
    await device.open();
    this.device = device;
    const reports = (collections: HIDCollectionInfo[]): (number | undefined)[] =>
      collections.flatMap((c) => [
        ...(c.outputReports ?? []).map((r) => r.reportId),
        ...reports(c.children ?? []),
      ]);
    this.transport = reports(device.collections).includes(0x31) ? "bluetooth" : "usb";
    device.addEventListener("inputreport", this.input);
    navigator.hid.addEventListener("disconnect", this.disconnected);
    this.writer = new EffectWriter(
      async (left, right) => {
        const packet = outputReport(this.transport, left, right, this.sequence++);
        const start = performance.now();
        await device.sendReport(packet.reportId, packet.bytes);
        this.writeMilliseconds = performance.now() - start;
        this.sent++;
      },
      (error) =>
        this.onError(
          `Trigger write failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
    );
    // Reading calibration also requests extended Bluetooth motion reports.
    try {
      const feature = await device.receiveFeatureReport(0x05);
      const calibration = readCalibration(feature, this.transport);
      if (calibration) {
        this.calibration = calibration;
        this.factoryCalibrated = true;
      }
    } catch {
      /* Nominal scaling is visible in the connection panel. */
    }
    await this.writer.off();
    return true;
  }

  async disconnect() {
    const device = this.device;
    if (!device) return;
    await this.writer?.off();
    device.removeEventListener("inputreport", this.input);
    navigator.hid.removeEventListener("disconnect", this.disconnected);
    try {
      if (device.opened) await device.close();
    } finally {
      this.device = null;
      this.writer = null;
    }
  }
}
