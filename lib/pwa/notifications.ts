/**
 * lib/pwa/notifications.ts
 *
 * Browser Notification API helper for PPA offline sync confirmations.
 * Uses the native Notifications API (not Web Push) — no server-side VAPID
 * keys or push subscription management needed. Notifications appear only
 * when the page is open, which is exactly the sync scenario.
 */

/** Request notification permission (shows browser prompt if not yet decided). */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) return "denied"

  // Already granted or denied — don't re-prompt
  if (Notification.permission !== "default") {
    return Notification.permission
  }

  try {
    return await Notification.requestPermission()
  } catch {
    return "denied"
  }
}

/** Check current permission without prompting. */
export function getNotificationPermission(): NotificationPermission {
  if (!("Notification" in window)) return "denied"
  return Notification.permission
}

/**
 * Show a notification after offline PPA sync completes.
 * Uses `tag` to deduplicate — only one notification visible at a time.
 */
export function showSyncNotification(options: {
  title: string
  body: string
  url?: string
}): boolean {
  if (!("Notification" in window)) return false
  if (Notification.permission !== "granted") return false

  try {
    const notification = new Notification(options.title, {
      body: options.body,
      icon: "/ppa-icon-192.png",
      badge: "/ppa-icon-192.png",
      tag: "ppa-sync",
    } as NotificationOptions & { renotify?: boolean })

    if (options.url) {
      const url = options.url
      notification.onclick = () => {
        window.focus()
        window.location.href = url
        notification.close()
      }
    }

    setTimeout(() => notification.close(), 8_000)
    return true
  } catch {
    return false
  }
}

/**
 * Detect iOS Safari.
 *
 * iPadOS 13+ reports as macOS in UA, so we also check
 * navigator.platform and maxTouchPoints to catch iPads.
 * This is purely for a UX hint (not a functional gate),
 * so UA sniffing is acceptable here.
 */
export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ masquerades as Mac
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  if (!isIOS) return false
  // Exclude Chrome/Firefox on iOS (they use WebKit but report differently)
  return /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua)
}
