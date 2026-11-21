/**
 * BEAN Intelligence — LAXII local conversational edit engine (M26.2).
 *
 * Parses a natural-language modification instruction into a CONSERVATIVE,
 * fully-executable edit plan and executes it with real per-pixel operations:
 *
 *  - tone/look ops: brightness, contrast, saturation, warmth, grayscale,
 *    sepia, sharpen, vignette (sharp, deterministic, measured);
 *  - background ops: blur-background (portrait mode), recolor-background —
 *    driven by the REAL matting model (segmentation.ts);
 *  - remove-masked: REAL LaMa structural inpainting inside an explicit
 *    user mask (or the existing brush-mask flow);
 *  - geometry ops (rotate/flip): DESTRUCTIVE — executed only with explicit
 *    user approval in the submit request.
 *
 * Honesty rules:
 *  - instructions that require generative synthesis BEAN cannot genuinely
 *    perform locally (add/insert/restyle objects, restyle scenes) are
 *    reported in `unsupported` and the job FAILS with that exact reason —
 *    no silent no-op, no fake success, no pretending the hosted lane ran;
 *  - the original asset is never modified; every op's parameters and engine
 *    are recorded in the job provenance;
 *  - an empty plan (nothing recognizable) is an honest validation error.
 */
import sharp from 'sharp'
import { decodeRaw, runBestMatte, alphaToRgba, flattenOnColor, parseBackgroundColor, type RawImage } from './segmentation'
import { lamaInstalled, lamaInpaint } from './inpaint-local'

export type LocalEditOpType =
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'warmth'
  | 'grayscale'
  | 'sepia'
  | 'sharpen'
  | 'vignette'
  | 'blur-background'
  | 'recolor-background'
  | 'rotate'
  | 'flip'
  | 'remove-masked'

export interface LocalEditOp {
  type: LocalEditOpType
  amount?: number
  color?: string
  direction?: string
  region?: 'background' | 'masked'
  destructive: boolean
  requiresMatte?: boolean
  requiresLama?: boolean
  sourceText: string
}

export interface LocalEditPlan {
  ops: LocalEditOp[]
  /** Instruction fragments needing generative synthesis not available locally. */
  unsupported: string[]
}

export interface ExecutedOp {
  type: LocalEditOpType
  params: Record<string, unknown>
  engine: string
  [k: string]: unknown
}

export interface LocalEditExecution {
  rgb: Uint8Array
  width: number
  height: number
  executed: ExecutedOp[]
  matteModel?: string
}

const INTENSITY_STRONG = /\b(much|a\s?lot|significantly|strongly|heavily|way)\b/i
const INTENSITY_SUBTLE = /\b(slightly|subtle|a\s?bit|a\s?little|gently|barely)\b/i

function intensity(lower: string): number {
  if (INTENSITY_STRONG.test(lower)) return 0.45
  if (INTENSITY_SUBTLE.test(lower)) return 0.1
  return 0.25
}

const BG_WORD = /\b(background|backdrop|bg)\b/i

