/**
 * BEAN Intelligence — LAXII natural-language capability detection tests.
 *
 * Pins the conversational routing contract: every example from the unified
 * studio specification lands on the correct EXISTING backend capability,
 * ambiguous requests ask a short clarification instead of guessing, and
 * dimension/upscale hints are extracted for the preserved generation and
 * enhancement engines.
 */
import { describe, test, expect } from 'bun:test'

import { detectIntent, INTENT_JOB_TASK } from '../../src/lib/laxii/intent'

const NO_IMAGE = { hasAttachedImage: false, conversationHasImage: false }
const WITH_IMAGE = { hasAttachedImage: true, conversationHasImage: false }
const PRIOR_IMAGE = { hasAttachedImage: false, conversationHasImage: true }

describe('specification examples route to the correct existing capability', () => {
  test('GENERATE: "Create a cinematic perfume advertisement."', () => {
    const d = detectIntent({ text: 'Create a cinematic perfume advertisement.', ...NO_IMAGE })
    expect(d.intent).toBe('generate')
    expect(INTENT_JOB_TASK[d.intent]).toBe('image-generation')
    expect(d.prompt).toContain('cinematic perfume advertisement')
  })

  test('EDIT: "Change the bottle cap to gold but preserve everything else."', () => {
    const d = detectIntent({ text: 'Change the bottle cap to gold but preserve everything else.', ...WITH_IMAGE })
    expect(d.intent).toBe('edit')
    expect(INTENT_JOB_TASK[d.intent]).toBe('image-editing')
  })

  test('BACKGROUND REMOVAL: "Remove the background and make it transparent."', () => {
    const d = detectIntent({ text: 'Remove the background and make it transparent.', ...WITH_IMAGE })
    expect(d.intent).toBe('bg-removal')
    expect(INTENT_JOB_TASK[d.intent]).toBe('image-editing')
  })

  test('ENHANCE: "Improve image sharpness, lighting and colors."', () => {
    const d = detectIntent({ text: 'Improve image sharpness, lighting and colors.', ...WITH_IMAGE })
    expect(d.intent).toBe('enhance')
    expect(INTENT_JOB_TASK[d.intent]).toBe('image-enhancement')
  })

  test('UPSCALE: "Upscale this image to 4K."', () => {
    const d = detectIntent({ text: 'Upscale this image to 4K.', ...WITH_IMAGE })
    expect(d.intent).toBe('upscale')
    expect(d.upscaleFactor).toBe(4)
    expect(INTENT_JOB_TASK[d.intent]).toBe('image-enhancement')
  })

  test('IMAGE-TO-IMAGE: "Transform this photo into a cinematic portrait."', () => {
    const d = detectIntent({ text: 'Transform this photo into a cinematic portrait.', ...WITH_IMAGE })
    expect(d.intent).toBe('image-to-image')
    expect(INTENT_JOB_TASK[d.intent]).toBe('image-editing')
  })

  test('MASKED EDITING: "Remove only the object on the left."', () => {
    const d = detectIntent({ text: 'Remove only the object on the left.', ...WITH_IMAGE })
    expect(d.intent).toBe('masked-edit')
    expect(d.maskMode).toBe('object-removal')
    expect(INTENT_JOB_TASK[d.intent]).toBe('image-editing')
  })

  test('MASKED EDITING (change): "Change only the logo on the left side."', () => {
    const d = detectIntent({ text: 'Change only the logo on the left side.', ...WITH_IMAGE })
    expect(d.intent).toBe('masked-edit')
    expect(d.maskMode).toBe('smart-edit')
  })
})

