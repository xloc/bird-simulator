import { Vector3 } from "three";
import { clamp, DEG } from "../flight/aerodynamics";

export type Transport = "usb" | "bluetooth";
export interface InputSample {
  left: number;
  right: number;
  options: boolean;
  transport: Transport;
  motion: { gyro: Vector3; acceleration: Vector3; timestamp: number } | null;
}
export interface SensorCalibration {
  gyroScale: Vector3;
  accelerationScale: Vector3;
  accelerationBias: Vector3;
}
export const defaultCalibration = (): SensorCalibration => ({
  gyroScale: new Vector3(1, 1, 1).multiplyScalar(DEG / 16),
  accelerationScale: new Vector3(1, 1, 1).multiplyScalar(1 / 8192),
  accelerationBias: new Vector3(),
});

export function crc32(bytes: Iterable<number>) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Feature reports include their ID; input/output payloads do not. */
export function readCalibration(data: DataView, transport: Transport): SensorCalibration | null {
  if (data.byteLength !== 41 || data.getUint8(0) !== 5) return null;
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (
    transport === "bluetooth" &&
    crc32([0xa3, ...bytes.subarray(0, 37)]) !== data.getUint32(37, true)
  )
    return null;
  const result = defaultCalibration();
  const speed = data.getInt16(19, true) + data.getInt16(21, true);
  for (let axis = 0; axis < 3; axis++) {
    const bias = data.getInt16(1 + 2 * axis, true);
    const plus = data.getInt16(7 + 4 * axis, true);
    const minus = data.getInt16(9 + 4 * axis, true);
    const denominator = Math.abs(plus - bias) + Math.abs(minus - bias);
    const accelPlus = data.getInt16(23 + 4 * axis, true);
    const accelMinus = data.getInt16(25 + 4 * axis, true);
    if (speed <= 0 || denominator === 0 || accelPlus <= accelMinus) return null;
    result.gyroScale.setComponent(axis, (speed / denominator) * DEG);
    result.accelerationScale.setComponent(axis, 2 / (accelPlus - accelMinus));
    result.accelerationBias.setComponent(axis, (accelPlus + accelMinus) / 2);
  }
  return result;
}

export function parseInput(
  reportId: number,
  data: DataView,
  calibration = defaultCalibration(),
): InputSample | null {
  if (reportId === 1 && data.byteLength === 9) {
    return {
      left: data.getUint8(7) / 255,
      right: data.getUint8(8) / 255,
      options: (data.getUint8(5) & 0x20) !== 0,
      transport: "bluetooth",
      motion: null,
    };
  }
  const bluetooth = reportId === 0x31 && data.byteLength === 77;
  if (!bluetooth && !(reportId === 1 && data.byteLength === 63)) return null;
  if (bluetooth) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, 73);
    if (crc32([0xa1, reportId, ...bytes]) !== data.getUint32(73, true)) return null;
  }
  const offset = bluetooth ? 1 : 0;
  const vector = (start: number) =>
    new Vector3(
      data.getInt16(offset + start, true),
      data.getInt16(offset + start + 2, true),
      data.getInt16(offset + start + 4, true),
    );
  return {
    left: data.getUint8(offset + 4) / 255,
    right: data.getUint8(offset + 5) / 255,
    options: (data.getUint8(offset + 8) & 0x20) !== 0,
    transport: bluetooth ? "bluetooth" : "usb",
    motion: {
      gyro: vector(15).multiply(calibration.gyroScale),
      acceleration: vector(21)
        .sub(calibration.accelerationBias)
        .multiply(calibration.accelerationScale),
      timestamp: data.getUint32(offset + 27, true),
    },
  };
}

/** Uniform resistance over ten travel zones; level 0 explicitly resets the arm. */
export function triggerEffect(level: number, startZone = 1) {
  const bytes = new Uint8Array(11);
  const strength = clamp(Math.round(level), 0, 8);
  bytes[0] = strength ? 0x21 : 0x05;
  if (!strength) return bytes;
  let zones = 0;
  let forces = 0;
  for (let zone = clamp(Math.round(startZone), 0, 9); zone < 10; zone++) {
    zones |= 1 << zone;
    forces |= (strength - 1) << (3 * zone);
  }
  const data = new DataView(bytes.buffer);
  data.setUint16(1, zones, true);
  data.setUint32(3, forces >>> 0, true);
  return bytes;
}

export function outputReport(transport: Transport, left: number, right: number, sequence = 0) {
  const bluetooth = transport === "bluetooth";
  const reportId = bluetooth ? 0x31 : 0x02;
  const bytes = new Uint8Array(bluetooth ? 77 : 47);
  const base = bluetooth ? 2 : 0;
  if (bluetooth) {
    bytes[0] = (sequence & 15) << 4;
    bytes[1] = 0x10;
  }
  bytes[base] = 0x0c; // Enable only right and left adaptive-trigger effects.
  bytes.set(triggerEffect(right), base + 10);
  bytes.set(triggerEffect(left), base + 21);
  if (bluetooth)
    new DataView(bytes.buffer).setUint32(
      73,
      crc32([0xa2, reportId, ...bytes.subarray(0, 73)]),
      true,
    );
  return { reportId, bytes };
}
