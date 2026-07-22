# Plan integral para un constructor de programas preventivos basado en el SG-SST 2026

**Estado:** en ejecucion; Fases 0 y 1 cerradas tecnicamente, Fase 4 cerrada tecnicamente salvo la clasificacion de negocio de 22 actividades (4.3), Fase 2 avanzada (calendario general y multifaena cerrados tecnicamente en BLD-11; autosave de Objetivos/Planificacion y preview por faena cerrados, Actividades/Evidencias manuales por diseno), Fase 3 avanzada con items grandes pendientes, Fase 5 con registro de fuentes ampliado y CAPA con selector estructurado (BLD-11) pero matriz 1-89 y 5 dominios restantes sin resolver, aceptacion operacional pendiente en todas las fases

**Fecha de corte de la revision:** 2026-07-22 (BLD-11)

**Documento de referencia inicial:** `PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx` (linea base historica)

**Fuente de verdad vigente (desde 2026-07-22):** `PROGRAMA ACTIVIDADES PREVENTIVAS DEL SG-SST.xlsx` — ver §2.0

**Alcance principal:** constructor general de programas preventivos, integraciones operacionales y migracion del PDTP 2026

**Responsables de aceptacion requeridos:** Jefatura de Prevencion, Legal, responsables de faena y administracion de plataforma

---

## 1. Proposito y criterio rector

Este documento define una hoja de ruta para que Chome permita **crear, aprobar, ejecutar y mejorar programas preventivos de forma simple**, usando el archivo 2026 para comprender la intencion del proceso y migrar el programa vigente. El objetivo del producto **no es copiar una planilla dentro de una pagina web** ni convertir su distribucion visual en el modelo permanente de la plataforma.

El Excel revela necesidades reales del dominio:

- definir objetivos y actividades preventivas;
- asignar responsables y audiencias;
- programar cantidades o frecuencias;
- registrar ejecucion y evidencia;
- tratar obligaciones que nacen solo cuando ocurre un evento;
- revisar cumplimiento y acciones correctivas;
- aprobar una version controlada del programa;
- comunicar el mismo programa a distintos roles.

Esas capacidades deben transformarse en un **constructor guiado y reutilizable**. Las 8 hojas, las 48 semanas y la matriz P/E pertenecen a la representacion del programa 2026; no deben obligar a que todo programa futuro tenga la misma estructura. En Chome, las vistas por rol deben derivarse de responsables, audiencias y permisos, y el calendario debe poder mostrarse como agenda, lista, periodo o matriz segun la tarea del usuario.

El modulo ya representa buena parte de los datos del ejemplo 2026, pero todavia no ofrece una experiencia general y segura de autoría porque:

- la creacion esta demasiado acoplada al esquema importado y no a un flujo guiado desde cero, plantilla o programa anterior;
- la importacion omite ejecuciones ya registradas en las columnas `E`;
- el gobierno de aprobaciones permite firmas incompatibles y firmas que quedan vigentes despues de modificar el contenido;
- el exportador puede incluir planes de accion de faenas fuera del alcance si se invoca sin faena;
- las actividades “cada vez que sea necesario” no tienen un modelo operacional propio;
- las integraciones con capacitacion, inspecciones, CPHS, EPP, emergencias e incidentes son parciales;
- la base local verificada no contiene ningun programa PDTP cargado, aunque el catalogo JSON del repositorio si coincide con el Excel.

La meta de este plan es lograr simultaneamente:

1. **autoría intuitiva:** crear un programa util sin conocer la estructura del Excel ni editar una grilla de cientos de celdas;
2. **modelo general:** soportar programas distintos al 2026 sin agregar excepciones por hoja, año o rol;
3. **migracion fiel:** conservar la informacion del archivo vigente al llevarlo al modelo general, sin convertirla en la arquitectura del producto;
4. **operacion integrada:** que el trabajo real de cada modulo alimente el programa sin doble digitacion;
5. **trazabilidad y gobierno:** que cada dato, aprobacion, cambio y evidencia sea atribuible e inmutable;
6. **aislamiento por faena:** que ningun endpoint, exportacion o indicador exceda el alcance autorizado;
7. **adopcion productiva:** migracion reconciliada, marcha paralela, aceptacion formal y rollback probado.

Este plan es el documento rector para el constructor de programas preventivos y la migracion del caso 2026. Los hallazgos P0 generales de Prevencion que no dependen del programa siguen gobernados por `PLAN_FIX_MITIGACION_P0_PREVENCION.md`; no se consideran cerrados por la sola ejecucion de este plan.

### 1.1 Anti-objetivos

Este plan no busca:

- reproducir el Excel celda por celda como pantalla principal;
- fijar 8 hojas, 89 actividades, 48 semanas o el año 2026 en el modelo general;
- exigir un archivo para poder crear un programa;
- crear copias de actividades para cada rol o faena;
- usar el formato RE-36 como estructura de base de datos;
- sacrificar simplicidad de uso para conseguir un round-trip visual perfecto;
- declarar exito porque una exportacion se parece al documento si el trabajo diario sigue siendo complejo o manual.

### 1.2 Relacion con los artefactos existentes

| Artefacto | Uso dentro de este plan |
|---|---|
| `AUDITORIA_MODULO_PREVENCION.md` | Antecedente funcional general; sus controles vigentes siguen aplicando. |
| `AUDITORIA_MODULO_PREVENCION_2026-07-20.md` | Corte tecnico mas reciente del modulo; sirve de linea base, no de prueba de adopcion productiva. |
| `PLAN_FIX_MITIGACION_P0_PREVENCION.md` | Mantiene la remediacion P0 transversal que no nace del PDTP. |
| `PLAN_IMPLEMENTACION_6_PENDIENTES_PREVENCION.md` | Aporta dependencias de dominios preventivos que deben reconciliarse antes del cutover. |
| `PLAN_INTEGRACION_PROGRAMA_2026_FORMULARIOS.md` | Sus avances de checklist y sujetos multiples se conservan; este plan reemplaza sus supuestos sobre carga actual, importacion y cierre operacional. |
| `PLAN_P1_PREVENCION.md` | Backlog complementario; cualquier solapamiento se prioriza por la severidad y gates definidos aqui. |

Ante una contradiccion, prevalecen en este orden: intencion preventiva y decision formal de negocio, controles de seguridad/integridad, modelo general del producto, datos del Excel vigente, codigo y esquema actuales, este plan, y finalmente documentos historicos. Ningun checklist antiguo marcado como terminado sustituye la verificacion en la base y el flujo productivo reales.

---

## 2. Referencia comprobada del archivo 2026

### 2.0 Actualizacion de fuente (2026-07-22)

La fuente de verdad del programa fue reemplazada. El archivo entregado `PROGRAMA ACTIVIDADES PREVENTIVAS DEL SG-SST.xlsx` sustituye a `PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx` (que permanece en el repo solo como fixture historico).

**Contraste comprobado (celda por celda, archivo contra archivo):** el nuevo libro es identico al anterior salvo por una diferencia de contenido: se quitaron de la hoja consolidada `PDTP GENERAL` las actividades **N°4** ("Difundir los resultados de las actividades preventivas de cada faena", JDPR, plan Feb-Dic) y **N°8** ("Reunion revision gestion preventiva SG-SST", version online; casi duplicada de la N°9, que si permanece). Sus 11+11 celdas explican exactamente la baja de planificacion. Todo lo demas es igual: 8 hojas con los mismos nombres, las 6 ejecuciones historicas (M14, O15, G19, I19, K19, M19), las 22 actividades sin plan numerico, el indicador RE-36 (Proceso, Mensual, meta 90%), los metadatos (Lorena Alvarado 27-01-2026 / Paulette Recart 04-02-2026 / control de cambio 2026-02-12) y el titulo interno del libro ("PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026"; solo cambio el nombre de archivo). Texto, metodo, responsable y calendario de las 87 actividades compartidas: sin un solo cambio.

**Decision de negocio (aceptada):** *quita total* de las actividades 4 y 8. El programa canonico pasa a **8 objetivos / 87 actividades / 8 hojas**, 821 celdas P y total anual 1.013.

**Inconsistencia del archivo entregado, a corregir en el fuente:** el nuevo libro retira 4 y 8 de `PDTP GENERAL` pero **las conserva en la hoja de rol `PRF Y Adm. de contrato` (76 filas)**. Con la quita total esa hoja debe quedar en 74; hasta corregirlo, la hoja general deja de ser la union de las hojas de rol.

**Defecto estructural del archivo entregado (hallazgo posterior):** el nuevo libro tambien **elimino la columna A "OBJETIVO" de la hoja `PDTP GENERAL`** (los 8 nombres de objetivo — A14 "FORTALECER…", A48 "DETECTAR…", A64 "REFORZAR…" — que si estan en el archivo historico). El parser (`extractPdtpCatalogFromWorkbook`) lee el objetivo desde esa columna, por lo que **no puede parsear el archivo nuevo** (lanzaria "Actividad PDTP 1 no tiene objetivo asociado"). Por eso el archivo entregado **no se adopta** como fuente parseable/bootstrapeable: casi con certeza es una degradacion accidental del re-export. La fuente fisica correcta del programa de 87 es un export limpio con la columna OBJETIVO (el usuario lo re-subira) o la fixture generable del seed.

**Como leer el resto de este documento:** las tablas de §2 y §2.1 ya reflejan la fuente vigente (8/87/8, 821, 1.013, nuevo SHA/tamano). Cualquier otra mencion a "8/89/8", "843" o "1.035" mas abajo corresponde a la **linea base anterior** y a la bitacora de pruebas ya ejecutadas contra el archivo historico; se conserva sin alterar como registro de auditoria.

**Estado fase 2 (plataforma) — hecho 2026-07-22:**
- `db/seed/pdtp-catalog-2026.json` regenerado a **8/87/8, 821 celdas, total 1.013** (removidas 4 y 8 de actividades, objetivo 1, `pdtp_general` y `prf_adm_contrato`).
- `lib/services/pdtp-adapters/contract-2026.ts` en **dos capas**: `PDTP_2026_SOURCE(_INVARIANTS)` = documento historico (89, archivo viejo, fixture de fidelidad del parser) y `PDTP_2026_INVARIANTS`/`VIEW_MEMBERSHIPS` = programa vigente (87); nuevo `PDTP_2026_REMOVED_ACTIVITIES = [4, 8]`.
- Parser (`prevention-pdtp-catalog.ts`) relajado: valida numeracion **estrictamente creciente y unica** en vez de 1-89 contiguo (acepta los huecos de la quita sin dejar de detectar corrupcion).
- `generate-pdtp-catalog.ts` aplica la quita al regenerar; tests de contrato/integracion ajustados. Suite PDTP verde (contract 3 + catalog 5 + integracion 55), typecheck y lint limpios.

**Fuente fisica del programa 87 — resuelta 2026-07-22:** el re-upload del usuario resulto ser **byte-identico** al archivo degradado (mismo SHA `8ad52fe1…`), asi que no se adopto. En su lugar se construyo la fuente canonica **por cirugia directa sobre el XML del `.xlsx`** (no openpyxl: su round-trip rompe el libro para ExcelJS, error `anchors`, incluso sin modificarlo): se vaciaron y ocultaron las filas 17 y 21 (actividades 4 y 8) en `PDTP GENERAL` y `PRF Y Adm. de contrato`, copiando el resto del zip intacto.

- Resultado: `PROGRAMA ACTIVIDADES PREVENTIVAS DEL SG-SST (87 actividades).xlsx`, 3.821.479 bytes, SHA-256 `55b780b9…`, congelado en `PDTP_2026_PROGRAM_SOURCE`.
- Integridad verificada: 74/74 entradas del zip, **23/23 imagenes byte-identicas**, solo cambian `xl/worksheets/sheet1.xml` y `sheet3.xml`. Las filas **no se desplazaron**, por lo que las seis celdas E siguen en M14/O15/G19/I19/K19/M19 y los `sourceSheetRow` del catalogo no cambian.
- Validado con el parser real del proyecto: 87 actividades (1-89 sin 4 y 8), 8 objetivos con sus nombres (objetivo 1 = 1,2,3,5,6,7,9), 821 celdas, total 1.013, membresias 87/4/74/18/41/2/1/12, seis E, metadatos y leyenda de roles intactos.
- **El seed es reproducible**: `tsx scripts/generate-pdtp-catalog.ts` desde esa fuente regenera `db/seed/pdtp-catalog-2026.json` **identico** al comprometido. `bootstrap-pdtp-2026.ts` valida el SHA contra esta fuente.
- El archivo entregado degradado se conserva sin adoptar; el historico (89) permanece como fixture de fidelidad del parser.

Los siguientes valores describen el **caso real que la plataforma debe poder representar e importar sin perdida**. Son un contrato de regresion del adaptador 2026, no limites del constructor ni valores obligatorios para nuevos programas:

| Elemento | Valor comprobado |
|---|---:|
| Objetivos | 8 |
| Actividades | 87 |
| Hojas/vistas de la referencia | 8 |
| Semanas del horizonte | 48 |
| Celdas semanales planificadas con cantidad | 821 |
| Cantidad planificada anual total | 1.013 |
| Mayor cantidad planificada en una celda | 5 |
| Actividades sin plan numerico semanal | 22 |
| Cantidad ejecutada ya presente en el archivo | 6 |
| Meta del indicador | 90 % |
| Periodicidad del indicador | Mensual |
| Tipo de indicador | Proceso |
| Codigo documental | RE-36 |
| Responsable declarado | Cada faena |
| Fuente canonica del programa vigente | `PROGRAMA ACTIVIDADES PREVENTIVAS DEL SG-SST (87 actividades).xlsx` |
| Tamaño del archivo | 3.821.479 bytes |
| SHA-256 | `55b780b91102696946ab38dfa02a02aff89130ff9a42df209b5713ef367263c1` |
| Archivo entregado por el usuario (degradado, no adoptado) | `PROGRAMA ACTIVIDADES PREVENTIVAS DEL SG-SST.xlsx`, 4.509.309 bytes, SHA-256 `8ad52fe1…` |

### 2.1 Hojas del archivo y membresias

| Clave interna esperada | Vista del archivo | Actividades |
|---|---|---:|
| `pdtp_general` | Programa general | 87 |
| `cphs` | CPHS | 4, actividades 11 a 14 |
| `prf_adm_contrato` | PRF + Administrador de contrato | 74 (el archivo entregado aun trae 76: conserva 4 y 8; ver §2.0) |
| `sup_jt` | Supervisor/Jefatura de turno | 18 |
| `prf` | PRF | 41 |
| `adm_contrato` | Administrador de contrato | 2, actividades 28 y 72 |
| `subgerente` | Subgerente | 1, actividad 5 |
| `capacitacion` | Capacitaciones y campanas | 12, actividades 54 a 60 y 85 a 89 |

La membresia de cada hoja debe poder reconstruirse para validar la migracion 2026. En el modelo objetivo no se crean ocho silos: estas hojas se traducen a audiencias, responsables y filtros guardados, derivados de una sola definicion del programa.

### 2.2 Ejecuciones historicas presentes en el archivo

El archivo de entrada contiene seis unidades ejecutadas que hoy no son importadas:

| Actividad | Periodo | Semana | Cantidad ejecutada |
|---:|---|---:|---:|
| 1 | Enero | 4 | 1 |
| 2 | Febrero | 1 | 1 |
| 6 | Enero | 1 | 1 |
| 6 | Enero | 2 | 1 |
| 6 | Enero | 3 | 1 |
| 6 | Enero | 4 | 1 |

El Excel no determina de forma confiable a que identificador de faena de Chome pertenecen esas ejecuciones. Por eso no se deben cargar automaticamente en una faena inferida: deben pasar por una etapa de mapeo y aceptacion del responsable de migracion.

### 2.3 Metadatos y control documental presentes en la referencia

- elaborado por Lorena Alvarado Cornejo el 27-01-2026;
- aprobado por Paulette Recart Andrades el 04-02-2026;
- control de cambio fechado 12-02-2026;
- formula y meta de cumplimiento mensual;
- leyenda de roles/responsables;
- etiquetas de columnas `PROGRAMA`, `ACTIVIDAD`, `P` y `E`;
- identidad, orden y formato logico de las ocho hojas.

Las imagenes, logos, merges y presentacion visual pertenecen al formato de origen. El significado, las firmas, las fechas, la version y el historial de cambios si deben almacenarse como datos auditables, pero la interfaz de autoría no debe imitar esa composicion.

---

## 3. Linea base tecnica verificada

### 3.1 Lo que ya esta correctamente implementado

- `db/seed/pdtp-catalog-2026.json` coincide con el archivo **historico** en objetivos, actividades, hojas, membresias y planificacion: 8/89/8, 843 celdas y total 1.035; **ya no coincide con la fuente vigente** (8/87/8, 821 celdas, total 1.013): debe regenerarse en fase 2 (ver §2.0).
- El dominio ya dispone de programas, actividades, programacion semanal, ejecuciones, evidencias, checklist, planes de accion, seguimientos, aprobaciones y hojas por rol.
- La suite focalizada de PDTP paso con 18 archivos y 167 pruebas.
- El typecheck paso en la revision de referencia.
- La aplicacion ya soporta alcance por faena en varios flujos, evidencias y recordatorios semanales.
- MIPER y requisitos legales ya tienen una seleccion estructurada parcial como fuentes de actividades.

### 3.2 Estado operacional observado

En la base PostgreSQL local revisada existen:

- 0 programas PDTP;
- 0 actividades PDTP;
- 0 catalogos de responsables PDTP;
- 0 hojas PDTP;
- 0 ejecuciones PDTP.

Esto no prueba el estado de produccion, pero si demuestra que el repositorio no cuenta hoy con un bootstrap local reproducible que deje el programa 2026 operativo. El `db:seed` generico no debe volver a cargar silenciosamente datos de negocio; se necesita un proceso administrativo explicito, auditable y repetible.

### 3.3 Superficies principales afectadas

- Esquema: `db/schema/prevention/pdtp.ts`.
- Catalogo fuente: `db/seed/pdtp-catalog-2026.json`.
- Validacion: `lib/validation/prevention-module/pdtp.ts`.
- Servicios: `lib/services/pdtp/**` y `lib/services/prevention-pdtp.ts`.
- Acciones: `app/(app)/prevencion/pdtp/actions.ts` y `app/(app)/prevencion/pdtp/actions/**`.
- Importacion: `app/api/prevencion/pdtp/import/route.ts`.
- Exportacion: `app/api/prevencion/pdtp/export/route.ts` y `lib/services/pdtp/sheets.ts`.
- Ciclo de vida: `lib/services/pdtp/lifecycle.ts`.
- Plan de accion: `lib/services/pdtp/action-plan.ts`.
- Interfaz: `app/(app)/prevencion/pdtp/**`.
- Permisos base: `modules/prevention/manifest.ts`.

---

## 4. Principios no negociables

1. **La intencion preventiva manda.** El modelo representa objetivos, trabajo, responsabilidad, tiempo, evidencia y mejora; la planilla es una entrada posible, no la interfaz ni la arquitectura.
2. **No se pierde informacion silenciosamente.** Toda celda, metadato o fila no importada debe aparecer como error, advertencia o decision explicita.
3. **La seguridad falla cerrada.** Si no existe una faena o alcance autorizado resoluble, no se exporta ni se agrega informacion transversal.
4. **Las aprobaciones firman contenido, no solo un ID.** Cada firma queda asociada a una version y un hash inmutable.
5. **Segregacion de funciones.** Elaborar, aprobar tecnicamente y aprobar legalmente no pueden resolverse con una misma identidad por omision.
6. **Una captura operacional, multiples usos.** Una capacitacion, inspeccion, reunion, entrega o investigacion valida debe alimentar el PDTP por enlace trazable, no por doble digitacion.
7. **Idempotencia.** Repetir un evento o una importacion no puede duplicar cumplimiento.
8. **A demanda no significa sin control.** Las actividades no calendarizadas requieren disparador, SLA, evidencia y regla de denominador explicitos.
9. **Excel es un adaptador.** La carga del legado y las salidas tabulares usan `.xlsx`, pero crear y operar un programa no depende de importar o editar archivos.
10. **Capacidad tecnica no equivale a puesta en marcha.** El cierre exige migracion de datos reales, reconciliacion, pruebas negativas de autorizacion, marcha paralela y aceptacion formal.
11. **Migraciones generadas.** Los cambios nacen en el esquema Drizzle y se generan en una migracion nueva; no se editan migraciones ni el journal existentes.
12. **Todo hallazgo nuevo entra al plan.** Durante la ejecucion se registra en la bitacora, se clasifica y se incorpora a una fase antes de continuar si afecta seguridad, integridad o trazabilidad.

---

## 5. Registro consolidado de brechas

