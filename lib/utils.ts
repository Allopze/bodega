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
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Deterministic hue from a string (for avatar color assignment) */
export function stringToHue(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash) % 360
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
