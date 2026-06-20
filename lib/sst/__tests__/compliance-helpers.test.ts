import { describe, it, expect } from 'vitest'
import {
  getEfficacyLabel,
  getEfficacyColor,
  getStatusLabel,
  isPositiveStatus,
  isNegativeStatus,
} from '../compliance'
import type { ResultadoEficacia, StatusValue } from '../types'

// ── getEfficacyLabel ────────────────────────────────────────────────────────

describe('getEfficacyLabel', () => {
  it('returns "Eficaz" for eficaz', () => {
    expect(getEfficacyLabel('eficaz')).toBe('Eficaz')
  })

  it('returns "Parcialmente eficaz" for parcialmente_eficaz', () => {
    expect(getEfficacyLabel('parcialmente_eficaz')).toBe('Parcialmente eficaz')
  })

  it('returns "No eficaz" for no_eficaz', () => {
    expect(getEfficacyLabel('no_eficaz')).toBe('No eficaz')
  })

  it('returns empty string for null', () => {
    expect(getEfficacyLabel(null)).toBe('')
  })

  it('returns empty string for unknown value', () => {
    expect(getEfficacyLabel('otro' as ResultadoEficacia)).toBe('')
  })
})

// ── getEfficacyColor ────────────────────────────────────────────────────────

describe('getEfficacyColor', () => {
  it('returns emerald for eficaz', () => {
    expect(getEfficacyColor('eficaz')).toBe('text-emerald-400')
  })

  it('returns amber for parcialmente_eficaz', () => {
    expect(getEfficacyColor('parcialmente_eficaz')).toBe('text-amber-400')
  })

  it('returns rose for no_eficaz', () => {
    expect(getEfficacyColor('no_eficaz')).toBe('text-rose-400')
  })

  it('returns slate for null', () => {
    expect(getEfficacyColor(null)).toBe('text-slate-400')
  })

  it('returns slate for unknown value', () => {
    expect(getEfficacyColor('otro' as ResultadoEficacia)).toBe('text-slate-400')
  })
})

// ── getStatusLabel ──────────────────────────────────────────────────────────

describe('getStatusLabel', () => {
  it('returns "Cumple" for cumple', () => {
    expect(getStatusLabel('cumple')).toBe('Cumple')
  })

  it('returns "No cumple" for no_cumple', () => {
    expect(getStatusLabel('no_cumple')).toBe('No cumple')
  })

  it('returns "N/A" for na', () => {
    expect(getStatusLabel('na')).toBe('N/A')
  })

  it('returns "Entregado" for entregado', () => {
    expect(getStatusLabel('entregado')).toBe('Entregado')
  })

  it('returns "No entregado" for no_entregado', () => {
    expect(getStatusLabel('no_entregado')).toBe('No entregado')
  })

  it('returns "Apto" for apto', () => {
    expect(getStatusLabel('apto')).toBe('Apto')
  })

  it('returns "No apto" for no_apto', () => {
    expect(getStatusLabel('no_apto')).toBe('No apto')
  })

  it('returns "Sí" for si', () => {
    expect(getStatusLabel('si')).toBe('Sí')
  })

  it('returns "No" for no', () => {
    expect(getStatusLabel('no')).toBe('No')
  })

  it('returns "—" for null', () => {
    expect(getStatusLabel(null)).toBe('—')
  })

  it('returns empty string for unknown status', () => {
    expect(getStatusLabel('desconocido' as StatusValue)).toBe('')
  })
})

// ── isPositiveStatus ────────────────────────────────────────────────────────

describe('isPositiveStatus', () => {
  it('returns true for cumple', () => {
    expect(isPositiveStatus('cumple')).toBe(true)
  })

  it('returns true for entregado', () => {
    expect(isPositiveStatus('entregado')).toBe(true)
  })

  it('returns true for apto', () => {
    expect(isPositiveStatus('apto')).toBe(true)
  })

  it('returns true for si', () => {
    expect(isPositiveStatus('si')).toBe(true)
  })

  it('returns false for no_cumple', () => {
    expect(isPositiveStatus('no_cumple')).toBe(false)
  })

  it('returns false for no_entregado', () => {
    expect(isPositiveStatus('no_entregado')).toBe(false)
  })

  it('returns false for no_apto', () => {
    expect(isPositiveStatus('no_apto')).toBe(false)
  })

  it('returns false for no', () => {
    expect(isPositiveStatus('no')).toBe(false)
  })

  it('returns false for na', () => {
    expect(isPositiveStatus('na')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isPositiveStatus(null)).toBe(false)
  })
})

// ── isNegativeStatus ────────────────────────────────────────────────────────

describe('isNegativeStatus', () => {
  it('returns true for no_cumple', () => {
    expect(isNegativeStatus('no_cumple')).toBe(true)
  })

  it('returns true for no_entregado', () => {
    expect(isNegativeStatus('no_entregado')).toBe(true)
  })

  it('returns true for no_apto', () => {
    expect(isNegativeStatus('no_apto')).toBe(true)
  })

  it('returns true for no', () => {
    expect(isNegativeStatus('no')).toBe(true)
  })

  it('returns false for cumple', () => {
    expect(isNegativeStatus('cumple')).toBe(false)
  })

  it('returns false for entregado', () => {
    expect(isNegativeStatus('entregado')).toBe(false)
  })

  it('returns false for apto', () => {
    expect(isNegativeStatus('apto')).toBe(false)
  })

  it('returns false for si', () => {
    expect(isNegativeStatus('si')).toBe(false)
  })

  it('returns false for na', () => {
    expect(isNegativeStatus('na')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isNegativeStatus(null)).toBe(false)
  })

  it('positive and negative statuses are mutually exclusive', () => {
    const allStatuses: StatusValue[] = [
      'cumple', 'no_cumple', 'na', 'entregado', 'no_entregado',
      'apto', 'no_apto', 'si', 'no', null,
    ]
    for (const s of allStatuses) {
      const pos = isPositiveStatus(s)
      const neg = isNegativeStatus(s)
      // They should never both be true
      expect(pos && neg).toBe(false)
    }
  })
})