| ID | Prioridad | Brecha | Impacto | Fase |
|---|---|---|---|---:|
| UX-BLD-01 | P0 producto | No existe un constructor guiado que permita partir en blanco, desde una plantilla o desde el programa anterior sin entender la grilla Excel. | La plataforma digitaliza el archivo, pero no simplifica la creacion del programa. | 2 |
| SEC-01 | P0 | El exportador solo valida acceso si recibe `faena`; sin ese parametro, los planes de accion pueden consultarse sin alcance y mezclar faenas. | Exposicion transversal de datos en Excel. | 1 |
| GOV-01 | P0 | La misma cuenta puede aprobar como JDPR, firmar Legal y activar el programa. | Falta de segregacion y validez debil de la aprobacion. | 1 |
| GOV-02 | P0 | Las firmas no se asocian a un hash/version del contenido. Actividades, programa o calendario pueden cambiar despues de firmar sin invalidar aprobaciones. | Activacion de contenido distinto del aprobado. | 1 |
| GOV-03 | P0 | Un programa firmado sigue en `draft`; puede incluso eliminarse por la ruta de borrado de borradores. | Perdida de historia y evidencia de decision. | 1 |
| GOV-04 | P0 | Las transiciones de aprobacion usan lectura y actualizacion separadas, sin compare-and-set de estado/version. | Carreras, doble firma o transiciones fuera de orden. | 1 |
| DAT-01 | P0 | El importador lee el plan `P`, pero no las cantidades ejecutadas `E`. | Se pierden seis ejecuciones actuales y cualquier otra futura al migrar el caso 2026. | 3 |
| OPS-01 | P0 operacional | La base local esta vacia y no existe un bootstrap administrativo reproducible del programa 2026. | No hay programa utilizable aunque el catalogo exista en Git. | 3 |
| IMP-01 | P1 alta | Reimportar un borrador borra todas sus actividades y, por cascada, calendarios, membresias, checklist y enlaces. | Perdida destructiva con advertencia insuficiente. | 3 |
| IMP-02 | P1 alta | No existe lote de importacion con archivo, hash, usuario, resultado, errores y mapeo de celdas. | No hay procedencia ni reconstruccion del origen. | 3 |
| IMP-03 | P1 | La interfaz/ruta acepta `.xls`, pero la lectura usa el formato Excel de ExcelJS. | Contrato engañoso y fallos de carga. | 3 |
| MOD-01 | P1 alta | Cinco textos legitimos del Excel superan el maximo de 200 caracteres del editor; importar funciona, pero guardar sin cambiar puede fallar. | El modelo general no admite descripciones preventivas reales. | 4 |
| MOD-02 | P1 | La semantica `PROGRAMA`/`ACTIVIDAD` queda invertida entre archivo y modelo. | El importador traslada conceptos ambiguos al constructor. | 4 |
| MOD-03 | P1 alta | Las 22 actividades “cada vez que sea necesario” no tienen modo, disparador ni frecuencia; desaparecen de la vista semanal por defecto. | Trabajo obligatorio no planificado ni recordado. | 4 |
| META-01 | P1 alta | Tipo de indicador, periodicidad, propietarios, aprobaciones y control de cambios no forman un modelo configurable completo. | Nuevos programas heredan defaults del documento 2026 o pierden gobierno. | 4 |
| INT-01 | P1 alta | Los tipos de fuente son limitados y solo MIPER/legal tienen seleccion estructurada. | Capacitacion, inspecciones, CPHS, EPP, emergencias e incidentes no acreditan automaticamente cumplimiento. | 5 |
| INT-02 | P1 parcial | Corregido 2026-07-22: la clave idempotente transversal **ya existe** — `pdtp_obligations.idempotency_key` y `pdtp_executions.idempotency_key`, ambas con indice unico, y convenciones vigentes en `obligations.ts` (`pdtp-obligation:activityId:worksiteId:sourceType:sourceId`) e `imports.ts` (`pdtp-xlsx:checksum:hoja:celda:actividad:faena`). Falta aplicarla en el camino evento operacional → ejecucion, que depende de INT-01 y de la regla de cantidad por actividad (pregunta 2.1). | Riesgo de doble contabilizacion o edicion manual no trazable. | 5 |
| EXP-01 | P1 | La salida actual no ofrece una vista operacional clara y sus formatos se confunden con el documento de origen. | Se intenta resolver operacion y archivo historico con un mismo Excel. | 6 |
| EXP-02 | P1 | El reporte de gestion, el expediente auditor y una eventual vista compatible con RE-36 no estan separados. | Cada audiencia recibe una salida insuficiente o innecesariamente compleja. | 6 |
| UX-01 | P1 alta | La lista calcula indicadores sin faena; el cargador no agrega ejecuciones si falta `worksiteId`. | Un programa con avance real puede mostrarse en cero o con semantica global incierta. | 6 |
| UX-02 | P1 | Las actividades a demanda no tienen bandeja de trabajo, vencimiento ni alerta propia. | Baja visibilidad y cumplimiento reactivo. | 6 |
| ROL-01 | P0 operacional | No existe reconciliacion demostrada con datos reales, marcha paralela ni acta de aceptacion. | No se puede retirar el Excel/SFTI con evidencia suficiente. | 7 |

### 5.1 Evidencia de cierre del riesgo de exportacion

- `app/api/prevencion/pdtp/export/route.ts` falla cerrado: exige permiso, resuelve alcance, deriva solo una faena univoca y rechaza alcance vacio, seleccion omitida/ambigua, faena ajena e identificador inexistente o inactivo.
- `lib/services/pdtp/sheets.ts` exige `worksiteId` y propaga el alcance del usuario a todas las hojas, incluidos planes de accion y seguimientos.
- Cada resultado autenticado —exitoso, denegado, invalido o fallido— deja auditoria con usuario, programa y faena solicitada, sin depender de que el Excel llegue a generarse.
- La prueba del endpoint contiene una matriz explicita rol × faena × endpoint, y la prueba PGlite con dos faenas confirma que ninguna hoja mezcla datos.

### 5.2 Evidencia concreta del riesgo de aprobaciones

- `modules/prevention/manifest.ts` entrega `approve` a prevencionista y administrador, y `sign_legal` a jefatura/administrador.
- `lib/services/pdtp/lifecycle.ts` no impide que `jdprApprovedBy`, `legalApprovedBy` y el activador sean la misma identidad.
- La prueba actual de ciclo de vida incluso valida ambas firmas con `user-1`; debe reemplazarse por una prueba de rechazo.
- El modelo guarda usuarios y fechas, pero no un digest del contenido ni una version firmada.
- Los servicios de programa, actividad e importacion solo verifican `status === "draft"`; no invalidan firmas existentes.

---

## 6. Modelo objetivo

### 6.1 Constructor de programas, no editor de planillas

El punto de entrada principal debe ofrecer cuatro caminos comprensibles:

1. **Crear desde una plantilla:** elegir una base mantenida por Chome o por la organizacion y adaptarla.
2. **Copiar el programa anterior:** clonar definiciones, revisar responsables/fechas y partir sin ejecuciones historicas.
3. **Crear desde cero:** constructor guiado para un programa nuevo.
4. **Importar un archivo:** asistente de migracion que traduce el Excel al mismo modelo y muestra decisiones, no un modo alternativo de operar.

Flujo recomendado del constructor:

```text
Datos basicos -> Objetivos -> Actividades -> Programacion
-> Responsables y evidencia -> Revision -> Enviar a aprobacion
```

Reglas de experiencia:

- guardar borrador automaticamente y permitir continuar despues;
- mostrar progreso del constructor y errores en el paso donde se resuelven;
- permitir crear una actividad completa sin navegar por varias pantallas;
- ofrecer frecuencias entendibles (`semanal`, `mensual`, `trimestral`, `una vez`, `cuando ocurra`) y generar el calendario internamente;
- mantener disponible una programacion avanzada para excepciones, sin obligar al usuario comun a editar 48 columnas;
- permitir duplicar, reordenar y editar varias actividades con operaciones controladas;
- sugerir responsables, evidencias e indicadores desde la plantilla, siempre editables antes de aprobar;
- mostrar una revision final en lenguaje operacional: que se hara, quien, cuando, donde y como se demostrara;
- no mostrar conceptos de implementacion como IDs, claves de hoja o nombres de columnas del Excel;
- permitir previsualizar lo que vera cada rol sin crear copias del programa.

Modelo conceptual:

- **Plantilla de programa:** definicion reusable, sin ejecuciones ni firmas de una instancia.
- **Programa:** instancia versionada para un periodo y alcance de faenas.
- **Objetivo:** resultado preventivo que agrupa actividades.
- **Actividad:** trabajo esperado con responsable, audiencia, evidencia y regla de cumplimiento.
- **Programacion:** recurrencia, cantidades o disparadores, independiente de una grilla visual concreta.
- **Obligacion:** ocurrencia ejecutable generada por calendario o evento.
- **Ejecucion:** resultado y evidencia que satisface total o parcialmente una obligacion.
- **Vista guardada:** proyeccion por rol, faena, periodo o tema; reemplaza las hojas duplicadas como concepto de dominio.

Las ocho hojas del archivo 2026 deben importarse como vistas/audiencias preconfiguradas de su plantilla, no como una regla que obligue a todo programa a tener ocho hojas.

### 6.2 Ciclo de vida y firma de contenido

Estado general recomendado:

```text
draft -> in_review -> active -> closed
   \          \
    -> archived <- rejected
```

Las aprobaciones no deben convertirse en estados fijos por cargo. Cada plantilla define un flujo ordenado de pasos —por ejemplo revision tecnica JDPR y aprobacion Legal para el programa 2026— con rol requerido, regla de segregacion y obligatoriedad. `in_review` progresa cuando todos los pasos configurados firmaron el mismo digest; asi otro programa puede requerir uno, dos o mas aprobadores sin agregar enums o codigo especial.

Reglas:

- `draft`: editable, sin firmas vigentes.
- `in_review`: contenido congelado; se calcula `contentDigest` y `contentVersion`.
- cada paso de aprobacion registra firma, rol, orden y decision sobre el digest exacto;
- `active`: calendario y contenido base inmutables; cambios se hacen por enmienda/version nueva.
- `rejected`: conserva motivo, actor, fecha, version revisada y permite volver a borrador creando una nueva version.
- `closed`: conserva el expediente anual sin admitir ejecuciones nuevas salvo reapertura auditada.
- `archived`: reemplaza el borrado de programas que ya ingresaron a revision o recibieron una firma.

Segregacion minima de la plantilla 2026:

- JDPR y Legal deben ser personas distintas.
- El elaborador no puede aprobar su propio contenido como JDPR.
- El activador debe comprobar todos los pasos requeridos y el mismo digest.
- Un override administrativo, si el negocio decide permitirlo, requiere permiso dedicado, justificacion obligatoria, segundo factor o reautenticacion y evento de auditoria destacado. No debe heredarse de `admin` de forma silenciosa.

El digest debe cubrir, con serializacion canonica:

- metadatos y version documental;
- objetivos y orden;
- actividades y orden;
- modo de programacion, recurrencias, periodos y cantidades;
- responsables, audiencias y vistas configuradas;
- checklist/criterios requeridos para acreditar la ejecucion;
- meta, formula y periodicidad del indicador.

### 6.3 Importacion trazable y sin perdida

Crear un concepto de lote de importacion con al menos:

- `id`, programa destino y estado del lote;
- nombre, MIME, tamano y SHA-256 del archivo;
- archivo original conservado o enlace a Documento SST;
- usuario y fecha de carga/aplicacion;
- version del extractor;
- resumen de filas, celdas P/E, hojas y advertencias;
- mapeo de faena para ejecuciones historicas;
- diff contra el programa destino;
- errores por hoja/celda con valor original;
- snapshot previo y resultado aplicado;
- clave de idempotencia.

Flujo objetivo:

```text
cargar Excel -> validar estructura -> extraer a staging -> mostrar diff
-> resolver faena/advertencias -> confirmar -> aplicar en transaccion
-> reconciliar conteos/hash -> registrar evidencia de importacion
```

Nunca se debe borrar el programa actual antes de que el staging completo sea valido. La aplicacion debe ser atomica y conservar el snapshot anterior para rollback.

### 6.4 Programacion calendarizada, a demanda y disparada

Cada actividad debe declarar un `scheduleMode`:

- `scheduled`: usa una recurrencia o cantidades P por periodo y cumplimiento plan/ejecucion; la semana es una granularidad posible.
- `on_demand`: no tiene P semanal; aparece en una bandeja permanente y se ejecuta cuando ocurre la necesidad.
- `triggered`: una entidad/evento de origen abre una obligacion con plazo, por ejemplo incidente, trabajador nuevo o cambio legal.

Para `on_demand` y `triggered` se requiere:

- tipo de disparador;
- evento de origen y faena;
- responsable;
- SLA o fecha limite;
- evidencia minima;
- regla de cierre/cancelacion;
- politica de denominador para el indicador;
- razon auditable si se registra manualmente sin fuente.

No se deben inventar cantidades P para las 22 actividades del Excel. El indicador debe separar claramente:

- cumplimiento calendarizado = ejecutado programado / plan programado;
- respuesta a demanda = obligaciones cerradas en plazo / obligaciones disparadas;
- actividades sin disparos = “sin casos”, no 100 % automatico ni 0 %.

### 6.5 Enlaces tipados con los modulos operacionales

Evolucionar el enlace generico a un binding tipado, o extender el modelo actual con equivalentes de:

- `activityId`, `sourceType`, `sourceId`, `worksiteId`;
- `triggerEvent`, `quantityRule`, `evidenceRule`;
- `effectiveFrom`, `effectiveTo`, `status`;
- `idempotencyKey` unica por evento/actividad/faena;
- `createdBy`, `createdAt`, origen manual/automatico;
- enlace bidireccional a la ejecucion PDTP generada.

Una ejecucion automatica nunca debe guardar solo un texto descriptivo: debe conservar el ID de la entidad fuente y permitir navegar al expediente original.

### 6.6 Salidas derivadas, no estructura de autoría

La plataforma debe producir distintas representaciones desde un solo programa:

1. **Vista operacional:** bandeja, calendario, lista o matriz segun el trabajo del usuario.
2. **Reporte de gestion:** resumen por objetivo, faena, periodo, responsable y tipo de cumplimiento.
3. **Expediente auditor:** ejecuciones, fuentes, evidencias, acciones, firmas, versiones e importaciones.
4. **Perfil de compatibilidad 2026:** salida Excel que reconstruye la informacion necesaria del RE-36 si la organizacion aun debe intercambiar ese formato.

El perfil RE-36 es un adaptador versionado y opcional. Puede conservar ocho hojas, 48 semanas y P/E para el caso 2026, pero esos elementos no aparecen como restricciones al crear un programa nuevo. La UI debe nombrar las salidas sin ambiguedad y nunca presentar el expediente como plantilla de importacion.

---

## 7. Plan de implementacion por fases

## Fase 0 — Extraer la intencion y preparar evidencia

**Objetivo:** distinguir las reglas durables del proceso preventivo de las decisiones de maquetacion del archivo y asegurar que la migracion 2026 pueda comprobarse.

### Trabajo

- [x] Registrar SHA-256, tamano y nombre del Excel recibido.
- [x] Crear una fixture sanitizada o generador determinista que conserve estructura, formulas, 89 actividades, hojas y casos limite sin exponer datos personales innecesarios.
- [x] Convertir los conteos 8/89/8, 843 y 1.035 en invariantes del adaptador 2026, no del modelo general.
- [x] Agregar invariantes para las seis celdas E conocidas.
- [x] Fijar las membresias exactas de las ocho hojas.
- [x] Fijar los 22 IDs sin plan numerico y los textos largos de 37, 38, 43, 51 y 52.
- [x] Documentar un diccionario de columnas que resuelva `PROGRAMA` y `ACTIVIDAD`.
- [x] Clasificar cada elemento del archivo como concepto de dominio, dato de la plantilla 2026, vista derivada o decoracion documental.
- [ ] Entrevistar/validar con usuarios como crean hoy un programa, que copian del año anterior y donde se equivocan o pierden tiempo.
- [x] Definir las tareas criticas del constructor y criterios de simplicidad antes de disenar pantallas.
- [x] Capturar el estado de la base objetivo antes de cualquier carga de datos: conteos, programas, ejecuciones y huellas.
- [x] Abrir una bitacora de hallazgos dentro de este documento y clasificar cualquier descubrimiento nuevo.

### Criterios de aceptacion

- Una prueba falla si el adaptador omite o altera cualquier elemento comprometido de la migracion.
- La fixture permite probar plan, ejecucion, metadatos, hojas, formulas y textos largos.
- El hash del archivo fuente y el resultado de extraccion quedan registrados en el expediente de migracion.
- Existe una separacion aprobada entre modelo general, plantilla Chome 2026, vistas y formato Excel.

---

## Fase 1 — Cerrar seguridad y gobierno P0

**Objetivo:** impedir exposicion entre faenas y evitar que se active contenido diferente del aprobado.

### 1.1 Alcance de exportacion

- [x] Hacer obligatorio resolver un alcance antes de construir cualquier Excel.
- [x] Para usuarios acotados, derivar la faena del contexto autorizado o exigir seleccion explicita; nunca interpretar omision como “todas”.
- [x] Mantener bloqueado el consolidado multifaena mientras no exista un permiso dedicado y una semantica aprobada; el endpoint exige una faena concreta incluso para usuarios globales.
- [x] Propagar `scope` desde `app/api/prevencion/pdtp/export/route.ts` hasta `buildPdtpExport`, hojas, planes de accion y seguimientos.
- [x] Aplicar el mismo predicado de alcance a todas las secciones y formatos de salida.
- [x] Responder `403` cuando se solicita una faena ajena y `400` cuando falta contexto indispensable.
- [x] Agregar `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` y nombre de archivo seguro.
- [x] Auditar actor, programa, tipo de exportacion, faenas incluidas, fecha y resultado.

### 1.2 Aprobaciones inmutables

- [x] Incorporar version de contenido, digest canonico y snapshot firmado.
- [x] Implementar el estado `in_review` para congelar edicion antes de la primera firma.
- [x] Rechazar cualquier mutacion de contenido durante revision/aprobacion.
- [x] Si se devuelve a borrador, invalidar todas las firmas del flujo de forma atomica y crear una nueva version; no reutilizar el digest anterior.
- [x] Impedir borrar programas que hayan entrado a revision; archivarlos con trazabilidad.
- [x] Implementar transiciones con update condicional por `status` + `contentVersion` y comprobar exactamente una fila afectada.
- [x] Hacer idempotente la repeticion de la misma solicitud por el mismo actor sin permitir una segunda transicion incompatible.

### 1.3 Segregacion de funciones

- [x] Separar permisos y acciones para enviar a revision, aprobar como JDPR, decidir como Legal, activar y administrar reapertura/archivo en la configuracion inicial 2026.
- [x] Desacoplar el motor de los campos fijos JDPR/Legal mediante pasos ordenados configurables por programa/plantilla; los campos anteriores quedan solo como espejos de compatibilidad para la configuracion 2026.
- [ ] Incorporar un permiso dedicado de sobrepaso de segregacion, si el negocio decide admitirlo, con justificacion y reautenticacion obligatorias.
- [x] Impedir en servicio, no solo en UI, las combinaciones de actor prohibidas por la plantilla; para 2026, elaborador = JDPR o JDPR = Legal.
- [x] Revisar y probar las asignaciones de `prevencionista`, `jefa_chome` y `administrador` en el manifest para envio, activacion y gobierno del ciclo.
- [x] Exigir motivo y auditoria para rechazo, reapertura y archivo.
- [x] Exigir motivo y permiso dedicado para crear, modificar o eliminar overrides operacionales, y conservar el antes/despues en la bitacora.
- [x] Mostrar al usuario que firma la version y huella corta del contenido.

Estado parcial de segregacion: ya existen permisos independientes para enviar a revision, decidir cada paso, activar y administrar reapertura/archivo. El motor ejecuta una secuencia ordenada configurable y conserva una fotografia inmutable de cada decision, permiso, regla de segregacion, version y digest. El punto permanece abierto solo respecto de un eventual permiso extraordinario para sobrepasar segregacion, que se mantiene deliberadamente no implementado hasta acordar su gobierno.

### Pruebas obligatorias

- [x] Matriz negativa rol × faena × endpoint para exportacion, incluyendo `faena` omitida, inexistente/inactiva y ajena.
- [x] Confirmar que ninguna salida contiene IDs, textos o acciones de otra faena.
- [x] Probar flujos configurables de uno, dos y tres pasos; el de tres no usa JDPR/Legal como casos especiales del motor y cubre orden y segregacion.
- [x] En la configuracion 2026, rechazar JDPR = Legal y elaborador = JDPR.
- [x] Rechazar activacion si el digest actual difiere del firmado.
- [x] Simular dos aprobaciones concurrentes y demostrar una sola transicion valida.
- [x] Rechazar edicion, reimportacion y borrado durante `in_review` o despues de una firma.
- [x] Verificar auditoria de exportacion, envio, firma, rechazo, reapertura y archivo.
- [x] Verificar motivo obligatorio, permiso dedicado y auditoria de alta/eliminacion de overrides.

### Gate de salida

No se inicia despliegue productivo ni migracion de ejecuciones hasta que SEC-01 y GOV-01 a GOV-04 esten cerrados con pruebas negativas y evidencia exportable.

---

## Fase 2 — Construir la experiencia general de autoría

**Objetivo:** que un prevencionista pueda crear un programa completo y comprensible sin abrir el Excel ni conocer su estructura interna.

### 2.1 Plantillas e instancias

- [x] Separar conceptualmente plantilla reutilizable y programa anual/contractual ejecutable.
- [x] Permitir crear desde plantilla, copiar periodo anterior, partir en blanco o importar.
- [x] Al copiar, conservar objetivos, actividades, reglas, vistas y checklist; reiniciar ejecuciones, firmas y fechas operacionales.
- [x] Versionar plantillas y mostrar que programas usan cada version sin modificarlos retroactivamente.
- [x] Incluir la referencia 2026 como una plantilla inicial editable, no como un seed oculto ni caso especial en el codigo. Verificado: el boton "Publicar como plantilla" del constructor y el flag `--publish-reference` del bootstrap invocan el mismo `createPdtpTemplateVersion`, con la misma guarda de `needs_review`; no hay codigo especial 2026 en el servicio de plantillas.

### 2.2 Constructor guiado

- [x] Implementar los pasos: datos basicos, objetivos, actividades, programacion, responsabilidades/evidencias y revision.
- [x] Permitir agregar una actividad dentro de su objetivo con los campos esenciales visibles y opciones avanzadas plegadas.
- [x] Ofrecer recurrencias en lenguaje natural y una previsualizacion de obligaciones generadas.
- [x] Incluir acciones para duplicar, reordenar, mover de objetivo y editar en lote sin perder datos asociados.
- [ ] Guardar borrador automaticamente y advertir cambios no sincronizados. Parcial (BLD-03 + BLD-11): "Datos basicos", "Objetivos" y "Planificacion" (matriz avanzada) autoguardan con debounce de 1,5 s reusando la misma accion de servidor del boton explicito, muestran el estado "Guardado"/"Guardando…"/"Cambios sin guardar" y advierten con `beforeunload`. "Actividades" (dialogo de edicion con Cancelar explicito) y "Evidencias" (`savePdtpActivityChecklist` crea una fila de VERSION nueva por guardado) quedan deliberadamente manuales: autoguardar ahi rompe la semantica de Cancelar o llena el historial de versiones con intentos a medio escribir — ver BLD-11.
- [x] Validar progresivamente; no esperar al ultimo paso para revelar errores.
- [x] Permitir previsualizar el programa por faena, responsable y audiencia. Cerrado en BLD-05 (responsable/audiencia) + BLD-11 (faena): `AudiencePreviewPanel` filtra tambien por faena usando `pdtpProgramWorksites` (membresia) y `pdtpActivityWorksiteExclusions` (exclusion puntual), datos ya cargados por la pagina — sin crear copias ni consultas nuevas. Muestra aviso explicito si la faena elegida no esta habilitada para el programa.
- [x] Mantener una vista matriz opcional para usuarios avanzados, derivada de la programacion y no usada como unico editor.

### 2.3 Modelo general y vistas derivadas

