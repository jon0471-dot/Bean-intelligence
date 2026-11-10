/**
 * BEAN Intelligence — file signature (magic byte) detection.
 *
 * The extension and declared MIME type are client-controlled CLAIMS. The
 * signature is the only fact. Uploads whose signature contradicts their
 * claim are rejected (spoofed images, executables renamed to .txt, etc.).
 */

export type SignatureFamily =
  | 'pdf'
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'bmp'
  | 'zip' // docx/xlsx/odt/jar are zip family too — kind decides handling
  | 'gzip'
  | 'wav'
  | 'mp3'
  | 'mp4'
  | 'ogg'
  | 'flac'
  | 'avi' // RIFF....AVI
  | 'mkv' // EBML (mkv/webm)
  | 'elf'
  | 'pe' // Windows PE (exe/dll)
  | 'macho'
  | 'text'
  | 'binary'

export interface SignatureInfo {
  family: SignatureFamily
}

function startsWith(b: Buffer, bytes: number[], offset = 0): boolean {
  if (b.length < offset + bytes.length) return false
  return bytes.every((v, i) => b[offset + i] === v)
}

function isLikelyText(b: Buffer): boolean {
  // Sample up to the first 8 KiB: reject when NUL bytes or an unusual share
  // of control characters appear (UTF-16 text without BOM, binary blobs).
  const n = Math.min(b.length, 8192)
  if (n === 0) return true
  let control = 0
  for (let i = 0; i < n; i++) {
    const c = b[i]
    if (c === 0) return false
    if (c < 9 || (c > 13 && c < 32)) control += 1
  }
  return control / n < 0.05
}

export function sniffSignature(b: Buffer): SignatureInfo {
  if (b.length === 0) return { family: 'binary' }
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46])) return { family: 'pdf' } // %PDF
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { family: 'png' }
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { family: 'jpeg' }
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return { family: 'gif' } // GIF8
  if (b.length >= 12 && startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { family: 'webp' } // RIFF....WEBP
  }
  if (startsWith(b, [0x42, 0x4d])) return { family: 'bmp' } // BM
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]) || startsWith(b, [0x50, 0x4b, 0x07, 0x08])) {
    return { family: 'zip' } // PK
  }
  if (startsWith(b, [0x1f, 0x8b])) return { family: 'gzip' }
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x41, 0x56, 0x45], 8)) {
    return { family: 'wav' } // RIFF....WAVE
  }
  if (startsWith(b, [0x49, 0x44, 0x33]) || (startsWith(b, [0xff, 0xfb]) || startsWith(b, [0xff, 0xf3]) || startsWith(b, [0xff, 0xf2]))) {
    return { family: 'mp3' } // ID3 or MPEG frame sync
  }
  if (b.length >= 12 && startsWith(b, [0x66, 0x74, 0x79, 0x70], 4)) {
    return { family: 'mp4' } // ....ftyp
  }
  if (startsWith(b, [0x4f, 0x67, 0x67, 0x53])) return { family: 'ogg' } // OggS
  if (startsWith(b, [0x66, 0x4c, 0x61, 0x43])) return { family: 'flac' } // fLaC
  if (b.length >= 12 && startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x41, 0x56, 0x49, 0x20], 8)) {
    return { family: 'avi' } // RIFF....AVI
  }
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return { family: 'mkv' } // EBML
  if (startsWith(b, [0x7f, 0x45, 0x4c, 0x46])) return { family: 'elf' }
  if (startsWith(b, [0x4d, 0x5a])) return { family: 'pe' } // MZ
  if (b.length >= 4 && b.readUInt32BE(0) === 0xfeedface) return { family: 'macho' }
  if (isLikelyText(b)) return { family: 'text' }
  return { family: 'binary' }
}

/**
 * Consistency check between what the file CLAIMS to be (from its extension)
 * and what its signature says. Returns an error message when the claim is
 * provably false or the payload is dangerous; null when consistent.
 */
export function signatureMismatch(kind: string, sig: SignatureFamily): string | null {
  // Executable payloads are refused no matter what they claim to be.
  if (sig === 'elf' || sig === 'pe' || sig === 'macho') {
    return 'This file is an executable program. Executables cannot be processed for safety.'
  }
  switch (kind) {
    case 'pdf':
      return sig === 'pdf' || sig === 'text' ? null : 'This file is not a valid PDF (its contents do not match the .pdf extension).'
    case 'docx':
    case 'xlsx':
      // Office formats are zip containers; a plain-text file renamed .docx is rejected.
      return sig === 'zip' ? null : 'This file is not a valid Office document (its contents do not match the extension).'
    case 'image':
      if (sig === 'png' || sig === 'jpeg' || sig === 'gif' || sig === 'webp' || sig === 'bmp') return null
      return 'This file is not a recognized image format (its contents do not match the extension).'
    case 'archive':
      return sig === 'zip' || sig === 'gzip' ? null : 'This file is not a valid zip/gzip archive (its contents do not match the extension).'
    case 'audio':
      if (sig === 'mp3' || sig === 'wav' || sig === 'ogg' || sig === 'flac' || sig === 'mp4' || sig === 'avi' || sig === 'mkv' || sig === 'binary') return null
      // ffprobe is the authority; accept container formats the sniffer cannot name.
      return 'This file is not a recognized audio/video format (its contents do not match the extension).'
    case 'video':
      if (sig === 'mp4' || sig === 'ogg' || sig === 'avi' || sig === 'mkv' || sig === 'binary') return null
      return 'This file is not a recognized audio/video format (its contents do not match the extension).'
    case 'text':
    case 'csv':
    case 'json':
    case 'code':
    case 'html':
    case 'xml':
    case 'rtf':
      // Text-family kinds must actually be text (or RTF, which is ASCII-based).
      if (sig === 'text' || sig === 'binary') return null
      return 'This file contains binary data, not text (its contents do not match the extension).'
    default:
      return null
  }
}
