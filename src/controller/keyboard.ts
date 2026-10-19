import { DEG } from "../flight/aerodynamics";
import type { PlayerInput } from "./input";

export const KEYBOARD_BINDINGS = [
  { label: "Left wing", keys: ["F"], codes: ["KeyF"] },
  { label: "Right wing", keys: ["J"], codes: ["KeyJ"] },
  { label: "Pitch up / down", keys: ["↑", "↓"], codes: ["ArrowUp", "ArrowDown"] },
  { label: "Bank left / right", keys: ["←", "→"], codes: ["ArrowLeft", "ArrowRight"] },
  { label: "Walk", keys: ["W", "A", "S", "D"], codes: ["KeyW", "KeyA", "KeyS", "KeyD"] },
  { label: "Look", keys: ["I", "K", "U", "O"], codes: ["KeyI", "KeyK", "KeyU", "KeyO"] },
  { label: "Hold to charge / release to jump", keys: ["E"], codes: ["KeyE"] },
  { label: "Start / pause", keys: ["Space"], codes: ["Space"] },
  { label: "Reset flight", keys: ["R"], codes: ["KeyR"] },
];

/** Held keys request a single stroke and bounded posture, never repeated flaps. */
export function keyboardInput(pressed: Set<string>): PlayerInput {
  const held = (code: string) => Number(pressed.has(code));
  return {
    left: held("KeyF"),
    right: held("KeyJ"),
    pitch: (held("ArrowUp") - held("ArrowDown")) * 20 * DEG,
    roll: (held("ArrowRight") - held("ArrowLeft")) * 35 * DEG,
    walkX: held("KeyD") - held("KeyA"),
    walkY: held("KeyS") - held("KeyW"),
    lookX: held("KeyO") - held("KeyU"),
    lookY: held("KeyK") - held("KeyI"),
    jump: pressed.has("KeyE"),
  };
}