- [x] Modelar recurrencia/calendario sin asumir 48 semanas ni un año calendario. Cerrado en BLD-11: `PdtpScheduleHorizon`/`deriveScheduleHorizon` derivan el horizonte del periodo real del programa (`periodStart`/`periodEnd`); sin periodo declarado el horizonte es el año completo (identico al comportamiento anterior, regresion cubierta por test). Riesgo residual: `pdtp_activity_schedule` sigue acotada por esquema a un unico año con semana 1-4 (CHECK) — multi-año o semanas ISO reales exige remodelar esa tabla, marcado `// ponytail:` en el codigo.
- [x] Modelar audiencias y responsables sin crear tablas especiales por cada hoja del archivo.
- [x] Convertir las hojas 2026 en vistas guardadas de la plantilla importada. Verificado en `lib/services/pdtp/templates.ts`: `createPdtpTemplateVersion` incluye `views` (code/label/area/defaultScopeRoles por fila) en el snapshot canonico, e `instantiatePdtpTemplateVersion` las materializa genericamente en `pdtpSheets` para el programa nuevo, sin ningun condicional por codigo de hoja.
- [x] Permitir programas de una o varias faenas con reglas explicitas de herencia y excepcion. Cerrado en BLD-11: `pdtp_program_worksites` (membresia; vacio = todas las faenas del scope, retrocompatible) y `pdtp_activity_worksite_exclusions` (excepcion puntual de actividad por faena, motivo obligatorio). Servicio `lib/services/pdtp/worksites.ts`; digest incluye ambas (`schemaVersion` 6); `createPdtpObligation`/`markPdtpExecution` rechazan una faena fuera de la membresia declarada.
- [x] Hacer configurables meta, periodicidad, indicador, evidencia requerida y flujo de aprobacion.
- [ ] Evitar enums o condiciones con nombres de hojas, personas o año 2026 fuera del adaptador correspondiente. Parcial (ver incremento BLD-02): se movio el vocabulario fijo (`SHEET_META`/`SHEET_EXPORT_NAMES`/`ROLE_RESPONSIBLE_SLUGS`) a `lib/services/pdtp-adapters/`, y se corrigieron el selector de vista y el resolutor de vista por rol en `[programId]/page.tsx` y el exportador para leer las vistas reales del programa en vez de una lista fija. Incremento 2026-07-22: se elimino el ultimo literal de hoja 2026 en un servicio generico — `imports.ts` ya no hardcodea `"PDTP GENERAL"` sino que consume `PDTP_2026_GENERAL_SHEET_NAME`, exportado desde el adaptador (`prevention-pdtp-catalog.ts`, fuente unica tambien de `OFFICIAL_SHEETS` y del mensaje de error); y `checklist-templates-2026.ts` (specs de checklist especificas de 2026) se movio de `lib/services/pdtp/` a `lib/services/pdtp-adapters/`, conservando la API publica via el re-export de `index.ts`. La afirmacion previa sobre `collectResponsibleCatalog` en `helpers.ts` quedo obsoleta: ya vive en `pdtp-adapters/responsible-catalog-2026.ts`. Falta: `imports.ts`/`catalog.ts` (bootstrap/importacion 2026) siguen consumiendo ese vocabulario, lo cual es correcto porque son el adaptador operando, pero conviene revisar si su ubicacion fisica tambien deberia migrar.

### 2.4 Criterios de usabilidad

- [ ] Un usuario de negocio crea y guarda un programa pequeno desde cero sin capacitacion sobre el Excel.
- [x] Un usuario crea el programa siguiente copiando el anterior y entiende exactamente que se conserva y que se reinicia.
- [x] El flujo principal no presenta una grilla de 48 semanas ni exige configurar las ocho vistas del ejemplo.
- [ ] Toda pantalla pasa el test de los cinco segundos: contexto, estado y siguiente accion son evidentes.
- [ ] Prueba moderada con prevencionistas de al menos dos faenas antes de cerrar la fase.

### Pruebas obligatorias

- [x] Crear desde cero, plantilla y copia del periodo anterior.
- [ ] Guardar/recuperar borrador en cada paso. Cubierto para "Datos basicos" (`metadata-tab.test.tsx`), "Objetivos" (`objetivos-tab.test.tsx`) y "Planificacion" (`planificacion-tab.test.tsx`); "Actividades"/"Evidencias" quedan manuales por diseno (ver nota de autosave arriba) y no requieren esta prueba.
- [x] Recurrencia simple genera las obligaciones esperadas; cambio de recurrencia muestra el impacto antes de aplicar.
- [x] Copiar programa no copia ejecuciones, evidencias ni firmas.
- [x] Una plantilla actualizada no muta programas ya creados.
- [x] Audiencias producen vistas equivalentes sin duplicar actividades. Cubierto por `audiences (sheet memberships) reuse the same 89 activities instead of duplicating rows per view` en `lib/__tests__/prevention-pdtp.test.ts`.
- [ ] Accesibilidad por teclado, responsive y recuperacion ante error de red. Parcial: **recuperacion ante error de red ya cubierta** por `shows a recoverable error on a network failure, and a manual retry (Guardar) succeeds` (`objetivos-tab.test.tsx`), sobre un hook de autosave que expone estado `error` y reintento manual (`lib/hooks/use-debounced-autosave.ts`). Falta accesibilidad por teclado y responsive, que se cierran junto con la prueba moderada con usuarios de rol de esta misma fase.

### Gate de salida

El programa 2026 puede recrearse mediante la plantilla, pero tambien puede crearse un programa diferente —con otros objetivos, periodos, frecuencias, roles y vistas— sin cambios de codigo ni conocimiento del documento original.

---

## Fase 3 — Importacion lossless, staging y bootstrap 2026

**Objetivo:** cargar el archivo real sin perder ejecuciones, fuentes ni trabajo existente.

### 3.1 Parser y staging

- [x] Restringir el contrato inicial a `.xlsx` y verificar MIME, firma ZIP, tamano y limites de recursos.
- [x] Extraer columnas P y E de las 48 semanas.
- [x] Extraer metadatos, firmas declaradas, control de cambios, formula, meta, periodicidad y leyenda; cuando Z7 no entrega formula legible, conservar la ausencia y exigir reconciliacion en vez de inventarla.
- [x] Reportar celdas desconocidas, formulas no evaluables y diferencias de estructura.
- [x] Crear lote de importacion y staging; no escribir el programa mientras existan errores bloqueantes.
- [x] Mostrar preview con altas, bajas, modificaciones, cambios de calendario y objetos que perderian enlaces/checklist.
- [x] Incluir conteos de cascada reales en la confirmacion de reemplazo.
- [x] Hacer el apply atomico en una transaccion y registrar snapshot previo.

### 3.2 Ejecuciones E historicas

- [x] Presentar las seis ejecuciones detectadas en el preview.
- [x] Exigir mapeo de cada conjunto a una faena autorizada.
- [x] Ingresar las E como reportadas (`submitted`) y `migrated_without_attachment`; no cuentan como cumplimiento aprobado hasta su revision.
- [x] Conservar coordenada de hoja/celda, cantidad original, lote, actor de migracion y observacion.
- [x] No inventar evidencia ni responsable historico; marcar explicitamente “migrado sin evidencia adjunta” cuando corresponda y exigir aceptacion.
- [x] Usar una clave idempotente basada en lote + hoja + celda + actividad + faena.

### 3.3 Reimportacion segura

- [x] Reconciliar actividades por identificador estable del documento, no solo por posicion o texto.
- [x] Conservar bindings y checklist cuando la actividad logica no cambie.
- [x] Bloquear reimportacion fuera de `draft`, salvo flujo formal de nueva version.
- [x] Permitir cancelar antes del apply sin mutar datos.
- [x] Permitir rollback del lote aplicado mientras no existan operaciones posteriores incompatibles.

### 3.4 Bootstrap explicito

- [x] Crear un comando o flujo administrativo dedicado, `pdtp:bootstrap-2026`, separado del seed generico.
- [x] Incluir modo `--dry-run` con resumen 8/89/8, 843, 1.035 y seis E.
- [x] Exigir año, archivo/lote, usuario ejecutor y estrategia de faena.
- [x] Crear catalogos y hojas requeridos antes de importar el programa.
- [x] Aplicar templates de checklist solo despues de que las actividades existan y registrar su version; la publicacion de la referencia es explicita y el servicio la rechaza mientras exista una modalidad `needs_review`.
- [x] Repetir el bootstrap contra la misma base sin duplicar datos ni ejecuciones.
- [x] Entregar runbook para local, staging y produccion.

### Pruebas obligatorias

- [x] Importacion exacta del archivo/fixture con P y E.
- [x] Rechazo explicito de `.xls`, archivo corrupto, zip bomb, hoja faltante y estructura alterada.
- [x] Preview sin escrituras.
- [x] Rollback total ante un error tardio al materializar ejecuciones historicas.
- [x] Reimportacion idempotente y conservacion de bindings/checklist.
- [x] Mapeo de E a faena con rechazo de una faena no autorizada.
- [x] Segundo `db:generate` devuelve `No schema changes` despues de generar las migraciones.

### Gate de salida

- Base de staging con 1 programa 2026, 8 objetivos, 87 actividades, 8 vistas derivadas, 821 celdas P y total 1.013.
- Las seis cantidades E estan presentes, mapeadas y reconciliadas, o existe una excepcion firmada que explica por que no deben migrarse.
- El lote permite reconstruir exactamente que se importo y desde que archivo.

---

## Fase 4 — Fidelidad del modelo y actividades a demanda

**Objetivo:** representar correctamente toda la semantica del documento y permitir editarla sin degradacion.

### 4.1 Terminologia y textos

- [ ] Definir campos de dominio sin ambiguedad, por ejemplo `programName` para columna C y `activityDescription` para columna D. Parcial, y con una correccion sobre el ejemplo del propio enunciado: `PDTP_2026_COLUMN_DICTIONARY` (`lib/services/pdtp-adapters/contract-2026.ts`) ya fija los nombres de dominio verificados contra el diccionario de columnas real — columna C (`PROGRAMA`) es `activityDescription` ("es la descripcion principal de la actividad") y columna D (`ACTIVIDAD`) es `executionGuidance`, no `programName`/`activityDescription` como sugeria el ejemplo original antes de tener el diccionario confirmado (hallazgo EVD-00A, 2026-07-21: "PROGRAMA es la descripcion principal y ACTIVIDAD la guia de ejecucion"). Falta: las columnas fisicas siguen llamandose `activity`/`program` en `pdtpActivities` y varios consumidores (`catalog.ts`, `templates.ts`, `content-digest.ts`, `activities.ts` en su registro de cambios, `audit-dossier.ts`/`obligations.ts`/`executions.ts` en sus `select`) las leen directo en vez de pasar por el adaptador de la linea siguiente; no se propago porque `content-digest.ts` y el registro de cambios de `activities.ts` firman/auditan sobre la forma actual de esos campos, y renombrar ahi sin verificar compatibilidad de digest podria invalidar aprobaciones ya firmadas — es un cambio real pero que merece su propia revision, no un rename apurado.
- [x] Crear migracion de compatibilidad y adaptadores temporales si renombrar columnas fisicas es riesgoso. `lib/services/pdtp/activity-content.ts`: `readPdtpActivityContent`/`writePdtpActivityContent` exponen `{activityDescription, executionGuidance}` sin exigir renombrar las columnas fisicas `activity`/`program`, con advertencia explicita en el archivo de que ningun consumidor debe inferir significado por el nombre de esas columnas. Usado hoy en los dos bordes mas sensibles: escritura durante importacion (`imports.ts`) y lectura para las vistas derivadas por hoja (`sheets.ts`).
- [x] Traducir las columnas del adaptador a conceptos claros del constructor; la UI usa “actividad preventiva” y “guia de ejecucion”, no los encabezados ambiguos del archivo.
- [x] Aumentar limites de validacion y esquema segun los maximos reales mas margen documentado; no usar 200 por defecto.
- [x] Probar edicion sin cambios de las actividades 37, 38, 43, 51 y 52. Cubierto por `round-trips the five long 2026 activities without swapping or truncating their meaning` en `lib/__tests__/prevention-pdtp.test.ts`.
- [x] Evitar truncamiento visual silencioso: tooltip/detalle para textos largos y contenido completo en exportacion. Revisado: ningun componente PDTP aplica `truncate`/`line-clamp` al texto de actividad; `pdtp-sheet-table.tsx` lo envuelve en un contenedor de ancho fijo sin recortar, y la unica truncacion existente (`notes`, 100 caracteres) ya lleva `title` con el texto completo. La exportacion usa el texto completo sin recortar (verificado por el mismo test de round-trip).

### 4.2 Metadatos controlados

- [x] Modelar codigo documental opcional, revision, vigencia, indicador, formula, meta, periodicidad y propietario general sin asumir RE-36.
- [x] Modelar elaboracion, revision, aprobacion y control de cambios como historial, no como texto reemplazable. `pdtp_document_history` (`entryKind`: elaboration/approval/change_control) poblada en la importacion y mostrada en "Historia y referencias del documento importado".
- [x] Enlazar personas declaradas del archivo con usuarios solo mediante reconciliacion; conservar siempre el nombre original. Incremento BLD-04: se agrego la accion de UI que faltaba sobre `reconcilePdtpDeclaredActor` (que ya existia y estaba probado a nivel de servicio) — boton "Vincular a una persona" por declaracion, motivo obligatorio de al menos 10 caracteres, solo mientras el programa es editable; `declaredActorName` nunca se sobrescribe.
- [x] Conservar la leyenda de roles y la version de la plantilla de referencia 2026. `pdtp_role_legend_entries` poblada en la importacion y mostrada junto al `adapterCode` (version del extractor) por cada declaracion historica.

### 4.3 Modo a demanda/disparado

- [ ] Clasificar explicitamente las 22 actividades sin P semanal.
- [ ] Definir para cada una si es `on_demand` o `triggered` y su evento de origen.
- [ ] Definir SLA, evidencia, responsable y regla de indicador por actividad.
- [x] Mostrar estas actividades en el constructor y la vista anual aunque no tengan P, con estado “clasificacion pendiente”.
- [x] Crear obligaciones al ocurrir el disparador y recordatorios por vencimiento.
- [x] Permitir ejecucion manual solo con motivo, clave estable y fuente seleccionada cuando exista.

### Pruebas obligatorias

- [x] Round-trip semantico de columnas C/D sin inversion. Mismo test de round-trip: `activityDescription` proviene de la columna `activity` y `executionGuidance` de `program`, verificado contra el archivo real, no invertido.
- [x] Los cinco textos largos se importan, editan y exportan completos. Mismo test: los 5 textos de las actividades 37/38/43/51/52 se comparan completos (uno supera 200 caracteres) entre catalogo importado, fila persistida tras editar y fila exportada.
- [x] Las 22 actividades siguen visibles y no contaminan el denominador calendarizado. Cubierto por `keeps the 22 no-P activities visible without contaminating the calendarized denominator` en `lib/__tests__/prevention-pdtp.test.ts`: las 22 aparecen en `listPdtpProgramActivities`, y `getPdtpComplianceIndicators` da un total planificado anual de exactamente 1.035 (no inflado ni recortado por su presencia).
- [x] Una obligacion disparada cuenta una sola vez y cambia a vencida segun SLA.
- [x] “Sin casos” se distingue de 0 % y 100 %.

---

## Fase 5 — Integracion operacional de las actividades

**Objetivo:** reemplazar doble digitacion por evidencia vinculada desde el modulo que ejecuta realmente el trabajo.

Antes de implementar automatismos, se debe producir una **matriz actividad por actividad** con estas columnas:

| Campo obligatorio | Descripcion |
|---|---|
| ID 2026 | Numero 1 a 89 del archivo |
| Dominio fuente | Modulo o captura manual controlada |
| Evento disparador | Creacion, cierre, aprobacion, asistencia, entrega, etc. |
| Regla de cantidad | Uno por evento, asistentes, documentos, controles u otra unidad |
| Faena | Como se deriva y valida |
| Evidencia minima | Documento, acta, firma, fotografia, lista, investigacion, etc. |
| Responsable | Rol operativo y suplencia |
| Modo | `scheduled`, `on_demand` o `triggered` |
| Audiencia/vista 2026 | Una o mas de las ocho proyecciones de referencia |
| Automatizacion | Automatica, propuesta para confirmar o manual justificada |
| Idempotencia | Clave que impide doble conteo |
| Regla de anulacion | Que ocurre si la fuente se cancela o reabre |

### 5.1 Mapa inicial del caso 2026 por grupos

| Rango | Dominio principal esperado | Integracion a verificar/crear |
|---:|---|---|
| 1–9 | Liderazgo y gestion preventiva | Documentacion SST, reuniones, indicadores y compromisos de faena |
| 10–14 | CPHS | Comites, constitucion, reuniones, actas y acuerdos |
| 15–34 | Requisitos, induccion y controles operacionales | Requisitos legales, documentacion, trabajador/faena, inspecciones y permisos |
| 35–50 | MIPER, comunicacion e higiene | MIPER, controles, difusion documental, higiene y vigilancia |
| 51–60 | Capacitacion y competencias | Sesiones, asistencia, evaluaciones y cierre de brechas |
| 61–65 | EPP | Matriz de requisitos, entrega/reposicion y evidencia del trabajador |
| 66–78 | Incidentes e investigacion | Incidente, notificacion, investigacion, causas, CAPA y cierre |
| 79–84 | Emergencias | Plan, simulacro, resultado, brechas y acciones correctivas |
| 85–89 | Campanas | Campana, distribucion, participacion y evidencia de difusion |

### 5.2 Reglas de integracion

- [x] Ampliar tipos de fuente a capacitacion, inspeccion, CPHS, EPP, emergencia, incidente, CAPA, documento/distribucion y permiso cuando aplique. Cerrado en BLD-12 para los 6 tipos con entidad natural: `capacitacion` (`prevention_training_sessions`), `inspeccion` (`prevention_inspection_runs`), `cphs` (`prevention_committees`), `epp` (`prevention_epp_requirements`), `emergencia` (`prevention_emergency_plans`), además del `incident_capa` ya existente. `campana` no tiene entidad propia en el esquema (no se creó una tabla especulativa) y queda como identificador de texto libre, igual que auditoría/objetivo interno/obligación contractual.
- [x] Crear selector estructurado para enlaces manuales; no aceptar IDs pegados en texto. Cerrado en BLD-12 para los 6 tipos anteriores: `getPdtpCoverage` expone `sourceOptions` poblado y scoped por faena para cada uno, y `LinkSourceDialog` los ofrece como picker (antes solo MIPER/legal/CAPA tenían selector). `linkPdtpActivitySource` valida existencia, faena y estado (activo/aprobado/no cancelado según el dominio) antes de vincular.
- [ ] Emitir un evento de dominio solo al alcanzar el estado que acredita trabajo real, no al crear un borrador.
- [ ] Crear/proponer ejecucion PDTP con fuente, faena, cantidad y evidencia derivadas.
- [ ] Si el evento excede la cantidad planificada, conservar el real y marcar sobrecumplimiento sin caparlo silenciosamente.
- [ ] Si la entidad fuente se anula o reabre, revertir o poner en revision la ejecucion vinculada con auditoria.
- [ ] Mostrar enlace bidireccional desde PDTP a la fuente y desde la fuente a su acreditacion PDTP.
- [ ] No duplicar archivos: reutilizar el expediente fuente con permisos equivalentes o mas restrictivos.

### 5.3 Orden recomendado de integraciones

1. Incidentes/CAPA, porque concentra gran parte de las actividades a demanda 66–78.
2. Capacitacion, porque tiene una vista 2026 propia y datos estructurados de asistencia.
3. Inspecciones/MIPER/requisitos legales, ampliando lo que ya existe.
4. CPHS y documentacion/distribuciones.
5. EPP y trabajador/faena.
6. Emergencias/simulacros.
7. Campanas y actividades residuales manuales.

### Pruebas obligatorias por integracion

- [ ] Evento valido crea una sola ejecucion en la faena correcta.
- [ ] Borrador/cancelacion no acredita cumplimiento.
- [ ] Reintento no duplica por idempotency key.
- [ ] Usuario sin alcance no puede vincular ni consultar la fuente.
- [ ] Anulacion/reapertura conserva historial y corrige el indicador.
- [ ] Evidencia y cantidad cumplen la regla definida en la matriz.

### Gate de salida

Las 87 actividades de la plantilla 2026 tienen una decision explicita y aceptada. No puede quedar una actividad “automaticamente cubierta” sin evento, cantidad, evidencia y prueba. Las manuales deben tener razon de negocio, no ser residuos del desarrollo. Eventos, cantidades y evidencias se configuran mediante tipos reutilizables; no se codifica una condicion por numero de actividad.

---

## Fase 6 — Operacion intuitiva, indicadores y salidas

**Objetivo:** que el usuario entienda en cinco segundos que debe hacer y que la plataforma genere cada salida desde el programa, sin convertir ningun formato de exportacion en la experiencia de autoría.

### 6.1 Contexto de faena e indicadores

- [x] Exigir faena en las vistas de ejecucion o mostrar un agregado autorizado con etiqueta y formula explicitas. El detalle del programa ya exigia seleccionar faena (sin eso, vista/indicadores quedan vacios, no en cero enganoso); la lista de programas ahora muestra el agregado autorizado explicito (item anterior).
- [x] Corregir la lista de programas para que no calcule 0 por omitir `worksiteId`. Nueva `getPdtpComplianceIndicatorsForScope` agrega el cumplimiento sobre las faenas autorizadas del usuario (reutilizando el calculo por-faena ya correcto), con etiqueta explicita "Cumplimiento (N faena(s))" y `title` con la formula; falla cerrado si no hay faenas.
- [x] Separar cumplimiento calendarizado, respuesta a demanda y acciones vencidas. Ya son tres fuentes de datos distintas y no conflatadas: `PdtpIndicatorsPanel`/`getPdtpComplianceIndicators` solo cuenta actividades `scheduled` (verificado por el test de las 22 actividades sin P); la respuesta a demanda/disparada vive en el motor de obligaciones (OBL-01, `no_cases`/`with_cases`) y su bandeja `/prevencion/pdtp/obligaciones`; las acciones vencidas se cuentan aparte via `actionsPending`/`actionsOverdue` por ejecucion y `listVencidas`.
- [x] Mostrar corte temporal y ultima actualizacion de cada indicador. `PdtpIndicatorsPanel` muestra "Datos al {fecha de render}" y "Última ejecución aprobada: {fecha}" (nuevo campo `lastExecutionUpdatedAt`).
- [x] Permitir navegar desde un KPI a los registros que lo componen. El tile "Cumplimiento anual" y cada fila mensual del desglose enlazan a `#registros-pdtp`, ancla sobre la tabla de actividades/ejecuciones ya presente en la misma pagina.

### 6.2 Bandeja de trabajo

- [x] Crear vista “Esta semana” con programadas, disparadas, vencidas y pendientes de evidencia. Incremento BLD-07: `/prevencion/pdtp/obligaciones` ya cubria disparadas/a demanda y vencidas; se agregaron dos secciones nuevas reusando servicios ya existentes: "Programadas esta semana" (`findPdtpWeeklyPending`, filtrado al alcance del usuario antes de mostrarse) y "Pendientes de evidencia o aprobación" (`listPendingPdtpExecutions`, ya scope-aware). Las cuatro dimensiones conviven en una sola pagina, con un cuarto KPI ("Programadas esta semana") que respeta el limite de cuatro KPIs accionables; no se fusionaron en una sola lista filtrable porque son tipos de dato heterogeneos (obligaciones vs. ejecuciones programadas).
- [x] Mostrar primero estado del trabajo y accion esperada; maximo cuatro KPIs accionables.
- [x] Mantener filtros primarios acotados y mover el resto a “Mas filtros”.
- [x] Incorporar estados vacios con explicacion y CTA real.
- [x] Usar el buscador del TopBar y `PageHeader`/`PageContainer` segun las reglas del repositorio.
- [x] Mostrar textos de estado en espanol y tooltips para abreviaturas de rol. Los estados ya estan en espanol; se agrego un glosario de abreviaturas (JDPR, PRF, CPHS, RRHH) como `title` en `LifecycleStep`, sin acoplar la logica de negocio a esos codigos.

### 6.3 Recordatorios

