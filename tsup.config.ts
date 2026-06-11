import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm", "cjs"],
  dts: {
    entry: {
      index: "src/index.ts",
    },
  },
  target: "es2022",
  platform: "neutral",
  sourcemap: true,
  splitting: false,
  clean: true,
  outDir: "dist",
});
