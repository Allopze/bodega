# Programa de Trabajo Preventivo SG-SST (RE-36): qué debe contener una interfaz que lo reemplace

**Fecha:** 2026-09-16
**Fuente única de este análisis:** el libro Excel del programa preventivo 2026 y sus copias. No se revisó código ni documentación del sistema; todo lo que sigue se deriva de las celdas, fórmulas, formatos e imágenes del Excel.

---

## 1. Qué se analizó

| Archivo | Rol | Hojas |
|---|---|---|
| `docs/prevención/SGI Chome_2026/8 Operación/5_SST_Preparación y Respuesta a Emergencias/Documentos SST DS44/DO-43 GS-SST 2026/PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx` | **Versión controlada del SGI (documento RE-36).** Base del análisis. | `PDTP GENERAL`, `CPHS`, `PRF Y Adm. de contrato`, `Sup, JT`, `PRF`, `Adm. de contrato`, `Subgerente operaciones y mant.`, `Capacitación y Campañas` |
| `docs/Prevención Grúas/Informe mensual/2026/CUMPLIMIENTO CHOME/02..06/PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026 (…).xlsx` | Copias mensuales de una faena con ejecución real cargada (feb–jun 2026). Se usaron para ver **cómo se llena** el programa en la práctica. | Mismas hojas, sin `Capacitación y Campañas`; 84 actividades (faltan 13, 27, 29, 31 y 42) |
| `docs/Prevención Biodiversa/…/PROGRAMA POR CARGO/PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026 POR CARGO SUPERVISOR Y PREVENCION.xlsx` | Variante **por persona**: una hoja por trabajador con nombre y apellido. | `SUPERVISOR FRANCISCO AMESTICA`, `PREVENCION MARIA JOSE MARTINEZ` |
| Copias en Cholguán, Cabrero/Masisa, Biodiversa, DIEGO | Confirman que **cada faena mantiene su propia copia** del mismo formato. | Variantes con 1, 7 u 8 hojas |

Cifras del programa general 2026: **8 objetivos, 89 actividades, 1.039 ocurrencias planificadas al año**, 48 semanas (12 meses × 4 "semanas"), 96 columnas de cronograma (P y E por semana).

---

## 2. Anatomía del Excel: qué hay en cada bloque

### 2.1 Cabecera del documento
- Logo de la empresa (imagen), título `PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026`, código `RE-36`.
- Bloque **"Indicadores de desempeño del plan de trabajo anual"** con 7 campos: *Objetivo específico* (`Cumplimiento: Ejecución de actividades programadas`), *Tipo de indicador* (`Proceso`), *Fórmula de medición* (vacía), *Meta* (`90%`), *Periodicidad* (`Mensual`), *Responsable de medición* (`Cada faena`), *Resultado* (vacío).

### 2.2 Cronograma (el corazón del documento)
- Leyenda: `P: Planeado  E: Ejecutado`.
- Columnas fijas: **OBJETIVO** (celda combinada vertical que agrupa filas) · **N°** · **PROGRAMA** (qué se hace) · **ACTIVIDAD** (cómo/detalle/quién concretamente) · **RESPONSABLES** (texto libre con siglas separadas por coma).
- Calendario: 12 meses × 4 semanas (`Sem 1..Sem 4`, no son semanas ISO ni fechas reales) × 2 celdas (`P`, `E`).
- Banda naranja `Planeación del plan de trabajo anual` sobre la primera fila de actividades (aparece en todas las hojas, incluso donde no aplica).
- **8 objetivos** que agrupan las 89 actividades:

| # | Objetivo | Actividades |
|---|---|---|
| 1 | Fortalecer el liderazgo de seguridad y salud en el trabajo | 1–9 |
| 2 | Mantener a la empresa y sus sucursales entre los márgenes de la normativa legal vigente | 10–34 |
| 3 | Detectar, evaluar, medir y corregir condiciones y conductas sub-estándar | 35–50 |
| 4 | Reforzar la cultura preventiva del personal | 51–60 |
| 5 | Elementos de protección personal (EPP) | 61–65 |
| 6 | Controlar la aplicación del procedimiento de accidentes e incidentes | 66–78 |
| 7 | Controlar la aplicación del procedimiento de contingencia y sus instructivos | 79–84 |
| 8 | Campañas de seguridad y salud en el trabajo | 85–89 |

### 2.3 Semántica de las celdas P y E
- **P (planeado):** cantidad esperada en esa semana. Casi siempre `1`; `5` para los diálogos diarios por turno (act. 38, 240 al año); vacío = no planificado.
- **E (ejecutado):** vacío = todavía no reportado · `0` = no se hizo · `≥1` = se hizo. En la práctica se usa de dos formas incompatibles: como **bandera** (1 = cumplido) y como **conteo de registros** (20 check-lists de contenedores, 18 de equipos, 6 alcotest en una semana).
- **Formato condicional (semáforo):** E = 0 → rojo `FF0000`; E ≥ 1 → verde `00B050`; vacío → sin color. P tiene escala de color de 1 (naranja `FFC000`) a 5 (más intenso).
- **Barra achurada (imagen superpuesta a la fila):** significa `Actividad con frecuencia, cada vez que sea necesario`. Marca 23 actividades "a demanda" (11, 12, 14, 15, 16, 18, 21, 52, 54, 66–78, 87). Dos de ellas (54 y 87) además tienen semanas P: son **mixtas**. La act. 57 no tiene ni P ni barra: quedó sin planificar.

### 2.4 Patrones de frecuencia que existen hoy (derivados de las celdas P)

| Patrón | Cómo se ve en el Excel | Actividades |
|---|---|---|
| Semanal todo el año | `1` en las 48 semanas | 8 (6, 25, 26, 28, 41, 53, 62; 38 con `5`) |
| Mensual en una semana fija (S1, S2, S3 o S4) | un `1` por mes, misma semana | 30 |
| Quincenal | `1` en S1/S3 o S2/S4 | 2 (37, 40) |
| Campaña (todas las semanas de 1–2 meses) | `1111` en un bloque de meses | 3 (85, 88, 89) + 87 |
| Puntual (1–6 ocurrencias en fechas concretas) | celdas sueltas | 21 |
| Irregular | mezcla (act. 27: quincenal ene–abr, mensual may–dic) | 1 |
| A demanda (sin P, barra achurada) | fila sin números | 21 |
| Mixta (P + barra) | ambas cosas | 2 |

Muchas actividades mensuales empiezan en febrero o se corren de semana en enero (ej. 19, 30, 31, 51: "Ene S4, luego S2/S3 cada mes"), es decir, la planificación se hizo a mano celda por celda.

### 2.5 Bloque "Gestión del Programa" (indicadores calculados)
Debajo del cronograma, por cada **semana** (aunque el rótulo diga "mensual"):