- [x] Extender el job semanal para obligaciones a demanda/disparadas y pendientes de evidencia.
- [x] Deduplicar por obligacion, destinatario y ventana de recordatorio.
- [ ] Respetar faena, rol, suplencias y preferencias de notificacion. Faena/rol ya se resuelven vía `getUserIdsWithPermissionForWorksite`; faltan suplencias y preferencias de notificacion por usuario.
- [ ] No enviar recordatorio de una actividad ya acreditada por integracion. No verificable aun: las integraciones automaticas de Fase 5 no existen.

### 6.4 Reporte de gestion

- [x] Exportar Excel con objetivos, avance, desviaciones y responsables usando la estructura que mejor comunique la gestion, no la distribucion del archivo de origen. Incremento BLD-08: `GET /api/prevencion/pdtp/reporte-gestion`, resumen agrupado por objetivo (no por hoja/actividad), hoja separada de definicion de indicadores; nada de la estructura de 8 hojas/48 semanas del archivo 2026.
- [x] Permitir cortes por faena, periodo, responsable, objetivo y estado dentro del alcance autorizado. Filtros `faena` (obligatorio, fail-closed igual que el export existente), `desde`/`hasta` (mes), `responsable` (slug), `objetivo` (numero) y `estado` (`meets`/`deviates`).
- [x] Incluir definicion de cada indicador y permitir navegar desde el resumen a sus registros. Definicion en la hoja "Indicadores" del Excel y en un `<details>` de la pantalla. Navegacion: cada fila enlaza al detalle del programa con la faena correcta (`#registros-pdtp`); sigue llegando a la vista general del programa, no a un recorte exacto por ese objetivo especifico (el detalle del programa no tiene filtro por objetivo todavia).
- [x] Mantener consistencia entre valores de pantalla y exportacion. Nueva pantalla `/prevencion/pdtp/[programId]/reporte` (Server Component) llama al mismo `getPdtpManagementReport` con los mismos filtros que la exportacion Excel, y el boton "Descargar Excel" de esa pantalla arma la URL del export con los filtros activos — mismo servicio, mismos valores, un solo lugar donde se calculan.

### 6.5 Expediente auditor

- [x] Generar ejecuciones, fuentes, evidencias, obligaciones a demanda, acciones, seguimientos, aprobaciones y cambios. Incremento BLD-09: `getPdtpAuditDossier` agrega las ocho categorias en un solo llamado (reusando `listPdtpObligations`, `listActionsByProgram`, `listFollowups`, `getPdtpApprovalProgress` ya existentes) y `GET /api/prevencion/pdtp/expediente-auditor` las exporta en ocho hojas Excel.
- [x] Incluir actor, timestamps, faena, estado, digest, lote de importacion y motivos de excepcion. Hoja "Programa" con digest/version/estado; cada hoja de detalle lleva actor y fecha por fila; hoja "Lotes de importación" con adaptador/checksum/motivo de cancelacion; motivos de excepcion (overrides) via la hoja "Cambios" (bitacora `pdtp_change_log`, ya conserva motivo por evento `override:<actividad>` desde GOV-OVR-01).
- [x] No exponer URLs temporales vencidas ni rutas internas; usar identificadores y mecanismo seguro de descarga. La hoja de ejecuciones nunca incluye `evidenceUrl`/`evidenceText` crudos, solo un booleano "Con evidencia" y el ID de ejecucion (navegable dentro de la app con la autorizacion del visitante). Mismos headers seguros que el resto de exports PDTP (`Cache-Control: no-store`, `X-Content-Type-Options: nosniff`).
- [x] Registrar la generacion del expediente en auditoria. Mismo patron de `recordAudit` en los cuatro desenlaces (success/denied/invalid/error) que el resto de exports del modulo.

### 6.6 Adaptador opcional de compatibilidad 2026

- [ ] Confirmar primero si existe una necesidad operacional o contractual de seguir intercambiando el formato RE-36.
- [ ] Si existe, generar las ocho hojas, 48 semanas y P/E desde el modelo general mediante una plantilla versionada.
- [ ] Mantener este codigo aislado del constructor y de las reglas generales del programa.
- [ ] Definir una politica idempotente para reimportar valores E solo si el round-trip es una necesidad real.
- [ ] Si no existe esa necesidad, limitar el adaptador a importacion historica y no invertir en replicar merges, logos o maquetacion.

### Pruebas obligatorias

- [x] Indicadores con dos faenas y usuarios de alcance distinto. Cubierto por `getPdtpComplianceIndicatorsForScope aggregates approved executions across authorized worksites...` (incremento BLD-06): ejecuciones en `ws-1` y `ws-2`, indicador sin faena en 0, indicador agregado con las dos sumando correctamente.
- [x] Navegacion KPI -> registros coincide exactamente con numerador/denominador. Cerrado en BLD-12: el enlace "Ver registros" del reporte de gestión agrega `&objetivo=<objectiveOrder>`; `PdtpSheetTable` acota actividades, contadores de estado y agrupación a ese objetivo, con aviso "Mostrando solo el objetivo N" y enlace para quitar el filtro.
- [x] Test del “sin casos”, sobrecumplimiento, atraso y evidencia pendiente. `on_demand`/`triggered`: `operates triggered obligations idempotently, separates sin casos and closes only after approval` prueba `no_cases`, `with_cases`, `overdue` y el rechazo por evidencia faltante. Sobrecumplimiento (`scheduled`) cerrado en BLD-11: `compliance.ts` dejo de capar `executed` a `Math.min(executed, planned)` en el agregado — ahora conserva el real (`percent` puede superar 1); test `shows overcompliance in full instead of silently capping the aggregate to the planned quantity (principio 5.2)` en `prevention-pdtp.test.ts`.
- [ ] Pruebas de accesibilidad, responsive y test de los cinco segundos con usuarios de rol.
- [x] Ninguna salida contiene datos fuera del scope solicitado.
- [x] Excel/LibreOffice abre los Excel generados sin reparaciones ni formulas inyectadas desde texto de usuario. Verificado en BLD-12: pruebas de round-trip (reabren el buffer real con ExcelJS fresco) para `buildXlsxBuffer` (exportador compartido de toda la app, no solo PDTP), `reporte-gestion` y `expediente-auditor`. Confirmado que texto de usuario con apariencia de fórmula (`=SUM(...)`, `+2+5`) nunca se guarda como celda de fórmula evaluable (`cell.type !== Formula`) — ExcelJS no interpreta strings planos como fórmulas salvo que se seteen explícitamente como `{formula: ...}`, y los builders de PDTP ya escapaban ese texto con `safe()` desde incrementos anteriores.
- [x] La creacion y operacion completa funcionan aunque el adaptador RE-36 este deshabilitado. Cierto por construccion: 6.6 no esta implementado (no existe codigo de adaptador RE-36 en el repositorio), y la suite completa de Fases 1-6 (creacion de programas, ciclo de vida/firma, importacion, bandeja, recordatorios, reporte de gestion, expediente auditor) pasa sin ninguna dependencia hacia ese adaptador. No hay una "operacion con RE-36 habilitado" que comparar todavia; se revalida cuando 6.6 exista.

---

## Fase 7 — Migracion, marcha paralela y puesta en produccion

**Objetivo:** demostrar que Chome puede operar el programa real sin perder control ni depender de supuestos del entorno local.

### 7.1 Preparacion

- [x] Identificar el archivo vigente definitivo y congelar su hash. Hecho 2026-07-22: `PROGRAMA ACTIVIDADES PREVENTIVAS DEL SG-SST (87 actividades).xlsx`, 3.821.479 bytes, SHA-256 `55b780b9…`, congelado en `PDTP_2026_PROGRAM_SOURCE` y validado por `bootstrap-pdtp-2026.ts`.
- [ ] Inventariar programas, ejecuciones, evidencias y acciones existentes en produccion/SFTI/Excel.
- [ ] Definir por escrito el mapeo de personas y faenas.
- [ ] Ejecutar migracion en staging con copia anonimizada o entorno controlado.
- [ ] Reconciliar conteos y muestras por cada una de las ocho hojas.
- [ ] Probar restore de base y rollback del lote antes de tocar produccion.

### 7.2 Migracion productiva

- [ ] Abrir ventana controlada y respaldo verificado.
- [ ] Ejecutar dry-run y guardar resultado.
- [ ] Aplicar migraciones Drizzle con `db:migrate`; ejecutar `db:generate` de verificacion y exigir `No schema changes`.
- [ ] Ejecutar bootstrap/importacion como usuario tecnico identificado.
- [ ] Reconciliar 8/87/8, 821, 1.013, seis E y hashes del programa.
- [ ] Ejecutar pruebas de humo por prevencionista, JDPR, Legal, responsable de faena y usuario sin acceso.
- [ ] Exportar reporte de gestion y expediente inicial; agregar la salida RE-36 solo si la decision de compatibilidad la exige.

### 7.3 Marcha paralela

- [ ] Operar al menos un ciclo mensual completo en Chome y el mecanismo anterior.
- [ ] Comparar semanalmente P, E, actividades a demanda, evidencias y acciones.
- [ ] Registrar toda diferencia con causa, correccion y responsable.
- [ ] Probar recordatorios y cierres con casos reales controlados.
- [ ] No retirar el Excel/SFTI hasta que las diferencias criticas sean cero.

### 7.4 Aceptacion y cutover

- [ ] Acta de Jefatura de Prevencion sobre catalogo, ejecuciones e indicadores.
- [ ] Acta de Legal sobre ciclo de aprobacion, version y expediente.
- [ ] Aceptacion de al menos una faena piloto y una segunda faena de contraste.
- [ ] Evidencia negativa rol × faena × endpoint anexada.
- [ ] Plan de soporte, responsables y SLA de incidentes del primer mes.
- [ ] Fecha y criterio de retiro del mecanismo anterior, con acceso de solo lectura al historico.

### Criterio de rollback

Se revierte el cutover si ocurre cualquiera de estos casos:

- fuga o mezcla de datos entre faenas;
- diferencia no explicada en P/E o perdida de evidencia;
- firma sobre un digest diferente del contenido activo;
- imposibilidad de demostrar o reconciliar el programa y sus ejecuciones con la fuente migrada;
- fallas repetidas que impiden registrar trabajo dentro del plazo operacional.

El rollback debe restaurar datos y operacion, no solo desplegar una imagen anterior. Se deben conservar los eventos creados durante la ventana para reconciliarlos despues.

---

## 8. Orden de cambios de datos propuesto

La estructura exacta debe confirmarse al implementar, pero el orden seguro es:

1. Separar plantilla reusable, programa versionado, actividad, programacion, obligacion y ejecucion sin romper lecturas actuales.
2. Agregar version/digest/estado de revision al programa.
3. Crear historial de versiones/aprobaciones y backfill conservador.
4. Modelar audiencias y vistas guardadas como proyecciones, no como copias de actividades.
5. Agregar `scheduleMode`, recurrencia, disparador y SLA a actividades/obligaciones.
6. Crear lotes y staging de importacion como adaptador hacia el modelo general.
7. Agregar metadatos configurables y control de cambios.
8. Crear o ampliar bindings tipados e idempotency keys.
9. Migrar servicios y lecturas al nuevo modelo.
10. Activar constraints y unicidades solo despues de reconciliar backfill.
11. Retirar campos/semantica legada en una migracion posterior, nunca en el mismo despliegue que introduce el modelo.

### Reglas de backfill

- Programas `active` existentes se consideran version 1 y requieren snapshot calculado con reporte de cualquier ambiguedad.
- Firmas existentes sin digest se marcan como `legacy_unverified`; no se presentan como equivalentes a una firma nueva.
- El catalogo 2026 se convierte en una plantilla identificable; no se replica como logica fija en cada programa.
- Las membresias de hojas se convierten en audiencias/vistas de esa plantilla.
- Actividades con plan semanal pasan a `scheduled`.
- Actividades sin cantidades no se clasifican automaticamente como `on_demand` en produccion sin validar la matriz 1–89.
- Enlaces actuales MIPER/legal se migran conservando IDs y auditoria.
- No se agregan defaults que conviertan ausencia de faena en acceso global.

---

## 9. Estrategia de pruebas y evidencia

## 9.1 Piramide minima

| Nivel | Cobertura requerida |
|---|---|
| Unitario | Parser P/E, digest canonico, estados, indicadores, denominadores e idempotencia |
| Servicio | Scope SQL, transiciones, import apply/rollback, bindings, anulaciones y auditoria |
| PostgreSQL | Constraints, concurrencia, cascadas controladas, transacciones y backfill |
| Route/API | Autenticacion, permisos, faena omitida/ajena, MIME, headers y archivos |
| UI | Constructor por pasos, borradores, recurrencias, preview/diff, aprobaciones, bandeja, textos largos, estados vacios y contexto de faena |
| E2E | Crear desde cero/plantilla/copia -> revisar -> aprobar -> activar -> ejecutar -> reportar; importacion se prueba como camino adicional |
| Operacional | Reconciliacion con archivo real, marcha paralela y actas de aceptacion |

## 9.2 Casos de regresion que deben permanecer

Producto general:

- [x] Crear un programa distinto al 2026 desde cero, plantilla y copia sin cambiar codigo.
- [x] El constructor no exige hojas ni una grilla semanal fija.
- [x] Plantilla, programa, obligacion y ejecucion conservan limites claros. Plantilla↔programa por `publishes immutable template versions and materializes each program from the selected snapshot`; obligacion↔ejecucion por `operates triggered obligations idempotently…`; y programa/plan↔ejecucion por `mantiene los limites programa/plan/ejecucion: acreditar una ejecucion no muta el plan ni el contenido firmado` (`prevention-pdtp.test.ts`).
- [x] Copiar un programa no copia ejecuciones, evidencias ni firmas.
- [x] Vistas por audiencia no duplican actividades. Cubierto por `audiences (sheet memberships) reuse the same 89 activities instead of duplicating rows per view` (`prevention-pdtp.test.ts`).
- [x] Recurrencias y disparadores producen obligaciones explicables. Cubierto por `pdtp-recurrence.test.ts` (8 casos, incluido `shows the obligation impact before changing an existing recurrence`) y `operates triggered obligations idempotently, separates sin casos and closes only after approval`.
- [x] Textos largos 37/38/43/51/52 editables. Cubierto por `round-trips the five long 2026 activities without swapping or truncating their meaning` (`prevention-pdtp.test.ts`).
- [x] Un usuario no puede aprobar dos roles incompatibles.
- [x] Una mutacion cambia el digest e invalida/rechaza la aprobacion.
- [x] Omision de faena nunca amplia alcance.
- [ ] Un evento operacional acredita una sola ejecucion.

Adaptador de migracion 2026:

- [x] 8 objetivos, 89 actividades y 8 vistas derivadas.
- [x] 843 celdas P y total 1.035.
- [x] 22 actividades sin P numerico.
- [x] Seis cantidades E conservadas.
- [x] Membresias exactas de cada vista importada.
- [ ] Si se habilita round-trip 2026, exportar/reimportar produce diff vacio para el alcance soportado.

## 9.3 Matriz negativa de autorizacion

Debe incluir, como minimo:

- roles: sin permiso, prevencionista de una faena, jefatura, Legal y administrador;
- recursos: programa propio, programa compartido autorizado y programa/faena ajenos;
- endpoints: vista, ejecucion, evidencia, reportes/exportaciones, expediente, importacion, preview, apply, aprobacion y activacion;
- variantes: sin faena, faena invalida, faena ajena, lista vacia de alcance y consolidado solicitado;
- resultado esperado: codigo HTTP, ausencia de datos y evento de auditoria cuando corresponda.

Probar solo que el boton no aparece no es evidencia suficiente. La denegacion debe verificarse contra el servicio y la ruta real.

## 9.4 Evidencia de cierre por fase

Cada fase debe adjuntar:

- commit(s) o diff de alcance;
- migraciones generadas y verificacion posterior;
- comandos y resultados de pruebas;
- conteos de base antes/despues;
- capturas o Excel de muestra cuando aplique;
- riesgos residuales y decisiones pendientes;
- nombre y fecha de quien acepta el gate.

---

## 10. Decisiones de negocio que deben cerrarse

Estas preguntas no bloquean el inicio de seguridad y diseño del constructor, pero si bloquean el cierre funcional:

1. ¿Quienes pueden crear y publicar plantillas reutilizables?
2. ¿Un programa cubre una faena, varias faenas o permite una base corporativa con excepciones locales?
3. ¿Que campos son obligatorios para guardar borrador y cuales solo para enviar a aprobacion?
4. ¿La aprobacion Legal es obligatoria para todos los programas o depende del tipo/contrato?
5. ¿Quien puede elaborar, aprobar JDPR, aprobar Legal y activar en cada faena?
6. ¿Se permitira override de segregacion en emergencia? Si se permite, ¿con que segunda aprobacion?
7. ¿A que faena corresponden las seis cantidades E del archivo entregado y que evidencia historica existe?
8. ¿Cuales de las 22 actividades son a demanda y cuales nacen de un disparador identificable?
9. ¿Como se calcula el indicador para obligaciones a demanda sin casos?
10. ¿Se necesita seguir intercambiando exactamente el formato RE-36 o basta importar el legado y emitir reportes nativos?
11. Si el formato RE-36 sigue siendo necesario, ¿se requiere por faena, consolidado o ambos?
12. ¿Cual es el periodo minimo de marcha paralela y quien firma el cutover?

Las respuestas deben registrarse como decisiones en este documento o en un ADR enlazado; no deben quedar solo en conversaciones.

---

## 11. Estimacion, dependencias y paralelismo seguro

La estimacion debe afinarse tras Fase 0, pero el orden relativo es obligatorio:

| Bloque | Dependencias | Puede avanzar en paralelo con |
|---|---|---|
| Fase 0 | Ninguna | Diseno de seguridad y entrevistas de autoría |
| Fase 1 | Reglas minimas de alcance/gobierno | Arquitectura y prototipo del constructor |
| Fase 2 | Conceptos de dominio de Fase 0 y ciclo de vida definido | Parser/staging de migracion |
| Fase 3 | Modelo general estable | Clasificacion de modos y matriz 1–89 |
| Fase 4 | Constructor y obligaciones base | Integraciones piloto |
| Fase 5 | Bindings, modos y scope cerrados | Reportes y bandeja |
| Fase 6 | Semantica de indicadores cerrada | Preparacion de rollout |
| Fase 7 | Todas las fases y gates tecnicos | Ningun desarrollo estructural pendiente |

No se debe resolver primero la apariencia del Excel ni construir la UX alrededor de sus celdas. La secuencia prioriza seguridad y un modelo general; despues usa el archivo para validar que un caso real puede migrarse sin perdida.

---

## 12. Definicion de terminado

El ajuste integral se considera terminado solo si se cumplen todos estos puntos:

- [ ] Un prevencionista puede crear un programa desde cero, una plantilla o el periodo anterior sin conocer el Excel.
- [x] El mismo constructor admite un programa diferente al 2026 sin cambios de codigo.
- [ ] Plantillas, programas, obligaciones, ejecuciones y vistas derivadas tienen limites claros y probados.
- [x] Las recurrencias simples no requieren editar una matriz semanal; la configuracion avanzada sigue disponible cuando aporta valor.
- [x] El archivo fuente 2026 y su hash estan identificados como evidencia de migracion.
- [ ] La importacion preserva 8/87/8, 821, 1.013 y los metadatos acordados al traducirlos al modelo general.
- [ ] Las seis cantidades E estan migradas/reconciliadas o exceptuadas formalmente.
- [ ] Las 22 actividades a demanda/disparadas tienen modelo, SLA, evidencia e indicador aceptados.
- [ ] Los cinco textos largos pueden importarse, editarse y exportarse completos.
- [x] `PROGRAMA` y `ACTIVIDAD` se traducen correctamente al lenguaje claro del dominio sin imponer esos encabezados a la UI.
- [ ] Las ocho hojas 2026 se reconstruyen como vistas derivadas, no como copias o restricciones del programa.
- [ ] El expediente auditor contiene fuentes, evidencias, acciones, firmas, cambios e importaciones.
- [ ] La necesidad de compatibilidad RE-36 esta decidida; si fue requerida, el adaptador se valida separado del constructor.
- [x] JDPR y Legal no pueden ser la misma persona; ninguna firma sobrevive a un cambio de contenido.
- [x] Ninguna ruta o exportacion amplia alcance por omitir faena.
- [ ] Las 87 actividades de la plantilla 2026 tienen una matriz fuente/evento/cantidad/evidencia aprobada, implementada mediante reglas reutilizables.
- [ ] Integraciones automaticas son idempotentes y reversibles ante anulacion.
- [ ] Indicadores muestran faena/agregado y denominadores sin ambiguedad.
- [ ] La base objetivo fue migrada y reconciliada con datos reales.
- [ ] La matriz negativa rol × faena × endpoint esta aprobada.
- [ ] Se completo un ciclo mensual de marcha paralela sin diferencias criticas.
- [ ] Jefatura de Prevencion, Legal y faenas piloto firmaron la aceptacion.
- [ ] Existe rollback probado y runbook operativo.

Pasar pruebas unitarias o tener las tablas creadas no basta para marcar el plan como terminado.

---

## 13. Bitacora viva de ejecucion y hallazgos

Esta seccion debe mantenerse durante la implementacion. Un hallazgo nuevo P0 detiene el gate de la fase; uno P1/P2 se incorpora con responsable y fecha, no se deja implicito.

| Fecha | Hallazgo/decision | Severidad | Fase | Responsable | Estado | Evidencia |
|---|---|---|---:|---|---|---|
| 2026-07-21 | Catalogo JSON coincide con el Excel: 8/89/8, 843 y 1.035. | Control | 0 | Por asignar | Verificado en revision | Archivo y catalogo |
| 2026-07-21 | El producto debe ser un constructor de programas; el Excel es referencia/migracion, no interfaz objetivo. | P0 producto | 2 | Por asignar | Incorporado al plan | Aclaracion de producto |
| 2026-07-21 | Se creo `PRODUCT.md` con registro `product`, usuarios, proposito, anti-referencias, principios y accesibilidad para gobernar el constructor. | Control de producto | 0 | Codex | Completado | `PRODUCT.md` + `DESIGN.md` |
| 2026-07-21 | La base local no contiene programas ni catalogos PDTP. | P0 operacional | 3 | Por asignar | Abierto | Conteos DB local |
| 2026-07-21 | Importacion omite seis cantidades E del archivo. | P0 | 3 | Por asignar | Abierto | Celdas E identificadas |
| 2026-07-21 | Exportacion sin faena puede incluir acciones de otras faenas. | P0 | 1 | Codex | Cerrado tecnicamente | Ruta, servicio y pruebas negativas SEC-01A |
| 2026-07-21 | Misma identidad puede firmar JDPR y Legal. | P0 | 1 | Codex | Cerrado para plantilla 2026 | Servicio rechaza elaborador = JDPR y JDPR = Legal |
| 2026-07-21 | Firmas no estan vinculadas a hash y sobreviven cambios. | P0 | 1 | Codex | Cerrado tecnicamente | Digest SHA-256, snapshot, version y guardas de mutacion |
| 2026-07-21 | Checklists y vinculos de origen podian mutar contenido sin verificar el estado del programa. | P0 | 1 | Codex | Cerrado | Guarda central + prueba de seis superficies de mutacion |
| 2026-07-21 | Reimportacion borra por cascada contenido asociado. | P1 alta | 3 | Por asignar | Abierto | Servicio de importacion |
| 2026-07-21 | Cinco campos oficiales exceden validacion de 200 caracteres. | P1 | 4 | Por asignar | Abierto | Actividades 37/38/43/51/52 |
| 2026-07-21 | 22 actividades sin P carecen de modo a demanda/disparado. | P1 alta | 4 | Por asignar | Abierto | Matriz semanal del Excel |
| 2026-07-21 | Integraciones estructuradas cubren solo parcialmente MIPER/legal. | P1 alta | 5 | Por asignar | Abierto | Tipos de fuente y UI |
| 2026-07-21 | Las salidas de gestion, auditoria y compatibilidad RE-36 no estan separadas. | P1 | 6 | Por asignar | Abierto | Builder Excel actual |
| 2026-07-21 | Indicadores de lista carecen de contexto de faena confiable. | P1 alta | 6 | Por asignar | Abierto | Pagina + compliance service |
| 2026-07-21 | Exportacion PDTP ahora falla cerrada: deriva la unica faena autorizada, exige seleccion si el alcance es ambiguo, rechaza faena ajena, propaga scope y audita la descarga. | P0 | 1 | Codex | Cerrado | 8 pruebas de ruta + prueba PGlite con dos faenas |

