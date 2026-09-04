import type { EmergencyScenarioType } from "./emergency"

/**
 * lib/prevention/emergency-threats.ts
 *
 * Las amenazas que un plan de emergencia declara, con su procedimiento de
 * respuesta. Transcritas del `DO-41 Procedimiento Gestión del Riesgo de
 * Desastres` y del protocolo ACCEDER que la empresa ya aplica por centro de
 * trabajo, no redactadas desde la norma.
 *
 * El DO-41 (punto 6.4.1) fija literalmente el mínimo: *"Como mínimo, deben
 * evaluarse las amenazas de sismo, incendio estructural, corte de agua, corte
 * de energía eléctrica y asalto o robo"*. Ésas son las `mandatory` y son las
 * únicas que el sembrador escribe.
 *
 * Las `senapred_detected` —tsunami, incendio forestal, erupción volcánica— el
 * mismo punto las condiciona a *"ubicación, historia o exposición"*, y la matriz
 * por centro de trabajo las cruza contra el Visor Territorial de SENAPRED.
 * **No se siembran**: `worksites` sólo guarda `region`, no comuna, y el visor se
 * consulta por centro de trabajo. Declarar una erupción volcánica en una faena
 * que no la tiene expuesta es dato falso dentro de un plan que se audita.
 * Quedan acá para que Prevención las agregue desde la pantalla en un clic, con
 * su procedimiento ya escrito.
 *
 * Las `operational` no son amenazas territoriales: son escenarios propios de una
 * faena de residuos industriales, con procedimiento operativo propio.
 */

export type EmergencyThreatObligation = "mandatory" | "senapred_detected" | "operational"

export interface EmergencyThreat {
  type: EmergencyScenarioType
  title: string
  obligation: EmergencyThreatObligation
  /** Respuesta ACCEDER resumida. `addEmergencyScenario` exige de 10 a 10.000 caracteres. */
  responseProcedure: string
}

const ALERTA_INTERNA =
  "Alerta y alarma: la alerta interna la da el representante del Departamento de Prevención de Riesgos a viva voz o por megafonía; "
  + "la externa llega por SENAPRED (sitio web y mensajería SAE). "

const COORDINACION =
  "Coordinación: el Coordinador GRD dirige la respuesta y su suplente lo reemplaza en ausencia. "
  + "Contactos externos: Mutual de Seguridad 1407, SAMU 131, Bomberos 132, Carabineros 133. "

const CIERRE =
  "Evaluación y readecuación: se registran las brechas detectadas en el Plan de Mejora del programa GRD, "
  + "con responsable y plazo, y se revisa el plan de respuesta antes del siguiente ejercicio."

