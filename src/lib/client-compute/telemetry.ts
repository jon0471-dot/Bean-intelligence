/**
 * BEAN Intelligence — client compute: diagnostics and sanitized telemetry
 * (Phase 13).
 *
 * Rules:
 *  - Diagnostic events live in a LOCAL bounded ring buffer by default.
 *  - Nothing here ever stores raw media, prompt text, or payload bytes —
 *    notes are redacted through privacy.redactForDiagnostics.
 *  - The ONLY network surface is buildCapabilityReport(): a sanitized,
 *    structured summary (booleans, counts, tier) that the user explicitly
 *    consents to share, sent to the BEAN report endpoint. No vendor /
 *    architecture strings, no user-agent text, no task payloads.
 *
 * Client-safe: no Node-only imports.
 */
import { redactForDiagnostics } from './privacy'
import type { CapabilityReport, CapabilitySnapshot, ComputeTaskState, DeviceProfile } from './types'

export interface DiagnosticEvent {
  at: number
  level: 'info' | 'warn' | 'error'
  area: string
  message: string
}

const RING_CAPACITY = 200

class DiagnosticRing {
  private events: DiagnosticEvent[] = []

  push(level: DiagnosticEvent['level'], area: string, message: unknown): void {
    this.events.push({ at: Date.now(), level, area, message: redactForDiagnostics(message) })
    if (this.events.length > RING_CAPACITY) this.events.splice(0, this.events.length - RING_CAPACITY)
  }

  recent(count = 50): DiagnosticEvent[] {
    return this.events.slice(-count)
  }

  clear(): void {
    this.events = []
  }
}

const ring = new DiagnosticRing()

export function logDiagnostic(level: DiagnosticEvent['level'], area: string, message: unknown): void {
  ring.push(level, area, message)
}

export function recentDiagnostics(count?: number): DiagnosticEvent[] {
  return ring.recent(count)
}

export function clearDiagnostics(): void {
  ring.clear()
}

/** Build the sanitized capability report (the only thing that may leave the
 * device, and only with the user's explicit consent handled by the caller). */
export function buildCapabilityReport(options: {
  snapshot: CapabilitySnapshot
  profile: DeviceProfile
  installedModels: string[]
}): CapabilityReport {
  const { snapshot, profile, installedModels } = options
  return {
    tier: profile.tier,
    conservative: profile.conservative,
    webgpuSupported: snapshot.webgpu.supported,
    webgpuAdapterAvailable: snapshot.webgpu.adapterAvailable,
    webgl2: snapshot.webgl.webgl2,
    wasm: snapshot.wasm.supported,
    workers: snapshot.workers,
    offscreenCanvas: snapshot.offscreenCanvas,
    sharedArrayBuffer: snapshot.sharedArrayBuffer,
    secureContext: snapshot.secureContext,
    hardwareConcurrency: snapshot.hardwareConcurrency,
    deviceMemoryGb: snapshot.deviceMemoryGb,
    storageQuotaBytes: snapshot.storage?.quotaBytes ?? null,
    benchmark: profile.benchmark
      ? {
          cpuOpsPerSec: profile.benchmark.cpuOpsPerSec,
          gpuComputeOk: profile.benchmark.gpuComputeOk,
          durationMs: profile.benchmark.durationMs,
        }
      : null,
    installedModels,
    reportedAt: new Date().toISOString(),
  }
}

/** Server contract type shared with the report route (kept in sync manually —
 * this file is client-safe and must not import server modules). */
export interface ClientComputeReportPayload {
  report: CapabilityReport
  /** Optional honest task-state summary (counts only — never payloads). */
  taskSummary?: Partial<Record<ComputeTaskState, number>>
}
