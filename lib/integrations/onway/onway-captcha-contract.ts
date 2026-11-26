/**
 * Contrato del reCAPTCHA de OnWay.
 *
 * Auth0 puede pedir un desafío de imágenes (reCAPTCHA v2) antes de entregar la
 * sesión del portal. Este archivo decide **qué casillas marcar** y **qué objeto
 * pide la consigna**; el adaptador de inferencia (`onway-captcha-classifier.ts`)
 * sólo entrega los rankings por casilla y la orquestación de navegador vive en
 * `onway-captcha-solver.ts`.
 *
 * Es puro a propósito, igual que `onway-interactive-auth-contract.ts`: lo
 * importan el cliente Playwright, la sincronización y las pruebas, así que no
 * puede importar `node:*` ni el SDK de modelos.
 *
 * Portado de `referencia-resolver-onway/src/prt/vision.ts` y `vision.py`.
 */

/** Clases que el modelo YOLO11x-cls sabe identificar. `Other` es la de descarte. */
export const ONWAY_CAPTCHA_CLASSES = [
  "Bicycle",
  "Bridge",
  "Bus",
  "Car",
  "Chimney",
  "Crosswalk",
  "Hydrant",
  "Motorcycle",
  "Mountain",
  "Other",
  "Palm",
  "Stair",
  "Tractor",
  "Traffic Light",
] as const

export type OnwayCaptchaClass = (typeof ONWAY_CAPTCHA_CLASSES)[number]

/** Las clases que cuentan como objeto; `Other` nunca se marca. */
export const ONWAY_CAPTCHA_OBJECT_CLASSES: ReadonlySet<OnwayCaptchaClass> = new Set(
  ONWAY_CAPTCHA_CLASSES.filter((name) => name !== "Other"),
)

/**
 * Lado de la imagen que consume el modelo. Sale de los metadatos del ONNX
 * (`imgsz: [640, 640]`), no de una suposición: el modelo es `dynamic`, así que
 * acepta otros tamaños, pero entrenó a 640.
 */
export const ONWAY_CAPTCHA_INPUT_SIDE = 640

/** Rondas de tablero dinámico 3×3, como el referente. */
export const ONWAY_CAPTCHA_MAX_DYNAMIC_ROUNDS = 3

/** Confianza mínima para aceptar la clase dominante. */
export const ONWAY_CAPTCHA_DOMINANT_THRESHOLD = 0.4

/** Confianza mínima para aceptar la clase en segundo lugar. */
export const ONWAY_CAPTCHA_SECOND_THRESHOLD = 0.25

/**
 * En tableros 4×4 cada celda es `1/16` de la escena y el contexto hace que el
 * modelo sobre-marque: el referente exige más confianza y sólo acepta el
 * segundo lugar cuando el primero fue `Other`.
 */
export const ONWAY_CAPTCHA_4X4_DOMINANT_THRESHOLD = 0.58
export const ONWAY_CAPTCHA_4X4_SECOND_THRESHOLD = 0.35

/**
 * Traducción de consigna en español a clase del modelo.
 *
 * El portal entrega la instrucción en español y el modelo razona en inglés. Se
 * conservan las variantes de Chile/LatAm que el referente verificó contra el
 * portal real, incluidas las que alternan singular y plural.
 */
