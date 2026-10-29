/**
 * Avisos internos de la app: la cola, las cuentas y el catálogo cambian desde
 * varios lugares (pantallas, motor de sincronización, service worker) y la
 * interfaz se vuelve a leer de IndexedDB cuando alguno avisa.
 */
export type MantTopic = "queue" | "accounts" | "catalog" | "drafts" | "signal"

type Listener = () => void

const listeners = new Map<MantTopic, Set<Listener>>()

export function subscribe(topic: MantTopic, listener: Listener): () => void {
  let set = listeners.get(topic)
  if (!set) {
    set = new Set()
    listeners.set(topic, set)
  }
  set.add(listener)
  return () => { set.delete(listener) }
}

export function emit(topic: MantTopic): void {
  for (const listener of [...(listeners.get(topic) ?? [])]) {
    try { listener() } catch { /* un oyente roto no frena a los demás */ }
  }
}