### Plantilla para cada incremento

```markdown
### YYYY-MM-DD — Incremento <ID>

- Alcance implementado:
- Archivos/migraciones:
- Pruebas ejecutadas:
- Evidencia de datos:
- Hallazgos nuevos:
- Riesgos residuales:
- Gate de fase: aprobado / rechazado
- Aprobado por:
```

---

## 14. Primer incremento recomendado

El primer incremento debe ser pequeño, desplegable y orientado a eliminar riesgo:

1. agregar pruebas que reproduzcan exportacion sin faena y mezcla de acciones;
2. cerrar el alcance de exportacion de extremo a extremo;
3. agregar pruebas que rechacen una misma identidad para JDPR y Legal;
4. introducir version/digest y congelamiento de contenido antes de aprobar;
5. impedir edicion, reimportacion y borrado despues de entrar a revision;
6. ejecutar pruebas focalizadas, PostgreSQL, typecheck y build si cambia una frontera App Router;
7. actualizar esta bitacora con evidencia y riesgos residuales.

El incremento inmediatamente siguiente debe ser una tajada vertical del constructor: crear desde cero o plantilla, definir datos basicos, un objetivo, actividades con recurrencia simple, revisar y guardar borrador. Debe probarse con un programa que no sea el 2026 para demostrar que el modelo no depende del Excel.

Solo despues debe avanzarse al lote de importacion y a la migracion de las cantidades E. Asi se evita cargar informacion oficial en un flujo que todavia no garantiza aislamiento, firmas correspondientes al contenido activo ni una experiencia de autoría realmente mejor que la planilla.

### 2026-07-21 — Incremento SEC-01A

- Alcance implementado: cierre fail-closed del endpoint de exportacion PDTP por faena.
- Archivos/migraciones: `app/api/prevencion/pdtp/export/route.ts`, `lib/services/pdtp/sheets.ts`; sin migracion.
- Pruebas ejecutadas: `app/api/prevencion/pdtp/export/route.test.ts`, 16/16 aprobadas tras incorporar la matriz explicita; caso PGlite `keeps action-plan export rows inside the selected worksite and caller scope`, aprobado; `npm run typecheck`, aprobado.
- Evidencia de datos: `buildPdtpExport` recibe `worksiteId` obligatorio y `scope`; planes de accion y seguimientos usan ambos filtros.
- Hallazgos nuevos: ninguno en este incremento despues de agregar auditoria y prueba de dos faenas.
- Riesgos residuales: el producto no ofrece consolidado multifaena; se mantiene bloqueado deliberadamente hasta definir permiso y semantica explicitos.
- Gate de fase: SEC-01 cerrado; la Fase 1 sigue abierta por GOV-01 a GOV-04.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento GOV-01A/GOV-02A/GOV-03A/GOV-04A

- Alcance implementado: separacion entre envio y decision JDPR; estado `in_review`; version, snapshot y digest SHA-256; firma Legal sobre la misma huella; activacion por compare-and-set; rechazo, reapertura versionada y archivo con motivo; reintentos idempotentes; bloqueo central de programa, actividades, cronograma, vistas, checklists, vinculos de origen, reimportacion y borrado.
- Archivos/migraciones: `db/schema/prevention/pdtp.ts`, `lib/services/pdtp/content-digest.ts`, `lib/services/pdtp/lifecycle.ts`, guardas en servicios PDTP y riesgo/legal, acciones y controles de ciclo de vida; migraciones generadas `0096_zippy_warbound.sql` y `0097_mature_fallen_one.sql`.
- Pruebas ejecutadas: suite PGlite PDTP completa 35/35; UI, Server Actions y RBAC 48/48; `npm run typecheck`, aprobado; `npm run db:migrate`, aplicado en PostgreSQL local; `npm run db:generate`, resultado final `No schema changes`.
- Evidencia de datos: el snapshot canonico incluye metadatos, objetivos/actividades ordenadas, calendario, vistas, membresias, checklists y vinculos de origen; la activacion recalcula y compara la huella firmada.
- Hallazgos nuevos: las plantillas de checklist y los vinculos de cobertura no tenian una guarda de estado y podian alterar el contenido revisado; ambos quedaron incorporados a la guarda central y a la prueba negativa.
- Riesgos residuales: falta verificar asignaciones productivas de roles, completar la matriz negativa rol por faena por endpoint, definir el gobierno de un eventual sobrepaso de segregacion y exigir motivo/permiso dedicado a overrides operacionales.
- Gate de fase: GOV-01 a GOV-04 cerrados tecnicamente en el checkout y base local; gate productivo de Fase 1 aun rechazado por los riesgos residuales anteriores.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento GOV-01B

- Alcance implementado: motor general de aprobaciones ordenadas y configurables por programa/plantilla; permisos por paso; reglas `not_elaborator`, `different_from_previous` y `different_from_step:<codigo>`; decisiones inmutables ligadas a version y digest; controles de interfaz derivados del flujo configurado. JDPR y Legal son ahora la configuracion inicial 2026 y no el limite del producto.
- Archivos/migraciones: `db/schema/prevention/pdtp.ts`, `lib/services/pdtp/approval-flow.ts`, `lib/services/pdtp/content-digest.ts`, `lib/services/pdtp/lifecycle.ts`, `lib/services/pdtp/programs.ts`, acciones, pagina y control de ciclo PDTP; migracion generada `0098_material_darwin.sql`.
- Pruebas ejecutadas: suite PGlite PDTP ampliada a 37 casos, con pruebas focalizadas aprobadas para flujos de uno y tres pasos; el flujo inicial de dos pasos permanece cubierto por el ciclo 2026; UI, Server Actions, RBAC y endpoint focalizados aprobados; `npm run typecheck`, aprobado; `npm run db:migrate`, aplicado en PostgreSQL local; `npm run db:generate`, resultado final `No schema changes`.
- Evidencia de datos: cada decision conserva codigo, etiqueta, orden, permiso y reglas del paso, actor, resultado, version y digest aunque luego cambie la plantilla; las pruebas de uno, dos y tres pasos demuestran que la cantidad de aprobadores no esta fijada en codigo. La prueba de tres pasos rechaza decisiones fuera de orden, autofirma y reutilizacion del actor anterior, y solo activa con todas las firmas requeridas sobre la misma huella.
- Hallazgos nuevos: los campos JDPR/Legal pueden mantenerse temporalmente como espejos de compatibilidad sin gobernar el flujo; eliminarlos antes de adaptar reportes e historicos agregaria riesgo sin beneficio de producto.
- Riesgos residuales: no existe sobrepaso extraordinario de segregacion; si se habilita, debe incorporar permiso dedicado, motivo, reautenticacion y auditoria destacada. Las asignaciones efectivas de roles deben reconciliarse en el ambiente productivo antes del rollout.
- Gate de fase: motor configurable y matriz negativa aprobados en checkout; el gate productivo depende de sincronizar y reconciliar RBAC real.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento GOV-OVR-01

- Alcance implementado: excepciones operacionales de meta separadas de la administracion normal del programa mediante `prevention:pdtp:override:manage`; motivo obligatorio tanto al fijar como al retirar la excepcion; formulario explicativo y bitacora con estado anterior, estado nuevo, actor y motivo.
- Archivos/migraciones: `modules/prevention/manifest.ts`, `lib/validation/prevention-module/pdtp.ts`, `lib/services/pdtp/overrides.ts`, `app/(app)/prevencion/pdtp/actions.ts`, `app/(app)/prevencion/pdtp/pdtp-override-form.tsx`; sin migracion de datos.
- Pruebas ejecutadas: pruebas de Server Actions y RBAC 47/47; el caso PGlite de override fue aprobado dentro de la suite ampliada a 37 casos e incluye alta y eliminacion con verificacion del antes/despues y ambos motivos.
- Evidencia de datos: la bitacora `pdtp_change_log` conserva dos eventos `override:<actividad>` con cantidad y motivo de creacion, y cantidad previa y motivo de retiro.
- Hallazgos nuevos: la accion ya regresaba al detalle correcto del programa; se mantuvo ese comportamiento y se preservan hoja/faena y el error de validacion en la redireccion.
- Riesgos residuales: el permiso debe sincronizarse y sus asignaciones productivas deben verificarse antes del rollout; no sustituye el eventual permiso de sobrepaso de segregacion de firmas, que sigue deliberadamente ausente.
- Gate de fase: gobierno de overrides operacionales aprobado en checkout; Fase 1 tecnica cerrada, pendiente de verificacion productiva de roles.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento SEC-01B

- Alcance implementado: cierre verificable del contrato de exportacion para faena omitida, ambigua, ajena, inexistente/inactiva y global explicita; auditoria tambien en denegaciones y errores.
- Archivos/migraciones: `app/api/prevencion/pdtp/export/route.ts`, `app/api/prevencion/pdtp/export/route.test.ts`, validador `isActivePdtpWorksite` en el servicio; sin migracion.
- Pruebas ejecutadas: endpoint Excel 16/16, incluida tabla explicita de siete combinaciones rol × alcance × parametro; prueba PGlite multifaena incluida en la suite ampliada a 37 casos.
- Evidencia de datos: un usuario acotado no puede solicitar otra faena; un global debe elegir una faena existente y activa; toda llamada a `buildPdtpExport` recibe `worksiteId` y `scope`.
- Hallazgos nuevos: validar solo pertenencia al scope no basta para usuarios globales; se incorporo comprobacion de existencia/actividad antes de construir el reporte.
- Riesgos residuales: sincronizar permisos y ejecutar la misma matriz contra identidades y faenas productivas antes del corte.
- Gate de fase: Fase 1 cerrada tecnicamente; aceptacion productiva pendiente.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento EVD-00A

- Alcance implementado: contrato versionado del archivo fuente 2026 y generador determinista de fixture sanitizada, aislados como evidencia del adaptador y no como restricciones del constructor.
- Archivos/migraciones: `lib/services/pdtp-adapters/contract-2026.ts`, `scripts/generate-pdtp-2026-sanitized-fixture.ts`, `lib/__tests__/pdtp-2026-contract.test.ts`; sin migracion.
- Pruebas ejecutadas: contrato 2026 3/3; la fixture generada vuelve a pasar por el parser con 89 actividades, 843 celdas P y las ocho membresias exactas.
- Evidencia de datos: SHA-256 `a6adc0fa017a9972dde09e5abdddb399cfce23526332807a122e52bfd15690a4`, 4.513.110 bytes; seis E fijadas en M14, O15, G19, I19, K19 y M19; base local verificada con 0 programas, 0 actividades, 0 ejecuciones y 0 eventos PDTP antes del bootstrap.
- Hallazgos nuevos: la fixture puede conservar formulas y estructura logica sin copiar nombres de firmantes, logos ni maquetacion; el diccionario confirma que `PROGRAMA` es la descripcion principal y `ACTIVIDAD` la guia de ejecucion.
- Riesgos residuales: falta validar con usuarios reales las tareas y errores del proceso actual; el archivo fuente definitivo de produccion debe volver a congelarse y compararse antes del rollout.
- Gate de fase: evidencia tecnica de Fase 0 aprobada; validacion de usuarios pendiente.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento BLD-01A

- Alcance implementado: primera tajada vertical del constructor general. Un programa puede partir vacio, copiar otro periodo o materializar una version publicada de plantilla; el programa vacio crea una sola vista general y no las ocho hojas del Excel. El editor principal usa seis pasos, crea actividades dentro de objetivos, expresa frecuencia/a demanda/evento en lenguaje natural, previsualiza obligaciones, guarda el borrador de actividad localmente y deja la matriz de 48 semanas como opcion avanzada.
- Archivos/migraciones: esquema y validacion PDTP; `lib/services/pdtp/programs.ts`, `activities.ts`, `recurrence.ts`, `templates.ts` y `content-digest.ts`; formulario de creacion, constructor guiado y acciones; migraciones generadas `0099_wise_gladiator.sql` y `0100_tiny_bastion.sql`.
- Pruebas ejecutadas: recurrencia, formulario guiado, creacion y Server Actions 78/78; prueba PGlite focalizada de programa no-2026 y copia; prueba PGlite de versiones de plantilla inmutables aprobada; `npm run typecheck`, aprobado; migraciones 0099 y 0100 aplicadas en PostgreSQL local; `npm run db:generate`, resultado `No schema changes`.
- Evidencia de datos: la prueba crea un programa 2027 con objetivo 9 y texto largo, proyecta una recurrencia mensual en 12 obligaciones, copia estructura/checklist a 2028 sin ejecuciones y materializa plantillas v1/v2 en 2028/2029 sin mutacion retroactiva. Cada programa conserva modo de creacion, programa/version fuente y version de plantilla.
- Hallazgos nuevos: la creacion en blanco estaba acoplada a ocho hojas fijas y la copia no trasladaba todos los campos generales ni checklist; ambos supuestos quedaron eliminados. La plantilla debe guardar una fotografia completa, no consultar el programa fuente vivo al crear una instancia.
- Riesgos residuales: falta publicar la referencia 2026 como plantilla inicial mediante un flujo explicito; completar autosave de servidor y previsualizaciones por audiencia/faena; el modelo de recurrencia aun proyecta compatibilidad hacia el calendario anual legado.
- Gate de fase: Fase 2 parcialmente aprobada; no se considera cerrada hasta completar los riesgos residuales y validacion con usuarios.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento BLD-01B

- Alcance implementado: publicacion operativa de plantillas desde la revision del constructor; inventario de todas sus versiones con huella y programas consumidores; duplicacion de actividades y movimiento entre objetivos desde la lista de autoría.
- Archivos/migraciones: `pdtp_program_templates`, `pdtp_program_template_versions` y referencia fija desde `pdtp_programs`; servicios `templates.ts` y `activities.ts`; ruta `/prevencion/pdtp/plantillas`; acciones y controles del constructor; migracion generada `0100_tiny_bastion.sql`.
- Pruebas ejecutadas: prueba PGlite focalizada de plantilla v1/v2 inmutable y uso por programa, aprobada; prueba PGlite focalizada de copia/duplicacion/movimiento/edicion en lote, aprobada; formulario de creacion y constructor 39/39; suite PGlite completa 334/334; `npm run typecheck`, aprobado; `npm run db:migrate`, aplicado en PostgreSQL local; `npm run db:generate`, resultado `No schema changes`.
- Evidencia de datos: cada version guarda snapshot canonico y digest; la instancia consulta esa foto, no el programa fuente vivo. La prueba modifica la fuente despues de v1, crea un programa desde v1, publica v2 y demuestra que el programa previo conserva texto, recurrencia y 12 obligaciones originales. La duplicacion conserva cronograma, vista y checklist, pero no crea ejecuciones ni decisiones.
- Hallazgos nuevos: mostrar solo la plantilla actual no permite auditar adopcion ni impacto; el inventario conserva versiones anteriores y enlaza cada programa a la version exacta usada.
- Riesgos residuales: falta autosave de servidor para el programa completo y previsualizacion cruzada por faena/responsable/audiencia. La referencia 2026 aun no se publica porque hacerlo correctamente depende del staging lossless y del mapeo aceptado de ejecuciones E.
- Gate de fase: autoría general y versionado aprobados tecnicamente; Fase 2 sigue abierta por los riesgos residuales y pruebas con usuarios de dos faenas.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento IMP-SEC-01

- Alcance implementado: endurecimiento fail-closed del archivo de entrada antes de ExcelJS. El importador acepta solo `.xlsx`, valida MIME permitido, firma ZIP, directorio central, cifrado, metodo de compresion, rutas internas, estructura minima, cantidad de entradas, expansion total/individual, numero de hojas y dimensiones maximas.
- Archivos/migraciones: `lib/services/pdtp/xlsx-security.ts`, pruebas unitarias, API de importacion y selector de archivo; sin migracion.
- Pruebas ejecutadas: seguridad Excel 4/4 para archivo real acotado, `.xls`, cuerpo corrupto, MIME invalido, expansion insegura y exceso de hojas; `npm run typecheck`, aprobado.
- Evidencia de datos: limites actuales de 15 MB comprimidos, 80 MB expandidos, 20 MB por entrada, 2.000 entradas, 32 hojas, 2.000 filas y 256 columnas por hoja.
- Hallazgos nuevos: el endpoint anterior aceptaba `.xls` aunque siempre usaba el lector Excel y entregaba el ZIP a ExcelJS sin validar expansion ni cifrado.
- Riesgos residuales: cerrados posteriormente por `IMP-STG-01`; permanecen las pruebas negativas y mejoras de diff indicadas en ese incremento.
- Gate de fase: borde de archivo cerrado; Fase 3 rechazada hasta completar staging y migracion historica.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento IMP-PARSE-01

- Alcance implementado: el adaptador 2026 extrae por separado las columnas P y E, conserva para E actividad, mes, semana, cantidad y coordenada de origen, y lee metadatos auditables del encabezado y control de cambios sin trasladarlos al modelo general como campos obligatorios.
- Archivos/migraciones: `lib/services/prevention-pdtp-catalog.ts`, pruebas de catalogo y contrato 2026; sin migracion.
- Pruebas ejecutadas: regresion focalizada de catalogo/contrato aprobada dentro de 121/121 pruebas rapidas; suite PGlite completa 334/334; `npm run typecheck`, aprobado.
- Evidencia de datos: el archivo real produce exactamente 843 celdas P con total 1.035 y seis E en M14, O15, G19, I19, K19 y M19. Se extraen codigo RE-36, tipo de indicador, meta 0,9, periodicidad, propietario de medicion, nombres/cargos/fechas declarados y el registro de cambios disponible.
- Hallazgos nuevos: la formula del indicador no tiene valor legible en Z7 y se reporta como advertencia que requiere reconciliacion; una formula vacia no se inventa ni se presenta como dato valido.
- Riesgos residuales: falta extraer/reconciliar la leyenda completa de roles, reportar toda celda desconocida y ampliar el diff; staging y mapeo scoped de E quedaron cerrados posteriormente por `IMP-STG-01`.
- Gate de fase: parser P/E aprobado; Fase 3 permanece rechazada por staging, apply/rollback y reconciliacion historica.
- Aprobado por: pendiente.

### 2026-07-21 — Verificacion transversal del incremento

- Alcance verificado: constructor, plantillas, aprobaciones, alcance por faena, parser 2026 y borde Excel; manual operativo actualizado en `manual/prevencion/pdtp.md` para presentar el constructor como flujo principal.
- Pruebas ejecutadas: suite PGlite completa 334/334 antes de `0101`; seleccion rapida PDTP 121/121; caso PGlite de `0101` aprobado; ESLint focalizado sin observaciones; el typecheck estuvo verde antes de nuevos cambios EPP concurrentes y actualmente solo reporta errores de `admin/productos`; migraciones aplicadas y segundo `npm run db:generate` sin cambios.
- Build: Next compilo el bundle y termino TypeScript del alcance, pero el build global fallo al recolectar `/admin/productos/[id]` porque el cambio ajeno `app/(app)/admin/productos/actions.ts` exporta el objeto Zod `productVariantBatchSchema` desde un archivo `use server`. Cambios EPP posteriores agregaron ademas errores de typecheck documentados en `IMP-STG-01`; no se modifico ese trabajo.
- React Doctor: no reporto hallazgos en PDTP; los cuatro diagnosticos pertenecen a login, plantillas administrativas y migraciones historicas ajenas. El analisis de lint interno excedio 300 segundos, por lo que la evidencia de lint valida es la ejecucion ESLint focalizada anterior.
- Riesgo residual de verificacion: repetir `npm run build` cuando se corrija el export no-async del modulo EPP para obtener una evidencia global verde del mismo checkout.

### 2026-07-21 — Incremento IMP-STG-01

- Alcance implementado: lote de staging persistente e idempotente por programa/hash; preview sin mutacion; apply atomico; seis E visibles y mapeadas solo a faena autorizada; aceptacion motivada de ausencia de evidencia; procedencia, coordenada e idempotency key; snapshot previo y rollback bloqueado si existen cambios posteriores.
- Archivos/migraciones: `pdtp_import_batches`, `pdtp_import_rows`, procedencia/evidencia en ejecuciones y metadatos opcionales del programa; `lib/services/pdtp/imports.ts`; API y preview del constructor; migracion generada `0101_unusual_angel.sql`.
- Pruebas ejecutadas: caso PGlite focalizado aprobado para staging 8/89/8, 843, total P 1.035, seis E, preview sin actividades, rechazo sin faena, rechazo de alcance ajeno, apply, reintento sin duplicados y rollback total; ruta de importacion y seguridad Excel 9/9; ESLint focalizado aprobado; `npm run db:migrate`, aplicado; segundo `npm run db:generate`, `No schema changes`. El typecheck actual no reporta errores PDTP, pero sale 2 por errores concurrentes del asistente EPP en `admin/productos`.
- Evidencia de datos: las E se crean como `origin=xlsx_import`, `evidence_status=migrated_without_attachment` y conservan lote, hoja/celda, cantidad, actor de migracion, faena y texto explicito. El staging conserva archivo, MIME, tamaño, SHA-256, filas normalizadas, metadatos y advertencias.
- Hallazgos nuevos: un preview util requiere diferenciar la seleccion de faena del consentimiento de evidencia faltante; ambas guardas se repiten en el servicio y no dependen del boton.
- Riesgos residuales: ampliar el diff a cambios de calendario y conteos exactos de objetos que perderian relaciones; persistir cancelacion del lote; probar rollback ante fallo inyectado en la ultima fila y reimportacion conservando checklist/bindings; crear bootstrap/runbook.
- Gate de fase: staging/apply/rollback aprobado tecnicamente; Fase 3 sigue abierta por pruebas negativas restantes, bootstrap, decision del estado historico definitivo y reconciliacion productiva.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento IMP-CLS-01

