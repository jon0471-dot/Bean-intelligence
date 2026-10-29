/**
 * BEAN Intelligence — GANGZII shared preset registry (client-safe).
 *
 * This is the SINGLE AUTHORITATIVE source for GANGZII voice presets and
 * song presets. The frontend imports it directly AND the backend serves it
 * through /api/gangzii/voices and /api/gangzii/song-presets (which merge in
 * live capability truth from the private server registry). Hardcoded copies
 * elsewhere are forbidden — import from here.
 *
 * TRUTH POLICY:
 *  - Voice presets are EXACTLY the voices the configured TTS provider
 *    accepts (7, live-verified 2026-10-27 — see
 *    models/manifests/bean-audio-tts-hosted-primary.json). No synthetic
 *    "extra voices" are invented: every preset id IS a provider voice id,
 *    and unsupported controls (language, pitch, emotion) are declared
 *    unsupported rather than pretending.
 *  - Song presets describe INTENDED generation styles. With no deployed
 *    music worker, every preset reports `generationAvailable: false` (the
 *    API recomputes this from the private registry). They remain REAL for
 *    what they truthfully drive today: RIISHE lyric style preferences.
 *  - Branding: product GANGZII · lyrics intelligence RIISHE · platform
 *    BEAN Intelligence.
 */

// ---- voice presets ----------------------------------------------------------

export type VoiceCategoryId =
  | 'warm'
  | 'lively'
  | 'professional'
  | 'narrative'
  | 'clear'

export interface VoiceCategory {
  id: VoiceCategoryId
  label: string
  description: string
}

export const GANGZII_VOICE_CATEGORIES: VoiceCategory[] = [
  { id: 'warm', label: 'Warm & friendly', description: 'Approachable voices for greetings, companions and casual narration.' },
  { id: 'lively', label: 'Energetic & expressive', description: 'Bright, animated voices that carry emotion and momentum.' },
  { id: 'professional', label: 'Calm & professional', description: 'Composed, even-toned voices for announcements and explainers.' },
  { id: 'narrative', label: 'Cinematic & character', description: 'Distinctive character textures for storytelling and trailers.' },
  { id: 'clear', label: 'Natural & conversational', description: 'Clean everyday speech for reading and dialogue.' },
]

/**
 * Controls the TTS provider GENUINELY supports (measured 2026-10-27):
 * speaking speed only. Language selection, pitch and emotion controls are
 * NOT provider capabilities and are declared as such everywhere.
 */
export const GANGZII_VOICE_CONTROLS = {
  speed: true,
  language: false,
  pitch: false,
  emotion: false,
} as const

export interface GangziiVoicePreset {
  /** Stable ID — identical to the provider voice identifier (backward compatible). */
  id: string
  /** User-facing display name (consistent spelling everywhere). */
  displayName: string
  /** The underlying provider voice this preset maps to (never hidden). */
  providerVoiceId: string
  category: VoiceCategoryId
  description: string
  /** Short canned line used by the per-voice preview action. */
  previewText: string
  /**
   * Languages verified against the live provider for this voice set.
   * Chinese and English round-trips are measured; anything else is listed
   * as unverified rather than claimed.
   */
  languages: Array<{ lang: string; status: 'verified' | 'unverified' }>
}

const PREVIEW_LINE = 'Hi, I am GANGZII. This is a short preview of my voice.'

