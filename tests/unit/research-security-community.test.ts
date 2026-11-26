/**
 * M42.3b — the security-advisory + community direct lane.
 *
 * Pure-contract tests (deterministic dispatch, host allowlist incl. the
 * RUNTIME guard, field normalization with honest nulls, UGC labeling,
 * ranking discipline) — no network. Live retrieval evidence lives in
 * scripts/m42-acceptance/security-community-probe.ts.
 */
import { describe, test, expect } from 'bun:test'

describe('M42.3b security/community lane dispatch (pure — no network)', () => {
  test('plain non-security non-community queries attempt zero adapters', async () => {
    const { planAttempts } = await import('../../src/lib/research/security-community')
    expect(planAttempts('summarize my notes about the team offsite')).toEqual([])
    expect(planAttempts('invent a fictional alien language for my story')).toEqual([])
    expect(planAttempts('purely decorative abstract wallpaper')).toEqual([])
  })

  test('a CVE/GHSA id triggers the OSV by-id adapter', async () => {
    const { ADVISORY_ID_RE, planAttempts } = await import('../../src/lib/research/security-community')
    expect('audit the fix for CVE-2021-23336 in our deps'.match(ADVISORY_ID_RE)?.[0]).toBe('CVE-2021-23336')
    expect('GHSA-c4w9-w5hr-p3q5 advisory'.match(ADVISORY_ID_RE)?.[0]).toBe('GHSA-c4w9-w5hr-p3q5')
    expect('no ids here'.match(ADVISORY_ID_RE)).toBeNull()
    expect(planAttempts('audit the fix for CVE-2021-23336 in our deps')).toEqual(['osv-by-id'])
    expect(planAttempts('audit the fix for CVE-2021-23336 and check stack overflow discussions')).toEqual(['osv-by-id', 'stackexchange'])
  })

  test('security + package shape triggers the OSV package adapter with the right ecosystem', async () => {
    const { planAttempts } = await import('../../src/lib/research/security-community')
    expect(planAttempts('is the npm package lodash affected by prototype pollution vulnerabilities')).toEqual(['osv-package(npm)'])
    expect(planAttempts('check pip package requests for known security advisories')).toEqual(['osv-package(PyPI)'])
    expect(planAttempts('security review of @scope/lib before upgrade')).toEqual(['osv-package(npm)'])
  })

  test('stack overflow mentions trigger the Stack Exchange adapter; hacker news mentions trigger HN', async () => {
    const { planAttempts } = await import('../../src/lib/research/security-community')
    expect(planAttempts('find a stack overflow discussion about bun test isolate')).toEqual(['stackexchange'])
    expect(planAttempts('what does hacker news say about sqlite performance')).toEqual(['hackernews'])
    expect(planAttempts('show hn thread about our release + accepted answer references')).toEqual(['stackexchange', 'hackernews'])
  })
})

describe('M42.3b host allowlist (structural SSRF bound + runtime guard)', () => {
  test('the allowlist is the exact official-API set', async () => {
    const { SECURITY_COMMUNITY_ALLOWED_HOSTS } = await import('../../src/lib/research/security-community')
    for (const h of ['api.osv.dev', 'api.stackexchange.com', 'hn.algolia.com']) {
      expect(SECURITY_COMMUNITY_ALLOWED_HOSTS.has(h)).toBe(true)
    }
    for (const h of ['localhost', '127.0.0.1', '169.254.169.254', 'evil.example.com', 'osv.dev']) {
      expect(SECURITY_COMMUNITY_ALLOWED_HOSTS.has(h)).toBe(false)
    }
  })

  test('the RUNTIME guard accepts exactly the allowlisted https hosts', async () => {
    const { assertSecurityCommunityHostAllowed } = await import('../../src/lib/research/security-community')
    for (const h of ['api.osv.dev', 'api.stackexchange.com', 'hn.algolia.com']) {
      const guarded = await assertSecurityCommunityHostAllowed(`https://${h}/v1/x?q=1`)
      expect(guarded.startsWith(`https://${h}/`)).toBe(true)
    }
  })

  test('the runtime guard rejects loopback/metadata/foreign/non-https/unparseable targets with the typed error', async () => {
    const { assertSecurityCommunityHostAllowed } = await import('../../src/lib/research/security-community')
    for (const bad of [
      'http://api.osv.dev/v1/vulns/CVE-2021-23336',
      'https://localhost/v1/query',
      'https://169.254.169.254/latest/meta-data',
      'https://evil.example.com/v1/query',
      'https://osv.dev/v1/vulns/CVE-2021-23336',
      'not a url',
    ]) {
      let threw: unknown = null
      try {
        await assertSecurityCommunityHostAllowed(bad)
      } catch (e) {
        threw = e
      }
      expect(threw).not.toBeNull()
      expect((threw as Error).name).toBe('ResearchToolError')
      expect((threw as Error).message).not.toContain('not defined')
    }
  })
})