| Fila | Fórmula | Nota |
|---|---|---|
| Actividades Programadas (P) | `=SUM(F14:F102)` | suma de la columna P de la semana |
| Actividades Ejecutadas (E) | `=SUM(G14:G102)` | suma de la columna E de la semana |
| Porcentaje de Cumplimiento "Mensual" | `=IFERROR(E/P,"")` | en realidad es **semanal** |
| Porcentaje de Cumplimiento Trimestral | `=AVERAGE(F107:AC107)` | **promedio simple de los % semanales** del trimestre, no `ΣE/ΣP`; las semanas con P = 0 devuelven `""` y quedan fuera del promedio |

Los rangos son fijos (`14:102`): si se insertan filas fuera del rango, los totales dejan de contarlas.

### 2.6 Firmas, control de cambios y glosario (pie del documento)
- **Elaborado por / Aprobado por:** nombre, firma (imagen), fecha, cargo. En 2026: elaborado por la Jefa Dpto. Prevención de Riesgos (27-01-2026), aprobado por la Gerente Legal y RRHH (04-02-2026).
- **Control de cambios:** tabla `Fecha | Descripción` en texto libre. Único registro: 12-02-2026, "ítem 3 se agrega difusión al CPHS; ítem 32 envío de registros alcotest; ítem 33 inspecciones de equipos responsable PRF".
- **Glosario de siglas:** JDPR, PRF, Sup., JT, CPHS. Faltan siglas usadas en RESPONSABLES: `JM`, `Adm. de contrato`, `Sub. Gerente Operaciones`, `Gerente Legal y RRHH`, `Conductores, operadores y choferes`.
- **Leyenda** de la barra achurada.

### 2.7 Hojas por cargo (vistas derivadas a mano)
Cada hoja repite el layout completo (cabecera, cronograma, totales, firmas, control de cambios, glosario) con un **subconjunto de actividades copiado y pegado**:

| Hoja | Actividades | Desvíos respecto a `PDTP GENERAL` |
|---|---|---|
| CPHS | 11–14 (4) | ninguno |
| PRF Y Adm. de contrato | 76 | act. 6: texto y responsables distintos; act. 20: responsables distintos; act. 28: texto distinto; 6 celdas P distintas; **66 filas ocultas** (filtro manual: solo quedan visibles 10 actividades) |
| Sup, JT | 18 | act. 38: texto distinto; 64, 66, 68, 71: responsable `JT` → `Sup, JT` |
| PRF | 41 | ninguno |
| Adm. de contrato | 28, 72 (2) | act. 28: texto distinto; 4 celdas P distintas |
| Subgerente operaciones y mant. | 5 (1) | ninguno |
| Capacitación y Campañas | 54–60, 85–89 (12) | calendario **empieza en febrero** (11 meses); trimestres desplazados (no existe "primer trimestre"); 11 celdas P distintas de las del general |

La variante **POR CARGO** va un paso más allá: una hoja por **persona** (nombre y apellido) con las actividades de su cargo, y ahí el E se usa como conteo (2 extintores, 20 contenedores…).

### 2.8 Copias por faena y snapshots mensuales
- Cada faena tiene su propio archivo con el mismo formato y un subconjunto de actividades (Grúas eliminó 13, 27, 29, 31 y 42).
- La ejecución mensual se reporta **guardando una copia del archivo completo** en la carpeta del mes (`02.- FEBRERO`, `03.- MARZO`, …, `06.- JUNIO`). Cinco copias = cinco fotos del mismo programa.

---

## 3. Casos de uso: qué hace la gente con el Excel

| # | Caso de uso | Quién | Cómo se hace hoy |
|---|---|---|---|
| CU-1 | Definir el programa anual corporativo | JDPR | Editar objetivos, actividades, responsables y marcar semanas P celda por celda |
| CU-2 | Aprobar y firmar el programa | JDPR + Gerente Legal y RRHH | Escribir nombre/cargo/fecha y pegar imagen de firma; enviar por correo (act. 1) |
| CU-3 | Difundir el programa | JDPR, PRF | Reunión online con gerencias (act. 2), reunión en faena con CPHS (act. 3) |
| CU-4 | Adaptar el programa a cada faena | PRF / JDPR | Copiar el archivo, borrar filas que no aplican, retocar semanas |
| CU-5 | Derivar vistas por cargo y por persona | PRF | Copiar filas a hojas nuevas, ocultar filas, renombrar hojas con el nombre de la persona |
| CU-6 | Registrar la ejecución semanal | PRF, Sup, JT, Adm. de contrato | Escribir `1`/`0`/cantidad en la celda E de la semana; ver semáforo |
| CU-7 | Registrar actividades a demanda (accidentes, ingresos, CPHS) | JT, PRF, Adm. de contrato | No hay dónde: la fila achurada no tiene P; a veces se escribe E sin P |
| CU-8 | Medir cumplimiento vs meta 90 % | Cada faena; Subgerente (act. 5); JDPR (act. 4) | Leer las filas de totales (semanal y trimestral) |
| CU-9 | Reportar mensualmente a gerencia y mandante | PRF, Adm. de contrato | Guardar copia del archivo en la carpeta del mes y enviarla por correo (act. 4, 5, 7) |
| CU-10 | Registrar cambios al programa | JDPR | Escribir fecha y descripción en la tabla de control de cambios y propagar a mano a todas las hojas y copias |
| CU-11 | Consultar / imprimir el programa | Todos | Abrir el Excel, congelar/ocultar columnas a mano, imprimir |
| CU-12 | Revisar el programa en la reunión semanal de faena (act. 6) | PRF, Adm. de contrato, Sup, JT | Proyectar el Excel y repasar filas |

---

## 4. Problemas del Excel que la interfaz debe resolver (con evidencia)

