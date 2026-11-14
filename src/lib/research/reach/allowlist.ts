/**
 * BEAN Intelligence — shared research gateway: allowlisted command interface.
 *
 * SECURITY INVARIANT (Phase 1): the only Agent Reach commands BEAN can run
 * are the ones declared here. Channels, actions and parameter names are a
 * fixed inventory mirrored from the audited upstream source (v1.6.1) — never
 * taken from model output or user input. Arguments travel as an argv ARRAY
 * (spawn without shell); no string interpolation into a shell ever happens.
 *
 * Every upstream command prints one JSON envelope (see ./types.ts); parse
 * failures are honest errors, never retried silently.
 */

import { assertPublicHttpUrlSync } from './url-safety'

export type ReachParamType = 'string' | 'int'

export interface ReachParamSpec {
  name: string
  type: ReachParamType
  required: boolean
  /** For URL-bearing params BEAN applies the SSRF guard before building argv. */
  urlGuard?: boolean
  /** Upstream declared default (informational). */
  default?: string | number
}

export interface ReachActionSpec {
  action: string
  params: ReachParamSpec[]
}

export interface ReachChannelSpec {
  channel: string
  /** Upstream maturity level (default/optional/experimental) — surfaced honestly. */
  level: 'default' | 'optional' | 'experimental'
  /** True when the channel's useful actions require an owner-controlled login. */
  loginRequired: boolean
  actions: ReachActionSpec[]
}

/**
 * The full allowlist. Mirrors Agent Reach v1.6.1 channel declarations; an
 * upstream update that changes this surface fails VALIDATION (BAD_INPUT),
 * never executes something unexpected.
 */
export const REACH_CHANNELS: ReachChannelSpec[] = [
  {
    channel: 'github',
    level: 'default',
    loginRequired: false,
    actions: [
      {
        action: 'search',
        params: [
          { name: 'query', type: 'string', required: true },
          { name: 'limit', type: 'int', required: false, default: 5 },
        ],
      },
      {
        action: 'read',
        params: [{ name: 'target', type: 'string', required: true, urlGuard: true }],
      },
    ],
  },
  {
    channel: 'web',
    level: 'default',
    loginRequired: false,
    actions: [
      {
        action: 'search',
        params: [
          { name: 'query', type: 'string', required: true },
          { name: 'limit', type: 'int', required: false, default: 5 },
        ],
      },
      {
        action: 'read',
        params: [{ name: 'target', type: 'string', required: true, urlGuard: true }],
      },
    ],
  },
  {
    channel: 'youtube',
    level: 'default',
    loginRequired: false,
    actions: [
      {
        action: 'search',
        params: [
          { name: 'query', type: 'string', required: true },
          { name: 'limit', type: 'int', required: false, default: 5 },
        ],
      },
      {
        action: 'read',
        params: [{ name: 'target', type: 'string', required: true, urlGuard: true }],
      },
      {
        action: 'subtitle',
        params: [
          { name: 'target', type: 'string', required: true, urlGuard: true },
          { name: 'lang', type: 'string', required: false, default: 'zh-Hans,zh,en,en-orig' },
        ],
      },
    ],
  },
  {
    channel: 'bilibili',
    level: 'default',
    loginRequired: false,
    actions: [
      {
        action: 'search',
        params: [
          { name: 'query', type: 'string', required: true },
          { name: 'limit', type: 'int', required: false, default: 5 },
        ],
      },
      {
        action: 'read',
        params: [{ name: 'target', type: 'string', required: true, urlGuard: true }],
      },
      {
        action: 'subtitle',
        params: [{ name: 'target', type: 'string', required: true, urlGuard: true }],
      },
      {
        action: 'hot',
        params: [{ name: 'limit', type: 'int', required: false, default: 10 }],
      },
    ],
  },
  {
    channel: 'reddit',
    level: 'optional',
    loginRequired: true,
    actions: [
      {
        action: 'search',
        params: [
          { name: 'query', type: 'string', required: true },
          { name: 'limit', type: 'int', required: false, default: 5 },
        ],
      },
      {
        action: 'read',
        params: [{ name: 'target', type: 'string', required: true, urlGuard: true }],
      },
      {
        action: 'subreddit',
        params: [
          { name: 'name', type: 'string', required: true },
          { name: 'limit', type: 'int', required: false, default: 5 },
        ],
      },
    ],
  },
  {
    channel: 'v2ex',
    level: 'default',
    loginRequired: false,
    actions: [
      {
        action: 'hot',
        params: [{ name: 'limit', type: 'int', required: false, default: 10 }],
      },
      {
        action: 'node',
        params: [
          { name: 'node_name', type: 'string', required: true },
          { name: 'limit', type: 'int', required: false, default: 10 },
        ],
      },
      {
        action: 'read',
        params: [{ name: 'target', type: 'string', required: true, urlGuard: true }],
      },
      {
        action: 'user',
        params: [{ name: 'username', type: 'string', required: true }],
      },
    ],
  },
]

