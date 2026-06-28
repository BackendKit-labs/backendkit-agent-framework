// ---------------------------------------------------------------------------
// Service: Quiet Hours — validación de horarios de silencio
// ---------------------------------------------------------------------------

export interface QuietHoursConfig {
  start: string   // "22:00"
  end: string     // "07:00"
  timezone: string // "America/Argentina/Buenos_Aires"
}

// Canales considerados intrusivos (se silencian en quiet hours)
const INTRUSIVE_CHANNELS = ['push', 'telegram', 'slack', 'discord'];

export function isQuietHours(config: QuietHoursConfig): boolean {
  try {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: config.timezone,
    };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const currentTime = formatter.format(now); // "22:30"

    const startMinutes = timeToMinutes(config.start);
    const endMinutes = timeToMinutes(config.end);
    const currentMinutes = timeToMinutes(currentTime);

    if (startMinutes <= endMinutes) {
      // Mismo día: ej 07:00 - 22:00
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
      // Cruza medianoche: ej 22:00 - 07:00
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }
  } catch {
    return false;
  }
}

export function filterNonIntrusive(channels: string[], isQuiet: boolean): string[] {
  if (!isQuiet) return channels;
  return channels.filter((ch) => !INTRUSIVE_CHANNELS.includes(ch));
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}
