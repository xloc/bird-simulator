import { NEUTRAL_INPUT } from "../flight/model";
import type { FlightInput } from "../flight/model";

export interface PlayerInput extends FlightInput {
  walkX: number;
  walkY: number;
  lookX: number;
  lookY: number;
  jump: boolean;
}

export const NEUTRAL_PLAYER_INPUT: PlayerInput = {
  ...NEUTRAL_INPUT,
  walkX: 0,
  walkY: 0,
  lookX: 0,
  lookY: 0,
  jump: false,
};

/** Circular dead zone with continuous travel outside the center. */
export function stick(x: number, y: number) {
  const length = Math.hypot(x, y);
  const deadZone = 0.12;
  if (length <= deadZone) return { x: 0, y: 0 };
  const scale = (Math.min(1, length) - deadZone) / ((1 - deadZone) * length);
  return { x: x * scale, y: y * scale };
}
