import { Euler } from "three";
import { DEG } from "./aerodynamics";
import type { FlightInput, FlightModel } from "./model";
import { postureControl } from "./posture";

export const FLIGHT_LOG_PATH = "/__flight-log";
export const FLIGHT_LOG_ROWS = 1200; // Last two minutes at 10 Hz.
export const FLIGHT_LOG_COLUMNS = [
  "t_s",
  "target_pitch_deg",
  "target_bank_deg",
  "pitch_deg",
  "bank_deg",
  "qx",
  "qy",
  "qz",
  "qw",
  "omega_x_deg_s",
  "omega_y_deg_s",
  "omega_z_deg_s",
  "airspeed_m_s",
  "height_m",
  "vertical_speed_m_s",
  "air_body_x_m_s",
  "air_body_y_m_s",
  "air_body_z_m_s",
  "left_trigger",
  "right_trigger",
  "left_deg",
  "right_deg",
  "left_rate_deg_s",
  "right_rate_deg_s",
  "pitch_control",
  "bank_control",
  "left_incidence_deg",
  "right_incidence_deg",
  "tail_incidence_deg",
  "left_force_y_N",
  "right_force_y_N",
  "moment_x_Nm",
  "moment_y_Nm",
  "moment_z_Nm",
  "left_alpha_deg",
  "right_alpha_deg",
  "left_separation",
  "right_separation",
  "left_baseline_deg",
  "right_baseline_deg",
  "left_target_deg",
  "right_target_deg",
  "left_stroke_active",
  "right_stroke_active",
  "joint_power_W",
  "energy_J",
  "joint_work_J",
  "aerodynamic_work_J",
  "left_fold_deg",
  "right_fold_deg",
  "left_tip_feather_deg",
  "right_tip_feather_deg",
  "tail_cant_deg",
  "motion_age_ms",
  "grounded",
] as const;
export const FLIGHT_OVERVIEW_COLUMNS = [
  "t_s",
  "target_bank_deg",
  "bank_deg",
  "target_pitch_deg",
  "pitch_deg",
  "airspeed_m_s",
  "height_m",
  "omega_z_deg_s",
  "left_deg",
  "right_deg",
  "bank_control",
  "left_separation",
  "right_separation",
] as const;

export interface FlightLogPacket {
  id: string;
  startedAt: string;
  endedAt: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  summary: {
    durationS: number;
    samples: number;
    maxAbsBankDeg: number;
    maxAbsBankErrorDeg: number;
    maxAbsBodyRollRateDegS: number;
    minAirspeedMS: number;
    minHeightM: number;
    bankSaturationFraction: number;
    firstBankDeparture: { timeS: number; targetDeg: number; actualDeg: number } | null;
  };
  rows: number[][];
}

/** Diagnostic sampling only: never modifies the flight model or its inputs. */
export class FlightRecorder {
  private packet: FlightLogPacket;
  private pending: number[][] = [];
  private nextSample = 0;
  private lastSample = -1;
  private saturated = 0;
  private dirty = false;
  private sending = false;
  private lastSend = -Infinity;
  private startTime: number;
  private status: (message: string) => void;

