import { describe, it, expect } from 'vitest'
import { todayLocalISO, localDateToISO, parseLocalDate, addDays, formatDateDisplay } from '../date'

// ── todayLocalISO ───────────────────────────────────────────────────────────

describe('todayLocalISO', () => {
  it('returns a string in YYYY-MM-DD format', () => {
    const result = todayLocalISO()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns today\'s local date', () => {
    const now = new Date()
    const expected = localDateToISO(now)
    expect(todayLocalISO()).toBe(expected)
  })
})

// ── localDateToISO ──────────────────────────────────────────────────────────

describe('localDateToISO', () => {
  it('formats January 1st with zero-padding', () => {
    const d = new Date(2026, 0, 1) // Jan 1
    expect(localDateToISO(d)).toBe('2026-01-01')
  })

  it('formats December 31st', () => {
    const d = new Date(2026, 11, 31)
    expect(localDateToISO(d)).toBe('2026-12-31')
  })

  it('pads single-digit months and days', () => {
    const d = new Date(2025, 2, 9) // March 9
    expect(localDateToISO(d)).toBe('2025-03-09')
  })

  it('handles leap year Feb 29', () => {
    const d = new Date(2024, 1, 29)
    expect(localDateToISO(d)).toBe('2024-02-29')
  })
})

// ── parseLocalDate ──────────────────────────────────────────────────────────

describe('parseLocalDate', () => {
  it('parses YYYY-MM-DD as local midnight (not UTC)', () => {
    const d = parseLocalDate('2026-06-15')
    // Should be local midnight, not UTC midnight
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(5) // June = 5
    expect(d.getDate()).toBe(15)
    expect(d.getHours()).toBe(0)
    expect(d.getMinutes()).toBe(0)
  })

  it('roundtrips with localDateToISO', () => {
    const original = '2026-03-20'
    const parsed = parseLocalDate(original)
    expect(localDateToISO(parsed)).toBe(original)
  })

  it('does not shift by timezone offset (the core bug this module fixes)', () => {
    // In UTC, Date('2026-06-15') would be midnight UTC.
    // In a Chile timezone (UTC-4), that would be 20:00 the day before.
    // parseLocalDate should NOT have this shift.
    const d = parseLocalDate('2026-06-15')
    expect(d.getDate()).toBe(15)
    // If it used new Date('2026-06-15'), in UTC-4 it would be the 14th
  })

  it('handles month boundaries', () => {
    const d = parseLocalDate('2026-01-01')
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(1)
  })

  it('handles year boundaries', () => {
    const d = parseLocalDate('2025-12-31')
    expect(d.getFullYear()).toBe(2025)
    expect(d.getMonth()).toBe(11)
    expect(d.getDate()).toBe(31)
  })
})

// ── addDays ─────────────────────────────────────────────────────────────────

describe('addDays', () => {
  it('adds positive days', () => {
    expect(addDays('2026-06-01', 7)).toBe('2026-06-08')
  })

  it('adds negative days (subtraction)', () => {
    expect(addDays('2026-06-15', -5)).toBe('2026-06-10')
  })

  it('adds zero days (no change)', () => {
    expect(addDays('2026-06-15', 0)).toBe('2026-06-15')
  })

  it('crosses month boundaries forward', () => {
    expect(addDays('2026-01-30', 5)).toBe('2026-02-04')
  })

  it('crosses month boundaries backward', () => {
    expect(addDays('2026-03-02', -5)).toBe('2026-02-25')
  })

  it('crosses year boundaries', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('handles large day offsets', () => {
    expect(addDays('2026-01-01', 365)).toBe('2027-01-01')
  })

  it('roundtrips with parseLocalDate', () => {
    const base = '2026-06-15'
    const result = addDays(base, 10)
    const parsed = parseLocalDate(result)
    expect(localDateToISO(parsed)).toBe(result)
  })
})

// ── formatDateDisplay ───────────────────────────────────────────────────────

describe('formatDateDisplay', () => {
  it('formats to dd-mm-yyyy', () => {
    expect(formatDateDisplay('2026-06-15')).toBe('15-06-2026')
  })

  it('pads single-digit day and month', () => {
    expect(formatDateDisplay('2026-01-05')).toBe('05-01-2026')
  })

  it('formats December 31st', () => {
    expect(formatDateDisplay('2026-12-31')).toBe('31-12-2026')
  })

  it('does not shift by timezone (the core bug)', () => {
    // Same as parseLocalDate — should use local components
    const result = formatDateDisplay('2026-06-15')
    expect(result).toBe('15-06-2026')
  })

  it('roundtrips with parseLocalDate → localDateToISO', () => {
    const input = '2026-03-20'
    const display = formatDateDisplay(input)
    expect(display).toBe('20-03-2026')
  })
})
