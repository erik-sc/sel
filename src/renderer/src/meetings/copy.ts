// The words the recorder says on its own (outside the recording bar), in English and in
// Brazilian Portuguese, chosen like the home's. Pure: no React, no DOM.
import type { HomeLocale } from '@/home/copy'

export interface RecorderCopy {
  pauseFailed: string
  resumeFailed: string
  stopFailed: string
}

export const RECORDER_COPY: Record<HomeLocale, RecorderCopy> = {
  en: {
    pauseFailed: 'The recording could not be paused. It is still recording.',
    resumeFailed: 'The recording could not be resumed. It is still paused.',
    stopFailed: 'The recording could not be saved.'
  },
  'pt-BR': {
    pauseFailed: 'Não foi possível pausar a gravação. Ela continua gravando.',
    resumeFailed: 'Não foi possível retomar a gravação. Ela continua pausada.',
    stopFailed: 'Não foi possível salvar a gravação.'
  }
}
