// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useClientValidation } from "@/lib/hooks/use-client-validation"
import { z } from "zod"

// Mock window.matchMedia
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

describe("useClientValidation", () => {
  const schema = z.object({
    name: z.string().min(3, "Nombre muy corto"),
    email: z.string().email("Email inválido"),
  })

  it("handles validation life cycle", () => {
    const { result } = renderHook(() => useClientValidation(schema))

    // Initial state
    expect(result.current.hasErrors).toBe(false)
    expect(result.current.fieldError("name")).toBeUndefined()

    // Validate invalid value
    act(() => {
      result.current.validate("name", "ab")
    })
    expect(result.current.hasErrors).toBe(true)
    expect(result.current.fieldError("name")).toBe("Nombre muy corto")

    // Validate valid value
    act(() => {
      result.current.validate("name", "abc")
    })
    expect(result.current.hasErrors).toBe(false)
    expect(result.current.fieldError("name")).toBeUndefined()

    expect(result.current.hasErrors).toBe(false)
    expect(result.current.fieldErrors).toEqual({})
  })

  it("covers success paths when all fields are valid", () => {
    const { result } = renderHook(() => useClientValidation(schema))

    // 1. Success path when field is not in prev errors (line 32)
    act(() => {
      // Validate name as valid. Since email is missing, success is false.
      // But now let's set email as valid, and name as valid.
      result.current.validate("name", "John Doe")
    })
    expect(result.current.fieldErrors).toEqual({})

    // Trigger full success by validating both correctly
    // First, make name invalid to add to prev
    act(() => {
      result.current.validate("name", "ab")
    })
    expect(result.current.fieldError("name")).toBe("Nombre muy corto")

    // Now validate name as valid when email is also valid
    // We can use a schema with only one field to easily get result.success = true
    const singleFieldSchema = z.object({
      name: z.string().min(3, "Too short"),
    })
    const { result: singleResult } = renderHook(() => useClientValidation(singleFieldSchema))

    // Make it invalid first
    act(() => {
      singleResult.current.validate("name", "ab")
    })
    expect(singleResult.current.fieldError("name")).toBe("Too short")

    // Now validate it as valid (result.success is true, and name is in prev)
    act(() => {
      singleResult.current.validate("name", "John")
    })
    expect(singleResult.current.fieldError("name")).toBeUndefined()
  })
})
