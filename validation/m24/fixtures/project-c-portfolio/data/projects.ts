// SAMPLE CONTENT — fictional projects for a fictional developer.
export interface Project {
  slug: string
  title: string
  year: string
  blurb: string
  role: string
  stack: string[]
  highlights: string[]
  accent: string
}

export const PROJECTS: Project[] = [
  {
    slug: 'atlas-maps',
    title: 'Atlas Maps',
    year: '2025',
    blurb: 'Offline-first trail mapping app with vector tiles and turn-by-turn voice cues.',
    role: 'Lead frontend engineer',
    stack: ['TypeScript', 'React', 'WebGL', 'IndexedDB'],
    highlights: [
      'Vector-tile renderer holding 60 fps on mid-range phones',
      'Full offline mode with background tile prefetch',
      'Voice guidance engine in 9 languages',
    ],
    accent: '#7dd3fc',
  },
  {
    slug: 'ledgerlight',
    title: 'LedgerLight',
    year: '2024',
    blurb: 'Personal finance dashboard that parses bank exports locally — nothing leaves the device.',
    role: 'Design engineer',
    stack: ['React', 'Web Workers', 'D3', 'CSS'],
    highlights: [
      'CSV/OFX parser running in a worker at 40k rows/s',
      'Zero-server architecture: data never uploaded',
      'Accessible charts with sonification fallback',
    ],
    accent: '#a78bfa',
  },
  {
    slug: 'fieldnotes',
    title: 'FieldNotes',
    year: '2024',
    blurb: 'Collaborative research notebook with conflict-free sync and handwriting capture.',
    role: 'Founding engineer',
    stack: ['TypeScript', 'CRDTs', 'Canvas', 'Node'],
    highlights: [
      'CRDT merge layer surviving 30-day offline periods',
      'Pressure-sensitive ink capture on stylus devices',
      'Full-text search across 10k handwritten notes',
    ],
    accent: '#34d399',
  },
  {
    slug: 'signalgrid',
    title: 'SignalGrid',
    year: '2023',
    blurb: 'Status-page and incident tooling for small teams, from paging to postmortem.',
    role: 'Frontend engineer',
    stack: ['React', 'WebSocket', 'Tailwind'],
    highlights: [
      'Sub-second incident propagation over WebSocket fanout',
      'Postmortem builder with timeline replay',
      '99.98% uptime across its own status page',
    ],
    accent: '#fbbf24',
  },
]

export function projectBySlug(slug: string): Project | undefined {
  return PROJECTS.find((p) => p.slug === slug)
}
