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

import { toast } from "@/lib/toast"

describe("toast wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("calls sonner error toast with duration Infinity", () => {
    toast.error("An error occurred")
    expect(mocks.error).toHaveBeenCalledWith("An error occurred", {
      duration: Infinity,
    })
  })

  it("calls sonner error toast with duration Infinity, but respects user option overrides", () => {
    toast.error("An error occurred", { duration: 5000, description: "try again" })
    expect(mocks.error).toHaveBeenCalledWith("An error occurred", {
      duration: 5000,
      description: "try again",
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
