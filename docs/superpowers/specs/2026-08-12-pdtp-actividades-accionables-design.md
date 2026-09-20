# PDTP: convertir las actividades del programa en cumplimiento accionable

Fecha: 2026-08-12 · Estado: **en construcción** (diseño en curso, actividad por actividad)

## 1. Problema

El programa `pdtp-2026-v1` tiene 87 actividades activas y ningún mecanismo que
diga qué significa cumplir cada una. Estado medido en la base de desarrollo:

| Dimensión | Estado |
|---|---|
| Modo de programación | 65 `scheduled`, 22 `on_demand`, 0 `triggered` |
| `evidence_requirement` | **0 de 87** lo tienen definido |
| Checklist asociado | 10 de 87 (24, 27, 29, 33, 34, 39, 40, 41, 64, 65) |
| Obligaciones automáticas | Motor existe, sólo se crean a mano |
| Ejecuciones registradas | 0 · programa en `draft` · 821 slots planificados |

Cumplir hoy = abrir el formulario de ejecución, escribir texto libre, adjuntar
una foto y declarar una cantidad. Autodeclarado, sin requisito.

### 1.1 El vínculo responsable→actividad existe pero es decorativo

`pdtp_responsible_catalog` ya mapea cada responsable del programa a un rol RBAC:

| Slug | Rol RBAC | Actividades | Acceso a PDTP |
|---|---|---|---|
| `prf` | `prevencionista_faena` | 66 | ver + ejecutar |
| `admin_contrato` | `admin_contrato` | 25 | ver + ejecutar |
| `jt` | `jefe_terreno` | 20 | ver + ejecutar |
| `sup` | `supervisor_terreno` | 15 | ver + ejecutar |
| `jdpr` | `prevencionista` | 5 | ver + ejecutar |
| `cphs` | `cphs` | 4 | ve, **no ejecuta** |
| `jm` | `jefe_mantencion` | 3 | **sin acceso** |
| `conductores_operadores_choferes` | *(sin rol)* | 1 | **no existe** |

`responsibleDisplay` sólo se dibuja como chips en la planilla. En ninguna parte
del sistema existe "estas son tus actividades".

### 1.2 El motor de enganche está construido y cableado; le falta el mapa

`lib/services/pdtp/accreditation.ts` convierte eventos operacionales reales en
ejecuciones PDTP idempotentes (`origin: 'integration'`). Tiene idempotencia,
exclusión por faena, validación de período, revocación, manejo de concurrencia
y batería de tests.

```ts
accreditPdtpFromEvent({
  sourceType: "inspeccion" | "capacitacion" | "epp" | "cphs" | "emergencia" | "campana" | "incident",
  sourceId, worksiteId, occurredAt,
  activityNumbers: number[],   // ← qué actividades acredita este evento
})
```

Los módulos no lo importan directo: pasan por
`lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts`. Estado real del
cableado:

| Conector | Llamado desde | Estado |
|---|---|---|
| `onInspectionCompleted` | `prevention-inspections.ts` | cableado |
| `onTrainingSessionClosed` / `Cancelled` | `prevention-training.ts` | cableado |
| `onCphsMeetingClosed` / `onManagementReviewClosed` | `prevention-cphs.ts` | cableado |
| `onEmergencyDrillCompleted` | `prevention-emergency.ts` | cableado |
| *(directo)* campañas | `prevention-campaigns.ts` | cableado |
| `onEppDeliveryCompleted` | — | **existe, nadie lo llama** |

Lo que falta no es la cañería sino el dato: `activityNumbers` lo declara la
fuente (`pdtp_activity_numbers` en la plantilla / curso / plan) y **está vacío
en producción**. La única plantilla de inspección (`INSP-DEMO`) no declara
ninguna actividad, así que sus 48 runs no acreditan nada.

**Este documento es ese mapa.**

Límites conocidos del motor:
- El vocabulario de `sourceType` tiene 7 tipos; faltan al menos `documento`,
  `ppa`, `evaluacion_sst` e `indicadores`.
- Genera ejecuciones, no cierra ocurrencias por responsable. Hay que
  reconciliarlo con la decisión D3.

## 2. Decisiones

Todas tomadas con la jefa de prevención el 2026-08-12.

- **D1 · Cancha**: se amplía `/pendientes` (cola operacional existente) en vez
  de crear una pantalla nueva. Ya trae PDTP y respeta el alcance por faena;
  falta el filtro por responsable y las actividades `scheduled`.
- **D2 · Ocurrencia**: derivada, no materializada. `deriveActivityStatus`
  (`lib/services/pdtp/period.ts`) ya calcula `pending`/`executed`/`overdue` por
  actividad, faena y mes cruzando lo planificado contra las ejecuciones.
- **D3 · Multi-responsable**: cada responsable tiene su propia ocurrencia y su
  propio cumplimiento. Excepción por actividad: **compartida** — la marca
  cualquiera y cierra para todos (caso canónico: N°6, una reunión con cuatro
  asistentes). 37 de 87 actividades tienen más de un responsable.
- **D4 · Mecanismo**: se define actividad por actividad. Ver §3.
- **D5 · CPHS fuera del programa**: el módulo CPHS tendrá su propio programa
  con su propio cumplimiento. Las actividades *del* comité salen del PDTP; las
  actividades *sobre* el comité se quedan. La corresponsabilidad del CPHS se
  acciona desde su módulo y sólo en la única faena con comité real (Cholguán).
- **D6 · Submódulo Constancias**: nombre acordado para el que alberga las
  actividades tipo "se hizo o no se hizo + evidencia u observación". Se
  descartó "checklists" porque ya existen dos cosas con ese nombre.
- **D7 · Submódulo Habilitación del trabajador**: nombre acordado para el que
  agrupa los registros que habilitan a una persona para su puesto. Nombra el
  resultado, no el trámite, y cubre naturalmente el cambio de cargo.
- **D8 · Medición por cobertura**: N°17, N°18, N°23 y N°24 pasan de
  `planned_vs_completed` a `coverage` — se miden por cuántos de cuántos, no
  por evento realizado. El campo `indicator_mode` ya admite `coverage`; hoy
  ninguna actividad lo usa.
- **D9 · N°19 por enganche**: la carpeta de requisitos legales engancha a
  Documentación SST (cumple si los documentos exigidos están vigentes), no es
  una constancia simple. Requiere sumar `documento` al vocabulario del motor.
- **D10 · Unificación de motores de inspección**: manda el módulo
  Inspecciones. Ver §7.