export const EMERGENCY_THREAT_CATALOG: readonly EmergencyThreat[] = [
  {
    type: "sismo",
    title: "Sismo de gran magnitud",
    obligation: "mandatory",
    responseProcedure:
      "Durante el movimiento: agacharse, cubrirse y afirmarse; no evacuar mientras dure el sismo ni usar ascensores. "
      + ALERTA_INTERNA
      + "Terminado el movimiento se evacúa a la zona de seguridad definida, se hace conteo de personas y se asiste a visitas y a personas con movilidad reducida. "
      + COORDINACION
      + "Evaluación preliminar: revisar estructuras, tableros eléctricos, estanques y almacenamiento de sustancias peligrosas antes de autorizar el reingreso. "
      + "Si SENAPRED declara alerta de tsunami y el centro de trabajo está expuesto, se activa además ese plan de respuesta. "
      + CIERRE,
  },
  {
    type: "incendio_estructural",
    title: "Incendio estructural",
    obligation: "mandatory",
    responseProcedure:
      "Quien detecta humo o fuego da la alarma de inmediato y no intenta controlar el fuego si excede un amago o si compromete su seguridad. "
      + ALERTA_INTERNA
      + "Se corta la energía del sector, se evacúa por las vías señalizadas hacia la zona de seguridad y se hace conteo de personas. "
      + "El uso de extintores queda restringido a personal capacitado y sólo sobre amagos, con el agente que corresponda a la clase de fuego. "
      + COORDINACION
      + "Se avisa a Bomberos (132) y se les entrega el plano de instalaciones, la ubicación de estanques y la hoja de datos de las sustancias almacenadas. "
      + CIERRE,
  },
  {
    type: "corte_energia",
    title: "Corte de energía eléctrica",
    obligation: "mandatory",
    responseProcedure:
      "Se detienen las maniobras en curso —izaje, operación de equipos móviles, trabajos en altura— y se aseguran las cargas antes de abandonar la posición. "
      + ALERTA_INTERNA
      + "Se verifica la iluminación de emergencia y las vías de evacuación, y se confirma el estado de los equipos críticos y de la cadena de frío si aplica. "
      + COORDINACION
      + "Se contacta a la distribuidora eléctrica para estimar el tiempo de reposición y se decide si corresponde suspender la faena. "
      + "Al reponerse el suministro, los equipos se reinician de forma controlada y se verifica que no hayan quedado en marcha automática. "
      + CIERRE,
  },
  {
    type: "corte_agua",
    title: "Corte de agua potable",
    obligation: "mandatory",
    responseProcedure:
      "Se verifica la autonomía de los estanques y la disponibilidad de agua para servicios higiénicos, consumo humano y lavado de ojos o duchas de emergencia. "
      + ALERTA_INTERNA
      + "Si la autonomía no cubre la jornada, se dispone la provisión de agua envasada y se evalúa suspender las tareas que exijan agua para control de riesgos. "
      + COORDINACION
      + "Se contacta a la sanitaria para estimar la reposición y se informa a la línea de mando el plazo estimado. "
      + "Sin servicios higiénicos operativos en condiciones aceptables no se mantiene la faena, conforme a las condiciones sanitarias básicas exigidas. "
      + CIERRE,
  },
  {
    type: "asalto_robo",
    title: "Asalto o robo",
    obligation: "mandatory",
    responseProcedure:
      "Durante el hecho: no oponer resistencia, no perseguir a los autores y priorizar la integridad de las personas por sobre cualquier bien. "
      + "Terminado el hecho se da la alerta interna, se verifica el estado de todas las personas y se preserva el sitio del suceso sin alterarlo. "
      + COORDINACION
      + "Se avisa a Carabineros (133) y se realiza la denuncia; si hay lesionados se activa el traslado al centro asistencial y se da aviso a la Mutual. "
      + "Se informa a la Alta Dirección y se contacta a los familiares cuando una persona trabajadora es trasladada a un centro de salud. "
      + CIERRE,
  },
  {
    type: "tsunami",
    title: "Tsunami o maremoto",
    obligation: "senapred_detected",
    responseProcedure:
      "Ante sismo perceptible en zona costera se evacúa de inmediato, sin esperar alarma, hacia la zona de seguridad sobre la cota 30 metros sobre el nivel del mar. "
      + ALERTA_INTERNA
      + "Las vías de evacuación y las zonas de seguridad oficiales se difunden previamente a toda la dotación y se coordinan con la Municipalidad. "
      + COORDINACION
      + "No se regresa al centro de trabajo hasta que la autoridad cancele formalmente la alerta. "
      + CIERRE,
  },
  {
    type: "incendio_forestal",
    title: "Incendio forestal",
    obligation: "senapred_detected",
    responseProcedure:
      "Se monitorean los avisos de CONAF y SENAPRED y se informa a toda la dotación cada vez que se emita una alerta por incendio forestal. "
      + ALERTA_INTERNA
      + "Si el riesgo no se puede eliminar ni atenuar, se suspenden de inmediato las faenas afectadas y se evacúa a las personas trabajadoras. "
      + COORDINACION
      + "Se avisa al 131 o 1407 ante síntomas asociados a la inhalación de humo o a las altas temperaturas. "
      + CIERRE,
  },
  {
    type: "erupcion_volcanica",
    title: "Erupción volcánica",
    obligation: "senapred_detected",
    responseProcedure:
      "Se monitorean los avisos de SENAPRED y SERNAGEOMIN y se respeta el radio de exclusión que la autoridad declare. "
      + ALERTA_INTERNA
      + "Ante caída de ceniza se suspenden las faenas al aire libre, se entrega protección respiratoria y ocular, y se protegen los filtros de los equipos móviles. "
      + COORDINACION
      + "Si la autoridad ordena evacuación preventiva, se suspende la faena y se sigue la ruta que indique el plan comunal. "
      + CIERRE,
  },
  {
    type: "inundacion_lluvia",
    title: "Inundación por lluvia",
    obligation: "operational",
    responseProcedure:
      "Ante alerta meteorológica se revisan techumbres, canaletas y sistemas de evacuación de aguas, y se retira el material almacenado a nivel de piso. "
      + ALERTA_INTERNA
      + "Se cortan los circuitos eléctricos de los sectores anegados antes de intervenir y se prohíbe transitar por agua en contacto con instalaciones energizadas. "
      + COORDINACION
      + "Se verifica que el anegamiento no arrastre residuos ni sustancias peligrosas fuera del área de contención. "
      + CIERRE,
  },
  {
    type: "derrame",
    title: "Derrame de sustancias peligrosas",
    obligation: "operational",
    responseProcedure:
      "Quien detecta el derrame da la alarma, no intenta contenerlo sin el equipo adecuado y aleja al personal no involucrado. "
      + "Se aplica el procedimiento DO-28 de control de derrames con el kit antiderrame del sector, delimitando y conteniendo antes de recuperar. "
      + ALERTA_INTERNA
      + "Se consulta la hoja de datos de seguridad de la sustancia antes de manipularla y se usa la protección personal que ésta indique. "
      + COORDINACION
      + "El residuo recuperado se dispone como RESPEL según el procedimiento de transporte y disposición, con su registro correspondiente. "
      + CIERRE,
  },
] as const

/** Las que el sembrador escribe en todo plan nuevo. */
export function mandatoryEmergencyThreats(): readonly EmergencyThreat[] {
  return EMERGENCY_THREAT_CATALOG.filter((threat) => threat.obligation === "mandatory")
}
