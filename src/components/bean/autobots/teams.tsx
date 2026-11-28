'use client'

/**
 * BEAN Intelligence — M49.2 BEAN AUTOBOTS: MY TEAMS (inside the existing
 * Autobot product; no separate navigation system).
 *
 * Sections: Discover Teams (verified template catalogue), My Teams
 * (open/edit/duplicate/archive/restore/delete with real mission stats),
 * Create/Edit Team (bounded roster builder with inline agent creation,
 * responsibilities, leader, order) and the Team Workspace — objective →
 * READ-ONLY plan preview (who handles what, dependencies, parallel waves,
 * honest capability gaps) → confirmed run → REAL mission progress through
 * the existing M41 contracts.
 *
 * Honesty rules rendered here:
 *  - the plan preview comes from the server's deterministic planner — this
 *    UI never invents tasks, members or progress;
 *  - execution states come ONLY from the real mission API (polled) — no
 *    fake progress bars;
 *  - a missing team capability renders the exact refusal (which member/
 *    capability is required) instead of a silently weakened run;
 *  - the verification gate is always labeled as the platform's QUALITY gate,
 *    never as a team member's work.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Archive, Bot, Copy, Layers, Pencil, Plus, Search, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import { Spinner, beanFetch, type BeanUser } from '@/components/bean/shared'
import { cn } from '@/lib/utils'
import type { AutobotAgentView } from './index'

// ---------------------------------------------------------------------------
// Server API shapes
// ---------------------------------------------------------------------------

export interface TeamMemberView {
  id: string
  agentId: string
  agentName: string
  agentRole: string
  capabilityKey: string
  capabilityLabel: string
  responsibility: string
  orderIndex: number
  isLeader: boolean
  agentStatus: string
}

export interface TeamView {
  id: string
  name: string
  description: string
  leaderMemberId: string | null
  workflowPreference: string
  assignmentPreference: string
  templateKey: string | null
  status: string
  members: TeamMemberView[]
  stats: {
    completedMissions: number
    lastMissionAt: string | null
    activeMissionId: string | null
  }
  createdAt: string
  updatedAt: string
}

interface TeamCatalogMember {
  agentTemplateKey: string
  agentName: string
  agentRole: string
  capabilityKey: string
  responsibility: string
}

interface TeamCatalogTemplate {
  key: string
  name: string
  description: string
  category: string
  workflowPreference: string
  limitations: string
  members: TeamCatalogMember[]
  requiredCapabilities: string[]
}

interface TeamCatalogData {
  limits: {
    nameChars: number
    descriptionChars: number
    responsibilityChars: number
    minMembers: number
    maxMembers: number
    maxTeamsPerUser: number
  }
  workflowPreferences: Array<{ id: string; label: string }>
  assignmentPreferences: string[]
  assignableCapabilities: Array<{ id: string; label: string; underlying: string; limits: string }>
  qualityGate: { id: string; label: string }
  taskKindCapabilities: Array<{ kind: string; requiredCapability: string }>
  templates: TeamCatalogTemplate[]
}

export interface PlanPreview {
  ok: boolean
  reason: string | null
  missionType: string | null
  detected: string[]
  deliverableTaskId: string | null
  tasks: Array<{
    taskId: string
    kind: string
    title: string
    dependsOn: string[]
    objective: string
    expectedOutput: string
    assignedMember: { memberId: string; agentId: string; agentName: string; capabilityKey: string; responsibility: string; isLeader: boolean } | null
    platformGate: boolean
  }>
  gaps: Array<{ taskId: string; kind: string; requiredCapability: string; message: string }>
  workflowPreference: string
}

export interface TeamMissionView {
  missionId: string
  missionType: string
  status: string
  objective: string
  outcomeSummary: string | null
  failureNote: string | null
  createdAt: string
  finishedAt: string | null
  tasks: Array<{
    taskId: string
    kind: string
    title: string
    status: string
    dependsOn: string[]
    attempts: number
    failureNote: string | null
    verificationOutcome: string | null
    assignedMember: { agentName: string; agentRole: string; capabilityKey: string; isLeader: boolean } | null
    platformGate: boolean
    artifacts: Array<{ artifact: string; ref: string; label: string }>
  }>
}

type TeamsSection = 'catalog' | 'mine' | 'create' | 'workspace'

// ---------------------------------------------------------------------------
// Roster form state
// ---------------------------------------------------------------------------

interface RosterMember {
  agentId: string
  responsibility: string
}

interface TeamFormState {
  name: string
  description: string
  workflowPreference: string
  assignmentPreference: string
  leaderAgentId: string | null
  members: RosterMember[]
}

const EMPTY_TEAM_FORM: TeamFormState = {
  name: '',
  description: '',
  workflowPreference: 'auto',
  assignmentPreference: 'team-order',
  leaderAgentId: null,
  members: [],
}

const ACTIVE_STATUSES = new Set(['planned', 'running'])

function statusChipClass(status: string): string {
  if (status === 'done' || status === 'completed') return 'border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-200/85'
  if (status === 'failed') return 'border-red-400/25 bg-red-400/[0.07] text-red-200/85'
  if (status === 'running') return 'border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.08)] text-[#f0c75e]'
  if (status === 'skipped' || status === 'cancelled') return 'border-white/10 bg-white/[0.03] text-white/40'
  return 'border-white/10 bg-white/[0.03] text-white/50'
}

function missionStatusChip(status: string): string {
  if (status === 'completed') return 'border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-200/85'
  if (status === 'completed_partial') return 'border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.08)] text-[#f0c75e]'
  if (status === 'failed' || status === 'cancelled') return 'border-red-400/25 bg-red-400/[0.07] text-red-200/85'
  return 'border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.08)] text-[#f0c75e]'
}

/** Parallel waves: deterministic depth levels over the plan's dependency
 *  edges (pure client-side derivation from the SERVER plan — same-task
 *  depth ⇒ the existing scheduler may run them concurrently). */
