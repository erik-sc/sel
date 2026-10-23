// Settings → Herman (or Hermine: the section keeps its id `herman`, and its label is the chosen persona's
// name). A chunk of its own, fetched when the section is opened. Its words are written in Herman's and
// said of the persona chosen here (shared/persona.ts).
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import {
  HERMAN_CORNERS,
  HERMAN_DEFAULTS,
  HERMAN_FREQUENCIES,
  HERMAN_SIZES,
  HERMAN_VOICES,
  HERMAN_VOICE_LABELS,
  type HermanCorner,
  type HermanFrequency,
  type HermanSettings,
  type HermanSize,
  type HermanSkinId,
  type HermanVoice,
  type HermineSkinId
} from '@shared/herman'
import { ConfirmButton, Segmented } from '@/appearance/controls'
import { notifyError, toast } from '@/ui/toast'
import { AlarmSettings } from '@/alarms/AlarmSettings'
import { Herman64 } from './Herman64'
import { usePersona } from './gate'
import { PERSONA_OPTIONS, saveHermanSetting, SkinChoice, WARDROBES } from './wardrobe'
import { fromClock, toClock } from './mood'

const ON_OFF: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]
const SIZES: { value: HermanSize; label: string }[] = HERMAN_SIZES.map((value) => ({
  value,
  label: value === 'small' ? 'Small' : 'Medium'
}))
const FREQUENCY_LABELS: Record<HermanFrequency, string> = { rare: 'Rare', sometimes: 'Sometimes', often: 'Often' }
const FREQUENCIES = HERMAN_FREQUENCIES.map((value) => ({ value, label: FREQUENCY_LABELS[value] }))
const FREQUENCY_HELP: Record<HermanFrequency, string> = {
  rare: 'At most twice a day, three hours apart.',
  sometimes: 'At most four times a day, an hour and a half apart.',
  often: 'At most eight times a day, 45 minutes apart.'
}
const CORNER_LABELS: Record<HermanCorner, string> = {
  'bottom-right': 'Bottom right',
  'bottom-left': 'Bottom left',
  'top-right': 'Top right',
  'top-left': 'Top left'
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const VOICE_HELP: Record<HermanVoice, string> = {
  plain: 'The assistant answers without his voice.',
  herman: 'Warm, plain and brief; a question more often than a list of tips.',
  brief: 'The same voice, in a sentence or two.'
}

export function HermanSection(): JSX.Element {
  const [values, setValues] = useState<HermanSettings>(HERMAN_DEFAULTS)
  const { name, say } = usePersona()

  useEffect(() => {
    let alive = true
    window.api.herman.state().then(
      ({ enabled, voice, nudges, frequency, quietHours, size, corner, skin, seasonalSkins, persona, hermineSkin }) => {
        if (alive) setValues({ enabled, voice, nudges, frequency, quietHours, size, corner, skin, seasonalSkins, persona, hermineSkin })
      },
      (error: unknown) => console.error('herman settings failed to load', error)
    )
    return () => {
      alive = false
    }
  }, [])

  /** Shows the new value at once, stores it, and puts the old one back if it could not be stored. */
  const change = <K extends keyof HermanSettings>(name: K, value: HermanSettings[K]): void => {
    const previous = values[name]
    setValues((current) => ({ ...current, [name]: value }))
    saveHermanSetting(name, value).catch((error: unknown) => {
      setValues((current) => ({ ...current, [name]: previous }))
      notifyError('The setting could not be saved.', error)
    })
  }

  const reset = (): void => {
    window.api.herman.reset().then(
      () => toast(say('Herman has forgotten what he learned.'), { kind: 'success', duration: 2400 }),
      (error: unknown) => notifyError('That could not be reset.', error)
    )
  }

  const { enabled } = values
  const wardrobe = WARDROBES[values.persona]
  const worn = values.persona === 'hermine' ? values.hermineSkin : values.skin
  const wear = (skin: string): void =>
    values.persona === 'hermine' ? change('hermineSkin', skin as HermineSkinId) : change('skin', skin as HermanSkinId)
  const everyday = wardrobe.skins.filter((skin) => wardrobe.seasons[skin] === undefined)
  const seasonal = wardrobe.skins.filter((skin) => wardrobe.seasons[skin] !== undefined)
  const voices = HERMAN_VOICES.map((value) => ({ value, label: say(HERMAN_VOICE_LABELS[value]) }))
  const quietOn = values.quietHours.from !== values.quietHours.to
  const setQuiet = (end: 'from' | 'to', text: string): void => {
    const minutes = fromClock(text)
    if (minutes !== null) change('quietHours', { ...values.quietHours, [end]: minutes })
  }

  return (
    <div className="settings2-scroll">
      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">{name}</h3>
        </div>
        <div className="herman-settings-figure">
          <Herman64 pose={enabled ? 'resting' : 'sleeping'} />
          <p>{say('The face and the voice of the assistant: an old man who listens, answers briefly, and otherwise leaves you alone.')}</p>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Persona</span>
              <span className="ap-row-help">
                Herman, an old man, or Hermine, a young woman: the same voice and the same habits, another figure and another name.
              </span>
            </div>
            <div className="ap-row-control">
              <Segmented label="Persona" value={values.persona} options={PERSONA_OPTIONS} onChange={(value) => change('persona', value)} />
            </div>
          </div>
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">{name}</span>
              <span className="ap-row-help">When off, the plain assistant is back and no figure is shown.</span>
            </div>
            <div className="ap-row-control">
              <Segmented
                label={name}
                value={enabled ? 'on' : 'off'}
                options={ON_OFF}
                onChange={(value) => change('enabled', value === 'on')}
              />
            </div>
          </div>
          <div className="ap-row herman-skins-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Outfit</span>
              <span className="ap-row-help">{say('Only how he looks: he moves and speaks the same in every one.')}</span>
            </div>
            <div className="herman-skins" role="group" aria-label="Outfit">
              {everyday.map((skin) => (
                <SkinChoice
                  key={skin}
                  persona={values.persona}
                  skin={skin}
                  label={wardrobe.labels[skin] ?? skin}
                  chosen={worn === skin}
                  onChoose={() => wear(skin)}
                />
              ))}
            </div>
          </div>
          <div className="ap-row herman-skins-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Outfits of the season</span>
              <span className="ap-row-help">
                {values.seasonalSkins
                  ? say('Worn only in their month; the rest of the year he wears the classic one.')
                  : say('Off: he never wears them.')}
              </span>
            </div>
            <div className="ap-row-control">
              <Segmented
                label="Outfits of the season"
                value={values.seasonalSkins ? 'on' : 'off'}
                options={ON_OFF}
                onChange={(value) => change('seasonalSkins', value === 'on')}
              />
            </div>
            {values.seasonalSkins && (
              <div className="herman-skins" role="group" aria-label="Outfits of the season">
                {seasonal.map((skin) => (
                  <SkinChoice
                    key={skin}
                    persona={values.persona}
                    skin={skin}
                    label={wardrobe.labels[skin] ?? skin}
                    chosen={worn === skin}
                    note={MONTHS[(wardrobe.seasons[skin] ?? 1) - 1]}
                    onChoose={() => wear(skin)}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Voice</span>
              <span className="ap-row-help">
                {say(VOICE_HELP[values.voice])} Used in the conversation and on Today; the writing tools are not affected.
              </span>
            </div>
            <div className="ap-row-control">
              <Segmented label="Voice" value={values.voice} options={voices} onChange={(value) => change('voice', value)} />
            </div>
          </div>
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Size</span>
            </div>
            <div className="ap-row-control">
              <Segmented label="Size" value={values.size} options={SIZES} onChange={(value) => change('size', value)} />
            </div>
          </div>
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Corner</span>
              <span className="ap-row-help">
                {say('Where he sits in the page area. He can also be dragged there, or moved with the arrow keys.')}
              </span>
            </div>
            <div className="ap-row-control">
              <select
                className="ap-field ai-select"
                value={values.corner}
                aria-label="Corner"
                disabled={!enabled}
                onChange={(event) => change('corner', event.target.value as HermanCorner)}
              >
                {HERMAN_CORNERS.map((corner) => (
                  <option key={corner} value={corner}>
                    {CORNER_LABELS[corner]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">{say('What he notices')}</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">{say('Say what he notices')}</span>
              <span className="ap-row-help">
                Now and then, one short line about your own day: something overdue, a meeting about to start, a long sitting.
              </span>
            </div>
            <div className="ap-row-control">
              <Segmented
                label={say('Say what he notices')}
                value={values.nudges ? 'on' : 'off'}
                options={ON_OFF}
                onChange={(value) => change('nudges', value === 'on')}
              />
            </div>
          </div>
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">How often</span>
              <span className="ap-row-help">{FREQUENCY_HELP[values.frequency]} Never while you type.</span>
            </div>
            <div className="ap-row-control">
              <Segmented
                label="How often"
                value={values.frequency}
                options={FREQUENCIES}
                onChange={(value) => change('frequency', value)}
              />
            </div>
          </div>
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Quiet hours</span>
              <span className="ap-row-help">
                {quietOn ? say('He says nothing between these hours, and sleeps.') : 'The same hour twice: no quiet hours.'}
              </span>
            </div>
            <div className="ap-row-control">
              <input
                className="ap-field herman-time"
                type="time"
                aria-label="Quiet hours start"
                value={toClock(values.quietHours.from)}
                disabled={!enabled || !values.nudges}
                onChange={(event) => setQuiet('from', event.target.value)}
              />
              <span className="ap-unit">to</span>
              <input
                className="ap-field herman-time"
                type="time"
                aria-label="Quiet hours end"
                value={toClock(values.quietHours.to)}
                disabled={!enabled || !values.nudges}
                onChange={(event) => setQuiet('to', event.target.value)}
              />
            </div>
          </div>
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">{say('What he has learned')}</span>
              <span className="ap-row-help">{say('Which kinds of remark you asked to see less of, and what he said lately.')}</span>
            </div>
            <div className="ap-row-control">
              <ConfirmButton label="Reset" confirmLabel="Reset now" onConfirm={reset} />
            </div>
          </div>
        </div>
        <p className="ap-note">
          {say(
            'His remarks are written in advance and chosen on this computer from your own tasks and calendar: no AI is used for them, and nothing is sent anywhere. These settings stay on this device.'
          )}
        </p>
      </section>

      <AlarmSettings />
    </div>
  )
}
