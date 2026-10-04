import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle-active",
  schema: "./db/schema.ts",
  dialect: "sqlite",
});
