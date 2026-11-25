import { describe, expect, it } from "vitest"
import {
  ONWAY_CAPTCHA_CLASSES,
  ONWAY_CAPTCHA_INPUT_SIDE,
  onwayCaptchaBoardGrid,
  onwayCaptchaObjectiveFromPrompt,
  selectOnwayCaptchaTiles,
  translateOnwayCaptchaObjective,
} from "./onway-captcha-contract"

/**
 * Estas pruebas vienen de `referencia-resolver-onway/tests/prt.test.ts`, donde
 * se midieron contra el portal real. Son la única parte del solver que se puede
 * verificar sin Auth0 ni el modelo ONNX.
 */
describe("onwayCaptchaObjectiveFromPrompt", () => {
  it("extrae el objeto de la consigna del portal", () => {
    expect(onwayCaptchaObjectiveFromPrompt("Selecciona todas las imágenes con taxis")).toBe("taxis")
    expect(onwayCaptchaObjectiveFromPrompt("Selecciona todas las imágenes con un autobús")).toBe("autobús")
    expect(
      onwayCaptchaObjectiveFromPrompt(
        "Selecciona todas las imágenes con una boca de incendio Haz clic en verificar cuando ya no quede ninguna",
      ),
    ).toBe("boca de incendio")
  })

  it("no arrastra el texto de ayuda al objeto", () => {
    const objetivo = onwayCaptchaObjectiveFromPrompt(
      "Selecciona todas las imágenes con semáforos Haz clic en verificar cuando ya no quede ninguna VERIFICAR",
    )
    expect(objetivo).toBe("semáforos")
    expect(objetivo).not.toMatch(/haz clic/i)
  })

  it("separa la ayuda pegada sin espacio, como llega en el portal real", () => {
    expect(onwayCaptchaObjectiveFromPrompt("Selecciona todas las imágenes con bocas de incendiosHaz clic en verificar"))
      .toBe("bocas de incendios")
  })
})

describe("translateOnwayCaptchaObjective", () => {
  it("traduce consignas en español chileno/latinoamericano a las 14 clases", () => {
    expect(translateOnwayCaptchaObjective("taxis")).toBe("Car")
    expect(translateOnwayCaptchaObjective("pasos peatonales")).toBe("Crosswalk")
    expect(translateOnwayCaptchaObjective("grifos de incendio")).toBe("Hydrant")
    expect(translateOnwayCaptchaObjective("montañas o colinas")).toBe("Mountain")
    expect(translateOnwayCaptchaObjective("luces de tráfico")).toBe("Traffic Light")
    expect(translateOnwayCaptchaObjective("semáforos")).toBe("Traffic Light")
    expect(translateOnwayCaptchaObjective("autobús")).toBe("Bus")
    expect(translateOnwayCaptchaObjective("bicicletas")).toBe("Bicycle")
  })

  it("no inventa una clase cuando la consigna está fuera del repertorio", () => {
    expect(translateOnwayCaptchaObjective("barcos")).toBe("barcos")
    expect(ONWAY_CAPTCHA_CLASSES).not.toContain("barcos")
  })

  it("tolera tildes ausentes y el artículo inicial que ya quitó el extractor", () => {
    expect(translateOnwayCaptchaObjective("semaforos")).toBe("Traffic Light")
    expect(translateOnwayCaptchaObjective("montanas")).toBe("Mountain")
  })

  it("usa la versión singular cuando el portal alterna plural y singular", () => {
    expect(translateOnwayCaptchaObjective("boca de incendio")).toBe("Hydrant")
    expect(translateOnwayCaptchaObjective("bocas de incendio")).toBe("Hydrant")
  })

  it("reconoce una consigna que ya viene en inglés", () => {
    expect(translateOnwayCaptchaObjective("Crosswalk")).toBe("Crosswalk")
    expect(translateOnwayCaptchaObjective("traffic light")).toBe("Traffic Light")
  })
})

