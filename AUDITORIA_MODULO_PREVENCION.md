# Auditoría integral del módulo de Prevención de Riesgos

**Plataforma:** Chome

**Fecha de corte:** 18 de julio de 2026

**Alcance:** implementación disponible en el checkout y árbol de trabajo actual, marco legal chileno vigente, paridad con SFTI y comparación con plataformas EHS/EHSQ y software de residuos industriales.

**Objetivo:** definir qué falta para que Prevención pueda sustituir las plataformas fragmentadas que usa Chome y convertirse en un sistema integral, trazable y ajustado a su operación de residuos industriales.

---

## 0. Reauditoría post-remediación P0 — 18 de julio de 2026

Esta sección reemplaza el diagnóstico de implementación de las secciones 1 a 8, que se conservan como **línea base histórica** para demostrar qué originó el plan de remediación. Las brechas de producto P1 y la arquitectura objetivo de las secciones posteriores siguen vigentes salvo cuando contradigan explícitamente esta reauditoría.

### 0.1 Dictamen actual

El checkout ya dispone de la **capacidad técnica P0** necesaria para controlar PPA, documentos, privacidad, incidentes, indicadores, MIPER/registro legal y su trazabilidad hacia PDTP. Esto corrige la afirmación de la línea base de que esas capacidades no existían o eran sólo agregados manuales.

La plataforma **todavía no debe sustituir SFTI ni las fuentes formales externas en producción**. El PostgreSQL local no contiene los registros productivos necesarios para demostrar conciliación histórica, cobertura MIPER/legal, distribución documental, denominadores de indicadores o aceptación de los dueños del proceso. En consecuencia:

- la implementación P0 está cerrada en código, schema, RBAC, UI, XLSX y pruebas;
- el corte productivo, los backfills, la operación paralela y las aceptaciones permanecen abiertos;
- ningún porcentaje de cobertura o cumplimiento regulatorio se presume a partir de una base local vacía;
- las decisiones jurídicas, metodológicas y participativas siguen correspondiendo a profesionales y responsables competentes.

### 0.2 Estado técnico de cada P0

| P0 | Capacidad actual demostrada | Estado residual |
|---|---|---|
| P0-01 Indicadores | Registro canónico de denominadores y eventos, fórmula versionada DS 44, snapshots inmutables, conciliación, cierres segregados, drill-down y XLSX común con la UI. | Falta cargar denominadores/evidencias reales, reconciliar históricos y obtener firma de las reglas y diferencias. |
| P0-02 PPA | Cierre y reinicio bloqueados mientras exista corrección pendiente; rechazo exige cancelación fundada o retorno a corrección; CAPA, evidencia, verificación, eficacia, alertas e historial. | Falta auditar PPA productivos anteriores y aceptar la semántica operativa. |
| P0-03 Documentos | Workflow borrador–revisión–aprobación–publicación, segregación, distribución nominativa, acuse firmado por versión, recordatorios, regularización, vínculos validados y expediente XLSX. | Falta resolver hallazgos y destinatarios de la biblioteca productiva y obtener firma del dueño documental. |
| P0-04 Incidentes | Registro idempotente, reporte móvil/offline, triage, investigación, DIAT/DIEP y fatal-grave con plazos, CAPA, reinicio, expediente y acceso sensible segregado. | Falta operar en paralelo y autorizar el corte. Chome no declara envío automático a autoridades. La importación desde SFTI fue retirada el 19-07-2026 (sección 0.9). |
| P0-05 MIPER/legal | MIPER versionada, metodología configurable, controles y revisión anual/disparadores, registro legal por requisito, aplicabilidad aprobada, CAPA por brecha, staging XLSX, fuentes PDTP y reloj de 30 días. | Falta cargar y aprobar matrices/requisitos reales, alcanzar cobertura por faena y obtener aceptación participativa y jurídica. |
| P0-06 Privacidad | Datos clínicos cifrados, proyección mínima de aptitud, casos reservados nominativos, finalidad, auditoría especializada, retención, derechos del titular, reubicación y exportación minimizada. | Falta inventario/reubicación productiva, matriz de finalidades aprobada y aceptación jurídica/seguridad. |

### 0.3 Evidencia verificable del checkout

- Contratos aditivos en `db/schema/prevention/**` y migraciones generadas `0063` a `0077`, aplicadas en PostgreSQL local; una generación posterior informa `No schema changes`.
- Servicios canónicos bajo `lib/services/**`, con scope por faena, permisos, segregación, transacciones, locks/versiones optimistas, historial y hashes donde corresponde.
- Superficies visibles bajo `/prevencion/capa`, `/prevencion/incidentes`, `/prevencion/indicadores`, `/prevencion/miper`, `/prevencion/requisitos-legales`, `/prevencion/pdtp/cobertura`, `/prevencion/documentacion/**` y `/prevencion/privacidad/**`.
- Exportaciones exclusivamente XLSX con neutralización de fórmulas, metadatos, `no-store`, `nosniff`, autorización y auditoría.
- 297 archivos de pruebas aprobados y 2.493 pruebas aprobadas en la suite no-PGlite; además pasan los escenarios PostgreSQL reales de privacidad, incidentes, indicadores y MIPER/legal.
- Build de producción Next.js 16.2.10, typecheck y ESLint focalizado verdes. React Doctor queda en 90/100: los hallazgos nuevos de este lote fueron corregidos y los seis avisos restantes fueron clasificados como falsos positivos o cambios preexistentes fuera de alcance.

### 0.4 Qué sigue faltando para un módulo integral

Cerrar los P0 no convierte todavía a Prevención en una suite EHSQ completa. Siguen siendo brechas de producto, principalmente P1:

- ~~capacitación, ODI, competencias y vencimientos~~ — **capacidad técnica implementada el 19 de julio de 2026**; ver sección 0.5. Falta carga productiva y aceptación;
- vigilancia ocupacional e higiene industrial completa, más allá del resguardo de datos sensibles;
- ~~contratistas, coordinación de empresa principal y acreditación~~ — **capacidad técnica implementada el 19 de julio de 2026**; ver sección 0.6. Falta carga productiva y aceptación;
- CPHS, actas, acuerdos y gobernanza preventiva;
- ~~permisos de trabajo, AST/JSA, LOTO y tareas críticas~~ — **capacidad técnica implementada el 19 de julio de 2026**; ver sección 0.8. Falta carga productiva y aceptación;
- inspecciones especializadas, gestión del cambio, emergencias y simulacros;
- ciclo preventivo de EPP conectado a riesgo, certificación y recambio;
- integración operacional de sustancias, residuos, vehículos, rutas y exigencias ambientales;
- integraciones versionadas con mutualidad, portales autorizados y sistemas corporativos.

El detalle ejecutable, los criterios de cierre y los pendientes que requieren producción o responsables externos están en `PLAN_FIX_MITIGACION_P0_PREVENCION.md`. El avance sobre las brechas P1 se registra en `PLAN_P1_PREVENCION.md`.

---

## 0.5 Avance P1 — Capacitación, ODI y competencias (19 de julio de 2026)

Primera capacidad P1 implementada, elegida por prioridad legal: el DS 44 art. 16 es el único requisito marcado **P0** en la matriz de la sección 4.1 que no tenía ninguna implementación, y el art. 15 (ODI) depende del mismo dominio.

**Qué existe ahora en el checkout:**

- catálogo de cursos por tipo (inducción corporativa y de faena, ODI, curso legal obligatorio, charla, entrenamiento práctico, certificación, reentrenamiento);
- contenidos versionados con temario, duración, modalidad, hash y máquina `borrador → en_revisión → observado → aprobado → vigente → reemplazado`, con **segregación autor ≠ aprobador** y publicación transaccional que reemplaza la versión anterior;
- el piso del DS 44 art. 16 (8 horas, vigencia ≤ 24 meses) se verifica como **parámetro por curso con cita normativa**, no como constante silenciosa: un curso declarado legal obligatorio no puede registrarse ni dictarse bajo ese mínimo, y una sesión más corta que el curso no cierra;
- sesiones con relator interno o externo, **evidencia obligatoria de competencia del relator**, convocatoria nominativa validada por faena, asistencia, evaluación con nota/intentos y acuse firmado SHA-256 que liga sesión, contenido, persona y momento;
- competencia vigente por trabajador como fuente única de habilitación, con vencimiento derivado, reemplazo de la anterior, convalidación externa segregada y revocación motivada;
- requisitos de competencia por alcance global/faena/cargo con exigibilidad **bloqueante o de advertencia**, y motor de brechas que cruza dotación activa × requisitos × competencias;
- escalamiento de brecha bloqueante a **CAPA común** (`sourceType = 'training'`), idempotente por trabajador y curso;
- job diario de vencimientos, avisos previos (60 días) y brechas bloqueantes, con dedupe estable;
- exportación XLSX de seis hojas (matriz, brechas, sesiones, asistencia/evaluación, requisitos, contenidos) con neutralización de fórmulas.

**Evidencia:** migración `0078_fearless_overlord.sql` generada desde schema, segunda generación sin drift y aplicada al PostgreSQL local (7 tablas verificadas). 23 pruebas puras del motor de brechas y del piso legal, 7 de paridad RBAC y **19 escenarios sobre PostgreSQL real** que cubren segregación, versión optimista, scope negativo entre faenas, idempotencia de cierre y de escalamiento CAPA, acuse por titular, vencimiento, convalidación, revocación y XLSX. Typecheck, ESLint y build de producción verdes; React Doctor sin errores nuevos.

**Lo que esto todavía NO significa:** no hay cursos, dotación formativa ni requisitos productivos cargados. La cobertura del art. 16 no puede afirmarse desde una base local vacía, y la definición de qué cargo exige qué curso es una decisión de Prevención, no del software.

---

## 0.6 Avance P1 — Contratistas y coordinación de faena (19 de julio de 2026)

Segunda capacidad P1, elegida por su prioridad P0/P1 en la matriz legal (DS 76/2006 y Ley 20.123) y por ser bloqueante de la Fase 1 de la hoja de ruta.

**Qué existe ahora en el checkout:**

