const pad = (n: number): string => String(n).padStart(2, "0");

/** Unix seconds to the "YYYY-MM-DDTHH:mm" text a datetime-local box wants, in the device's time zone. */
export function toLocalInput(seconds: number | null): string {
  if (seconds === null) return "";
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The reverse. Empty or invalid text gives null. */
export function fromLocalInput(value: string): number | null {
  if (value.trim() === "") return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}