describe("selectOnwayCaptchaTiles", () => {
  it("marca la casilla cuando el objeto es la clase dominante", () => {
    const indices = selectOnwayCaptchaTiles(
      [
        [["Motorcycle", 0.7], ["Bicycle", 0.3]],
        [["Car", 0.99], ["Crosswalk", 0.004]],
        [["Bicycle", 0.77], ["Car", 0.21]],
      ],
      "Motorcycle",
    )
    expect(indices).toEqual([0])
  })

  it("descarta cuando la confianza es baja", () => {
    expect(selectOnwayCaptchaTiles([[["Motorcycle", 0.2], ["Car", 0.8]]], "Motorcycle")).toEqual([])
  })

  it("acepta el objeto en segundo lugar con confianza alta", () => {
    expect(selectOnwayCaptchaTiles([[["Car", 0.45], ["Bus", 0.65]]], "Bus")).toEqual([0])
  })

  it("acepta el objeto en segundo lugar con probabilidades softmax reales (>= 0.25)", () => {
    expect(selectOnwayCaptchaTiles([[["Other", 0.55], ["Bus", 0.30], ["Car", 0.15]]], "Bus")).toEqual([0])
  })

  it("aplica umbrales más estrictos en tableros 4x4 (16 celdas) para evitar sobre-marcado", () => {
    const board: [string, number][][] = Array.from({ length: 16 }, () => [["Other", 0.9]])
    board[2] = [["Traffic Light", 0.45], ["Other", 0.40]] // débil en 4x4 (< 0.58): se descarta
    board[5] = [["Traffic Light", 0.72], ["Other", 0.20]] // dominante fuerte (>= 0.58): se acepta
    board[6] = [["Other", 0.52], ["Traffic Light", 0.38]] // 2.º tras Other (>= 0.35): se acepta
    board[7] = [["Car", 0.52], ["Traffic Light", 0.38]] // 2.º tras otra clase distinta de Other: se descarta

    expect(selectOnwayCaptchaTiles(board, "Traffic Light")).toEqual([5, 6])
  })

  it("nunca marca la clase de descarte Other", () => {
    expect(selectOnwayCaptchaTiles([[["Other", 0.9], ["Car", 0.1]]], "Other")).toEqual([])
  })

  it("no marca nada cuando no hay coincidencias", () => {
    expect(
      selectOnwayCaptchaTiles([[["Car", 0.9], ["Bus", 0.1]], [["Palm", 0.8]]], "Boat"),
    ).toEqual([])
  })

  it("no falla con rankings vacíos ni más cortos que el tablero", () => {
    expect(selectOnwayCaptchaTiles([[], []], "Car")).toEqual([])
    expect(selectOnwayCaptchaTiles([], "Car")).toEqual([])
  })
})

describe("onwayCaptchaBoardGrid", () => {
  it("deduce el lado desde los desplazamientos del sprite", () => {
    // 3×3: los desplazamientos llegan a −200 %.
    expect(onwayCaptchaBoardGrid([{ col: 0, row: 0 }, { col: 2, row: 2 }])).toBe(3)
    // 4×4: llegan a −300 %.
    expect(onwayCaptchaBoardGrid([{ col: 0, row: 0 }, { col: 3, row: 3 }])).toBe(4)
    // Tesela individual reemplazada en un tablero dinámico.
    expect(onwayCaptchaBoardGrid([{ col: 0, row: 0 }])).toBe(1)
  })
})

describe("constantes del contrato", () => {
  it("el lado de entrada coincide con los metadatos del ONNX (imgsz: [640, 640])", () => {
    expect(ONWAY_CAPTCHA_INPUT_SIDE).toBe(640)
  })

  it("expone las 14 clases del modelo, con Other como descarte", () => {
    expect(ONWAY_CAPTCHA_CLASSES).toHaveLength(14)
    expect(ONWAY_CAPTCHA_CLASSES).toContain("Other")
    expect(ONWAY_CAPTCHA_CLASSES).toContain("Traffic Light")
  })
})