| # | Problema | Evidencia en el archivo | Qué debe garantizar la interfaz |
|---|---|---|---|
| P-1 | **Desfase de columnas**: valores escritos en la columna E en vez de P | Act. 6, fila 19: enero tiene `1` en G/I/K/M (columnas E) y nada en P. El formato condicional tuvo que parcharse celda a celda (`G19`, `H19`, `I19`, `J19`…) | P y E son campos distintos con validación; imposible confundirlos |
| P-2 | **Cumplimiento > 100 %** | Copia de junio: 106 %, 107 % en enero. Variante por persona: 450 % semanal, 129 % trimestral | Regla explícita: E se compara con P y se topa (o P expresa la cantidad esperada) |
| P-3 | **E como bandera vs E como conteo** | General: siempre `1`. Por persona: `2`, `6`, `18`, `20` | Separar "cantidad esperada" y "cantidad realizada" del estado "cumplida / no cumplida" |
| P-4 | **El indicador "mensual" es semanal y el trimestral es un promedio de promedios** | Fórmulas `E/P` por columna semanal; `AVERAGE` de los % | Definir y mostrar la fórmula; calcular ΣE/ΣP por semana, mes, trimestre y año |
| P-5 | **Vistas por cargo desincronizadas** | 5 textos y 21 celdas P difieren entre hojas; `Capacitación y Campañas` arranca en febrero | Una sola fuente de datos; las vistas por cargo/persona/tema son filtros |
| P-6 | **Copias por faena y por mes divergen** | Grúas sin actividades 13, 27, 29, 31, 42; cinco archivos mensuales del mismo programa | Instancia por faena vinculada al maestro; historial en vez de copias |
| P-7 | **Actividades a demanda no se pueden contar ni planificar** | La marca es una imagen PNG achurada, no un dato | Tipo de frecuencia como atributo; registro de ocurrencias sin planificación previa |
| P-8 | **Responsables en texto libre inconsistente** | `Adm. de contrato` / `Adm. de Contrato`, `PRF ` (espacio final), `Sup , JT`, `JM` sin glosario | Catálogo de roles; asignación multi-rol y por persona |
| P-9 | **Actividades duplicadas solo por el responsable** | 30/31 (alcotest PRF vs Sup/JT), 33/34, 37/38, 64/65, 68/70 | Modelo actividad × responsable, o una actividad con varias asignaciones y frecuencias |
| P-10 | **"Sem 1–4" no son fechas** | Meses con 5 semanas no existen; no hay fecha de ejecución real | Calendario real (semanas con fecha de inicio/fin) y fecha efectiva de ejecución |
| P-11 | **Sin evidencia ni motivo** | No hay columna de respaldo, comentario, ejecutor ni causa de no cumplimiento | Adjuntos/enlaces a registros, comentario y motivo por ocurrencia |
| P-12 | **Fórmulas con rangos fijos y filas ocultas como filtro** | `SUM(F14:F102)`; 66 filas ocultas en `PRF Y Adm. de contrato` | Totales calculados por el sistema; filtros reales |
| P-13 | **Control de cambios manual e incompleto** | Un solo registro en texto libre; cambios propagados a mano | Bitácora automática (quién, cuándo, qué campo, antes/después) y versiones |
| P-14 | **Glosario incompleto** | Faltan JM, Adm. de contrato, Subgerente, Gerente Legal y RRHH, Conductores | Catálogo de roles con sigla y descripción, visible desde cualquier pantalla |
| P-15 | **Vacío vs 0 es solo visual** | Sin color = pendiente; rojo = no hecho | Estados explícitos: pendiente, cumplida, no cumplida, parcial, reprogramada, no aplica |

---

## 5. Especificación de la interfaz

### 5.1 Principios
1. **Un solo maestro, muchas vistas.** El programa corporativo se define una vez; faena, cargo, persona y tema (capacitaciones/campañas) son filtros, no copias.
2. **Planificación ≠ ejecución.** P y E viven en registros distintos con reglas propias.
3. **Calendario real.** Cada "Sem N" corresponde a un rango de fechas; la ejecución tiene fecha efectiva.
4. **Todo lo que hoy es formato (color, imagen achurada, fila oculta) pasa a ser dato.**
5. **El Excel RE-36 sigue existiendo como salida**: debe poder exportarse con el mismo layout para auditorías y mandantes.

### 5.2 Modelo de datos (derivado del Excel)

| Entidad | Campos que el Excel ya contiene | Campos que faltan y la interfaz debe agregar |
|---|---|---|
| **Programa** | año, código (`RE-36`), título, meta (90 %), periodicidad de medición, responsable de medición, tipo de indicador, objetivo específico, fórmula, resultado | estado (borrador / en aprobación / vigente / cerrado), versión, faena (o "corporativo") |
| **Objetivo** | nombre, orden, actividades agrupadas | descripción corta, código |
| **Actividad** (maestro) | N°, programa (qué), actividad (cómo), responsables, objetivo, marca "a demanda", referencia normativa citada en el texto (DS 44, DS 594, DO-36, DO-48, RE-28, RIOHS) | identificador estable (independiente del N° visible), tipo de frecuencia (`semanal`, `mensual`, `quincenal`, `puntual`, `campaña`, `a demanda`, `mixta`), cantidad esperada por ocurrencia, unidad ("por equipo", "por turno", "por trabajador"), evidencia requerida (formato/anexo), activa/inactiva |
| **Responsable** | siglas en texto libre | catálogo de roles (sigla, nombre, descripción) y personas asignadas por faena |
| **Asignación** (actividad × faena × rol/persona) | implícita en hojas por cargo y por persona | rol, persona, fecha de vigencia |
| **Planificación** (actividad × faena × semana) | P por celda | semana con fecha inicio/fin, cantidad planificada, origen (patrón o manual), versión |
| **Ejecución** (ocurrencia) | E por celda | fecha efectiva, cantidad realizada, estado, ejecutor, comentario, motivo de no cumplimiento, evidencia (archivo/enlace), reprogramación a otra semana |
| **Aprobación** | elaborado por, aprobado por (nombre, cargo, fecha, firma) | firma digital o registro de aprobación con usuario y timestamp; bloqueo de edición del plan tras aprobar |
| **Cambio** (bitácora) | fecha, descripción | usuario, campo, valor anterior/nuevo, actividad afectada, versión resultante |
| **Snapshot mensual** | copia del archivo en carpeta del mes | corte con fecha, valores congelados, exportable |

### 5.3 Pantallas y módulos

#### M1. Programas
- Lista de programas por año y faena con estado, versión, % cumplimiento a la fecha y meta.
- Crear programa: desde cero, **copiando el año anterior** o **copiando el corporativo a una faena** (hoy CU-4).
- Cabecera editable con los 7 campos del bloque de indicadores más código, título y logo.

#### M2. Catálogo de objetivos y actividades
- Árbol objetivo → actividades, con reordenamiento y numeración visible (N°) que se recalcula sin romper referencias.
- Ficha de actividad: qué (programa), cómo (actividad), objetivo, responsables (roles del catálogo, multi-selección), tipo de frecuencia, cantidad esperada y unidad, marca "a demanda", documentos de referencia, evidencia esperada, activa/inactiva.
- Búsqueda y filtros por objetivo, rol, frecuencia, texto.
- Marcar una actividad como "no aplica" en una faena en vez de borrar la fila (P-6).

