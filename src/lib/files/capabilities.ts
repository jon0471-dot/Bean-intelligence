/**
 * BEAN Intelligence — upload capability detection.
 *
 * Decides what can HONESTLY be done with an uploaded file, from its name,
 * declared MIME type and ACTUAL bytes (magic signature) — never from the
 * extension alone. The detector never promises a capability the deployment
 * cannot deliver: unsupported files are stored with a clear explanation, not
 * silently "analyzed".
 *
 * Server-side only: runs on uploaded bytes, treat everything as untrusted.
 */

export type FileCapability =
  | 'text' // plain text-ish (txt/md/log/xml/html/json/csv…)
  | 'code' // source/config files (analyzed as text with language hint)
  | 'pdf'
  | 'docx'
  | 'data' // xlsx (tabular extraction)
  | 'image' // real vision analysis (createVision)
  | 'audio' // real transcription (hosted ASR) + ffprobe metadata
  | 'video' // ffprobe metadata + first-frame visual inspection
  | 'archive' // safe listing (no execution, no extraction by default)
  | 'binary' // stored, but no analyzer available today

export interface CapabilityPlan {
  capability: FileCapability
  /** Upper bound enforced server-side for this capability. */
  maxBytes: number
  /** Language hint for code files ("" when not applicable). */
  language: string
  /** True when the declared MIME disagrees with the detected signature. */
  mimeMismatch: boolean
}

/** Extension -> capability map (the picker accepts everything; this decides). */
const BY_EXTENSION: Record<string, { capability: FileCapability; language?: string }> = {
  // text
  txt: { capability: 'text' }, md: { capability: 'text' }, markdown: { capability: 'text' },
  log: { capability: 'text' }, text: { capability: 'text' }, rtf: { capability: 'text' },
  xml: { capability: 'text' }, html: { capability: 'text' }, htm: { capability: 'text' },
  yaml: { capability: 'text' }, yml: { capability: 'text' }, ini: { capability: 'text' },
  conf: { capability: 'text' }, env: { capability: 'text' },
  csv: { capability: 'text' }, tsv: { capability: 'text' },
  json: { capability: 'text' },
  sql: { capability: 'code', language: 'sql' },
  // code
  js: { capability: 'code', language: 'javascript' }, mjs: { capability: 'code', language: 'javascript' },
  cjs: { capability: 'code', language: 'javascript' }, jsx: { capability: 'code', language: 'javascript' },
  ts: { capability: 'code', language: 'typescript' }, tsx: { capability: 'code', language: 'typescript' },
  py: { capability: 'code', language: 'python' }, rb: { capability: 'code', language: 'ruby' },
  go: { capability: 'code', language: 'go' }, rs: { capability: 'code', language: 'rust' },
  java: { capability: 'code', language: 'java' }, kt: { capability: 'code', language: 'kotlin' },
  c: { capability: 'code', language: 'c' }, h: { capability: 'code', language: 'c' },
  cpp: { capability: 'code', language: 'cpp' }, hpp: { capability: 'code', language: 'cpp' },
  cs: { capability: 'code', language: 'csharp' }, sh: { capability: 'code', language: 'bash' },
  bash: { capability: 'code', language: 'bash' }, php: { capability: 'code', language: 'php' },
  swift: { capability: 'code', language: 'swift' }, css: { capability: 'code', language: 'css' },
  scss: { capability: 'code', language: 'scss' },
  // documents / data
  pdf: { capability: 'pdf' },
  docx: { capability: 'docx' },
  xlsx: { capability: 'data' },
  // images (vision-supported inputs)
  png: { capability: 'image' }, jpg: { capability: 'image' }, jpeg: { capability: 'image' },
  webp: { capability: 'image' }, gif: { capability: 'image' }, bmp: { capability: 'image' },
  // audio / video (ffmpeg + hosted ASR)
  wav: { capability: 'audio' }, mp3: { capability: 'audio' }, m4a: { capability: 'audio' },
  aac: { capability: 'audio' }, ogg: { capability: 'audio' }, oga: { capability: 'audio' },
  flac: { capability: 'audio' }, opus: { capability: 'audio' }, webm: { capability: 'video' },
  mp4: { capability: 'video' }, mov: { capability: 'video' }, mkv: { capability: 'video' },
  avi: { capability: 'video' },
  // archives
  zip: { capability: 'archive' },
}

/** Hard per-capability upload ceilings (server-enforced; browser caps are UX only). */
export const CAPABILITY_LIMITS: Record<FileCapability, number> = {
  text: 10 * 1024 * 1024,
  code: 10 * 1024 * 1024,
  pdf: 15 * 1024 * 1024,
  docx: 15 * 1024 * 1024,
  data: 15 * 1024 * 1024,
  image: 10 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  video: 30 * 1024 * 1024,
  archive: 20 * 1024 * 1024,
  binary: 10 * 1024 * 1024,
}

/**
 * Magic-signature sniffing (first bytes decide, extensions only break ties).
 * Everything runs on the REAL bytes so a renamed .exe cannot pose as text.
 */