- registro de faena con empresas contratistas, RUT, organismo administrador y subcontratación encadenada;
- contratos por faena con relación, alcance, vigencia y dotación planificada;
- personas del contratista identificadas por su propio RUT, no confundidas con la dotación interna;
- requisitos de acreditación configurables por alcance (empresa, contrato o persona), faena y tipo de relación, con exigibilidad **bloqueante o de advertencia** y fundamento normativo obligatorio;
- ciclo de evidencia `pendiente → presentada → observada/aprobada → vencida`, con revisión **segregada de quien presenta**, checksum, vigencia y observación fundada;
- **control de ingreso**: un contrato nace bloqueado; liberarlo exige cero brechas bloqueantes y recalcula la decisión contra la evidencia real en ese momento. Una brecha de persona bloquea sólo a esa persona; la evidencia vencida re-bloquea el contrato; suspender o terminar corta el acceso en el mismo acto;
- reuniones de coordinación DS 76 con convocatoria por contrato, intercambio de riesgos, acta y **acuerdos derivados a CAPA común**;
- exportación XLSX de siete hojas como expediente para auditoría del mandante o de la autoridad.

**Evidencia:** migración `0079_polite_morlun.sql` generada desde schema, sin drift, aplicada y verificada (8 tablas). 17 pruebas puras del motor de brechas y de la decisión de acceso, 17 escenarios sobre PostgreSQL real y matriz RBAC con aserciones negativas de segregación.

**Lo que esto todavía NO significa:** no hay empresas, contratos ni requisitos productivos cargados. Quedan diferidos el portal de autocarga del contratista, la acreditación de vehículos y equipos, y la estadística de incidentes por contratista.

## 0.8 Avance P1 — Permisos de trabajo, AST/JSA y control de energías (19 de julio de 2026)

Tercera capacidad P1. Es la que amarra las anteriores: el permiso es el punto donde competencia, acreditación y control convergen antes de que alguien ejecute una tarea crítica.

**Qué existe ahora en el checkout:**

- catálogo configurable de tipos de permiso (altura, espacio confinado, trabajo en caliente, izaje, intervención eléctrica y los que Chome o cada mandante definan), cada uno declarando si exige aislamiento, mediciones y AST, su vigencia de medición y su duración máxima;
- permiso con ventana, supervisor, cuadrilla mixta interna/contratista y máquina `borrador → pendiente → aprobado → vigente → cerrado`, con rechazo, suspensión y cancelación motivadas;
- **AST/JSA por pasos** con peligros, controles y riesgo residual, editable sólo antes de la aprobación;
- **aislamiento de energías (LOTO)** con fuente, equipo, método, bloqueo/tarjeta, verificación de energía cero y retiro trazado;
- **mediciones** con límites, equipo, calibración y evaluación de rango persistida;
- una **decisión de habilitación** que devuelve todos los bloqueadores a la vez y que se recalcula en el momento de activar: controles pendientes, aislamiento faltante o sin verificar, medición ausente, vencida o fuera de rango, AST ausente, cuadrilla vacía, **falta de competencia vigente** y **contratista con ingreso bloqueado**;
- no se retira un aislamiento con el permiso vigente ni se cierra el permiso con energías bloqueadas; la ventana vencida suspende el permiso automáticamente;
- exportación XLSX de seis hojas como expediente del permiso.

**Integración que cierra deuda previa:** los requisitos de competencia con alcance `task`, diferidos en la capacidad 1, quedaron cerrados aquí sin tablas nuevas. El PPA recibió una columna `work_permit_id` para poder ser la verificación breve dentro del permiso, como pide §7.7.

**Evidencia:** migración `0080_furry_bucky.sql` desde schema, sin drift, aplicada. 27 pruebas puras de la decisión de habilitación y 20 escenarios sobre PostgreSQL real.

**Lo que esto todavía NO significa:** no hay tipos de permiso ni permisos productivos cargados. Quedan diferidos el formulario de detalle en terreno, el enganche efectivo del PPA y la captura móvil/offline.

---

## 0.9 Retiro de la importación desde SFTI (19 de julio de 2026)

Por decisión de producto se eliminó la capacidad de importar incidentes desde SFTI/Safeti. Deja de existir el staging cifrado, el diccionario de columnas, la conciliación fila a fila, la aprobación y activación de lotes, y su pantalla dedicada.

**Qué se retiró:** el servicio `prevention-incident-import`, la ruta `/prevencion/incidentes/importar` con su workbench, las cuatro Server Actions asociadas, el ítem de navegación «Importar desde SFTI», el diccionario `SFTI_INCIDENT_DICTIONARY`, las tablas `prevention_incident_import_batches` y `prevention_incident_import_rows`, las columnas de procedencia `sfti_external_id` e `import_row_id`, y el valor `sfti_import` del origen de un incidente.

**Consecuencia sobre el corte:** la migración histórica de incidentes desde SFTI deja de ser una capacidad del producto. Si esa historia debe conservarse, se resuelve fuera de la plataforma o mediante una carga puntual acordada; Chome ya no ofrece un camino de importación versionado para ese origen. El resto del control compensatorio con SFTI no cambia: la plataforma sigue sin declarar envío automático a la autoridad.

**Resguardo de datos:** la migración `0081_condemned_logan.sql` es destructiva y por eso lleva una guarda previa que aborta con mensaje explícito si encuentra incidentes con procedencia SFTI o lotes de staging. En la base local había cero filas en las tres estructuras; la guarda fue probada insertando un lote y confirmando que la migración falla en vez de borrarlo.

La cobertura que aportaba el escenario de staging y que sí valía conservar —que el job de recordatorios no reinicia el atraso de un carril legal ya escalado— se mantiene en una prueba equivalente que no depende de SFTI.

**Nota sobre el importador MIPER:** no se tocó. `prevention_risk_import_batches` es un importador XLSX genérico de matrices, no un conector a SFTI; sólo se corrigió el título de un caso de prueba que lo etiquetaba así.

---

### 0.7 Corrección de una afirmación de la auditoría anterior

Al incorporar las suites PostgreSQL de Prevención al gate de CI —que hasta el 19 de julio de 2026 **no se ejecutaban en ningún gate**— apareció un fallo preexistente y real en la regresión de incidentes. La bitácora de P0-05 afirmaba que esa regresión pasaba y que demostraba la regla de actualización de MIPER; no era efectivo, porque la suite nunca corría automáticamente.

El servicio estaba correcto: la regla que impide declarar la MIPER actualizada sin una versión publicada posterior al disparador funciona. Era el test el que codificaba un flujo prohibido. Quedó corregido probando la cadena completa. El detalle está en `PLAN_P1_PREVENCION.md`, sección 5.1.

---

## 1. Dictamen ejecutivo — línea base anterior a la remediación P0

> **Nota de vigencia:** esta sección describe el checkout auditado antes de implementar el plan P0. No debe usarse como inventario actual; véase la sección 0.

El módulo de Prevención **no es hoy un sistema integral de gestión de seguridad y salud en el trabajo** y **no puede sustituir SFTI sin pérdida funcional y de control**.

La implementación actual debe clasificarse como una **capa parcial de ejecución del SG-SST**, compuesta por cinco capacidades principales:

1. Programa de Trabajo Preventivo SG-SST (PDTP).
2. PPA Digital — “Para, Piensa y Actúa”.
3. Evaluaciones SST de trabajador nuevo y antiguo.
4. Biblioteca documental preventiva.
5. Indicadores mensuales ingresados manualmente.

El PDTP es la capacidad más madura: contempla versiones, aprobación, programación, ejecuciones, evidencias, checklists y acciones correctivas verificables. Sin embargo, funciona como una isla basada en un programa importado o configurado manualmente. No nace de una Matriz de Identificación de Peligros y Evaluación de Riesgos (MIPER), de un registro legal, de incidentes, de vigilancia de exposición ni de obligaciones por contrato o faena.

La brecha no consiste solamente en agregar pantallas. Falta el **núcleo preventivo que conecta peligros, personas, instalaciones, sustancias, residuos, vehículos, tareas, controles, incidentes, aprendizaje y cumplimiento legal**.

### Veredicto por dimensión

| Dimensión | Madurez actual | Veredicto |
|---|---:|---|
| Planificación preventiva PDTP | 4/5 | Buena base operativa; falta origen en riesgos, requisitos legales e incidentes. |
| Evaluaciones de personas | 3/5 | Flujo útil y especializado; no reemplaza capacitación, ODI ni gestión de competencias. |
| PPA / control antes de ejecutar | 2/5 | Buen canal de terreno; desconectado de tareas, permisos, MIPER y activos. Cierre correctivo incompleto. |
| Documentación | 2/5 | Biblioteca y versiones disponibles; aprobación, acuse y vínculos no están operativos de extremo a extremo. |
| Indicadores | 1/5 | Agregados manuales y fórmulas que requieren corrección legal. |
| MIPER, mapas de riesgo y controles | 0/5 | No existe como capacidad operativa vigente. |
| Incidentes, accidentes y enfermedades | 0/5 | No existe registro canónico, investigación ni flujo DIAT/DIEP. |
| Capacitación, ODI y competencias | 0/5 en la línea base; ver 0.5 | No existía historial formativo verificable. Capacidad técnica implementada el 19-07-2026; falta carga y aceptación productivas. |
| Salud ocupacional e higiene industrial | 0/5 | No existe vigilancia de exposición ni seguimiento de protocolos. |
| Contratistas y coordinación de faena | 0/5 en la línea base; ver 0.6 | No existía acreditación ni control documental coordinado. Capacidad técnica implementada el 19-07-2026; falta carga y aceptación productivas. |
| CPHS y gobernanza preventiva | 0/5 | Hay un rol y actividades PDTP, pero no existe gestión del comité. |
| Permisos de trabajo y tareas críticas | 0/5 en la línea base; ver 0.8 | No existía flujo formal de permiso, AST/JSA, bloqueo o aislamiento. Capacidad técnica implementada el 19-07-2026; falta carga y aceptación productivas. |
| Emergencias y simulacros | 0/5 | No existe plan operativo, recursos, ejercicios ni lecciones aprendidas. |
| EPP preventivo | 1/5 | Existe entrega logística en Bodega, no ciclo preventivo por riesgo y certificación. |
| Seguridad de residuos, químicos y transporte | 0/5 | No está integrada con el trabajo preventivo. |
| Gestión ambiental operacional | 0/5 dentro de Prevención | La plataforma debe conectarla con la operación de residuos, no duplicarla. |

### Conclusión de producto

El producto que Chome necesita no debería presentarse solamente como “software de Prevención”. Su categoría objetivo es:

> **Plataforma vertical integrada EHSQ + ERP operacional para gestión de residuos industriales.**

EHSQ reúne ambiente, salud, seguridad y calidad. El diferenciador de Chome debe ser que el control preventivo esté conectado nativamente con el residuo, la sustancia, el cliente, la faena, la orden de servicio, el manifiesto, el contenedor, el vehículo, el equipo, el conductor y la ruta.

---

## 2. Alcance, método y límites

### 2.1 Qué se revisó

- Rutas y acciones de `app/(app)/prevencion/**` y `app/(public)/ppa/**`.
- Manifiestos y permisos de `modules/prevention/manifest.ts`, `modules/sst/manifest.ts` y `modules/ppa/manifest.ts`.
- Servicios de PDTP, documentos, SST, PPA e indicadores.
- Modelos de datos en `db/schema/prevention/**`, `db/schema/sst.ts` y `db/schema/ppa.ts`.
- Pruebas que definen el alcance vigente, en particular `lib/__tests__/prevention-rbac.test.ts`.
- Capacidades logísticas de EPP disponibles fuera de Prevención.
- Normativa chilena oficial consultada en BCN, Dirección del Trabajo, SUSESO, MINSAL y Ministerio del Medio Ambiente.
- Funciones publicadas por SFTI/Safeti y plataformas comparables de EHS, EHSQ y residuos.

### 2.2 Criterio de evidencia

Se distingue entre cuatro estados:

- **Operativo:** existe pantalla, autorización, servicio, persistencia y flujo utilizable.
- **Parcial:** existe una parte del flujo, pero no cumple el ciclo completo o no se conecta con la fuente de verdad.
- **Latente:** hay tablas, tipos o servicios sin una operación autorizada y visible de extremo a extremo.
- **Ausente:** no existe capacidad operativa verificable en el checkout actual.

Una tabla sin acciones de negocio, permisos y experiencia de usuario no se considera funcionalidad terminada. Un nombre de actividad en PDTP tampoco equivale a un módulo especializado.

### 2.3 Límite jurídico

Este documento es una auditoría funcional y de brechas de cumplimiento para diseño de producto; no reemplaza un informe jurídico ni la evaluación del profesional de prevención responsable. La aplicabilidad exacta depende de:

- dotación por empresa, centro de trabajo y faena;
- rol de Chome como empleador, empresa principal, contratista o subcontratista;
- rol ambiental como generador, transportista, destinatario o gestor;
- sustancias, residuos y agentes de exposición presentes;
- contratos, resoluciones sanitarias, permisos sectoriales y exigencias del mandante;
- certificaciones y compromisos ISO asumidos por la organización.

El sistema completo debe incorporar una **matriz de aplicabilidad legal versionada**, porque no todas las obligaciones se activan de la misma manera en cada faena.

---

## 3. Inventario del módulo en la línea base anterior

> Este inventario permitió detectar los P0, pero ya no describe por sí solo el checkout post-remediación. Las capacidades nuevas y sus límites están consolidados en la sección 0.

### 3.1 Programa de Trabajo Preventivo SG-SST (PDTP)

**Estado: operativo y relativamente maduro.**

Capacidades verificadas:

- programas por año y versión;
- borrador, aprobaciones de prevención y firma legal;
- activación del programa;
- catálogo de actividades y objetivos;
- programación semanal y excepciones por faena;
- registro de ejecuciones y evidencias;
- aprobación u observación de ejecuciones;
- plantillas de checklist configurables;
- instancias de checklist para distintos sujetos;
- hallazgos y planes de acción;
- responsable usuario, prioridad y fecha de vencimiento;
- evidencia de cierre, verificación, rechazo y reapertura;
- seguimientos y recordatorios;
- importación y exportación XLSX;
- cálculo ponderado de cumplimiento.

**Brecha estructural:** el PDTP no se genera ni mantiene a partir de MIPER, obligaciones legales, cambios operacionales, incidentes, resultados de salud ocupacional, brechas de contratistas o controles críticos. Puede medir con precisión la ejecución de un plan que no necesariamente representa todos los riesgos y requisitos vigentes.

### 3.2 Evaluaciones SST

**Estado: operativo para evaluaciones de personas.**

La navegación y el flujo vigente admiten:

- evaluación de trabajador nuevo;
- evaluación de trabajador antiguo;
- visitas y seguimientos;
- roles de evaluador;
- acompañamientos semanales;
- planes de acción simples;
- cierre y recordatorios.

`lib/sst/definitions/index.ts` conserva definiciones de inspección de taller, extintores, contenedores, carros, equipos móviles, EPP y observaciones planeadas. El mismo archivo limita explícitamente el flujo de Evaluaciones a `trabajador_nuevo` y `trabajador_antiguo`. Por eso, esas plantillas no prueban la existencia de un módulo autónomo de inspecciones.

El plan de acción de SST es más débil que el del PDTP: usa responsable en texto libre y no incorpora evidencia, historial de estado, verificador, reapertura ni una relación con un plan correctivo único de la plataforma.

### 3.3 PPA Digital

**Estado: operativo, pero incompleto como control crítico.**

Fortalezas:

- formulario público de baja fricción;
- identificación por RUT o manual;
- faena y tipo de trabajo;
- decisión de detener o autorizar;
- revisión autenticada;
- resultado público por token;
- cola offline;
- exportación XLSX.

Brechas verificadas:

- el tipo de trabajo se obtiene del catálogo de cargos, no de una tarea u orden operacional;
- solamente `operador_maquinaria_pesada` se considera tarea crítica en la lógica actual;
- los controles mínimos globales son EPP y herramientas;
- no se enlaza con MIPER, procedimiento, AST/JSA, permiso de trabajo, equipo, vehículo, contenedor, residuo, sustancia, hoja de seguridad, cuadrilla, turno, ruta ni ubicación;
- se admite una sola revisión y como máximo una acción correctiva por PPA;
- no se encontró acción de negocio para completar, evidenciar y verificar `ppaCorrectiveActions`;
- `closePpa` permite cerrar un caso autorizado o rechazado sin exigir que la acción correctiva esté terminada y verificada.

Este último punto rompe la trazabilidad entre “se detectó una condición insegura”, “se corrigió” y “una persona competente verificó la eficacia”.

### 3.4 Biblioteca documental preventiva

**Estado: parcial; la infraestructura supera al flujo operativo.**

Capacidades disponibles:

- carpetas;
- carga de archivos;
- versiones;
- búsqueda;
- vencimientos;
- archivo y papelera;
- niveles de confidencialidad;
- auditoría de visualización y descarga.

El modelo de datos contempla estados de revisión, aprobadores, acuses, enlaces y auditoría. Sin embargo:

- `app/(app)/prevencion/documentacion/actions.ts` no ofrece acciones para aprobar, observar, acusar recibo o vincular;
- el manifiesto vigente no registra permisos `prevention:docs:approve`, `prevention:docs:ack` ni `prevention:docs:link`;
- `getDocumentBundle` devuelve `acks: []`;
- el contador `ackPending` cuenta documentos que requieren acuse, no acuses pendientes reales por destinatario;
- al subir una versión, `uploadDocumentVersion` la crea directamente con estado `vigente`;
- el documento puede conservar estado `borrador`, produciendo una inconsistencia entre documento y versión;
- existe servicio de enlaces, pero no un flujo autorizado y visible de extremo a extremo.

La biblioteca sirve para almacenar y consultar, pero todavía no acredita control documental completo.

### 3.5 Indicadores de accidentabilidad

**Estado: operativo como planilla mensual manual; no como registro legal derivado de eventos.**

El esquema mantiene una fila por faena, año y mes con:

- trabajadores;
- horas hombre;
- accidentes con tiempo perdido;
- accidentes sin tiempo perdido;
- días perdidos;
- incidentes;
- daño material;
- daño ambiental;
- cierre del período.

No existe un registro canónico de accidentes que alimente estos totales. Por eso no se puede reconciliar una cifra con las personas lesionadas, días, investigación, denuncia, evidencia o calificación del organismo administrador.

Hay una brecha legal crítica en `lib/prevention/safety-indicators-calc.ts`:

- calcula frecuencia como accidentes con tiempo perdido por un millón de horas hombre;
- calcula gravedad como días perdidos por mil horas hombre;
- no modela días de cargo;
- no calcula la tasa anual de accidentabilidad;
- no aplica la lógica semestral indicada para gravedad.

El artículo 73 del DS 44 define frecuencia con **personas lesionadas por accidentes del trabajo por cada millón de horas trabajadas** y gravedad semestral con **días de ausencia más días de cargo por cada millón de horas trabajadas**. La fórmula actual de gravedad usa factor 1.000, por lo que debe corregirse antes de utilizar el indicador como evidencia regulatoria o gerencial.

### 3.6 Dashboard preventivo

**Estado: parcial.**

Concentra alertas de:

- acciones PDTP vencidas;
- evaluaciones SST en borrador;
- PPA detenidos o en corrección.

No alerta sobre incidentes graves, plazos de DIAT/DIEP, controles críticos, capacitación vencida, exámenes ocupacionales, documentos de contratistas, sesiones CPHS, simulacros, exposición, EPP vencido o permisos activos.

### 3.7 EPP disponible fuera de Prevención

La plataforma ya registra compras, stock y entrega de productos marcados como EPP a un trabajador. `lib/services/deliveries-worker-epp.ts` valida faena, trabajador, producto, stock, cantidad, adjunto y devolución o desecho.

Esta base debe reutilizarse. Aun así, una entrega logística no cubre:

- matriz EPP por peligro, tarea y cargo;
- selección técnica y compatibilidad entre elementos;
- certificación del producto;
- talla y ajuste individual;
- capacitación teórica y práctica;
- vida útil y recambio programado;
- inspección, mantención, limpieza y baja;
- firma o acuse del trabajador;
- verificación de uso y eficacia.

### 3.8 Funciones explícitamente fuera del alcance vigente

`lib/__tests__/prevention-rbac.test.ts` verifica que no se registren permisos de funciones eliminadas. Entre ellas aparecen:

- IPER;
- incidentes;
- capacitación;
- inspecciones;
- pruebas de alcohol;
- reportes de equipos;
- salud;
- matriz EPP;
- emergencias;
- KPIs anteriores;
- contratistas;
- CPHS;
- permisos de trabajo;
- exportación, aprobación, acuse y vínculos documentales.

