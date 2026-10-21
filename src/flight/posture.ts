import { Euler, Quaternion, Vector3 } from "three";
import { clamp, DEG } from "./aerodynamics";

export const POSTURE = {
  pitchLimit: 30 * DEG,
  rollLimit: 55 * DEG,
  pitchGain: 3,
  pitchDamping: 1,
  rollGain: 6,
  rollDamping: 2,
  pitchAcceleration: 3,
  rollAcceleration: 4,
  yawDamping: 4,
  slipGain: 2,
  yawWeight: 1, // Coordinate heading without letting sideslip accumulate between strokes.
  forceWeight: 0.6, // Preserve stroke lift/thrust while correcting attitude.
  featherPreparationWeight: 30,
  strokeRateCost: 0.2,
  commonFeatherCost: 10,
  differentialFeatherCost: 0.2,
  tailCost: 0.1,
  shoulderRateCost: 4,
  shoulderPoseCost: 10000, // Restore released wings promptly; opposed angles can turn a level body.
};

/** Attitude error and damping, independent of which joints supply the correction. */
export function postureControl(
  orientation: Quaternion,
  omega: Vector3,
  pitch: number,
  roll: number,
) {
  const pose = new Euler().setFromQuaternion(orientation, "YXZ");
  const pitchRate = Math.cos(pose.z) * omega.x - Math.sin(pose.z) * omega.y;
  const yawRate =
    (Math.sin(pose.z) * omega.x + Math.cos(pose.z) * omega.y) / Math.max(0.1, Math.cos(pose.x));
  const bankRate = -(omega.z + Math.sin(pose.x) * yawRate);
  const error = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
  return {
    pitch: clamp(
      POSTURE.pitchGain * error(clamp(pitch, -POSTURE.pitchLimit, POSTURE.pitchLimit) - pose.x) -
        POSTURE.pitchDamping * pitchRate,
      -1,
      1,
    ),
    roll: clamp(
      POSTURE.rollGain * error(clamp(roll, -POSTURE.rollLimit, POSTURE.rollLimit) + pose.z) -
        POSTURE.rollDamping * bankRate,
      -1,
      1,
    ),
  };
}

/** Requested pitch, heading and bank accelerations, in radians per second squared. */
export function postureAcceleration(
  orientation: Quaternion,
  omega: Vector3,
  air: Vector3,
  pitch: number,
  roll: number,
  gravity: number,
) {
  const pose = new Euler().setFromQuaternion(orientation, "YXZ");
  const control = postureControl(orientation, omega, pitch, roll);
  const yawRate =
    (Math.sin(pose.z) * omega.x + Math.cos(pose.z) * omega.y) / Math.max(0.1, Math.cos(pose.x));
  const slip = Math.atan2(air.x, Math.max(1, -air.z));
  // Follow a banked turn while damping sideslip; there is no heading hold.
  const turnRate =
    (gravity * Math.tan(clamp(pose.z, -60 * DEG, 60 * DEG))) / Math.max(4, air.length());
  const yaw = clamp(POSTURE.yawDamping * (turnRate - POSTURE.slipGain * slip - yawRate), -4, 4);
  return new Vector3(
    control.pitch * POSTURE.pitchAcceleration,
    yaw,
    control.roll * POSTURE.rollAcceleration,
  );
}

/** Physical body acceleration expressed in pitch, heading and bank coordinates. */
export function attitudeAcceleration(
  orientation: Quaternion,
  omega: Vector3,
  acceleration: Vector3,
) {
  const pose = new Euler().setFromQuaternion(orientation, "YXZ");
  const c = Math.cos(pose.z),
    s = Math.sin(pose.z);
  const cp = Math.max(0.1, Math.cos(pose.x)),
    sp = Math.sin(pose.x);
  const pitchRate = c * omega.x - s * omega.y;
  const yawRate = (s * omega.x + c * omega.y) / cp;
  const bankRate = -(omega.z + sp * yawRate);
  const yaw =
    (s * acceleration.x + c * acceleration.y - bankRate * pitchRate) / cp +
    ((yawRate * sp) / cp) * pitchRate;
  return new Vector3(
    c * acceleration.x - s * acceleration.y + bankRate * cp * yawRate,
    yaw,
    -acceleration.z - cp * pitchRate * yawRate - sp * yaw,
  );
}

/** Bounded least squares around the actual aerodynamic response at this step. */
export function allocateJoints(
  current: number[],
  lower: number[],
  upper: number[],
  penalty: number[],
  preferred: number[],
  desired: number[],
  evaluate: (joints: number[]) => number[],
) {
  // Feather pitch and tail cant interact strongly during stroke reversal.
  // Recompute the response after an accepted move, within the same joint limits.
  for (let iteration = 0; iteration < 3; iteration++) {
    const base = evaluate(current);
    const columns = current.map((value, i) => {
      const plus = Math.min(0.1 * DEG, upper[i]! - value);
      const minus = Math.min(0.1 * DEG, value - lower[i]!);
      if (plus + minus < 1e-8) return base.map(() => 0);
      const high = [...current],
        low = [...current];
      high[i] = value + plus;
      low[i] = value - minus;
      const a = evaluate(high),
        b = evaluate(low);
      return a.map((value, j) => (value - b[j]!) / (plus + minus));
    });
    const result = [...current];
    const error = base.map((value, j) => value - desired[j]!);
    const dot = (a: number[], b: number[]) => a.reduce((sum, value, j) => sum + value * b[j]!, 0);
    for (let pass = 0; pass < 12; pass++) {
      for (let i = 0; i < result.length; i++) {
        if (lower[i] === upper[i]) continue;
        // Solve the two shoulders together: serial updates can invent left/right
        // asymmetry during a symmetric stroke when both shoulder columns are strong.
        if (i === 3 && lower[4] !== upper[4]) {
          const a = columns[3]!,
            b = columns[4]!;
          const aa = dot(a, a) + penalty[3]!,
            ab = dot(a, b),
            bb = dot(b, b) + penalty[4]!;
          const ga = dot(a, error) + penalty[3]! * (result[3]! - preferred[3]!);
          const gb = dot(b, error) + penalty[4]! * (result[4]! - preferred[4]!);
          const determinant = aa * bb - ab * ab;
          const changes = [(-bb * ga + ab * gb) / determinant, (ab * ga - aa * gb) / determinant];
          for (let k = 0; k < 2; k++) {
            const index = 3 + k;
            const next = clamp(result[index]! + changes[k]!, lower[index]!, upper[index]!);
            for (let j = 0; j < error.length; j++)
              error[j]! += columns[index]![j]! * (next - result[index]!);
            result[index] = next;
          }
          i++;
          continue;
        }
        const column = columns[i]!;
        const next = clamp(
          result[i]! -
            (dot(column, error) + penalty[i]! * (result[i]! - preferred[i]!)) /
              (dot(column, column) + penalty[i]!),
          lower[i]!,
          upper[i]!,
        );
        for (let j = 0; j < error.length; j++) error[j]! += column[j]! * (next - result[i]!);
        result[i] = next;
      }
    }
    // A local slope can be misleading near stall. Only accept a step that improves the real load.
    const cost = (values: number[]) =>
      evaluate(values).reduce((sum, value, j) => sum + (value - desired[j]!) ** 2, 0) +
      values.reduce((sum, value, i) => sum + penalty[i]! * (value - preferred[i]!) ** 2, 0);
    const before = cost(current);
    let improved = false;
    for (const fraction of [1, 0.5, 0.25]) {
      const candidate = current.map((value, i) => value + fraction * (result[i]! - value));
      if (cost(candidate) < before) {
        current = candidate;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }
  return current;
}
