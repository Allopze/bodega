import { STORE, idbGet, idbPut, req, runTx } from "./db"

/** Valores sueltos del dispositivo (almacén `meta`). */
interface MetaMap {
  deviceId: string
  /** Cuenta con la que se está trabajando ahora en este equipo. */
  activeAccountId: string | null
  /** Último usuario con sesión de la plataforma que vio la app (para detectar un ingreso nuevo). */
  lastSessionUserId: string | null
  /** ISO desde cuándo no hay señal; `null` si hay. */
  offlineSince: string | null
  /** Cuenta que pidió olvidar su PIN: al volver de entrar con su contraseña define uno nuevo. */
  pinResetFor: string | null
}

export async function getMeta<K extends keyof MetaMap>(key: K): Promise<MetaMap[K] | undefined> {
  return idbGet<MetaMap[K]>(STORE.meta, key)
}

export async function setMeta<K extends keyof MetaMap>(key: K, value: MetaMap[K]): Promise<void> {
  await idbPut(STORE.meta, value, key)
}

/** Identificador estable de este teléfono o tablet; lo usa el servidor para atar la credencial. */
export async function getDeviceId(): Promise<string> {
  // Leer y crear en una sola transacción: dos arranques simultáneos no pueden dar dos ids.
  return runTx([STORE.meta], "readwrite", async (stores) => {
    const current = (await req(stores.meta.get("deviceId"))) as string | undefined
    if (current) return current
    const created = crypto.randomUUID()
    await req(stores.meta.put(created, "deviceId"))
    return created
  })
}
