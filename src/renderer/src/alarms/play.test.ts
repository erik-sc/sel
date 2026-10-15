import { describe, expect, it } from 'vitest'
import { pickVoice } from './play'

const voice = (name: string, lang: string): SpeechSynthesisVoice => ({ name, lang, default: false, localService: true, voiceURI: name }) as SpeechSynthesisVoice

describe('the voice he speaks with', () => {
  const list = [voice('Microsoft David', 'en-US'), voice('Microsoft Maria', 'pt-BR'), voice('Microsoft Helia', 'pt-PT'), voice('Microsoft Zira', 'en-US')]

  it('is the one chosen by name', () => {
    expect(pickVoice(list, 'pt-BR', 'Microsoft Zira')?.name).toBe('Microsoft Zira')
  })

  it('is otherwise the first of the exact language, then of the language family', () => {
    expect(pickVoice(list, 'pt-BR', null)?.name).toBe('Microsoft Maria')
    expect(pickVoice(list, 'en', 'Gone voice')?.name).toBe('Microsoft David')
    expect(pickVoice([voice('Microsoft Helia', 'pt-PT')], 'pt-BR', null)?.name).toBe('Microsoft Helia')
    expect(pickVoice([voice('Microsoft David', 'en-US')], 'pt-BR', null)).toBeNull()
  })
})