#### M3. Planificador anual (reemplaza el cronograma)
- Grilla actividades × 48 semanas (o 52/53 con calendario real), cabecera de meses y semanas fija al hacer scroll, columnas fijas N° / programa / actividad / responsables (hoy se pierden al desplazarse por 96 columnas).
- Celda = cantidad planificada; escala de color por cantidad (hereda la escala 1→5).
- **Patrones de planificación** que generen las celdas de una vez (los 8 patrones de §2.4): semanal, mensual en semana N, quincenal, campaña (rango de meses), puntual (fechas), diario (n por semana), a demanda.
- Edición masiva: aplicar un patrón a varias actividades, desplazar un mes, copiar la fila de otra actividad, limpiar.
- Fila de totales P por semana / mes / trimestre / año (hoy fila "Actividades Programadas").
- Vista compacta por mes (12 columnas) y detallada por semana (48).
- Indicador de carga por rol: cuántas ocurrencias planificadas por semana tiene cada responsable (hoy no existe; act. 38 son 5 diálogos por semana además de 48 reuniones, 48 reportes, etc.).

#### M4. Registro de ejecución (semana en curso)
- Vista "esta semana" por faena: lista de actividades planificadas con P, campo de cantidad realizada, estado y acciones rápidas (cumplida / no cumplida con motivo / parcial / reprogramar a la semana siguiente).
- Por ocurrencia: fecha efectiva, ejecutor, comentario, evidencia (archivo o enlace al registro: check-list, acta, alcotest, entrega de EPP…).
- Semáforo heredado: verde ≥ planificado, rojo 0, ámbar parcial, gris pendiente.
- Semanas anteriores editables solo con permiso y con registro en bitácora (hoy cualquiera edita cualquier celda).
- Alerta de atraso: actividades planificadas en semanas cerradas sin ejecución reportada.

#### M5. Actividades a demanda
- Botón "registrar ocurrencia" para actividades con frecuencia "cada vez que sea necesario" (inducciones, accidentes, ingresos, CPHS): fecha, cantidad, evidencia, comentario, evento asociado (p. ej. un accidente dispara 66–78).
- Estas ocurrencias **no entran** al denominador de cumplimiento salvo que tengan P; se muestran como conteo aparte ("13 inducciones este mes").
- Para actividades mixtas (54, 87) conviven ambas cosas.

#### M6. Mi programa (vistas por cargo y por persona)
- Filtro por rol (PRF, Sup/JT, Adm. de contrato, CPHS, Subgerente, JDPR) que reproduce las hojas por cargo, y por persona (reemplaza las hojas `SUPERVISOR FRANCISCO AMESTICA`, etc.).
- Para el usuario que entra: "mis actividades de esta semana" con registro directo (M4).
- Vista temática "Capacitación y Campañas" (54–60, 85–89) como filtro por objetivo/tipo, con el mismo calendario que el resto (P-5).
- Cada vista tiene sus propios totales, calculados con las mismas reglas (§5.4).

#### M7. Indicadores y tablero de cumplimiento
- KPI principal: **% cumplimiento = ΣE_topado / ΣP** por semana, mes, trimestre y año, comparado con la meta (90 %), con semáforo.
- Desgloses: por faena, objetivo, rol, persona, tipo de frecuencia; tendencia semanal; ranking de actividades más incumplidas; carga planificada vs realizada por rol.
- Conteo de actividades a demanda registradas (aparte).
- Selector de fórmula documentado en pantalla (P-4): mostrar cómo se calcula.
- Corte mensual: botón "cerrar mes" que congela un snapshot (reemplaza las carpetas `02.- FEBRERO`…).

#### M8. Aprobación, versiones y control de cambios
- Flujo: borrador → enviado a aprobación → aprobado/vigente; registra elaborado por y aprobado por (usuario, cargo, fecha, firma).
- Tras aprobar, cambios al plan generan **nueva versión** con bitácora automática (usuario, fecha, actividad, campo, antes/después) más descripción libre (hoy tabla `Fecha | Descripción`).
- Comparador de versiones (qué actividades/semanas cambiaron).
- Difusión: marcar "difundido a gerencias" / "difundido a faena y CPHS" con fecha (act. 1–3).

#### M9. Catálogo de roles y leyenda
- Tabla de siglas (JDPR, PRF, Sup, JT, CPHS, Adm. de contrato, JM, Subgerente Operaciones, Gerente Legal y RRHH, Conductores/operadores/choferes) con descripción, editable, visible como ayuda contextual en todas las pantallas.
- Leyenda de estados y colores (reemplaza la leyenda achurada y el semáforo implícito).

#### M10. Exportación e importación
- **Exportar a Excel con el layout RE-36** (cabecera, cronograma P/E, totales, firmas, control de cambios, glosario), general y por cargo/persona/tema, para auditorías, mandantes y CPHS.
- Exportar PDF imprimible (hoy se imprime el Excel) y snapshot mensual.
- **Importar desde el Excel actual** (programa 2026 y copias por faena) para poblar el maestro, con reporte de anomalías (P-1, P-2, P-8).
- Envío por correo del reporte mensual a la lista de distribución que hoy aparece en las actividades 4, 5, 7, 70 y 74 (gerencias, subgerente, JDPR).

#### M11. Permisos
| Rol | Puede |
|---|---|
| JDPR | Todo: maestro, aprobación, versiones, consolidado de faenas |
| Gerente Legal y RRHH | Aprobar, ver consolidado |
| Subgerente Operaciones | Ver consolidado por faena y por administrador de contrato (act. 5) |
| PRF (faena) | Adaptar su faena, planificar, registrar ejecución de todas las actividades de su faena, cerrar mes |
| Adm. de contrato | Registrar sus actividades, revisar cierres (act. 28), ver tablero de su faena |
| Sup / JT | Registrar sus actividades; ver su programa |
| CPHS | Ver programa de la faena; registrar 11–14 |
| Conductores / operadores | (act. 25) registrar o ver el reporte diario, si se decide incluirlos |

### 5.4 Reglas de cálculo (a fijar explícitamente)
1. `P_semana = Σ cantidad planificada` de las actividades activas en la faena.
2. `E_semana = Σ min(cantidad realizada, cantidad planificada)` por actividad (evita P-2). Se guarda además la cantidad real sin topar para reportes de volumen.
3. `% semana = E_semana / P_semana`; si `P_semana = 0` → sin dato (no 0 %).
4. `% mes / trimestre / año = ΣE / ΣP` del período (no promedio de porcentajes).
5. Las ocurrencias a demanda (sin P) no entran al cálculo; se reportan como conteo.
6. Estado por celda: `pendiente` (semana abierta, sin registro), `cumplida` (E ≥ P), `parcial` (0 < E < P), `no cumplida` (E = 0 en semana cerrada), `reprogramada`, `no aplica`.
7. Meta configurable por programa (hoy 90 %); semáforo del período: verde ≥ meta, ámbar entre meta − 10 pp y meta, rojo bajo eso.

