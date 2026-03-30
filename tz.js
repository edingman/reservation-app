/**
 * Timezone utility: get current time as a local ISO string in a given IANA timezone.
 * Uses Intl.DateTimeFormat which is built into Node.js â no dependencies needed.
 */

function nowInTimezone(tz) {
  const d = new Date();
  return toTimezoneISO(d, tz);
}

function toTimezoneISO(date, tz) {
  try {
    // Use Intl to get the date parts in the target timezone
    const parts = {};
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    formatter.formatToParts(date).forEach(({ type, value }) => {
      parts[type] = value;
    });

    // Handle midnight being "24" in some locales
    const hour = parts.hour === '24' ? '00' : parts.hour;
    return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}`;
  } catch (e) {
    // Fallback to server local time if invalid timezone
    const Y = date.getFullYear();
    const M = String(date.getMonth() + 1).padStart(2, '0');
    const D = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${Y}-${M}-${D}T${h}:${m}:${s}`;
  }
}

function todayInTimezone(tz) {
  return nowInTimezone(tz).slice(0, 10);
}

module.exports = { nowInTimezone, toTimezoneISO, todayInTimezone };
