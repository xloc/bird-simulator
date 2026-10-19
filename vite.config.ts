import { defineConfig, lazyPlugins } from "vite-plus";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import tresTemplate from "@tresjs/core/template-compiler-options";
import { flightLogs } from "./dev/flight-logs";

export default defineConfig({
  plugins: lazyPlugins(() => [vue(tresTemplate), tailwindcss(), flightLogs()]),
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["dist/**", ".flight-logs/**"],
  },
  fmt: {
    ignorePatterns: ["design/**", "CLAUDE.md", "AGENTS.md", "pnpm-lock.yaml", ".flight-logs/**"],
  },
  test: { include: ["src/**/*.test.ts"] },
  server: { host: "127.0.0.1", watch: { ignored: ["**/.flight-logs/**"] } },
});