export const GANGZII_VOICE_PRESETS: GangziiVoicePreset[] = [
  {
    id: 'tongtong',
    displayName: 'Tongtong',
    providerVoiceId: 'tongtong',
    category: 'warm',
    description: 'Warm and friendly — the default GANGZII voice for gentle, personable reads.',
    previewText: PREVIEW_LINE,
    languages: [
      { lang: 'Chinese', status: 'verified' },
      { lang: 'English', status: 'verified' },
      { lang: 'Tamil', status: 'unverified' },
    ],
  },
  {
    id: 'chuichui',
    displayName: 'Chuichui',
    providerVoiceId: 'chuichui',
    category: 'lively',
    description: 'Lively and bright — playful energy for upbeat, expressive content.',
    previewText: PREVIEW_LINE,
    languages: [
      { lang: 'Chinese', status: 'verified' },
      { lang: 'English', status: 'verified' },
      { lang: 'Tamil', status: 'unverified' },
    ],
  },
  {
    id: 'xiaochen',
    displayName: 'Xiaochen',
    providerVoiceId: 'xiaochen',
    category: 'professional',
    description: 'Calm and professional — steady, composed delivery for explainers and updates.',
    previewText: PREVIEW_LINE,
    languages: [
      { lang: 'Chinese', status: 'verified' },
      { lang: 'English', status: 'verified' },
      { lang: 'Tamil', status: 'unverified' },
    ],
  },
  {
    id: 'jam',
    displayName: 'Jam',
    providerVoiceId: 'jam',
    category: 'narrative',
    description: 'British-gentleman tone — a distinctive narrative character voice.',
    previewText: PREVIEW_LINE,
    languages: [
      { lang: 'Chinese', status: 'verified' },
      { lang: 'English', status: 'verified' },
      { lang: 'Tamil', status: 'unverified' },
    ],
  },
  {
    id: 'kazi',
    displayName: 'Kazi',
    providerVoiceId: 'kazi',
    category: 'clear',
    description: 'Clear and standard — crisp neutral speech for information-dense reads.',
    previewText: PREVIEW_LINE,
    languages: [
      { lang: 'Chinese', status: 'verified' },
      { lang: 'English', status: 'verified' },
      { lang: 'Tamil', status: 'unverified' },
    ],
  },
  {
    id: 'douji',
    displayName: 'Douji',
    providerVoiceId: 'douji',
    category: 'clear',
    description: 'Natural and smooth — relaxed conversational flow.',
    previewText: PREVIEW_LINE,
    languages: [
      { lang: 'Chinese', status: 'verified' },
      { lang: 'English', status: 'verified' },
      { lang: 'Tamil', status: 'unverified' },
    ],
  },
  {
    id: 'luodo',
    displayName: 'Luodo',
    providerVoiceId: 'luodo',
    category: 'lively',
    description: 'Expressive and emotive — dynamic delivery for dramatic reads.',
    previewText: PREVIEW_LINE,
    languages: [
      { lang: 'Chinese', status: 'verified' },
      { lang: 'English', status: 'verified' },
      { lang: 'Tamil', status: 'unverified' },
    ],
  },
]

/**
 * Provider language truth (applies to the whole voice set): the gateway is
 * verified for Chinese and English synthesis. Tamil and other languages are
 * NOT verified on this provider — the UI states this instead of pretending.
 */
export const GANGZII_LANGUAGE_COVERAGE = {
  verified: ['Chinese', 'English'],
  unverifiedNotClaimed: ['Tamil', 'and other languages'],
  note:
    'The current speech provider is verified for Chinese and English. Tamil and other languages are not verified on this provider and are offered nowhere in GANGZII until measured.',
} as const

/** Flat provider-voice list (backward-compatible shape used by older code). */
export const GANGZII_VOICES = GANGZII_VOICE_PRESETS.map((v) => ({
  value: v.id,
  label: v.displayName,
  character: v.description.split(' — ')[0],
})) as ReadonlyArray<{ value: string; label: string; character: string }>

// ---- song presets -----------------------------------------------------------

export type SongVocalMode = 'sung' | 'instrumental'

export interface GangziiSongPreset {
  /** Stable preset ID (independent of display name). */
  id: string
  displayName: string
  description: string
  genre: string
  mood: string
  instrumentation: string[]
  /** 1 (calm) – 5 (festival). Descriptive metadata for RIISHE + future worker. */
  energy: 1 | 2 | 3 | 4 | 5
  vocalModes: SongVocalMode[]
  /** Suggested duration range for generation (seconds). */
  durationRangeSec: { min: number; max: number }
  /** Style hint fed to RIISHE when drafting lyrics for this preset. */
  lyricStyleHint: string
  /**
   * Whether the CURRENT platform can actually generate audio for this
   * preset. The backend recomputes this from the private backend registry
   * on every request; the static value below is the honest baseline.
   */
  generationAvailable: boolean
  /** Populated by the API from the registry when generationAvailable is false. */
  unavailableReason?: string
}

/**
 * The initial style catalogue requested for GANGZII Song Studio. Availability
 * is recomputed server-side from the backend registry — with no deployed
 * music worker every preset is truthfully unavailable for GENERATION while
 * still driving RIISHE lyric drafting, analysis and improvement.
 */
