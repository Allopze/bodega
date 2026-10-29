// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import {
  detectPlatform, hasDeferredPrompt, INSTALL_SNOOZE_MS, installMode, promptInstall, type BeforeInstallPromptEvent,
} from "../install"

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
const IPAD_OS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A145M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

const base = { standalone: false, installed: false, platform: "android" as const, hasPrompt: false, snoozedAt: null, now: 1_000_000_000 }

describe("detectPlatform", () => {
  it("reconoce iPhone, iPadOS (que se presenta como Mac táctil), Android y escritorio", () => {
    expect(detectPlatform(IPHONE, 5)).toBe("ios")
    expect(detectPlatform(IPAD_OS, 5)).toBe("ios")
    expect(detectPlatform(IPAD_OS, 0)).toBe("other") // un Mac de verdad
    expect(detectPlatform(ANDROID, 5)).toBe("android")
    expect(detectPlatform(DESKTOP, 0)).toBe("other")
  })
})

describe("installMode", () => {
  it("instalada o abierta desde la pantalla de inicio: no invita", () => {
    expect(installMode({ ...base, hasPrompt: true, standalone: true })).toBe("hidden")
    expect(installMode({ ...base, hasPrompt: true, installed: true })).toBe("hidden")
  })

  it("con el evento del navegador ofrece el botón; sin él, los pasos de su plataforma", () => {
    expect(installMode({ ...base, hasPrompt: true })).toBe("prompt")
    expect(installMode({ ...base, platform: "ios" })).toBe("ios")
    expect(installMode({ ...base, platform: "android" })).toBe("android-manual")
    expect(installMode({ ...base, platform: "other" })).toBe("hidden")
  })

  it("«Ahora no» la calla tres días y después vuelve", () => {
    expect(installMode({ ...base, hasPrompt: true, snoozedAt: base.now - 1000 })).toBe("hidden")
    expect(installMode({ ...base, hasPrompt: true, snoozedAt: base.now - INSTALL_SNOOZE_MS - 1 })).toBe("prompt")
  })
})

describe("evento beforeinstallprompt", () => {
  it("se guarda aunque llegue antes de la UI, abre el diálogo nativo una sola vez", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined)
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    }) as BeforeInstallPromptEvent
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true) // sin la barra propia del navegador
    expect(hasDeferredPrompt()).toBe(true)
    expect(await promptInstall()).toBe("accepted")
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(hasDeferredPrompt()).toBe(false)
    expect(await promptInstall()).toBe("unavailable")
  })
})
