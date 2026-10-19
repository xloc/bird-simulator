import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveFlightPacket } from "../../dev/flight-logs";
import { DEG } from "./aerodynamics";
import { FlightModel, NEUTRAL_INPUT } from "./model";
import { FlightRecorder, FLIGHT_LOG_COLUMNS, FLIGHT_LOG_PATH, FLIGHT_LOG_ROWS } from "./recorder";
import type { FlightLogPacket } from "./recorder";

let directory: string;
let packets: FlightLogPacket[];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "bird-flight-logs-"));
  packets = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(FLIGHT_LOG_PATH);
      expect(init.keepalive).toBe(true);
      expect(Buffer.byteLength(init.body as string)).toBeLessThan(64 * 1024);
      const packet = JSON.parse(init.body as string) as FlightLogPacket;
      packets.push(packet);
      await saveFlightPacket(directory, packet);
      return new Response(null, { status: 204 });
    }),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

it("automatically saves a bounded trace, early divergence summary and final crash state", async () => {
  const status = vi.fn();
  const recorder = new FlightRecorder({ mode: "test" }, 0, status);
  const flight = new FlightModel();
  for (let i = 0; i <= 130 * 120; i++) {
    flight.time = i / 120;
    if (i === 240)
      flight.orientation.setFromAxisAngle(flight.omega.clone().set(0, 0, 1), -25 * DEG);
    recorder.sample(flight, NEUTRAL_INPUT, 4);
    if (i % 240 === 0) await recorder.flush(true);
  }
  flight.time = 130.025; // Ground contact between regular 10 Hz samples.
  flight.position.y = 0.8;
  flight.phase = "walking";
  const before = flight.orientation.clone();
  recorder.sample(flight, NEUTRAL_INPUT, 4, true);
  expect(flight.orientation.equals(before)).toBe(true);
  recorder.finish("Ground reached.");
  await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith("Flight log saved locally."));
  const summary = JSON.parse(await readFile(join(directory, "latest.json"), "utf8"));
  const raw = await readFile(join(directory, summary.file), "utf8");
  const log = JSON.parse(raw);
  expect(Buffer.byteLength(raw)).toBeLessThan(512 * 1024);
  expect(log.rows).toHaveLength(FLIGHT_LOG_ROWS);
  expect(log.rows[0][0]).toBeGreaterThan(10);
  expect(log.overview[0][0]).toBe(0);
  expect(log.summary.samples).toBe(1302);
  expect(log.summary.firstBankDeparture).toMatchObject({ timeS: 2, targetDeg: 0, actualDeg: 25 });
  expect(log.reason).toBe("Ground reached.");
  expect(log.rows.at(-1)[0]).toBe(130.025);
  expect(log.rows.at(-1)[FLIGHT_LOG_COLUMNS.indexOf("grounded")]).toBe(1);
  expect(log.rows.every((row: number[]) => row.length === FLIGHT_LOG_COLUMNS.length)).toBe(true);
  expect(summary.detailSamples).toBe(FLIGHT_LOG_ROWS);
  expect(packets.length).toBeLessThan(70);

  // An acknowledged batch can be retried after a dropped response without duplicate samples.
  const final = packets.at(-1)!;
  await saveFlightPacket(directory, final);
  expect(JSON.parse(await readFile(join(directory, summary.file), "utf8")).rows).toHaveLength(
    FLIGHT_LOG_ROWS,
  );
  for (let i = 0; i < 6; i++)
    await saveFlightPacket(directory, { ...final, id: crypto.randomUUID() });
  expect((await readdir(directory)).filter((name) => name !== "latest.json")).toHaveLength(5);
});

it("flushes the crash after an earlier upload finishes", async () => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const upload = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementationOnce(async (...args) => {
    await pending;
    return upload(...args);
  });
  const status = vi.fn();
  const recorder = new FlightRecorder({}, 0, status);
  const flight = new FlightModel();
  recorder.sample(flight, NEUTRAL_INPUT, 0);
  const first = recorder.flush(true);
  flight.time = 0.025;
  flight.phase = "walking";
  recorder.sample(flight, NEUTRAL_INPUT, 0, true);
  recorder.finish("Ground reached.");
  release();
  await first;
  await vi.waitFor(() => expect(packets.at(-1)?.reason).toBe("Ground reached."));
  await vi.waitFor(async () => {
    const summary = JSON.parse(await readFile(join(directory, "latest.json"), "utf8"));
    expect(summary.reason).toBe("Ground reached.");
  });
  expect(packets.at(-1)!.rows.at(-1)!.at(-1)).toBe(1);
});
