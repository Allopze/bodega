/**
 * lib/services/prevention-documents/master-list-2026.ts
 *
 * El RE-08 "Listado Maestro de Información Documentada" del SGI, embebido.
 *
 * **Por qué embebido y no leído del XLSX.** `docs/` no se copia al contenedor,
 * así que un sembrador que abriera el archivo en tiempo de despliegue fallaría.
 * Es el mismo patrón que `PDTP_2026_SOURCE` y las plantillas de inspección: el
 * contenido viaja en el código y `scripts/extract-re08-master-list.ts` lo
 * regenera cuando el listado cambia de versión. `RE08_SOURCE.sha256` es lo que
 * hace ruidoso ese desfase — hay un test que lo compara contra el archivo real.
 *
 * **Qué es cada renglón.** El RE-08 lista documentos, no clases de documento:
 * `DO-01-A "Comprensión de la organización" v4` es un documento, existe uno
 * solo y su historia de versiones va en `sst_document_versions`. Los `RE-xx`
 * son el **formato en blanco**, que también es un documento; sus instancias no
 * —una lista de asistencia vive en `prevention_training_sessions`, y
 * duplicarla acá rompería la unicidad de la evidencia—.
 *
 * **Lo que no trae y hay que derivar:** el tipo documental. No hay columna que
 * lo diga (la de "TIPO DOCUMENTO" dice "Interno" en las 99 filas), así que sale
 * del prefijo del código y del nombre.
 *
 * **Los códigos no son únicos.** `DO-20` y `DO-37` aparecen dos veces, con
 * documentos distintos cada uno, y cinco filas no tienen código. Es un error
 * del propio listado, no de esta transcripción: por eso `code` es nullable y
 * **no hay índice único sobre `internal_code`**. La identidad acá es el `n` de
 * la fila.
 */

export interface Re08Document {
  /** Nº de fila del listado. Es la única identidad estable que el RE-08 ofrece. */
  n: number
  /** `null` en las cinco filas "Sin Código" y en los duplicados no se desambigua. */
  code: string | null
  name: string
  version: number | null
  effectiveFrom: string | null
  /** Taxonomía ISO 9001 (Estratégico/Apoyo/Operativo), no SST. Va a metadatos. */
  process: string | null
  retention: string | null
  owner: string | null
  /** Cláusula ISO donde vive: `4_Contexto` … `10_Mejora`. Alimenta las carpetas. */
  folder: string | null
  subfolder: string | null
}

export const RE08_SOURCE = {
  fileName: "RE-08 LISTADO MAESTRO DE INFORMACIÓN DOCUMENTADA.xlsx",
  repoPath: "docs/prevención/SGI Chome_2026/7 Apoyo/DO-11 Información Documentada/RE-08 LISTADO MAESTRO DE INFORMACIÓN DOCUMENTADA.xlsx",
  sha256: "1baa2c3b5c64a94d51d8ae64388f8ad36f9b5cb9a1d3b2dc51f6797fd9845d44",
  /** Versión 3 del listado, vigente al 2026-05-20. */
  listVersion: 3,
  documentCount: 99,
  /** RE-09, RE-10 y RE-11: códigos reservados sin documento. No se siembran. */
  vacantCodes: ["RE-09", "RE-10", "RE-11"],
} as const