- Alcance implementado: las actividades importadas sin cantidades P ya no se convierten silenciosamente en actividades a demanda confirmadas. Se guardan como `schedule_classification_status=needs_review`, el preview informa cuantas requieren decision, el constructor las destaca y al editarlas obliga a confirmar una modalidad comprensible. El servicio de ciclo de vida bloquea el envio a revision mientras exista una sola clasificacion pendiente, incluso si se omite la interfaz.
- Archivos/migraciones: `pdtp_activities.schedule_classification_status`; validacion, digest, copia de programa, plantillas, importacion y ciclo de vida; constructor y formulario de actividad; migracion generada `0102_quick_texas_twister.sql`. El apply de importacion tambien adquiere locks de lote y programa y toma el snapshot dentro de la misma transaccion para evitar una carrera entre preview, snapshot y escritura.
- Pruebas ejecutadas: seleccion rapida PDTP 65/65; contrato 2026 3/3; suite PGlite focalizada 45/45; `npx tsc --noEmit`, aprobado; `npm run db:migrate`, aplicado; segundo `npm run db:generate`, resultado `No schema changes`.
- Evidencia de datos: el archivo real materializa 67 actividades con modalidad confirmada y 22 con decision pendiente. La prueba demuestra que el staging no muta, el apply conserva checklist y vinculos, el reintento no duplica, el rollback restaura el estado previo y el envio a revision falla con las 22 pendientes; luego una actividad de prueba puede confirmarse como disparada y entrar a revision.
- Hallazgos nuevos: “sin P” es ausencia de informacion, no sinonimo de “a demanda”. La decision pertenece al constructor y debe quedar firmada en el digest; el adaptador solo puede señalar la ambiguedad.
- Riesgos residuales: el negocio debe decidir para las 22 actividades su modalidad, disparador, SLA, evidencia y regla de indicador. Falta el motor de obligaciones que materialice esas decisiones y el historial documental normalizado.
- Gate de fase: la ambiguedad ya no degrada datos ni aprobaciones; Fase 4 permanece abierta hasta clasificar las 22 actividades y operar obligaciones reales.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento IMP-STG-02/BTS-01

- Alcance implementado: cancelacion persistente de lotes antes del apply con motivo y actor; nuevo staging permitido despues de cancelar sin borrar el historial; preview ampliado con altas/bajas/cambios del calendario, reemplazos de vistas y relaciones conservadas; validacion estructural de los 48 pares P/E; bootstrap administrativo unico con estrategias `dry-run`, `stage`, `apply` y `rollback`.
- Bootstrap y gobierno: `scripts/bootstrap-pdtp-2026.ts` exige archivo, año, usuario real y estrategia de faena, valida el hash oficial salvo fixture compatible explicita, comprueba 8/89/8, 843, 1.035 y seis E, instala nueve checklist versionados e idempotentes y registra los artefactos para rollback. La publicacion como plantilla requiere `--publish-reference` y se bloquea mientras haya actividades `needs_review`.
- Archivos/migraciones: `lib/services/pdtp/imports.ts`, `lib/services/pdtp/checklist-templates-2026.ts`, `scripts/bootstrap-pdtp-2026.ts`, `manual/prevencion/pdtp-bootstrap-2026.md`, API/UI de importacion y migracion generada `0102_quick_texas_twister.sql`.
- Pruebas ejecutadas: cancelacion y restaging; preservacion de checklist/vinculos; rollback atomico ante conflicto tardio; archivo corrupto, hoja faltante y estructura alterada; ruta/API de cancelacion; bootstrap repetido sin duplicados y rollback de sus artefactos. `npm run db:migrate`, aplicado; verificacion Drizzle posterior a `0102`, `No schema changes`; typecheck y ESLint focalizado aprobados.
- Evidencia de seguridad: el comando deriva el alcance RBAC del usuario entregado y nunca usa `scope: all` para eludir autorizacion; rollback se bloquea si una plantilla fue usada o un checklist ya tiene instancias operacionales.
- Gate de fase: Fase 3 cerrada tecnicamente para la fixture y el archivo de referencia. La carga productiva, reconciliacion de datos reales y aceptacion permanecen en Fase 7.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento OBL-01

- Alcance implementado: motor general de obligaciones para actividades `on_demand` y `triggered`; origen manual o integrado, fuente tipada, clave idempotente, SLA, estados pendiente/vencida/reportada/completada/cancelada, evidencia minima, recordatorios deduplicados y cola acotada por faena.
- Integridad del flujo: solo un programa activo y una modalidad confirmada pueden crear obligaciones; el reporte crea una ejecucion asociada sin colisionar con la unicidad calendarizada; aprobar cierra la obligacion y rechazarla la devuelve a pendiente o vencida; cancelar exige motivo y no permite borrar una obligacion ya reportada/completada.
- Archivos/migraciones: `lib/services/pdtp/obligations.ts`, acoplamiento transaccional en `lib/services/pdtp/executions.ts`, tablas `pdtp_obligations` y `pdtp_obligation_reminders`, `pdtp_executions.obligation_id` y migracion generada `0103_massive_shiver_man.sql`.
- Pruebas ejecutadas: prueba PGlite focalizada aprobada para alcance negativo, reintento idempotente, vencimiento, recordatorio sin duplicacion, evidencia obligatoria, dos obligaciones en el mismo periodo, rechazo/cancelacion, cierre despues de aprobacion e indicador `no_cases`/`with_cases`; `npx tsc --noEmit` y ESLint focalizado, aprobados.
- Limite consciente: el motor ya materializa decisiones, pero no inventa la modalidad, disparador, SLA o evidencia de las 22 filas ambiguas del documento. Esas decisiones siguen pendientes de validacion de negocio antes de publicar la referencia.
- Gate de fase: capacidad tecnica de obligaciones aprobada; Fase 4 sigue abierta por la clasificacion de las 22 actividades, metadatos documentales y pruebas de fidelidad de textos.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento OBL-02

- Alcance implementado: exposicion operacional del motor de obligaciones (OBL-01) en la bandeja `/prevencion/pdtp/obligaciones` ("Trabajo por eventos") y extension del cron semanal. Se verifico en este incremento que ambas piezas ya existian sin commitear ni documentar; el trabajo de esta sesion fue auditarlas, corregir la navegacion desactualizada y confirmarlas con evidencia.
- Bandeja: `PdtpObligationsWorkbench` usa `PageHeader`/`PageContainer`, el buscador del TopBar (`useSafeShellHeader`), tres KPIs accionables (pendientes/vencidas/por aprobar) con filtro por click, filtros primarios acotados (estado + faena), y tres estados vacios distintos con CTA ("sin actividades operables", "sin casos" explicitamente no 0%/100%, "sin resultados con estos filtros"). Permite registrar, reportar y cancelar casos con motivo auditable.
- Recordatorios: `runPdtpObligationReminders` en `lib/services/pdtp/reminders.ts` extiende el cron a ventanas `due_7d`/`due_1d`/`overdue`, deduplica por `(obligationId, recipientUserId, reminderWindow)` en `pdtp_obligation_reminders` y por `dedupeKey` en `notifications`, y resuelve destinatarios por permiso+faena.
- Archivos: `app/(app)/prevencion/pdtp/obligaciones/{page.tsx,pdtp-obligations-workbench.tsx,actions.ts,actions.test.ts}`, `lib/services/pdtp/reminders.ts`, `app/api/cron/pdtp-weekly-reminders/route.ts`, `modules/prevention/manifest.ts` (permisos `submit_review`/`activate`/`lifecycle:manage`/`override:manage` y entrada de navegacion "Trabajo por eventos"); sin migracion nueva en este incremento.
- Correcciones de regresion encontradas y cerradas en esta sesion (ninguna tocaba el alcance de negocio de OBL-01/OBL-02, todas bloqueaban evidencia limpia):
  - `lib/__tests__/prevention-pdtp.test.ts` no importaba `getPdtpComplianceIndicators` en el test de importacion 2026 completa → rompia `npx tsc --noEmit` para todo el repo. Corregido; se aprovecho para quitar un import identico sin usar en otro test del mismo archivo (advertencia de ESLint preexistente).
  - La guarda de contenido firmado (GOV-01A) bloquea `savePdtpActivityChecklist`/`ensureDefaultChecklist` fuera de `draft`, tal como exige §6.2 del plan (el checklist es parte del digest firmado). `lib/__tests__/pdtp-checklist-action-plan.test.ts` seguia sembrando esas plantillas contra un programa `active` (8 pruebas fallando). Se corrigio el test: las dos pruebas que ejercitan las funciones guardadas ahora usan un programa `draft`; las seis que solo necesitaban una plantilla preexistente como precondicion siembran directo en la tabla (bypass del servicio), igual que ya hacia la prueba de constraint de unicidad del mismo archivo.
  - `lib/__tests__/navigation.test.ts` no reflejaba la nueva entrada "Trabajo por eventos"; corregido.
  - Litter de `.DS_Store`/`._.DS_Store` (ignorado por git, no rastreado) rompia `frozen-modular-migration.test.ts`; eliminado del working tree.
  - `app/(app)/admin/productos/actions.ts` (trabajo EPP concurrente, ajeno a PDTP) reexportaba `productVariantBatchSchema`, un valor no-funcion, desde un archivo `"use server"`; Next/Turbopack lo rechaza. Se extrajo el schema y sus subschemas privados a `app/(app)/admin/productos/actions/product-variant-batch.schema.ts` (sin `"use server"`) y se ajustaron los imports; `npx tsc --noEmit` y la suite `admin-productos.test.ts` (27/27) quedan verdes. Esto NO desbloquea el build completo: Turbopack tambien rechaza `export { createCategory, updateCategory } from "./actions/categories"` en el mismo archivo con "Only async functions are allowed to be exported in a 'use server' file", pese a que ambas funciones son `async`. Es un problema mas profundo del patron de barrel re-export de server actions en `admin/productos/actions.ts` (posiblemente una restriccion de Turbopack en esta version de Next sobre re-exportar entre archivos "use server"), no relacionado con PDTP y no investigado mas alla de aislar la causa exacta para no invertir presupuesto de esta sesion en el modulo EPP.
- Pruebas ejecutadas: `npx tsc --noEmit` limpio en todo el repo; `npm run db:generate` → `No schema changes`; suite completa `npx vitest run lib/__tests__/ "app/(app)/prevencion/"` → 204 archivos, 1993 pasadas, 168 skipped, 0 fallidas; `lib/__tests__/prevention-pdtp.test.ts` bajo `vitest.pglite.config.ts` → 49/49; `app/(app)/prevencion/pdtp/obligaciones/actions.test.ts` → 3/3; ESLint focalizado sobre los archivos tocados, sin hallazgos.
- Hallazgos nuevos: el build de produccion (`npm run build`) sigue roto, pero por una causa distinta y mas profunda a la documentada en la verificacion transversal anterior (`productVariantBatchSchema` ya no es la causa; el patron de barrel re-export en `admin/productos/actions.ts` si lo es). Es un hallazgo P1 fuera del alcance de este plan (modulo EPP), registrado aqui para que no se pierda.
- Riesgos residuales: build de produccion bloqueado por el barrel de `admin/productos/actions.ts` (fuera de alcance PDTP); la bandeja "Trabajo por eventos" cubre disparadas/a demanda y vencidas pero no unifica aun con las actividades `scheduled` de la semana ni con pendientes de evidencia (falta la vista "Esta semana" completa de §6.2); recordatorios no cubren suplencias ni preferencias de notificacion por usuario.
- Gate de fase: Fase 4 (obligaciones) y el punto 5 de la seccion 15 quedan tecnicamente cerrados para lo ya construido; Fase 6 avanza parcialmente (6.2/6.3) pero no se cierra.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento BUILD-01 (fuera de alcance PDTP, desbloqueo de evidencia)

- Alcance implementado: reparacion del build de produccion, roto desde antes de esta sesion por el modulo EPP (`admin/productos`), ajeno a PDTP pero bloqueante para obtener evidencia de build verde de todo el repo.
- Causa raiz real: `app/(app)/admin/productos/actions.ts` era un barrel que solo reexportaba (`export { x } from "./modulo"`) funciones ya declaradas `async` en archivos que a su vez tienen su propio `"use server"`. Declarar `"use server"` tambien en el barrel llevaba a Turbopack a rechazar el re-export con "Only async functions are allowed to be exported in a 'use server' file", pese a que las funciones si son `async`. La causa no era la firma de las funciones sino la directiva duplicada en un archivo que no define ninguna funcion propia.
- Correccion: se elimino la directiva `"use server"` de la primera linea de `app/(app)/admin/productos/actions.ts`; cada archivo re-exportado (`actions/categories.ts`, `actions/products.ts`, `actions/imports.ts`) conserva su propio `"use server"`, que es lo que realmente marca esas funciones como Server Actions.
- Pruebas ejecutadas: `npx tsc --noEmit` limpio; `npm run build` con cache `.next` limpio → build completo exitoso (exit 0), todas las rutas de `/prevencion/**` y `/admin/productos/**` compiladas; `npm run db:generate` → `No schema changes`; suite `lib/__tests__/` + `app/(app)/prevencion/` + `app/(app)/admin/` → 210 archivos, 2059 pasadas, 168 skipped, 0 fallidas.
- Hallazgos nuevos: ninguno adicional; el hallazgo de BLD/OBL-02 queda cerrado con esta correccion.
- Riesgos residuales: ninguno conocido sobre este punto especifico. Sigue pendiente que el propietario del modulo EPP revise si otros barrels del repositorio repiten el mismo patron (`"use server"` en un archivo que solo reexporta) antes de que vuelva a aparecer en otro modulo.
- Gate de fase: build de produccion verde para todo el repo; ya no bloquea evidencia de ninguna fase de este plan.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento BLD-02

- Alcance implementado: cierre de dos hallazgos de Fase 2 (2.1 y parcial 2.3). Se confirmo que la referencia 2026 ya se publica como plantilla editable por el mecanismo general (sin caso especial), y se elimino el enum/condicional fijo de ocho hojas/roles 2026 en las superficies generales que lo tenian: selector de vista y resolucion de vista por defecto en la pagina de detalle del programa, y nombre de hoja/validacion de codigo en el exportador Excel.
- Hallazgo encontrado: `app/(app)/prevencion/pdtp/[programId]/page.tsx` tenia un arreglo `SHEET_OPTIONS` fijo con las ocho hojas 2026 y una funcion `defaultSheetForRoles` con un switch de roles 2026, aplicados a **cualquier** programa — un programa distinto al 2026 (por ejemplo uno creado en blanco con una sola vista `pdtp_general`) mostraba en el selector siete vistas que no existen para ese programa. El exportador (`buildPdtpExport`/`sheets.ts`) tenia el mismo problema: `SHEET_EXPORT_NAMES[sheetCode]` devolvia `undefined` como nombre de hoja para un codigo fuera de los ocho conocidos, y la ruta `app/api/prevencion/pdtp/export/route.ts` validaba el parametro `hoja` contra un `Set` fijo de esos mismos ocho codigos, sustituyendo en silencio cualquier otro valor por `pdtp_general`.
- Correccion:
  - Se movieron `SHEET_META`, `SHEET_EXPORT_NAMES` y `ROLE_RESPONSIBLE_SLUGS` (vocabulario fijo 2026) de `lib/services/pdtp/constants.ts` a `lib/services/pdtp-adapters/sheet-meta-2026.ts`; `constants.ts` conserva solo `MONTH_LABELS`, que es generico. Se actualizaron los imports en `catalog.ts`, `helpers.ts`, `sheets.ts`, `imports.ts` y en el test `pdtp-role-scope.test.ts`.
  - `programs.ts`: el sheet unico por defecto de un programa en blanco ya no lee `SHEET_META.pdtp_general`; usa un literal generico propio (`area: "prevencion"`, `defaultScopeRoles: ["prevencionista","administrador"]`), sin depender del vocabulario 2026.
  - `[programId]/page.tsx`: el selector de vista y la resolucion de vista por defecto ahora leen `listPdtpProgramSheets(programId)` (ya existente, antes cargado solo para editores en `draft`) — se elevo esa carga a incondicional porque cualquier visitante necesita ver las vistas reales del programa. `defaultSheetForRoles` ahora elige, entre las vistas reales del programa, la mas especifica (menos roles en su `defaultScopeRoles`) que intersecta los roles del usuario, con fallback a `pdtp_general` o la primera vista.
  - `sheets.ts`: `getPdtpSheetViewByProgram`, `getPdtpSheetView` y el parametro `sheetCode` de `buildPdtpExport` se ampliaron de `PdtpSheetCode` a `string` (la resolucion interna, `resolveSheetForProgram`, ya operaba por codigo de texto contra la tabla `pdtpSheets`, sin condicionales por codigo). El nombre de hoja del export usa `SHEET_EXPORT_NAMES[sheetCode] ?? view.sheet.label`, cayendo al label real del programa cuando el codigo no es uno de los ocho de 2026.
  - `app/api/prevencion/pdtp/export/route.ts`: se elimino el `Set` fijo de ocho codigos; `normalizeSheetCode` ahora solo recorta el valor y usa `pdtp_general` si viene vacio, sin sustituir en silencio un codigo desconocido — un codigo que no exista para el programa resuelto falla mas abajo con el 500 auditado ya existente. No se toco ninguna logica de autorizacion/alcance de faena (`assertWorksiteAccess`, `isActivePdtpWorksite`, permisos, auditoria), deliberadamente, para no reabrir SEC-01.
- Pruebas ejecutadas: `npx tsc --noEmit` limpio; ESLint focalizado sobre los 10 archivos tocados, sin hallazgos; `npm run db:generate` → `No schema changes`; suite `lib/__tests__/` + `app/(app)/prevencion/` + `app/(app)/admin/` + `app/api/prevencion/` → 231 archivos, 2140 pasadas, 168 skipped, 0 fallidas; `app/api/prevencion/pdtp/export/route.test.ts` (matriz rol × faena × endpoint) → 16/16; `lib/__tests__/prevention-pdtp.test.ts` bajo `vitest.pglite.config.ts` → 49/49.
- Riesgos residuales: `imports.ts`/`catalog.ts` siguen importando el vocabulario 2026 desde su nueva ubicacion en el adaptador — correcto porque son el bootstrap/importacion 2026 operando, pero no se evaluo si conviene tambien reubicar esos archivos. `collectResponsibleCatalog` (`helpers.ts`) sigue siendo 2026-especifica (menciona el nombre del archivo Excel en una nota) pese a vivir en un archivo general; no se movio en este incremento por ser una funcion completa, no solo datos. Los cinco textos largos, el modelo de calendario/multifaena (2.3) y el autosave/preview (2.2) permanecen sin empezar.
- Gate de fase: Fase 2 avanza; 2.1 cerrado, 2.3 parcialmente cerrado (queda anotado arriba lo pendiente). Fase 2 sigue abierta por autosave, preview por audiencia, calendario general y multifaena, y validacion de usabilidad con usuarios reales.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento BLD-03

- Alcance implementado: autoguardado de servidor para el paso "Datos basicos" del constructor (titulo y meta de cumplimiento), primera porcion de 2.2 "Guardar borrador automaticamente y advertir cambios no sincronizados".
- Diseno: no se creo una accion de servidor nueva. `MetadataTab` reusa `updatePdtpProgramAction` (la misma que ya invocaba el boton "Guardar cambios" explicito), pero ahora tambien la dispara automaticamente 1,5 s despues de la ultima tecla si el titulo o la meta cambiaron. Un indicador visible ("Guardado" / "Guardando…" / "Cambios sin guardar", mas un `aria-live` para lectores de pantalla) y un listener `beforeunload` completan el ciclo. El envio explicito por boton sigue disponible.
- Correccion de una condicion de carrera detectada durante la implementacion: si se usa un `ref` simple para recordar "el ultimo valor guardado", un usuario que sigue tecleando mientras el autoguardado anterior todavia esta en vuelo puede terminar con el indicador marcado como "Guardado" para texto que en realidad nunca se envio al servidor. Se resolvio con un snapshot (`submittedRef`) que se fija exactamente en el momento de cada envio (automatico o manual) y solo ese snapshot exacto se promueve a "guardado" cuando la respuesta del servidor confirma éxito.
- Otro ajuste necesario: el dispatcher de `useActionState` debe invocarse dentro de `React.startTransition` cuando se llama fuera de un submit nativo (por ejemplo desde un `setTimeout`); sin eso, `isPending` no se actualizaba y, bajo fake timers en la prueba, el flujo quedaba colgado.
- Archivos: `app/(app)/prevencion/pdtp/[programId]/editar/builder-tabs.tsx` (se exporto `MetadataTab` para poder probarlo de forma aislada), `app/(app)/prevencion/pdtp/[programId]/editar/metadata-tab.test.tsx` (nuevo); sin migracion.
- Pruebas ejecutadas: `metadata-tab.test.tsx` con fake timers, 3/3 (autoguarda tras el debounce con el payload correcto, no autoguarda antes de que termine el debounce, no marca como sucio un valor que coincide con el ya guardado); `npx tsc --noEmit` limpio; ESLint focalizado sin hallazgos (incluida la regla `react-hooks/refs` que detecto la lectura de ref durante el render antes de la correccion); suite `lib/__tests__/` + `app/(app)/prevencion/` + `app/(app)/admin/` + `app/api/prevencion/` → 232 archivos, 2143 pasadas, 0 fallidas; `npm run db:generate` → `No schema changes`.
- Hallazgos nuevos: ninguno de negocio; los dos ajustes tecnicos (condicion de carrera del snapshot y `startTransition`) quedan documentados arriba porque cualquier extension futura del autoguardado a otros pasos del constructor debe repetir el mismo patron, no el ingenuo (ref simple + dispatch directo).
- Riesgos residuales: el resto de los pasos del constructor (objetivos, actividades, planificacion, evidencias) no tienen autoguardado; cada item se persiste solo al confirmarlo explicitamente, por lo que un campo a medio llenar dentro de un formulario abierto todavia se pierde si el usuario navega sin guardar. Extenderlo requeriria replicar este patron por formulario, no una solucion generica de una sola vez.
- Gate de fase: 2.2 avanza parcialmente; Fase 2 sigue abierta por el resto de autosave, preview por audiencia/faena, calendario general y multifaena, y validacion de usabilidad con usuarios reales.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento BLD-04 (Fase 4.2: reconciliacion de identidades declaradas)

- Alcance implementado: accion de interfaz que faltaba sobre `reconcilePdtpDeclaredActor`, un servicio que ya existia, ya probado a nivel de servicio, pero sin ningun boton que lo invocara. Ahora cada declaracion documental con nombre (elaboracion, aprobacion, cambio de control) muestra "Vincular a una persona"/"Cambiar vínculo" cuando el programa es editable y el usuario tiene `prevention:pdtp:program:manage`.
- Diseno: dialogo con selector de persona (o "Sin vincular") y motivo obligatorio (≥10 caracteres); el nombre declarado (`declaredActorName`) nunca se sobreescribe ni se pierde, solo se agrega el vinculo. Nueva funcion `listPdtpReconciliationCandidates` (usuarios activos, sin acotar por permiso PDTP porque quien firmo historicamente puede no operar hoy el modulo) y nuevo schema `pdtpReconcileDeclaredActorSchema`.
- Archivos: `lib/services/pdtp/document-metadata.ts`, `lib/services/pdtp/index.ts`, `lib/validation/prevention-module/pdtp.ts`, `app/(app)/prevencion/pdtp/actions.ts` (nueva `reconcilePdtpDeclaredActorAction`), `app/(app)/prevencion/pdtp/[programId]/page.tsx`, `app/(app)/prevencion/pdtp/[programId]/reconcile-declared-actor-button.tsx` (nuevo); sin migracion.
- Pruebas ejecutadas: 3 casos nuevos en `lib/__tests__/prevencion-pdtp-actions.test.ts` (vincula con el actor de la sesion, rechaza motivo corto antes de llamar al servicio, niega sin el permiso) — 42/42 en el archivo; `npx tsc --noEmit` y ESLint focalizado sin hallazgos.
- Hallazgos nuevos: el servicio ya tenia cobertura completa (motivo obligatorio, guarda de estado editable, auditoria) desde una sesion anterior; el unico gap real era la ausencia de superficie de UI.
- Gate de fase: 4.2 cerrado — elaboracion/aprobacion/cambios como historial, reconciliacion explicita y leyenda de roles con version del extractor, los tres ya visibles y operables end-to-end.
- Aprobado por: pendiente.

