/**
 * Chilean RUT helpers (single source of truth).
 *
 * Audit A-15: RUT cleaning/validation lived privately inside
 * `lib/validation/masters.ts` and was re-implemented ad-hoc elsewhere
 * (e.g. e2e fixtures). It now lives here so every caller shares one
 * canonical implementation.
 *
 * Accepts formats: 12345678-9, 12.345.678-9, 12345678-K, etc.
 * The canonical stored form is uppercase, no dots, with dash.
 */

/**
 * Normalize any RUT spelling into its canonical comparison form `BODY-DV`
 * (no dots, single dash before the check digit, upper-case DV).
 *
 * Accepts dotted, spaced, dash-less and mixed-case input — e.g. `12.345.678-9`,
 * `123456789`, `12345678 9` and `12345678-k` all collapse to `12345678-9` /
 * `12345678-K`. This matters because workers frequently type their RUT without
 * the dash; without re-inserting it the canonical lookup (`workers.rut`) would
 * miss and wrongly report "no existe".
 */
export function cleanRut(rut: string): string {
  const compact = rut.replace(/[^0-9kK]/g, "").toUpperCase()
  if (compact.length < 2) return compact
  return `${compact.slice(0, -1)}-${compact.slice(-1)}`
}

/** Compute the verification digit for a RUT body (the digits before the dash). */
export function computeRutDv(body: string): string {
  let sum = 0
  let mul = 2
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]!, 10) * mul
    mul = mul === 7 ? 2 : mul + 1
  }
  const expected = 11 - (sum % 11)
  return expected === 11 ? "0" : expected === 10 ? "K" : String(expected)
}

/** Validate a Chilean RUT including its check digit. */
export function validateRut(rut: string): boolean {
  const cleaned = cleanRut(rut)
  if (!/^\d{7,8}-[\dKk]$/.test(cleaned)) return false
  const [body, dv] = cleaned.split("-") as [string, string]
  return computeRutDv(body) === dv.toUpperCase()
}
