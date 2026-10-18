import { describe, expect, it } from 'vitest'
import type { BackupStatus } from '@shared/data'
import { backupWhen, byteSize, dataLocale } from '@shared/dataCopy'
import { describeBackups } from './describe'

const at = (d: number, h: number, m = 0): number => new Date(2026, 9, d, h, m).getTime()
const now = at(18, 15)

describe('the backups row', () => {
  it('says when the newest backup was made, how many there are and their size', () => {
    const status: BackupStatus = {
      backups: [
        { at: at(18, 9, 12), size: 4_000_000, kind: 'auto' },
        { at: at(17, 9), size: 8_100_000, kind: 'auto' }
      ],
      problem: null,
      problemAt: null
    }
    expect(describeBackups(status, now, 'en')).toEqual({
      help: 'Every day sel keeps a copy of everything on this computer. Last: today, 09:12 · 2 copies, 12 MB.',
      problem: null
    })
    expect(describeBackups(status, now, 'pt-BR').help).toBe(
      'Todo dia o sel guarda uma cópia de tudo neste computador. Último: hoje, 09:12 · 2 cópias, 12 MB.'
    )
  })

  it('says there is none yet, and why the last one failed', () => {
    const line = describeBackups({ backups: [], problem: 'disk-full', problemAt: now }, now, 'en')
    expect(line.help).toBe('Every day sel keeps a copy of everything on this computer. None yet.')
    expect(line.problem).toMatch(/not enough free disk space/)
  })
})

describe('words of time and size', () => {
  it('name today and yesterday, and the date before that', () => {
    expect(backupWhen(at(17, 22, 5), now, 'en')).toBe('yesterday, 22:05')
    expect(backupWhen(at(17, 22, 5), now, 'pt-BR')).toBe('ontem, 22:05')
    expect(backupWhen(at(3, 8), now, 'en')).toBe('3 Oct, 08:00')
    expect(backupWhen(new Date(2025, 11, 30, 8).getTime(), now, 'en')).toBe('30 Dec 2025, 08:00')
  })

  it('round sizes, with the decimal comma in Portuguese', () => {
    expect(byteSize(840_000, 'en')).toBe('840 KB')
    expect(byteSize(1_250_000, 'en')).toBe('1.3 MB')
    expect(byteSize(1_250_000, 'pt-BR')).toBe('1,3 MB')
    expect(byteSize(12_400_000, 'en')).toBe('12 MB')
    expect(byteSize(12, 'en')).toBe('12 bytes')
  })

  it('choose the language like the rest of the app', () => {
    expect(dataLocale('pt-BR', 'en-US')).toBe('pt-BR')
    expect(dataLocale(null, 'pt-BR')).toBe('pt-BR')
    expect(dataLocale(null, 'de-DE')).toBe('en')
  })
})
