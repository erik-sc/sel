import { open } from 'node:fs/promises'

/** Reads a file the user picked, refusing anything that is not a regular file within `max` bytes. */
export async function readFileCapped(file: string, max: number, tooLarge: string): Promise<Buffer> {
  const handle = await open(file, 'r')
  try {
    // Checked on the open handle, so the file cannot be swapped between the check and the read.
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('Not a file')
    if (info.size > max) throw new Error(tooLarge)
    const data = await handle.readFile()
    if (data.byteLength > max) throw new Error(tooLarge)
    return data
  } finally {
    await handle.close()
  }
}