function parallelWaves(tasks: PlanPreview['tasks']): Map<string, number> {
  const byId = new Map(tasks.map((t) => [t.taskId, t]))
  const depth = new Map<string, number>()
  const depthOf = (id: string): number => {
    const cached = depth.get(id)
    if (cached !== undefined) return cached
    const t = byId.get(id)
    if (!t) return 0
    const d = t.dependsOn.length === 0 ? 0 : Math.max(...t.dependsOn.map((dep) => depthOf(dep) + 1))
    depth.set(id, d)
    return d
  }
  for (const t of tasks) depthOf(t.taskId)
  return depth
}

/** Where an artifact opens: direct URLs open as-is; ids navigate to the
 *  owning product surface (through the EXISTING shell navigation). */
function artifactTarget(a: { artifact: string; ref: string }): { kind: 'url' | 'view'; target: string } {
  const isUrl = /^https?:\/\//.test(a.ref)
  if (isUrl) return { kind: 'url', target: a.ref }
  const viewByArtifact: Record<string, string> = {
    'code-project': 'code-giftz',
    'image-asset': 'laxii',
    'video-asset': 'jazmii',
    'audio-asset': 'gangzii',
    'research-pack': 'riishe',
  }
  return { kind: 'view', target: viewByArtifact[a.artifact] ?? 'tasks' }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TeamsView({
  user,
  agents,
  refreshAgents,
  onNavigate,
}: {
  user: BeanUser
  agents: AutobotAgentView[]
  refreshAgents: () => Promise<void>
  onNavigate: (view: string) => void
}) {
  const [section, setSection] = useState<TeamsSection>('catalog')
  const [catalog, setCatalog] = useState<TeamCatalogData | null>(null)
  const [teams, setTeams] = useState<TeamView[]>([])
  const [activeTeam, setActiveTeam] = useState<TeamView | null>(null)
  const [form, setForm] = useState<TeamFormState>(EMPTY_TEAM_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formTemplateKey, setFormTemplateKey] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [objective, setObjective] = useState('')
  const [plan, setPlan] = useState<PlanPreview | null>(null)
  const [planning, setPlanning] = useState(false)
  const [running, setRunning] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [missions, setMissions] = useState<TeamMissionView[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshTeams = useCallback(async () => {
    try {
      const d = await beanFetch<{ teams: TeamView[] }>('/api/autobots/teams', { timeoutMs: 20_000 })
      setTeams(d.teams)
      setListError(null)
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Could not load your teams.')
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const d = await beanFetch<TeamCatalogData>('/api/autobots/teams/catalog', { timeoutMs: 20_000 })
        setCatalog(d)
      } catch (e) {
        setListError(e instanceof Error ? e.message : 'Could not load the team catalogue.')
      }
    })()
    void refreshTeams()
  }, [refreshTeams])

  const refreshActiveTeam = useCallback(async (id: string) => {
    try {
      const d = await beanFetch<{ team: TeamView }>(`/api/autobots/teams/${id}`, { timeoutMs: 20_000 })
      setActiveTeam(d.team)
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Could not load the team.')
    }
  }, [])

  const refreshMissions = useCallback(async (teamId: string) => {
    try {
      const d = await beanFetch<{ missions: TeamMissionView[] }>(`/api/autobots/teams/${teamId}/missions?take=5`, { timeoutMs: 20_000 })
      setMissions(d.missions)
    } catch {
      // transient poll failures are silent; the next tick retries
    }
  }, [])

  // Poll while a mission is planned/running — states come ONLY from the
  // server; there is no client-side progress simulation.
  useEffect(() => {
    if (!activeTeam) return
    const active = missions.some((m) => ACTIVE_STATUSES.has(m.status))
    if (!active) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }
    if (!pollRef.current) {
      pollRef.current = setInterval(() => void refreshMissions(activeTeam.id), 4_000)
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [activeTeam, missions, refreshMissions])

  const openWorkspace = useCallback(async (team: TeamView) => {
    setActiveTeam(team)
    setPlan(null)
    setObjective('')
    setWorkspaceError(null)
    setMissions([])
    setSection('workspace')
    void refreshActiveTeam(team.id)
    void refreshMissions(team.id)
  }, [refreshActiveTeam, refreshMissions])

  const openCreateFromTemplate = async (template: CatalogTemplateExt) => {
    if (template.memberSpecsEmpty) {
      setEditingId(null)
      setFormTemplateKey(null)
      setForm(EMPTY_TEAM_FORM)
      setFormError(null)
      setSection('create')
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      const d = await beanFetch<{ team: TeamView }>('/api/autobots/teams', {
        method: 'POST',
        json: { templateKey: template.key },
        timeoutMs: 30_000,
      })
      void refreshTeams()
      void refreshAgents()
      await openWorkspace(d.team)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not create the team.')
      setListError(e instanceof Error ? e.message : null)
    } finally {
      setBusy(false)
    }
  }

  const openEdit = (team: TeamView) => {
    setEditingId(team.id)
    setFormTemplateKey(team.templateKey)
    setFormError(null)
    setForm({
      name: team.name,
      description: team.description,
      workflowPreference: team.workflowPreference,
      assignmentPreference: team.assignmentPreference,
      leaderAgentId: team.members.find((m) => m.isLeader)?.agentId ?? null,
      members: team.members.map((m) => ({ agentId: m.agentId, responsibility: m.responsibility })),
    })
    setSection('create')
  }

  const submitForm = async () => {
    setBusy(true)
    setFormError(null)
    try {
      const payload = {
        name: form.name,
        description: form.description || undefined,
        workflowPreference: form.workflowPreference,
        assignmentPreference: form.assignmentPreference,
        leaderAgentId: form.leaderAgentId ?? undefined,
        members: form.members,
      }
      if (editingId) {
        const d = await beanFetch<{ team: TeamView }>(`/api/autobots/teams/${editingId}`, {
          method: 'PATCH',
          json: payload,
          timeoutMs: 20_000,
        })
        setActiveTeam(d.team)
        setSection('mine')
        void refreshTeams()
      } else {
        const d = await beanFetch<{ team: TeamView }>('/api/autobots/teams', {
          method: 'POST',
          json: payload,
          timeoutMs: 20_000,
        })
        void refreshTeams()
        await openWorkspace(d.team)
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save the team.')
    } finally {
      setBusy(false)
    }
  }

  const teamAction = async (id: string, action: 'duplicate' | 'archive' | 'restore' | 'delete') => {
    setBusy(true)
    setListError(null)
    try {
      if (action === 'duplicate') {
        await beanFetch(`/api/autobots/teams/${id}/duplicate`, { method: 'POST', timeoutMs: 20_000 })
      } else if (action === 'delete') {
        await beanFetch(`/api/autobots/teams/${id}`, { method: 'DELETE', timeoutMs: 20_000 })
        if (activeTeam?.id === id) {
          setActiveTeam(null)
          setSection('catalog')
        }
      } else {
        await beanFetch(`/api/autobots/teams/${id}`, {
          method: 'PATCH',
          json: { status: action === 'archive' ? 'archived' : 'active' },
          timeoutMs: 20_000,
        })
      }
      void refreshTeams()
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'The action failed.')
    } finally {
      setBusy(false)
    }
  }

  // ---- Roster editing helpers ---------------------------------------------
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const addableAgents = useMemo(
    () => agents.filter((a) => a.status === 'active' && !form.members.some((m) => m.agentId === a.id)),
    [agents, form.members],
  )

  const addMember = (agentId: string) => {
    if (!agentId || form.members.length >= (catalog?.limits.maxMembers ?? 8)) return
    setForm((f) => ({
      ...f,
      members: [...f.members, { agentId, responsibility: agentById.get(agentId)?.role ?? '' }],
    }))
  }

  const quickCreateAgent = async (quick: { name: string; role: string; description: string; capabilityKey: string }) => {
    const d = await beanFetch<{ agent: AutobotAgentView }>('/api/autobots/agents', {
      method: 'POST',
      json: quick,
      timeoutMs: 20_000,
    })
    await refreshAgents()
    return d.agent
  }

  const moveMember = (index: number, dir: -1 | 1) => {
    setForm((f) => {
      const members = [...f.members]
      const target = index + dir
      if (target < 0 || target >= members.length) return f
      const swapped = [...members]
      ;[swapped[index], swapped[target]] = [swapped[target], swapped[index]]
      return { ...f, members: swapped }
    })
  }

  if (!catalog) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-3">
        {listError ? (
          <div className="text-[13px] text-red-200/80">{listError}</div>
        ) : (
          <Spinner className="h-5 w-5" />
        )}
      </div>
    )
  }

  // ---- Team Workspace -------------------------------------------------------
  if (section === 'workspace' && activeTeam) {
    return (
      <TeamWorkspace
        team={activeTeam}
        catalog={catalog}
        objective={objective}
        onObjectiveChange={setObjective}
        plan={plan}
        planning={planning}
        running={running}
        error={workspaceError}
        missions={missions}
        onBack={() => {
          setActiveTeam(null)
          setSection('mine')
          void refreshTeams()
        }}
        onPlan={async () => {
          setPlanning(true)
          setWorkspaceError(null)
          setPlan(null)
          try {
            const d = await beanFetch<{ plan: PlanPreview }>(`/api/autobots/teams/${activeTeam.id}/plan`, {
              method: 'POST',
              json: { objective },
              timeoutMs: 30_000,
            })
            setPlan(d.plan)
            if (!d.plan.ok) setWorkspaceError(d.plan.gaps.map((g) => g.message).join(' '))
          } catch (e) {
            setWorkspaceError(e instanceof Error ? e.message : 'The plan preview failed.')
          } finally {
            setPlanning(false)
          }
        }}
        onRun={async () => {
          setRunning(true)
          setWorkspaceError(null)
          try {
            const d = await beanFetch<{ missionId: string }>(`/api/autobots/teams/${activeTeam.id}/run`, {
              method: 'POST',
              json: { objective },
              timeoutMs: 30_000,
            })
            setPlan(null)
            setObjective('')
            await refreshMissions(activeTeam.id)
            await refreshActiveTeam(activeTeam.id)
            void refreshTeams()
            void d
          } catch (e) {
            setWorkspaceError(e instanceof Error ? e.message : 'The mission could not be started.')
          } finally {
            setRunning(false)
          }
        }}
        onNavigate={onNavigate}
      />
    )
  }

  // ---- Create / Edit ----------------------------------------------------------
  if (section === 'create') {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <button
          onClick={() => setSection(editingId ? 'mine' : 'catalog')}
          className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-white/45 transition-colors hover:text-white/80"
        >
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
        <h1 className="text-lg font-semibold text-white/92">{editingId ? 'Edit team' : 'Create team'}</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-white/45">
          A team is a composition of YOUR agents. Responsibilities and names are descriptive data — they never grant
          tools or permissions. Missions run through BEAN&apos;s existing mission engine with the platform&apos;s
          independent verification gate.
        </p>

        <div className="mt-5 space-y-4 rounded-xl border border-[rgba(212,175,55,0.14)] bg-white/[0.04] p-5">
          <Field label={`Team name (max ${catalog.limits.nameChars})`} required>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              maxLength={catalog.limits.nameChars}
              className="bean-input w-full"
              placeholder="e.g. Product Launch Squad"
            />
          </Field>
          <Field label={`Description (max ${catalog.limits.descriptionChars})`}>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              maxLength={catalog.limits.descriptionChars}
              rows={2}
              className="bean-input w-full resize-y"
              placeholder="What this team works on together"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Workflow preference (descriptive)">
              <select
                value={form.workflowPreference}
                onChange={(e) => setForm((f) => ({ ...f, workflowPreference: e.target.value }))}
                className="bean-input w-full"
              >
                {catalog.workflowPreferences.map((p) => (
                  <option key={p.id} value={p.id} className="bg-[#0d0d10]">{p.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Assignment rule (deterministic)">
              <select
                value={form.assignmentPreference}
                onChange={(e) => setForm((f) => ({ ...f, assignmentPreference: e.target.value }))}
                className="bean-input w-full"
              >
                <option value="team-order" className="bg-[#0d0d10]">Team order — first eligible member in saved order</option>
                <option value="leader-first" className="bg-[#0d0d10]">Leader first — the leader takes eligible tasks first</option>
              </select>
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-white/40">
                Members ({form.members.length}/{catalog.limits.maxMembers}) — {catalog.limits.minMembers} minimum
              </span>
            </div>
            <div className="space-y-2">
              {form.members.map((m, i) => {
                const agent = agentById.get(m.agentId)
                const isLeader = form.leaderAgentId === m.agentId || (form.members.length > 0 && !form.leaderAgentId && i === 0)
                return (
                  <div key={m.agentId} className={cn('rounded-lg border p-3', isLeader ? 'border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.05)]' : 'border-white/[0.08] bg-white/[0.02]')}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-white/85">{agent?.name ?? m.agentId}</span>
                          {isLeader && <span className="rounded border border-[rgba(212,175,55,0.3)] px-1.5 py-0.5 text-[10px] text-[#f0c75e]">Leader</span>}
                          <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/45">
                            {agent?.capabilityLabel ?? agent?.capabilityKey ?? 'agent'}
                          </span>
                        </div>
                        {agent && <div className="mt-0.5 text-[11.5px] text-white/40">{agent.role}</div>}
                      </div>
                      <div className="flex items-center gap-1">
                        {isLeader ? (
                          <button onClick={() => setForm((f) => ({ ...f, leaderAgentId: null }))} className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/50 hover:bg-white/5">
                            Unset leader
                          </button>
                        ) : (
                          <button onClick={() => setForm((f) => ({ ...f, leaderAgentId: m.agentId }))} className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/50 hover:bg-white/5">
                            Make leader
                          </button>
                        )}
                        <button onClick={() => moveMember(i, -1)} disabled={i === 0} className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/50 hover:bg-white/5 disabled:opacity-30">↑</button>
                        <button onClick={() => moveMember(i, 1)} disabled={i === form.members.length - 1} className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/50 hover:bg-white/5 disabled:opacity-30">↓</button>
                        <button
                          onClick={() => setForm((f) => ({ ...f, members: f.members.filter((mm) => mm.agentId !== m.agentId) }))}
                          className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-red-200/70 hover:bg-red-400/10"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <input
                      value={m.responsibility}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          members: f.members.map((mm) => (mm.agentId === m.agentId ? { ...mm, responsibility: e.target.value } : mm)),
                        }))
                      }
                      maxLength={catalog.limits.responsibilityChars}
                      className="bean-input mt-2 w-full text-[12px]"
                      placeholder="Responsibility on this team (descriptive — never grants permissions)"
                    />
                  </div>
                )
              })}
              {form.members.length === 0 && (
                <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-[12px] text-white/40">
                  Add at least {catalog.limits.minMembers} active agents from your roster below.
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <select
                value=""
                onChange={(e) => addMember(e.target.value)}
                className="bean-input w-full sm:max-w-xs"
                aria-label="Add a member from My Agents"
              >
                <option value="" className="bg-[#0d0d10]">Add from My Agents…</option>
                {addableAgents.map((a) => (
                  <option key={a.id} value={a.id} className="bg-[#0d0d10]">{a.name} — {a.capabilityLabel}</option>
                ))}
              </select>
              <QuickCreateAgent onCreated={addMember} onCreate={quickCreateAgent} />
            </div>
            {form.members.length > 0 && addableAgents.length === 0 && (
              <div className="mt-1 text-[11px] text-white/35">Every active agent is already on the team.</div>
            )}
          </div>

          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-[11.5px] leading-relaxed text-white/45">
            Verification gate: {catalog.qualityGate.label}. The gate cannot be disabled, replaced or captured by any
            team configuration — team missions always end with the platform&apos;s independent verification.
          </div>

          {formError && (
            <div className="rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[12.5px] text-red-200/90">
              {formError}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={() => void submitForm()}
              disabled={busy || !form.name.trim() || form.members.length < catalog.limits.minMembers}
              className="inline-flex items-center gap-2 rounded-lg bg-[rgba(212,175,55,0.16)] px-4 py-2 text-[13px] font-medium text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.28)] transition-colors hover:bg-[rgba(212,175,55,0.24)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? <Spinner className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
              {editingId ? 'Save changes' : 'Create team'}
            </button>
            <span className="text-[11.5px] text-white/35">
              {catalog.limits.maxTeamsPerUser} teams max per account · owner-scoped and private
            </span>
          </div>
        </div>
      </div>
    )
  }

  // ---- Discover Teams ---------------------------------------------------------
  if (section === 'catalog') {
    return <TeamCatalogView catalog={catalog} onUseTemplate={(t) => void openCreateFromTemplate(t)} onGoMine={() => { setSection('mine'); void refreshTeams() }} mineCount={teams.length} error={formError ?? listError} />
  }

  // ---- My Teams -----------------------------------------------------------------
  const active = teams.filter((t) => t.status === 'active')
  const archived = teams.filter((t) => t.status === 'archived')
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white/92">My teams</h1>
          <p className="mt-0.5 text-[12.5px] text-white/45">
            {active.length} active{archived.length > 0 ? ` · ${archived.length} archived` : ''} · private to {user.email}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSection('catalog')}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-[12.5px] text-white/65 transition-colors hover:bg-white/5 hover:text-white/90"
          >
            Discover teams
          </button>
          <button
            onClick={() => { setEditingId(null); setFormTemplateKey(null); setForm(EMPTY_TEAM_FORM); setFormError(null); setSection('create') }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[rgba(212,175,55,0.16)] px-3 py-1.5 text-[12.5px] font-medium text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.28)] transition-colors hover:bg-[rgba(212,175,55,0.24)]"
          >
            <Plus className="h-3.5 w-3.5" /> New team
          </button>
        </div>
      </div>

      {listError && (
        <div className="mt-4 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[12.5px] text-red-200/90">
          {listError}
        </div>
      )}

      {teams.length === 0 ? (
        <div className="mt-10 flex flex-col items-center justify-center rounded-xl border border-dashed border-[rgba(212,175,55,0.2)] py-14 text-center">
          <Layers className="mb-3 h-10 w-10 text-white/25" />
          <div className="text-[14px] font-medium text-white/75">No teams yet</div>
          <div className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-white/45">
            Assemble your agents into a team — pick a verified template or compose your own. Missions always run through
            the real mission engine.
          </div>
          <button
            onClick={() => setSection('catalog')}
            className="mt-4 rounded-lg bg-[rgba(212,175,55,0.16)] px-4 py-2 text-[12.5px] font-medium text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.28)] transition-colors hover:bg-[rgba(212,175,55,0.24)]"
          >
            Browse team templates
          </button>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {[...active, ...archived].map((t) => (
            <div
              key={t.id}
              className={cn(
                'rounded-xl border bg-white/[0.04] p-4',
                t.status === 'archived' ? 'border-white/[0.06] opacity-70' : 'border-[rgba(212,175,55,0.14)]',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium text-white/88">{t.name}</span>
                    {t.status === 'archived' && (
                      <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/40">Archived</span>
                    )}
                    {t.templateKey && (
                      <span className="rounded border border-[rgba(212,175,55,0.2)] bg-[rgba(212,175,55,0.08)] px-1.5 py-0.5 text-[10px] text-[#f0c75e]/80">Template</span>
                    )}
                    {t.stats.activeMissionId && (
                      <span className="rounded border border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.08)] px-1.5 py-0.5 text-[10px] text-[#f0c75e]">Mission in progress</span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 max-w-xl text-[12.5px] leading-relaxed text-white/55">{t.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {t.members.map((m) => (
                      <span key={m.id} className="rounded-full border border-white/[0.08] bg-white/[0.02] px-2 py-0.5 text-[10.5px] text-white/55">
                        {m.isLeader ? '★ ' : ''}{m.agentName} · {m.capabilityLabel}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1.5 text-[11px] text-white/30">
                    {t.stats.completedMissions} delivered mission{t.stats.completedMissions === 1 ? '' : 's'}
                    {t.stats.lastMissionAt ? ` · last ran ${new Date(t.stats.lastMissionAt).toLocaleString()}` : ' · never executed yet'}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {t.status === 'active' && (
                    <button
                      onClick={() => void openWorkspace(t)}
                      className="rounded-lg bg-[rgba(212,175,55,0.16)] px-3 py-1.5 text-[12px] font-medium text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.28)] transition-colors hover:bg-[rgba(212,175,55,0.24)]"
                    >
                      Open
                    </button>
                  )}
                  <IconButton label="Edit" onClick={() => openEdit(t)}><Pencil className="h-3.5 w-3.5" /></IconButton>
                  <IconButton label="Duplicate" onClick={() => void teamAction(t.id, 'duplicate')} disabled={busy}><Copy className="h-3.5 w-3.5" /></IconButton>
                  {t.status === 'active' ? (
                    <IconButton label="Archive" onClick={() => void teamAction(t.id, 'archive')} disabled={busy}><Archive className="h-3.5 w-3.5" /></IconButton>
                  ) : (
                    <IconButton label="Restore" onClick={() => void teamAction(t.id, 'restore')} disabled={busy}><Undo2 className="h-3.5 w-3.5" /></IconButton>
                  )}
                  <IconButton label="Delete" onClick={() => void teamAction(t.id, 'delete')} disabled={busy} danger><Trash2 className="h-3.5 w-3.5" /></IconButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Team catalogue (Discover Teams)
// ---------------------------------------------------------------------------

interface CatalogTemplateExt extends TeamCatalogTemplate {
  memberSpecsEmpty?: boolean
}

function TeamCatalogView({
  catalog,
  onUseTemplate,
  onGoMine,
  mineCount,
  error,
}: {
  catalog: TeamCatalogData
  onUseTemplate: (t: CatalogTemplateExt) => void
  onGoMine: () => void
  mineCount: number
  error: string | null
}) {
  const [query, setQuery] = useState('')
  const filtered = catalog.templates.filter((t) => {
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()
    return (
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q) ||
      t.members.some((m) => m.agentName.toLowerCase().includes(q) || m.agentRole.toLowerCase().includes(q))
    )
  })
  const capLabel = (id: string) => catalog.assignableCapabilities.find((c) => c.id === id)?.label ?? id

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="rounded-xl border border-[rgba(212,175,55,0.14)] bg-gradient-to-b from-[rgba(212,175,55,0.08)] to-transparent p-6">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#f0c75e]/75">
          <Layers className="h-4 w-4" /> AUTOBOT TEAMS
        </div>
        <h1 className="mt-2 text-xl font-semibold leading-snug text-white/92 sm:text-2xl">
          Your AI teams — <span className="bean-gold-text">coordinated work, verified results</span>
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/55">
          Assemble your agents into teams, give the team an objective, and watch the members collaborate through
          BEAN&apos;s real mission engine — structured handoffs, verified outputs and honest statuses. Team
          collaboration is coordinated execution, never free-form agent chat.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={onGoMine}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-[12.5px] text-white/70 transition-colors hover:bg-white/5 hover:text-white/90"
          >
            My teams ({mineCount})
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[12.5px] text-red-200/90">
          {error}
        </div>
      )}

      <div className="mt-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teams — launch, engineering, research, video…"
            className="bean-input w-full pl-9"
            aria-label="Search team templates"
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((t) => {
          const isCustom = t.members.length === 0
          return (
            <div key={t.key} className="flex flex-col rounded-xl border border-[rgba(212,175,55,0.12)] bg-white/[0.04] p-4 transition-colors hover:border-[rgba(212,175,55,0.28)]">
              <div className="flex items-start justify-between gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(212,175,55,0.12)] text-[#f0c75e]">
                  <Layers className="h-5 w-5" />
                </div>
                <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/35">
                  {t.category}
                </span>
              </div>
              <div className="mt-2.5 text-[14px] font-medium text-white/88">{t.name}</div>
              <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-relaxed text-white/55">{t.description}</p>
              <div className="mt-2.5 flex flex-wrap gap-1">
                {t.requiredCapabilities.map((c) => (
                  <span key={c} className="rounded border border-[rgba(212,175,55,0.2)] bg-[rgba(212,175,55,0.06)] px-1.5 py-0.5 text-[10px] text-[#f0c75e]/80">
                    {capLabel(c)}
                  </span>
                ))}
                {isCustom && <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/45">Your roster</span>}
              </div>
              {!isCustom && (
                <div className="mt-2 space-y-1">
                  {t.members.slice(0, 5).map((m) => (
                    <div key={m.agentTemplateKey} className="text-[11px] text-white/40">
                      · {m.agentName} <span className="text-white/30">— {m.responsibility.length > 64 ? `${m.responsibility.slice(0, 64)}…` : m.responsibility}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 text-[11px] leading-relaxed text-white/35">
                <span className="text-white/45">Limits: </span>{t.limitations.length > 140 ? `${t.limitations.slice(0, 140)}…` : t.limitations}
              </div>
              <button
                onClick={() => onUseTemplate({ ...t, memberSpecsEmpty: isCustom })}
                className="mt-3 w-full rounded-lg bg-[rgba(212,175,55,0.16)] py-1.5 text-[12.5px] font-medium text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.28)] transition-colors hover:bg-[rgba(212,175,55,0.24)]"
              >
                {isCustom ? 'Build a custom team' : 'Use this template'}
              </button>
            </div>
          )
        })}
      </div>
      {filtered.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-white/10 py-10 text-center text-[13px] text-white/45">
          No team templates match that search — you can still compose a fully custom team.
        </div>
      )}

      <div className="mt-6 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-[11.5px] leading-relaxed text-white/45">
        Team missions run through BEAN&apos;s existing mission engine: the deterministic planner decomposes the
        objective, tasks are assigned to members whose REAL capability matches, and every mission ends with the
        platform&apos;s independent QUALITY verification gate — {catalog.qualityGate.label}. A team lacking a required
        capability is told you exactly what is missing rather than substituting quietly.
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Team workspace (objective → plan preview → run → real progress)
// ---------------------------------------------------------------------------

function TeamWorkspace({
  team,
  catalog,
  objective,
  onObjectiveChange,
  plan,
  planning,
  running,
  error,
  missions,
  onBack,
  onPlan,
  onRun,
  onNavigate,
}: {
  team: TeamView
  catalog: TeamCatalogData
  objective: string
  onObjectiveChange: (v: string) => void
  plan: PlanPreview | null
  planning: boolean
  running: boolean
  error: string | null
  missions: TeamMissionView[]
  onBack: () => void
  onPlan: () => Promise<void>
  onRun: () => Promise<void>
  onNavigate: (view: string) => void
}) {
  const waves = plan ? parallelWaves(plan.tasks) : new Map<string, number>()
  const activeMission = missions.find((m) => ACTIVE_STATUSES.has(m.status))
  const latestMission = missions[0] ?? null
  const capLabel = (id: string) => catalog.assignableCapabilities.find((c) => c.id === id)?.label ?? id
  const minChars = 12
  const maxChars = 4000

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-white/45 transition-colors hover:text-white/80"
      >
        <X className="h-3.5 w-3.5" /> Close workspace
      </button>

      <div className="rounded-xl border border-[rgba(212,175,55,0.14)] bg-white/[0.04] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-[#f0c75e]" />
            <h1 className="text-[16px] font-semibold text-white/92">{team.name}</h1>
            {team.status === 'archived' && (
              <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/40">Archived</span>
            )}
          </div>
          <div className="text-[11px] text-white/35">
            {team.stats.completedMissions} delivered · {team.members.length} members
          </div>
        </div>
        {team.description && <p className="mt-1.5 text-[12.5px] text-white/50">{team.description}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {team.members.map((m) => (
            <div key={m.id} className={cn('rounded-lg border px-2.5 py-1.5', m.isLeader ? 'border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.05)]' : 'border-white/[0.08] bg-white/[0.02]')}>
              <div className="flex items-center gap-1.5 text-[11.5px] text-white/70">
                <Bot className="h-3 w-3 text-[#f0c75e]/70" />
                {m.isLeader ? <span className="text-[#f0c75e]">★</span> : null}
                <span className="font-medium">{m.agentName}</span>
                <span className="text-white/35">·</span>
                <span className="text-white/45">{m.capabilityLabel}</span>
              </div>
              {m.responsibility && <div className="mt-0.5 max-w-[260px] text-[10.5px] leading-snug text-white/35">{m.responsibility}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Objective + plan */}
      <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/40">
          Team objective (min {minChars} — e.g. &quot;Research the market for a productivity app, write the strategy, create a brand image and build its landing website&quot;)
        </label>
        <textarea
          value={objective}
          onChange={(e) => onObjectiveChange(e.target.value)}
          maxLength={maxChars}
          rows={3}
          className="bean-input w-full resize-y"
          placeholder="Describe the outcome the team should produce — the planner decomposes it into real tasks."
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void onPlan()}
            disabled={planning || objective.trim().length < minChars || team.status !== 'active' || Boolean(activeMission)}
            className="inline-flex items-center gap-2 rounded-lg border border-[rgba(212,175,55,0.28)] px-4 py-2 text-[12.5px] font-medium text-[#f0c75e] transition-colors hover:bg-[rgba(212,175,55,0.08)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {planning ? <Spinner className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
            Plan preview
          </button>
          <button
            onClick={() => void onRun()}
            disabled={running || !plan?.ok || team.status !== 'active' || Boolean(activeMission)}
            className="inline-flex items-center gap-2 rounded-lg bg-[rgba(212,175,55,0.16)] px-4 py-2 text-[12.5px] font-medium text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.28)] transition-colors hover:bg-[rgba(212,175,55,0.24)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? <Spinner className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
            Confirm &amp; run mission
          </button>
          {activeMission && (
            <span className="text-[11.5px] text-[#f0c75e]/80">A mission is in progress — watch its live status below.</span>
          )}
          {team.status === 'archived' && (
            <span className="text-[11.5px] text-red-200/80">Archived teams cannot plan or run missions.</span>
          )}
        </div>
        {error && (
          <div className="mt-3 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[12.5px] leading-relaxed text-red-200/90">
            {error}
          </div>
        )}

        {plan && (
          <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="font-medium text-white/80">Proposed plan</span>
              <span className="rounded border border-[rgba(212,175,55,0.25)] bg-[rgba(212,175,55,0.06)] px-1.5 py-0.5 text-[10.5px] text-[#f0c75e]/85">{plan.missionType}</span>
              {plan.ok ? (
                <span className="text-[11px] text-emerald-200/70">All required capabilities are covered — ready to run.</span>
              ) : (
                <span className="text-[11px] text-red-200/75">Missing capabilities — the run is refused until the roster covers them.</span>
              )}
            </div>
            {plan.detected.length > 0 && (
              <div className="mt-1.5 text-[11.5px] text-white/40">Detected: {plan.detected.join(' · ')}</div>
            )}
            <div className="mt-3 space-y-2">
              {plan.tasks.map((t) => {
                const wave = waves.get(t.taskId) ?? 0
                return (
                  <div key={t.taskId} className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-white/40">{t.taskId}</span>
                        <span className="truncate text-[12.5px] font-medium text-white/80">{t.title}</span>
                      </div>
                      {t.platformGate ? (
                        <span className="rounded border border-emerald-400/25 bg-emerald-400/[0.07] px-1.5 py-0.5 text-[10px] text-emerald-200/85">
                          {catalog.qualityGate.label}
                        </span>
                      ) : t.assignedMember ? (
                        <span className="rounded border border-[rgba(212,175,55,0.25)] bg-[rgba(212,175,55,0.06)] px-1.5 py-0.5 text-[10.5px] text-[#f0c75e]/85">
                          {t.assignedMember.isLeader ? '★ ' : ''}{t.assignedMember.agentName} · {capLabel(t.assignedMember.capabilityKey)}
                        </span>
                      ) : (
                        <span className="rounded border border-red-400/25 bg-red-400/[0.07] px-1.5 py-0.5 text-[10px] text-red-200/80">unassigned</span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10.5px] text-white/35">
                      <span>{t.kind}</span>
                      <span>· wave {wave + 1}{wave > 0 ? ' (runs after earlier waves)' : ' (starts immediately)'}</span>
                      {t.dependsOn.length > 0 && <span>· depends on {t.dependsOn.join(', ')}</span>}
                    </div>
                    {t.assignedMember?.responsibility && (
                      <div className="mt-1 text-[10.5px] text-white/40">Responsibility: {t.assignedMember.responsibility}</div>
                    )}
                  </div>
                )
              })}
            </div>
            {plan.gaps.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {plan.gaps.map((g, i) => (
                  <div key={`${g.taskId}-${i}`} className="rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[12px] leading-relaxed text-red-200/90">
                    {g.message}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 text-[10.5px] leading-relaxed text-white/30">
              The plan is produced by the deterministic mission planner — this preview creates nothing. Tasks in the
              same wave may run in parallel (bounded lanes); dependent tasks wait for VERIFIED predecessor outputs.
            </div>
          </div>
        )}
      </div>

      {/* Mission progress (real states only) */}
      {missions.length > 0 && (
        <div className="mt-4 space-y-3">
          {missions.map((m) => (
            <div key={m.missionId} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('rounded border px-2 py-0.5 text-[10.5px]', missionStatusChip(m.status))}>{m.status}</span>
                  <span className="text-[12.5px] font-medium text-white/80">{m.missionType}</span>
                </div>
                <span className="text-[10.5px] text-white/30">started {new Date(m.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-[11.5px] text-white/45">{m.objective}</p>
              {m.outcomeSummary && <p className="mt-1.5 text-[11.5px] text-emerald-200/70">{m.outcomeSummary}</p>}
              {m.failureNote && <p className="mt-1.5 text-[11.5px] text-red-200/75">{m.failureNote}</p>}
              <div className="mt-3 space-y-1.5">
                {m.tasks.map((t) => (
                  <div key={t.taskId} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', statusChipClass(t.status))}>{t.status}</span>
                        <span className="truncate text-[12px] text-white/75">{t.title}</span>
                        {t.platformGate ? (
                          <span className="rounded border border-emerald-400/25 px-1.5 py-0.5 text-[9.5px] text-emerald-200/70">QUALITY gate</span>
                        ) : t.assignedMember ? (
                          <span className="text-[10.5px] text-[#f0c75e]/70">{t.assignedMember.isLeader ? '★ ' : ''}{t.assignedMember.agentName}</span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {t.verificationOutcome && (
                          <span className={cn('text-[10px]', t.verificationOutcome === 'verified' ? 'text-emerald-200/70' : 'text-red-200/70')}>
                            {t.verificationOutcome}
                          </span>
                        )}
                        <span className="text-[10px] text-white/25">attempts {t.attempts}</span>
                      </div>
                    </div>
                    {t.failureNote && <div className="mt-1 text-[10.5px] leading-snug text-red-200/65">{t.failureNote}</div>}
                    {t.artifacts.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {t.artifacts.map((a, i) => {
                          const target = artifactTarget(a)
                          return target.kind === 'url' ? (
                            <a
                              key={i}
                              href={target.target}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded border border-[rgba(212,175,55,0.25)] bg-[rgba(212,175,55,0.06)] px-1.5 py-0.5 text-[10px] text-[#f0c75e]/85 hover:bg-[rgba(212,175,55,0.14)]"
                            >
                              Open {a.artifact}: {a.label || 'artifact'}
                            </a>
                          ) : (
                            <button
                              key={i}
                              onClick={() => onNavigate(target.target)}
                              className="rounded border border-[rgba(212,175,55,0.25)] bg-[rgba(212,175,55,0.06)] px-1.5 py-0.5 text-[10px] text-[#f0c75e]/85 hover:bg-[rgba(212,175,55,0.14)]"
                            >
                              Open in product: {a.label || a.artifact}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-white/35">
        Execution honesty: statuses above come from the real mission ledger (polled). A queued specialist is shown as
        queued — never as finished; a failed dependency honestly skips its downstream; and the mission never reports
        success without the platform&apos;s verification gate passing. Deliverables open through their existing
        product surfaces.
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Quick inline agent creation (never lose the team-building workflow)
// ---------------------------------------------------------------------------

function QuickCreateAgent({
  onCreated,
  onCreate,
}: {
  onCreated: (agentId: string) => void
  onCreate: (q: { name: string; role: string; description: string; capabilityKey: string }) => Promise<AutobotAgentView>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [description, setDescription] = useState('')
  const [capabilityKey, setCapabilityKey] = useState('advisory')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[12px] text-white/60 transition-colors hover:bg-white/5 hover:text-white/85"
      >
        <Plus className="h-3.5 w-3.5" /> New agent inline
      </button>
    )
  }

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const agent = await onCreate({ name: name.trim(), role: role.trim(), description: description.trim(), capabilityKey })
      onCreated(agent.id)
      setOpen(false)
      setName('')
      setRole('')
      setDescription('')
      setCapabilityKey('advisory')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the agent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="bean-input w-full" placeholder="Agent name" />
        <input value={role} onChange={(e) => setRole(e.target.value)} maxLength={60} className="bean-input w-full" placeholder="Profession / role" />
      </div>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={2} className="bean-input mt-2 w-full" placeholder="What this agent does (min 3 characters)" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select value={capabilityKey} onChange={(e) => setCapabilityKey(e.target.value)} className="bean-input max-w-[240px]">
          <option value="advisory" className="bg-[#0d0d10]">Conversational intelligence</option>
          <option value="research" className="bg-[#0d0d10]">Research &amp; analysis</option>
          <option value="engineering" className="bg-[#0d0d10]">Engineering execution</option>
          <option value="visual" className="bg-[#0d0d10]">Visual creation</option>
          <option value="motion" className="bg-[#0d0d10]">Video production</option>
          <option value="voice" className="bg-[#0d0d10]">Voice &amp; audio</option>
          <option value="review" className="bg-[#0d0d10]">Quality review</option>
        </select>
        <button
          onClick={() => void create()}
          disabled={busy || !name.trim() || !role.trim() || description.trim().length < 3}
          className="rounded-lg bg-[rgba(212,175,55,0.16)] px-3 py-1.5 text-[12px] font-medium text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.28)] transition-colors hover:bg-[rgba(212,175,55,0.24)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Spinner className="h-3 w-3" /> : 'Create & add'}
        </button>
        <button onClick={() => setOpen(false)} className="text-[12px] text-white/40 hover:text-white/70">Cancel</button>
        {error && <span className="text-[11px] text-red-200/80">{error}</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared atoms (mirroring the agent view)
// ---------------------------------------------------------------------------

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/40">
        {label}{required && <span className="ml-1 text-[#f0c75e]/70">*</span>}
      </label>
      {children}
    </div>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-white/50 transition-colors hover:bg-white/5 hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-40',
        danger && 'hover:border-red-400/30 hover:bg-red-400/10 hover:text-red-200/90',
      )}
    >
      {children}
    </button>
  )
}
