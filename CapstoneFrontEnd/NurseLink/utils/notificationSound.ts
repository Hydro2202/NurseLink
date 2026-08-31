import { Platform } from 'react-native';

/**
 * The chime that plays when a patient is handed over to you.
 *
 * Synthesised with the Web Audio API rather than shipped as an audio file: it
 * needs no asset, no new dependency, and no bundler configuration, and a short
 * two-note tone is all a notification needs. On native this is a no-op — React
 * Native has no built-in audio, and adding an audio library for one chime is
 * not worth the dependency until someone asks for it on the phone.
 *
 * Callers must check the nurse's Sound Alerts preference first; this function
 * plays whenever it is called.
 */

/** A rising two-note chime. Frequencies in Hz, offsets and lengths in seconds. */
const NOTES = [
  { frequency: 880, at: 0, length: 0.12 },
  { frequency: 1320, at: 0.12, length: 0.18 },
];

const PEAK_GAIN = 0.08; // Quiet by design: a ward is not the place to startle anyone.

export function playNotificationSound(): void {
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined') return;

  try {
    const AudioContextClass =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const context: AudioContext = new AudioContextClass();

    // Browsers refuse to start audio until the page has been interacted with.
    // A nurse who has clicked anything is fine; on a fresh tab this simply
    // stays silent rather than throwing.
    if (context.state === 'suspended') {
      void context.resume().catch(() => {});
    }

    const start = context.currentTime;
    NOTES.forEach(({ frequency, at, length }) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      // Ramped rather than switched on and off: an abrupt start and stop on a
      // sine wave produces an audible click.
      gain.gain.setValueAtTime(0, start + at);
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, start + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + length);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start + at);
      oscillator.stop(start + at + length);
    });

    // Release the hardware once the chime has finished. Without this, every
    // notification leaks an AudioContext and browsers cap how many may exist.
    const total = NOTES.reduce((end, note) => Math.max(end, note.at + note.length), 0);
    setTimeout(() => {
      void context.close().catch(() => {});
    }, (total + 0.2) * 1000);
  } catch {
    // Sound is a courtesy. Never let it interrupt a notification.
  }
}