export const GANGZII_SONG_PRESETS: GangziiSongPreset[] = [
  {
    id: 'cinematic-orchestral',
    displayName: 'Cinematic orchestral',
    description: 'Sweeping strings, brass swells and timpani builds for film-scale moments.',
    genre: 'orchestral / cinematic',
    mood: 'epic, awe-filled',
    instrumentation: ['strings', 'brass', 'timpani', 'harp'],
    energy: 4,
    vocalModes: ['sung', 'instrumental'],
    durationRangeSec: { min: 45, max: 240 },
    lyricStyleHint: 'wide-screen imagery, rising emotional stakes, space for orchestral swells',
    generationAvailable: false,
  },
  {
    id: 'emotional-pop',
    displayName: 'Emotional pop',
    description: 'Heart-forward pop with piano, pad swells and a big singable chorus.',
    genre: 'pop',
    mood: 'sincere, moving',
    instrumentation: ['piano', 'synth pad', 'drums', 'bass'],
    energy: 3,
    vocalModes: ['sung'],
    durationRangeSec: { min: 45, max: 210 },
    lyricStyleHint: 'intimate verses, a soaring memorable chorus, honest everyday imagery',
    generationAvailable: false,
  },
  {
    id: 'electronic-pop',
    displayName: 'Electronic pop',
    description: 'Glossy synths, punchy drums and neon-late-night atmosphere.',
    genre: 'electronic pop',
    mood: 'neon, cinematic',
    instrumentation: ['synths', 'drum machine', 'bass'],
    energy: 4,
    vocalModes: ['sung'],
    durationRangeSec: { min: 45, max: 210 },
    lyricStyleHint: 'night-drive imagery, digital-age emotions, catchy hook-driven structure',
    generationAvailable: false,
  },
  {
    id: 'edm-festival',
    displayName: 'EDM & festival',
    description: 'Festival-scale drops, supersaws and high-BPM momentum.',
    genre: 'EDM',
    mood: 'euphoric, high-energy',
    instrumentation: ['supersaw synths', 'four-on-the-floor drums', 'sub bass'],
    energy: 5,
    vocalModes: ['sung', 'instrumental'],
    durationRangeSec: { min: 60, max: 240 },
    lyricStyleHint: 'chantable hooks, present-tense euphoria, minimal verses with big drops',
    generationAvailable: false,
  },
  {
    id: 'synthwave-retro',
    displayName: 'Synthwave & retro',
    description: 'Analog arpeggios, gated reverb drums and an 80s horizon glow.',
    genre: 'synthwave / retrowave',
    mood: 'nostalgic, wistful',
    instrumentation: ['analog synth', 'gated drums', 'electric guitar'],
    energy: 3,
    vocalModes: ['sung', 'instrumental'],
    durationRangeSec: { min: 45, max: 210 },
    lyricStyleHint: 'retro-futurist imagery, chrome-and-sunset metaphors, steady yearning',
    generationAvailable: false,
  },
  {
    id: 'dark-cinematic',
    displayName: 'Dark cinematic',
    description: 'Brooding pulses, low strings and tension that never fully releases.',
    genre: 'dark cinematic',
    mood: 'tense, brooding',
    instrumentation: ['low strings', 'sub pulses', 'percussion'],
    energy: 3,
    vocalModes: ['sung', 'instrumental'],
    durationRangeSec: { min: 45, max: 240 },
    lyricStyleHint: 'shadow-and-light contrast, restrained menace, short punchy lines',
    generationAvailable: false,
  },
  {
    id: 'lofi-chill',
    displayName: 'Lo-fi chill',
    description: 'Dusty drums, warm keys and vinyl crackle for late-night study sessions.',
    genre: 'lo-fi hip-hop',
    mood: 'calm, cozy',
    instrumentation: ['electric piano', 'dusty drums', 'vinyl texture'],
    energy: 2,
    vocalModes: ['sung', 'instrumental'],
    durationRangeSec: { min: 45, max: 180 },
    lyricStyleHint: 'small quiet moments, rain-on-window imagery, unhurried phrasing',
    generationAvailable: false,
  },
  {
    id: 'ambient',
    displayName: 'Ambient',
    description: 'Slow evolving pads and space — music as atmosphere, not foreground.',
    genre: 'ambient',
    mood: 'serene, weightless',
    instrumentation: ['pads', 'granular textures', 'soft bells'],
    energy: 1,
    vocalModes: ['instrumental'],
    durationRangeSec: { min: 60, max: 300 },
    lyricStyleHint: 'instrumental focus; if words appear, breath-like and sparse',
    generationAvailable: false,
  },
  {
    id: 'rock',
    displayName: 'Rock',
    description: 'Driven guitars, live drums and a chorus built for a big room.',
    genre: 'rock',
    mood: 'defiant, electric',
    instrumentation: ['electric guitars', 'bass', 'live drums'],
    energy: 4,
    vocalModes: ['sung'],
    durationRangeSec: { min: 45, max: 210 },
    lyricStyleHint: 'direct declarative lines, gritty imagery, an anthemic shout-along chorus',
    generationAvailable: false,
  },
  {
    id: 'hiphop-rap',
    displayName: 'Hip-hop & rap',
    description: 'Boom-bap to modern trap cadences over hard-hitting drums.',
    genre: 'hip-hop / rap',
    mood: 'confident, rhythmic',
    instrumentation: ['drums', '808 bass', 'sampled keys'],
    energy: 4,
    vocalModes: ['sung'],
    durationRangeSec: { min: 45, max: 210 },
    lyricStyleHint: 'dense internal rhyme, concrete storytelling, strong rhythmic punchlines',
    generationAvailable: false,
  },
  {
    id: 'acoustic',
    displayName: 'Acoustic',
    description: 'Fingerpicked guitars, soft percussion and close-mic intimacy.',
    genre: 'acoustic / singer-songwriter',
    mood: 'tender, personal',
    instrumentation: ['acoustic guitar', 'soft percussion', 'light strings'],
    energy: 2,
    vocalModes: ['sung'],
    durationRangeSec: { min: 45, max: 180 },
    lyricStyleHint: 'confessional detail, plain-spoken truth, one clear emotional through-line',
    generationAvailable: false,
  },
  {
    id: 'indian-fusion',
    displayName: 'Indian-inspired fusion',
    description: 'Raga-tinged melodies over contemporary production and percussion.',
    genre: 'Indian fusion',
    mood: 'rich, celebratory',
    instrumentation: ['sitar/flute textures', 'tabla-inspired percussion', 'modern bass'],
    energy: 4,
    vocalModes: ['sung'],
    durationRangeSec: { min: 45, max: 240 },
    lyricStyleHint: 'vivid colour and celebration, call-and-response hooks, flowing melisma-friendly lines',
    generationAvailable: false,
  },
  {
    id: 'tamil-pop',
    displayName: 'Tamil pop',
    description: 'Modern Tamil pop energy — catchy hooks over bright, danceable production.',
    genre: 'Tamil pop',
    mood: 'bright, joyful',
    instrumentation: ['syncopated drums', 'flute leads', 'bass grooves'],
    energy: 4,
    vocalModes: ['sung'],
    durationRangeSec: { min: 45, max: 210 },
    lyricStyleHint: 'playful hooks with Tamil phrasing sensibility, seasonal imagery, singable refrains',
    generationAvailable: false,
  },
  {
    id: 'tamil-melody',
    displayName: 'Tamil melody',
    description: 'Lush melodic balladry in the classic Tamil film-melody tradition.',
    genre: 'Tamil melody',
    mood: 'yearning, romantic',
    instrumentation: ['veena/strings', 'soft tabla', 'warm pads'],
    energy: 2,
    vocalModes: ['sung'],
    durationRangeSec: { min: 60, max: 240 },
    lyricStyleHint: 'poetic longing, nature metaphors, elegantly balanced syllables for melody',
    generationAvailable: false,
  },
  {
    id: 'instrumental-soundtrack',
    displayName: 'Instrumental soundtrack',
    description: 'Score-style instrumentals that carry a scene without words.',
    genre: 'instrumental / score',
    mood: 'purposeful, moving',
    instrumentation: ['strings', 'piano', 'hybrid percussion'],
    energy: 3,
    vocalModes: ['instrumental'],
    durationRangeSec: { min: 60, max: 300 },
    lyricStyleHint: 'no lyrics — instrumental only',
    generationAvailable: false,
  },
  {
    id: 'epic-trailer',
    displayName: 'Epic trailer music',
    description: 'Braams, staccato strings and massive hits engineered for trailers.',
    genre: 'trailer / epic',
    mood: 'monumental, urgent',
    instrumentation: ['braams', 'staccato strings', 'huge drums'],
    energy: 5,
    vocalModes: ['instrumental'],
    durationRangeSec: { min: 45, max: 180 },
    lyricStyleHint: 'no lyrics — instrumental only; structure in rising tension blocks',
    generationAvailable: false,
  },
]

/** Registry invariants enforced by unit tests. */
export function getSongPreset(id: string): GangziiSongPreset | undefined {
  return GANGZII_SONG_PRESETS.find((p) => p.id === id)
}

export function getVoicePreset(id: string): GangziiVoicePreset | undefined {
  return GANGZII_VOICE_PRESETS.find((v) => v.id === id)
}