/** Parse one instruction into a conservative executable plan. */
export function parseLocalEditPlan(instruction: string): LocalEditPlan {
  const text = instruction.trim()
  const lower = text.toLowerCase()
  const ops: LocalEditOp[] = []
  const unsupported: string[] = []
  const amt = intensity(lower)
  const push = (op: LocalEditOp) => ops.push(op)

  // --- tone/look ------------------------------------------------------------
  if (/\b(brighten|brighter|more light|lighter)\b/i.test(lower)) {
    push({ type: 'brightness', amount: +amt, destructive: false, sourceText: 'brighten' })
  }
  if (/\b(darken|darker|dim)\b/i.test(lower)) {
    push({ type: 'brightness', amount: -amt, destructive: false, sourceText: 'darken' })
  }
  if (/\b(more contrast|higher contrast|punchier|stronger contrast)\b/i.test(lower)) {
    push({ type: 'contrast', amount: +amt, destructive: false, sourceText: 'raise contrast' })
  }
  if (/\b(less contrast|lower contrast|flatter|softer contrast)\b/i.test(lower)) {
    push({ type: 'contrast', amount: -amt, destructive: false, sourceText: 'lower contrast' })
  }
  if (/\b(more colorful|more saturated|boost (the )?colou?rs?|vibrant|more vivid)\b/i.test(lower)) {
    push({ type: 'saturation', amount: +amt, destructive: false, sourceText: 'boost saturation' })
  }
  if (/\b(less colorful|less saturated|desaturate|muted colou?rs?)\b/i.test(lower)) {
    push({ type: 'saturation', amount: -amt, destructive: false, sourceText: 'reduce saturation' })
  }
  if (/\b(warmer|warm(er)? (it|tone|the) (up)?|golden tone)\b/i.test(lower)) {
    push({ type: 'warmth', amount: +amt, destructive: false, sourceText: 'warmer' })
  }
  if (/\b(cooler|colder|cool(er)? (tone|the)|blue(r)? tone)\b/i.test(lower)) {
    push({ type: 'warmth', amount: -amt, destructive: false, sourceText: 'cooler' })
  }
  if (/\b(black and white|gre?yscale|monochrome|b\s?&\s?w)\b/i.test(lower)) {
    push({ type: 'grayscale', destructive: false, sourceText: 'grayscale' })
  }
  if (/\b(sepia|vintage (look|tone|feel)|antique)\b/i.test(lower)) {
    push({ type: 'sepia', destructive: false, sourceText: 'sepia' })
  }
  if (/\b(sharpen|sharper|crisper|more detail)\b/i.test(lower)) {
    push({ type: 'sharpen', destructive: false, sourceText: 'sharpen' })
  }
  if (/\bvignette\b/i.test(lower)) {
    push({ type: 'vignette', amount: amt, destructive: false, sourceText: 'vignette' })
  }

  // --- background ops (need the matte) ---------------------------------------
  if (/\b(blur|soften|bokeh|defocus)\b[^.!?]*\b(background|backdrop|bg)\b/i.test(lower) || /\bportrait mode\b/i.test(lower)) {
    push({ type: 'blur-background', amount: amt, region: 'background', destructive: false, requiresMatte: true, sourceText: 'blur the background' })
  }
  const bgRecolor = /\bbackground\b[^.!?]*\b(to\s*)?(white|black|#[0-9a-f]{3,6})\b/i.test(lower) ||
    /\b(white|black)\s+(background|backdrop)\b/i.test(lower) ||
    /(?:^|\s)(#[0-9a-f]{3,6})\s*(?:\s)*(background|backdrop)/i.test(lower)
  if (bgRecolor) {
    const colorMatch = /#[0-9a-f]{3,6}/i.exec(lower)?.[0] ?? (/\bblack\b/.test(lower) ? 'black' : 'white')
    push({ type: 'recolor-background', color: colorMatch, region: 'background', destructive: false, requiresMatte: true, sourceText: `recolor background to ${colorMatch}` })
  }

  // --- geometry (destructive — approval required) ----------------------------
  const rotate = /\brotate\b[^.!?]*\b(left|right|clockwise|counter-?clockwise|90|180|270)\b/i.exec(lower)
  if (rotate) {
    const d = rotate[1].toLowerCase()
    const dir = d.includes('left') || d.includes('counter') ? 'ccw' : 'cw'
    const deg = /\b(180|270)\b/.test(d) ? (d === '180' ? 180 : 270) : 90
    push({ type: 'rotate', direction: dir, amount: deg, destructive: true, sourceText: `rotate ${dir} ${deg}°` })
  }
  const flip = /\bflip\b[^.!?]*\b(horizontall?y?|verticall?y?|mirror)\b/i.exec(lower)
  if (flip) {
    const d = flip[1].toLowerCase()
    push({ type: 'flip', direction: d.includes('v') && !d.includes('horiz') ? 'vertical' : 'horizontal', destructive: true, sourceText: `flip ${d}` })
  }

  // --- removal (needs an explicit mask + LaMa) -------------------------------
  if (/\b(remove|delete|erase|get\s?rid\s?of|take\s?out|clean\s?up)\b/i.test(lower) && !/\b(background|backdrop|bg)\b/i.test(lower)) {
    push({ type: 'remove-masked', region: 'masked', destructive: false, requiresLama: true, sourceText: 'remove the masked content' })
  }

  // --- known-generative instructions we cannot honestly run locally ----------
  if (/\b(add|put|insert|place|give (me|it)|draw|paint)\b[^.!?]*\b(a|an|the|some|new)\b/i.test(lower) && !/\b(vignette)\b/i.test(lower)) {
    unsupported.push(`'${text}' asks to ADD new content — generative synthesis that the local engine cannot honestly perform`)
  }
  if (/\b(turn|transform|convert|restyle|make (it|this) (look|into)|change (it|the) (style|hair|face|clothes|outfit))\b/i.test(lower)) {
    unsupported.push(`'${text}' asks for a whole-image generative restyle — the local engine only executes explicit pixel operations`)
  }

  return { ops, unsupported }
}

/** True when the plan contains destructive ops needing explicit approval. */
export function planRequiresApproval(plan: LocalEditPlan): boolean {
  return plan.ops.some((op) => op.destructive)
}

/** The plan needs the matting model / LaMa — check honest availability. */
export function planRequirements(plan: LocalEditPlan): { needsMatte: boolean; needsLama: boolean } {
  return {
    needsMatte: plan.ops.some((op) => op.requiresMatte || op.type === 'blur-background' || op.type === 'recolor-background'),
    needsLama: plan.ops.some((op) => op.requiresLama || op.type === 'remove-masked'),
  }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function linearContrast(amount: number): { a: number; b: number } {
  const a = 1 + amount
  return { a, b: -(128 * (a - 1)) }
}

/** Execute the plan — every op is REAL, measured and recorded. */
export async function executeLocalEditPlan(
  imageBytes: Buffer,
  plan: LocalEditPlan,
  opts: { mask?: { data: Uint8Array; width: number; height: number } } = {},
): Promise<LocalEditExecution> {
  const source = await decodeRaw(imageBytes)
  let img: RawImage = source
  const executed: ExecutedOp[] = []
  let matteModel: string | undefined
  let rotated = false

  for (const op of plan.ops) {
    const pipe = () => sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } })
    switch (op.type) {
      case 'brightness': {
        const b = 1 + (op.amount ?? 0.25)
        img = { data: await pipe().modulate({ brightness: b }).raw().toBuffer(), width: img.width, height: img.height }
        executed.push({ type: op.type, params: { brightness: +b.toFixed(3) }, engine: 'sharp' })
        break
      }
      case 'saturation': {
        const s = Math.max(0, 1 + (op.amount ?? 0.25))
        img = { data: await pipe().modulate({ saturation: s }).raw().toBuffer(), width: img.width, height: img.height }
        executed.push({ type: op.type, params: { saturation: +s.toFixed(3) }, engine: 'sharp' })
        break
      }
      case 'contrast': {
        const { a, b } = linearContrast(op.amount ?? 0.25)
        img = { data: await pipe().linear([a, a, a], [b, b, b]).raw().toBuffer(), width: img.width, height: img.height }
        executed.push({ type: op.type, params: { a: +a.toFixed(3), b: +b.toFixed(3) }, engine: 'sharp' })
        break
      }
      case 'warmth': {
        const t = op.amount ?? 0.25
        // Warm: red up / blue down; cool: the reverse. Per-channel linear.
        const r = 1 + t * 0.35
        const bl = 1 - t * 0.35
        img = {
          data: await pipe()
            .linear([Math.max(0.5, r), 1, Math.max(0.5, bl)], [0, 0, 0])
            .raw()
            .toBuffer(),
          width: img.width,
          height: img.height,
        }
        executed.push({ type: op.type, params: { warmth: t }, engine: 'sharp' })
        break
      }
      case 'grayscale': {
        img = { data: await pipe().grayscale().raw().toBuffer(), width: img.width, height: img.height }
        executed.push({ type: op.type, params: {}, engine: 'sharp' })
        break
      }
      case 'sepia': {
        img = { data: await pipe().grayscale().tint({ r: 194, g: 158, b: 112 }).raw().toBuffer(), width: img.width, height: img.height }
        executed.push({ type: op.type, params: { tint: '#c29e70' }, engine: 'sharp' })
        break
      }
      case 'sharpen': {
        img = { data: await pipe().sharpen({ sigma: 1.2 }).raw().toBuffer(), width: img.width, height: img.height }
        executed.push({ type: op.type, params: { sigma: 1.2 }, engine: 'sharp' })
        break
      }
      case 'vignette': {
        const strength = Math.max(0.2, Math.min(0.8, (op.amount ?? 0.25) + 0.15))
        const svg = `<svg width="${img.width}" height="${img.height}"><defs><radialGradient id="g" cx="50%" cy="50%" r="70%"><stop offset="55%" stop-color="black" stop-opacity="0"/><stop offset="100%" stop-color="black" stop-opacity="${strength}"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`
        const overlay = await sharp(Buffer.from(svg)).png().raw().toBuffer()
        const out = Buffer.alloc(img.data.length)
        for (let p = 0; p < img.width * img.height; p++) {
          const a = overlay[p * 4 + 3] / 255
          for (let c = 0; c < 3; c++) {
            out[p * 3 + c] = Math.round(img.data[p * 3 + c] * (1 - a))
          }
        }
        img = { data: out, width: img.width, height: img.height }
        executed.push({ type: op.type, params: { strength: +strength.toFixed(2) }, engine: 'sharp' })
        break
      }
      case 'blur-background':
      case 'recolor-background': {
        const matte = await runBestMatte(img)
        if (!matte.usable) throw new Error(`Background operation could not find a usable subject: ${matte.rejection}`)
        matteModel = matte.stats.model
        const rgba = alphaToRgba(img, matte.alpha)
        if (op.type === 'blur-background') {
          const sigma = Math.max(2, Math.min(24, Math.round(4 + (op.amount ?? 0.25) * 28)))
          const blurred = await pipe().blur(sigma).raw().toBuffer()
          const out = Buffer.alloc(img.data.length)
          for (let p = 0; p < img.width * img.height; p++) {
            const a = matte.alpha[p]
            for (let c = 0; c < 3; c++) {
              out[p * 3 + c] = Math.round(img.data[p * 3 + c] * a + blurred[p * 3 + c] * (1 - a))
            }
          }
          img = { data: out, width: img.width, height: img.height }
          executed.push({ type: op.type, params: { sigma, matteModel: matte.stats.model }, engine: 'matte+sharp' })
        } else {
          const color = parseBackgroundColor(op.color ?? '#ffffff')
          const rgb = flattenOnColor(rgba, img.width, img.height, color)
          img = { data: rgb, width: img.width, height: img.height }
          executed.push({ type: op.type, params: { color: op.color ?? '#ffffff', matteModel: matte.stats.model }, engine: 'matte+sharp' })
        }
        break
      }
      case 'rotate': {
        const deg = op.amount === 270 ? 270 : op.amount === 180 ? 180 : 90
        const rotatedSharp = deg === 180 ? pipe().rotate(180) : op.direction === 'ccw' ? pipe().rotate(-90) : pipe().rotate(90)
        const meta = await rotatedSharp.toBuffer({ resolveWithObject: true })
        img = { data: await sharp(meta.data).removeAlpha().raw().toBuffer(), width: meta.info.width, height: meta.info.height }
        rotated = true
        executed.push({ type: op.type, params: { degrees: deg, direction: op.direction }, engine: 'sharp' })
        break
      }
      case 'flip': {
        const flipped = op.direction === 'vertical' ? pipe().flip() : pipe().flop()
        img = { data: await flipped.raw().toBuffer(), width: img.width, height: img.height }
        executed.push({ type: op.type, params: { direction: op.direction }, engine: 'sharp' })
        break
      }
      case 'remove-masked': {
        if (!opts.mask) {
          throw new Error(
            'Removal needs an explicit region: brush a mask over the content to remove (the local engine never guesses which pixels to delete).',
          )
        }
        if (!lamaInstalled()) {
          throw new Error(
            "Structural removal needs the local LaMa inpainting model, which is not installed on this host. Install it explicitly ('lama' — see the deployment guide). Your image was not modified.",
          )
        }
        const result = await lamaInpaint(img, opts.mask)
        img = { data: result.rgb, width: result.width, height: result.height }
        executed.push({ type: op.type, params: { maskedPixels: result.stats.maskedPixels, latencyMs: result.stats.latencyMs }, engine: 'lama-onnx' })
        break
      }
      default: {
        const exhaustive: never = op.type
        throw new Error(`Unsupported edit op: ${String(exhaustive)}`)
      }
    }
  }
  void rotated
  return { rgb: img.data, width: img.width, height: img.height, executed, matteModel }
}