### 5.5 Validaciones
- P y E numéricos ≥ 0; E no puede registrarse en una semana sin P salvo en actividades a demanda o mixtas (P-1).
- Aviso (no bloqueo) cuando E > P, con la cantidad real conservada.
- Responsables solo desde el catálogo; una actividad debe tener al menos un responsable.
- N° único y contiguo dentro del programa; el identificador interno no cambia al renumerar.
- No se puede aprobar un programa con actividades sin frecuencia definida (hoy act. 57).
- Semanas fuera del año o meses sin 4/5 semanas: el calendario real decide.
- Cambios en un programa aprobado exigen descripción de cambio (control de cambios).

### 5.6 Diseño visual heredado que conviene conservar
- Grilla tipo cronograma con meses como cabecera superior y semanas debajo; celdas pequeñas y densas.
- Semáforo verde/rojo para E, escala de color para P.
- Columnas de texto anchas (programa 40, actividad 27, responsables 29 caracteres) y celdas P/E estrechas (3–4 caracteres).
- Agrupación visual por objetivo (celda vertical rotada 90°).
- Pie con firmas, control de cambios y glosario en la exportación.

---

## 6. Trazabilidad Excel → interfaz

| Elemento del Excel | Módulo |
|---|---|
| Logo, título, código RE-36, bloque de indicadores | M1 cabecera; M10 exportación |
| Columna OBJETIVO (celdas combinadas) | M2 árbol de objetivos |
| N°, PROGRAMA, ACTIVIDAD, RESPONSABLES | M2 ficha de actividad; M9 catálogo de roles |
| 96 columnas P/E × 4 semanas × 12 meses | M3 planificador (P) + M4 registro (E) |
| Barra achurada "cada vez que sea necesario" | M2 tipo de frecuencia "a demanda"; M5 ocurrencias |
| Formato condicional rojo/verde, escala de color | M4 semáforo; M3 escala |
| Filas "Gestión del Programa" (SUM, E/P, AVERAGE) | M7 indicadores con reglas §5.4 |
| Hojas por cargo y hoja Capacitación y Campañas | M6 vistas filtradas |
| Hojas por persona (POR CARGO) | M6 asignación a personas |
| Copias por faena | M1 instancia por faena; M2 "no aplica" |
| Copias mensuales `02.- FEBRERO`… | M7 cierre de mes / snapshot |
| Elaborado por / Aprobado por / firmas | M8 aprobación |
| Tabla Control de cambios | M8 bitácora y versiones |
| Glosario y leyenda | M9 |
| Filas ocultas como filtro | M6 filtros |
| Envío por correo (act. 1, 4, 5, 7, 32, 70, 74) | M10 difusión |

---

## Anexo A. Inventario de las 89 actividades del programa general 2026

Frecuencia derivada de las celdas P de `PDTP GENERAL` (para la act. 6 se leyeron las celdas desplazadas de enero como P). "A demanda" = fila con barra achurada.