- **D14 · La clasificación vive en la base**, no sólo en este documento.
  `pdtp_activities.mechanism` (`enganche` / `constancia` / `formulario` /
  `compuesta` / `sin_definir`), migración `0158`, poblado por
  `npm run pdtp:apply-mechanisms` desde la clasificación de §5.

  Sin esto el submódulo Constancias no puede saber qué actividades le tocan y
  la cola no puede enrutar. Reparto sobre las 82 activas: **60 enganche, 14
  constancia, 6 compuesta, 2 formulario** — ninguna sin clasificar.

  El script falla si un número aparece en dos listas y avisa de las que quedan
  sin clasificar; esa segunda guarda destapó que faltaba todo el bloque 6.
- **D12 · La cola avisa, Constancias marca** (resuelve A4). `/pendientes` es
  la superficie de aviso: dice qué le toca a cada responsable y cuándo vence.
  El acto de marcar vive en el submódulo **Constancias**. En consecuencia, el
  `href` de la fuente `pdtp_activity` de la cola debe apuntar a Constancias y
  no a la planilla de actividades, que es donde apunta hoy.
- **D13 · Pacífico se cierra** (resuelve A6). La faena deja de operar, así que
  no constituir su comité paritario no es un incumplimiento pese a sus 35
  trabajadores. ⚠️ Arrastra **7 acciones CAPA abiertas** que hay que cerrar,
  cancelar o traspasar: la FK de `prevention_capa_actions.worksite_id` es
  `ON DELETE RESTRICT`, o sea que la faena no se puede borrar mientras existan.
  También quedan 6 inspecciones y 4 incidentes con historial.
- **D11 · Acciones correctivas: CAPA guarda, PDTP muestra**. La acción vive en
  `prevention_capa_actions` y se ve en el panel de la ejecución del PDTP, donde
  nació. Para el usuario no cambia la pantalla.

  El argumento decisivo salió del esquema: `pdtp_action_plan.execution_id` va a
  `pdtp_executions` **ON DELETE CASCADE**, y de ahí a `pdtp_activities` y
  `pdtp_programs` con la misma cascada — borrar un programa anual borraría
  hallazgos reales con responsable y plazo. Hacia CAPA, en cambio, la FK es
  **ON DELETE RESTRICT**: el esquema ya trataba a la CAPA como el registro que
  perdura y al plan del PDTP como lo desechable.

  A eso se suma el alcance: `source_type` de CAPA admite 14 orígenes (PPA,
  evaluaciones SST, requisitos legales, permisos, gestión del cambio, higiene,
  capacitación…) de los cuales PDTP es sólo uno, y ya tiene acciones vivas de
  cuatro. Una acción nacida de una evaluación de trabajador no tiene actividad
  del programa anual de la cual colgar.

  **Corrección sobre lo que se estimó primero**: no hay nada que "mover". La
  acción **ya vive en CAPA**. `generateActionPlanFromChecklist` y
  `createActionPlanItem` llaman los dos a `createCapaActionWithClient` con
  `sourceType: 'pdtp'`, guardan el `capaActionId`, y cada transición del PDTP
  propaga a `transitionCapaActionWithClient`. Hay guardas explícitas —"La acción
  no tiene CAPA vinculada y requiere conciliación"— o sea que el sistema ya
  **exige** la CAPA.

  `pdtp_action_plan` es hoy un **espejo sincronizado**, no un sistema paralelo.
  D11 no es una migración: es quitar el espejo.

  Por lo mismo cae el riesgo del formulario de seguimiento en tres pasos: el
  formulario unificado de PDTP (`ActionFollowupTimeline` — observación, estado y
  fotos juntos) ya existe y ya escribe a CAPA a través de la sincronización.
  Se conserva tal cual, apuntando directo a CAPA.

  Trabajo real:
  1. El panel de la ejecución lista desde `prevention_capa_actions`
     (`sourceType='pdtp'`, `sourceId=executionId`) en vez del espejo.
  2. Dejar de escribir `pdtp_action_plan` en creación y transiciones.
  3. Migración que borra `pdtp_action_plan` y `pdtp_action_plan_followups`
     (0 filas), junto con las tres tablas del motor de checklists.
  4. La fuente `pdtp_action` de `/pendientes` se apaga: esas filas ya las trae
     la fuente `capa`, que existe desde antes.

## 3. Vocabulario de mecanismos

| Símbolo | Mecanismo | Qué significa |
|---|---|---|
| 🔗 | **Enganche** | Un registro que ya existe en otro módulo la cierra. Nadie marca nada en PDTP. |
| ✍️ | **Constancia** | Se hizo o no se hizo + evidencia u observación. Vive en el submódulo **Constancias**. |
| 📝 | **Formulario** | Hay que crear el registro dentro de PDTP. |
| 🧩 | **Compuesta** | Se cumple cuando sus componentes están completos (caso: N°52). |

### 3.1 Submódulos nuevos acordados

- **Constancias** — alberga las actividades ✍️. Marcar hecho + evidencia u
  observación.
- **Habilitación del trabajador** — agrupa los registros que habilitan a una
  persona para su puesto: IRL, evaluación de capacitación IRL, entrega de
  RIOHS, entrega de EPP inicial, identificación de personas especialmente
  sensibles (RE-28), examen preocupacional, procedimientos DO-xx y evaluación
  de trabajador (`sst_evaluations`, ya existe). Se dispara **tanto al ingresar
  como al cambiar de cargo o puesto**. El cumplimiento es de cobertura:
  cuántos de la dotación están habilitados.

## 4. Inventario de módulos disponibles para enganche

| Módulo | Qué registra | Datos en dev |
|---|---|---|
| Capacitación | Sesión (curso, versión, faena, instructor, modalidad) + asistencia por trabajador con nota, resultado y acuse firmado (SHA) | verificado |
| Inspecciones | Run con plantilla, sujeto, ejecutor, % cumplimiento, conformes/no conformes + hallazgos | 48 runs, 65 hallazgos |
| Incidentes | RE-20 + investigación, declaraciones, difusión por turno, notificaciones, seguimiento, CAPA | 34 incidentes, 60 CAPA |
| CPHS | Comités, reuniones, acuerdos, asistencia, miembros | 4 / 20 / 33 |
| PPA Digital | Por trabajador: respuestas, resultado, verificación, autorización, cierre | verificado |
| Evaluaciones SST | Por trabajador: % cumplimiento, eficacia, restricciones | verificado |
| Emergencias | Planes, escenarios, simulacros con participantes | 14 simulacros |
| Higiene | Grupos de exposición, mediciones, programas de vigilancia | 10 / 18 |
| Documentación SST | Documentos, versiones, distribución y acuses de recibo | por verificar |
| MIPER / Legal / Campañas / Permisos / Cambio | Matrices, requisitos, campañas con asistencia, permisos, gestión del cambio | por verificar |

