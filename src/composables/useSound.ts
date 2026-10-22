import { shallowRef } from 'vue'

/**
 * Sonidos de interfaz generados con WebAudio (sin archivos):
 * discretos, cortos y silenciables. El mute persiste por dispositivo.
 */
type SoundName = 'tap' | 'success' | 'cash' | 'error' | 'ping'

const MUTE_KEY = 'treasure.muted'

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

const muted = shallowRef(readMuted())
let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function tone(
  audio: AudioContext,
  freq: number,
  start: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
) {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, audio.currentTime + start)
  gain.gain.linearRampToValueAtTime(volume, audio.currentTime + start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + duration)
  osc.connect(gain).connect(audio.destination)
  osc.start(audio.currentTime + start)
  osc.stop(audio.currentTime + start + duration + 0.05)
}

const SOUNDS: Record<SoundName, (audio: AudioContext) => void> = {
  tap: (a) => tone(a, 1500, 0, 0.05, 0.04),
  success: (a) => {
    tone(a, 660, 0, 0.12, 0.08)
    tone(a, 880, 0.1, 0.18, 0.08)
  },
  cash: (a) => {
    tone(a, 523.25, 0, 0.12, 0.07)
    tone(a, 659.25, 0.09, 0.12, 0.07)
    tone(a, 783.99, 0.18, 0.22, 0.08)
  },
  error: (a) => {
    tone(a, 240, 0, 0.16, 0.07, 'triangle')
    tone(a, 180, 0.12, 0.2, 0.06, 'triangle')
  },
  ping: (a) => tone(a, 987.77, 0, 0.16, 0.05),
}

export function useSound() {
  function play(name: SoundName) {
    if (muted.value) return
    const audio = getCtx()
    if (!audio) return
    SOUNDS[name](audio)
  }

  function toggleMute() {
    muted.value = !muted.value
    try {
      localStorage.setItem(MUTE_KEY, muted.value ? '1' : '0')
    } catch {
      // sin almacenamiento disponible: el mute vive solo en la sesión
    }
  }

  return { muted, play, toggleMute }
}
