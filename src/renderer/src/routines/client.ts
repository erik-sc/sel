// The window's side of the persona's routines (shared/routines.ts): at quiet moments it asks the
// main process whether a routine prepared something, and has the persona say it in its corner
// (`offerInBalloon` opens the prepared answer, with its proposal, in the balloon). "Run routine
// now" in the palette runs one at once and opens what it made. Always loaded, and small: the
// balloon itself is fetched only when it opens.
import type { RoutineId, RoutineOffer } from '@shared/routines'
import { aiReady, toggleAssistant, useAiGate } from '@/ai/gate'
import { offerInBalloon, openInBalloon, sayInCorner, type BalloonDelivery } from '@/ai/balloonGate'
import { useHerman } from '@/herman/gate'
import { useHome } from '@/home/store'
import { openWeekReview, registerWeekSummarizer } from '@/review/route'
import type { WeekDigest } from '@/review/steps'
import { dismissToast, notifyError, toast } from '@/ui/toast'

/** No key for this long before asking: never into typing. */
const SETTLE_MS = 20_000
/** The first question after the window opens. */
const FIRST_ASK_MS = 25_000
const MODAL = '.ui-modal-overlay'

const WORDS = {
  en: {
    preparing: 'Preparing it…',
    failed: 'The routine could not run.',
    summary: (digest: WeekDigest) =>
      [
        `Summarise my week (${digest.past.start} to ${digest.past.end}) in a short paragraph, and suggest what to keep in mind for the next one.`,
        `Done: ${digest.done.length ? digest.done.slice(0, 30).join('; ') : 'nothing marked done'}.`,
        `Pages edited: ${digest.edited}. Still slipping: ${digest.left}. Inbox to refine: ${digest.inbox}. Projects without a next action: ${digest.withoutNext}.`,
        digest.focus.length ? `Focus for next week: ${digest.focus.join('; ')}.` : '',
        digest.note ? `My note: ${digest.note}` : ''
      ]
        .filter(Boolean)
        .join('\n')
  },
  'pt-BR': {
    preparing: 'Preparando…',
    failed: 'Não foi possível rodar a rotina.',
    summary: (digest: WeekDigest) =>
      [
        `Resuma a minha semana (${digest.past.start} a ${digest.past.end}) num parágrafo curto e sugira o que ter em mente na próxima.`,
        `Feito: ${digest.done.length ? digest.done.slice(0, 30).join('; ') : 'nada marcado como feito'}.`,
        `Páginas editadas: ${digest.edited}. Ainda escorregando: ${digest.left}. Inbox a refinar: ${digest.inbox}. Projetos sem próxima ação: ${digest.withoutNext}.`,
        digest.focus.length ? `Foco da próxima semana: ${digest.focus.join('; ')}.` : '',
        digest.note ? `Minha nota: ${digest.note}` : ''
      ]
        .filter(Boolean)
        .join('\n')
  }
} as const

const words = () => WORDS[useHome.getState().locale === 'pt-BR' ? 'pt-BR' : 'en']

/** Has the persona say what a routine prepared. */
export function show(offer: RoutineOffer, now = false): void {
  if (offer.kind === 'balloon' && offer.delivery) {
    const delivery: BalloonDelivery = offer.delivery
    // Asked for just now: it opens at once. Otherwise a line in the corner, with a button.
    if (now) openInBalloon(delivery)
    else offerInBalloon(offer.line, delivery, offer.label)
  } else if (offer.kind === 'review') {
    if (now) openWeekReview()
    else sayInCorner(offer.line, { label: offer.label ?? 'Open', run: openWeekReview })
  } else if (now) toast(offer.line)
  else sayInCorner(offer.line)
}

/** "Run routine now": runs it and opens what it made. The weekly one opens the review. */
export async function runRoutine(id: RoutineId): Promise<void> {
  if (id === 'weekly') {
    openWeekReview()
    return
  }
  if (!(await aiReady())) return
  const preparing = toast(words().preparing, { duration: 0 })
  try {
    const offer = await window.api.routines.run(id)
    dismissToast(preparing)
    if (offer) show(offer, true)
  } catch (error) {
    dismissToast(preparing)
    notifyError(words().failed, error)
  }
}

/**
 * The persona's summary of the week, for the review's "Summarise with the persona": the question
 * is written into the balloon with what it will send, and goes only when the user sends it.
 */
function summarizeWeek(digest: WeekDigest): void {
  void aiReady().then((ready) => {
    if (!ready) return
    useHerman.setState({ prepared: words().summary(digest) })
    if (!useAiGate.getState().balloonOpen) toggleAssistant()
  })
}

let started = false

/** Starts asking, at quiet moments, whether something is ready. Once per window. */
export function initRoutines(): void {
  if (started) return
  started = true
  registerWeekSummarizer(summarizeWeek)
  let lastKey = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = (delay: number): void => {
    clearTimeout(timer)
    timer = setTimeout(ask, Math.max(1000, Math.min(delay, 30 * 60_000)))
  }
  const ask = (): void => {
    const idleMs = performance.now() - lastKey
    if (idleMs < SETTLE_MS) return arm(SETTLE_MS - idleMs)
    if (document.visibilityState !== 'visible') return arm(60_000)
    if (!useAiGate.getState().enabled) return arm(10 * 60_000)
    const busy = useAiGate.getState().balloonOpen || !document.hasFocus() || document.querySelector(MODAL) !== null
    window.api.routines.next({ idleMs: Math.round(idleMs), busy }).then(
      (reply) => {
        if (reply.offer) show(reply.offer)
        arm(reply.waitMs)
      },
      (error: unknown) => {
        console.error('the routines could not be asked', error)
        arm(10 * 60_000)
      }
    )
  }
  window.addEventListener(
    'keydown',
    () => {
      lastKey = performance.now()
    },
    true
  )
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') arm(SETTLE_MS)
  })
  window.api.routines.onReady(() => arm(SETTLE_MS))
  arm(FIRST_ASK_MS)
}
