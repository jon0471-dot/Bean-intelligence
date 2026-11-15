/**
 * M24 — Live provider readiness probe (free, non-metered).
 *
 * Uses ONLY the project's existing credential resolution and adapter health
 * machinery. Prints presence/status fields only — never credential values.
 *
 * Run: bun scripts/m24/probe-provider.ts
 */
import { resolveProviderCredentials } from "@/lib/providers/credentials";
import { hostedLlmAdapter } from "@/lib/adapters/hosted-llm";
import { getGatewayModels } from "@/lib/registry/models";
import { BACKEND_REGISTRY } from "@/lib/registry/backends";
import { upstreamBreakerState } from "@/lib/upstream/gateway";

async function main() {
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
  };

  // 1. Credential resolution through the existing mechanism.
  const cred = await resolveProviderCredentials("zai-gateway");
  report.credential = {
    status: cred.status,
    present: cred.present,
    // NEVER the value itself.
  };

  // 2. Registry view: which models does the unified gateway expose?
  const models = await getGatewayModels();
  report.gatewayModels = models.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    backendId: m.backendId,
    capabilities: m.capabilities,
    backendHealth: m.backendHealth ? { healthy: m.backendHealth.healthy, failureCategory: m.backendHealth.failureCategory ?? null } : null,
  }));

  // 3. Backend registry: coding-task backend configuration (names only).
  const codeBackend = BACKEND_REGISTRY.find(
    (b) => b.id === "bean-code-llm-hosted-primary",
  );
  report.codeBackend = codeBackend
    ? {
        id: codeBackend.id,
        task: codeBackend.task,
        enabled: codeBackend.enabled,
        timeouts: codeBackend.timeouts,
        concurrency: codeBackend.concurrency,
        retries: codeBackend.retries,
      }
    : null;

  // 4. Real adapter health probe — config gate + free GET /models
  //    reachability + breaker state. Non-metered by design.
  const t0 = Date.now();
  const health = await hostedLlmAdapter.health();
  report.adapterHealth = {
    healthy: health.healthy,
    latencyMs: health.latencyMs ?? Date.now() - t0,
    httpStatus: health.httpStatus ?? null,
    failureCategory: health.failureCategory ?? null,
    detail: typeof health.detail === "string" ? health.detail.slice(0, 300) : null,
    wallMs: Date.now() - t0,
  };

  // 5. Breaker state (should be closed/cold before any live traffic).
  report.breaker = upstreamBreakerState("chat" as never);

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      probe: "failed",
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
});