Esto permite concluir que no son rutas ocultas: están fuera del contrato funcional actual.

---

## 4. Contraste con el marco legal chileno

El DS 44 entró en vigencia el 1 de febrero de 2025 y reemplazó los antiguos DS 40 y DS 54. La auditoría usa por ello el marco vigente del DS 44 y no trata esos reglamentos derogados como contrato funcional actual. Los umbrales y obligaciones condicionadas deben resolverse mediante la matriz de aplicabilidad de cada centro de trabajo.

### 4.1 Matriz legal principal

| Fuente | Exigencia funcional relevante | Cobertura actual | Brecha de producto | Prioridad |
|---|---|---|---|---:|
| Código del Trabajo, arts. 184 y 184 bis | Protección eficaz, información de riesgos, medidas ante riesgo grave e inminente, suspensión y evacuación | PPA permite detener un trabajo | No hay evento de riesgo grave, protocolo de suspensión, evacuación, comunicaciones, responsables, autorización de reinicio ni evidencia | P0 |
| Ley 16.744, art. 76 | Denuncia de accidente o enfermedad; notificación inmediata de accidente fatal o grave; suspensión y evacuación | No existe módulo de incidentes | Falta registro, clasificación, DIAT/DIEP, reloj de 24 horas, notificación DT/SEREMI, evidencia y control de reinicio | P0 |
| DS 44/2024, arts. 7 y 62 | MIPER por procesos, tareas y puestos; riesgos ergonómicos, psicosociales, violencia, accidentes, enfermedades y vigilancia; mapas de riesgo | Ausente | Falta matriz versionada, participación, controles, revisión, comunicación, mapa y enlace a todos los procesos | P0 |
| DS 44/2024, art. 8 | Programa preventivo escrito, responsables, plazos, aprobación, difusión y control | PDTP cubre una parte sustantiva | Debe generarse desde MIPER y requisitos; falta difusión/acuse y trazabilidad completa del origen de cada medida | P0 |
| DS 44/2024, art. 15 | Información previa a la labor y ante cambios de proceso, tecnología, materiales o sustancias; métodos correctos y seguros | PPA y evaluaciones aportan evidencia parcial | Falta ODI por trabajador/tarea, procedimiento vigente, cambio operacional y acuse verificable | P1 |
| DS 44/2024, art. 16 | Capacitación de al menos 8 horas y periodicidad no superior a 2 años, contenidos y evaluación | Actividades PDTP, sin historial formativo | Falta curso, sesión, asistencia, duración, contenidos, evaluación, resultado, vigencia, relator y evidencia | P0 |
| DS 44/2024, arts. 17, 23 y siguientes | Consulta y participación; CPHS cuando corresponda; reuniones, investigación, acuerdos y seguimiento | Rol `cphs` y actividades PDTP | Falta entidad comité, elección, miembros, fuero/mandato, sesiones, actas, acuerdos, investigación y seguimiento | P1 |
| DS 44/2024, arts. 18 y 19 | Riesgo grave e inminente; planes de emergencia, catástrofe y evacuación | PPA detiene tareas | Falta gestión de escenarios, plan, roles, recursos, comunicación, simulacros, evaluación y lecciones | P1 |
| DS 44/2024, arts. 22 y 52 | SG-SST y funciones del Departamento de Prevención cuando corresponda | PDTP y dashboard parcial | Falta revisión por la dirección, objetivos integrados, recursos, registro legal, evaluación del sistema e informes mensuales/anuales completos | P1 |
| DS 44/2024, arts. 72, 73 y 75 | Registros documentales; tasas; registro mínimo de accidentes, trayecto y enfermedades | Biblioteca e indicadores manuales | Fórmulas incompletas/incorrectas y ausencia de registro fuente | P0 |
| DS 76/2006 y Ley 20.123 | Coordinación preventiva en subcontratación, registro de faena, SG-SST, reglamento especial, antecedentes de contratistas | Faenas y trabajadores, sin coordinación especializada | Falta empresa contratista, contrato, dotación, acreditación, obligaciones, intercambio de riesgos, inspecciones y estadísticas | P0/P1 |
| DS 594/1999, versión vigente | Condiciones sanitarias y ambientales, agentes físicos/químicos, límites de exposición, ventilación, calor y controles | Ausente | Falta inventario de agentes, medición, grupos de exposición, vigilancia, controles y tendencias | P1 |
| DS 594, arts. 53 y 54; DS 18 | EPP gratuito, adecuado, capacitación, mantención y certificación | Entrega logística de EPP | Falta decisión por riesgo, certificación, ajuste, capacitación, inspección, vida útil y eficacia | P1 |
| Protocolos MINSAL/SUSESO | Vigilancia según exposición: CEAL-SM, TMERT, PREXOR, sílice, agentes químicos y otros aplicables | Ausente | Falta evaluación de aplicabilidad, nóminas, hitos, resultados, medidas y resguardo clínico | P1 |
| Ley 21.643, Ley Karin | Protocolo preventivo, riesgos psicosociales/violencia/acoso, información semestral de canales, investigación y privacidad | Ausente como flujo especializado | Falta protocolo, difusión, canal, caso reservado, medidas de resguardo, investigación, plazos y reporting | P0/P1 |
| DS 148/2003 | Gestión de residuos peligrosos, plan, registros, contingencias, transporte y declaración | No integrado a Prevención | Falta enlazar perfil de residuo, riesgo, manipulación, almacenamiento, transporte, emergencia y trazabilidad ambiental | P0/P1 |
| DS 43/2015 | Almacenamiento de sustancias peligrosas, inventario, HDS, incompatibilidades y emergencias | Ausente | Falta inventario, ubicación, cantidades, compatibilidad, HDS vigente, inspecciones y umbrales | P1 |
| DS 57/2019 | Clasificación, etiquetado y HDS bajo GHS | Ausente | Falta catálogo GHS, pictogramas, frases de peligro, HDS, versión y comunicación al trabajador | P1 |
| DS 298/1994 | Transporte de cargas peligrosas por calles y caminos | No integrado | Falta relación con carga, número ONU, vehículo, conductor, documentación, EPP, emergencia e inspección preoperacional | P1 |
| RETC, SIDREP y SINADER | Declaración y trazabilidad ambiental según tipo de residuo y rol | No integrado | Falta conciliación entre operación, manifiestos, retiros, recepción, almacenamiento y declaraciones | P1/P2 |
| Ley 19.628 | Tratamiento y resguardo de datos personales y sensibles | Confidencialidad documental genérica | Falta segregación clínica, finalidad, acceso mínimo, trazabilidad de consulta, retención y eliminación | P0 |
| Ley 21.719, vigente desde 1 dic. 2026 | Nuevo régimen de protección de datos, derechos, responsabilidad y privacidad desde el diseño | No se verificó preparación integral | Debe implementarse antes de la entrada en vigencia, en especial para salud, alcohol, denuncias y vigilancia | P0 |

### 4.2 Normas voluntarias y compromisos contractuales

ISO 45001, ISO 14001 e ISO 9001 no son por sí solas leyes chilenas. Pueden convertirse en obligaciones contractuales, de licitación, certificación o política corporativa. Como Chome declara orientación y certificaciones de gestión, la plataforma debe soportar:

- contexto, partes interesadas y alcance;
- liderazgo, responsabilidades y consulta;
- riesgos y oportunidades;
- requisitos legales y otros requisitos;
- objetivos y planes;
- competencia, comunicación y control documental;
- control operacional y preparación ante emergencias;
- evaluación de cumplimiento;
- auditorías internas;
- revisión por la dirección;
- no conformidades, acciones correctivas y mejora continua.

El PDTP cubre partes de objetivos, ejecución y acción correctiva, pero no compone por sí solo un sistema ISO auditable.

---

## 5. Comparación con SFTI/Safeti

> La comparación funcional original se conserva. Chome ahora cubre técnicamente varias de estas brechas P0, pero la paridad con el uso real de SFTI no se considera aceptada hasta completar migración, operación paralela y firma de los dueños.

SFTI es el competidor inmediato porque ya forma parte de la operación de Chome. Su relevancia no está solamente en la cantidad de módulos, sino en que agrupa evidencias exigidas a trabajadores, empresas, contratistas y centros de trabajo.

| Capacidad publicada por SFTI/Safeti | Chome actual | Paridad | Qué debe incorporarse |
|---|---|---:|---|
| Ficha y documentación de empresa y trabajador | Trabajadores y biblioteca separada | Parcial | Expediente preventivo único por trabajador, empresa, faena y contrato |
| Reglamentos, ODI y firma/acuse | Biblioteca sin acuse operativo | No | Asignación por población, firma, recordatorio y versión demostrable |
| Capacitación y competencias | Actividades PDTP sin historial académico | No | Catálogo, sesiones, asistencia, evaluación, vigencia y matriz de competencias |
| Entrega de EPP | Entrega logística desde Bodega | Parcial | Requisito por riesgo, certificación, ajuste, capacitación, mantención y recambio |
| DIAT/DIEP | Ausente | No | Evento, denuncia, plazo, archivo, seguimiento y resolución |
| Declaraciones y salud ocupacional | Ausente | No | Expediente sensible, vigilancia, aptitud y restricciones con acceso segregado |
| Acreditación de contratistas | Ausente | No | Empresa, contrato, trabajadores, vehículos, documentos, vencimientos y bloqueo |
| IPER/MIPER | Ausente | No | Procesos, tareas, peligros, evaluación, controles, responsable, revisión y mapa |
| Inspecciones, observaciones y AST | Plantillas latentes y PPA | Parcial bajo | Motor transversal de inspección y AST conectado a controles críticos |
| Accidentes, incidentes y cuasi accidentes | Solo contadores manuales | No | Reporte, investigación, causalidad, lesión, pérdida, notificaciones y CAPA |
| Auditorías | Checklists PDTP | Parcial | Programa de auditoría, criterio, muestra, hallazgo, informe y seguimiento |
| CPHS, reuniones y elecciones | Rol CPHS | No | Comité completo, actas, acuerdos, elecciones e investigaciones |
| Tareas y acciones | Acciones PDTP maduras; SST/PPA separadas | Parcial | CAPA único para todas las fuentes |
| Estadísticas mensuales | Indicadores manuales | Parcial con defecto | Derivación automática y fórmulas DS 44 |
| Reportes y recordatorios | PDTP, SST y PPA parciales | Parcial | Alertas y reportes transversales con escalamiento |
| Firma electrónica | No se verificó firma jurídica transversal | No | Evidencia de identidad, intención, versión, sello de tiempo y auditoría |
| Permisos de trabajo | Ausente | No | Permisos configurables, vigencia, aprobación, controles y cierre |
| Integraciones | No hay API preventiva pública verificada | No | API, webhooks, SSO y conectores de datos maestros |

