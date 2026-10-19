import { clamp } from "../flight/aerodynamics";
import type { TableReference } from "./motion";

const KEY = "bird-controller-preferences-v1";
const defaults = {
  comfort: 0.5,
  invertPitch: false,
  invertRoll: false,
};
type Preferences = typeof defaults;

export function loadPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Preferences>;
    return {
      comfort:
        typeof saved.comfort === "number" && Number.isFinite(saved.comfort)
          ? clamp(saved.comfort, 0, 1)
          : defaults.comfort,
      invertPitch: typeof saved.invertPitch === "boolean" ? saved.invertPitch : false,
      invertRoll: typeof saved.invertRoll === "boolean" ? saved.invertRoll : false,
    };
  } catch {
    return { ...defaults };
  }
}

export function savePreferences(preferences: Preferences) {
  try {
    localStorage.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // Flight still works when browser storage is unavailable.
  }
}

export function loadTableReference(controller: string): TableReference | null {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`bird-table-reference-v1:${controller}`) ?? "null",
    ) as TableReference | null;
    return saved &&
      [saved.up, saved.bias].every(
        (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite),
      ) &&
      Math.hypot(...saved.up) > 0.5
      ? saved
      : null;
  } catch {
    return null;
  }
}

export function saveTableReference(controller: string, reference: TableReference) {
  try {
    localStorage.setItem(`bird-table-reference-v1:${controller}`, JSON.stringify(reference));
  } catch {
    // The measured reference remains usable for this session.
  }
}

export function clearTableReference(controller: string) {
  try {
    localStorage.removeItem(`bird-table-reference-v1:${controller}`);
  } catch {
    // The current session can still measure a new reference.
  }
}
