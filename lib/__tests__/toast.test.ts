import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const error = vi.fn()
  const success = vi.fn()
  const defaultFn = vi.fn()
  const mockToastFn = Object.assign(defaultFn, { error, success })
  return { error, success, defaultFn, mockToastFn }
})

vi.mock("sonner", () => ({
  toast: mocks.mockToastFn,
}))

import { toast, DEFAULT_TOAST_DURATION } from "@/lib/toast"

describe("toast wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("uses DEFAULT_TOAST_DURATION for error toasts by default", () => {
    toast.error("An error occurred")
    expect(mocks.error).toHaveBeenCalledWith("An error occurred", {
      duration: DEFAULT_TOAST_DURATION,
      style: { "--progress-duration": `${DEFAULT_TOAST_DURATION}ms` },
    })
  })

  it("respects user option overrides for error toasts", () => {
    toast.error("An error occurred", { duration: 8000, description: "try again" })
    expect(mocks.error).toHaveBeenCalledWith("An error occurred", {
      duration: 8000,
      description: "try again",
      style: { "--progress-duration": "8000ms" },
    })
  })

  it("preserves custom style alongside progress bar CSS variable", () => {
    toast.error("Styled error", { style: { background: "red" } })
    expect(mocks.error).toHaveBeenCalledWith("Styled error", {
      duration: DEFAULT_TOAST_DURATION,
      style: { "--progress-duration": `${DEFAULT_TOAST_DURATION}ms`, background: "red" },
    })
  })

  it("calls sonner success toast with normal options", () => {
    toast.success("Success!")
    expect(mocks.success).toHaveBeenCalledWith("Success!")
  })

  it("calls default toast function", () => {
    toast("Hello world")
    expect(mocks.defaultFn).toHaveBeenCalledWith("Hello world")
  })
})
