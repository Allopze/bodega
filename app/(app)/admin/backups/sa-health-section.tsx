"use client"

import { useState, useCallback, useEffect, useEffectEvent, useRef } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { DriveHealth } from "@/lib/services/backups"

// ── Types ────────────────────────────────────────────────────────────────────

interface SaSummary {
  label: string
  status: "success" | "failed" | "none"
  details: string[]
}

interface SaHealthSectionProps {
  initialHealth: DriveHealth
  initialSummary: SaSummary
}

// ── Constants ────────────────────────────────────────────────────────────────

const REFRESH_OPTIONS = [
  { value: 0,       label: "Manual" },
  { value: 30_000,  label: "30s" },
  { value: 60_000,  label: "1 min" },
  { value: 300_000, label: "5 min" },
] as const

const STORAGE_KEY = "sa-health-refresh-interval"

const COLORS = {
  success: {
    bg: "bg-[var(--color-success-tint)]",
    border: "border-[var(--color-success)]",
    icon: "text-[var(--color-success)]",
    text: "text-[var(--color-success)]",
  },
  failed: {
    bg: "bg-[var(--color-danger-tint)]",
    border: "border-[var(--color-danger)]",
    icon: "text-[var(--color-danger)]",
    text: "text-[var(--color-danger)]",
  },
  none: {
    bg: "bg-[var(--color-surface-2)]",
    border: "border-[var(--color-border)]",
    icon: "text-[var(--color-text-muted)]",
    text: "text-[var(--color-text-muted)]",
  },
} as const

const ICONS: Record<string, string> = {
  success: "✓",
  failed: "✗",
  none: "?",
}

function formatSeconds(s: number): string {
  if (s <= 0) return "—"
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : `${sec}s`
}

function getInitialInterval(): number {
  if (typeof window === "undefined") return 60_000
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) {
      const v = Number(stored)
      if (REFRESH_OPTIONS.some((o) => o.value === v)) return v
    }
  } catch { /* localStorage no disponible */ }
  return 60_000 // default: 1 min
}

// ── Component ────────────────────────────────────────────────────────────────

export default function SaHealthSection({ initialHealth, initialSummary }: SaHealthSectionProps) {
  const [health, setHealth] = useState<DriveHealth>(initialHealth)
  const [summary, setSummary] = useState<SaSummary>(initialSummary)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null)
  const [intervalMs, setIntervalMs] = useState(getInitialInterval)
  const [secondsRemaining, setSecondsRemaining] = useState(0)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const colors = COLORS[summary.status]
  const isAuto = intervalMs > 0

  // ── Fetch ───────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch("/api/backups/drive-health")
      if (!res.ok) return
      const data = await res.json()
      if (data.driveHealth) {
        setHealth(data.driveHealth)
        setSummary(data.summary)
      }
      setLastRefreshed(new Date().toLocaleTimeString("es-CL", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }))
    } catch {
      // Silently fail — the UI stays with previous data
    } finally {
      setRefreshing(false)
    }
  }, [])

  // ── Manage intervals ────────────────────────────────────────────────────

  const clearTimers = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
  }, [])

  const onRefreshTick = useEffectEvent(() => {
    refresh()
  })

  useEffect(() => {
    clearTimers()

    if (!isAuto) {
      return
    }

    // Auto-refresh interval
    intervalRef.current = setInterval(() => {
      onRefreshTick()
      setSecondsRemaining(Math.floor(intervalMs / 1000))
    }, intervalMs)

    // Countdown ticker
    countdownRef.current = setInterval(() => {
      setSecondsRemaining((prev) => Math.max(0, prev - 1))
    }, 1000)

    return clearTimers
  }, [intervalMs, isAuto, clearTimers])

  // ── Interval change handler ──────────────────────────────────────────────

  const handleIntervalChange = useCallback((value: string) => {
    const numVal = Number(value)
    setIntervalMs(numVal)
    try {
      localStorage.setItem(STORAGE_KEY, String(numVal))
    } catch { /* ignore */ }
  }, [])

  // ── Manual refresh ──────────────────────────────────────────────────────

  const handleManualRefresh = useCallback(async () => {
    await refresh()
    if (isAuto) {
      setSecondsRemaining(Math.floor(intervalMs / 1000))
    }
  }, [refresh, isAuto, intervalMs])

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className={`relative mb-5 overflow-hidden rounded-[var(--radius-xl)] border ${colors.border} ${colors.bg}`}>
      {/* Shimmer overlay during refresh */}
      {refreshing && (
        <div className="absolute inset-0 z-10 animate-pulse rounded-[var(--radius-xl)] bg-black/[0.04] dark:bg-white/[0.06]" />
      )}

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 sm:gap-3">
        {/* Status icon */}
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] text-sm font-bold ${colors.icon} ${colors.bg}`}>
          {ICONS[summary.status]}
        </span>

        {/* Title + status */}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Service Account de Google Drive
          </p>
          <p className={`mt-0.5 text-sm font-semibold ${colors.text}`}>
            {summary.label}
          </p>
        </div>

        {/* Email (desktop) */}
        {health.saEmail && (
          <span className="hidden max-w-[180px] truncate text-xs text-[var(--color-text-muted)] lg:block" title={health.saEmail}>
            {health.saEmail}
          </span>
        )}

        {/* ── Auto-refresh controls ── */}
        <div className="flex items-center gap-1.5">
          {/* Countdown + interval selector */}
          {isAuto && (
            <span className="hidden text-[11px] tabular-nums text-[var(--color-text-muted)] sm:inline">
              {formatSeconds(secondsRemaining)}
            </span>
          )}

          <div className="relative">
            <Select
              value={String(intervalMs)}
              onValueChange={handleIntervalChange}
            >
              <SelectTrigger aria-label="Intervalo de auto-refresh" className="h-7 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 pr-5 text-[11px] font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFRESH_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Chevron */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="pointer-events-none absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--color-text-muted)]"
            >
              <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
          </div>

          {/* Last refreshed */}
          {lastRefreshed && (
            <span className="hidden text-[10px] text-[var(--color-text-muted)] lg:block" title={lastRefreshed}>
              {lastRefreshed}
            </span>
          )}

          {/* Manual refresh button */}
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius)] text-sm text-[var(--color-text-muted)] transition-[background-color,color,transform,opacity] duration-200 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            title="Re-verificar ahora"
            aria-label="Re-verificar ahora"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Details list */}
      {summary.details.length > 0 && (
        <div className="border-t border-[var(--color-border)] px-4 py-2.5">
          <ul className="space-y-1">
            {summary.details.map((detail) => (
              <li key={detail} className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
                <span className="mt-0.5 shrink-0 text-[var(--color-text-muted)]">·</span>
                <span>{detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