## 5. Fichas por actividad

### Bloque 1 — Gestión y comités · CERRADO

| N° | Actividad | Mecanismo | Quién marca |
|---|---|---|---|
| 1 | Aprobar el Programa | 🔗 Firma de **Legal y RRHH** en el flujo de aprobación PDTP (paso `legal`, `approved_by_legal_at`) | nadie, cae sola |
| 3 | Difundir el Plan en faenas | ✍️ Constancia — la marca Prevención, no el CPHS | PRF |
| 6 | Reunión revisión SG-SST | ✍️ Constancia | **compartida** |
| 7 | Estadística de faena | 🔗 Se cumple si se ingresó la información de indicadores | PRF |
| 9 | Reunión revisión gestión | 🔗 Revisión por la Dirección (`onManagementReviewClosed`, ya cableado) | compartida |
| 10 | Condiciones DS 594 | 🔗 Inspecciones, plantilla DS 594 (por D10) | PRF |
| 11 | Constituir CPHS | 🔗 Comité creado en módulo CPHS, por faena | PRF + Adm |

**Eliminadas**: N°2 (difundir a gerencias), N°5 (control línea de mando).
**Al programa del CPHS**: N°12 (cursos CPHS), N°13 (reunión mensual), N°14
(crear programa del comité).

### Bloque 2 — N°15 a N°24 · CERRADO

**A Habilitación del trabajador** (🧩, medición por cobertura):

| N° | Actividad | Rol en Habilitación |
|---|---|---|
| 15 | Charlas de inducción IRL (ingreso o cambio de puesto) | IRL — checklist con **formato por faena y cargo**, instancia por trabajador. CPHS corresponsable, acciona desde su módulo, sólo Cholguán |
| 16 | Prueba de evaluación capacitación IRL | Nota y resultado (`prevention_training_attendance.assessment_score` / `assessment_result`) |
| 17 | Identificación de personas especialmente sensibles (RE-28) | Aplicable a nuevos **y** a contratados |
| 18 | Entrega de RIOHS (TALANA digital) | Acuse de entrega + capacitación sobre los temas |
| 23 | Entrega de EPP según cargo | Entrega inicial. Distinta de la N°62, que es el registro general de entregas |

**Las otras cinco:**

| N° | Actividad | Mecanismo | Notas |
|---|---|---|---|
| 19 | Carpeta de requisitos legales | 🔗 Documentación SST | Las carpetas de trabajadores quedan cubiertas por Habilitación; queda la carpeta de arranque y las cartas conductoras (D9) |
| 20 | Reunión con empresa mandante | ✍️ Constancia · compartida | No hay módulo y no vale la pena inventarlo |
| 21 | Informes, cierres y seguimiento de accidentes | 🔗 Incidentes | Probablemente se disuelva en el bloque 66–78 (C6) |
| 22 | Control de plataformas (empresa y mandante) | ✍️ Constancia | Única actividad cuyo objeto vive **fuera** de la plataforma |
| 24 | Inspección de extintores | 🔗 Inspecciones · **cobertura** · cada uno marca lo suyo | N inspeccionados de M del inventario. Requiere padrón de extintores como sujeto |

### Bloque 3 — N°25 a N°41 · PROPUESTO

**Ya resueltas por la unificación de motores (§7):** las plantillas están
instaladas y acreditan solas al completar la inspección.

| N° | Actividad | Plantilla |
|---|---|---|
| 27 | Inspección taller y bodega RESPEL | `inspeccion_taller` |
| 29 | Lista de chequeo contenedores | `inspeccion_contenedores` |
| 33 | Estado de equipos y documentación (PRF) | `inspeccion_equipos_moviles` |
| 34 | Estado de equipos y documentación (SUP/JT) | `inspeccion_carros` |
| 39 | Observación de conductas | `observacion_planeada` |
| 40 | Inspecciones para corregir desviaciones | `observacion_ampliroll` ⚠️ |
| 41 | Caminatas de seguridad | `observacion_maquinaria` ⚠️ |

⚠️ **Los mapeos de la N°40 y la N°41 no calzan con el texto de la actividad.**
La N°40 dice "Realizar Inspecciones para corregir desviaciones en las áreas de
trabajo" —genérico— y apunta a una observación de *Camión Ampliroll*. La N°41
dice "Caminatas de seguridad" y apunta a *Maquinaria Pesada*. Vienen heredados
del seed de checklists; hay que confirmarlos con la jefa de prevención.

**Enganches nuevos:**

| N° | Actividad | Mecanismo |
|---|---|---|
| 28 | Revisar y cerrar inspecciones de equipos | 🔗 Inspecciones, **paso de revisión** (`reviewInspectionRun`) — ver nota abajo |
| 35 | Mantener y actualizar MIPER | 🔗 MIPER: publicar una revisión de la matriz de la faena |
| 36 | Difusión de matriz MIPER | 🔗 Documentación SST con acuse por cargo · **cobertura** |
| 37 | Charlas de seguridad (PRF) | 🔗 Capacitación (sesión + asistencia) |
| 38 | Charlas de seguridad diarias por turno (SUP/JT) | 🔗 Capacitación · volumen alto, una por turno |

**Nota sobre la N°28** — *actualizada el 2026-08-21.* El mecanismo que esta nota
pedía ya existe: la plantilla declara actividades **por etapa**
(`pdtp_activity_numbers` al completar, `pdtp_review_activity_numbers` al pasar a
`reviewed`, migración 0203) y el conector dispara en las dos. La primera en usarlo
es la **N°26** ("Revisión y firma del report de uso diario"), cableada a
`reporte_equipos`.

La **N°28**, en cambio, **queda manual por decisión de la jefatura
(2026-08-21)**, y no por falta de mecanismo. El campo `program` del catálogo la
describe como *"revisar las inspecciones una vez sean recibidas, para ver si los
temas mencionados se levantaron para cierre, **en reunión semanal**"*, y su
calendario es 1 por semana. Es un acto semanal sobre el **conjunto** recibido,
no sobre una inspección: acreditarla por run haría que una semana con doce
inspecciones reportara doce cumplimientos de una actividad planificada como uno.
Además su objeto es si **los hallazgos se cerraron** —territorio de CAPA, que
ocurre después— y no el llenado del checklist. Automatizarla exigiría un objeto
que no existe: la reunión semanal con acta (el molde estaría en las sesiones de
CPHS).

Criterio general que salió de esto: ante la duda de si una actividad se acredita
**por evento o por período**, leer su campo `program` en
`db/seed/pdtp-catalog-2026.json` — distingue explícitamente "según la cantidad de
equipos" de "reunión semanal".

