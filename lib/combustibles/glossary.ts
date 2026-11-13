/**
 * Las palabras del módulo de Combustible, en simple. Lo muestra el botón
 * «¿Qué significa?» de cada pantalla, y `FuelTerm` usa la definición corta en
 * un `<abbr title>` (regla A6: una sigla de dominio lleva su nombre completo).
 *
 * `formerly` dice cómo se llamaba antes del rediseño (2026-10-31), para que
 * quien conocía el nombre viejo lo encuentre.
 */
export interface FuelGlossaryEntry {
  term: string
  formerly?: string
  definition: string
}

export const FUEL_GLOSSARY: readonly FuelGlossaryEntry[] = [
  { term: "Carga", definition: "Combustible que entra al estanque de un equipo, en un momento y lugar." },
  { term: "Cómo llegó", definition: "De dónde salió el registro: formulario en terreno (QR), registrada en la app, planilla de cargas, factura o histórico de sellos." },
  { term: "De dónde salió", formerly: "medio de suministro", definition: "Por dónde llegó el combustible: tarjeta en una estación, surtidor del mandante, camión surtidor, estanque propio u otro." },
  { term: "Tarjeta Copec de equipos", formerly: "TCT", definition: "Cada equipo tiene su tarjeta Copec y carga directo en una estación de servicio. Copec informa después cuántos litros cargó cada patente en el mes." },
  { term: "Tarjeta Copec de abastecimiento", formerly: "TAE", definition: "La tarjeta Copec de un estanque móvil de la empresa (camión surtidor o camioneta): carga en la estación y después reparte el combustible en faena." },
  { term: "Formulario en terreno", formerly: "TAE (PWA)", definition: "El formulario por QR que llena el operador al cargar: equipo, medidor, litros, sellos, fotos y personas." },
  { term: "Planilla de cargas", formerly: "log operacional", definition: "La planilla con una fila por carga (CONSOLIDADO COMBUSTIBLES) que se importa a la plataforma." },
  { term: "Sello", definition: "Precinto numerado de la tapa del estanque. En cada carga se retira uno y se pone otro nuevo." },
  { term: "Cadena de sellos", definition: "El sello que se retira debe ser el que se puso en la carga anterior del mismo equipo. Si no coincide, la cadena está rota." },
  { term: "Mandante", definition: "Cliente dueño de una o más faenas. La cuadratura y su tolerancia se miden por mandante." },
  { term: "Cuadratura", formerly: "conciliación", definition: "Comparación entre el combustible que entró (proveedores y surtidores) y el que se entregó a equipos, medida contra la tolerancia." },
  { term: "Tolerancia", definition: "Diferencia aceptada en la cuadratura de un mandante, en porcentaje de lo que entró." },
  { term: "Rendimiento", formerly: "km/L · L/h", definition: "Kilómetros por litro en equipos con odómetro (más es mejor) o litros por hora en equipos con horómetro (menos es mejor). Lo calcula la plataforma con las lecturas de cada carga." },
  { term: "Rinde peor", definition: "10 % peor que su modelo o que su propio historial." },
  { term: "Parejo / irregular", formerly: "desviación estándar, CV", definition: "Cuánto varía el rendimiento de una carga a otra. «Irregular» significa que varía más de un 25 %." },
  { term: "Motor en vacío", formerly: "ralentí", definition: "Horas con el motor encendido sin trabajar, lo que antes se llamaba ralentí. Se mide con la telemetría de los equipos (VisionLink)." },
  { term: "Carga por decidir", formerly: "carga marcada", definition: "Una carga que la plataforma no puede juzgar sola. Mientras nadie decide, sus litros cuentan, pero no entra a los promedios." },
  { term: "Caso", formerly: "anomalía", definition: "Un problema que detectó una regla y que alguien debe investigar y cerrar." },
  { term: "Estado de cuenta", formerly: "cuenta corriente, cartola", definition: "El resumen mensual de un proveedor, con lo que se debe y lo pagado." },
  { term: "IEC", definition: "Impuesto específico al combustible. Se cobra por cada litro y se suma al neto de la factura." },
  { term: "IVA", definition: "Impuesto al valor agregado, 19 % sobre el neto." },
  { term: "Estanque", formerly: "vasija", definition: "Depósito de combustible de la empresa en faena." },
  { term: "Punto de carga", definition: "Lugar donde se carga combustible y donde va el QR: surtidor fijo, camión surtidor, estanque de camioneta, bidón o estación con tarjeta." },
  { term: "Registrada después", definition: "Una carga que se anotó desde la oficina con una fecha y hora pasadas, con su motivo. Llega a «Por revisar» para que alguien confirme que cuenta." },
]

/** Definición corta de un término, para un `title`. */
export function fuelTermDefinition(term: string): string | undefined {
  const normalized = term.trim().toLowerCase()
  return FUEL_GLOSSARY.find((entry) => entry.term.toLowerCase() === normalized || entry.formerly?.toLowerCase() === normalized)?.definition
}