| N° | Objetivo | Programa (qué) | Actividad (cómo) | Responsables | Frecuencia planificada (según celdas P) | P/año | A demanda |
|---|---|---|---|---|---|---|---|
| 1 | 1. Liderazgo SST | Aprobar el Programa de Prevención de Riesgos | Envio por correo | JDPR | Única vez: Ene S4 | 1 |  |
| 2 | 1. Liderazgo SST | Difundir el Plan a todos los niveles de la gerencias y subgerencia | Reunión Online | JDPR | Única vez: Feb S1 | 1 |  |
| 3 | 1. Liderazgo SST | Difundir el Plan a todos los niveles de la organización en las faenas y CPHS | Reunión en la faena | PRF | Única vez: Feb S1 | 1 |  |
| 4 | 1. Liderazgo SST | Difundir los resultados de las actividades preventivas de cada faena | Envia por correo a gerencias y subgerente operaciones | JDPR | Mensual, semana 3 (Feb–Dic) | 11 |  |
| 5 | 1. Liderazgo SST | Control de cumplimiento de las actividades de gestión preventiva de la linea de mando. | Solicitar a cada administrador de contrato status de cumplimiento | Sub. Gerente Operaciones | Mensual, semana 3 (Feb–Dic) | 11 |  |
| 6 | 1. Liderazgo SST | Reunión revisión actividades SG-SST (chome y planta) Incidentes etc. | Reunión en la faena | PRF, Adm. de contrato, Sup, JT | Semanal todo el año | 48 |  |
| 7 | 1. Liderazgo SST | Envio de estadistica de cada faena (indicadores de seguriadad) | Envia por correo | PRF | Mensual, semana 1 | 12 |  |
| 8 | 1. Liderazgo SST | Reunión revisión gestión preventiva SG-SST | Reunión online | Gerente Legal y RRHH, JDPR,PRF | Mensual, semana 3 (Feb–Dic); salvo Feb en S2 | 11 |  |
| 9 | 1. Liderazgo SST | Reunión revisión gestión preventiva SG-SST | Reunión presencial oficina central | Gerente Legal y RRHH, JDPR,PRF | Mensual, semana 1 (Mar–Dic) | 10 |  |
| 10 | 2. Normativa legal | Verificar el cumplimiento de las condiciones ambientales básicas en los lugares de trabajo, según lo establecido en e… | Registro de inspección en formato | PRF | Mensual, semana 3 (Feb–Dic) | 11 |  |
| 11 | 2. Normativa legal | Constituir el o los Comités Paritarios cuando proceda y velar por el cumplimiento de sus funciones, según lo establec… | Revisar requisitos de acuerdo a loa legislación vigente | PRF, Adm. de contrato | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 12 | 2. Normativa legal | Los integrantes del comité paritario deben cumplir con los cursos de acuerdo a lo que indica el DS N°44 | Curso orientación en prevención de riesgos de 8 hrs (para todos los representantes) y un programa de formación para i… | PRF, Adm. de contrato | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 13 | 2. Normativa legal | Comité paritario debera reunir una vez al mes dejando evidencia de dicha reunión o cada vez que ocurra un accidente | registro acta reunión CPHS (revisión actividades del programa, indicadores de seguridad, anasis de accidentes e incid… | PRF, Adm. de contrato | Mensual, semana 3 | 12 |  |
| 14 | 2. Normativa legal | Crear programa con plan de trabajo para comité paritario (cumplir todad las actividades de dicho programa de acuerdo … | Cumplir con las actividades del programa, indicadores de seguridad, anasis de accidentes e incidentes, capacitaciones | PRF, Adm. de contrato, CPHS | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 15 | 2. Normativa legal | Dictar charlas de inducción al personal nuevo (IRL) o que sea cambiado de puesto de trabajo o cargo de acuerdo a lo q… | Actividad en conjunto con jefe directo y CPHS de acuerdo a lo que indica DS 44 | PRF, Sup, JT , CPHS | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 16 | 2. Normativa legal | Realizar Prueba de evaluación capacitación IRL | Todo trabajador nuevo debe realizar la evaluación. | PRF | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 17 | 2. Normativa legal | Identificación de personas trabajadoras especialmente sencibles (RE-28) | Todas las personas trabajadoras | PRF | Mensual, semana 4 (Feb–Oct) | 9 |  |
| 18 | 2. Normativa legal | Entregar al momento de la incorporación a la empresa del Reglamento Interno de Orden Higiene y Seguridad a cada traba… | Registro de capacitación y entrega de RIOHS (Capacitar a los trabajadores sobre los temas relevantes de Seguridad del… | PRF | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 19 | 2. Normativa legal | Mantener actualizada la carpeta de requisitos legales de las empresas, , entrega EPP, IRL,RIOHS con cartas de seremi … | Mantener carpeta de arranque, carpetas trabajadores, las cartas conductoras | PRF | Mensual, semana 2; salvo Ene en S4 | 12 |  |
| 20 | 2. Normativa legal | Reunión con empresa mandante y programas de trabajo empresas mandante | De acuerdo a los solicitado en cada faena por partes interesadas | PRF, Adm. de contrato | Mensual, semana 1 | 12 |  |
| 21 | 2. Normativa legal | Informes, cierres y seguimiento de accidentes e incidentes | Revisar los cierres y envios a las partes interesadas | PRF, Adm. de contrato | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 22 | 2. Normativa legal | Mantener control de las plataformas de la Empresa y de la empresa mandante. | Revisión de la plataforma e informar vencimientos, coordinaciones para evitar personal bloqueado | PRF, Adm. de contrato | Mensual, semana 1 | 12 |  |
| 23 | 2. Normativa legal | Registro entrega de Elementos de protección personal (EPP) de acuerdo al cargo | Cada vez que ingresa un trabajador nuevo, por recambios, se debe mantener este registro | PRF | Mensual, semana 1 | 12 |  |
| 24 | 2. Normativa legal | Inspección estado de extintores | Debe realizarse por cada extintor existente en la faena y en los talleres , llevar un inventario de estos enumerarlos | PRF, Sup, JT | Mensual, semana 2 | 12 |  |
| 25 | 2. Normativa legal | Realizar report de uso diario de equipos | Este se realiza al inicio del turno, la cantidad será de acuerdo a la catidad de equipos que tenga la faena | Conductores, operadores y choferes | Semanal todo el año | 48 |  |
| 26 | 2. Normativa legal | Revisión y firma del report de uso diario de equipos | La realiza el Sup o JT, esto de acuerdo al organigrama de la faena. la cantidad será de acuerdo a la catidad de equip… | Sup, JT | Semanal todo el año | 48 |  |
| 27 | 2. Normativa legal | Inspección taller de mantención y bodega de acopio RESPEL | La debe realizar el prevencionista en conjunto con el encargado de taller e informar un resumen de hallazgos | PRF | Irregular: Ene S1/3, Feb S1/3, Mar S1/3, Abr S1/3, May S3, Jun S3, Jul S3, Ago S3, Sep S3, Oct S3, Nov S3, Dic S3 | 16 |  |
| 28 | 2. Normativa legal | Revisar y cierra las inspecciones de estado de equipos (camiones, equipos,carros, contenedores) | Revisar las inspecciones una vez sean recibidas, para ver si los temas mencionados se levantaro para cierre, en reuni… | JM, Adm. de contrato | Semanal todo el año | 48 |  |
| 29 | 2. Normativa legal | Realizar lista de chequeo contedores, de acuerdo a numero de contenedores de la faena | La realiza el Sup o JT, esto de acuerdo al organigrama de la faena. la cantidad será de acuerdo a la catidad de equip… | Sup, JT | Mensual, semana 2 | 12 |  |
| 30 | 2. Normativa legal | Realizar alcotest | Prevencionista turno administrativo realizará el alcotest de acuerdo a procedimiento DO-48 | PRF | Mensual, semana 3; salvo Ene en S4 | 12 |  |
| 31 | 2. Normativa legal | Realizar alcotest | Jefe de terrenos o supervisores realizaran alcotest en los turnos, de acuerdo al procedimiento DO-48 | Sup, JT | Mensual, semana 3; salvo Ene en S4 | 12 |  |
| 32 | 2. Normativa legal | Envio registros alcotest, según DO-48 | Prevencionista debe enviar por correo | PRF | Mensual, semana 1 (Feb–Dic) | 11 |  |
| 33 | 2. Normativa legal | Realizar lista de chequeo estado de equipos y documentación de maquinarias (camiones y equipos, carros, bateas) Canti… | La realiza el PRF, esto de acuerdo al organigrama de la faena. la cantidad será de acuerdo a la catidad de equipos qu… | PRF | Mensual, semana 4 (Feb–Dic) | 11 |  |
| 34 | 2. Normativa legal | Realizar lista de chequeo estado de equipos y documentación de maquinarias (camiones y equipos, carros, bateas) Canti… | La realiza el Sup o JT, esto de acuerdo al organigrama de la faena. la cantidad será de acuerdo a la catidad de equip… | Sup, JT | Mensual, semana 3 | 12 |  |
| 35 | 3. Condiciones y conductas | Mantener y actualizar inventario de riesgos MIPER , identificando los procesos, cargos,equipos, materiales y áreas. | Revisar todas las actividades realizadas en el contrato se encuentren en la matriz rutinarias y no rutinarias en conj… | PRF | Mensual, semana 3 | 12 |  |
| 36 | 3. Condiciones y conductas | Difusión de matriz de riesgos MIPER | Difundir a las partes interesadas de acuerdo al cargo y dejar registro | PRF | Mensual, semana 4 | 12 |  |
| 37 | 3. Condiciones y conductas | Realizar Charlas de Seguridad para reforzar las conductas seguras. Estas charlas tienen como objetivo generar un espa… | Realizar charla, los trabajadores tambien puede hacer la charla (para que sea participativa) | PRF | Quincenal (semanas 2 y 4) | 24 |  |
| 38 | 3. Condiciones y conductas | Realizar Charlas de Seguridad para reforzar las conductas seguras. Estas charlas tienen como objetivo generar un espa… | Dialogos se realizaran por turno todos los días | Sup, JT | Semanal todo el año, 5 por semana | 240 |  |
| 39 | 3. Condiciones y conductas | Realizar Obeservación para corregir desviaciones de conductas incorrectas sobre normas, procedimientos y/o estandares | Cada jefe directo en las distintas areas de trabajo | Sup, JT | Mensual, semana 2 | 12 |  |
| 40 | 3. Condiciones y conductas | Realizar Inspecciones para corregir desviaciones en las área de trabajo. | Cada jefe directo en las distintas areas de trabajo | Sup, JT | Quincenal (semanas 1 y 3) | 24 |  |
| 41 | 3. Condiciones y conductas | Caminatas de seguridad, levantamiento de inspecciones y observaciones en terreno | Se realizaran actividad junto a Prevencionista y adm. De contrato en las diferentes áreas de trabajo | PRF, Adm. de contrato | Semanal todo el año | 48 |  |
| 42 | 3. Condiciones y conductas | Controlar documentación de la empresa que realiza el control de sanitización y plagas | Solicitar informe de visitas | PRF, Adm. de Contrato | Mensual, semana 4 | 12 |  |
| 43 | 3. Condiciones y conductas | Realizar y revisar los procedimiento de trabajo seguro, estandares operacionales u otros documentos que tienen relaci… | se deben revisar los documentos existentes y definir si necesitan cambios y actualizaciones de acuerdo a lo que se re… | PRF, Adm. de Contrato | Mensual, semana 3 | 12 |  |
| 44 | 3. Condiciones y conductas | Evaluación cualitativa por mutual | Prevencionista debe coordinar actividades con el asesor Mutual, por medio de correos y copiar a su jefatura | PRF | Única vez: Feb S1 | 1 |  |
| 45 | 3. Condiciones y conductas | Evaluación cuantitativas por mutual | Prevencionista debe coordinar actividades con el asesor Mutual, por medio de correos y copiar a JDPR | PRF | Única vez: Feb S2 | 1 |  |
| 46 | 3. Condiciones y conductas | Desarrollo protocolo MINSAL y seguimiento PREXOR | Desarrollar canta gantt, conjunto con asesor mutual (De acuerdo a la etapa que esten del protocolo) | PRF | Puntual: Ene S4, Feb S2, Mar S2, Abr S2 | 4 |  |
| 47 | 3. Condiciones y conductas | Desarrollo protocolo MINSAL y seguimiento TMERT/MMC | Desarrollar canta gantt, conjunto con asesor mutual (De acuerdo a la etapa que esten del protocolo) | PRF | Puntual: Ene S4, Feb S2 | 2 |  |
| 48 | 3. Condiciones y conductas | Desarrollo protocolo MINSAL y seguimiento PSICOSOCIAL | Desarrollar canta gantt, conjunto con asesor mutual (De acuerdo a la etapa que esten del protocolo) | PRF | Puntual: Ene S4, Feb S2 | 2 |  |
| 49 | 3. Condiciones y conductas | Desarrollo protocolo MINSAL y seguimiento UV | Desarrollar canta gantt, conjunto con asesor mutual (De acuerdo a la etapa que esten del protocolo) | PRF | Puntual: Ene S4, Feb S2 | 2 |  |
| 50 | 3. Condiciones y conductas | Controlar trabajadores expuestos a programa de vigilancia | Planilla de nomina expuestos y en programa de vigilancia | PRF | Única vez: Feb S2 | 1 |  |
| 51 | 4. Cultura preventiva | Capacitaciòn del personal, estas en función de la evaluación de necesidades de capacitación . En base a: (miper, psic… | Ver temas de difusiones, capacitaciones | PRF | Mensual, semana 2; salvo Ene en S4 | 12 |  |
| 52 | 4. Cultura preventiva | Inducción trabajadores nuevos Examén preocupacional de acuerdo al cargo , IRL, Evaluación, RIOHS,EPP,Procedimientos q… | Antes que ingrese la persona trabajadora debe recibir todas las capacitaciones | PRF, Adm. de contrato, Sup, JT | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 53 | 4. Cultura preventiva | Charla diaria de seguridad y salud en el trabajo | La cantidad es deacuerdo a los turnos de cada supervisor o jefe de terreno de la faena. | Sup, JT | Semanal todo el año | 48 |  |
| 54 | 4. Cultura preventiva | Capacitación Extintores | Coordinar con asesor mutual (dos fechas para logras el 90% de los trabajadores participen) | PRF | Mensual, semana 4 (Sep–Oct) | 2 | Sí |
| 55 | 4. Cultura preventiva | Capacitación Primeros auxilios | Coordinar con asesor mutual, por cada faena designar las personas mas idoneas para esta capacitación | JDPR | Puntual: May S3/4 | 2 |  |
| 56 | 4. Cultura preventiva | Manejo a la defensiva | se debe realizar al 90 % de los conductores, operadores y personas que conducen vehiculos livianos | PRF | Mensual, semana 4 (Feb–Nov) | 10 |  |
| 57 | 4. Cultura preventiva | Comunicación Efectiva | Coordinar con asesor mutual | PRF | Sin semanas planificadas y sin marca a demanda (quedó sin planificar) | 0 |  |
| 58 | 4. Cultura preventiva | Capacitación Coordinador GRD | Realizar capacitación en plataforma mutal online | PRF | Puntual: Feb S4, Mar S1 | 2 |  |
| 59 | 4. Cultura preventiva | Capacitación investigación accidente árbol causal. | Realizar actividad por Mutual, para accidentes graves y fatales | PRF | Puntual: Mar S3/4 | 2 |  |
| 60 | 4. Cultura preventiva | Liderazgo para Linea de Mando | Coordinar con asesor mutual | PRF | Puntual: Jun S2/3 | 2 |  |
| 61 | 5. EPP | Controlar los certificados que acrediten la idoneidad del producto | Solicitar a adquisiciones, de acuerdo a los epp que se utilizan en la faena | PRF | Puntual: Feb S4, Jun S1, Sep S1 | 3 |  |
| 62 | 5. EPP | Registrar la entrega de los Elementos de Protección Personal y dejar documentada su entrega a los trabajadores. | Debe ingresar los datos del trabajador, para que este firme la recepción de estos | PRF | Semanal todo el año | 48 |  |
| 63 | 5. EPP | Capacitación sobre uso correcto de elementos de protección personal, reposción y eliminación de estos. | Realizar capacitación por cada epp que utilizan en faena | PRF | Puntual: Feb S3, May S2, Ago S2, Sep S2, Dic S2 | 5 |  |
| 64 | 5. EPP | Check list de uso y estado de EPP | Gestión en caso del momento de la inspeccion epp esten en mal estado o mal uso de estos (regsitros) | JT | Mensual, semana 2 | 12 |  |
| 65 | 5. EPP | Check list de uso y estado de EPP | Gestión en caso del momento de la inspeccion epp esten en mal estado o mal uso de estos (registros en faena y taller) | PRF | Mensual, semana 3 | 12 |  |
| 66 | 6. Accidentes e incidentes | Informar inmediatamente al adm. Contrato y prevencionista faena después de ocurrido un accidente o incidente por meno… | Jefe de terrenos o supervisores debe informar de inmediato de cualquier incidente ocurrido en su turno | JT | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 67 | 6. Accidentes e incidentes | Informar inmediatamente a JDPR, después de ocurrido un accidente o incidente por menor que parezca la lesión o daños … | Debe informar de inmediato de cualquier incidente ocurrido en la faena | PRF | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 68 | 6. Accidentes e incidentes | Envio Informe Preliminar de acuerdo al plazo establecido en procedimiento DO -36 (3 horas de ocurrido el accidente e … | debe enviarlo al Adm. De contrato y prevencionista de faena | JT | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 69 | 6. Accidentes e incidentes | Encuesta o declaración de la persona trabajadora accidentea o involucarad en el incidente. | Encuesta de acuerdo al formato DO-36 al accidentado o declaración de puño y letra de la persona trabajadora involucra… | Sup, JT | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 70 | 6. Accidentes e incidentes | Envio Informe Preliminar de acuerdo al plazo establecido en procedimiento DO -36 (3 horas de ocurrido el accidente e … | Debe enviarlo a Jefa dpto. Prevención de Riesgos y Subgerente operaciones. Con copia a gerentes de: operaciones y leg… | Adm. de contrato, PRF | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 71 | 6. Accidentes e incidentes | Difusión del incidente, en el turno que ocurrio el accidente e incidente y los demas turnos | Esta difusión es inmediata para dar aconocer lo ocurrido (en la faena) Registro asistencia tema el incidente ocurrido | JT | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 72 | 6. Accidentes e incidentes | Emitir la Declaración Individual de Accidente del Trabajo.Si corresponde a lesión a personas y derivación a Mutual | cada vez que ocuura accidente daño persona y se traslade a Mutual | Adm. de contrato | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 73 | 6. Accidentes e incidentes | Realizar la investigación del accidente e incidente, analizar las causas y determinar e implementar las medidas corre… | Cada vez que ocurra un accidente e incidente con daños a personas, materiales y medio ambiente | Adm. de contrato, PRF, Sup , JT,CPHS | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 74 | 6. Accidentes e incidentes | Envio del informe definitivo de investigación de accidente e incidente | Debe enviar por correo a: Jefa dpto. Prevención de Riesgos y Subgerente operaciones. Con copia a gerentes de: operaci… | Adm. de contrato, PRF | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 75 | 6. Accidentes e incidentes | Difusión medidas preventivas de acuerdo al informe de investigación | Difundir medidas a todas las personas trabajadoras de la empresa en la faena | JT, PRF | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 76 | 6. Accidentes e incidentes | Realizar seguimiento de las medidas correctivas y recomendaciones que surjan de las investigaciones de accidentes. | plan de acción y fechas | Adm. de contrato, PRF, Sup, JT,CPHS | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 77 | 6. Accidentes e incidentes | Archivar todos los documento del accidente e incidente (Informe preliminar, ) | Archivar y solicitar todos los documentos que se generaron por el accidente e incidente | PRF | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 78 | 6. Accidentes e incidentes | Envio de difusión de ONE PAGE | Una vez recepcionado el informe preliminar , se generara la difusión | JDPR | Sin semanas planificadas (solo a demanda) | 0 | Sí |
| 79 | 7. Contingencia | Constitución Comité de Gestión de Riesgos de desastres (CGRD), de acuerdo al DS. N°44 | Revisar lo que indica el DS 44 de acuerdo a la cantidad de personas trabajadoras | PRF, Adm. de contrato | Puntual: Ene S4, Feb S1 | 2 |  |
| 80 | 7. Contingencia | Implementación de matriz GRD (analisis historico, amenaza, evaluación legal, plan de trabajo y plan de emergencia por… | Según matriz enviada por correo | PRF, Adm. de contrato | Puntual: Ene S4, Feb S1 | 2 |  |
| 81 | 7. Contingencia | Actas de reunión CGRD de acuerdo a DS.N°44 | Según acta enviada por correo | PRF, Adm. de contrato | Mensual, semana 1 (Feb–May) | 4 |  |
| 82 | 7. Contingencia | Mapa de riesgo | realizar por cada area y riesgos del área | PRF, Adm. de contrato | Puntual: Feb S3, Mar S1 | 2 |  |
| 83 | 7. Contingencia | Plan emergencia por cada amenaza | en cada faena y talleres | PRF, Adm. de contrato, JM | Única vez: Mar S1 | 1 |  |
| 84 | 7. Contingencia | Simulacros | en cada faena y talleres | PRF, Adm. de contrato, JM | Mensual, semana 3 (Mar, Sep) | 2 |  |
| 85 | 8. Campañas | Módulos vida saludable, alimentación saludable, actividad fisica. Cargar respaldos para avanzar y certificar en este … | uso plataforma Mutual y bajar información a los trabajadores | PRF | Semanal durante Feb | 4 |  |
| 86 | 8. Campañas | Manejo del estrés | uso plataforma Mutual y bajar información a los trabajadores | PRF | Puntual: Mar S1/2/3/4, Abr S1 | 5 |  |
| 87 | 8. Campañas | Alcohol y Drogas No Van Al Volante | Informar de los riesgo, crear conciencia etc. | Adm. de contrato, PRF | Semanal durante Ago | 4 | Sí |
| 88 | 8. Campañas | Seguridad Vial | uso plataforma Mutual y bajar información a los trabajadores | PRF | Semanal, Jun–Jul | 8 |  |
| 89 | 8. Campañas | Puntos ciegos en la conducción y operación | uso plataforma Mutual y bajar información a los trabajadores | PRF | Semanal, Oct–Nov | 8 |  |

## Anexo B. Resumen numérico

| Métrica | Valor |
|---|---|
| Objetivos | 8 |
| Actividades | 89 |
| Ocurrencias planificadas al año (ΣP) | 1.039 (240 corresponden a la act. 38, diálogos diarios) |
| Actividades por objetivo | Liderazgo 9 · Normativa legal 25 · Condiciones y conductas 16 · Cultura preventiva 10 · EPP 5 · Accidentes 13 · Contingencia 6 · Campañas 5 |
| Actividades por patrón | mensual 30 · puntual 21 · a demanda 21 · semanal 8 · campaña 3 · quincenal 2 · mixta 2 · irregular 1 · sin planificar 1 |
| Menciones de responsables | PRF 67 · Adm. de contrato 25 · JT 20 · Sup 15 · JDPR 7 · CPHS 4 · JM 3 · Gerente Legal y RRHH 2 · Subgerente Operaciones 1 · Conductores/operadores/choferes 1 |
| Hojas por cargo | 7 (4, 76, 18, 41, 2, 1 y 12 actividades) |
| Copias por faena detectadas | Biodiversa, Cholguán, Cabrero/Masisa, Grúas/CMPC |
| Snapshots mensuales de una faena | febrero a junio 2026 (5) |