export function findChannelSpec(channel: string): ReachChannelSpec | null {
  const c = channel.trim().toLowerCase()
  return REACH_CHANNELS.find((ch) => ch.channel === c) ?? null
}

export function findActionSpec(channel: string, action: string): ReachActionSpec | null {
  const ch = findChannelSpec(channel)
  if (!ch) return null
  const a = action.trim().toLowerCase()
  return ch.actions.find((x) => x.action === a) ?? null
}

/** owner/repo, a repo link, or an issue/PR link — mirrors the upstream regex. */
const GITHUB_TARGET_RE =
  /^(?:https?:\/\/(?:www\.)?github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:issues|pull)\/(\d+))?\/?(?:[?#].*)?$/

const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/

export type BuiltCommand =
  | { ok: true; args: string[]; timeoutSeconds: number }
  | { ok: false; kind: 'bad-input' | 'blocked-url'; message: string }

/**
 * Build the argv for ONE allowlisted invocation. The binary path is NOT part
 * of the returned args (the runner prepends it); the first element is the
 * channel so the runner can assert the shape.
 *
 * Validation is fail-closed: unknown channel/action/params, control
 * characters, oversized strings and non-public URLs are all rejected BEFORE
 * any process starts.
 */
export function buildReachCommand(
  channel: string,
  action: string,
  params: Record<string, string | number>,
  timeoutMs: number,
): BuiltCommand {
  const ch = findChannelSpec(channel)
  if (!ch) return { ok: false, kind: 'bad-input', message: `unknown channel: ${channel.slice(0, 40)}` }
  const act = findActionSpec(channel, action)
  if (!act) return { ok: false, kind: 'bad-input', message: `unknown action for ${ch.channel}` }

  const args: string[] = [ch.channel, act.action]
  const unknown = Object.keys(params).filter((k) => !act.params.some((p) => p.name === k))
  if (unknown.length > 0) {
    return { ok: false, kind: 'bad-input', message: 'invalid parameters for this action' }
  }

  for (const spec of act.params) {
    const raw = params[spec.name]
    if (raw === undefined || raw === null || raw === '') {
      if (spec.required) return { ok: false, kind: 'bad-input', message: 'missing a required parameter' }
      continue
    }
    if (spec.type === 'int') {
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        return { ok: false, kind: 'bad-input', message: 'invalid numeric parameter' }
      }
      args.push(spec.required ? String(n) : `--${spec.name}`, ...(spec.required ? [] : [String(n)]))
      continue
    }
    const s = String(raw).trim()
    if (s.length < 1 || s.length > 400 || CONTROL_CHARS_RE.test(s)) {
      return { ok: false, kind: 'bad-input', message: 'invalid parameter value' }
    }
    if (spec.urlGuard) {
      if (ch.channel === 'github') {
        // GitHub targets are owner/repo or github.com links — NOT arbitrary URLs.
        if (!GITHUB_TARGET_RE.test(s)) {
          return { ok: false, kind: 'bad-input', message: 'invalid GitHub target' }
        }
        // If it is a full URL, it must additionally pass the public-URL guard.
        if (/^https?:\/\//i.test(s)) {
          const guard = assertPublicHttpUrlSync(s)
          if (!guard.ok) return { ok: false, kind: 'blocked-url', message: guard.reason }
        }
      } else {
        const guard = assertPublicHttpUrlSync(s)
        if (!guard.ok) return { ok: false, kind: 'blocked-url', message: guard.reason }
      }
    }
    args.push(spec.required ? s : `--${spec.name}`, ...(spec.required ? [] : [s]))
  }

  // Upstream requires every required param; a missing one fails here.
  for (const spec of act.params) {
    if (spec.required && params[spec.name] === undefined) {
      return { ok: false, kind: 'bad-input', message: 'missing a required parameter' }
    }
  }

  const timeoutSeconds = Math.min(60, Math.max(5, Math.round(timeoutMs / 1000)))
  args.push('--timeout', String(timeoutSeconds))
  return { ok: true, args, timeoutSeconds }
}
