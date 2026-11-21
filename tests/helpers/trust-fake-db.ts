/**
 * Test helper — in-memory fake Prisma delegate for the Trust Engine tables.
 *
 * Mirrors only the operations the trust library uses (create / findUnique /
 * findMany / count / update / updateMany with the {in,lt,lte,gt,gte} +
 * OR operators) over plain row arrays. Matches the repo's existing fake-db
 * test idiom (see tests/unit/zero-downtime-quota.test.ts).
 */

export interface FakeRow extends Record<string, unknown> {
  id: string
  createdAt: Date
  updatedAt: Date
}

let counter = 0

function nowish(): Date {
  return new Date()
}

type WhereValue = unknown

function matchesValue(rowValue: unknown, cond: WhereValue): boolean {
  if (
    cond !== null &&
    typeof cond === 'object' &&
    !Array.isArray(cond) &&
    !(cond instanceof Date)
  ) {
    const op = cond as Record<string, unknown>
    if ('in' in op) return (op.in as unknown[]).some((v) => same(rowValue, v))
    if ('lt' in op) return compare(rowValue, op.lt) < 0
    if ('lte' in op) return compare(rowValue, op.lte) <= 0
    if ('gt' in op) return compare(rowValue, op.gt) > 0
    if ('gte' in op) return compare(rowValue, op.gte) >= 0
    if ('not' in op) return !same(rowValue, op.not)
    return false
  }
  return same(rowValue, cond)
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a === null && b === null) return true
  return a === b
}

function compare(a: unknown, b: unknown): number {
  const av = a instanceof Date ? a.getTime() : (a as number)
  const bv = b instanceof Date ? b.getTime() : (b as number)
  return av < bv ? -1 : av > bv ? 1 : 0
}

export type FakeWhere = Record<string, unknown>

export function matchesWhere(row: FakeRow, where: FakeWhere | undefined): boolean {
  if (!where) return true
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      const subs = cond as FakeWhere[]
      if (!subs.some((sub) => matchesWhere(row, sub))) return false
      continue
    }
    if (key === 'AND') {
      const subs = cond as FakeWhere[]
      if (!subs.every((sub) => matchesWhere(row, sub))) return false
      continue
    }
    if (key.includes('_')) {
      // composite unique, e.g. taskId_seq: { taskId, seq }
      const parts = key.split('_')
      const sub = cond as Record<string, unknown>
      for (const p of parts) {
        if (!matchesValue(row[p], sub[p])) return false
      }
      continue
    }
    if (!matchesValue(row[key], cond)) return false
  }
  return true
}

export class FakeTable<T extends FakeRow> {
  rows: T[] = []
  /** Optional relation resolver for prisma-style `include` (used by trustTask). */
  resolveRelations?: (row: T, include: Record<string, unknown>) => T
  constructor(private readonly defaults: () => Partial<T> = () => ({})) {}

  async create({ data }: { data: Record<string, unknown> }): Promise<T> {
    counter += 1
    const row = {
      id: `trustfake_${counter.toString(36)}`,
      createdAt: nowish(),
      updatedAt: nowish(),
      ...this.defaults(),
      ...data,
    } as T
    this.rows.push(row)
    return row
  }

  async findUnique(args: { where: FakeWhere; include?: Record<string, unknown> }): Promise<T | null> {
    const row = this.rows.find((r) => matchesWhere(r, args.where)) ?? null
    if (!row) return null
    if (args.include && this.resolveRelations) return this.resolveRelations(row, args.include)
    return row
  }

  async findFirst(args: { where?: FakeWhere; orderBy?: Record<string, 'asc' | 'desc'> }): Promise<T | null> {
    const found = this.rows.filter((r) => matchesWhere(r, args.where))
    const orderBy = args.orderBy
    if (orderBy) {
      const [key, dir] = Object.entries(orderBy)[0]
      found.sort((a, b) => {
        const av = a[key]
        const bv = b[key]
        const c = compare(av, bv)
        return dir === 'desc' ? -c : c
      })
    }
    return found[0] ?? null
  }

  async findMany(args: { where?: FakeWhere; orderBy?: Record<string, 'asc' | 'desc'>; take?: number }): Promise<T[]> {
    const found = this.rows.filter((r) => matchesWhere(r, args.where))
    const orderBy = args.orderBy
    if (orderBy) {
      const [key, dir] = Object.entries(orderBy)[0]
      found.sort((a, b) => {
        const av = a[key]
        const bv = b[key]
        const c = compare(av, bv)
        return dir === 'desc' ? -c : c
      })
    }
    return typeof args.take === 'number' ? found.slice(0, args.take) : found
  }

  async count(args: { where?: FakeWhere }): Promise<number> {
    return this.rows.filter((r) => matchesWhere(r, args.where)).length
  }

  async update({ where, data }: { where: FakeWhere; data: Record<string, unknown> }): Promise<T | null> {
    const row = this.rows.find((r) => matchesWhere(r, where))
    if (!row) throw new Error('fake: update target not found')
    Object.assign(row, data, { updatedAt: nowish() })
    return row
  }

  async updateMany({ where, data }: { where?: FakeWhere; data: Record<string, unknown> }): Promise<{ count: number }> {
    const targets = this.rows.filter((r) => matchesWhere(r, where))
    for (const row of targets) Object.assign(row, data, { updatedAt: nowish() })
    return { count: targets.length }
  }

  reset(): void {
    this.rows = []
  }
}

export function createTrustFakeDb() {
  const trustTask = new FakeTable()
  const trustStep = new FakeTable()
  const trustEvidence = new FakeTable()
  // requestedAt has a schema-level default (@default(now())); the fake mirrors it.
  const trustApproval = new FakeTable<FakeRow>(() => ({ requestedAt: new Date() }))
  const trustCheckpoint = new FakeTable()

  const byKey = (key: string, dir: 'asc' | 'desc') => (a: FakeRow, b: FakeRow) => {
    const c = compare(a[key], b[key])
    return dir === 'desc' ? -c : c
  }
  // prisma-style include support for the task aggregate (relations sorted as
  // the library orders them: steps/checkpoints by seq, evidence by createdAt,
  // approvals by requestedAt — all ascending).
  trustTask.resolveRelations = (row, include) => {
    const resolved: Record<string, unknown> = {}
    if ('steps' in include) resolved.steps = trustStep.rows.filter((r) => r.taskId === row.id).sort(byKey('seq', 'asc'))
    if ('evidence' in include) resolved.evidence = trustEvidence.rows.filter((r) => r.taskId === row.id).sort(byKey('createdAt', 'asc'))
    if ('approvals' in include) resolved.approvals = trustApproval.rows.filter((r) => r.taskId === row.id).sort(byKey('requestedAt', 'asc'))
    if ('checkpoints' in include) resolved.checkpoints = trustCheckpoint.rows.filter((r) => r.taskId === row.id).sort(byKey('seq', 'asc'))
    return { ...row, ...resolved }
  }

  const fakeDb = { trustTask, trustStep, trustEvidence, trustApproval, trustCheckpoint }
  const reset = () => {
    for (const t of Object.values(fakeDb)) t.reset()
  }
  return { fakeDb, reset, trustTask, trustStep, trustEvidence, trustApproval, trustCheckpoint }
}
