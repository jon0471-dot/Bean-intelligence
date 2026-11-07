/**
 * BEAN Intelligence — GPU / hardware resource scheduler (Phase 5).
 *
 * Hardware-aware execution for local model workers:
 *  - detect CUDA GPUs (nvidia-smi), CPU count, RAM and free disk;
 *  - enforce a VRAM budget so simultaneous GPU jobs cannot exhaust the card;
 *  - report honestly when a model cannot run HERE — availability is
 *    measured, never assumed (a worker that merely starts proves nothing).
 *
 * The deployment sandbox has no GPU; the target operator PC (Ryzen 7,
 * RTX 5060 Ti 16 GB) reports through the same probe. A local model is only
 * routable when its declared hardware requirement is actually satisfied
 * AND the worker's own preflight passes (license + checksum + CUDA gates).
 *
 * SERVER-ONLY.
 */

import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import { logger } from '@/lib/observability/logger'

export interface HardwareReport {
  cudaAvailable: boolean
  gpus: Array<{ name: string; vramTotalMb: number; vramFreeMb: number }>
  cpuCores: number
  totalRamMb: number
  freeRamMb: number
  freeDiskMb: number | null
  checkedAt: string
}

export interface VramReservation {
  jobId: string
  modelId: string
  vramMb: number
  reservedAt: number
}

const RESERVATIONS_KEY = '__bean_gpu_reservations__'

function reservations(): Map<string, VramReservation> {
  const g = globalThis as unknown as { [RESERVATIONS_KEY]?: Map<string, VramReservation> }
  if (!g[RESERVATIONS_KEY]) g[RESERVATIONS_KEY] = new Map()
  return g[RESERVATIONS_KEY]
}

let cachedReport: { at: number; report: HardwareReport } | null = null
const CACHE_MS = 60_000

function probeNvidiaSmi(): Promise<HardwareReport['gpus']> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve([]), 3_000)
    execFile(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,memory.free', '--format=csv,noheader,nounits'],
      { timeout: 2_500 },
      (err, stdout) => {
        clearTimeout(t)
        if (err || !stdout.trim()) return resolve([])
        const gpus = stdout
          .trim()
          .split('\n')
          .map((line) => {
            const [name, total, free] = line.split(',').map((s) => s.trim())
            return {
              name: name ?? 'unknown',
              vramTotalMb: Number(total) || 0,
              vramFreeMb: Number(free) || 0,
            }
          })
          .filter((g) => g.vramTotalMb > 0)
        resolve(gpus)
      },
    )
  })
}

function freeDiskMb(): number | null {
  try {
    // Node >= 18.15: fs.statfs; bun implements it too.
    const s = (fs as unknown as { statfs?: (p: string, cb: (e: unknown, st: { bavail: number; bsize: number }) => void) => void }).statfs
    if (!s) return null
    // Synchronous wrapper via execSync-free approach is not available; use
    // a best-effort cached async probe instead (see detectHardware).
    return null
  } catch {
    return null
  }
}

function statfsAsync(path: string): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const s = (
        fs as unknown as {
          statfs?: (p: string, cb: (e: unknown, st: { bavail: number; bsize: number }) => void) => void
        }
      ).statfs
      if (!s) return resolve(null)
      s(path, (err, st) => {
        if (err) return resolve(null)
        resolve(Math.round((st.bavail * st.bsize) / (1024 * 1024)))
      })
    } catch {
      resolve(null)
    }
  })
}

/** Measure the actual host. Cached for 60s. */
export async function detectHardware(force = false): Promise<HardwareReport> {
  const now = Date.now()
  if (!force && cachedReport && now - cachedReport.at < CACHE_MS) return cachedReport.report

  const gpus = await probeNvidiaSmi()
  const disk = await statfsAsync(process.cwd())
  const report: HardwareReport = {
    cudaAvailable: gpus.length > 0,
    gpus,
    cpuCores: os.cpus().length,
    totalRamMb: Math.round(os.totalmem() / (1024 * 1024)),
    freeRamMb: Math.round(os.freemem() / (1024 * 1024)),
    freeDiskMb: disk ?? freeDiskMb(),
    checkedAt: new Date().toISOString(),
  }
  cachedReport = { at: now, report }
  return report
}

export interface HardwareRequirement {
  /** Minimum VRAM (MB) on ONE GPU; null = no GPU needed. */
  vramMb: number | null
  /** Minimum free system RAM (MB). */
  ramMb?: number
  /** Minimum free disk (MB) for weights. */
  diskMb?: number
}

/**
 * Can a model with this requirement actually execute here RIGHT NOW
 * (accounting for active VRAM reservations)? Returns a human-readable
 * reason when it cannot — the honest unavailability contract.
 */
export async function checkHardwareFit(
  req: HardwareRequirement,
): Promise<{ fits: boolean; reason: string | null }> {
  const hw = await detectHardware()
  if (req.vramMb !== null) {
    if (!hw.cudaAvailable) {
      return { fits: false, reason: 'No CUDA GPU is available on this host.' }
    }
    const gpu = hw.gpus[0]
    const reserved = [...reservations().values()].reduce((a, r) => a + r.vramMb, 0)
    const free = gpu.vramFreeMb - reserved
    if (free < req.vramMb) {
      return {
        fits: false,
        reason: `Needs ${req.vramMb} MB VRAM; ${Math.max(0, free)} MB free (${gpu.name}${reserved > 0 ? `, ${reserved} MB reserved by running jobs` : ''}).`,
      }
    }
  }
  if (req.ramMb && hw.freeRamMb < req.ramMb) {
    return { fits: false, reason: `Needs ${req.ramMb} MB free RAM; ${hw.freeRamMb} MB free.` }
  }
  if (req.diskMb && hw.freeDiskMb !== null && hw.freeDiskMb < req.diskMb) {
    return { fits: false, reason: `Needs ${req.diskMb} MB free disk for weights; ${hw.freeDiskMb} MB free.` }
  }
  return { fits: true, reason: null }
}

/** Reserve VRAM for a starting GPU job (crash-safe: short-lived map keyed by job). */
export function reserveVram(jobId: string, modelId: string, vramMb: number): void {
  reservations().set(jobId, { jobId, modelId, vramMb, reservedAt: Date.now() })
  logger.info('engine.vram_reserved', { jobId, modelId, vramMb })
}

export function releaseVram(jobId: string): void {
  if (reservations().delete(jobId)) {
    logger.info('engine.vram_released', { jobId })
  }
}

/** Reap reservations of finished/failed jobs (safety net for lost releases). */
export function reapStaleReservations(maxAgeMs = 30 * 60_000): void {
  const now = Date.now()
  for (const [k, r] of reservations()) {
    if (now - r.reservedAt > maxAgeMs) reservations().delete(k)
  }
}