const TRANSLATIONS: Record<string, OnwayCaptchaClass> = {
  // Car
  automoviles: "Car", automóviles: "Car", automovil: "Car", automóvil: "Car",
  autos: "Car", auto: "Car", coches: "Car", coche: "Car", carros: "Car",
  carro: "Car", vehiculos: "Car", vehículos: "Car", taxis: "Car", taxi: "Car",
  camionetas: "Car", camioneta: "Car", furgonetas: "Car", furgoneta: "Car",
  // Bus
  autobuses: "Bus", autobus: "Bus", autobús: "Bus", buses: "Bus", bus: "Bus",
  microbuses: "Bus", microbus: "Bus", microbús: "Bus",
  // Motorcycle
  motocicletas: "Motorcycle", motocicleta: "Motorcycle", motos: "Motorcycle", moto: "Motorcycle",
  // Bicycle
  bicicletas: "Bicycle", bicicleta: "Bicycle", bicis: "Bicycle",
  // Traffic Light
  semaforos: "Traffic Light", semáforos: "Traffic Light", semaforo: "Traffic Light",
  semáforo: "Traffic Light", "luces de trafico": "Traffic Light",
  "luces de tráfico": "Traffic Light", "luz de trafico": "Traffic Light",
  "luz de tráfico": "Traffic Light",
  // Bridge
  puentes: "Bridge", puente: "Bridge", "puentes peatonales": "Bridge", "puente peatonal": "Bridge",
  // Hydrant
  "bocas de incendio": "Hydrant", "bocas de incendios": "Hydrant",
  "boca de incendio": "Hydrant", "boca de incendios": "Hydrant",
  hidrantes: "Hydrant", hidrante: "Hydrant", grifos: "Hydrant", grifo: "Hydrant",
  "grifos de incendio": "Hydrant", "grifo de incendio": "Hydrant",
  // Stair
  escaleras: "Stair", escalera: "Stair", escalones: "Stair", peldaños: "Stair",
  peldanos: "Stair", gradas: "Stair",
  // Mountain
  montanas: "Mountain", montañas: "Mountain", montana: "Mountain", montaña: "Mountain",
  "montañas o colinas": "Mountain", "montanas o colinas": "Mountain",
  colinas: "Mountain", colina: "Mountain", cerros: "Mountain", cerro: "Mountain",
  montes: "Mountain", monte: "Mountain",
  // Palm
  palmeras: "Palm", palmera: "Palm", palmas: "Palm", palma: "Palm",
  // Crosswalk
  "cruces peatonales": "Crosswalk", "cruce peatonal": "Crosswalk",
  "pasos peatonales": "Crosswalk", "paso peatonal": "Crosswalk",
  "cruces de peatones": "Crosswalk", "cruce de peatones": "Crosswalk",
  "pasos de peatones": "Crosswalk", "paso de peatones": "Crosswalk",
  "pasos de cebra": "Crosswalk", "paso de cebra": "Crosswalk",
  "sendas peatonales": "Crosswalk", "senda peatonal": "Crosswalk",
  // Chimney
  chimeneas: "Chimney", chimenea: "Chimney",
  // Tractor
  tractores: "Tractor", tractor: "Tractor",
}

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

const TRANSLATIONS_FLAT: Record<string, OnwayCaptchaClass> = Object.fromEntries(
  Object.entries(TRANSLATIONS).map(([key, value]) => [stripAccents(key), value]),
)

/**
 * Traduce la consigna a la clase del modelo.
 *
 * Prueba la frase completa, la frase más larga contenida en ella y, como último
 * recurso, la versión singular de cada palabra: el portal alterna "boca de
 * incendio" y "boca de incendios". Devuelve la entrada original si nada calza,
 * para que quien llama decida si el desafío está fuera de repertorio.
 */