**Conclusión de paridad:** PDTP y PPA ofrecen oportunidades de superar a SFTI en experiencia específica de Chome, pero la cobertura funcional total está muy por debajo. La migración desde SFTI solo debe ocurrir después de una matriz de paridad por dato, proceso, evidencia, reporte e integración, acompañada por una migración histórica validada.

---

## 6. Comparación con otros SaaS del mercado

### 6.1 Referentes y lecciones aplicables

| Plataforma | Categoría | Funciones relevantes | Lección para Chome |
|---|---|---|---|
| ZYGHT | EHS latinoamericano | Riesgos, incidentes, capacitación, competencias, EPP, JSA digital, cambio, requisitos legales, auditorías, contratistas, documentos, activos, CAPA y permisos | Referente cercano para amplitud EHS y vocabulario regional |
| CorityOne | EHS empresarial convergente | Incidentes, riesgo, salud ocupacional, higiene industrial, auditoría, cumplimiento, residuos, químicos, permisos, contratistas, aprendizaje y móvil | La salud, ambiente y seguridad deben compartir datos, no ser aplicaciones aisladas |
| Intelex | EHSQ empresarial | Auditorías, incidentes, observaciones, acciones, móvil/offline, fotos, voz, GPS, SSO y analítica | El trabajo de terreno necesita captura rica y offline en todos los procesos |
| SafetyCulture | Operaciones de primera línea | Inspecciones, acciones, capacitación, activos, documentos, firmas, fotos, video y códigos | Un motor simple de inspecciones y acciones puede adoptar muchos casos si tiene buena UX móvil |
| AMCS | ERP de residuos | Recolección, tratamiento, reciclaje, venta, relleno, residuos peligrosos, flota, rutas y cumplimiento | El valor diferencial surge al conectar EHS con el ciclo operacional del residuo |
| WasteLinq | Gestión de residuos industriales/peligrosos | Perfiles de residuo, manifiestos, embarques, recepción, procesamiento, facturación, reporte regulatorio, HDS y portales | El residuo debe ser una entidad operacional y de riesgo compartida |

### 6.2 Funciones comunes que Chome aún no cubre

Los referentes convergen en capacidades ausentes o incompletas:

- registro único de incidentes y cuasi accidentes;
- riesgos y controles versionados;
- inspecciones y auditorías móviles;
- acciones correctivas unificadas;
- gestión de competencias;
- salud ocupacional e higiene;
- contratistas;
- permisos de trabajo;
- sustancias químicas y HDS;
- activos críticos;
- gestión del cambio;
- obligaciones legales;
- análisis de tendencias;
- conectores, API y SSO;
- experiencia offline con evidencia multimedia;
- portales para trabajadores, clientes y empresas colaboradoras.

La oportunidad de Chome no es copiar un catálogo genérico. Es integrar esas funciones con la trazabilidad industrial que plataformas EHS puras normalmente no dominan.

---

## 7. Brechas funcionales que deben cerrarse

> **Lectura post-remediación:** las bases técnicas de 7.1 (registro legal), parte de 7.2 (MIPER/controles) y 7.3 (incidentes) ya existen. Siguen abiertas su carga y cobertura productivas, los mapas visuales de riesgo y las integraciones amplias enumeradas; 7.4 en adelante continúa como backlog funcional.

### 7.1 Registro legal y evaluación de cumplimiento

Debe existir un módulo que permita:

- catálogo de leyes, decretos, resoluciones, permisos, contratos y normas internas;
- requisito granular por artículo u obligación;
- versión y vigencia;
- evaluación de aplicabilidad por empresa, faena, actividad y rol ambiental;
- dueño del requisito;
- frecuencia de control;
- evidencia exigida;
- evaluación conforme, parcial, no conforme o no aplicable;
- fundamento de no aplicabilidad;
- hallazgo y acción correctiva;
- alertas por vencimiento o cambio;
- informe de cumplimiento y revisión por la dirección.

Sin esta capa no es posible demostrar que el PDTP cubre el universo de obligaciones aplicables.

### 7.2 MIPER, mapas de riesgos y controles críticos

Se requiere:

- jerarquía empresa → faena → proceso → subproceso → tarea → puesto;
- peligros y eventos no deseados;
- personas expuestas, frecuencia, consecuencia y metodología versionada;
- riesgo inherente y residual;
- controles según jerarquía: eliminación, sustitución, ingeniería, administrativos y EPP;
- dueño, criticidad, estándar, evidencia y frecuencia de verificación de cada control;
- perspectiva de género, trabajadores especialmente sensibles y exposición combinada;
- riesgos ergonómicos, psicosociales, violencia/acoso, conducción, equipos, químicos, biológicos y ambientales;
- participación y observaciones de trabajadores/CPHS;
- mapa de riesgo por centro de trabajo;
- historial de aprobación, comunicación y revisión;
- disparadores de revisión por cambio, incidente, enfermedad, desviación o nueva sustancia;
- vínculo automático con PDTP, ODI, capacitación, PPA, inspección, permiso, EPP y emergencia.

### 7.3 Incidentes, accidentes, trayecto, enfermedades y pérdidas

Debe haber un registro único para:

- accidente del trabajo;
- accidente de trayecto;
- enfermedad profesional sospechada o confirmada;
- cuasi accidente;
- condición o acción insegura;
- daño material;
- derrame o daño ambiental;
- evento vehicular;
- evento con contratista o tercero.

El flujo debe incluir:

1. reporte inmediato móvil, incluso offline;
2. triage de gravedad y riesgo potencial;
3. medidas inmediatas, atención, suspensión y evacuación;
4. notificaciones y escalamiento;
5. DIAT/DIEP y control de plazo;
6. notificación de fatal/grave a autoridades cuando proceda;
7. investigación con equipo, entrevistas y evidencias;
8. metodología causal configurable;
9. acciones correctivas y preventivas;
10. verificación de eficacia;
11. autorización documentada para reiniciar;
12. días perdidos, días de cargo, lesión y clasificación;
13. resolución del organismo administrador;
14. aprendizaje y actualización de MIPER, capacitación y procedimiento;
15. generación automática de indicadores.

### 7.4 Capacitación, ODI y competencias

Se necesita diferenciar:

- inducción corporativa;
- inducción de faena;
- ODI por riesgos del puesto/tarea;
- curso obligatorio legal;
- charla operacional;
- entrenamiento práctico;
- certificación o licencia;
- reentrenamiento por cambio o incidente.

Datos mínimos:

- contenidos y versión;
- duración;
- modalidad;
- instructor y competencia del instructor;
- asistentes convocados y presentes;
- evaluación teórica/práctica;
- resultado, intentos y aprobación;
- firma o acuse;
- fecha de vencimiento;
- evidencia;
- equivalencia y convalidación;
- competencia requerida por cargo, tarea, equipo, sustancia y contrato.

El sistema debe bloquear o advertir la asignación a una tarea crítica cuando falte una competencia vigente.

### 7.5 CPHS y gobernanza del SG-SST

El rol `cphs` no reemplaza un módulo. Debe incorporarse:

- constitución del comité por centro de trabajo;
- representantes titulares y suplentes;
- elección, designación, mandato y vigencia;
- calendario mensual y sesiones extraordinarias;
- citación, asistencia, tabla, acta y firma;
- acuerdos con responsable y plazo;
- seguimiento de acuerdos;
- investigaciones encargadas al comité;
- actividades de difusión y capacitación;
- documentos electorales;
- indicadores de funcionamiento;
- acceso a MIPER, programa preventivo e incidentes pertinentes.

También se requiere revisión por la dirección con entradas, decisiones, recursos y compromisos trazables.

### 7.6 Empresas contratistas y coordinación de faena

Para cumplir el DS 76 y operar con mandantes y empresas colaboradoras se necesita:

- empresa, RUT, contactos y organismo administrador;
- contrato, alcance, fechas, dotación y subcontratos;
- trabajadores, cargos, turnos y faena;
- vehículos, equipos y operadores;
- requisitos documentales por contrato/faena;
- carga, revisión, observación, aprobación y vencimiento;
- intercambio de MIPER, emergencias, reglamento especial y procedimientos;
- inducción y competencias;
- estadísticas e incidentes por contratista;
- inspecciones y reuniones de coordinación;
- bloqueo de acceso o trabajo ante incumplimientos críticos;
- portal acotado para autocarga y respuesta;
- expediente exportable para auditoría del mandante.

### 7.7 Permisos de trabajo, AST/JSA y control de energías

El PPA no reemplaza un permiso. Deben configurarse permisos para:

- trabajo en altura;
- espacio confinado;
- trabajo en caliente;
- excavación;
- izaje;
- intervención eléctrica;
- bloqueo y etiquetado de energías;
- apertura de líneas o equipos;
- manipulación o trasvasije de sustancias peligrosas;
- tareas críticas definidas por Chome y por cada mandante.

Todo permiso debe tener tarea/orden, lugar, vigencia, cuadrilla, supervisor, riesgos, controles, aislamientos, mediciones, EPP, certificados, aprobaciones, suspensión, extensión, relevo y cierre. El PPA debería ser una verificación breve dentro de este flujo, no un registro desconectado.

### 7.8 Inspecciones, observaciones y auditorías

Se debe convertir la base de checklists en un motor transversal:

- plantillas versionadas y aprobadas;
- programación por riesgo, activo, faena y frecuencia;
- asignación individual o a equipo;
- ejecución móvil y offline;
- foto, video, audio, firma, ubicación y código QR;
- respuesta condicionada;
- hallazgo automático por criticidad;
- medida inmediata;
- CAPA;
- revisión y cierre independiente;
- tendencias por pregunta, control, activo, contratista y faena;
- auditorías con alcance, criterio, muestra, equipo auditor, informe y seguimiento.

