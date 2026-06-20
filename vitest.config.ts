import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@siglume/direct-request-payment": new URL("./src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
