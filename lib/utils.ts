import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** Merge Tailwind classes safely, resolving conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format currency in CLP (Chilean Pesos) */
export function formatCLP(amount: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

/** Format a number with thousands separators (for quantities) */
export function formatQty(n: number, unit?: string): string {
  const formatted = new Intl.NumberFormat("es-CL").format(n)
  return unit ? `${formatted} ${unit}` : formatted
}

/** Generate a slug-style code from a string */
export function toCode(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/** Format a date in es-CL locale */
export function formatDate(date: Date | string | number): string {
  const d = coerceDate(date)
  return [
    pad2(d.getDate()),
    pad2(d.getMonth() + 1),
    d.getFullYear(),
  ].join("-")
}

/** Format datetime in es-CL locale */
export function formatDateTime(date: Date | string | number): string {
  const d = coerceDate(date)
  return `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function coerceDate(date: Date | string | number): Date {
  if (date instanceof Date) return date
  if (typeof date === "string") {
    const plainDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
    if (plainDate) {
      const [, year, month, day] = plainDate
      return new Date(Number(year), Number(month) - 1, Number(day))
    }
  }
  return new Date(date)
}

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

/** Convert a string to title-case (each word capitalized). */
export function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Generate initials from a full name (for Avatar) */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ""
  const first = parts[0]!
  if (parts.length === 1) return first.slice(0, 2).toUpperCase()
  const last = parts[parts.length - 1]!
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase()
}

/** Escape special HTML characters to prevent XSS in email templates and notifications. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

/**
 * Build a Content-Disposition header value (RFC 6266 + RFC 5987) that is
 * safe across HTTP and renders Unicode filenames correctly in modern
 * browsers. Replaces any control chars and quotes in the ASCII fallback,
 * and percent-encodes the original string for the UTF-8 variant.
 */
export function encodeContentDisposition(filename: string, disposition: "inline" | "attachment" = "inline"): string {
  const ascii = filename
    // strip control characters
    .replace(/[\u0000-\u001F\u007F]/g, "_")
    // collapse to a safe ASCII subset
    .replace(/["\\]/g, "_")
  const utf8 = encodeURIComponent(filename)
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${utf8}`
}
