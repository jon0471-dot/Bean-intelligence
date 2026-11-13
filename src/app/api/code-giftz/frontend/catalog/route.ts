/**
 * CODE GIFTZ — Frontend Intelligence Toolkit catalogue (owner-scoped, read-only).
 *
 * Exposes the curated component registry, animation patterns, background
 * effects and the pinned dependency matrix for the Frontend toolkit panel.
 * Metadata only — no component source, no vendor bytes, no secrets.
 */
import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { COMPONENT_CATALOG, NOT_INSTALLED_CATALOG, PINNED_DEPENDENCIES } from '@/lib/frontend-intel/catalog'
import { GSAP_PATTERNS } from '@/lib/frontend-intel/gsap-patterns'
import { VANTA_EFFECTS } from '@/lib/frontend-intel/vanta'

export async function GET() {
  return handle(async () => {
    await requireUser()
    return ok({
      components: COMPONENT_CATALOG.map((c) => ({
        id: c.id,
        name: c.name,
        category: c.category,
        description: c.description,
        sourceUrl: c.sourceUrl,
        dependencies: c.dependencies,
        compatibility: c.compatibility,
        styling: c.styling,
        variants: c.variants,
        installed: c.installed,
        license: c.license,
        attribution: c.attribution,
      })),
      notInstalled: NOT_INSTALLED_CATALOG.map((c) => ({
        id: c.id,
        name: c.name,
        category: c.category,
        reason: c.notInstalledReason ?? 'not installed',
      })),
      animations: GSAP_PATTERNS.map((a) => ({
        id: a.id,
        label: a.label,
        description: a.description,
        requires: a.requires,
      })),
      backgrounds: VANTA_EFFECTS.map((b) => ({
        id: b.id,
        label: b.label,
        description: b.description,
        note: b.note,
        vendorFiles: b.vendorFiles,
      })),
      dependencies: Object.values(PINNED_DEPENDENCIES).map((d) => ({
        name: d.name,
        version: d.version,
        license: d.license,
        licenseUrl: d.licenseUrl,
      })),
    })
  })
}