describe('clarify-instead-of-guess contract', () => {
  test('capability words without any image ask for one', () => {
    for (const text of [
      'Remove the background and make it transparent.',
      'Improve image sharpness, lighting and colors.',
      'Upscale this image to 4K.',
      'Change the bottle cap to gold.',
    ]) {
      const d = detectIntent({ text, ...NO_IMAGE })
      expect(d.intent).toBe('clarify')
      expect(d.clarifyQuestion).toMatch(/Which image|paperclip|generate one/i)
    }
  })

  test('attached image with no actionable verb asks what to do', () => {
    const d = detectIntent({ text: 'So here it is.', ...WITH_IMAGE })
    expect(d.intent).toBe('clarify')
    expect(d.clarifyQuestion).toMatch(/What should I do with this image/)
  })

  test('image-less fragment does not generate blindly', () => {
    const d = detectIntent({ text: 'hi', ...NO_IMAGE })
    expect(d.intent).toBe('clarify')
  })

  test('conversation image satisfies follow-up edits (no new upload)', () => {
    const d = detectIntent({ text: 'Now make the sky darker.', ...PRIOR_IMAGE })
    expect(d.intent).toBe('edit')
  })

  test('a plain descriptive sentence still generates', () => {
    const d = detectIntent({ text: 'A red fox in a snowy forest at dusk, soft light.', ...NO_IMAGE })
    expect(d.intent).toBe('generate')
  })
})

describe('dimension and ratio hints survive into the generation params', () => {
  test('explicit pixels become custom dimensions', () => {
    const d = detectIntent({ text: 'Create a wide poster at 1920x1080.', ...NO_IMAGE })
    expect(d.intent).toBe('generate')
    expect(d.width).toBe(1920)
    expect(d.height).toBe(1080)
  })

  test('aspect ratio snaps to the nearest supported preset', () => {
    const d = detectIntent({ text: 'Generate a movie banner in 16:9 style.', ...NO_IMAGE })
    expect(d.intent).toBe('generate')
    expect(d.size).toBe('1344x768')
  })

  test('aspect words map to presets (portrait / square / wide / tall)', () => {
    expect(detectIntent({ text: 'draw a tall bookmark design', ...NO_IMAGE }).size).toBe('720x1440')
    expect(detectIntent({ text: 'make a square avatar illustration', ...NO_IMAGE }).size).toBe('1024x1024')
    expect(detectIntent({ text: 'wide desktop wallpaper of mountains', ...NO_IMAGE }).size).toBe('1440x720')
  })

  test('out-of-bounds explicit dimensions are NOT passed through', () => {
    const d = detectIntent({ text: 'generate a mural at 8000x6000', ...NO_IMAGE })
    expect(d.width).toBeUndefined()
    expect(d.height).toBeUndefined()
    expect(d.intent).toBe('generate')
  })

  test('1080p phrasing maps to full-HD custom dimensions', () => {
    const d = detectIntent({ text: 'create a full hd wallpaper of a coastline', ...NO_IMAGE })
    expect(d.width).toBe(1920)
    expect(d.height).toBe(1080)
  })
})

describe('upscale factors and compound requests', () => {
  test('2x wording yields factor 2', () => {
    expect(detectIntent({ text: 'upscale this 2x', ...WITH_IMAGE }).upscaleFactor).toBe(2)
  })

  test('default upscale factor is 2', () => {
    expect(detectIntent({ text: 'upscale this image please', ...WITH_IMAGE }).upscaleFactor).toBe(2)
  })

  test('"upscale to 4K and sharpen" stays ONE enhancement job (not two)', () => {
    const d = detectIntent({ text: 'upscale this to 4k and also improve sharpness', ...WITH_IMAGE })
    expect(d.intent).toBe('upscale')
    expect(d.upscaleFactor).toBe(4)
  })
})

describe('background removal phrasing breadth', () => {
  test('cut out / isolate / no background variants all route to bg-removal', () => {
    for (const text of [
      'cut out the product from the photo',
      'isolate the subject',
      'give me a version with no background',
      'erase the backdrop',
      'delete the background',
    ]) {
      const d = detectIntent({ text, ...WITH_IMAGE })
      expect(d.intent).toBe('bg-removal')
    }
  })

  test('"remove only the object on the left" is NOT background removal', () => {
    const d = detectIntent({ text: 'Remove only the object on the left.', ...WITH_IMAGE })
    expect(d.intent).toBe('masked-edit')
  })
})
