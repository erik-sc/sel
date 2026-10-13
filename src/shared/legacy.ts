/**
 * Until its first release the app was called Selida, and wrote that name into what it stored:
 * the addresses of images (`selida-file://`), links to pages (`selida://`), its files in a sync
 * repository, the theme files it exported. Everything that still reads the old name is here or
 * refers to here.
 */
export const LEGACY_NAME = 'selida'

const LEGACY_URL_RE = /selida(-file)?:\/\//gi

/** `text` (JSON, CSS, anything stored) with the addresses of the old name written as today's. */
export function modernizeUrls(text: string): string {
  return /selida/i.test(text) ? text.replace(LEGACY_URL_RE, (_all, file: string | undefined) => `sel${file ? '-file' : ''}://`) : text
}