### 2026-07-21 — Incremento BLD-05 (Fase 2.2: previsualizacion por responsable/audiencia + cierre de pruebas de Fase 4)

- Alcance implementado: panel "Previsualizar por responsable o audiencia" en el paso de revision del constructor. Filtra en el cliente sobre `responsibleSlugs`/`audienceRoles` (datos generales ya existentes por actividad, sin tabla especial por hoja) y muestra cuantas/cuales actividades vería esa combinacion, sin crear una copia del programa. La dimension de faena queda fuera: ninguna actividad se excluye por faena hoy (solo su cantidad planificada puede tener una excepcion via overrides), asi que una previsualizacion real por faena necesita mostrar el efecto de esos overrides, no filtrar actividades — se deja pendiente y documentado, no simulado.
- Cierre adicional de tres pruebas obligatorias de Fase 4 que ya estaban satisfechas por un test existente (`round-trips the five long 2026 activities...` en `prevention-pdtp.test.ts`) pero no estaban marcadas: round-trip semantico C/D, los cinco textos largos completos, y edicion sin cambios de las actividades 37/38/43/51/52. Se agrego ademas un test nuevo, `audiences (sheet memberships) reuse the same 89 activities instead of duplicating rows per view`, para cerrar explicitamente la prueba de Fase 2 sobre audiencias sin duplicar actividades (89 filas de actividad, memberships de vista superiores en cantidad pero referenciando como maximo esas mismas 89).
- Se reviso ademas "evitar truncamiento visual silencioso" (4.1): ningun componente PDTP aplica `truncate`/`line-clamp` al texto de actividad; se cierra sin cambios de codigo, solo verificacion.
- Archivos: `app/(app)/prevencion/pdtp/[programId]/editar/builder-tabs.tsx` (nuevo `AudiencePreviewPanel`, exportado para prueba), `app/(app)/prevencion/pdtp/[programId]/editar/audience-preview-panel.test.tsx` (nuevo), `lib/__tests__/prevention-pdtp.test.ts` (nuevo test de audiencias); sin migracion.
- Pruebas ejecutadas: `audience-preview-panel.test.tsx` 3/3; `prevention-pdtp.test.ts` completo bajo `vitest.pglite.config.ts` → 50/50; `npx tsc --noEmit` y ESLint focalizado sin hallazgos.
- Gate de fase: Fase 4 tecnicamente completa salvo la clasificacion de las 22 actividades (4.3), que es una decision de negocio explicitamente fuera de alcance de este incremento (seccion 10, pregunta 8) y no se debe inventar. Fase 2 sigue abierta por autosave del resto de pasos, preview por faena, calendario general sin año fijo y multifaena con herencia — los cuatro son rediseños o decisiones que exceden un incremento seguro.
- Aprobado por: pendiente.

### 2026-07-22 — Incremento BLD-06 (Fase 6.1/6.2: contexto de faena, corte temporal, navegacion KPI, tooltips)

- Alcance implementado: cierre completo de Fase 6.1 y del resto de Fase 6.2 salvo la bandeja unificada "Esta semana".
- UX-01 cerrado: `getPdtpComplianceIndicatorsForScope` (nueva) agrega el cumplimiento sobre las faenas autorizadas del usuario reutilizando `getPdtpComplianceIndicators` por-faena (ya correcto) en vez de omitir `worksiteId` — omitirlo dejaba `executed` estructuralmente en 0 (`loadProgramScheduleAndExecutions` no agrega ejecuciones sin faena) aunque hubiera avance real. Falla cerrado: sin faenas explicitas no hay agregado. La lista de programas (`/prevencion/pdtp`) ahora usa esta funcion con el alcance real del usuario y muestra "Cumplimiento (N faena(s))" en vez de "Cumplimiento:" sin contexto.
- `PdtpComplianceIndicators` gana `lastExecutionUpdatedAt` (ultima `updatedAt` entre ejecuciones aprobadas, agregada tambien en el scope). `PdtpIndicatorsPanel` muestra "Datos al {fecha de render}" y "Última ejecución aprobada: {fecha}", y enlaza el tile "Cumplimiento anual" y cada fila mensual del desglose a `#registros-pdtp` (ancla nueva sobre la tabla de actividades/ejecuciones ya presente en la pagina de detalle) — primera navegacion real de KPI a los registros que lo componen.
- Tooltip de abreviaturas de rol: `LifecycleStep` (control de ciclo de vida del programa) expande JDPR/PRF/CPHS/RRHH via `title` cuando aparecen en la etiqueta de un paso, sin acoplar logica de negocio a esos codigos (es un glosario de texto, no una condicion).
- Archivos: `lib/services/pdtp/compliance.ts`, `lib/services/pdtp/index.ts`, `app/(app)/prevencion/pdtp/page.tsx`, `app/(app)/prevencion/pdtp/pdtp-indicators-panel.tsx`, `app/(app)/prevencion/pdtp/[programId]/page.tsx`, `app/(app)/prevencion/pdtp/[programId]/program-lifecycle-controls.tsx`, mas los tests de cada uno; sin migracion.
- Pruebas ejecutadas: nuevo caso PGlite `getPdtpComplianceIndicatorsForScope agrega...` (confirma que sin faena `executed` queda en 0, que el scope de 2 faenas suma correctamente, y que planned se cuenta una vez por faena agregada); `pdtp-indicators-panel.test.tsx` ampliado a 7/7; `program-lifecycle-controls.test.tsx` ampliado a 6/6; `npx tsc --noEmit` limpio; ESLint focalizado sin hallazgos; suite `lib/__tests__/` + `app/(app)/prevencion/` + `app/(app)/admin/` + `app/api/prevencion/` → 233 archivos, 2153 pasadas, 0 fallidas; `prevention-pdtp.test.ts` completo bajo `vitest.pglite.config.ts`; `npm run db:generate` → `No schema changes`.
- Hallazgos nuevos: ninguno nuevo; UX-01 era un hallazgo ya registrado en la seccion 5 desde el inicio del plan, cerrado en este incremento.
- Riesgos residuales: "suplencias y preferencias de notificacion" (6.3) quedan deliberadamente fuera de este incremento — no existe en todo el repositorio ningun sistema de preferencias de notificacion por usuario ni de suplencias generico (solo conceptos puntuales en CPHS/emergencias), y construir uno de alcance general excede el alcance de PDTP.
- Gate de fase: Fase 6.1 cerrada completa.
- Aprobado por: pendiente.

### 2026-07-22 — Incremento BLD-07 (Fase 6.2: bandeja "Esta semana" unificada)

- Alcance implementado: se completo la ultima pieza de 6.2. `/prevencion/pdtp/obligaciones` ya cubria disparadas/a demanda y vencidas (OBL-02); se agregaron "Programadas esta semana" y "Pendientes de evidencia o aprobación" reusando servicios ya existentes y probados, sin logica nueva de negocio.
- Diseno: `findPdtpWeeklyPending()` (usado hasta ahora solo por el cron, que recorre TODAS las faenas activas) se filtra al alcance real del usuario antes de pasarse a la UI — exponerlo sin filtrar habria sido una fuga de alcance entre faenas. `listPendingPdtpExecutions(scope)` ya era scope-aware, se reutiliza directo. Un cuarto tile KPI ("Programadas esta semana") respeta el limite de "maximo cuatro KPIs accionables" ya cerrado antes. Las dos dimensiones nuevas viven en secciones propias (no se fusionaron con la lista de obligaciones) porque son tipos de dato heterogeneos: obligaciones (`pending`/`overdue`/`reported`) vs. ejecuciones programadas, forzar una sola tabla habria arriesgado el filtro/estado ya probado de la lista existente.
- Hallazgo tecnico durante la implementacion: renderizar el componente completo `PdtpObligationsWorkbench` en una prueba de React Testing Library (con `PageHeader` + 3 `Dialog` + 2 `Select` de Radix simultaneos) produce "Maximum update depth exceeded" en jsdom — un problema de compatibilidad Radix/jsdom preexistente (el componente nunca tuvo una prueba de render completo antes de este incremento), no un defecto de la funcionalidad nueva. Se resolvio extrayendo las dos secciones nuevas (`WeeklyScheduledSection`, `PendingApprovalSection`) como componentes propios exportados y probandolos de forma aislada, mismo patron ya usado para `MetadataTab` y `AudiencePreviewPanel` en incrementos anteriores.
- Archivos: `app/(app)/prevencion/pdtp/obligaciones/page.tsx`, `app/(app)/prevencion/pdtp/obligaciones/pdtp-obligations-workbench.tsx`, `app/(app)/prevencion/pdtp/obligaciones/pdtp-obligations-workbench.test.tsx` (nuevo); sin migracion.
- Pruebas ejecutadas: `pdtp-obligations-workbench.test.tsx` 5/5 (lista faenas con conteo pendiente, estado vacio calendarizado, lista ejecuciones pendientes de aprobacion separadas de las obligaciones, oculta el enlace de aprobacion sin permiso de ejecutar, estado vacio de aprobacion); `npx tsc --noEmit` limpio; ESLint focalizado sin hallazgos (incluida la regla de Next.js que exige `<Link>` en vez de `<a>` para navegacion interna); suite `lib/__tests__/` + `app/(app)/prevencion/` + `app/(app)/admin/` + `app/api/prevencion/` → 234 archivos, 2158 pasadas, 0 fallidas; `npm run db:generate` → `No schema changes`.
- Hallazgos nuevos: ninguno de negocio; el hallazgo tecnico de Radix/jsdom queda documentado arriba para quien intente en el futuro una prueba de render completo de este componente.
- Riesgos residuales: ninguno nuevo. La limitacion de pruebas de render completo con Radix+jsdom es preexistente y afecta potencialmente a otros componentes con patrones similares (PageHeader + multiples Dialog/Select), no solo a este.
- Gate de fase: 6.2 cerrada completa. Fase 6 sigue abierta por 6.3 (suplencias/preferencias de notificacion), 6.4 (reporte de gestion), 6.5 (expediente auditor) y 6.6 (adaptador RE-36 opcional).
- Aprobado por: pendiente.

### 2026-07-22 — Incremento BLD-08 (Fase 6.4: reporte de gestion)

- Alcance implementado: reporte de gestion completo — servicio, exportacion Excel y pantalla — con la estructura que comunica gestion (resumen por objetivo), no la del archivo 2026.
- `lib/services/pdtp/management-report.ts` (nuevo): `getPdtpManagementReport` agrupa el avance calendarizado por objetivo (no por actividad ni por hoja), reusando `loadProgramScheduleAndExecutions` ya correcto por-faena; falla cerrado igual que el resto de PDTP (`assertWorksiteAccess` antes de tocar datos). Filtros: faena (obligatoria), responsable, objetivo, estado (`meets`/`deviates`) y rango de meses. Solo actividades `scheduled` participan (67 de 89 en el caso 2026), consistente con el test ya existente de que las 22 sin P no contaminan el denominador.
- `GET /api/prevencion/pdtp/reporte-gestion` (nuevo): mismo patron de seguridad que el export Excel ya endurecido en Fase 1 — permiso, resolucion de faena fail-closed (una autorizada o rechazo explicito), auditoria en los cuatro desenlaces (success/denied/invalid/error), headers `Cache-Control: no-store` y `X-Content-Type-Options: nosniff`. Construye el Excel con ExcelJS directo (dos hojas: "Resumen por objetivo" y "Indicadores") mas la hoja de metadatos de trazabilidad comun (`addExportMetadataSheet`, ya usada por otros exports del modulo prevencion), sanitizando celdas con el mismo escape de formulas (`=+-@`) que `indicadores/export/route.ts`.
- `/prevencion/pdtp/[programId]/reporte` (nuevo, pantalla): llama al mismo `getPdtpManagementReport` con los mismos filtros que la exportacion, con un boton "Descargar Excel" que arma la URL de export con los filtros activos vigentes — un solo calculo, sin duplicar logica entre pantalla y archivo. Filtros interactivos (`ReporteGestionFilters`, client component) siguiendo el patron ya establecido de `PdtpWorksitePicker` (Select + `router.push` con querystring). Cada fila enlaza a `#registros-pdtp` en el detalle del programa.
- Archivos: `lib/services/pdtp/management-report.ts`, `lib/services/pdtp/index.ts`, `app/api/prevencion/pdtp/reporte-gestion/route.ts`, `app/api/prevencion/pdtp/reporte-gestion/route.test.ts`, `app/(app)/prevencion/pdtp/[programId]/reporte/page.tsx`, `app/(app)/prevencion/pdtp/[programId]/reporte/reporte-gestion-filters.tsx`, `app/(app)/prevencion/pdtp/[programId]/reporte/reporte-gestion-filters.test.tsx`, `app/(app)/prevencion/pdtp/[programId]/page.tsx` (enlace del menu de acciones apunta a la pantalla en vez de descargar directo); sin migracion.
- Pruebas ejecutadas: nuevo caso PGlite `getPdtpManagementReport groups avance/desviaciones/responsables by objetivo, filters, and fails closed outside scope` (fail-closed fuera de alcance, conteo 67 actividades scheduled, avance aislado por objetivo, cortes por objetivo y por estado) — 53/53 en el archivo bajo `vitest.pglite.config.ts`; `route.test.ts` del export 8/8 (401/403 sin permiso/sin alcance/faena ajena, 400 sin faena explicita con alcance multiple, 404 sin programa activo, filtros parseados correctamente, headers de seguridad); `reporte-gestion-filters.test.tsx` 3/3; `npx tsc --noEmit` limpio; ESLint focalizado sin hallazgos; suite `lib/__tests__/` + `app/(app)/prevencion/` + `app/(app)/admin/` + `app/api/prevencion/` → 236 archivos, 2169 pasadas, 0 fallidas; `npm run db:generate` → `No schema changes`; `npm run build` exitoso.
- Hallazgos nuevos: ninguno.
- Riesgos residuales (cerrados en BLD-12): la navegacion "Ver registros" ya llega recortada exactamente al objetivo de esa fila (`?objetivo=<objectiveOrder>`), y "Excel/LibreOffice abre el Excel sin reparaciones" ya tiene verificacion automatizada de round-trip para este export y los demas de PDTP.
- Gate de fase: 6.4 cerrada completa. Fase 6 sigue abierta por 6.3 (suplencias/preferencias), 6.5 (expediente auditor) y 6.6 (adaptador RE-36 opcional, gateado por decision de negocio).
- Aprobado por: pendiente.

### 2026-07-22 — Incremento BLD-09 (Fase 6.5: expediente auditor)

- Alcance implementado: expediente auditor completo — agrega en un solo llamado las ocho categorias que pedia el plan (ejecuciones, fuentes, obligaciones a demanda, acciones, seguimientos, aprobaciones, cambios, lotes de importacion) y las exporta en un Excel de ocho hojas con la misma rigurosidad de seguridad que el resto de exports PDTP.
- `lib/services/pdtp/audit-dossier.ts` (nuevo): `getPdtpAuditDossier(programId, worksiteId, scope)` compone el expediente reusando servicios ya existentes y probados (`listPdtpObligations`, `listActionsByProgram`, `listFollowups`, `getPdtpApprovalProgress`) en vez de reescribir esas consultas, mas dos queries nuevas acotadas por faena (ejecuciones, `preventionPdtpSourceLinks`) y dos sin acotar por ser a nivel de programa (`pdtpChangeLog`, `pdtpImportBatches` filtrados por `targetWorksiteId` cuando aplica). Falla cerrado con `assertWorksiteAccess` antes de tocar cualquier dato.
- Decision deliberada de seguridad: las filas de ejecucion nunca incluyen `evidenceUrl`/`evidenceText` crudos — solo un booleano `hasEvidence` y el `executionId`, que el auditor resuelve navegando dentro de la aplicacion con su propia autorizacion. Esto cumple "no exponer URLs temporales vencidas ni rutas internas" por diseno del tipo de retorno, no por un filtro que se pueda olvidar en un caller futuro.
- `GET /api/prevencion/pdtp/expediente-auditor` (nuevo): mismo patron de seguridad que `reporte-gestion` y el export original — permiso, resolucion de faena fail-closed, auditoria en los cuatro desenlaces, headers seguros. Construye el Excel con ExcelJS directo (portada "Programa" con digest/version/estado + ocho hojas de detalle), mismo escape de formulas (`safe()`) que los demas exports del modulo prevencion.
- Enlace de descarga agregado al menu de acciones del detalle del programa, junto a "Exportar programa" y "Reporte de gestión".
- Archivos: `lib/services/pdtp/audit-dossier.ts`, `lib/services/pdtp/index.ts`, `app/api/prevencion/pdtp/expediente-auditor/route.ts`, `app/api/prevencion/pdtp/expediente-auditor/route.test.ts`, `app/(app)/prevencion/pdtp/[programId]/page.tsx`; sin migracion.
- Pruebas ejecutadas: nuevo caso PGlite `getPdtpAuditDossier assembles executions, sources, obligations, actions, approvals and changes scoped to one faena, and fails closed outside scope` (fail-closed fuera de alcance, ejecucion sin exponer evidencia cruda, fuentes/acciones/seguimientos/lotes acotados a la faena solicitada, aprobaciones/cambios a nivel de programa visibles desde cualquier faena autorizada, faena sin datos ve listas vacias donde corresponde) — 54/54 en el archivo bajo `vitest.pglite.config.ts` (incluye la correccion de limpieza descrita abajo); `route.test.ts` 8/8 (401/403/400/404, headers seguros, auditoria); `npx tsc --noEmit` limpio; ESLint focalizado sin hallazgos; suite `lib/__tests__/` + `app/(app)/prevencion/` + `app/(app)/admin/` + `app/api/prevencion/` → 237 archivos, 2177 pasadas, 0 fallidas; `npm run db:generate` → `No schema changes`; `npm run build` exitoso.
- Hallazgo nuevo: la primera corrida completa de `prevention-pdtp.test.ts` (54 casos, no el test aislado) fallo en los 5 tests posteriores al nuevo, con un error de FK al borrar `worksites`. Causa real: `createActionPlanItem` (usado por el test del expediente auditor) crea un registro CAPA espejo (`prevention_capa_actions`, integracion cruzada PDTP↔CAPA ya existente en `lib/services/pdtp/action-plan.ts`) que el `beforeEach` de este archivo nunca limpiaba — ningun test anterior en este archivo habia ejercido esa ruta. Ademas, `pdtp_action_plan.capa_action_id` usa `onDelete: "restrict"` hacia `prevention_capa_actions`, asi que el orden de limpieza importa: hay que borrar `pdtpExecutions` (cascada a `pdtpActionPlan`) antes de borrar las tablas CAPA, no despues. Se corrigio el `beforeEach` compartido del archivo con el orden correcto; confirmado con la suite completa en verde.
- Riesgos residuales: "Excel/LibreOffice abre el Excel sin reparaciones" ya tiene verificacion automatizada (cerrado en BLD-12). El expediente usa el mismo permiso `prevention:pdtp:view` que el resto de exports del modulo; no se creo un permiso mas restrictivo especifico para el expediente auditor porque el plan no lo pide explicitamente y hacerlo unilateralmente seria una decision de producto no solicitada.
- Gate de fase: 6.5 cerrada completa. Fase 6 sigue abierta solo por 6.3 (suplencias/preferencias de notificacion, sin infraestructura general en el repositorio) y 6.6 (adaptador RE-36 opcional, gateado por decision de negocio explicita del propio plan).
- Aprobado por: pendiente.

---

### 2026-07-22 — Incremento BLD-10 (hallazgo critico: loop de render infinito en `/prevencion/pdtp/obligaciones`, verificado en navegador real)

- Contexto: siguiendo la instruccion de verificar cambios de UI en un navegador real (no solo tipos/tests/build), se levanto un servidor E2E aislado (`bodega_e2e`, credenciales de prueba dedicadas, sin tocar la base de datos de desarrollo real ni las credenciales del usuario) y se recorrio con Playwright: login, lista de programas PDTP, detalle de programa con seleccion de faena, menu "Mas acciones" (Reporte de gestion / Expediente auditor), pantalla `/reporte`, y la bandeja `/prevencion/pdtp/obligaciones`.
- Todo lo anterior renderizo correctamente excepto la bandeja de obligaciones: `/prevencion/pdtp/obligaciones` mostraba la pantalla de error generica de la aplicacion ("Algo salio mal") apenas cargaba, con `React error #185` ("Maximum update depth exceeded") en consola. Reproducible al 100% en el build de produccion; no aparecia en `next dev` (probablemente por diferencias de timing/scheduling entre ambos modos, no por ausencia real del bug), y tampoco lo detectaban los tests existentes porque `pdtp-obligations-workbench.test.tsx` solo renderiza `WeeklyScheduledSection`/`PendingApprovalSection` de forma aislada, nunca el componente completo `PdtpObligationsWorkbench` (la razon original, documentada en un incremento anterior de esta sesion, fue exactamente evitar este mismo error en jsdom — es decir, el bug ya se habia visto antes y se rodeo en vez de corregirse de raiz).
- Causa raiz confirmada reproduciendo el error en un test aislado con `@testing-library/react` (stack trace legible, sin minificar): `ShellHeaderContext` (`components/layout/header-context.tsx`) combinaba `header`/`setHeader` (usado por `PageHeader` para titulo/breadcrumb/acciones) y `searchQuery`/`setSearchQuery` (usado por paginas que integran el buscador del TopBar) en un unico `value` memoizado. Cualquier `setHeader()` cambia esa referencia y re-renderiza a **todos** los consumidores del contexto, incluidos los que solo leen `searchQuery`. `PdtpObligationsWorkbench` es el primer componente de la aplicacion que hace ambas cosas a la vez: consume `useSafeShellHeader()` para el buscador y renderiza `<PageHeader actions={<Button .../>} breadcrumb={<Breadcrumbs .../>} />` con props JSX inline (referencia nueva en cada render). El ciclo: render crea `actions`/`breadcrumb` nuevos -> el `useEffect` de `PageHeader` los ve distintos y llama `setHeader` -> el contexto cambia -> `PdtpObligationsWorkbench` se re-renderiza por ser consumidor -> vuelve a crear `actions`/`breadcrumb` nuevos -> nunca converge. Paginas anteriores que usan `useSafeShellHeader()` (bandejas de emergencias, CPHS, permisos, etc.) no combinan ambos roles en el mismo componente, por eso el defecto de diseno era preexistente pero nunca se habia disparado.
- Correccion de raiz, no parche local: se separo el contexto en dos (`HeaderContext` y `SearchContext`) dentro del mismo `ShellHeaderProvider`, cada uno con su propio `value` memoizado. `useShellHeader()` (usado por `PageHeader` y `TopBar`) sigue exponiendo `{header, setHeader}`; `TopBar` ahora tambien llama a `useSafeShellHeader()` para `searchQuery`/`setSearchQuery`. `useSafeShellHeader()` (usado por las paginas con buscador) ya no se re-renderiza cuando cambia solo el header. Esto corrige el bug en el origen para cualquier pagina futura que combine ambos patrones, no solo para PDTP.
- Archivos: `components/layout/header-context.tsx`, `components/layout/top-bar.tsx`; sin migracion, sin cambio de API publica de los hooks salvo la forma interna del contexto.
- Pruebas ejecutadas: reproduccion aislada con `@testing-library/react` (confirmo el error antes del fix y su ausencia despues); `components/layout/top-bar.test.tsx` y `components/ui/page-header.test.tsx` en verde; `npx tsc --noEmit` limpio; ESLint focalizado sin hallazgos; suite completa `npx vitest run` → 330/352 archivos, 2862 pasadas, 168 omitidas, 1 fallo preexistente y no relacionado (`scripts/capture-all-routes.test.ts`, brecha ya documentada en memoria del pipeline de capturas de pantalla, ajena a este cambio); reconstruccion completa del servidor E2E standalone y nueva verificacion en navegador real confirmando que `/prevencion/pdtp/obligaciones` ya renderiza sin error.
- Por que importa mas alla de PDTP: este es el primer defecto de esta sesion detectado exclusivamente por probar en un navegador real en vez de confiar en tipos/tests/build — ninguna de esas tres senales lo habria detectado, porque el build de produccion pasa igual (el error ocurre en runtime del cliente, no en tiempo de compilacion) y el test existente evitaba deliberadamente el escenario que lo dispara.
- Gate: no bloquea el cierre de 6.2/6.4/6.5 (ya estaban correctos); corrige un defecto que SI bloqueaba el uso real de la bandeja de obligaciones agregada en BLD-07.
- Aprobado por: pendiente.