describe('M42.3b normalization (pure mappers — honest nulls, UGC labels)', () => {
  test('OSV by-id mapping keeps fields exactly as supplied (aliases, severity, modified date; author stays null)', async () => {
    const { mapOsvVuln } = await import('../../src/lib/research/security-community')
    const item = mapOsvVuln({
      id: 'GHSA-c4w9-w5hr-p3q5',
      aliases: ['CVE-2020-8203', 'SNYK-JS-LODASH-567880'],
      summary: 'Prototype pollution in lodash',
      severity: [{ type: 'CVSS_V3', score: '7.4' }],
      modified: '2023-11-01T05:16:38.476582Z',
      published: '2020-07-15T17:25:46Z',
    })
    expect(item).not.toBeNull()
    expect(item!.url).toBe('https://osv.dev/vulnerability/GHSA-c4w9-w5hr-p3q5')
    expect(item!.title).toContain('CVE-2020-8203')
    expect(item!.snippet).toContain('official security advisory')
    expect(item!.snippet).toContain('Prototype pollution in lodash')
    expect(item!.snippet).toContain('7.4')
    expect(item!.date).toBe('2023-11-01T05:16:38.476582Z')
    expect(item!.author).toBeNull()
    expect(item!.community).toBe(false)
  })

  test('OSV mapping with missing fields keeps them null (never invented)', async () => {
    const { mapOsvVuln } = await import('../../src/lib/research/security-community')
    const item = mapOsvVuln({ id: 'OSV-2021-4' })
    expect(item!.snippet).toBe('official security advisory')
    expect(item!.date).toBeNull()
    expect(item!.title).toBe('OSV-2021-4')
  })

  test('OSV package mapping caps at 3 advisories and names the ecosystem', async () => {
    const { mapOsvPackageVulns } = await import('../../src/lib/research/security-community')
    const vulns = Array.from({ length: 6 }, (_, i) => ({ id: `GHSA-aaaa-bbbb-cccc${i}`, summary: `vuln ${i}` }))
    const items = mapOsvPackageVulns({ vulns }, 'lodash', 'npm')
    expect(items.length).toBe(3)
    expect(items[0].title).toContain('lodash (npm)')
    expect(items[0].community).toBe(false)
  })

  test('Stack Exchange mapping decodes HTML-escaped titles, formats the unix date, and labels the record USER-GENERATED', async () => {
    const { mapStackExchangeResponse, decodeStackExchangeTitle } = await import('../../src/lib/research/security-community')
    expect(decodeStackExchangeTitle('How to test &amp; debug &quot;bun test&quot; &#x27;isolate&#x27; mode &#x1F600;')).toBe('How to test & debug "bun test" \'isolate\' mode ')
    const items = mapStackExchangeResponse(
      {
        items: [
          {
            title: 'Why does &quot;npm install&quot; fail &amp; hang?',
            link: 'https://stackoverflow.com/questions/12345/x',
            score: 42,
            answer_count: 3,
            is_answered: true,
            creation_date: 1700000000,
            owner: { display_name: 'someone' },
          },
          { title: 'No date here', link: 'https://stackoverflow.com/questions/67890/y' },
        ],
      },
      'npm install hangs',
    )
    expect(items[0].title).toBe('Why does "npm install" fail & hang?')
    expect(items[0].snippet).toContain('user-generated')
    expect(items[0].snippet).toContain('score 42')
    expect(items[0].snippet).toContain('has an accepted/answer')
    expect(items[0].date).toBe(new Date(1700000000 * 1000).toISOString())
    expect(items[0].author).toBe('someone')
    expect(items[0].community).toBe(true)
    expect(items[1].snippet).toContain('no accepted answer')
    expect(items[1].date).toBeNull()
  })

  test('Hacker News mapping falls back to the item page when the story has no outbound url and stays user-generated', async () => {
    const { mapHackerNewsResponse } = await import('../../src/lib/research/security-community')
    const items = mapHackerNewsResponse(
      {
        hits: [
          { objectID: '38123456', title: 'Ask HN: best sqlite practices?', author: 'pg', points: 500, num_comments: 320, created_at: '2026-01-02T03:04:05Z' },
          { objectID: '38123457', title: 'Show HN: with outbound url', url: 'https://example.dev/thing' },
        ],
      },
      'sqlite',
    )
    expect(items[0].url).toBe('https://news.ycombinator.com/item?id=38123456')
    expect(items[0].snippet).toContain('user-generated')
    expect(items[0].snippet).toContain('500 point(s)')
    expect(items[0].snippet).toContain('320 comment(s)')
    expect(items[0].date).toBe('2026-01-02T03:04:05Z')
    expect(items[1].url).toBe('https://example.dev/thing')
  })

  test('community records are classified social + community + LOW authority; official advisories are official + high authority (the REAL dispatcher classification)', async () => {
    const { toRankedSource } = await import('../../src/lib/research/security-community')
    const community = toRankedSource({ url: 'https://stackoverflow.com/q/1', title: 'x', snippet: 'community Q&A (user-generated) — score 1', hostName: 'stackoverflow.com', rank: 1, date: null, author: null, community: true })
    expect(community.social).toBe(true)
    expect(community.official).toBe(false)
    expect(community.sourceType).toBe('community')
    expect(community.authority).toBeLessThan(0.5)
    expect(community.score).toBeLessThan(0.5)
    const official = toRankedSource({ url: 'https://osv.dev/vulnerability/CVE-2021-23336', title: 'CVE-2021-23336', snippet: 'official security advisory', hostName: 'osv.dev', rank: 1, date: null, author: null, community: false })
    expect(official.social).toBe(false)
    expect(official.official).toBe(true)
    expect(official.sourceType).toBe('official')
    expect(official.authority).toBeGreaterThan(community.authority)
    expect(official.score).toBeGreaterThan(community.score)
  })
})
