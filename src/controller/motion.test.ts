import { describe, expect, it } from "vite-plus/test";
import { Euler, Quaternion, Vector3 } from "three";
import { DEG } from "../flight/aerodynamics";
import { MotionFilter } from "./motion";

describe("saved tabletop neutral", () => {
  it.each([60, 250])(
    "captures a nonzero table angle at %i Hz and preserves it while holding another pose",
    (hz) => {
      const filter = new MotionFilter();
      const tableAngle = 12 * DEG;
      const acceleration = new Vector3(0, Math.cos(tableAngle), -Math.sin(tableAngle));
      const bias = new Vector3(0.4 * DEG, 0.1 * DEG, 0);
      filter.beginCalibration();
      for (let i = 0; i <= hz * 2.1; i++)
        filter.update(bias, acceleration, Math.round((i * 3_000_000) / hz));
      expect(filter.calibrated).toBe(true);
      expect(filter.tableAngles!.pitch / DEG).toBeCloseTo(12, 5);
      expect(filter.bias.distanceTo(bias)).toBeLessThan(1e-10);
      expect(filter.commands().pitch).toBeCloseTo(0, 8);

      const restored = new MotionFilter();
      restored.restore(filter.reference!);
      const held = new Vector3(
        0,
        Math.cos(tableAngle + 20 * DEG),
        -Math.sin(tableAngle + 20 * DEG),
      );
      for (let i = 0; i <= hz * 3; i++)
        restored.update(bias, held, Math.round((i * 3_000_000) / hz));
      expect(restored.commands().pitch / DEG).toBeCloseTo(20, 5);
      expect(restored.reference).toEqual(filter.reference);
      expect(restored.calibrating).toBe(false);
    },
  );

  it("restarts the capture when the controller moves or samples stop", () => {
    const filter = new MotionFilter();
    filter.beginCalibration();
    for (let i = 0; i <= 60; i++) filter.update(new Vector3(), new Vector3(0, 1, 0), i * 50000);
    expect(filter.calibrationSeconds).toBeCloseTo(1);
    filter.update(new Vector3(5 * DEG, 0, 0), new Vector3(0, 1, 0), 61 * 50000);
    expect(filter.calibrationSeconds).toBe(0);
    for (let i = 62; i <= 122; i++) filter.update(new Vector3(), new Vector3(0, 1, 0), i * 50000);
    filter.update(new Vector3(), new Vector3(0.05, 1, 0), 123 * 50000);
    expect(filter.calibrationSeconds).toBe(0);
    filter.update(new Vector3(), new Vector3(0, 1, 0), 124 * 50000);
    expect(filter.calibrationSeconds).toBeGreaterThan(0);
    filter.update(new Vector3(), new Vector3(0, 1, 0), 140 * 50000);
    expect(filter.calibrationSeconds).toBe(0);
    expect(filter.calibrated).toBe(false);
  });

  it.each([60, 250])(
    "tolerates brief sensor noise but rejects sustained movement at %i Hz",
    (hz) => {
      const quiet = new MotionFilter();
      const moving = new MotionFilter();
      quiet.beginCalibration();
      moving.beginCalibration();
      for (let i = 0; i <= hz * 2.1; i++) {
        const timestamp = Math.round((i * 3_000_000) / hz);
        const spike = i % Math.round(hz / 5) === 0;
        quiet.update(
          new Vector3((spike ? 1.5 : 0.4) * DEG, 0.1 * DEG, 0),
          new Vector3(spike ? 0.02 : 0, 1, 0),
          timestamp,
        );
        moving.update(new Vector3(1.5 * DEG, 0, 0), new Vector3(0, 1, 0), timestamp);
      }
      expect(quiet.calibrated).toBe(true);
      expect(moving.calibrated).toBe(false);
    },
  );

  it("keeps pitch/bank signs and ignores world yaw", () => {
    const filter = new MotionFilter();
    filter.orientation.setFromEuler(new Euler(15 * DEG, 0, -20 * DEG, "YXZ"));
    const commands = filter.commands();
    expect(commands.pitch).toBeGreaterThan(0);
    expect(commands.roll).toBeGreaterThan(0);
    filter.orientation.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 2.5));
    expect(filter.commands().pitch).toBeCloseTo(commands.pitch, 12);
    expect(filter.commands().roll).toBeCloseTo(commands.roll, 12);
  });

  it("handles the 32-bit sensor timestamp wrap", () => {
    const filter = new MotionFilter();
    filter.update(new Vector3(), new Vector3(0, 1, 0), 0xfffffff0);
    filter.update(new Vector3(1, 0, 0), new Vector3(0, 1, 0), 11984);
    expect(filter.angles().pitch).toBeCloseTo(0.004, 6);
  });
});