### 2026-07-22 — Auditoria puntual: 4.1 (nombres de campo `activity`/`program`)

- Motivo: al revisar que quedaba realmente accionable sin decision de negocio, se reabrio 4.1 ("Definir campos de dominio sin ambiguedad") para verificar si de verdad seguia sin resolver o si un incremento anterior ya lo cubria parcialmente sin marcarlo.
- Hallazgo: `PDTP_2026_COLUMN_DICTIONARY` y `activity-content.ts` (ambos ya existentes en el repositorio, de un incremento previo de esta misma sesion) ya resuelven la ambiguedad de nombres de dominio y ya implementan el adaptador de compatibilidad que pedia el item — ver el detalle en 4.1 mas arriba. Se corrigieron los dos checkboxes para reflejar ese estado real en vez de dejarlos sin marcar sin explicacion.
- Se evaluo y se descarto propagar el adaptador a los consumidores restantes (`content-digest.ts`, registro de cambios de `activities.ts`) en este mismo incremento: esos dos puntos firman/auditan sobre la forma actual de los campos, y renombrar ahi sin antes verificar compatibilidad de digest con programas ya aprobados podria invalidar firmas existentes. Es trabajo real y con valor, pero de mayor riesgo y alcance que una limpieza de nombres, y merece su propia revision dedicada en vez de resolverse de paso.
- Archivos: solo el plan (documentacion); sin cambios de codigo en este punto especifico.
- Gate: no cambia el estado de ninguna fase; deja 4.1 con estado honesto en vez de "sin empezar".

### 2026-07-22 — Incremento BLD-11 (autosave restante, horizonte de recurrencia, multifaena y registro de fuentes ampliado)

- Contexto: contraste completo del plan contra el codigo (verificado `file:line` con exploracion en paralelo) para separar lo bloqueado por decision de negocio de lo puro codigo implementable ya. Este incremento cubre todo el trabajo puro codigo identificado, ordenado por riesgo.
- Alcance implementado:
  - **Autosave (2.2):** `lib/hooks/use-debounced-autosave.ts` generaliza el patron de `MetadataTab` (debounce 1500ms, sin envios superpuestos, `beforeunload`). Aplicado a `ObjetivosTab`/`ObjectiveRow` y a `PlanificacionTab`/`PlanificacionRow` (matriz avanzada). Deliberadamente NO aplicado a `EditActivityDialog`/`BatchEditActivitiesDialog` (dialogos con Cancelar explicito: autoguardar ahi rompe la semantica de "Cancelar descarta") ni a `ChecklistTab`/`ChecklistEditor` (`savePdtpActivityChecklist` crea una fila de VERSION nueva en cada llamada — auto-guardar cada 1.5s llenaria el historial de versiones con intentos a medio escribir). Ambas exclusiones son decisiones de diseno documentadas en el codigo, no un olvido.
  - **Horizonte de recurrencia (2.3):** `lib/services/pdtp/recurrence.ts` generaliza `projectRecurrenceToLegacySchedule`/`describePdtpRecurrence`/`describePdtpRecurrenceImpact` con un `PdtpScheduleHorizon` (meses reales + semanas/mes), derivado del periodo real del programa via `deriveScheduleHorizon` (nueva). Sin `periodStart`/`periodEnd` declarado, el horizonte es el año calendario completo — identico al comportamiento anterior (regresion cubierta por test). Con un periodo parcial, `lib/services/pdtp/activities.ts` (creacion/edicion de actividad) y la matriz avanzada (`PlanificacionTab`/`fillAll`) ya no fabrican celdas fuera del periodo real. La tabla `pdtp_activity_schedule` sigue acotada a un unico año con semana 1-4 (CHECK de esquema); multi-año o semanas ISO reales exigen remodelarla — marcado `// ponytail:` en el codigo, fuera de este alcance porque repercute en indicadores/overrides/export/import.
  - **Modelo multifaena (2.3):** dos tablas nuevas, `pdtp_program_worksites` (membresia; vacio = todas las faenas del scope, retrocompatible) y `pdtp_activity_worksite_exclusions` (excepcion puntual de actividad por faena, motivo obligatorio ≥10 caracteres). Servicio `lib/services/pdtp/worksites.ts`: `setPdtpProgramWorksites`, `exclude/includeActivityForWorksite`, `resolveProgramWorksiteIds` (nunca amplia el scope del usuario), `resolvePdtpEffectiveActivitiesForWorksite`, `assertPdtpWorksiteCanOperateProgram` (falla cerrado). Ambas mutables solo en `draft` (guarda central existente). `createPdtpObligation`/`markPdtpExecution` rechazan una faena fuera de la membresia declarada. Digest (`content-digest.ts`) incluye membresia y exclusiones; `schemaVersion` 5→6 — sube porque este es contenido de autoria que cambia lo que cada faena ve, a diferencia de los overrides operacionales de meta que NO firman. UI: panel "Faenas que cubre este programa" + editor de exclusiones en `MetadataTab` (Datos basicos); `AudiencePreviewPanel` gana la dimension faena (filtra por membresia+exclusiones, sin crear copias, sin consultas nuevas — reutiliza datos ya cargados por la pagina).
  - **Registro de fuentes ampliado (Fase 5, parte pura codigo):** enum `sourceType` de `preventionPdtpSourceLinks` ampliado de 6 a 12 valores (agrega `capacitacion`, `inspeccion`, `cphs`, `epp`, `emergencia`, `campana`) en el CHECK de esquema y el Zod. `getPdtpCoverage` agrega `capaActions` a `sourceOptions` (la validacion de `linkPdtpActivitySource` para `incident_capa` ya existia, solo faltaba el selector); `LinkSourceDialog` ahora ofrece un picker poblado y scoped por faena para CAPA, ademas de listar los 6 tipos nuevos en el selector de tipo (sin picker propio todavia, caen al ID de texto libre como antes). Los otros 5 dominios (capacitacion/inspecciones/CPHS/EPP/emergencias/campañas) quedan con el enum listo pero sin selector poblado ni motor de auto-emision — eso exige la matriz 1-89 con decision de negocio (§10, pregunta 8), fuera de alcance de este incremento.
  - **Pulido (principio 5.2):** `lib/services/pdtp/compliance.ts` dejo de capar `executed` a `Math.min(executed, planned)` en el indicador agregado — el sobrecumplimiento ahora se muestra completo (`percent` puede superar 1); el dato crudo en `pdtpExecutions` nunca se habia tocado, solo el agregado mostrado. `ComplianceBar`/`fmtPct` ya clampaban solo la barra visual, asi que el cambio es seguro para los consumidores existentes.
  - **Limpieza (2.3):** `collectResponsibleCatalog`/`displayNameForSlug`/`displayNameForActivity` (vocabulario fijo 2026: nombres de responsables del archivo de referencia) se movieron de `lib/services/pdtp/helpers.ts` (general) a `lib/services/pdtp-adapters/responsible-catalog-2026.ts`, junto a `SHEET_META`/`ROLE_RESPONSIBLE_SLUGS`. Sin cambio de comportamiento; solo consumido por `catalog.ts`/`imports.ts` (el adaptador 2026 operando, como corresponde).
- Archivos/migraciones: `lib/hooks/use-debounced-autosave.ts` (nuevo); `lib/services/pdtp/worksites.ts` (nuevo); `lib/services/pdtp-adapters/responsible-catalog-2026.ts` (nuevo); `app/(app)/prevencion/pdtp/actions/worksites-actions.ts` (nuevo); `db/schema/prevention/pdtp.ts`, `db/schema/prevention/risk-legal.ts`, `lib/validation/prevention-module/pdtp.ts`, `lib/validation/prevention-module/risk-legal.ts`, `lib/services/pdtp/{recurrence,activities,content-digest,executions,obligations,helpers,catalog,imports,index,compliance}.ts`, `lib/services/prevention-risk-legal.ts`, `app/(app)/prevencion/pdtp/[programId]/editar/{builder-tabs,page}.tsx`, `app/(app)/prevencion/pdtp/cobertura/{page,pdtp-coverage-workbench}.tsx`; migraciones generadas `0105_hot_penance.sql` (tablas multifaena) y `0106_eminent_dazzler.sql` (enum `sourceType`).
- Pruebas ejecutadas: `npm run typecheck` limpio; `npm run db:generate` final → `No schema changes` tras aplicar ambas migraciones con `db:migrate`; suite PGlite completa 41 archivos/354 casos (incluye `pdtp-worksites.test.ts` nuevo, 6 casos, y el nuevo caso de sobrecumplimiento en `prevention-pdtp.test.ts`); suite rapida completa 333 archivos/2879 casos (1 fallo preexistente y no relacionado, `scripts/capture-all-routes.test.ts`, ya documentado); nuevos tests de UI para autosave (`objetivos-tab.test.tsx`, `planificacion-tab.test.tsx`), dimension de faena en `audience-preview-panel.test.tsx`, panel de membresia/exclusiones (`worksite-scope-panel.test.tsx`) y picker CAPA (`pdtp-coverage-workbench.test.tsx`).
- Evidencia de datos: horizonte anual 2026 regresivo (48 celdas identicas verificado por test); horizonte de 6 meses genera exactamente 6 celdas mensuales; programa sin membresia ve todas las faenas del scope (regresion); programa con membresia + exclusion puntual excluye la actividad solo en la faena excluida; digest cambia (schemaVersion 6) al declarar membresia o exclusion y se rechaza fuera de `draft`.
- Hallazgos nuevos: ninguno que bloquee — las dos exclusiones deliberadas de autosave (dialogos modales, checklist versionado) se documentaron en el codigo para que no se "corrijan" mecanicamente despues sin releer el motivo.
- Riesgos residuales: multi-año/semanas ISO reales en `pdtp_activity_schedule` (remodelado de tabla, fuera de alcance); los 5 dominios de fuente restantes sin picker poblado en ese momento — cerrado en BLD-12, ver abajo; autosave de Actividades/Evidencias sigue manual por diseno.
- Gate de fase: Fase 2 avanza (autosave parcial extendido, preview por faena cerrado, horizonte de recurrencia generalizado); Fase 5 avanza parcialmente (registro de fuentes ampliado, CAPA con selector); ninguna fase cambia a "cerrada" — persisten los items bloqueados por decision de negocio listados en el §10 y §15.
- Aprobado por: pendiente.

### 2026-07-22 — Incremento BLD-12 (navegacion KPI→objetivo, registro de fuentes para los 5 dominios restantes, verificacion de round-trip Excel, recuperacion de red en autosave)

- Contexto: continuacion de BLD-11 sobre el resto del trabajo puro codigo identificado como accionable sin decision de negocio (ver bitácora de la conversación con el listado explícito).
- Alcance implementado:
  - **Navegación KPI → objetivo (6.1):** el enlace "Ver registros" del reporte de gestión (`[programId]/reporte/page.tsx`) agrega `&objetivo=<objectiveOrder>`. `PdtpSheetTable` acepta un nuevo prop `objectiveOrder`; cuando está presente, acota actividades/contadores de estado/agrupación a ese objetivo (mismo numerador/denominador que la fila del reporte) y muestra un aviso "Mostrando solo el objetivo N: <nombre>" con enlace "Quitar filtro" reconstruido desde las props ya conocidas (mismo patrón que `PdtpViewToggle`/`PdtpWorksitePicker`, sin depender de `useSearchParams` para no romper los tests existentes que no envuelven el componente en un Router de prueba).
  - **Registro de fuentes: 5 dominios restantes (Fase 5, parte pura código):** `getPdtpCoverage` agrega `sourceOptions` poblado y scoped por faena para `capacitacion` (`prevention_training_sessions`, excluye `cancelled`), `inspeccion` (`prevention_inspection_runs`, excluye `cancelled`), `cphs` (`prevention_committees`, solo `active`), `epp` (`prevention_epp_requirements`, solo activo y con faena asignada — el `scopeType` puede ser global/posición/tarea sin faena), `emergencia` (`prevention_emergency_plans`, solo `approved`). `linkPdtpActivitySource` valida cada uno contra existencia+faena+estado antes de vincular. `campana` no tiene entidad propia en el esquema — se confirmó por búsqueda exhaustiva que no existe tabla `prevention_campaign*`, y no se creó una especulativamente; sigue como identificador de texto libre igual que auditoría/objetivo interno/obligación contractual. El componente `LinkSourceDialog` se refactorizó de 3 props de arrays nombrados a un único `sourceOptions: Partial<Record<string, Source[]>>`, evitando una cadena de ternarios creciente.
  - **Verificación de round-trip Excel (6.1):** nuevas pruebas que reabren el buffer real (no mockeado) con una instancia fresca de ExcelJS para `buildXlsxBuffer` (el generador Excel compartido por toda la app — recepción, compras, PDTP export, etc., no solo PDTP) y para los builders inline de `reporte-gestion`/`expediente-auditor`. Confirmado empíricamente que texto de usuario con apariencia de fórmula (`=SUM(...)`, `+2+5`, `-2+5`, `@SUM(...)`) nunca produce una celda de tipo fórmula evaluable (`cell.type !== ExcelJS.ValueType.Formula`, `cell.formula === undefined`) — ExcelJS solo genera una celda `<f>` cuando se asigna explícitamente `{formula: ...}`, nunca a partir de un string plano, y los builders de `reporte-gestion`/`expediente-auditor` ya escapaban ese texto con su propia función `safe()` desde incrementos anteriores. `buildXlsxBuffer` (el compartido) no tenía ese escape pero tampoco lo necesita por la razón anterior — se dejó así, sin agregar un `safe()` especulativo a una ruta que ya es segura por el comportamiento de la librería.
  - **Recuperación de red en autosave (2.2):** `useDebouncedAutosave` no capturaba una excepción lanzada por la Server Action (falla de red real, no un `{ok:false}` controlado) — el usuario se quedaba sin ninguna señal de que nada se guardó. Se agregó un `catch` que muestra "Error de red al guardar. Se reintentará automáticamente." `isDirty` permanece en `true` tras la falla (el callback de éxito nunca corre), así que el mismo efecto de debounce reagenda un reintento sin acción del usuario; además el botón "Guardar" explícito sigue disponible para reintentar de inmediato (verificado por test, ya que el reintento automático puro es difícil de verificar de forma determinista con fake timers).
- Archivos/migraciones: `app/(app)/prevencion/pdtp/[programId]/{page.tsx,reporte/page.tsx}`, `app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx`, `app/(app)/prevencion/pdtp/cobertura/{page.tsx,pdtp-coverage-workbench.tsx}`, `lib/services/prevention-risk-legal.ts`, `lib/hooks/use-debounced-autosave.ts`; sin migración (los 5 dominios reutilizan tablas ya existentes).
- Pruebas ejecutadas: `npm run typecheck` limpio; `npm run db:generate` → `No schema changes`; suite PGlite completa 42 archivos/357 casos (incluye `pdtp-coverage-sources.test.ts` nuevo); suite rápida completa 334 archivos/2889 casos (1 fallo preexistente y no relacionado, `scripts/capture-all-routes.test.ts`); nuevas pruebas en `pdtp-sheet-table.test.tsx` (filtro por objetivo), `pdtp-coverage-workbench.test.tsx` (picker de capacitación + fallback de texto libre para auditoría), `excel-builder.test.ts` (nuevo, round-trip + no-fórmula), `reporte-gestion/route.test.ts` y `expediente-auditor/route.test.ts` (round-trip + escape de fórmula), `objetivos-tab.test.tsx` (recuperación de red).
- Evidencia de datos: CPHS vincula un comité activo y rechaza uno disuelto; plan de emergencia aprobado se vincula y uno de otra faena se rechaza (`sourceVersionSnapshot` con formato `código vN`); round-trip confirma cabeceras/filas/múltiples hojas preservadas y celdas con texto tipo-fórmula almacenadas como texto literal en los 4 exports de PDTP.
- Hallazgos nuevos: ninguno que bloquee. Se confirmó (no se asumió) que el exportador Excel compartido de toda la app no es vulnerable a inyección de fórmulas vía texto de usuario, cerrando una duda de seguridad que el plan original dejaba abierta como pregunta, no como hallazgo confirmado.
- Riesgos residuales: `campana` sigue sin entidad de dominio (no bloquea nada hoy, ya que cae a texto libre igual que otros tipos manuales); el reintento automático de autosave tras una falla de red es correcto por diseño (mismo mecanismo de dependencias de efecto que ya dispara el primer intento) pero no se pudo verificar de forma determinista con fake timers en el test — se verificó en su lugar el camino de reintento manual, que es el que de todas formas queda siempre disponible.
- Gate de fase: Fase 5 avanza más (solo `campana` y el motor de auto-emisión quedan bloqueados por la matriz 1-89); Fase 6.1 cierra dos items pendientes (navegación KPI exacta, verificación Excel). Ninguna fase pasa a "cerrada" formalmente — persisten los gates de aceptación productiva del §10/§15.
- Aprobado por: pendiente.

---

## 15. Pendientes accionables despues de este incremento

Orden tecnico recomendado para continuar sin volver a acoplar el producto al Excel:

1. Conservar el Excel original en almacenamiento seguro o vincularlo a Documento SST; el lote actualmente conserva hash, metadatos y filas normalizadas, pero no el binario descargable.
2. ~~Completar autosave de servidor por paso, indicador de cambios pendientes, recuperacion de red y pruebas de teclado/responsive; agregar preview por responsable, audiencia y faena~~ — avanzado en BLD-11/BLD-12: autosave extendido a Objetivos y Planificacion (matriz avanzada); preview por faena cerrado en `AudiencePreviewPanel`; recuperacion de red cerrada en BLD-12 (`useDebouncedAutosave` captura fallas de red, muestra error y permite reintento manual siempre disponible). Autoguardar Actividades (dialogo con Cancelar) y Evidencias (checklist versionado: cada guardado crea una fila de version nueva) queda deliberadamente manual — ver razones en BLD-11. Falta una pasada dedicada de pruebas de teclado/responsive con herramientas de accesibilidad (axe-core u otra) — los controles nuevos usan elementos nativos/Radix con `aria-label`/`aria-live` ya aplicados, pero no se ejecuto una auditoria de accesibilidad formal.
3. ~~Separar calendario general de la proyeccion anual de 48 celdas y formalizar base corporativa, faenas cubiertas, herencia y excepciones locales~~ — cerrado en BLD-11: `PdtpScheduleHorizon` deriva el horizonte del periodo real del programa (ya no fijo a 12×4); `pdtp_program_worksites`/`pdtp_activity_worksite_exclusions` formalizan faenas cubiertas, herencia (sin membresia = todas) y excepcion puntual. Persiste el limite de esquema `pdtp_activity_schedule` a un unico año con semana 1-4 (CHECK) — multi-año/semanas ISO reales exige remodelar esa tabla, marcado como riesgo residual.
4. Persistir el historial documental y de personas declaradas sin equipararlas automaticamente a usuarios; cerrar round-trip de textos largos y vocabulario C/D.
5. ~~Exponer el motor de obligaciones en una bandeja operacional y conectarlo al job de recordatorios~~ — cerrado en OBL-02 (`/prevencion/pdtp/obligaciones`, cron extendido). Falta unificarla con las actividades `scheduled` de la semana y con pendientes de evidencia (vista `Esta semana` completa), y cubrir suplencias/preferencias de notificacion.
6. ~~Construir el registro reusable de fuentes (selector estructurado por dominio)~~ — cerrado en BLD-11/BLD-12 para MIPER, Legal, Incidentes/CAPA, Capacitación, Inspecciones, CPHS, EPP y Emergencias (`getPdtpCoverage`/`LinkSourceDialog`, cada uno validado por existencia+faena+estado). Solo `campana` queda sin entidad propia (no existe tabla de dominio; cae a texto libre). Falta construir la **matriz 1–89** (qué actividad usa qué fuente, con qué regla de cantidad/evidencia) y el **motor de auto-emisión** (evento operacional → ejecución PDTP automática) — ambos bloqueados por decisión de negocio (§10, pregunta 8), no por código.
7. Implementar bandeja `Esta semana` unificada (ver punto 5), indicadores con denominadores explicitos, reporte de gestion Excel y expediente auditor descargable y scoped.
8. Ejecutar `npm run db:generate` de verificacion despues de `0103` (hecho en OBL-02, `No schema changes`), suite PDTP completa (hecho, ver bitacora OBL-02) y React Doctor al cerrar la siguiente tajada de UI.
9. ~~Reparar el build de produccion~~ — cerrado en BUILD-01 (se quito el `"use server"` duplicado del barrel `admin/productos/actions.ts`; `npm run build` termina en verde).

Requieren decision o evidencia del negocio antes de cerrar su implementacion: faena/estado/evidencia de las seis E; clasificacion y SLA de las 22 actividades sin P; regla multifaena; necesidad de round-trip RE-36; gobierno de plantillas, Legal y eventual sobrepaso de segregacion; matriz 1–89 aceptada; datos productivos, marcha paralela y actas de usuarios/Jefatura/Legal.
