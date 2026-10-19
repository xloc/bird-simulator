import { afterEach, expect, it, vi } from "vite-plus/test";
import { loadPreferences, savePreferences } from "./preferences";

afterEach(() => vi.unstubAllGlobals());

it("uses defaults if storage is blocked or malformed", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("Blocked");
    },
    setItem: () => {
      throw new Error("Blocked");
    },
  });
  const defaults = loadPreferences();
  expect(defaults.comfort).toBe(0.5);
  expect(() => savePreferences(defaults)).not.toThrow();
  for (const value of ["{", "null"]) {
    vi.stubGlobal("localStorage", { getItem: () => value });
    expect(loadPreferences()).toEqual(defaults);
  }
});

it("keeps saved settings inside usable bounds and rejects incorrect types", () => {
  vi.stubGlobal("localStorage", {
    getItem: () =>
      JSON.stringify({
        comfort: "loud",
        invertPitch: "false",
        invertRoll: true,
      }),
  });
  expect(loadPreferences()).toMatchObject({
    comfort: 0.5,
    invertPitch: false,
    invertRoll: true,
  });
});
