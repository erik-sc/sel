// The audio thread's side of a recording. Runs in an AudioWorklet of a 16 kHz context, so what
// arrives is already resampled. Two inputs, each mixed down to one channel by the node: the
// microphone and the computer's audio. They are never mixed with each other: every 100 ms the
// samples of both go to the page as two separate 16-bit buffers, with the loudest sample of each
// for the level meters. A plain script on purpose: it is shipped as a file of its own and loaded
// from the app's own origin (the page's CSP allows no blob: or data: scripts).
const BATCH = 1600

class SelPcm extends AudioWorkletProcessor {
  constructor() {
    super()
    this.reset()
  }

  reset() {
    this.mic = new Int16Array(BATCH)
    this.system = new Int16Array(BATCH)
    this.filled = 0
    this.micPeak = 0
    this.systemPeak = 0
  }

  process(inputs) {
    const mic = inputs[0] && inputs[0][0]
    const system = inputs[1] && inputs[1][0]
    // An input with nothing connected (or a source that ended) has no channels: that is silence.
    const length = mic ? mic.length : system ? system.length : 128
    for (let i = 0; i < length; i++) {
      const a = mic ? Math.max(-1, Math.min(1, mic[i])) : 0
      const b = system ? Math.max(-1, Math.min(1, system[i])) : 0
      this.mic[this.filled] = a < 0 ? a * 0x8000 : a * 0x7fff
      this.system[this.filled] = b < 0 ? b * 0x8000 : b * 0x7fff
      const loudA = a < 0 ? -a : a
      const loudB = b < 0 ? -b : b
      if (loudA > this.micPeak) this.micPeak = loudA
      if (loudB > this.systemPeak) this.systemPeak = loudB
      if (++this.filled === BATCH) {
        this.port.postMessage({ mic: this.mic.buffer, system: this.system.buffer, micPeak: this.micPeak, systemPeak: this.systemPeak }, [this.mic.buffer, this.system.buffer])
        this.reset()
      }
    }
    return true
  }
}

registerProcessor('sel-pcm', SelPcm)