**Sin registro en la plataforma:**

| N° | Actividad | Propuesta |
|---|---|---|
| 30 | Alcotest (PRF, turno administrativo) | ✍️ Constancia — **no existe módulo de alcotest** |
| 31 | Alcotest (SUP/JT, por turno) | ✍️ Constancia |
| 32 | Envío de registros de alcotest (DO-48) | ✍️ Constancia, depende de 30/31 |

Lo único que hay de alcotest hoy es el equipo físico como ítem de servicio
(para su calibración) y una mención en la descripción del rol jefe de terreno.

**Desbloqueadas el 2026-08-21** (estaban bloqueadas por A7, "el responsable son
los conductores, que no tienen cuenta"):

| N° | Actividad | Mecanismo |
|---|---|---|
| 25 | Report de uso diario de equipos | 🔗 Inspecciones, plantilla `reporte_equipos`: el conductor llena el papel y quien tiene `prevention:inspections:ingest` sube la foto. Acredita al completar |
| 26 | Revisión y firma del report | 🔗 Inspecciones, **paso de revisión** vía `pdtp_review_activity_numbers`. Acredita al pasar a `reviewed` |

**Pendiente operativo de la N°26:** el candado de independencia impide que quien
ejecuta revise lo suyo. Si el jefe de terreno sube la planilla **y además**
completa la inspección, no puede firmarla y la N°26 se acreditaría a otra
persona, no al responsable que el programa declara (Sup, JT). Se resuelve sin
código: subir la foto (`:ingest`) no convierte en ejecutante, así que el JT sube,
otra persona teclea, y la firma queda para el JT. Hay que decidirlo y
comunicarlo.

El padrón para su cobertura **sí existe**: `fuel_vehicles`, 18 equipos activos
en 6 faenas. Lo mismo sirve de denominador a las N°33/34 ("cantidad de
inspecciones de acuerdo a los equipos en faena"), así que **la cobertura de
esas dos es calculable hoy**, a diferencia de las N°17/18/23/24.

### Bloque 4 — N°42 a N°52 · PROPUESTO

| N° | Actividad | Mecanismo |
|---|---|---|
| 42 | Control documental de sanitización y plagas | ✍️ Constancia — empresa externa, no hay registro propio |
| 43 | Realizar y revisar procedimientos de trabajo seguro | 🔗 Documentación SST: nueva versión del documento |
| 44 | Evaluación **cualitativa** por mutual | 🔗 Higiene ⚠️ — ver nota |
| 45 | Evaluación **cuantitativa** por mutual | 🔗 Higiene: `prevention_exposure_measurements` |
| 46 | Protocolo MINSAL PREXOR | 🔗 `prevention_surveillance_programs.protocol` |
| 47 | Protocolo MINSAL TMERT/MMC | 🔗 ídem |
| 48 | Protocolo MINSAL PSICOSOCIAL | 🔗 ídem |
| 49 | Protocolo MINSAL UV | 🔗 ídem |
| 50 | Controlar trabajadores en vigilancia | 🔗 `prevention_surveillance_enrollments` · **cobertura calculable** |
| 51 | Capacitación según detección de necesidades | 🔗 Capacitación |
| 52 | Inducción trabajador nuevo | 🧩 Habilitación del trabajador (D7) |

`prevention_surveillance_programs` tiene `protocol`, `periodicity_months` y
`legal_basis`: calza exacto con las N°46–49. La N°50 se mide por cobertura
—expuestos identificados contra inscritos en el programa— y su padrón sí
existe (`prevention_exposure_groups`, 10 grupos).

⚠️ **N°44** — `prevention_exposure_measurements` guarda mediciones, que son
cuantitativas. No verifiqué que el módulo admita una evaluación cualitativa;
si no, la N°44 baja a Constancia.

### Bloque 5 — N°53 a N°65 · PROPUESTO

| N° | Actividad | Mecanismo |
|---|---|---|
| 53 | Charla diaria de seguridad por turno | 🔗 Capacitación · volumen alto |
| 54 | Capacitación Extintores | 🔗 Capacitación · **cobertura 90%** |
| 55 | Capacitación Primeros auxilios | 🔗 Capacitación |
| 56 | Manejo a la defensiva | 🔗 Capacitación · **cobertura 90% de conductores** |
| 57 | Comunicación Efectiva | 🔗 Capacitación |
| 58 | Capacitación Coordinador GRD | 🔗 Capacitación (plataforma mutual) |
| 59 | Investigación de accidente árbol causal | 🔗 Capacitación |
| 60 | Liderazgo para Línea de Mando | 🔗 Capacitación |
| 61 | Certificados de idoneidad de EPP | ✍️ Constancia — se solicita a Adquisiciones |
| 62 | Registrar la entrega de EPP | 🔗 Entregas → `onEppDeliveryCompleted` (C7) |
| 63 | Capacitación uso correcto de EPP | 🔗 Capacitación, una por tipo de EPP |
| 64 | Check list de uso y estado de EPP (JT) | 🔗 Inspecciones (plantilla instalada) |
| 65 | Check list de uso y estado de EPP (PRF) | 🔗 Inspecciones (plantilla instalada) |

**Las N°54–60 no requieren código**: `prevention_training_courses` ya tiene
`pdtp_activity_numbers`. Basta declarar el número en cada curso y el conector
`onTrainingSessionClosed` —ya cableado— acredita al cerrar la sesión.

Las N°54 y N°56 declaran una meta explícita de 90 %: son de **cobertura**, y
el denominador (dotación de la faena / conductores) existe en `workers`.

**La N°62 desbloquea C7**: es la actividad que debe declarar
`onEppDeliveryCompleted` desde `registerWorkerEppDelivery`.

### Bloque 6 — N°66 a N°78 · PROPUESTO

**El módulo de Incidentes fue construido desde el DO-36: los 13 pasos tienen
campo exacto.** Este bloque es enganche completo, sin una sola constancia.

| N° | Paso | Campo que lo cierra |
|---|---|---|
| 66 | Informar al Adm. contrato y PRF | `incident_notifications` (tipo, `deadline_at`, `sent_at`) |
| 67 | Informar a JDPR | ídem, otro `notification_type` |
| 68 | Informe preliminar 3 h (JT) | `investigations.preliminary_report_text` / `_at` |
| 69 | Declaración del trabajador | `incident_statements` (`kind`, `deponent`, `signed_at`) |
| 70 | Informe preliminar a JDPR (Adm+PRF) | ídem 68 + notificación |
| 71 | Difusión en el turno y los demás | `incident_shift_diffusions` (`marked_at`, `confirmed_at`) |
| 72 | Emitir la DIAT | `notification_type = 'diat'` — está literal en el check |
| 73 | Investigación 72 h | `incident_investigations` (metodología, causas, conclusiones) |
| 74 | Envío del informe definitivo | `investigations.definitive_report_sent_at` |
| 75 | Difusión de medidas preventivas | `incident_diffusion.action_plan_summary` / `diffused_at` |
| 76 | Seguimiento de medidas correctivas | `incident_followups` + CAPA |
| 77 | Archivar documentos del accidente | `incident_evidence` (`kind`, `reference`, `checksum`) |
| 78 | Envío de difusión ONE PAGE | `incident_diffusion.one_page_summary` — literal |

**Sobre A3 (la N°21)**: "Informes, cierres y seguimiento de accidentes" es
exactamente la suma de las N°66–78. Con el bloque desglosado paso a paso, la
N°21 mide lo mismo dos veces e infla el denominador del PRF y del
administrador. **Recomendación: retirarla**, con la misma constancia de retiro
que las demás. Decisión de la jefa.

Falta construir el conector: `sourceType: "incident"` existe en el vocabulario
del motor, pero ningún punto del módulo de Incidentes lo llama todavía. Son 13
llamadas en los puntos de cierre de cada paso.

### Bloque 7 — N°79 a N°89 · PROPUESTO

| N° | Actividad | Mecanismo |
|---|---|---|
| 79 | Constitución del CGRD (DS 44) | ✍️ Constancia ⚠️ — **no existe módulo de CGRD** |
| 80 | Implementación de matriz GRD | ✍️ Constancia ⚠️ — MIPER es de riesgos laborales, no de desastres |
| 81 | Actas de reunión CGRD | ✍️ Constancia ⚠️ |
| 82 | Mapa de riesgo por área | ✍️ Constancia (documento) |
| 83 | Plan de emergencia por amenaza | 🔗 `prevention_emergency_plans` + `_scenarios` |
| 84 | Simulacros | 🔗 `prevention_emergency_drills` — conector ya cableado |
| 85 | Módulos vida saludable | 🔗 Campañas |
| 86 | Manejo del estrés | 🔗 Campañas |
| 87 | Alcohol y Drogas No Van Al Volante | 🔗 Campañas |
| 88 | Seguridad Vial | 🔗 Campañas |
| 89 | Puntos ciegos en conducción y operación | 🔗 Campañas |

`prevention_emergency_plans` y `prevention_campaigns` ya tienen
`pdtp_activity_numbers`: las N°83 a N°89 se resuelven declarando el número, sin
código nuevo.

⚠️ **El CGRD (Comité de Gestión de Riesgos de Desastres, DS 44) no tiene
módulo.** Es un comité distinto del paritario, con su propia matriz, sus actas
y su plan de trabajo — tres actividades (79, 80, 81) que hoy sólo pueden ser
constancias. Es el mismo patrón que llevó al CPHS a tener módulo propio.

## 5bis. Backlog completo

Estado al 2026-08-13. **Las 82 actividades activas están clasificadas** (los 7
bloques). Programa reducido de 87 a 82 tras aplicar las decisiones de catálogo.

Reparto del mecanismo sobre las 82:

| Mecanismo | Actividades |
|---|---|
| 🔗 Enganche a un módulo existente | ~58 |
| ✍️ Constancia | ~13 |
| 🧩 Habilitación / compuesta | ~6 |
| ⚠️ Sin módulo y sin decisión | 5 (CGRD 79/80/81, alcotest 30/31/32 parcial) |

**Nota de harness**: `vitest.merged.config.ts` no resuelve `next/server` desde
`next-auth`, así que cualquier test que lo importe transitivamente falla al
cargar. No es un fallo del código: con la config que le corresponde a cada
archivo (`vitest.pglite.config.ts` / `vitest.non-pglite.config.ts`) pasan.
Los suites `*-postgres.test.ts` además **no pueden correr en paralelo** contra
la misma base: todos hacen `DROP SCHEMA` y se pisan entre sí.

### Implementado el 2026-08-13

**Decisiones de catálogo (§5bis F)** —
`scripts/apply-pdtp-2026-catalog-decisions.ts` +
`npm run pdtp:apply-catalog-decisions`. Idempotente, 14 cambios aplicados.

Va como edición del **programa**, no del catálogo:
`db/seed/pdtp-catalog-2026.json` es una copia notariada del XLSX del cliente y
su test de contrato le fija el SHA256, el tamaño en bytes y los totales del
original. El catálogo dice qué trajo el Excel; el programa dice qué decidió la
jefa después. Editar el JSON destruiría la evidencia de importación fiel.

Por lo mismo las bajas usan `retirePdtpActivity` (retiro con motivo y fecha
efectiva, registrado en el change log) y no un DELETE: conservar el número
mantiene válido el mapeo de plantillas de inspección —la N°24 sigue siendo la
N°24— y deja constancia de quién sacó qué y por qué.

**Cola por responsable (D1 + D2 + D3)** — fuente `pdtp_activity` nueva en
`lib/services/operational-work-queue.ts`, con
`lib/__tests__/operational-work-queue-pdtp-activity-source.test.ts` (12 casos).

El dueño sale de `pdtp_responsible_catalog`, que ya mapeaba cada responsable a
un rol RBAC pero sólo se usaba para dibujar chips. La ocurrencia es derivada
(D2), con la misma regla que `deriveActivityStatus`: vencida si hay un mes
anterior planificado sin ejecutar, pendiente si es el mes en curso. Se emite
una fila por (actividad, faena) anclada al primer mes impago, no una por mes
vencido.

Detalles que costaron encontrarse:

- **Sin membresía de faenas declarada, el programa aplica a todas las del
  alcance** (`resolveProgramWorksiteIds`). Un `INNER JOIN` contra
  `pdtp_program_worksites` dejaba la cola muda mientras la planilla mostraba
  todo — que es exactamente el caso hoy: esa tabla está vacía.
- Una ejecución `submitted` o `approved` saca la actividad de la cola; una
  `rejected` o `draft` no, porque el trabajo se vuelve a deber.
- Un programa que no está `active` no genera trabajo. El de desarrollo está en
  `draft`, así que la cola no muestra nada hasta activarlo.
- Las `on_demand` quedan fuera: su denominador son los casos reales, no el
  plan, y ya tienen su propia fuente vía obligaciones.

⚠️ **El cierre sigue siendo compartido**: cualquier ejecución saca la actividad
de la cola de todos sus responsables. El cierre por responsable que pide D3
necesita resolver antes C5.

⚠️ **Al activar el programa, cada responsable recibe de golpe todo lo vencido
del año.** Medido en la faena Cholguán con el programa actual: 46 vencidas
para el PRF, 13 para el administrador de contrato, 11 para el jefe de terreno,
10 para el supervisor, 3 para el jefe de mantención. Es la verdad —nunca se
registró nada— pero conviene decidir si se arranca desde el mes en curso.

### Implementado el 2026-08-13 (segunda tanda)

**Accesos (C2)** — `modules/prevention/manifest.ts` + `npm run db:sync-rbac`.
`jefe_mantencion` gana `prevention:pdtp:view` y `:execute`; era responsable de
tres actividades y no podía abrir el módulo. El `cphs` **se resolvió solo**: al
sacar sus actividades del programa (D5), ese slug ya no aparece en ninguna
actividad activa, así que no necesita permiso de ejecución. Queda pendiente
`conductores_operadores_choferes` (N°25), que depende del bloque 3.

**Semántica del CPHS corregida.** Los cambios de catálogo dejaron mal dos
conectores que apuntaban a actividades que ya no existen en el programa:

- `PDTP_CPHS_ACTIVITY_NUMBERS` pasó de `[11, 12, 13, 14]` a `[11]`.
- El conector colgaba del **cierre de un acta**, que prueba que el comité
  sesionó, no que exista. Ahora la N°11 la acredita `constituteCommittee`:
  crear el comité en la faena. `closeCommitteeMeeting` ya no acredita nada.
- `onManagementReviewClosed` acreditaba la N°14 (plan de trabajo del comité,
  ahora fuera del PDTP). Apunta a la **N°9**, que es la reunión de revisión de
  la gestión que ese módulo efectivamente registra.

**Enganche de la N°1** — `onPdtpProgramLegallyApproved`, llamado desde
`decidePdtpApprovalStep` cuando el paso `legal` queda aprobado. Acredita en
**todas** las faenas del programa: la planilla y el % son por faena, y un
programa aprobado lo está para todas. Suma `aprobacion_programa` al vocabulario
de `sourceType` (la columna no tiene restricción en base, así que no hubo
migración).

**Verificación de módulos (H)** — confirmado qué registra cada uno:

| Módulo | Sirve para | Filas |
|---|---|---|
| Documentación SST | N°3, N°18, N°19 — distribución por trabajador con `due_at`, exención con motivo, recordatorios y acuse con firma/IP | **0, sin usar** |
| MIPER | N°35, N°36 — matrices con scoring inherente/residual, publicación con hash | 9 matrices, 30 entradas |
| Legal | N°19, N°22 — requisitos con `evidence_required` y `frequency` | 12 requisitos, **0 evaluaciones** |
| Campañas | N°85–89 — ya trae `pdtp_activity_numbers` y conector cableado | **0, sin usar** |
| Revisión por la dirección | N°9 — `inputs`, `conclusions`, `resource_decisions` | **0, sin usar** |
| Simulacros | N°84 — escenario, evacuación en segundos, resultado, CAPA | 14 |
| Permisos de trabajo | sin actividad PDTP evidente | 40 |
| Gestión del cambio | sin actividad PDTP evidente | 12 |

**A2 ya estaba resuelto en el código.** `syncPdtpCphsHeadcountExclusion` excluye
las actividades del CPHS de las faenas con menos de 25 trabajadores, o sea "no
aplica" vía `pdtp_activity_worksite_exclusions`. Por dotación le corresponde
comité a **Cholguán (41) y Pacífico (35)**; el resto queda bajo el umbral.

### A · Decisiones abiertas (bloquean trabajo)

| # | Decisión | Bloquea |
|---|---|---|
| A1 | Retirar el motor de checklists de PDTP mueve las acciones correctivas de esas 11 actividades de `pdtp_action_plan` a CAPA | El retiro completo (§7) |
| A2 | Estado de la N°11 en las 8 faenas sin CPHS: "no aplica" vs "pendiente" (C3) | Aplicabilidad por faena |
| A3 | Si la N°21 sobrevive o se disuelve en el bloque 66–78 (C6) | Bloque 6 |
| A4 | Relación exacta entre `/pendientes` (D1) y el submódulo Constancias (D6): la cola avisa y Constancias es donde se marca, o el marcado vive en los dos | Ambos submódulos |
| A12 | `pdtp_action_plan` guarda cuatro campos que CAPA no tiene: `dano_potencial`, `normativa_legal`, `origen` y `seccion_id`/`item_id`. ¿Se suman como columnas a CAPA, se guardan en su `legacy_snapshot`, o se pierden? | **Resuelto** — ver abajo |

**Sobre A12** — al implementar D11 se descubrió que el espejo no es puro.
`dano_potencial` (módulo 04: deriva prioridad y plazo, y marca la detención
inmediata) y `normativa_legal` (Anexo 8) son atributos legítimos de cualquier
acción correctiva, no sólo de las del PDTP; `origen` y `seccion_id`/`item_id`
en cambio quedan sin sentido al retirar el motor de checklists.

**Resolución (2026-08-13).** Los cuatro campos se reparten según lo que son, y
ninguno se pierde:

| Campo | Dónde queda | Por qué |
|---|---|---|
| `dano_potencial` | columna de `prevention_capa_actions` (migración 0157) | atributo de cualquier acción correctiva: un hallazgo de inspección o de permiso de trabajo tiene daño potencial igual |
| `normativa_legal` | columna de `prevention_capa_actions` (migración 0158) | ídem — Anexo 8 no es exclusivo del programa anual |
| `seccion_id`/`item_id` | `legacy_snapshot` jsonb, que ya existía y nadie escribía | es procedencia, no estado: no se consulta ni se filtra por él, así que no gana nada siendo columna |
| `origen` | **no se persiste** | es derivable — una acción viene de un ítem si y sólo si trae `seccionId`. Materializarlo crearía un tercer sitio donde el mismo hecho puede desincronizarse |

Escrito por `generateActionPlanFromChecklist` y `createActionPlanItem`;
`npm run capa:backfill-provenance` cubre las filas anteriores. **A12 deja de
bloquear D11.**

La duplicación de la cola tampoco bloquea ya: se resolvió unificando las dos
fuentes contra CAPA en vez de apagar una — `jefe_terreno`, `admin_contrato` y
`supervisor_terreno` tienen `prevention:pdtp:view` y
`prevention:pdtp:action:manage` pero no `prevention:capa:view`, así que apagar
la fuente PDTP les habría borrado el trabajo de la cola.

### B · Diseño: clasificar las 65 actividades restantes

| Bloque | Actividades | Tema |
|---|---|---|
| 3 | N°25–41 (17) | Reports de equipos, alcotest, inspecciones, MIPER, caminatas |
| 4 | N°42–52 (11) | Procedimientos, mutual, protocolos MINSAL, vigilancia, inducción |
| 5 | N°53–65 (13) | Charlas diarias, capacitaciones, EPP |
| 6 | N°66–78 (13) | Flujo de accidentes: 13 pasos de un mismo evento |
| 7 | N°79–89 (11) | CGRD, emergencia, mapas de riesgo, simulacros, campañas |

### C · Implementación del marco (D1, D2, D3, D8)

- Filtro por responsable en `/pendientes` — hoy filtra por permiso y faena, no
  por quién es dueño de la actividad.
- Alimentar `/pendientes` con las 65 actividades `scheduled` derivadas de
  `deriveActivityStatus`. Hoy sólo entran obligaciones y acciones correctivas.
- Ocurrencia por responsable (D3) + marca "compartida" por actividad. Requiere
  campo nuevo en `pdtp_activities`.
- Poner `indicator_mode = 'coverage'` en N°17, N°18, N°23 y N°24 (D8), y
  construir el cálculo de cobertura: hoy ninguna actividad usa ese modo.
- C5: reconciliar el motor de acreditación (genera ejecuciones sin distinguir
  responsable) con la ocurrencia por responsable.

### D · Submódulos nuevos

- **Constancias** (D6) — marcar hecho + evidencia u observación.
- **Habilitación del trabajador** (D7) — IRL con formato por faena y cargo,
  evaluación IRL, RIOHS, EPP inicial, RE-28, examen preocupacional, DO-xx y
  evaluación de trabajador. Dispara al ingresar y al cambiar de cargo.

### E · Enganches por construir

- Sumar `documento`, `ppa`, `evaluacion_sst`, `indicadores` al `sourceType`
  del motor (C4).
- N°1 — la firma de Legal y RRHH acredita la actividad.
- N°7 — el ingreso de indicadores acredita.
- N°11 — crear el comité en CPHS acredita, por faena.
- N°19 — Documentación SST con lista de documentos exigidos por faena (D9).
- N°21 — cierre de incidente acredita.
- C7 — `onEppDeliveryCompleted` existe y nadie lo llama.

### F · Catálogo del programa (edición de datos)

- Eliminar N°2 y N°5.
- Sacar N°12, N°13 y N°14 al programa del CPHS.
- Quitar el corresponsable CPHS de N°15, N°73 y N°76 (su parte se acciona
  desde el módulo CPHS, sólo en Cholguán).
- N°3: quitar "y CPHS" del texto — la marca Prevención.
- N°23: corregir la guía, que hoy dice "por recambios" (eso es la N°62).
- N°10: falta el contenido del checklist DS 594; no existe definición.

### G · Accesos y datos sucios

- `jefe_mantencion` no puede abrir PDTP y es responsable de 3 actividades (C2).
- `cphs` ve pero no ejecuta (C2).
- `conductores_operadores_choferes` no existe como rol RBAC; es responsable de
  la N°25 (C2).
- Limpiar los 3 comités de datos demo; el único real es Cholguán (C3).
- `INSP-DEMO`: plantilla demo con 48 runs sin respuestas y sin actividades
  declaradas.

### H · Verificación pendiente

- ~~`prevention-inspections-postgres.test.ts` (18 tests) nunca corrió~~ —
  **corrido el 2026-08-21**: son 50 tests y pasan contra Postgres real
  (`PREVENTION_INSPECTIONS_DATABASE_URL=postgres:///…_test` +
  `PREVENTION_INSPECTIONS_ALLOW_DESTRUCTIVE_RESET=true`, `PGHOST` al socket).
- Documentación SST, MIPER, Legal, Campañas, Permisos y Gestión del cambio
  siguen como "por verificar" en el inventario de §4: no confirmé qué
  registran ni si sirven de enganche.

## 6. Conflictos y pendientes

| ID | Asunto | Estado |
|---|---|---|
| C1 | Dos motores de inspección | **Resuelto** — ver §7 |
| C2 | Roles sin acceso: `jefe_mantencion` (3 actividades) no puede abrir PDTP; `cphs` ve pero no ejecuta; `conductores_operadores_choferes` (N°25) no existe como rol RBAC | Abierto |
| C3 | La base tiene 4 comités de datos de demostración cuando el único real es Cholguán. Decidir el estado de la N°11 en las 8 faenas sin comité ("no aplica" vs "pendiente") | Abierto |
| C4 | Faltan `documento`, `ppa`, `evaluacion_sst`, `indicadores` como `sourceType` del motor | Abierto |
| C5 | El motor genera ejecuciones sin distinguir responsable; D3 exige ocurrencia por responsable | Abierto |
| C6 | N°21 es el mismo flujo que las 13 actividades del bloque 66–78 | Abierto |
| C7 | `onEppDeliveryCompleted` existe y nadie lo llama | Abierto |

## 7. C1 — Unificación de motores de inspección (D10)

### Diagnóstico

Dos motores para lo mismo:

- **Motor A · Inspecciones**: `prevention_inspection_templates` →
  `prevention_inspection_runs` → `prevention_inspection_answers`. Respuestas en
  `conforming | partial | non_conforming | not_applicable`, con daño potencial
  por ítem y comentario obligatorio en parcial/NA.
- **Motor B · PDTP**: `pdtp_activity_checklists` → `pdtp_execution_checklists`
  → `pdtp_execution_checklist_responses`. Respuestas en
  `cumple | regular | no_cumple | na | no_tiene`.

Están mucho más convergidos de lo que sugería la nota histórica:

1. Comparten el tipo `ChecklistDefinition` de `lib/sst/types.ts` — la
   estructura secciones→ítems es idéntica.
2. Comparten `PARTIAL_STATUS_WEIGHT = 0.5` de `lib/sst/compliance.ts`. La
   escala B/R/M ya llegó a los dos.
3. Los vocabularios son isomorfos, sólo cambian de nombre:

| PDTP | Inspecciones |
|---|---|
| `cumple` (+ `entregado`, `apto`, `si`) | `conforming` |
| `regular` | `partial` |
| `no_cumple` | `non_conforming` |
| `na`, `no_tiene` | `not_applicable` |

El problema real es que **cada mitad quedó en el motor equivocado**:

| | Motor A · Inspecciones | Motor B · PDTP |
|---|---|---|
| Contenido | 1 plantilla demo, `pdtp_activity_numbers` vacío | **10 checklists reales: 32 secciones, 189 ítems** |
| Maquinaria | código de run, sujeto, asignado, revisor, geolocalización, hallazgos automáticos, daño potencial, cobertura, programa | instancia + plan de acción |
| Puente a PDTP | `onInspectionCompleted` cableado | n/a |
| Datos de ejecución | 48 runs con **0 respuestas** | 0 instancias, 0 respuestas |

Los dos están vacíos de datos de ejecución: es el momento más barato posible
para unificar.

### Decisión

Manda **Inspecciones**. Los 10 checklists de PDTP migran a plantillas del
módulo y `pdtp_activity_numbers` queda poblado con el número de actividad, que
es lo que activa la acreditación automática ya cableada.

Se gana en las 11 actividades de inspección: hallazgos derivados automáticos,
sujeto inspeccionado (necesario para la cobertura de D8), acreditación
automática y un solo motor que mantener.

### Contenido a migrar

| N° | Checklist | Secciones | Ítems |
|---|---|---|---|
| 24 | Inspección de Estado de Extintores | 3 | 10 |
| 27 | Inspección Taller de Mantención y Bodega RESPEL | 2 | 17 |
| 29 | Inspección de Contenedores | 2 | 15 |
| 33 | Inspección de Equipos Móviles | 9 | 55 |
| 34 | Inspección de Carros | 5 | 24 |
| 39 | Observación Planeada | 1 | 2 |
| 40 | Observación de Seguridad — Camión Ampliroll | 3 | 22 |
| 41 | Observación de Seguridad — Maquinaria Pesada | 3 | 22 |
| 64 | Inspección de Uso y Estado de EPP (JT) | 2 | 11 |
| 65 | Inspección de Uso y Estado de EPP (PRF) | 2 | 11 |
| | **Total** | **32** | **189** |

La N°10 (condiciones ambientales DS 594) no tiene checklist hoy y queda
pendiente de contenido.

### Implementado (2026-08-12)

El contenido no vivía en la base sino en `lib/sst/definitions/*.ts` como
constantes, y el mapa actividad↔definición ya existía en
`PDTP_2026_CHECKLIST_SPECS`. La migración fue de contenedor, no de contenido.

- `lib/services/pdtp-adapters/inspection-templates-2026.ts` — instala las 10
  definiciones como plantillas **aprobadas** de `preventionInspectionTemplates`
  con `pdtpActivityNumbers = [n]`. Idempotente por (code, versionLabel), y
  recablea las que quedaron sin actividad declarada. Expone además
  `findInspectionTemplateForPdtpActivity(n)`.
- `scripts/seed-pdtp-inspection-templates-2026.ts` +
  `npm run db:seed-pdtp-inspection-templates` — reemplaza a
  `db:seed-pdtp-checklists`.
- `scripts/bootstrap-pdtp-2026.ts` y `scripts/pdtp-bootstrap-prod.ts` instalan
  ahora plantillas de inspección. Las plantillas son compartidas entre
  programas, así que salen de los artefactos de rollback del arranque
  (`checklistIdsCreated: []`), a diferencia de los `pdtpActivityChecklists`,
  que sí eran del programa.
- La página de verificación de ejecución PDTP ya no ofrece checklist propio
  cuando la actividad tiene plantilla de inspección: manda al módulo.

Las actividades 64 y 65 comparten definición (`inspeccion_epp`) pero quedan
como **dos plantillas separadas** (`v02-jt` / `v02-prf`). Es deliberado: por D3
cada responsable tiene su propia ocurrencia, así que un run del JT no puede
cerrar la del PRF. Se podrán colapsar en una sola cuando se resuelva C5.

### Hecho: el motor de checklist del PDTP se retiró (2026-09-20)

Nada puede redactar ni llenar un checklist del PDTP. Se fueron el editor
(`checklist-tab.tsx`, `checklist-builder.tsx`), el panel de llenado
(`execution-checklist-panel.tsx`), el motor de ejecución
(`execution-checklists.ts`, 371 líneas), el adaptador huérfano
(`checklist-templates-2026.ts` y su script de sembrado sin entrada en
`package.json`), las acciones de plantilla y de llenado, y los dos permisos
`prevention:pdtp:checklist:manage` y `:fill` —retirados también de las
concesiones ya otorgadas vía `RETIRED_PERMISSION_NAMES`—.

**Dos afirmaciones de la versión anterior de esta sección eran falsas.** Quedan
corregidas acá porque costaron trabajo de descubrir:

1. **`pdtp_action_plan` ya no existía.** La migración `0161` la dropeó junto con
   `pdtp_action_plan_followups`, y `action-plan.ts` es desde entonces una fachada
   sobre `prevention_capa_actions`. La "decisión de la jefa de prevención" sobre
   mudar las acciones correctivas a CAPA ya estaba tomada y desplegada; lo que
   quedaba era retirar la vía de entrada, no migrar datos.

2. **Las tres tablas NO estaban en cero.** `pdtp_activity_checklists` tiene 9
   filas en producción y 18 en dev. Este mismo documento se contradecía: más
   arriba registra «10 checklists reales: 32 secciones, 189 ítems». Sólo
   `pdtp_execution_checklists` y `pdtp_execution_checklist_responses` estaban
   vacías, y son las dos que borró la migración `0320`.

**`pdtp_activity_checklists` se conserva, a propósito.** Está dentro de la huella
firmada del programa: `content-digest.ts` emite una clave `checklists` construida
desde ella **sin condicionar por `schemaVersion`**, y los snapshots ya firmados en
`pdtp_programs.review_snapshot_json` y `pdtp_program_template_versions.snapshot_json`
la contienen. Borrarla obligaba a subir
`MIN_RECONSTRUCTIBLE_PDTP_CONTENT_SCHEMA_VERSION` a 18, lo que dejaría sin
verificar **todo** programa firmado entre v12 y v17 —tenga o no checklists— y
pondría una insignia permanente en el programa activo. El precedente del propio
repositorio (la v9, que retiró `expected_subject_count`) confirma además que
emitir un `[]` de compatibilidad es el modo de fallo que un test ya prohíbe: un
digest que nunca calza es indistinguible de una deriva de contenido real.

La tabla queda como artefacto de sólo lectura. Sus filas nacen por una sola vía:
copiar hacia adelante un snapshot ya firmado —instanciar una plantilla, copiar un
programa, duplicar una actividad, aplicar una diferencia de base o importar—.

Dos lectores se re-cablearon al motor que hoy sí tiene los datos: el distintivo
de no conformes de `sheets.ts` (que daba 0 en todas partes, porque sus dos tablas
fuente estaban vacías) y el eje `verificacion` de `compliance.ts`, ambos contra
`prevention_inspection_runs`.
