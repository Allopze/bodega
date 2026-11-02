import { formatDate, formatDateTime } from "@/lib/utils"

/** Hora `HH:mm` (en Chile) de un instante ISO, para las casillas «Hora» del talonario. */
export function formatTimeOnly(iso: string): string {
  return formatDateTime(iso).split(" ")[1] ?? "—"
}

/** `dd-mm-aaaa` de un instante o de una fecha calendario. */
export function formatDay(value: string): string {
  return formatDate(value)
}

/** Los eventos de la más reciente a la más antigua, sin suponer el orden en que llegan. */
export function sortEventsNewestFirst<T extends { createdAt: string }>(events: T[]): T[] {
  return [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