Las definiciones SST existentes pueden migrarse a este motor sin mezclar inspecciones de activos con evaluaciones de personas.

### 7.9 Salud ocupacional e higiene industrial

Debe existir un dominio separado y de acceso reforzado para:

- agentes químicos, físicos, biológicos, ergonómicos y psicosociales;
- grupos de exposición similar;
- mediciones, laboratorio, método, equipo y calibración;
- comparación con límites y nivel de acción;
- trabajadores expuestos;
- programas de vigilancia;
- citaciones, asistencia y estado de evaluación;
- aptitud y restricciones operacionales, sin exponer diagnóstico a supervisores;
- seguimiento de CEAL-SM y protocolos aplicables;
- medidas prescritas por organismo administrador;
- vigilancia de ausentismo en forma proporcionada;
- campañas preventivas;
- indicadores anonimizados.

Los datos clínicos no deben almacenarse como documentos preventivos comunes. Deben tener permisos, trazabilidad, retención y finalidad diferenciados.

### 7.10 EPP preventivo integrado con Bodega

Debe conservarse la fuente de verdad logística existente y agregar:

- matriz de requisitos por MIPER, cargo y tarea;
- catálogo técnico con certificación, norma, talla, compatibilidades y vida útil;
- selección y aprobación técnica;
- asignación esperada versus entrega real;
- prueba de ajuste cuando corresponda;
- instrucción y demostración práctica;
- firma/acuse;
- inspecciones periódicas;
- mantención y limpieza;
- reposición por fecha, desgaste, daño o cambio de riesgo;
- devolución, baja y disposición;
- alertas de cobertura faltante;
- conciliación con stock y solicitudes de compra.

### 7.11 Emergencias, contingencias y simulacros

Se requiere:

- escenarios por faena: incendio, derrame, fuga, volcamiento, exposición, rescate, sismo y eventos climáticos aplicables;
- plan y versión aprobada;
- organigrama de emergencia y reemplazos;
- recursos, ubicación, inspección y mantención;
- contactos internos, mandante, mutualidad y autoridades;
- rutas, puntos de encuentro y mapas;
- comunicación y acuse a trabajadores/contratistas;
- simulacros programados;
- participantes, tiempos, observaciones y resultado;
- acciones y verificación;
- bitácora de activaciones reales;
- vínculo con residuos/sustancias, HDS, vehículo, instalación y plan de contingencia ambiental.

### 7.12 Sustancias, residuos peligrosos y transporte

Esta es la principal oportunidad de diferenciación vertical. Prevención debe consumir entidades operacionales comunes:

- perfil de residuo y caracterización;
- clasificación de peligrosidad;
- código/lista aplicable;
- número ONU y clase de riesgo cuando corresponda;
- HDS y versión;
- incompatibilidades;
- embalaje, contenedor y rotulación;
- cantidad, unidad y ubicación;
- generador, transportista y destinatario;
- vehículo, remolque, conductor y habilitaciones;
- orden de servicio, retiro, ruta y manifiesto;
- procedimiento de carga, descarga, limpieza y trasvasije;
- EPP y equipo de emergencia requerido;
- inspección preoperacional;
- incidente, derrame, rechazo o diferencia de recepción;
- declaración SIDREP/SINADER cuando corresponda.

El sistema debe impedir contradicciones entre la ficha operacional del residuo y los controles mostrados al trabajador.

### 7.13 Gestión del cambio

Debe dispararse una evaluación cuando cambien:

- proceso o método;
- instalación o layout;
- equipo o vehículo;
- sustancia o residuo;
- proveedor o contratista;
- requisito legal;
- dotación o jornada;
- software o automatización crítica;
- procedimiento;
- condición del cliente o mandante.

El cambio debe evaluar riesgos, permisos, capacitación, documentos, MIPER, emergencia y fecha de revisión posterior.

### 7.14 CAPA único

Hoy existen acciones con modelos distintos en PDTP, SST y PPA. Debe haber una sola entidad de acción correctiva/preventiva con:

- fuente y vínculo al hallazgo original;
- descripción y causa;
- medida inmediata y acción definitiva;
- responsable usuario y área;
- fecha objetivo y prioridad;
- evidencia requerida;
- estados y transiciones auditadas;
- comentarios y seguimientos;
- verificador independiente cuando corresponda;
- rechazo, reapertura y cambio de plazo justificado;
- evaluación de eficacia;
- escalamiento por vencimiento;
- análisis transversal de reincidencia.

PDTP ya contiene la implementación más completa y debería ser la base de la unificación.

### 7.15 Control documental completo

La biblioteca debe cerrar su ciclo real:

- documento y versión con estados coherentes;
- autor, revisor y aprobador;
- segregación de funciones;
- publicación solo después de aprobación;
- distribución por cargo, faena, contratista o lista nominada;
- acuse por persona y versión;
- recordatorios y escalamiento;
- control de copia impresa;
- vigencia y revisión periódica;
- obsolescencia y acceso histórico;
- enlaces a requisito, riesgo, capacitación, incidente, permiso, activo y residuo;
- exportación de expediente;
- auditoría de lectura, descarga, firma y cambio.

### 7.16 Analítica legal y operacional

Los indicadores deben derivarse de eventos y fuentes de verdad. El catálogo mínimo incluye:

**Resultados:**

- tasa anual de accidentabilidad;
- frecuencia mensual;
- gravedad semestral;
- fatalidades;
- accidentes graves;
- días perdidos y días de cargo;
- enfermedades profesionales;
- derrames y eventos ambientales;
- daños materiales y vehiculares.

**Prevención y controles:**

- controles críticos verificados y fallidos;
- acciones vencidas y eficacia;
- cobertura MIPER y revisiones pendientes;
- capacitación vigente por competencia;
- inspecciones ejecutadas y hallazgos reincidentes;
- PPA detenidos, tiempo de resolución y acciones verificadas;
- permisos suspendidos;
- EPP faltante o vencido;
- contratistas bloqueados;
- cumplimiento legal;
- vigilancia ocupacional y medidas pendientes en forma anonimizada;
- simulacros y tiempos de respuesta.

Toda cifra debe permitir navegar hasta los registros que la componen.

### 7.17 Móvil, offline y participación de trabajadores

La cola offline de PPA es una buena base, pero debe extenderse a:

- incidentes;
- inspecciones;
- permisos;
- AST/JSA;
- controles críticos;
- firmas y acuses;
- emergencias;
- consulta de HDS y procedimientos;
- acciones asignadas.

Debe soportar sincronización idempotente, resolución de conflictos, evidencia de fecha/ubicación, reintento visible y operación en dispositivos compartidos. El portal del trabajador debe mostrar sus riesgos, capacitaciones, EPP, documentos pendientes, autorizaciones y canales de reporte.

### 7.18 Integraciones, API y datos maestros

El sistema requiere contratos de integración para:

- personas, cargos, empresas y turnos;
- faenas, clientes y contratos;
- Bodega, productos y EPP;
- flota, vehículos, equipos y mantenciones;
- órdenes de servicio y operación de residuos;
- documentos, firma y notificaciones;
- organismo administrador/mutualidad cuando exista interfaz habilitada;
- SIDREP, SINADER u otros portales mediante mecanismos autorizados;
- identidad corporativa, SSO y MFA;
- BI y exportación XLSX.

Se deben publicar API y webhooks versionados con trazabilidad, idempotencia, alcance por faena y mínimo privilegio.

### 7.19 Privacidad, seguridad y retención

Se requiere una clasificación explícita:

- operacional;
- personal;
- sensible;
- clínico;
- denuncia/investigación reservada;
- secreto comercial del cliente.

Controles mínimos:

- permisos por rol, faena, empresa y propósito;
- segregación de salud, Ley Karin y alcohol/drogas;
- MFA para funciones sensibles;
- auditoría inmutable de accesos y cambios;
- cifrado en tránsito y reposo;
- retención por tipo documental y obligación;
- bloqueo legal de eliminación;
- exportación y atención de derechos del titular;
- anonimización de analítica;
- respaldo, restauración y continuidad;
- privacidad desde el diseño para la Ley 21.719.

---

## 8. Defectos críticos comprobados en la línea base anterior

> **Estado:** los seis defectos siguientes originaron la remediación y están técnicamente cubiertos en el checkout actual. Se conservan como evidencia histórica; sus pendientes productivos se resumen en la sección 0 y en el plan de fix.

### P0-01 — Fórmulas de indicadores no alineadas con DS 44

**Evidencia:** `lib/prevention/safety-indicators-calc.ts` usa accidentes con tiempo perdido para frecuencia y factor 1.000 para gravedad.

**Riesgo:** reportes regulatorios o gerenciales materialmente incorrectos.

**Corrección:** crear registro canónico de eventos/personas lesionadas, días de ausencia y días de cargo; implementar definiciones legales, periodicidad, pruebas con casos oficiales y trazabilidad hasta la fuente.

### P0-02 — PPA cerrable sin acción correctiva verificada

**Evidencia:** `lib/services/ppa-module/reportes.ts` crea una acción en estado `pendiente`, pero `closePpa` solo comprueba que el PPA esté `autorizado` o `rechazado`.

**Riesgo:** condición insegura declarada cerrada sin prueba de corrección.

**Corrección:** migrar a CAPA único y exigir término, evidencia, verificación y eficacia según criticidad antes del cierre/reinicio.

### P0-03 — Control documental con aprobación y acuse no operativos

**Evidencia:** ausencia de permisos y acciones de aprobar/acusar/vincular; `acks: []`; contador no nominativo; versión creada como `vigente`.

**Riesgo:** no es posible demostrar que la versión correcta fue aprobada y comunicada a cada persona obligada.

**Corrección:** completar estados y transiciones, distribución nominada, acuse por versión, alertas y coherencia entre documento/versión.

### P0-04 — No existe registro fuente de accidentes e incidentes

**Evidencia:** solo hay agregados mensuales en `db/schema/prevention/safety-indicators.ts`; el RBAC verifica la eliminación de `prevention:incidents:view`.

**Riesgo:** incumplimiento de registro, denuncia, investigación, aprendizaje y conciliación.

**Corrección:** implementar el flujo de incidentes antes de ampliar el dashboard de indicadores.

### P0-05 — El programa preventivo carece de MIPER y registro legal como origen

**Evidencia:** los permisos vigentes no contienen IPER y la prueba confirma su eliminación.

