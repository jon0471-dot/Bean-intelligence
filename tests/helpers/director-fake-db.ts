/**
 * Test helper — in-memory fake Prisma delegates for the JAZMII Auto Director
 * worker tests. Composes the Trust Engine tables (trust-fake-db idiom) with
 * generationJob / jazmiiProduction / jazmiiScene / usageRecord delegates and
 * the prisma-style `include` relation the worker uses
 * (jazmiiProduction.include.scenes ordered by idx).
 */
import { FakeTable, type FakeRow, type FakeWhere } from './trust-fake-db'

export { FakeTable }
export type { FakeRow, FakeWhere }

function compare(a: unknown, b: unknown): number {
  const av = a instanceof Date ? a.getTime() : (a as number)
  const bv = b instanceof Date ? b.getTime() : (b as number)
  return av < bv ? -1 : av > bv ? 1 : 0
}

export interface DirectorFakeDb {
  fakeDb: Record<string, FakeTable<FakeRow>>
  reset: () => void
  generationJob: FakeTable<FakeRow>
  jazmiiProduction: FakeTable<FakeRow>
  jazmiiScene: FakeTable<FakeRow>
  usageRecord: FakeTable<FakeRow>
  trustTask: FakeTable<FakeRow>
  trustStep: FakeTable<FakeRow>
  trustEvidence: FakeTable<FakeRow>
  trustApproval: FakeTable<FakeRow>
  trustCheckpoint: FakeTable<FakeRow>
}

export function createDirectorFakeDb(): DirectorFakeDb {
  const generationJob = new FakeTable<FakeRow>(() => ({ queuedAt: new Date(), attempts: 0, maxAttempts: 2, cancelRequested: false, progress: 0 }))
  const jazmiiProduction = new FakeTable<FakeRow>(() => ({ storyboardRev: 0, progress: 0, cancelRequested: false, scenes: [] }))
  const jazmiiScene = new FakeTable<FakeRow>(() => ({ status: 'pending', attempts: 0 }))
  const usageRecord = new FakeTable<FakeRow>()
  const trustTask = new FakeTable<FakeRow>()
  const trustStep = new FakeTable<FakeRow>()
  const trustEvidence = new FakeTable<FakeRow>()
  const trustApproval = new FakeTable<FakeRow>(() => ({ requestedAt: new Date() }))
  const trustCheckpoint = new FakeTable<FakeRow>()

  const byKey = (key: string, dir: 'asc' | 'desc') => (a: FakeRow, b: FakeRow) => {
    const c = compare(a[key], b[key])
    return dir === 'desc' ? -c : c
  }
  jazmiiProduction.resolveRelations = (row, include) => {
    const resolved: Record<string, unknown> = {}
    if ('scenes' in include) {
      resolved.scenes = jazmiiScene.rows.filter((r) => r.productionId === row.id).sort(byKey('idx', 'asc'))
    }
    return { ...row, ...resolved }
  }

  const fakeDb: Record<string, FakeTable<FakeRow>> = {
    generationJob,
    jazmiiProduction,
    jazmiiScene,
    usageRecord,
    trustTask,
    trustStep,
    trustEvidence,
    trustApproval,
    trustCheckpoint,
  }
  const reset = () => {
    for (const t of Object.values(fakeDb)) t.reset()
  }
  return {
    fakeDb,
    reset,
    generationJob,
    jazmiiProduction,
    jazmiiScene,
    usageRecord,
    trustTask,
    trustStep,
    trustEvidence,
    trustApproval,
    trustCheckpoint,
  }
}
