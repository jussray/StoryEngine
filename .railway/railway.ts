// Review-only IaC candidate based on live Railway inventory, not yet verified by Railway CLI pull/plan.
// No automatic apply is configured. Require a zero-unexpected-change provider plan before release.
import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway((ctx) => {
  if (ctx.projectId !== "d497b2c2-4cfc-4e0d-8441-bd48eb02baae" || ctx.environmentId !== "ad033208-07f8-47d8-9218-66618ad83ae7") {
    throw new Error("Wrong Railway project/environment: refusing IaC evaluation");
  }
  const data = volume("story-engine-data", { region: "iad", sizeMB: 500 });
  const app = service("story-engine", {
    source: github("jussray/StoryEngine", { branch: "main", rootDirectory: "story-engine" }),
    healthcheck: "/healthz",
    replicas: { iad: 1 },
    domains: ["storyengine.jussco.company"],
    volumeMounts: { "/data": data },
    env: {
      ALLOW_LEGACY_API_KEY: preserve(),
      ANTHROPIC_DEEP_MODEL: preserve(),
      ANTHROPIC_FAST_MODEL: preserve(),
      ANTHROPIC_MODEL: preserve(),
      ANTHROPIC_VERSION: preserve(),
      API_MAX_BODY_BYTES: preserve(),
      AUTONOMOUS_BOOK_MAX_TOKENS: preserve(),
      COMPANION_GHOST_FALLBACK_ENABLED: preserve(),
      DEFAULT_LLM: preserve(),
      DEFAULT_WRITING_LLM: preserve(),
      GHOST_WRITER_MAX_TOKENS: preserve(),
      GHOST_WRITER_PROVIDER: preserve(),
      HEYGEN_SUBMISSIONS_ENABLED: preserve(),
      L99_API_KEYS_JSON: preserve(),
      L99_DB_PATH: preserve(),
      L99_RELEASE_SHA: preserve(),
      L99_VIDEO_OUTPUT_DIR: preserve(),
      LEEVIZE_COMFYUI_WORKFLOW_PATH: preserve(),
      LEEVIZE_MODEL_ID: preserve(),
      LEEVIZE_MODEL_LICENSE_STATUS: preserve(),
      LEEVIZE_OPEN_VIDEO_OUTPUT_DIR: preserve(),
      LEEVIZE_RENDER_WORKER_ID: preserve(),
      LLM_CIRCUIT_FAILURE_THRESHOLD: preserve(),
      LLM_CIRCUIT_RESET_MS: preserve(),
      LLM_ERROR_BODY_MAX_BYTES: preserve(),
      LLM_MAX_RETRIES: preserve(),
      LLM_MAX_TOKENS_CAP: preserve(),
      LLM_SUCCESS_BODY_MAX_BYTES: preserve(),
      LLM_TIMEOUT_MS: preserve(),
      NODE_ENV: preserve(),
      RAILWAY_RUN_UID: preserve(),
      RUNTIME_DRAIN_INTERVAL_MS: preserve(),
      RUNTIME_SCAN_INTERVAL_MS: preserve(),
    },
  });
  return project("StoryEngine", { resources: [app, data] });
});
