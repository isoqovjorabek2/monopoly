/* Cues generated with WebAudio rather than shipped as files: zero bytes,
 * nothing to 404 on a static host, and every cue stays under 400ms. */

let ctx: AudioContext | null = null;

const audio = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    // Browsers start suspended until a gesture; resuming is a no-op otherwise.
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
};

interface ToneSpec {
  freq: number;
  to?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
}

function tone({ freq, to, dur, type = 'sine', gain = 0.16, delay = 0 }: ToneSpec): void {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function noise(dur: number, gain = 0.1, delay = 0): void {
  const ac = audio();
  if (!ac) return;
  const frames = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  const src = ac.createBufferSource();
  const amp = ac.createGain();
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2400;
  amp.gain.value = gain;
  src.buffer = buf;
  src.connect(filter).connect(amp).connect(ac.destination);
  src.start(ac.currentTime + delay);
}

export const SFX = {
  dice: () => { noise(0.09, 0.09); noise(0.07, 0.07, 0.11); noise(0.06, 0.05, 0.2); },
  step: () => tone({ freq: 620, dur: 0.05, type: 'triangle', gain: 0.045 }),
  cash: () => {
    tone({ freq: 880, to: 1320, dur: 0.1, type: 'triangle', gain: 0.1 });
    tone({ freq: 1320, to: 1760, dur: 0.12, type: 'triangle', gain: 0.07, delay: 0.07 });
  },
  pay: () => tone({ freq: 420, to: 190, dur: 0.22, type: 'sawtooth', gain: 0.07 }),
  buy: () => {
    tone({ freq: 523, dur: 0.09, type: 'square', gain: 0.06 });
    tone({ freq: 784, dur: 0.14, type: 'square', gain: 0.055, delay: 0.08 });
  },
  card: () => noise(0.16, 0.055),
  jail: () => {
    tone({ freq: 240, dur: 0.16, type: 'square', gain: 0.08 });
    tone({ freq: 170, dur: 0.26, type: 'square', gain: 0.07, delay: 0.13 });
  },
  build: () => tone({ freq: 300, to: 620, dur: 0.12, type: 'triangle', gain: 0.09 }),
  turn: () => tone({ freq: 660, to: 990, dur: 0.16, type: 'sine', gain: 0.075 }),
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone({ freq: f, dur: 0.3, type: 'triangle', gain: 0.1, delay: i * 0.11 }));
  },
  error: () => tone({ freq: 200, to: 140, dur: 0.16, type: 'sawtooth', gain: 0.07 }),
};

export type SfxName = keyof typeof SFX;

export function play(name: SfxName, enabled: boolean): void {
  if (!enabled) return;
  try { SFX[name](); } catch { /* audio unavailable; never break the game for it */ }
}
