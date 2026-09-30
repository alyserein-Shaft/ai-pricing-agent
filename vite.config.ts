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
    AI_PRESALES_AGENT_DIAGNOSTIC_SMOKE_ENABLED: "1",
    ...(goldenE2e
      ? {
          APP_ACCESS_MODE: "single-user",
          APP_USER_ID: "golden-e2e-user",
          APP_USER_EMAIL: "golden-e2e@local.invalid",
          APP_USER_NAME: "Golden E2E User",
          APP_ORGANIZATION_ID: "golden-e2e-organization",
          GOLDEN_E2E: "1",
          // R1 access boundary, hermetic E2E run. The Golden E2E harness is a
          // local, explicitly-flagged, single-actor environment, so it uses the
          // explicit development bypass rather than shipping a credential. The
          // bypass is not silent: /api/health/ready reports it and fails while it
          // is on, so a real deployment can never be "ready" this way. These are
          // test constants for a throwaway local database, not secrets.
          APP_R1_DEV_AUTH_BYPASS: "1",
          // Truthful human actor for the hermetic run. worker/human-actor.mjs
          // fail-closes every human-authority mutation (403
          // HUMAN_ACTOR_NOT_CONFIGURED) until an operator identity is configured,
          // and it refuses to quote a synthetic development id as a human
          // decision-maker. The journey records governed human decisions
          // (BOQ engineering review, understanding edits), so the harness must
          // name a human. This is a labelled TEST operator for a throwaway local
          // database, never a real person's identity and never a secret; it must
          // not collide with worker/human-actor.mjs's SYNTHETIC_ACTOR_IDS.
          APP_HUMAN_ID: "golden-e2e-operator",
          APP_HUMAN_NAME: "Golden E2E Operator",
          APP_HUMAN_EMAIL: "golden-e2e-operator@local.invalid",
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
      port: 4183,
      // Fail fast instead of silently drifting to 4184+: a second dev
      // server once caused UI/API runtime-authority split (two competing
      // listeners on one workspace). Canonical runtime is 4183.
      strictPort: true,
      allowedHosts: ["terminal.local", "curve-administered-accountability-living.trycloudflare.com"],
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
