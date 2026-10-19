import { describe, expect, it } from "vite-plus/test";
import { crc32 as referenceCrc } from "node:zlib";
import { crc32, outputReport, parseInput, readCalibration, triggerEffect } from "./protocol";
import { stick } from "./input";

describe("DualSense packet layouts", () => {
  it.each([
    { name: "USB", reportId: 1, length: 63, offset: 0, buttons: 7 },
    { name: "full Bluetooth", reportId: 0x31, length: 77, offset: 1, buttons: 8 },
    { name: "minimal Bluetooth", reportId: 1, length: 9, offset: 0, buttons: 4 },
  ])("reads both sticks and Triangle in $name reports", ({ reportId, length, offset, buttons }) => {
    const bytes = new Uint8Array(length);
    const data = new DataView(bytes.buffer);
    const read = () => {
      if (reportId === 0x31)
        data.setUint32(
          73,
          referenceCrc(Uint8Array.from([0xa1, reportId, ...bytes.subarray(0, 73)])),
          true,
        );
      return parseInput(reportId, data)!;
    };
    bytes.fill(128, offset, offset + 4);
    bytes[buttons] = 0x7f;
    expect(read().triangle).toBe(false);
    expect(stick(read().leftStick.x, read().leftStick.y)).toEqual({ x: 0, y: 0 });
    bytes.set([0, 255, 255, 0], offset);
    bytes[buttons] = 0x80;
    const sample = read();
    expect(sample.triangle).toBe(true);
    expect(sample.options).toBe(false);
    expect(sample.leftStick).toEqual({ x: -1, y: 1 });
    expect(sample.rightStick).toEqual({ x: 1, y: -1 });
    const diagonal = stick(sample.rightStick.x, sample.rightStick.y);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1);
  });

  it.each([
    { name: "USB", reportId: 1, length: 63, offset: 8 },
    { name: "full Bluetooth", reportId: 0x31, length: 77, offset: 9 },
    { name: "minimal Bluetooth", reportId: 1, length: 9, offset: 5 },
  ])(
    "reads Options separately from adjacent buttons in $name reports",
    ({ reportId, length, offset }) => {
      const bytes = new Uint8Array(length);
      const data = new DataView(bytes.buffer);
      const sample = (buttons: number) => {
        bytes[offset] = buttons;
        if (reportId === 0x31)
          data.setUint32(
            73,
            referenceCrc(Uint8Array.from([0xa1, reportId, ...bytes.subarray(0, 73)])),
            true,
          );
        return parseInput(reportId, data)!;
      };
      expect(sample(0xdf).options).toBe(false);
      expect(sample(0x20).options).toBe(true);
      expect(sample(0).options).toBe(false);
    },
  );

  it("reads USB and full Bluetooth payloads at different offsets with signed IMU values", () => {
    const usb = new Uint8Array(63);
    const u = new DataView(usb.buffer);
    usb[4] = 51;
    usb[5] = 204;
    u.setInt16(15, -160, true);
    u.setInt16(17, 320, true);
    u.setInt16(19, -480, true);
    u.setInt16(23, 8192, true);
    u.setUint32(27, 0xfffffff0, true);
    const bt = new Uint8Array(77);
    bt[0] = 17;
    bt.set(usb, 1);
    new DataView(bt.buffer).setUint32(
      73,
      referenceCrc(Uint8Array.from([0xa1, 0x31, ...bt.subarray(0, 73)])),
      true,
    );
    const a = parseInput(1, u)!;
    const b = parseInput(0x31, new DataView(bt.buffer))!;
    expect(a.left).toBe(0.2);
    expect(a.right).toBe(0.8);
    expect(a.motion!.gyro.x).toBeCloseTo(-Math.PI / 18);
    expect(a.motion!.acceleration.y).toBe(1);
    expect(a.motion!.timestamp).toBe(0xfffffff0);
    expect(b.motion).toEqual(a.motion);
    expect(b.transport).toBe("bluetooth");
    bt[4] = 99;
    expect(parseInput(0x31, new DataView(bt.buffer))).toBeNull();
  });

  it("treats minimal Bluetooth packets as trigger-only and rejects unknown/truncated reports", () => {
    const bytes = new Uint8Array(9);
    bytes[4] = 255;
    bytes[7] = 64;
    bytes[8] = 128;
    const sample = parseInput(1, new DataView(bytes.buffer))!;
    expect(sample.left).toBe(64 / 255);
    expect(sample.right).toBe(128 / 255);
    expect(sample.motion).toBeNull();
    for (const length of [0, 8, 10, 62, 64, 76]) {
      expect(parseInput(1, new DataView(new ArrayBuffer(length)))).toBeNull();
    }
    expect(parseInput(2, new DataView(new ArrayBuffer(63)))).toBeNull();
  });

  it("parses interleaved factory calibration pairs and validates feature-report framing", () => {
    const bytes = new Uint8Array(41);
    const data = new DataView(bytes.buffer);
    bytes[0] = 5;
    data.setInt16(19, 500, true);
    data.setInt16(21, 500, true);
    for (let axis = 0; axis < 3; axis++) {
      data.setInt16(1 + axis * 2, 10, true);
      data.setInt16(7 + axis * 4, 8010 + axis * 1000, true);
      data.setInt16(9 + axis * 4, -7990 - axis * 1000, true);
      data.setInt16(23 + axis * 4, 8202, true);
      data.setInt16(25 + axis * 4, -8182, true);
    }
    data.setUint32(37, referenceCrc(Uint8Array.from([0xa3, ...bytes.subarray(0, 37)])), true);
    const result = readCalibration(data, "bluetooth")!;
    expect(result.gyroScale.x).toBeCloseTo(((1000 / 16000) * Math.PI) / 180);
    expect(result.gyroScale.y).toBeCloseTo(((1000 / 18000) * Math.PI) / 180);
    expect(result.gyroScale.z).toBeCloseTo(((1000 / 20000) * Math.PI) / 180);
    expect(result.accelerationBias.toArray()).toEqual([10, 10, 10]);
    expect(result.accelerationScale.y).toBe(1 / 8192);
    bytes[30] ^= 1;
    expect(readCalibration(data, "bluetooth")).toBeNull();
    expect(readCalibration(new DataView(new ArrayBuffer(40)), "usb")).toBeNull();
  });

  it("encodes only trigger flags, independently ordered channels, zone strength and off", () => {
    expect([...triggerEffect(0)]).toEqual([5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...triggerEffect(1, 0)]).toEqual([0x21, 255, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...triggerEffect(8, 0)]).toEqual([0x21, 255, 3, 255, 255, 255, 63, 0, 0, 0, 0]);
    const packet = outputReport("usb", 2, 4);
    expect(packet.reportId).toBe(2);
    expect(packet.bytes.length).toBe(47);
    expect(packet.bytes[0]).toBe(12);
    expect(packet.bytes.slice(10, 21)).toEqual(triggerEffect(4));
    expect(packet.bytes.slice(21, 32)).toEqual(triggerEffect(2));
    expect(packet.bytes.slice(32).every((value) => value === 0)).toBe(true);
    expect(packet.bytes.slice(1, 10).every((value) => value === 0)).toBe(true);
  });

  it("matches an independent CRC implementation with Bluetooth prefix, report ID and sequence", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    for (const sequence of [0, 1, 15, 16]) {
      const p = outputReport("bluetooth", 2, 4, sequence);
      expect(p.reportId).toBe(0x31);
      expect(p.bytes.length).toBe(77);
      expect(p.bytes[0]).toBe((sequence % 16) * 16);
      expect(p.bytes[1]).toBe(0x10);
      expect(p.bytes[2]).toBe(0x0c);
      expect(p.bytes.slice(12, 23)).toEqual(triggerEffect(4));
      expect(p.bytes.slice(23, 34)).toEqual(triggerEffect(2));
      const expected = referenceCrc(Uint8Array.from([0xa2, 0x31, ...p.bytes.subarray(0, 73)]));
      expect(new DataView(p.bytes.buffer).getUint32(73, true)).toBe(expected);
    }
  });
});