export function detectMagic(bytes: Uint8Array): string {
  const b = bytes
  const starts = (sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v)
  const ascii = (offset: number, s: string) =>
    s.split('').every((ch, i) => b[offset + i] === ch.charCodeAt(0))
  if (b.length < 8) return 'truncated'
  if (starts([0x89, 0x50, 0x4e, 0x47])) return 'image/png'
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (ascii(0, 'GIF8')) return 'image/gif'
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp'
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav'
  if (ascii(0, 'OggS')) return 'audio/ogg'
  if (ascii(0, 'fLaC')) return 'audio/flac'
  if (starts([0xff, 0xfb]) || starts([0xff, 0xf3]) || starts([0xff, 0xf2]) || ascii(0, 'ID3')) return 'audio/mpeg'
  if (starts([0x50, 0x4b, 0x03, 0x04]) || starts([0x50, 0x4b, 0x05, 0x06])) return 'application/zip'
  if (ascii(0, '%PDF')) return 'application/pdf'
  if (b.length > 11 && ascii(4, 'ftyp')) return 'video/mp4'
  if (ascii(0, '\x1aE\xdf\xa3')) return 'video/webm' // EBML (mkv/webm)
  if (starts([0x7f, 0x45, 0x4c, 0x46])) return 'executable/elf'
  if (starts([0x4d, 0x5a])) return 'executable/pe'
  if (starts([0xca, 0xfe, 0xba, 0xbe])) return 'executable/java-class'
  // mostly-printable heuristic for extension-less text
  const sample = b.subarray(0, Math.min(1024, b.length))
  let printable = 0
  for (const v of sample) {
    if (v === 0x09 || v === 0x0a || v === 0x0d || (v >= 0x20 && v < 0x7f) || v >= 0xc2) printable += 1
  }
  if (printable / sample.length > 0.94) return 'text/plain'
  return 'application/octet-stream'
}

const MIME_PREFIX_CAPABILITY: Array<[string, FileCapability]> = [
  ['image/', 'image'],
  ['audio/', 'audio'],
  ['video/', 'video'],
  ['text/', 'text'],
]

/**
 * Full detection: extension + declared MIME + real bytes must agree before a
 * capability is granted; disagreements downgrade honestly (a .png that is
 * really a ZIP becomes an archive, not a fake image analysis).
 */
export function detectCapability(name: string, declaredMime: string, bytes: Uint8Array): CapabilityPlan {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  const magic = detectMagic(bytes)
  const mapped = BY_EXTENSION[ext]

  const isZipMagic = magic === 'application/zip'
  // Office formats are ZIP containers — extension decides which parser runs.
  if (isZipMagic && (ext === 'docx' || ext === 'xlsx')) {
    return { capability: mapped!.capability, maxBytes: CAPABILITY_LIMITS[mapped!.capability], language: '', mimeMismatch: false }
  }

  let capability: FileCapability = 'binary'
  let language = ''
  if (magic === 'image/png' || magic === 'image/jpeg' || magic === 'image/gif' || magic === 'image/webp') {
    capability = 'image'
  } else if (magic === 'application/pdf') {
    capability = 'pdf'
  } else if (magic === 'audio/wav' || magic === 'audio/ogg' || magic === 'audio/flac' || magic === 'audio/mpeg') {
    capability = 'audio'
  } else if (magic === 'video/mp4' || magic === 'video/webm') {
    capability = 'video'
  } else if (magic === 'application/zip') {
    capability = 'archive'
  } else if (magic === 'text/plain') {
    const fromExt = mapped?.capability === 'code' || mapped?.capability === 'text'
    capability = fromExt ? mapped!.capability : 'text'
    language = mapped?.language ?? ''
  } else if (mapped && declaredMime) {
    // Unknown signature: fall back to the extension mapping ONLY when the
    // declared MIME agrees with it (defense against disguise-by-rename).
    const prefixOk = MIME_PREFIX_CAPABILITY.some(
      ([p, cap]) => declaredMime.startsWith(p) && cap === mapped.capability,
    )
    if (prefixOk || declaredMime === 'application/zip' || declaredMime.includes('officedocument')) {
      capability = mapped.capability
      language = mapped.language ?? ''
    }
  }

  const mimeMismatch =
    declaredMime.length > 0 &&
    magic !== 'truncated' &&
    magic !== 'application/octet-stream' &&
    !declaredMime.startsWith(magic.split('/')[0]) &&
    !(capability === 'docx' || capability === 'data') &&
    !(magic === 'application/zip' && declaredMime.includes('officedocument'))

  return { capability, maxBytes: CAPABILITY_LIMITS[capability], language, mimeMismatch }
}

/** Human-honest explanation for capability-less files. */
export function unsupportedNote(capability: FileCapability, magic: string): string | null {
  if (capability === 'binary') {
    if (magic.startsWith('executable/')) {
      return 'Executable binaries are never run or decompiled here — upload source code or a document instead.'
    }
    return 'No analyzer is available for this file format, so its content cannot be read into the conversation.'
  }
  return null
}
