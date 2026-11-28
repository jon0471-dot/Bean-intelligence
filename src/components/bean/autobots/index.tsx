'use client'

/**
 * BEAN Intelligence — M49.1 BEAN AUTOBOTS: the user-facing AI workforce view.
 *
 * Sections: Discover Agents (searchable, filterable verified catalogue),
 * My Agents (open/edit/duplicate/archive/delete), Create Agent (bounded,
 * validated form with honest capability information), Agent Workspace and
 * Agent Details (workspace.tsx).
 *
 * Data honesty: the catalogue renders from the SAME pure module the server
 * validates (src/lib/autobots/catalog.ts) — capability claims here are the
 * capability grants the server actually enforces. No section ever shows a
 * green operational state merely because a profile exists: capability panels
 * state what the agent can and cannot do, and execution history comes from
 * real workspace transcripts.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, Bot, Copy, Pencil, Plus, Search, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import { Spinner, beanFetch, type BeanUser } from '@/components/bean/shared'
import { cn } from '@/lib/utils'
import { AgentDetails, AgentWorkspace } from './workspace'

// ---------------------------------------------------------------------------
// Shared view types (server API shapes)
// ---------------------------------------------------------------------------

export interface AutobotAgentView {
  id: string
  name: string
  role: string
  industry: string | null
  description: string
  personality: string | null
  instructions: string | null
  language: string | null
  capabilityKey: string
  capabilityLabel: string
  memoryMode: string
  templateKey: string | null
  status: string
  executionCount: number
  lastExecutedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AutobotConversationView {
  id: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

interface CatalogTemplate {
  key: string
  name: string
  role: string
  category: string
  industry: string
  description: string
  personality: string
  instructions: string
  capabilityKey: string
  languages: string
  limitations: string
}

interface CatalogCapability {
  id: string
  label: string
  summary: string
  underlying: string
  delegation: string | null
  limits: string
}

interface CatalogData {
  categories: Array<{ id: string; label: string }>
  capabilities: CatalogCapability[]
  memoryModes: Array<{ id: string; label: string }>
  limits: {
    nameChars: number
    roleChars: number
    industryChars: number
    descriptionChars: number
    personalityChars: number
    instructionsChars: number
    languageChars: number
    maxAgentsPerUser: number
  }
  templates: CatalogTemplate[]
}

type Section = 'discover' | 'mine' | 'create' | 'workspace' | 'details'

// ---------------------------------------------------------------------------
// Create / edit form state
// ---------------------------------------------------------------------------

interface FormState {
  name: string
  role: string
  industry: string
  description: string
  personality: string
  instructions: string
  language: string
  capabilityKey: string
  memoryMode: string
}

const EMPTY_FORM: FormState = {
  name: '',
  role: '',
  industry: '',
  description: '',
  personality: '',
  instructions: '',
  language: '',
  capabilityKey: 'advisory',
  memoryMode: 'disabled',
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Autobots({ user }: { user: BeanUser }) {
  const [section, setSection] = useState<Section>('discover')
  const [catalog, setCatalog] = useState<CatalogData | null>(null)
  const [agents, setAgents] = useState<AutobotAgentView[]>([])
  const [activeAgent, setActiveAgent] = useState<AutobotAgentView | null>(null)
  const [activeConversations, setActiveConversations] = useState<AutobotConversationView[]>([])
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formTemplateKey, setFormTemplateKey] = useState<string | null>(null)
  const [formNote, setFormNote] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refreshAgents = useCallback(async () => {
    try {
      const d = await beanFetch<{ agents: AutobotAgentView[] }>('/api/autobots/agents', { timeoutMs: 20_000 })
      setAgents(d.agents)
      setListError(null)
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Could not load your agents.')
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const d = await beanFetch<CatalogData>('/api/autobots/catalog', { timeoutMs: 20_000 })
        setCatalog(d)
      } catch (e) {
        setListError(e instanceof Error ? e.message : 'Could not load the agent catalogue.')
      }
    })()
    void refreshAgents()
  }, [refreshAgents])

  const refreshActiveAgent = useCallback(async (id: string) => {
    try {
      const d = await beanFetch<{ agent: AutobotAgentView; conversations: AutobotConversationView[] }>(
        `/api/autobots/agents/${id}`,
        { timeoutMs: 20_000 },
      )
      setActiveAgent(d.agent)
      setActiveConversations(d.conversations)
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Could not load the agent.')
    }
  }, [])

  const openCreate = (template?: CatalogTemplate) => {
    setEditingId(null)
    setFormError(null)
    setFormNote(null)
    if (template) {
      setFormTemplateKey(template.key)
      setForm({
        name: template.name,
        role: template.role,
        industry: template.industry,
        description: template.description,
        personality: template.personality,
        instructions: template.instructions,
        language: template.languages,
        capabilityKey: template.capabilityKey,
        memoryMode: 'disabled',
      })
    } else {
      setFormTemplateKey(null)
      setForm(EMPTY_FORM)
    }
    setSection('create')
  }

  const openEdit = (agent: AutobotAgentView) => {
    setEditingId(agent.id)
    setFormTemplateKey(agent.templateKey)
    setFormError(null)
    setFormNote(null)
    setForm({
      name: agent.name,
      role: agent.role,
      industry: agent.industry ?? '',
      description: agent.description,
      personality: agent.personality ?? '',
      instructions: agent.instructions ?? '',
      language: agent.language ?? '',
      capabilityKey: agent.capabilityKey,
      memoryMode: agent.memoryMode,
    })
    setSection('create')
  }

  const submitForm = async () => {
    setBusy(true)
    setFormError(null)
    setFormNote(null)
    try {
      const payload = {
        name: form.name,
        role: form.role,
        industry: form.industry || undefined,
        description: form.description,
        personality: form.personality || undefined,
        instructions: form.instructions || undefined,
        language: form.language || undefined,
        capabilityKey: form.capabilityKey,
        memoryMode: form.memoryMode,
      }
      if (editingId) {
        const d = await beanFetch<{ agent: AutobotAgentView }>(`/api/autobots/agents/${editingId}`, {
          method: 'PATCH',
          json: payload,
          timeoutMs: 20_000,
        })
        setFormNote(null)
        setActiveAgent(d.agent)
        setSection('details')
        void refreshAgents()
      } else {
        const d = await beanFetch<{ agent: AutobotAgentView }>('/api/autobots/agents', {
          method: 'POST',
          json: formTemplateKey ? { ...payload, templateKey: formTemplateKey } : payload,
          timeoutMs: 20_000,
        })
        setActiveAgent(d.agent)
        setActiveConversations([])
        setSection('workspace')
        void refreshAgents()
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save the agent.')
    } finally {
      setBusy(false)
    }
  }

  const agentAction = async (id: string, action: 'duplicate' | 'archive' | 'unarchive' | 'delete') => {
    setBusy(true)
    setListError(null)
    try {
      if (action === 'duplicate') {
        await beanFetch(`/api/autobots/agents/${id}/duplicate`, { method: 'POST', timeoutMs: 20_000 })
      } else if (action === 'delete') {
        await beanFetch(`/api/autobots/agents/${id}`, { method: 'DELETE', timeoutMs: 20_000 })
        if (activeAgent?.id === id) {
          setActiveAgent(null)
          setSection('discover')
        }
      } else {
        await beanFetch(`/api/autobots/agents/${id}`, {
          method: 'PATCH',
          json: { status: action === 'archive' ? 'archived' : 'active' },
          timeoutMs: 20_000,
        })
      }
      void refreshAgents()
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'The action failed.')
    } finally {
      setBusy(false)
    }
  }

  const openAgent = async (agent: AutobotAgentView, target: 'workspace' | 'details') => {
    setActiveAgent(agent)
    setActiveConversations([])
    setSection(target)
    void refreshActiveAgent(agent.id)
  }

  const capabilityById = useMemo(() => {
    const m = new Map<string, CatalogCapability>()
    catalog?.capabilities.forEach((c) => m.set(c.id, c))
    return m
  }, [catalog])

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

  // ---- Workspace / Details take over the whole view ------------------------
  if (section === 'workspace' && activeAgent) {
    return (
      <AgentWorkspace
        agent={activeAgent}
        onBack={() => { setSection('mine'); void refreshAgents() }}
        onOpenDetails={() => { setSection('details'); void refreshActiveAgent(activeAgent.id) }}
        onAgentUpdated={() => void refreshAgents()}
      />
    )
  }

  if (section === 'details' && activeAgent) {
    return (
      <AgentDetails
        agent={activeAgent}
        conversations={activeConversations}
        onBack={() => { setSection('mine'); void refreshAgents() }}
        onOpenWorkspace={() => setSection('workspace')}
        onEdit={() => openEdit(activeAgent)}
      />
    )
  }

  // ---- Create / Edit --------------------------------------------------------
  if (section === 'create') {
    const cap = capabilityById.get(form.capabilityKey)
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <button
          onClick={() => setSection(editingId ? 'details' : 'discover')}
          className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-white/45 transition-colors hover:text-white/80"
        >
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
        <h1 className="text-lg font-semibold text-white/92">
          {editingId ? 'Edit agent' : formTemplateKey ? 'Create from template' : 'Create agent'}
        </h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-white/45">
          Instructions and personality shape the agent&apos;s tone and focus. They are your configuration data —
          they never add tools or permissions. Actual capabilities come from the capability you select.
        </p>

        <div className="mt-5 space-y-4 rounded-xl border border-[rgba(212,175,55,0.14)] bg-white/[0.04] p-5">
          <Field label={`Name (max ${catalog.limits.nameChars})`} required>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              maxLength={catalog.limits.nameChars}
              className="bean-input w-full"
              placeholder="e.g. Acme Strategy Partner"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Profession or role (max ${catalog.limits.roleChars})`} required>
              <input
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                maxLength={catalog.limits.roleChars}
                className="bean-input w-full"
                placeholder="e.g. Business strategist"
              />
            </Field>
            <Field label={`Industry (max ${catalog.limits.industryChars})`}>
              <input
                value={form.industry}
                onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
                maxLength={catalog.limits.industryChars}
                className="bean-input w-full"
                placeholder="e.g. SaaS & technology"
              />
            </Field>
          </div>
          <Field label={`Description (max ${catalog.limits.descriptionChars})`} required>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              maxLength={catalog.limits.descriptionChars}
              rows={3}
              className="bean-input w-full resize-y"
              placeholder="What this agent helps with"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Personality & communication style (max ${catalog.limits.personalityChars})`}>
              <textarea
                value={form.personality}
                onChange={(e) => setForm((f) => ({ ...f, personality: e.target.value }))}
                maxLength={catalog.limits.personalityChars}
                rows={3}
                className="bean-input w-full resize-y"
                placeholder="e.g. Direct, structured, leads with the recommendation"
              />
            </Field>
            <Field label={`Instructions & working preferences (max ${catalog.limits.instructionsChars})`}>
              <textarea
                value={form.instructions}
                onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
                maxLength={catalog.limits.instructionsChars}
                rows={3}
                className="bean-input w-full resize-y"
                placeholder="e.g. Always structure answers as recommendation → reasoning → risks"
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Language preference (max ${catalog.limits.languageChars})`}>
              <input
                value={form.language}
                onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                maxLength={catalog.limits.languageChars}
                className="bean-input w-full"
                placeholder="e.g. English; follows my language"
              />
            </Field>
            <Field label="Memory">
              <select
                value={form.memoryMode}
                onChange={(e) => setForm((f) => ({ ...f, memoryMode: e.target.value }))}
                className="bean-input w-full"
              >
                {catalog.memoryModes.map((m) => (
                  <option key={m.id} value={m.id} className="bg-[#0d0d10]">{m.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Actual supported capability" required>
            <select
              value={form.capabilityKey}
              onChange={(e) => setForm((f) => ({ ...f, capabilityKey: e.target.value }))}
              className="bean-input w-full"
            >
              {catalog.capabilities.map((c) => (
                <option key={c.id} value={c.id} className="bg-[#0d0d10]">{c.label}</option>
              ))}
            </select>
            {cap && (
              <div className="mt-2 space-y-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-[12px] leading-relaxed">
                <div className="text-white/70"><span className="text-white/40">Can do: </span>{cap.summary}</div>
                <div className="text-white/50"><span className="text-white/40">Runs on: </span>{cap.underlying}</div>
                {cap.delegation && <div className="text-white/50"><span className="text-white/40">Delegates: </span>{cap.delegation}</div>}
                <div className="text-white/50"><span className="text-white/40">Limits: </span>{cap.limits}</div>
              </div>
            )}
          </Field>

          {formError && (
            <div className="rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[12.5px] text-red-200/90">
              {formError}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={() => void submitForm()}
              disabled={busy || !form.name.trim() || !form.role.trim() || form.description.trim().length < 3}
              className="inline-flex items-center gap-2 rounded-lg bg-[rgba(212,175,55,0.16)] px-4 py-2 text-[13px] font-medium text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.28)] transition-colors hover:bg-[rgba(212,175,55,0.24)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? <Spinner className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
              {editingId ? 'Save changes' : 'Create agent'}
            </button>
            <span className="text-[11.5px] text-white/35">
              {catalog.limits.maxAgentsPerUser} agents max per account · owner-scoped and private
            </span>
          </div>
        </div>
      </div>
    )
  }

  // ---- Discover Agents -------------------------------------------------------
  if (section === 'discover') {
    return (
      <CatalogView
        catalog={catalog}
        onUseTemplate={(t) => openCreate(t)}
        onCreateCustom={() => openCreate()}
        onGoMine={() => { setSection('mine'); void refreshAgents() }}
        mineCount={agents.length}
      />
    )
  }

  // ---- My Agents --------------------------------------------------------------
  const active = agents.filter((a) => a.status === 'active')
  const archived = agents.filter((a) => a.status === 'archived')
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white/92">My agents</h1>
          <p className="mt-0.5 text-[12.5px] text-white/45">
            {active.length} active{archived.length > 0 ? ` · ${archived.length} archived` : ''} · private to {user.email}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSection('discover')}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-[12.5px] text-white/65 transition-colors hover:bg-white/5 hover:text-white/90"
          >
            Discover agents
          </button>
          <button
            onClick={() => openCreate()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[rgba(212,175,55,0.16)] px-3 py-1.5 text-[12.5px] font-medium text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.28)] transition-colors hover:bg-[rgba(212,175,55,0.24)]"
          >
            <Plus className="h-3.5 w-3.5" /> New agent
          </button>
        </div>
      </div>

      {listError && (
        <div className="mt-4 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[12.5px] text-red-200/90">
          {listError}
        </div>
      )}

      {agents.length === 0 ? (
        <div className="mt-10 flex flex-col items-center justify-center rounded-xl border border-dashed border-[rgba(212,175,55,0.2)] py-14 text-center">
          <Bot className="mb-3 h-10 w-10 text-white/25" />
          <div className="text-[14px] font-medium text-white/75">No agents yet</div>
          <div className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-white/45">
            Start from the verified catalogue or configure your own — every agent gets real capabilities and honest limits.
          </div>
          <button
            onClick={() => setSection('discover')}
            className="mt-4 rounded-lg bg-[rgba(212,175,55,0.16)] px-4 py-2 text-[12.5px] font-medium text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.28)] transition-colors hover:bg-[rgba(212,175,55,0.24)]"
          >
            Browse the catalogue
          </button>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {[...active, ...archived].map((a) => (
            <div
              key={a.id}
              className={cn(
                'rounded-xl border bg-white/[0.04] p-4',
                a.status === 'archived' ? 'border-white/[0.06] opacity-70' : 'border-[rgba(212,175,55,0.14)]',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(212,175,55,0.12)] text-[#f0c75e]">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-medium text-white/88">{a.name}</span>
                      {a.status === 'archived' && (
                        <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/40">Archived</span>
                      )}
                      {a.templateKey && (
                        <span className="rounded border border-[rgba(212,175,55,0.2)] bg-[rgba(212,175,55,0.08)] px-1.5 py-0.5 text-[10px] text-[#f0c75e]/80">Template</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[12px] text-white/45">{a.role} · {a.capabilityLabel}</div>
                    <p className="mt-1.5 line-clamp-2 max-w-xl text-[12.5px] leading-relaxed text-white/55">{a.description}</p>
                    <div className="mt-1.5 text-[11px] text-white/30">
                      {a.executionCount} completed turn{a.executionCount === 1 ? '' : 's'}
                      {a.lastExecutedAt ? ` · last worked ${new Date(a.lastExecutedAt).toLocaleString()}` : ' · never used yet'}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {a.status === 'active' && (
                    <button
                      onClick={() => void openAgent(a, 'workspace')}
                      className="rounded-lg bg-[rgba(212,175,55,0.16)] px-3 py-1.5 text-[12px] font-medium text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.28)] transition-colors hover:bg-[rgba(212,175,55,0.24)]"
                    >
                      Open
                    </button>
                  )}
                  <button
                    onClick={() => void openAgent(a, 'details')}
                    className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] text-white/60 transition-colors hover:bg-white/5 hover:text-white/90"
                  >
                    Details
                  </button>
                  <IconButton label="Edit" onClick={() => openEdit(a)}><Pencil className="h-3.5 w-3.5" /></IconButton>
                  <IconButton label="Duplicate" onClick={() => void agentAction(a.id, 'duplicate')} disabled={busy}><Copy className="h-3.5 w-3.5" /></IconButton>
                  {a.status === 'active' ? (
                    <IconButton label="Archive" onClick={() => void agentAction(a.id, 'archive')} disabled={busy}><Archive className="h-3.5 w-3.5" /></IconButton>
                  ) : (
                    <IconButton label="Restore" onClick={() => void agentAction(a.id, 'unarchive')} disabled={busy}><Undo2 className="h-3.5 w-3.5" /></IconButton>
                  )}
                  <IconButton label="Delete" onClick={() => void agentAction(a.id, 'delete')} disabled={busy} danger><Trash2 className="h-3.5 w-3.5" /></IconButton>
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
// Discover view
// ---------------------------------------------------------------------------

function CatalogView({
  catalog,
  onUseTemplate,
  onCreateCustom,
  onGoMine,
  mineCount,
}: {
  catalog: CatalogData
  onUseTemplate: (t: CatalogTemplate) => void
  onCreateCustom: () => void
  onGoMine: () => void
  mineCount: number
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [showAllCategories, setShowAllCategories] = useState(false)

  const filtered = catalog.templates.filter((t) => {
    if (category !== 'all' && t.category !== category) return false
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()
    return (
      t.name.toLowerCase().includes(q) ||
      t.role.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.industry.toLowerCase().includes(q)
    )
  })

  const shownCategories = showAllCategories ? catalog.categories : catalog.categories.slice(0, 5)

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      {/* Hero */}
      <div className="rounded-xl border border-[rgba(212,175,55,0.14)] bg-gradient-to-b from-[rgba(212,175,55,0.08)] to-transparent p-6">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#f0c75e]/75">
          <Bot className="h-4 w-4" /> BEAN AUTOBOTS
        </div>
        <h1 className="mt-2 text-xl font-semibold leading-snug text-white/92 sm:text-2xl">
          Your AI workforce — <span className="bean-gold-text">real capabilities, honest limits</span>
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/55">
          Create and work with agents for business, technology, creative and personal work. Every agent runs on
          BEAN&apos;s verified execution systems — RIISHE intelligence and the specialist products — with
          server-authorized tools and truthful status, never simulated work.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={onGoMine}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-[12.5px] text-white/70 transition-colors hover:bg-white/5 hover:text-white/90"
          >
            My agents ({mineCount})
          </button>
          <button
            onClick={onCreateCustom}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[rgba(212,175,55,0.16)] px-3 py-1.5 text-[12.5px] font-medium text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.28)] transition-colors hover:bg-[rgba(212,175,55,0.24)]"
          >
            <Plus className="h-3.5 w-3.5" /> Create a custom agent
          </button>
        </div>
      </div>

      {/* Search + category filter */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents — strategist, engineer, designer, narrator…"
            className="bean-input w-full pl-9"
            aria-label="Search agents"
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <CategoryChip active={category === 'all'} onClick={() => setCategory('all')}>All</CategoryChip>
        {shownCategories.map((c) => (
          <CategoryChip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>{c.label}</CategoryChip>
        ))}
        {catalog.categories.length > 5 && (
          <button
            onClick={() => setShowAllCategories((v) => !v)}
            className="rounded-full px-2.5 py-1 text-[11.5px] text-white/40 transition-colors hover:text-white/70"
          >
            {showAllCategories ? 'Less' : `+${catalog.categories.length - 5} more`}
          </button>
        )}
      </div>

      {/* Template grid */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((t) => {
          const cap = catalog.capabilities.find((c) => c.id === t.capabilityKey)
          return (
            <div key={t.key} className="flex flex-col rounded-xl border border-[rgba(212,175,55,0.12)] bg-white/[0.04] p-4 transition-colors hover:border-[rgba(212,175,55,0.28)]">
              <div className="flex items-start justify-between gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(212,175,55,0.12)] text-[#f0c75e]">
                  <Bot className="h-5 w-5" />
                </div>
                <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/35">
                  {catalog.categories.find((c) => c.id === t.category)?.label ?? t.category}
                </span>
              </div>
              <div className="mt-2.5 text-[14px] font-medium text-white/88">{t.name}</div>
              <div className="text-[11.5px] text-white/40">{t.role} · {cap?.label ?? t.capabilityKey}</div>
              <p className="mt-2 line-clamp-3 flex-1 text-[12.5px] leading-relaxed text-white/55">{t.description}</p>
              <div className="mt-2 text-[11px] leading-relaxed text-white/35">
                <span className="text-white/45">Runs on: </span>{cap?.underlying}
              </div>
              <button
                onClick={() => onUseTemplate(t)}
                className="mt-3 w-full rounded-lg bg-[rgba(212,175,55,0.16)] py-1.5 text-[12.5px] font-medium text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.28)] transition-colors hover:bg-[rgba(212,175,55,0.24)]"
              >
                Use this template
              </button>
            </div>
          )
        })}
      </div>
      {filtered.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-white/10 py-10 text-center text-[13px] text-white/45">
          No catalogue agents match that search — you can still create a fully custom agent.
        </div>
      )}

      {/* Honest scope note — the catalogue is a verified subset, not every profession */}
      <div className="mt-6 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-[11.5px] leading-relaxed text-white/45">
        The catalogue is a curated, verified collection — it does not claim every profession is fully implemented.
        Any profession can be configured as a custom agent on the supported capabilities above; tool-dependent
        capabilities outside this list stay honestly unavailable rather than simulated.
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small shared atoms
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

function CategoryChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1 text-[11.5px] transition-colors',
        active
          ? 'bg-[rgba(212,175,55,0.16)] text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.28)]'
          : 'border border-white/[0.08] text-white/50 hover:bg-white/5 hover:text-white/75',
      )}
    >
      {children}
    </button>
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