export const RE08_DOCUMENTS: readonly Re08Document[] = [
  {"n":1,"code":"DO-01-A","name":"Comprensión de la organización y de su contexto","version":4,"effectiveFrom":"2026-05-05","process":"Estratégico","retention":"3 años","owner":"Gerente General","folder":"4_Contexto","subfolder":null},
  {"n":2,"code":"DO-01-B","name":"Comprensión de las necesidades y expectativas de las partes interesadas","version":4,"effectiveFrom":"2026-05-05","process":"Estratégico","retention":"3 años","owner":"Gerente General","folder":"4_Contexto","subfolder":null},
  {"n":3,"code":"DO-01-C","name":"Determinación del Alcance del SGI","version":4,"effectiveFrom":"2026-05-05","process":"Estratégico","retention":"3 años","owner":"Gerente General","folder":"4_Contexto","subfolder":null},
  {"n":4,"code":"DO-02","name":"Diagrama de Procesos","version":2,"effectiveFrom":"2026-05-05","process":"Estratégico","retention":"3 años","owner":"Gerente General","folder":"4_Contexto","subfolder":null},
  {"n":5,"code":"DO-01-D","name":"Acciones para abordar riesgos y oportunidades","version":4,"effectiveFrom":"2026-05-05","process":"Estratégico","retention":"3 años","owner":"Gerente General","folder":"4_Contexto","subfolder":null},
  {"n":6,"code":null,"name":"Política del Sistema Integrado","version":2,"effectiveFrom":"2025-10-01","process":"Estratégico","retention":"3 años","owner":"Gerente General","folder":"5_Liderazgo","subfolder":"5.2 Política"},
  {"n":7,"code":"DO-03","name":"Organigrama Servicios Industriales Chome Ltda.","version":4,"effectiveFrom":"2026-05-26","process":"Estratégico","retention":"3 años","owner":"Gerente General","folder":"5_Liderazgo","subfolder":"5.3. Responsabilidades y Autoridad"},
  {"n":8,"code":"DO-04","name":"Perfiles de Cargos","version":2,"effectiveFrom":"2025-01-15","process":"Estratégico","retention":"3 años","owner":"Gerente General","folder":"5_Liderazgo","subfolder":"5.3. Responsabilidades y Autoridad"},
  {"n":9,"code":"DO-05","name":"Formato Evaluación Desempeño","version":1,"effectiveFrom":"2024-12-01","process":"Estratégico","retention":"3 años","owner":"Gerente General","folder":"5_Liderazgo","subfolder":"5.3. Responsabilidades y Autoridad"},
  {"n":10,"code":"RE-01","name":"Objetivos y su Planificación para lograrlos","version":2,"effectiveFrom":"2025-01-17","process":"Estratégico","retention":"3 años","owner":"Gerente General","folder":"6_Planificación","subfolder":null},
  {"n":11,"code":"RE-02","name":"Matriz de Aspectos y Evaluacion de Impactos Ambientales","version":2,"effectiveFrom":"2025-03-20","process":"Estratégico","retention":"3 años","owner":"Encargada SGI","folder":"6_Planificación","subfolder":null},
  {"n":12,"code":"RE-03","name":"Matriz de Identificación y Evaluación de Requisitos Legales y Otros","version":2,"effectiveFrom":"2026-03-20","process":"Estratégico","retention":"3 años","owner":"Subgerente Legal y de Personas","folder":"6_Planificación","subfolder":null},
  {"n":13,"code":"DO-06","name":"Identificación de Peligros y Evaluación de los Riesgos para la SST","version":3,"effectiveFrom":"2025-01-31","process":"Estratégico","retention":"3 años","owner":"Jefe de Prevención de Riesgos y Salud Ocupacional","folder":"6_Planificación","subfolder":"DO-06 Identificación de Peligros"},
  {"n":14,"code":"RE-04","name":"Formato Matriz IPER","version":2,"effectiveFrom":"2025-01-31","process":"Estratégico","retention":"3 años","owner":"Jefe de Prevención de Riesgos y Salud Ocupacional","folder":"6_Planificación","subfolder":"DO-06 Identificación de Peligros"},
  {"n":15,"code":"DO-20","name":"Procedimiento Gestión del Cambio","version":1,"effectiveFrom":"2024-12-01","process":"Estratégico","retention":"3 años","owner":"Encargada SGI","folder":"6_Planificación","subfolder":"DO-20 Procedimiento Gestión del Cambio"},
  {"n":16,"code":"RE-14","name":"Registro Análisis de Gestión del Cambio","version":1,"effectiveFrom":"2024-12-01","process":"Estratégico","retention":"3 años","owner":"Encargada SGI","folder":"6_Planificación","subfolder":"DO-20 Procedimiento Gestión del Cambio"},
  {"n":17,"code":"DO-37","name":"Plan de Medio Ambiente para Servicios Industriales Chome","version":1,"effectiveFrom":"2024-12-01","process":"Estratégico","retention":"3 años","owner":"Encargada SGI","folder":"6_Planificación","subfolder":"DO-37 Plan Medio Ambiente"},
  {"n":18,"code":"RE-26","name":"Seguimiento Plan de Medio Ambiente","version":1,"effectiveFrom":"2024-12-01","process":"Estratégico","retention":"3 años","owner":"Encargada SGI","folder":"6_Planificación","subfolder":"DO-37 Plan Medio Ambiente"},
  {"n":19,"code":"DO-07","name":"Infraestructura","version":2,"effectiveFrom":"2025-12-01","process":"Apoyo","retention":"3 años","owner":"Jefe de Control","folder":"7_Apoyo","subfolder":"DO-07 Infraestructura"},
  {"n":20,"code":"DO-08","name":"Selección, Contratación, Inducción","version":2,"effectiveFrom":"2025-12-01","process":"Apoyo","retention":"3 años","owner":"Subgerente Legal y de Personas","folder":"7_Apoyo","subfolder":"DO-08 Selección_Contratación_Inducción"},
  {"n":21,"code":"DO-09","name":"Competencias - Capacitación","version":2,"effectiveFrom":"2025-12-01","process":"Apoyo","retention":"3 años","owner":"Subgerente Legal y de Personas","folder":"7_Apoyo","subfolder":"DO-09 Competencias Capacitación"},
  {"n":22,"code":"RE-05","name":"Plan de Capacitación Año XXXX","version":1,"effectiveFrom":"2024-12-01","process":"Apoyo","retention":"3 años","owner":"Encargada SGI","folder":"7_Apoyo","subfolder":"DO-09 Competencias Capacitación"},
  {"n":23,"code":"RE-06","name":"Evaluación Eficacia de la Capacitación","version":1,"effectiveFrom":"2024-12-01","process":"Apoyo","retention":"3 años","owner":"Encargada SGI","folder":"7_Apoyo","subfolder":"DO-09 Competencias Capacitación"},
  {"n":24,"code":"RE-07","name":"Lista de Asistencia","version":3,"effectiveFrom":"2025-06-09","process":"Apoyo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"7_Apoyo","subfolder":"DO-09 Competencias Capacitación"},
  {"n":25,"code":"DO-10","name":"Comunicación","version":2,"effectiveFrom":"2025-12-01","process":"Estratégico","retention":"3 años","owner":"Gerente General","folder":"7_Apoyo","subfolder":null},
  {"n":26,"code":"DO-11","name":"Control de Información Documentada","version":2,"effectiveFrom":"2026-03-25","process":"Apoyo","retention":"3 años","owner":"Encargada SGI","folder":"7_Apoyo","subfolder":"7.5. Información Documentada"},
  {"n":27,"code":"RE-08","name":"Listado Maestro de Información Documentada","version":3,"effectiveFrom":"2026-05-20","process":"Apoyo","retention":"3 años","owner":"Encargada SGI","folder":"7_Apoyo","subfolder":"7.5. Información Documentada"},
  {"n":28,"code":"DO-12","name":"Prestación del Servicio","version":2,"effectiveFrom":"2025-12-01","process":"Operativo","retention":"3 años","owner":"Subgerente de Operaciones","folder":"8_Operación","subfolder":"1. Prestación del Servicio"},
  {"n":32,"code":"DO-13","name":"Compras y Evaluación de Proveedores","version":1,"effectiveFrom":"2024-12-01","process":"Apoyo","retention":"3 años","owner":"Suberente de Administración y Finanzas","folder":"8_Operación","subfolder":"2_Adquisiciones y Evaluación de Proveedores"},
  {"n":33,"code":"RE-12","name":"EVALUACIÓN DE PROVEEDORES","version":1,"effectiveFrom":"2024-12-01","process":"Apoyo","retention":"3 años","owner":"Suberente de Administración y Finanzas","folder":"8_Operación","subfolder":"2_Adquisiciones y Evaluación de Proveedores"},
  {"n":34,"code":"DO-14","name":"OPERACIÓN CAMION AMPLIROLL","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-14 OPERACIÓN CAMION AMPLIROLL"},
  {"n":35,"code":"DO-15","name":"DO-15 OPERACIÓN MAQUINARIA PESADA","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-15 OPERACIÓN MAQUINARIA PESADA"},
  {"n":36,"code":"DO-16","name":"DO-16 TRANSPORTE RESIDUOS PELIGROSOS","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-16 TRANSPORTE RESIDUOS PELIGROSOS"},
  {"n":37,"code":null,"name":"LISTA DE CHEQUEO DE VERIFICACION CUMPLIMIENTO D.S 298","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-16 TRANSPORTE RESIDUOS PELIGROSOS"},
  {"n":38,"code":"DO-17","name":"TRANSPORTE RESIDUOS NO PELIGROSOS","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-17 TRANSPORTE RESIDUOS NO PELIGROSOS"},
  {"n":39,"code":"DO-18","name":"PROCEDIMIENTO DE AREA DE DISPOSICION CONTROLADA","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-18 PROCEDIMIENTO DE AREA DE DISPOSICION CONTROLADA"},
  {"n":40,"code":"DO-19","name":"TRABAJO EN CALIENTE","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-19 TRABAJO EN CALIENTE"},
  {"n":41,"code":"DO-20","name":"REMOLQUE DE EQUIPOS MÓVILES","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-20 REMOLQUE DE EQUIPOS MÓVILES"},
  {"n":42,"code":"DO-21","name":"AREA CAUSTIFICACION QUIMICOS","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-21 AREA CAUSTIFICACION QUIMICOS"},
  {"n":43,"code":"DO-22","name":"PROCEDIMIENTO RETIRO RESIDUOS DOMESTICO, ASIMILABLE A DOMESTICO, CHATARRA, ESCOMBRO Y MADERA","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-22 RESIDUOS DOMESTICOS"},
  {"n":44,"code":"DO-23","name":"PROCEDIMIENTO OPERACIÓN RETROEXCAVADORA","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-23 PROCEDIMIENTO OPERACIÓN RETROEXCAVADORA"},
  {"n":45,"code":"DO-24","name":"PROCEDIMIENTO OPERACIÓN EXCAVADORA","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-24 PROCEDIMIENTO OPERACIÓN EXCAVADORA"},
  {"n":46,"code":"DO-25","name":"PROCEDIMIENTO OPERACIÓN CAMIÓN BATEA","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-25 PROCEDIMIENTO OPERACIÓN CAMIÓN BATEA"},
  {"n":47,"code":"DO-27","name":"LIMPIEZA DE EQUIPOS MÓVILES","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-27 LIMPIEZA DE EQUIPOS MÓVILES"},
  {"n":48,"code":"DO-28","name":"PROCEDIMIENTO CONTROL DE DERRAMES Y LIMPIEZA DE EQUIPOS MOVILES SANTA FE","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-28 PROCEDIMIENTO CONTROL DE DERRAMES Y LIMPIEZA DE EQUIPOS MOVILES SANTA FE"},
  {"n":49,"code":"DO-29","name":"PROCEDIMIENTO BODEGA TRANSITORIA RESPEL SANTA FE","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-29 PROCEDIMIENTO BODEGA TRANSITORIA RESPEL SANTA FE"},
  {"n":50,"code":"DO-30","name":"PROCEDIMIENTO MANIOBRAS DE IZAJE","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-30 PROCEDIMIENTO MANIOBRAS DE IZAJE"},
  {"n":51,"code":"DO-31","name":"PROCEDIMIENTO OPERACIÓN CAMIÓN PLUMA","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-31 PROCEDIMIENTO OPERACIÓN CAMIÓN PLUMA"},
  {"n":52,"code":"DO-37","name":"PROCEDIMIENTO OPERACIÓN GRÚA ALZAHOMBRE","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-37 PROCEDIMIENTO OPERACIÓN GRÚA ALZAHOMBRE"},
  {"n":53,"code":"DO-38","name":"PROCEDIMIENTO OPERACIÓN GRUA TELESCÓPICA (PLUMA)","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-38 PROCEDIMIENTO OPERACIÓN GRUA TELESCÓPICA (PLUMA)"},
  {"n":54,"code":"DO-39","name":"INSTRUCTIVO DE ENTREGA, USO Y REPOSICIÓN DE ELEMENTOS DE PROTECCIÓN PERSONAL (EPP)","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"DO-39 USO Y REPOSICIÓN DE EPP"},
  {"n":55,"code":"RE-23-1","name":"Registro Entrega EPP TRABAJADOR NUEVO","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"DO-39 USO Y REPOSICIÓN DE EPP"},
  {"n":56,"code":"RE-23-2","name":"Registro Diario Entrega EPP","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"DO-39 USO Y REPOSICIÓN DE EPP"},
  {"n":57,"code":null,"name":"CARTA DE AMONESTACIÓN","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Subgerente Legal y de Personas","folder":"8_Operación","subfolder":"DO-39 USO Y REPOSICIÓN DE EPP"},
  {"n":58,"code":"DO-40","name":"USO DE HERRAMIENTAS MANUALES Y ELÉCTRICAS","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-40 USO DE HERRAMIENTAS MANUALES Y ELÉCTRICAS"},
  {"n":59,"code":"RE-24","name":"Lista de Verificación de Herramientas","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"8_Operación","subfolder":"DO-40 USO DE HERRAMIENTAS MANUALES Y ELÉCTRICAS"},
  {"n":60,"code":"DO-41","name":"Procedimiento Gestión del Riesgo de Desastres","version":1,"effectiveFrom":"2026-03-03","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"5_SSO_Preparación y Respuesta a Emergencias"},
  {"n":61,"code":"DO-42","name":"Programa de Gestión MMC-MMP","version":1,"effectiveFrom":"2026-05-26","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":62,"code":"RE-25","name":"Programa Anual de Simulacros","version":1,"effectiveFrom":"2025-04-08","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"5_SSO_Preparación y Respuesta a Emergencias"},
  {"n":63,"code":"DO-26","name":"Control de Salidas No Conforme","version":1,"effectiveFrom":"2024-12-01","process":"Operativo","retention":"3 años","owner":"Subgerente de Operaciones","folder":"8_Operación","subfolder":"5_Salidas No Conforme"},
  {"n":64,"code":"DO-32","name":"Seguimiento y Medición","version":1,"effectiveFrom":"2024-12-01","process":"Operativo","retention":"3 años","owner":"Encargada SGI","folder":"9_Seguimiento y Evaluación","subfolder":"1_Seguimiento y Medición"},
  {"n":65,"code":"DO-33","name":"Procedimiento de Auditoría Interna","version":1,"effectiveFrom":"2024-12-01","process":"Estratégico","retention":"3 años","owner":"Encargada SGI","folder":"9_Seguimiento y Evaluación","subfolder":"2_Auditorías Internas"},
  {"n":66,"code":"RE-15","name":"Programa Anual de Auditorias","version":1,"effectiveFrom":"2024-12-01","process":"Estratégico","retention":"3 años","owner":"Encargada SGI","folder":"9_Seguimiento y Evaluación","subfolder":"2_Auditorías Internas"},
  {"n":67,"code":"RE-16","name":"Plan de Auditoría Interna NºXXX","version":1,"effectiveFrom":"2024-12-01","process":"Estratégico","retention":"3 años","owner":"Auditor Interno","folder":"9_Seguimiento y Evaluación","subfolder":"2_Auditorías Internas"},
  {"n":68,"code":"RE-17","name":"Informe de Auditoría Interna Nºiaaaa","version":1,"effectiveFrom":"2024-12-01","process":"Estratégico","retention":"3 años","owner":"Auditor Interno","folder":"9_Seguimiento y Evaluación","subfolder":"2_Auditorías Internas"},
  {"n":69,"code":"DO-34","name":"Revisión Gerencial","version":1,"effectiveFrom":"2024-12-01","process":"Estratégico","retention":"3 años","owner":"Gerente General","folder":"9_Seguimiento y Evaluación","subfolder":"3_Revisión Gerencial"},
  {"n":70,"code":"RE-18","name":"Informe de Revisión Gerencial","version":1,"effectiveFrom":"2024-12-01","process":"Estratégico","retention":"3 años","owner":"Encargada SGI","folder":"9_Seguimiento y Evaluación","subfolder":"3_Revisión Gerencial"},
  {"n":71,"code":"DO-35","name":"Procedimiento No Conformidad y Acciones Correctivas","version":1,"effectiveFrom":"2024-12-01","process":"Estratégico","retention":"3 años","owner":"Encargada SGI","folder":"10_Mejora","subfolder":"DO-35 Procedimiento No Conformidad y Acciones Correctivas"},
  {"n":72,"code":"RE-19","name":"Tabla de Control de No Conformidades","version":1,"effectiveFrom":"2024-12-01","process":"Estratégico","retention":"3 años","owner":"Encargada SGI","folder":"10_Mejora","subfolder":"DO-35 Procedimiento No Conformidad y Acciones Correctivas"},
  {"n":73,"code":"DO-36","name":"Procedimiento Investigación de Accidente","version":1,"effectiveFrom":"2024-12-01","process":"Estratégico","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"10_Mejora","subfolder":"DO-36 Investigación Accidente"},
  {"n":74,"code":"RE-20","name":"FORMATO INVESTIGACIÓN DE ACCIDENTES E INCIDENTES DS 44 Chome","version":1,"effectiveFrom":"2024-12-01","process":"Estratégico","retention":"3 años","owner":"Jefe de Prevención de Riesgos y Salud Ocupacional","folder":"10_Mejora","subfolder":"DO-36 Investigación Accidente"},
  {"n":75,"code":"RE-21","name":"Información de Riesgos Laborales IRL","version":2,"effectiveFrom":"2025-04-14","process":"Apoyo","retention":"5 años","owner":"Jefa Depto Prevención de Riesgos","folder":"10_Mejora","subfolder":"DO-36 Investigación Accidente"},
  {"n":76,"code":"RE-22","name":"Prueba Evaluación Capacitación IRL DS N° 44","version":2,"effectiveFrom":"2025-05-14","process":"Apoyo","retention":"5 años","owner":"Jefa Depto Prevención de Riesgos","folder":"7_Apoyo","subfolder":"DO-08 Selección_Contratación_Inducción"},
  {"n":77,"code":"DO-26_1","name":"Ciclo Gestión Mantenimiento Maquinaria Pesada","version":1,"effectiveFrom":"2026-05-25","process":"Operativo","retention":"3 años","owner":"Jefe de Mantención","folder":"8_Operación","subfolder":"7_Mantención de Maquinaria y Equipos"},
  {"n":78,"code":"DO-26_2","name":"Gestión Mantenimiento Preventivo Maquinaria Pesada","version":1,"effectiveFrom":"2026-05-25","process":"Operativo","retention":"3 años","owner":"Jefe de Mantención","folder":"8_Operación","subfolder":"7_Mantención de Maquinaria y Equipos"},
  {"n":79,"code":"DO-43","name":"SISTEMA DE GESTIÓN DE SEGURIDAD Y SALUD EN EL TRABAJO (SG-SST)","version":2,"effectiveFrom":"2025-04-21","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":80,"code":"RE-36","name":"PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026","version":1,"effectiveFrom":"2026-02-01","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":81,"code":"DO-45","name":"Gestión de los elementos de protección personal","version":1,"effectiveFrom":"2025-05-21","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":82,"code":"DO-46","name":"Plan Contingencia para Transporte Residuos Solidos (peligroso no peligrosos)","version":1,"effectiveFrom":"2025-06-25","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":83,"code":"DO-47","name":"Identificación y Gestión de Personas Trabajadoras Especialmente Sensibles (PTES)","version":1,"effectiveFrom":"2025-06-26","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":84,"code":"RE-28","name":"Identificación de Personas Trabajadoras Especialmente Sensibles (PTES)","version":2,"effectiveFrom":"2025-06-26","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":85,"code":"DO-48","name":"DO-48 Procedimiento de control alcohol y drogas","version":1,"effectiveFrom":"2025-08-27","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":86,"code":null,"name":"Política de Alcohol y Drogas","version":1,"effectiveFrom":"2025-09-01","process":"Estratégico","retention":"3 años","owner":"Gerente General","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":87,"code":"RE-29","name":"Consentimiento Informado","version":1,"effectiveFrom":"2025-08-27","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":88,"code":"RE-30","name":"Control de Aplicación Test Alcohol y Drogas","version":1,"effectiveFrom":"2025-08-27","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":89,"code":"DO-49","name":"Programa Prevención y Protección Contra la Exposición Ocupacional a Radiación UV","version":1,"effectiveFrom":"2025-09-01","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":90,"code":"RE-31","name":"Evaluación de Conocimientos Radiación UV","version":1,"effectiveFrom":"2025-09-04","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":91,"code":"RE-32","name":"Evaluación Del Curso Radiación UV De Origen Solar","version":1,"effectiveFrom":"2025-09-04","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":92,"code":"DO-52","name":"PROCEDIMIENTO CONFECCIÓN, REVISIÓN Y ACTUALIZACIÓN DE LA POLÍTICA INTEGRADA","version":1,"effectiveFrom":"2026-02-26","process":"Estratégico","retention":"3 años","owner":"Gerente General","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":93,"code":"DO-53","name":"Conducción y operación segura de vehículos motorizados","version":1,"effectiveFrom":"2026-02-25","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":94,"code":"DO-55","name":"Programa Gestión Protocolo TMERT","version":1,"effectiveFrom":"2026-03-24","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":95,"code":null,"name":"ENTREGA DE EPP","version":1,"effectiveFrom":"2026-02-01","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":96,"code":"RE-27","name":"Entrega y Recepción de RIOHS","version":1,"effectiveFrom":"2025-05-21","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":97,"code":"RE-33","name":"Acta de constitución CGRD comite de gestion del riesgo de desastres","version":1,"effectiveFrom":"2025-10-01","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":98,"code":"RE-34","name":"Acta Reunión Comité Gestión de Riesgo de Desastres","version":1,"effectiveFrom":"2025-10-01","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":99,"code":"DO-57","name":"Programa Capacitacion TMERT","version":1,"effectiveFrom":"2026-05-26","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":100,"code":"DO-58","name":"Programa Capacitacion MMC- MMP","version":1,"effectiveFrom":"2026-05-26","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"Documentos SST DS44"},
  {"n":101,"code":"DO-59","name":"Procedimiento de Carga de Combustible","version":1,"effectiveFrom":"2026-05-26","process":"Operativo","retention":"3 años","owner":"Subgerente de Operaciones","folder":"8_Operación","subfolder":"4_Operaciones"},
  {"n":102,"code":"DO-60","name":"PROCEDIMIENTO DE BLOQUEO Y TARJETAS DE NO USO DE EQUIPOS","version":2,"effectiveFrom":"2026-01-15","process":"Operativo","retention":"3 años","owner":"Jefa Depto Prevención de Riesgos","folder":"8_Operación","subfolder":"4_Operaciones"},
] as const
