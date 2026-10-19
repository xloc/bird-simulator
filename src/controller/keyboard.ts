import { DEG } from "../flight/aerodynamics";
import type { FlightInput } from "../flight/model";

export const KEYBOARD_BINDINGS = [
  { label: "Left wing", keys: ["F"], codes: ["KeyF"] },
  { label: "Right wing", keys: ["J"], codes: ["KeyJ"] },
  { label: "Pitch up / down", keys: ["↑", "↓"], codes: ["ArrowUp", "ArrowDown"] },
  { label: "Bank left / right", keys: ["←", "→"], codes: ["ArrowLeft", "ArrowRight"] },
  { label: "Start / pause", keys: ["Space"], codes: ["Space"] },
  { label: "Reset flight", keys: ["R"], codes: ["KeyR"] },
];

/** Held keys request a single stroke and bounded posture, never repeated flaps. */
export function keyboardInput(pressed: Set<string>): FlightInput {
  const held = (code: string) => Number(pressed.has(code));
  return {
    left: held("KeyF"),
    right: held("KeyJ"),
    pitch: (held("ArrowUp") - held("ArrowDown")) * 20 * DEG,
    roll: (held("ArrowRight") - held("ArrowLeft")) * 35 * DEG,
  };
}
