import { Vector3 } from "three";

export const DEG = Math.PI / 180;
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const POLAR = {
  profileDrag: 0.006,
  liftProfileDrag: 0.005,
  spanEfficiency: 0.8,
};

/** Symmetric full-angle polar, smoothly blending attached and separated flow. */
export function coefficients(alpha: number, aspectRatio = 7) {
  const efficiency = POLAR.spanEfficiency;
  const slope = (2 * Math.PI) / (1 + 2 / (efficiency * aspectRatio));
  const t = clamp((Math.abs(alpha) - 12 * DEG) / (13 * DEG), 0, 1);
  const separated = t * t * (3 - 2 * t);
  const attachedLift = slope * alpha;
  const lift = (1 - separated) * attachedLift + separated * 1.8 * Math.sin(alpha) * Math.cos(alpha);
  const drag =
    POLAR.profileDrag +
    (1 - separated) * POLAR.liftProfileDrag * attachedLift ** 2 +
    separated * 1.8 * Math.sin(alpha) ** 2 +
    ((1 - separated) * lift ** 2) / (Math.PI * efficiency * aspectRatio);
  return { lift, drag, separated };
}

/** All vectors share a frame. velocity is surface velocity relative to air. */
export function stripForce(
  velocity: Vector3,
  chord: Vector3,
  normal: Vector3,
  area: number,
  aspectRatio = 7,
) {
  const span = new Vector3().crossVectors(chord, normal).normalize();
  const flow = velocity.clone().addScaledVector(span, -velocity.dot(span));
  const speed = flow.length();
  if (speed < 1e-6) return { force: new Vector3(), alpha: 0, speed, separated: 0 };
  const alpha = Math.atan2(-flow.dot(normal), flow.dot(chord));
  const polar = coefficients(alpha, aspectRatio);
  flow.divideScalar(speed);
  const liftDirection = new Vector3().crossVectors(span, flow);
  const force = liftDirection
    .multiplyScalar(polar.lift)
    .addScaledVector(flow, -polar.drag)
    .multiplyScalar(0.5 * 1.225 * speed ** 2 * area);
  return { force, alpha, speed, separated: polar.separated };
}
