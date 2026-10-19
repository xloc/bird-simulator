import { describe, expect, it, vi } from "vite-plus/test";
import { EffectWriter, TorqueFeedback } from "./feedback";
import { FlightModel, NEUTRAL_INPUT } from "../flight/model";

describe("torque feedback", () => {
  it("renders only squeeze-opposing loads, obeys comfort limits and resets immediately", () => {
    const f = new TorqueFeedback();
    for (let i = 0; i < 100; i++) f.update(3, 0.5, 1 / 120);
    expect(f.level).toBe(0);
    for (let i = 0; i < 100; i++) f.update(-100, 0.5, 1 / 120);
    expect(f.level).toBe(4);
    expect(f.update(-100, 0, 1 / 120)).toBe(0);
    f.reset();
    expect(f.filtered).toBe(0);
  });

  it("does not alter the flight model when comfort changes", () => {
    const a = new FlightModel();
    const b = new FlightModel();
    const low = new TorqueFeedback();
    const high = new TorqueFeedback();
    for (let i = 0; i < 120; i++) {
      a.step(NEUTRAL_INPUT, 1 / 120);
      b.step(NEUTRAL_INPUT, 1 / 120);
      low.update(a.wings[0].torque, 0.25, 1 / 120);
      high.update(b.wings[0].torque, 1, 1 / 120);
    }
    expect(a.position.toArray()).toEqual(b.position.toArray());
    expect(low.level).toBeLessThan(high.level);
  });
});

describe("serialized trigger output", () => {
  it("keeps only the newest pending effect and makes off supersede queued loads", async () => {
    const sent: [number, number][] = [];
    let release = () => {};
    let block = false;
    const writer = new EffectWriter(
      async (left, right) => {
        sent.push([left, right]);
        if (block)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
      },
      (error) => {
        throw error;
      },
    );
    await writer.arm();
    block = true;
    writer.update(1, 2);
    writer.update(3, 4);
    writer.update(5, 6);
    expect(sent).toEqual([
      [0, 0],
      [1, 2],
    ]);
    const stopped = writer.off();
    writer.update(8, 8);
    block = false;
    release();
    await stopped;
    expect(sent).toEqual([
      [0, 0],
      [1, 2],
      [0, 0],
    ]);
  });

  it("sends the latest load when writes catch up", async () => {
    const sent: number[] = [];
    let release = () => {};
    let block = false;
    const writer = new EffectWriter(
      async (left) => {
        sent.push(left);
        if (block)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
      },
      (error) => {
        throw error;
      },
    );
    await writer.arm();
    block = true;
    writer.update(1, 0);
    writer.update(2, 0);
    writer.update(3, 0);
    block = false;
    release();
    await vi.waitFor(() => expect(sent).toEqual([0, 1, 3]));
  });

  it("does not arm after a concurrent pause", async () => {
    let release = () => {};
    const send = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const writer = new EffectWriter(send, (error) => {
      throw error;
    });
    const armed = writer.arm();
    const stopped = writer.off();
    release();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    release();
    await Promise.all([armed, stopped]);
    writer.update(8, 8);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("disarms on a write error and attempts one effects-off packet", async () => {
    const error = vi.fn();
    const send = vi.fn(async (left: number) => {
      if (left) throw new Error("unplugged");
    });
    const writer = new EffectWriter(send, error);
    await writer.arm();
    writer.update(2, 2);
    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
    writer.update(3, 3);
    expect(send.mock.calls.map((call) => call[0])).toEqual([0, 2, 0]);
  });
});
