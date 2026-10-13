import type { RichText } from './types'

export function plainText(rt: RichText | undefined | null): string {
  if (!Array.isArray(rt)) return ''
  let out = ''
  // Stored rich text is untrusted JSON: tolerate malformed spans instead of throwing.
  for (const span of rt) if (Array.isArray(span) && typeof span[0] === 'string') out += span[0]
  return out
}

export function toRichText(text: string): RichText {
  return text ? [[text]] : []
}