**Riesgo:** cumplimiento alto de un programa incompleto respecto de peligros u obligaciones.

**Corrección:** convertir riesgo y requisito en fuentes versionadas de actividades, controles, capacitación, inspecciones y acciones.

### P0-06 — Datos sensibles sin dominio clínico/reservado especializado

**Evidencia:** la biblioteca ofrece confidencialidad genérica, pero no existe salud ocupacional ni gestión reservada de denuncias.

**Riesgo:** acceso excesivo, mezcla de finalidad y preparación insuficiente para Ley 21.719.

**Corrección:** diseñar dominios, permisos, auditoría, retención y vistas mínimas antes de almacenar resultados clínicos o denuncias.

---

## 9. Arquitectura funcional objetivo

### 9.1 Navegación propuesta

```text
Prevención y EHSQ
├── Inicio y alertas
├── Riesgos y controles
│   ├── MIPER
│   ├── Mapas de riesgo
│   ├── Controles críticos
│   └── Gestión del cambio
├── Programa preventivo
│   ├── PDTP
│   ├── Ejecuciones
│   └── Acciones CAPA
├── Trabajo seguro
│   ├── PPA
│   ├── AST / JSA
│   ├── Permisos de trabajo
│   └── Inspecciones y observaciones
├── Incidentes y emergencias
│   ├── Reportes e investigaciones
│   ├── DIAT / DIEP
│   ├── Planes de emergencia
│   └── Simulacros
├── Personas
│   ├── Expediente preventivo
│   ├── Capacitación y ODI
│   ├── Competencias
│   ├── EPP
│   └── Salud ocupacional
├── Empresas contratistas
├── CPHS y gobernanza
├── Sustancias y residuos
├── Requisitos legales
├── Documentación
└── Indicadores e informes
```

La navegación puede adaptarse por rol. Un trabajador no debería ver la misma densidad que un prevencionista central o un administrador de contrato.

### 9.2 Modelo de datos mínimo

| Dominio | Entidades principales |
|---|---|
| Cumplimiento | `legal_requirements`, `legal_versions`, `legal_applicability`, `compliance_assessments`, `compliance_evidence` |
| Riesgo | `processes`, `tasks`, `hazards`, `risk_assessments`, `risk_versions`, `control_measures`, `critical_controls`, `risk_maps` |
| Incidentes | `incidents`, `incident_people`, `injuries`, `notifications`, `investigations`, `causes`, `lost_days`, `charge_days`, `restart_authorizations` |
| Acciones | `capa_actions`, `capa_history`, `capa_evidence`, `capa_followups`, `effectiveness_reviews` |
| Formación | `courses`, `course_versions`, `training_sessions`, `attendance`, `assessments`, `competency_requirements`, `worker_competencies` |
| CPHS | `committees`, `committee_members`, `elections`, `meetings`, `minutes`, `agreements` |
| Contratistas | `contractor_companies`, `contracts`, `contractor_workers`, `accreditation_requirements`, `accreditation_items`, `site_assignments` |
| Trabajo seguro | `work_permits`, `permit_controls`, `isolations`, `jsa`, `ppa_links`, `work_authorizations` |
| Inspección | `inspection_templates`, `inspection_schedules`, `inspection_runs`, `findings` |
| Salud e higiene | `exposure_agents`, `similar_exposure_groups`, `measurements`, `surveillance_programs`, `surveillance_enrollments`, `fitness_restrictions` |
| EPP | `ppe_requirements`, `ppe_certifications`, `ppe_assignments`, `ppe_fit_tests`, `ppe_inspections`, `ppe_maintenance` |
| Emergencias | `emergency_plans`, `emergency_scenarios`, `emergency_roles`, `emergency_resources`, `drills`, `drill_findings` |
| Sustancias/residuos | `substances`, `waste_profiles`, `safety_data_sheets`, `hazard_classes`, `compatibility_rules` |
| Documentos | conservar biblioteca, agregando flujo, distribución, acuse y enlaces polimórficos controlados |

### 9.3 Relaciones operacionales obligatorias

Todo registro de terreno debería poder vincularse, según corresponda, con:

- empresa y faena;
- cliente y contrato;
- proceso, tarea y turno;
- trabajador y empresa empleadora;
- orden de servicio;
- residuo o sustancia;
- manifiesto o declaración;
- vehículo y equipo;
- contenedor;
- ruta y ubicación;
- MIPER y control crítico;
- procedimiento y versión;
- permiso y AST/JSA;
- evidencia documental;
- incidente y acción CAPA.

### 9.4 Principio de fuente única

- **Personas y faenas:** catálogo corporativo común.
- **EPP y stock:** Bodega es fuente logística; Prevención define requisitos técnicos.
- **Vehículos/equipos:** Flota/activos mantiene identidad y estado; Prevención define controles y restricciones.
- **Residuos y manifiestos:** Operación ambiental mantiene el movimiento; Prevención consume peligros y controles.
- **Acciones:** CAPA común para todas las fuentes.
- **Documentos:** biblioteca común con distribución y evidencia.
- **Indicadores:** cálculo derivado, nunca doble digitación cuando exista fuente transaccional.

---

## 10. Flujos objetivo de extremo a extremo

### 10.1 Riesgo → programa → ejecución → eficacia

1. Se identifica proceso/tarea y peligro.
2. Se evalúa riesgo inherente.
3. Se asignan controles y riesgo residual.
4. Los controles recurrentes generan PDTP, inspección, capacitación o mantención.
5. La persona responsable ejecuta y aporta evidencia.
6. Un rol competente verifica.
7. Una desviación genera CAPA.
8. Se comprueba eficacia.
9. El resultado actualiza MIPER y analítica.

### 10.2 Orden de servicio de residuo peligroso → trabajo seguro

1. La orden define generador, residuo, cantidad, origen y destino.
2. El perfil de residuo aporta peligros, incompatibilidades, HDS y controles.
3. Se valida vehículo, conductor, equipo, EPP y competencias.
4. Según reglas, se exige AST/JSA, permiso y PPA.
5. Se ejecutan inspecciones previas y controles críticos.
6. El trabajo puede detenerse ante desviación.
7. Un incidente activa contingencia, notificaciones e investigación.
8. La recepción y manifiesto cierran trazabilidad operacional y ambiental.

### 10.3 Incidente → denuncia → investigación → aprendizaje

1. Reporte inmediato.
2. Clasificación y medidas urgentes.
3. Denuncias/notificaciones con control de plazos.
4. Investigación y causas.
5. CAPA con responsable y evidencia.
6. Verificación y autorización de reinicio.
7. Actualización de MIPER, procedimiento, formación y controles.
8. Cálculo automático de indicadores.

### 10.4 Documento → aprobación → distribución → acuse

1. Se crea nueva versión en borrador.
2. Se revisa y observa o aprueba.
3. Se publica con vigencia.
4. Se asigna a población objetivo.
5. Cada persona consulta y acusa la versión exacta.
6. El sistema escala faltantes.
7. Una nueva versión deja obsoleta la anterior sin borrar la evidencia histórica.

---

## 11. Roles y permisos necesarios

Se recomienda separar al menos:

- administrador de plataforma;
- jefatura de prevención;
- prevencionista central;
- prevencionista de faena;
- administrador de contrato;
- jefe/supervisor de terreno;
- trabajador;
- representante CPHS;
- investigador de incidentes;
- salud ocupacional;
- revisor/aprobador documental;
- auditor;
- empresa contratista;
- gerencia/revisión por la dirección;
- solo lectura regulatoria o de mandante.

Cada permiso debe combinar **acción + dominio + alcance por faena/empresa + sensibilidad**. No basta `view/manage`. Las acciones críticas requieren permisos propios: aprobar MIPER, autorizar reinicio, emitir denuncia, ver dato clínico, investigar Ley Karin, aprobar documento, verificar CAPA y cerrar período.

---

## 12. Hoja de ruta recomendada

### Fase 0 — Corrección y gobierno de la base actual

**Estado post-remediación:** implementación técnica terminada; inventario, conciliación y validación productiva pendientes.

**Objetivo:** impedir que los flujos existentes produzcan evidencia engañosa.

Entregables:

- corregir indicadores según DS 44 y agregar pruebas normativas;
- impedir cierre de PPA con acciones pendientes;
- unificar estado y transiciones de documentos/versiones;
- habilitar aprobación, observación, distribución, acuse y enlaces documentales;
- definir CAPA común y estrategia de migración desde PDTP/SST/PPA;
- aprobar clasificación de datos, retención y permisos sensibles;
- crear registro legal y matriz de aplicabilidad inicial;
- inventariar datos históricos que deberán migrarse desde SFTI.

Criterio de salida:

- cada cifra y cierre crítico puede trazarse a evidencia;
- no existen rutas de bypass;
- pruebas negativas de rol × faena × endpoint;
- matriz legal validada por responsable de prevención y asesoría jurídica.

### Fase 1 — Núcleo legal y paridad mínima con SFTI

**Estado post-remediación:** núcleo P0 de MIPER/legal, incidentes, control documental y CAPA implementado. **Capacitación/ODI (0.5), contratistas/DS 76 (0.6) y permisos de trabajo/AST/LOTO (0.8) implementados el 19-07-2026.** Inspecciones, CPHS y la aceptación de paridad siguen pendientes.

**Objetivo:** cubrir las funciones sin las cuales no es razonable retirar SFTI.

Entregables:

- MIPER y mapas de riesgo;
- incidentes/accidentes/enfermedades, DIAT/DIEP y notificaciones;
- capacitación, ODI y competencias;
- control documental completo;
- inspecciones/observaciones móviles;
- CAPA transversal;
- CPHS;
- contratistas y coordinación DS 76;
- permisos de trabajo y AST/JSA;
- dashboard legal derivado.

Criterio de salida:

- paridad aprobada por cada flujo usado en SFTI;
- migración histórica conciliada por muestreo y totales;
- operación paralela controlada;
- evidencia exportable para auditoría;
- plan de reversa antes del corte definitivo.

### Fase 2 — Salud, EPP y resiliencia operacional

**Objetivo:** completar la prevención del trabajador y las capacidades de terreno.

Entregables:

- salud ocupacional e higiene industrial;
- protocolos por exposición;
- EPP integrado con Bodega;
- emergencias, contingencias y simulacros;
- gestión del cambio;
- móvil/offline transversal;
- portales de trabajador y contratista;
- revisión por la dirección.

