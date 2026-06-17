"use client"

import { useState, useCallback } from "react"
import type { ZodSchema, ZodError } from "zod"

/**
 * Client-side validation hook for `onBlur` and submit-time checks.
 *
 * Usage:
 *   const { validate, fieldError, fieldErrors, resetErrors, hasErrors } =
 *     useClientValidation(schema)
 *
 * In your form, attach to `onBlur`:
 *   <Input onBlur={(e) => validate("fieldName", e.target.value)} error={fieldError("fieldName")} />
 *
 * `validate` runs the full schema but only updates the error for the named field —
 * it won't surface errors from other fields the user hasn't touched yet.
 */
export function useClientValidation<T extends Record<string, unknown>>(schema: ZodSchema<T>) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  /** Validate a single field value against the schema. Only the named field's error is updated. */
  const validate = useCallback(
    (name: string, value: unknown) => {
      // Build a partial input — we only embed the touched field's value into
      // whatever baseline we can construct so that the schema can run.
      // Strategy: try parsing a best-effort partial object; if it fails, grab the error.
      const result = schema.safeParse({ [name]: value } as Partial<T>)

      setFieldErrors((prev) => {
        if (result.success) {
          if (!(name in prev)) return prev
          const next = { ...prev }
          delete next[name]
          return next
        }

        const issues = (result.error as ZodError).issues.filter(
          (i) => i.path[0] === name
        )
        const next = { ...prev }
        if (issues.length === 0) {
          delete next[name]
        } else {
          next[name] = issues[0].message
        }
        return next
      })
    },
    [schema],
  )

  /** Get the error message for a field, or undefined. */
  const fieldError = useCallback(
    (name: string) => fieldErrors[name] ?? undefined,
    [fieldErrors],
  )

  /** Reset all errors (e.g. after a successful submit). */
  const resetErrors = useCallback(() => setFieldErrors({}), [])

  /** Whether any field has an error. */
  const hasErrors = Object.keys(fieldErrors).length > 0

  return { validate, fieldError, fieldErrors, resetErrors, hasErrors }
}