  constructor(
    metadata: Record<string, unknown>,
    startTime: number,
    status: (message: string) => void,
  ) {
    this.startTime = startTime;
    this.status = status;
    this.packet = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      reason: null,
      metadata,
      summary: {
        durationS: 0,
        samples: 0,
        maxAbsBankDeg: 0,
        maxAbsBankErrorDeg: 0,
        maxAbsBodyRollRateDegS: 0,
        minAirspeedMS: Infinity,
        minHeightM: Infinity,
        bankSaturationFraction: 0,
        firstBankDeparture: null,
      },
      rows: [],
    };
  }

  sample(flight: FlightModel, input: FlightInput, motionAge: number, final = false) {
    const t = flight.time - this.startTime;
    if (this.packet.endedAt || t <= this.lastSample || (!final && t + 1e-6 < this.nextSample))
      return;
    this.lastSample = t;
    this.nextSample = t + 0.1;
    const pose = new Euler().setFromQuaternion(flight.orientation, "YXZ");
    // Requested correction at this sampled state; actual surface positions below include actuator lag.
    const control = postureControl(flight.orientation, flight.omega, input.pitch, input.roll);
    const air = flight.velocity
      .clone()
      .sub(flight.wind)
      .applyQuaternion(flight.orientation.clone().invert());
    const [left, right] = flight.wings;
    const average = (wing: typeof left, key: "alpha" | "separated") =>
      wing.surfaces.reduce((sum, s) => sum + s[key] * s.area, 0) /
      wing.surfaces.reduce((sum, s) => sum + s.area, 0);
    const forceY = (wing: typeof left) => wing.surfaces.reduce((sum, s) => sum + s.force.y, 0);
    const row = [
      t,
      input.pitch / DEG,
      input.roll / DEG,
      pose.x / DEG,
      -pose.z / DEG,
      ...flight.orientation.toArray(),
      ...flight.omega.clone().divideScalar(DEG).toArray(),
      air.length(),
      flight.position.y,
      flight.velocity.y,
      ...air.toArray(),
      input.left,
      input.right,
      left.angle / DEG,
      right.angle / DEG,
      left.rate / DEG,
      right.rate / DEG,
      control.pitch,
      control.roll,
      left.incidence / DEG,
      right.incidence / DEG,
      flight.tailIncidence / DEG,
      forceY(left),
      forceY(right),
      ...flight.moment.toArray(),
      average(left, "alpha") / DEG,
      average(right, "alpha") / DEG,
      average(left, "separated"),
      average(right, "separated"),
      left.baseline / DEG,
      right.baseline / DEG,
      left.target / DEG,
      right.target / DEG,
      Number(left.manual || left.returning),
      Number(right.manual || right.returning),
      flight.jointPower,
      flight.energy,
      flight.jointWork,
      flight.aerodynamicWork,
      left.fold / DEG,
      right.fold / DEG,
      left.surfaces.at(-1)!.incidence / DEG,
      right.surfaces.at(-1)!.incidence / DEG,
      flight.tailCant / DEG,
      Number.isFinite(motionAge) ? motionAge : -1,
      Number(flight.grounded),
    ].map((n) => Math.round(n * 1000) / 1000);
    const summary = this.packet.summary;
    const bank = -pose.z / DEG;
    const bankError =
      Math.atan2(Math.sin(input.roll + pose.z), Math.cos(input.roll + pose.z)) / DEG;
    summary.durationS = row[0]!;
    summary.samples++;
    summary.maxAbsBankDeg = Math.max(summary.maxAbsBankDeg, Math.abs(bank));
    summary.maxAbsBankErrorDeg = Math.max(summary.maxAbsBankErrorDeg, Math.abs(bankError));
    summary.maxAbsBodyRollRateDegS = Math.max(
      summary.maxAbsBodyRollRateDegS,
      Math.abs(flight.omega.z / DEG),
    );
    summary.minAirspeedMS = Math.min(summary.minAirspeedMS, air.length());
    summary.minHeightM = Math.min(summary.minHeightM, flight.position.y);
    if (Math.abs(control.roll) >= 0.99) this.saturated++;
    summary.bankSaturationFraction = this.saturated / summary.samples;
    if (!summary.firstBankDeparture && Math.abs(input.roll / DEG) < 5 && Math.abs(bankError) > 20)
      summary.firstBankDeparture = { timeS: row[0]!, targetDeg: row[2]!, actualDeg: row[4]! };
    this.pending.push(row);
    if (this.pending.length > FLIGHT_LOG_ROWS) this.pending.shift();
    this.dirty = true;
  }

  finish(reason: string) {
    if (this.packet.endedAt) return;
    this.packet.endedAt = new Date().toISOString();
    this.packet.reason = reason;
    this.dirty = true;
    void this.flush(true);
  }

  async flush(force = false) {
    if (this.sending || !this.dirty || (!force && performance.now() - this.lastSend < 2000)) return;
    this.sending = true;
    this.dirty = false;
    this.lastSend = performance.now();
    // Small batches stay below the browser's keepalive request budget, including on page hide.
    const rows = this.pending.splice(0, 100);
    const endedAt = this.packet.endedAt;
    let saved = false;
    try {
      const response = await fetch(FLIGHT_LOG_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...this.packet, rows }),
        keepalive: true,
      });
      if (!response.ok) throw new Error(`Flight log: ${response.status}`);
      saved = true;
      this.status(
        endedAt && this.pending.length === 0
          ? "Flight log saved locally."
          : this.packet.endedAt
            ? "Saving flight log…"
            : "Recording flight · saved locally",
      );
    } catch {
      this.pending = [...rows, ...this.pending].slice(-FLIGHT_LOG_ROWS);
      this.dirty = true;
      this.status("Flight log could not be saved. Retrying locally…");
    } finally {
      this.sending = false;
      this.dirty ||= this.pending.length > 0;
      if (saved && this.packet.endedAt && this.dirty) void this.flush(true);
    }
  }
}
