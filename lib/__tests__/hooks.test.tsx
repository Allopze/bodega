// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useClientValidation } from "@/lib/hooks/use-client-validation"
import { useHideOnScroll } from "@/lib/hooks/use-hide-on-scroll"
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

describe("useHideOnScroll", () => {
  let el: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()
    el = document.createElement("div")
    Object.defineProperty(el, "scrollTop", {
      writable: true,
      value: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("always shows when scrollTop is at the top (<= 8)", () => {
    const containerRef = { current: el }
    const { result } = renderHook(() => useHideOnScroll(containerRef))

    expect(result.current).toBe(false)

    // Trigger scroll at top
    el.scrollTop = 5
    act(() => {
      el.dispatchEvent(new Event("scroll"))
    })
    expect(result.current).toBe(false)
  })

  it("hides header when scrolling down past threshold", () => {
    const containerRef = { current: el }
    const { result } = renderHook(() => useHideOnScroll(containerRef))

    // Initial scroll down (intentionally large delta)
    el.scrollTop = 50
    act(() => {
      el.dispatchEvent(new Event("scroll"))
    })
    expect(result.current).toBe(true)

    // Scroll up (intentionally large delta)
    el.scrollTop = 20
    act(() => {
      el.dispatchEvent(new Event("scroll"))
    })
    expect(result.current).toBe(false)
  })

  it("shows header again after scroll idle timeout", () => {
    const containerRef = { current: el }
    const { result } = renderHook(() => useHideOnScroll(containerRef))

    // Scroll down to hide
    el.scrollTop = 50
    act(() => {
      el.dispatchEvent(new Event("scroll"))
    })
    expect(result.current).toBe(true)

    // Fast-forward timers by idle timeout (150ms)
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(result.current).toBe(false)
  })

  it("respects prefers-reduced-motion: reduce by never hiding", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    })

    const containerRef = { current: el }
    const { result } = renderHook(() => useHideOnScroll(containerRef))

    el.scrollTop = 100
    act(() => {
      el.dispatchEvent(new Event("scroll"))
    })
    expect(result.current).toBe(false)
  })

  it("does not bind events when element ref is null", () => {
    const containerRef = { current: null }
    const { result } = renderHook(() => useHideOnScroll(containerRef))
    expect(result.current).toBe(false)
  })
})
