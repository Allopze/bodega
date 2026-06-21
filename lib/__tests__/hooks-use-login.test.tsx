// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useLogin } from "@/lib/hooks/use-login"
import { signIn } from "next-auth/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as React from "react"
import type { Mock } from "vitest"

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
}))

// Mock next/navigation
const mockPush = vi.fn()
const mockRefresh = vi.fn()
const mockGet = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  useSearchParams: () => ({
    get: mockGet,
  }),
}))

const signInMock = signIn as unknown as Mock

// Wrapper for QueryClientProvider
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
  const QueryWrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  QueryWrapper.displayName = "QueryWrapper"
  return QueryWrapper
}

describe("useLogin hook", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue(null)
  })

  it("handles successful login", async () => {
    signInMock.mockResolvedValue({ ok: true, error: null } as never)
    mockGet.mockReturnValue("/dashboard")

    const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() })

    let mutationResult
    await act(async () => {
      mutationResult = await result.current.mutateAsync({
        email: "test@example.com",
        password: "password123",
      })
    })

    expect(signIn).toHaveBeenCalledWith("credentials", {
      email: "test@example.com",
      password: "password123",
      redirect: false,
    })
    expect(mockPush).toHaveBeenCalledWith("/dashboard")
    expect(mockRefresh).toHaveBeenCalled()
    expect(mutationResult).toEqual({ ok: true })
  })

  it("maps ip_rate_limited error correctly", async () => {
    signInMock.mockResolvedValue({ ok: false, error: "ip_rate_limited" } as never)

    const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() })

    let mutationResult
    await act(async () => {
      mutationResult = await result.current.mutateAsync({
        email: "test@example.com",
        password: "password123",
      })
    })

    expect(mutationResult).toEqual({
      ok: false,
      error: "Demasiados intentos desde tu dirección. Espera 15 minutos antes de intentarlo de nuevo.",
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it("maps email_rate_limited error correctly", async () => {
    signInMock.mockResolvedValue({ ok: false, error: "email_rate_limited" } as never)

    const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() })

    let mutationResult
    await act(async () => {
      mutationResult = await result.current.mutateAsync({
        email: "test@example.com",
        password: "password123",
      })
    })

    expect(mutationResult).toEqual({
      ok: false,
      error: "Esta cuenta ha sido bloqueada temporalmente. Espera 15 minutos antes de intentarlo de nuevo.",
    })
  })

  it("maps CredentialsSignin error correctly", async () => {
    signInMock.mockResolvedValue({ ok: false, error: "CredentialsSignin" } as never)

    const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() })

    let mutationResult
    await act(async () => {
      mutationResult = await result.current.mutateAsync({
        email: "test@example.com",
        password: "password123",
      })
    })

    expect(mutationResult).toEqual({
      ok: false,
      error: "Correo o contraseña incorrectos.",
    })
  })

  it("maps other errors to a generic message", async () => {
    signInMock.mockResolvedValue({ ok: false, error: "UnknownError" } as never)

    const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() })

    let mutationResult
    await act(async () => {
      mutationResult = await result.current.mutateAsync({
        email: "test@example.com",
        password: "password123",
      })
    })

    expect(mutationResult).toEqual({
      ok: false,
      error: "No pudimos iniciar sesión. Intenta nuevamente.",
    })
  })
})
