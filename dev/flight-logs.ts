import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "vite-plus";
import {
  FLIGHT_LOG_COLUMNS,
  FLIGHT_LOG_PATH,
  FLIGHT_LOG_ROWS,
  FLIGHT_OVERVIEW_COLUMNS,
} from "../src/flight/recorder";
import type { FlightLogPacket } from "../src/flight/recorder";

interface SavedFlight extends FlightLogPacket {
  version: number;
  columns: typeof FLIGHT_LOG_COLUMNS;
  overviewColumns: typeof FLIGHT_OVERVIEW_COLUMNS;
  overview: number[][];
}
const overviewIndices = FLIGHT_OVERVIEW_COLUMNS.map((name) => FLIGHT_LOG_COLUMNS.indexOf(name));

export async function saveFlightPacket(directory: string, packet: FlightLogPacket) {
  await mkdir(directory, { recursive: true });
  const filename = `${packet.id}.json`;
  const path = join(directory, filename);
  let previous: SavedFlight | undefined;
  try {
    previous = JSON.parse(await readFile(path, "utf8")) as SavedFlight;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // Retries may repeat a batch whose response was lost. Simulation time is monotonic per run.
  const rows = packet.rows.filter((row) => row[0]! > (previous?.rows.at(-1)?.[0] ?? -1));
  const overview = previous?.overview ?? [];
  for (const row of rows) {
    if (Math.floor(row[0]!) > Math.floor(overview.at(-1)?.[0] ?? -1))
      overview.push(overviewIndices.map((i) => row[i]!));
  }
  const saved: SavedFlight = {
    ...packet,
    version: 1,
    columns: FLIGHT_LOG_COLUMNS,
    overviewColumns: FLIGHT_OVERVIEW_COLUMNS,
    overview: overview.slice(-1800), // Last 30 minutes at 1 Hz.
    rows: [...(previous?.rows ?? []), ...rows].slice(-FLIGHT_LOG_ROWS),
  };
  await writeFile(`${path}.tmp`, JSON.stringify(saved));
  await rename(`${path}.tmp`, path);
  const summaryPath = join(directory, "latest.json");
  await writeFile(
    `${summaryPath}.tmp`,
    JSON.stringify(
      {
        file: filename,
        startedAt: packet.startedAt,
        endedAt: packet.endedAt,
        reason: packet.reason,
        metadata: packet.metadata,
        summary: packet.summary,
        detailRangeS: [saved.rows[0]?.[0], saved.rows.at(-1)?.[0]],
        detailSamples: saved.rows.length,
        overviewSamples: saved.overview.length,
      },
      null,
      2,
    ),
  );
  await rename(`${summaryPath}.tmp`, summaryPath);
  if (!previous) {
    const files = (await readdir(directory)).filter((name) => /^[\da-f-]{36}\.json$/.test(name));
    const dated = await Promise.all(
      files.map(async (name) => ({ name, time: (await stat(join(directory, name))).mtimeMs })),
    );
    dated.sort((a, b) => b.time - a.time);
    await Promise.all(dated.slice(5).map(({ name }) => rm(join(directory, name))));
  }
}

/** Local development only. No diagnostics endpoint is included in a production build. */
export function flightLogs(): Plugin {
  return {
    name: "flight-logs",
    apply: "serve",
    configureServer(server) {
      const directory = join(server.config.root, ".flight-logs");
      // Serialize disk updates, including a final packet overlapping a new flight.
      let writing = Promise.resolve();
      server.middlewares.use((request, response, next) => {
        if (request.url !== FLIGHT_LOG_PATH) return next();
        void (async () => {
          if (request.method !== "POST") {
            response.writeHead(405).end();
            return;
          }
          const origin = request.headers.origin;
          if (origin && new URL(origin).host !== request.headers.host) {
            response.writeHead(403).end();
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) {
            const bytes = Buffer.from(chunk as Uint8Array);
            size += bytes.length;
            if (size > 64 * 1024) {
              response.writeHead(413).end();
              return;
            }
            chunks.push(bytes);
          }
          const packet = JSON.parse(Buffer.concat(chunks).toString()) as FlightLogPacket;
          if (
            !/^[\da-f-]{36}$/.test(packet.id) ||
            !Array.isArray(packet.rows) ||
            packet.rows.length > 100
          ) {
            response.writeHead(400).end();
            return;
          }
          const save = writing.then(() => saveFlightPacket(directory, packet));
          writing = save.catch(() => {});
          await save;
          response.writeHead(204).end();
        })().catch((error: unknown) => {
          server.config.logger.error(`Flight log save failed: ${String(error)}`);
          response.writeHead(500).end();
        });
      });
    },
  };
}