export function translateOnwayCaptchaObjective(objetivo: string): string {
  const key = objetivo.trim().toLowerCase().replace(/\.$/, "")
  if (!key) return ""
  if (key in TRANSLATIONS) return TRANSLATIONS[key]!

  const flat = stripAccents(key)
  if (flat in TRANSLATIONS_FLAT) return TRANSLATIONS_FLAT[flat]!

  // La consigna puede traer más texto pegado: se busca la frase más larga.
  const words = flat.split(/[\s,]+/).filter(Boolean)
  for (let size = words.length; size > 0; size--) {
    for (let start = 0; start + size <= words.length; start++) {
      const slice = words.slice(start, start + size).join(" ")
      if (slice in TRANSLATIONS_FLAT) return TRANSLATIONS_FLAT[slice]!
    }
  }

  for (const name of ONWAY_CAPTCHA_CLASSES) {
    if (name.toLowerCase() === flat) return name
  }

  // Inglés en plural o con otro sufijo: "bicycles" → "Bicycle", "cars" → "Car".
  // El tenant de Auth0 de OnWay sirve las consignas en inglés (medido 2026-11-26).
  const singularEn = words
    .map((word) => {
      if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`
      if (word.endsWith("sses") || word.endsWith("shes") || word.endsWith("ches")) return word.slice(0, -2)
      if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1)
      return word
    })
    .join(" ")
  for (const name of ONWAY_CAPTCHA_CLASSES) {
    if (name.toLowerCase() === singularEn) return name
  }

  // El inglés agrega adjetivos al sustantivo de la clase: "fire hydrants" debe
  // resolver a "Hydrant". Se prueba la última palabra del singular, que en una
  // consigna de reCAPTCHA es siempre el objeto.
  const lastEn = singularEn.split(" ").at(-1) ?? ""
  for (const name of ONWAY_CAPTCHA_CLASSES) {
    if (lastEn && name.toLowerCase() === lastEn) return name
  }

  const singular = words.map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word)).join(" ")
  if (singular in TRANSLATIONS_FLAT) return TRANSLATIONS_FLAT[singular]!

  return objetivo.trim()
}

/**
 * Extrae el objeto de la consigna.
 *
 * Acepta español e inglés: el portal de referencia servía las consignas en
 * español, pero el tenant de Auth0 de OnWay las sirve **en inglés**. Medido el
 * 2026-11-26 contra Auth0 real:
 *
 *   "Select all images with bicyclesClick verify once there are none left"
 *
 * Con solos los patrones en español no calzaba ninguno, la traducción fallaba y
 * el solver se rendía antes de marcar una casilla (por eso producción registró
 * `tiles: 0`).
 *
 * El texto de ayuda viene pegado sin espacio ("bicyclesClick verify"), así que
 * se separa camel-case antes de recortar. Sin eso la traducción tampoco calza.
 */
export function onwayCaptchaObjectiveFromPrompt(prompt: string): string {
  const text = prompt.trim()
  const patterns = [
    // Español
    /(?:imágenes|imagenes|cuadros|cuadradas)\s+con\s+(.+)$/i,
    /(?:selecciona|seleccione)\s+(?:todas?\s+)?(?:las\s+)?(.+)$/i,
    // Inglés
    /(?:select|click|choose)\s+(?:all\s+)?(?:the\s+)?(?:images|pictures|squares|tiles)\s+(?:with|containing|that contain)\s+(.+)$/i,
    /(?:select|click|choose)\s+(?:all\s+)?(.+?)\s*(?:click|once|verify|if there)/i,
  ]

  const withoutArticle = (value: string): string =>
    value
      .replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, "$1 $2")
      .replace(/([a-z])([A-Z][a-z])/g, "$1 $2")
      .replace(/\s*(?:haz clic|si no hay|verificar cuando).*$/i, "")
      .replace(/\s*(?:click verify|once there are|if there are|if none|verify once).*$/i, "")
      .replace(/[.;].*$/, "")
      .replace(/\bque\s+contengan?\b.*$/i, "")
      .replace(/^(?:un|una|unos|unas|el|la|los|las)\s+/i, "")
      .replace(/^(?:a|an|the)\s+/i, "")
      .trim()

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return withoutArticle(match[1])
  }
  return withoutArticle(text)
}

/** Ranking por casilla: las clases más probables con su probabilidad (softmax). */
export type OnwayCaptchaTileRanking = ReadonlyArray<[string, number]>

/**
 * Elige las casillas que contienen el objeto.
 *
 * El modelo entrega una probabilidad calibrada por clase, así que se acepta la
 * casilla cuando el objetivo es la clase dominante con confianza suficiente, o
 * cuando queda en segundo lugar con probabilidad relevante.
 *
 * En tableros 4×4 (`clases.length === 16`) se exige más: cada celda es un
 * recorte pequeño que tiende a sobre-marcar por contexto.
 *
 * `Other` es la clase de descarte del modelo y nunca cuenta como coincidencia.
 */
export function selectOnwayCaptchaTiles(
  classRankings: ReadonlyArray<OnwayCaptchaTileRanking>,
  objetivo: string,
  dominantThreshold = ONWAY_CAPTCHA_DOMINANT_THRESHOLD,
  secondThreshold = ONWAY_CAPTCHA_SECOND_THRESHOLD,
): number[] {
  const selected: number[] = []
  if (objetivo === "Other") return selected

  const isFourByFour = classRankings.length === 16
  const minDominant = isFourByFour ? Math.max(dominantThreshold, ONWAY_CAPTCHA_4X4_DOMINANT_THRESHOLD) : dominantThreshold
  const minSecond = isFourByFour ? Math.max(secondThreshold, ONWAY_CAPTCHA_4X4_SECOND_THRESHOLD) : secondThreshold

  for (let index = 0; index < classRankings.length; index++) {
    const ranking = classRankings[index] ?? []
    const position = ranking.findIndex(([name]) => name === objetivo)
    if (position < 0) continue

    const confidence = ranking[position]?.[1] ?? 0
    const first = ranking[0]?.[0] ?? ""
    if (position === 0 && confidence >= minDominant) {
      selected.push(index)
    } else if (position === 1 && confidence >= minSecond && (!isFourByFour || first === "Other")) {
      selected.push(index)
    }
  }

  return selected
}

/**
 * Lado del tablero a partir de los desplazamientos CSS del sprite.
 *
 * reCAPTCHA sirve **una sola imagen** y cada casilla la muestra desplazada por
 * `top`/`left` en porcentajes de −100 %, −200 %… Descargar el `src` por casilla
 * devolvía siempre la misma imagen.
 */
export function onwayCaptchaBoardGrid(offsets: ReadonlyArray<{ col: number; row: number }>): number {
  if (offsets.length === 0) return 1
  const max = Math.max(...offsets.flatMap((cell) => [cell.col, cell.row]))
  return Math.round(max) + 1
}
