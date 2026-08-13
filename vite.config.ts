import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";
import { fileURLToPath } from "node:url";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;
const goldenE2e = process.env.GOLDEN_E2E === "1";
const boqAiModel =
  process.env.BOQ_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  vars: {
    BOQ_AI_PROVIDER: "cloudflare",
    BOQ_AI_MODEL: boqAiModel,
    BOQ_AI_MODEL_VERSION: boqAiModel,
    BOQ_AI_ESCALATION_MODEL: process.env.BOQ_AI_ESCALATION_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    BOQ_AI_DIAGNOSTIC_SMOKE_ENABLED: "1",
    ...(goldenE2e
      ? {
          APP_ACCESS_MODE: "single-user",
          APP_USER_ID: "golden-e2e-user",
          APP_USER_EMAIL: "golden-e2e@local.invalid",
          APP_USER_NAME: "Golden E2E User",
          APP_ORGANIZATION_ID: "golden-e2e-organization",
          GOLDEN_E2E: "1",
        }
      : {}),
  },
  ai: { binding: "AI", remote: true },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
  queues: {
    producers: [
      {
        binding: "SPECIFICATION_QUEUE",
        queue: "ai-pricing-specification-extraction",
      },
    ],
    consumers: [
      {
        queue: "ai-pricing-specification-extraction",
        max_batch_size: 1,
        max_batch_timeout: 1,
        max_retries: 3,
      },
    ],
  },
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    optimizeDeps: {
      exclude: ["pdfjs-dist"],
    },
    resolve: {
      alias: {
        "@napi-rs/canvas": fileURLToPath(new URL("./build/napi-canvas-shim.mjs", import.meta.url)),
      },
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
        persistState: process.env.GOLDEN_E2E_STATE_DIR
          ? { path: process.env.GOLDEN_E2E_STATE_DIR }
          : true,
      }),
    ],
  };
});