Criterio de salida:

- acceso clínico segregado y auditado;
- competencias/EPP/aptitud controlan tareas críticas;
- simulacros y contingencias generan aprendizaje verificable;
- cumplimiento demostrado de flujos offline y sincronización.

### Fase 3 — Diferenciación nativa de residuos industriales

**Objetivo:** superar a un EHS genérico mediante integración operacional.

Entregables:

- perfiles de residuos/sustancias, HDS, GHS e incompatibilidades;
- controles preventivos derivados del residuo y operación;
- enlace con orden, manifiesto, contenedor, vehículo, ruta y recepción;
- inspección preoperacional según carga;
- contingencias de derrame/volcamiento;
- conciliación con SIDREP/SINADER según mecanismos autorizados;
- indicadores EHSQ por cliente, contrato, residuo y servicio.

Criterio de salida:

- una orden operacional produce automáticamente los controles exigibles;
- no hay doble digitación entre operación, ambiente y seguridad;
- un evento puede rastrearse desde el trabajador hasta el residuo y manifiesto.

### Fase 4 — Plataforma empresarial y analítica avanzada

**Objetivo:** escalar comercial y operacionalmente.

Entregables:

- API y webhooks;
- SSO/MFA empresarial;
- portales de cliente y mandante;
- constructor controlado de flujos/formularios;
- analítica de tendencias y reincidencia;
- benchmarking entre faenas;
- automatización de alertas y asignación;
- paquete de auditoría y certificación.

La analítica predictiva solo debe abordarse después de asegurar calidad, completitud y semántica de los datos transaccionales.

---

## 13. Definición de “módulo completo”

Prevención puede considerarse completo para Chome cuando se cumplan conjuntamente estos criterios:

### Cobertura y aplicabilidad

- [ ] Existe registro legal versionado y aplicabilidad por faena/rol.
- [ ] Cada requisito aplicable tiene dueño, evidencia, frecuencia y estado.
- [ ] La MIPER cubre procesos, tareas, puestos, sustancias, residuos y cambios.
- [ ] El PDTP se deriva y actualiza desde riesgos y obligaciones.

### Operación preventiva

- [ ] Incidentes y enfermedades tienen registro, denuncia, investigación y CAPA.
- [ ] Los controles críticos se verifican antes y durante la tarea.
- [ ] Los permisos/AST/PPA se conectan con la orden real de trabajo.
- [ ] Inspecciones y auditorías funcionan online y offline.
- [ ] Emergencias y simulacros tienen planificación, ejecución y aprendizaje.

### Personas

- [ ] Cada trabajador tiene expediente preventivo consolidado.
- [ ] ODI, capacitación y competencias están vigentes y demostrables.
- [ ] EPP requerido, entregado, certificado e inspeccionado está conciliado.
- [ ] Salud ocupacional está segregada y conectada solo mediante aptitud/restricción mínima.
- [ ] Trabajadores y CPHS participan y pueden reportar sin fricción.

### Empresas y activos

- [ ] Contratistas y subcontratistas se acreditan y coordinan por faena.
- [ ] Vehículos, equipos y contenedores se vinculan con controles e inspecciones.
- [ ] Residuos, sustancias y HDS determinan controles operacionales.
- [ ] Orden, ruta y manifiesto conservan trazabilidad EHSQ.

### Evidencia y gobierno

- [ ] Documentos tienen aprobación, publicación, acuse y obsolescencia trazables.
- [ ] Todas las acciones usan CAPA común con verificación de eficacia.
- [ ] Los indicadores se calculan desde registros fuente y respetan definiciones legales.
- [ ] Los datos sensibles tienen mínimo privilegio, auditoría y retención.
- [ ] Existen reportes para gerencia, CPHS, mandante y autoridad según alcance.
- [ ] La autorización se prueba negativamente por rol, faena y endpoint.

### Sustitución de SFTI

- [ ] Se levantó el inventario real de módulos, configuraciones y datos usados en SFTI.
- [ ] Cada caso tiene paridad funcional y probatoria aceptada por el dueño del proceso.
- [ ] Los históricos fueron migrados y conciliados.
- [ ] Se ejecutó operación paralela con criterios de éxito y reversa.
- [ ] La jefatura de prevención, usuarios de faena, TI y asesoría jurídica aprobaron el corte.

---

## 14. Recomendación final

No conviene seguir agregando formularios aislados bajo `/prevencion`. La secuencia correcta es:

1. corregir la integridad legal y de cierre de lo existente;
2. crear las fuentes de verdad de requisito, riesgo, incidente y CAPA;
3. alcanzar paridad demostrable con los usos reales de SFTI;
4. reutilizar los datos corporativos de trabajadores, faenas, Bodega, flota y operación;
5. construir la diferenciación vertical de residuos industriales;
6. retirar SFTI solo después de migración y operación paralela aceptadas.

La base más valiosa para continuar es PDTP. Debe convertirse en el ejecutor de medidas que nacen del riesgo y del cumplimiento. PPA debe ser el control ligero de terreno dentro del trabajo real. La biblioteca debe convertirse en evidencia aprobada y distribuida. Los indicadores deben ser consecuencia de eventos, no una planilla paralela.

Si se sigue esta arquitectura, Chome no terminará con una copia incompleta de SFTI, sino con una plataforma que une prevención, ambiente y operación de residuos en una sola trazabilidad.

---

## 15. Fuentes consultadas

### Normativa y organismos oficiales

- [DS 44/2024 del Ministerio del Trabajo y Previsión Social — BCN](https://www.bcn.cl/leychile/navegar?i=1205298&f=2025-02-01)
- [Dirección del Trabajo — entrada en vigencia y contenidos del DS 44](https://www.dt.gob.cl/portal/1626/w3-article-127643.html)
- [Código del Trabajo, arts. 184 y 184 bis — BCN](https://www.bcn.cl/leychile/navegar?idNorma=207436&idParte=8512045&idVersion=2025-01-01)
- [Ley 16.744, art. 76 — BCN](https://www.bcn.cl/leychile/navegar?idNorma=28650&idParte=8745489&idVersion=2022-03-10)
- [SUSESO — DIAT y DIEP](https://www.suseso.cl/613/articles-496836_archivo_03.pdf)
- [SUSESO — accidentes fatales y graves](https://www-cloud.suseso.cl/613/w3-propertyvalue-137143.html)
- [DS 76/2006, subcontratación — BCN](https://www.bcn.cl/leychile/Navegar/imprimir?idNorma=257601&idParte=)
- [DS 594/1999, condiciones sanitarias y ambientales — BCN](https://www.bcn.cl/leychile/Navegar?idNorma=167766)
- [DS 594, EPP — BCN](https://www.bcn.cl/leychile/navegar?f=undefined&i=1074204)
- [DS 18, certificación de EPP — BCN](https://www.bcn.cl/leychile/navegar?idNorma=7603&idParte=8629477&idVersion=1982-10-20)
- [Ley 21.643, Ley Karin — BCN](https://www.bcn.cl/leychile/navegar?idNorma=1200096&idParte=10485704&idVersion=2024-08-01)
- [Dirección del Trabajo — procedimiento de investigación Ley Karin](https://www.dt.gob.cl/portal/1626/w3-article-128823.html)
- [SUSESO — CEAL-SM](https://www-cloud.suseso.cl/606/w3-propertyvalue-614691.html)
- [MINSAL — Salud Ocupacional y protocolos](https://www.minsal.cl/salud-ocupacional/)
- [DS 148/2003, residuos peligrosos — BCN](https://www.bcn.cl/leychile/navegar?idNorma=226458)
- [DS 43/2015, almacenamiento de sustancias peligrosas — BCN](https://www.bcn.cl/leychile/navegar?idNorma=1088802&idVersion=2022-08-17)
- [DS 57/2019, clasificación y etiquetado GHS — BCN](https://www.bcn.cl/leychile/navegar?f=2021-02-09&i=1155752)
- [DS 298/1994, transporte de cargas peligrosas — BCN](https://www.bcn.cl/leychile/navegar?idNorma=12087)
- [Reglamento RETC — BCN](https://www.bcn.cl/leychile/Navegar/imprimir?idNorma=1050536&idVersion=2018-12-11)
- [SINADER — Ventanilla Única RETC](https://portalvu.mma.gob.cl/sinader/)
- [Ministerio del Medio Ambiente — RETC, SIDREP y SINADER](https://retc.mma.gob.cl/que-es-el-retc/)
- [Ley 19.628 sobre protección de la vida privada — BCN](https://www.bcn.cl/leychile/Navegar?idNorma=141599&idParte=8642680)
- [Ley 21.719, nueva regulación de datos personales — BCN](https://www.bcn.cl/leychile/Navegar/imprimir?idNorma=1209272&idParte=10527471&idVersion=2026-12-01)

### Estándares y contexto de Chome

- [ISO 45001 — sistema de gestión de seguridad y salud](https://www.iso.org/standard/63787.html?layout=default)
- [ISO — publicación de ISO 14001:2026](https://www.iso.org/news/2026/04/iso-14001-2026-published)
- [ISO 9001 — sistema de gestión de calidad](https://www.iso.org/home/insights-news/resources/iso-9001-explained.html)
- [Servicios Chome — operación y servicios](https://servicioschome.cl/)

### Productos comparados

- [Manual SFTI/Safeti](https://manual.safeti.cl/en/)
- [Safeti — plataforma](https://safeti.cl/safeti2023/)
- [Safeti — permisos de trabajo](https://manual.safeti.cl/permisos-trabajo/listado/)
- [ZYGHT — soluciones EHS](https://zyght.com/soluciones/)
- [CorityOne — plataforma EHS](https://www.cority.com/corityone/)
- [Intelex — aplicación móvil](https://www.intelex.com/products/mobile)
- [Intelex — gestión de auditorías](https://www.intelex.com/products/applications/audits-management)
- [SafetyCulture — inspecciones e informes](https://safetyculture.com/inspections-and-reports)
- [SafetyCulture — gestión documental](https://safetyculture.com/documents)
- [AMCS — Enterprise Management para residuos](https://www.amcsgroup.com/solutions/enterprise-management/)
- [WasteLinq — software para residuos industriales y peligrosos](https://www.wastelinq.com/)

**Fecha de consulta de fuentes web:** 18 de julio de 2026.
