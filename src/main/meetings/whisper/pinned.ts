import type { WhisperModelId } from '../../../shared/meetings'

/**
 * Exactly what sel may download for transcription, and what each file must hash to. A
 * download is renamed into place only when its SHA-256 equals the digest written here, so a
 * changed file on the server, a hijacked redirect or a damaged transfer all end the same way:
 * the file is deleted and nothing of it is ever run or loaded.
 *
 * HOW TO REFRESH (read-only requests; nothing is downloaded or run to do it)
 *
 *   Program. whisper.cpp publishes its binaries under a build tag next to each version tag
 *   (v1.9.5 has no files of its own; its release notes name build `b5454`, the same commit):
 *     curl -s https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/<build tag>
 *   Each asset has `name`, `size` and `digest` ("sha256:<hex>"). Take the CPU builds:
 *   `whisper-bin-x64.zip` (Windows x64) and `whisper-bin-win-cpu-arm64.zip` (Windows on Arm).
 *   The same release also has BLAS (`whisper-blas-bin-x64.zip`), CUDA 11.8 / 12.4
 *   (`whisper-bin-win-cuda-*-x64.zip`), 32-bit and Ubuntu tarballs; none of those is offered.
 *
 *   Models.
 *     curl -s https://huggingface.co/api/models/ggerganov/whisper.cpp            → `sha` (the revision)
 *     curl -s https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/main  → per file `size`, `lfs.oid` (the SHA-256)
 *   The address names the revision, so the bytes behind it cannot change.
 *
 * Read on 2026-10-13.
 */

export interface PinnedFile {
  url: string
  /** Exact size in bytes; a response that is longer is cut off and refused. */
  size: number
  /** Lower-case hex SHA-256. */
  sha256: string
}

export interface PinnedSet {
  /** The whisper.cpp version the build belongs to, as shown to the user. */
  version: string
  /** `<process.platform>-<process.arch>` → the archive with `whisper-cli` for it. */
  programs: Record<string, PinnedFile>
  models: Record<WhisperModelId, PinnedFile & { file: string }>
}

const RELEASE = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454'
/** The revision of huggingface.co/ggerganov/whisper.cpp the model digests were read from. */
const MODELS_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1'
const MODELS = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODELS_REVISION}`

export const PINNED: PinnedSet = {
  // Tag v1.9.5 and build b5454 are commit d1be6fde11ac6e0407606b4e42fe72d34add8037.
  version: '1.9.5',
  programs: {
    'win32-x64': { url: `${RELEASE}/whisper-bin-x64.zip`, size: 8_928_640, sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb' },
    'win32-arm64': { url: `${RELEASE}/whisper-bin-win-cpu-arm64.zip`, size: 4_371_193, sha256: '28c37e7b598c3d9bbfef94f3bd67f2ee6f12b7c86f3da5edcf5e4308d615ff6d' }
    // macOS and Linux: no archive with a ready `whisper-cli` and a digest that sel unpacks
    // (the Ubuntu builds are tarballs, there is none for macOS). There the user chooses a
    // program and a model file themselves.
  },
  models: {
    base: { file: 'ggml-base.bin', url: `${MODELS}/ggml-base.bin`, size: 147_951_465, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe' },
    small: { file: 'ggml-small.bin', url: `${MODELS}/ggml-small.bin`, size: 487_601_967, sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b' },
    medium: { file: 'ggml-medium.bin', url: `${MODELS}/ggml-medium.bin`, size: 1_533_763_059, sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208' },
    'large-v3-turbo': { file: 'ggml-large-v3-turbo.bin', url: `${MODELS}/ggml-large-v3-turbo.bin`, size: 1_624_555_275, sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69' }
  }
}

/**
 * The only hosts a download may touch, first request and every redirect. Exact names, no
 * wildcards.
 *   github.com → release-assets.githubusercontent.com   (seen 2026-10-13; objects.… is the older name of the same store)
 *   huggingface.co → us.aws.cdn.hf.co                    (seen 2026-10-13)
 * The other hf.co names are the content hosts Hugging Face documents for other regions and
 * for files not yet moved to its newer storage; they were not observed from this machine.
 */
export const DOWNLOAD_HOSTS: ReadonlySet<string> = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'huggingface.co',
  'us.aws.cdn.hf.co',
  'eu.aws.cdn.hf.co',
  'cas-bridge.xethub.hf.co',
  'cdn-lfs.hf.co',
  'cdn-lfs-us-1.hf.co',
  'cdn-lfs-eu-1.hf.co'
])

/** The names of the files kept from the program's archive: the program and the libraries beside it. */
export const PROGRAM_NAME = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
