# Auditoría de Production Readiness — Módulo de Prevención (Programa Anual / PDTP)

**Fecha:** 2026-09-28 · **Commit auditado:** `7059c875` (`main`, árbol limpio) · **Modo:** diagnóstico, sin cambios de producto.

**Método y alcance real**

- **Código:** cuatro revisiones en paralelo, en solo lectura: núcleo del PDTP; integración con submódulos y evidencia; seguridad y permisos; trazabilidad, datos y operación. Los hallazgos de mayor peso se re-verificaron directamente en el código (se marcan **✔**).
- **Base de desarrollo:** `bodega_dev` (127.0.0.1:5433), solo `SELECT` en `BEGIN READ ONLY … ROLLBACK`. Está sincronizada con el journal: 336 de 336 migraciones hasta la 0335.
- **Navegador:** recorrido de `next dev` (:3001) con Chromium y la sesión QA, a 1440 y 390 px. Se cubrieron 53 rutas de Prevención, con registro de errores de consola, respuestas ≥400, desborde horizontal y h1 duplicados. Hay capturas de las pantallas centrales.
- **Prueba de realidad:** 10 actividades recorridas por la **capa de servicios real** sobre PGlite con todas las migraciones, más tres demostraciones de acreditación por integración (ver §9). Fue un archivo de prueba **temporal**, ya eliminado; la copia quedó en el scratchpad de la sesión.
- **Puertas deterministas:** `typecheck` PASS y `lint` PASS sobre `main`. Las revisiones de código corrieron además subconjuntos de pruebas: 94 + 59 + 75 + 32 + 22 + 32 + 25 pruebas, todas en verde. E2E del flujo PDTP: 16 specs, **53 PASS** (ver §12).

**Sin recorrer**

- Producción y datos reales.
- Recorrido de navegador con usuarios de rol acotado: el usuario QA tiene los 16 roles, así que los permisos se verificaron en código y pruebas, no en la UI.
- WebKit.
- `test:fast`/`test:pglite` completos sobre este commit. La última corrida completa es de la rama `prevencion/fx-integracion` (1f38cbd8).
- Crons en el contenedor real.
- Envío real de correo.
- La acreditación de punta a punta desde cada submódulo con datos reales: `bodega_dev` tiene 0 ejecuciones en el programa v2, así que se probó por servicio y E2E.

**Incidente de proceso**

- Una de las revisiones hizo **un** GET anónimo a `http://127.0.0.1:3000/reportar-incidente`. Ese puerto sirve producción (redirige a `plataforma.portalchome.cl`). Es una ruta pública de solo lectura y no mutó nada. Después de eso todo se hizo sobre `:3001` y `:55432`.
- La primera corrida E2E no arrancó: el `next build` falló el type-check por errores de tipos en el archivo de prueba temporal de esta auditoría. Se eliminó el archivo y se relanzó. No es un defecto del producto.

---

## 1. Resumen ejecutivo

El módulo **no es un prototipo**. El núcleo Programa → Actividad → Ejecución → Evidencia → Cumplimiento **funciona de punta a punta** y se verificó ejecutándolo:

- Las cifras del indicador cuadran exactamente con el cálculo manual.
- Los cuatro estados (pendiente, se hizo, no se hizo, no aplica) están bien diferenciados.
- La base impone reglas duras con CHECK e índices:
  - motivo ≥ 10 caracteres;
  - revisor ≠ declarante;
  - un solo desvío abierto por celda;
  - `RESTRICT` sobre ejecuciones y cierres.
- «Se hizo» exige un archivo real, verificado por bytes mágicos y sha256, con dueño y faena.
- El «no aplica» nace en revisión y lo aprueba otra persona.
- Aprobar lo propio está bloqueado.
- El doble envío converge a una sola fila.
- Los cierres mensual y anual congelan los datos.
- La interfaz pasa el recorrido sin errores de consola, sin 500 y sin desbordes a 390 px.

El problema está en **una sola frontera: la evidencia que llega por integración desde los submódulos.**

1. Cinco fuentes se **auto-aprueban** si traen «evidencia real». El sistema decide que la hay solo por el texto: que empiece con `storage/` o `http(s)://`. No comprueba que el archivo exista. Se demostró ejecutándolo: un acta CGRD con una ruta a un archivo inexistente y un simulacro con `https://x` quedaron **aprobados** y con `evidenceStatus = "provided"`.
2. Las ejecuciones de integración **no registran quién originó el hecho**, y la aprobación **no exige evidencia** para ellas. Quien registró el hecho en el submódulo puede aprobar su propia ejecución PDTP sin evidencia. También se demostró ejecutándolo.

En la prueba de realidad, esas tres operaciones llevaron el cumplimiento «a la fecha» de **78 % a 94 % sin un solo archivo y sin una segunda persona**.

A eso se suman:

- ejecuciones con fecha **futura** que se pueden registrar y aprobar;
- revocaciones que faltan cuando se archiva la fuente;
- una bitácora que el rol de la aplicación puede editar;
- una observabilidad que no avisa si los jobs dejan de correr.

**Nada de esto es difícil de corregir.** Los dos críticos son de esfuerzo bajo, y el resto son guardas puntuales. No se encontraron pérdidas de datos, IDOR explotables ni acciones sin autorización: se revisaron 279 server actions y todas tienen guard. Tampoco hay mocks en producto. El módulo **no necesita más funcionalidad** antes de salir. Necesita cerrar la confianza en la evidencia de integración.

---

## 2. Production Readiness Score

```text
PRODUCTION READINESS

68 / 100

Categoría:
No listo para producción (60–69)
```

**Límites de la regla 25:** **no se aplicó ninguno.** El razonamiento es este.

- **Límite 59 (alteración arbitraria del cumplimiento o evidencia no confiable).** Se evaluó expresamente por PRV-01 y PRV-02. No se aplica por tres razones:
  1. En ambos casos el cumplimiento nace de un **registro real del submódulo**: un acta CGRD con fecha y quórum, un simulacro, una constitución de CPHS. El §8 del encargo reconoce esos registros como evidencia legítima generada por otro módulo.
  2. Hace falta un usuario con el permiso operativo de ese submódulo.
  3. Todo queda trazado con actor, fuente e id.

  Lo defectuoso es la **verificación del artefacto adjunto** y la **segregación**, no la existencia de una fuente. **Si la organización exige que todo cumplimiento tenga un archivo verificable y una segunda persona sin excepción, este límite aplica y la nota máxima es 59.**
- **Límite 69 (flujo principal roto).** No aplica: el flujo funciona integralmente (§8 y §9).
- **Límite 69 (mocks).** No aplica: no hay mocks, placeholders ni datos simulados en producto.

**Si se corrigen PRV-01 y PRV-02,** la nota estimada queda en **~76–78**: funcional, requiere correcciones. **Con la Fase 2 completa, ~84.**

## 3. Desglose de puntuación

| Área | Puntos | Nota | Descuentos principales |
|---|---:|---:|---|
| Flujo Programa → Actividad → Cumplimiento | 20 | **15** | PRV-03 futuro (−2), PRV-07 atraso parcial oculto (−1), PRV-08 múltiples ejecuciones por celda (−0,5), PRV-09 RE-36 con otro corte (−1), PRV-20 aprobación manual como cuello de botella (−0,5) |
| Evidencias y trazabilidad | 15 | **8** | PRV-01 (−3), PRV-04 revocaciones faltantes (−1,5), PRV-13 bitácora mutable (−1), PRV-12 sin anulación (−0,5), PRV-17 GC latente (−0,5), M-12 evidencia perdida sigue «cumplida» (−0,5) |
| Integración con submódulos | 15 | **9** | PRV-19 defectos previos abiertos (−2), PRV-06 ocurrencias obsoletas (−1), PRV-22 N°20 como constancia (−1), PRV-16 NA rechazado en silencio (−1), PRV-20 (−1) |
| Integridad y consistencia de datos | 10 | **7** | PRV-11 padrón retroactivo (−1), PRV-05 cancelación sin guarda de cierre (−1), PRV-10 UTC (−0,5), M-07 cascadas por faena (−0,5) |
| Roles, permisos y seguridad | 10 | **6,5** | PRV-02 segregación en integración (−2), PRV-18 descarga por `LIKE` (−0,5), PRV-15 canal público roto (−0,5), M-02…M-05 (−0,5) |
| UX/UI y facilidad de operación | 10 | **7,5** | PRV-20 «Ejecutadas 0» con 19 envíos esperando (−0,5), PRV-08 error confuso (−0,5), PRV-19 EPP sin salida (−0,5), C-03 ids internos en Aprobaciones (−0,5), M-01 texto NA (−0,5) |
| Testing y estabilidad | 8 | **6,5** | Ningún defecto demostrado (PRV-01/02/03/07/08) tiene prueba que lo cubra (−1,5). Ver §12 |
| Manejo de errores y casos borde | 5 | **3,5** | PRV-03 fechas futuras (−1), M-10 `.catch(() => null)` → 404 (−0,5) |
| Performance | 3 | **2,5** | M-11 N+1 en recordatorios y cola sin paginar (−0,5) |
| Observabilidad y operación | 4 | **2** | PRV-14 sin alerta de staleness, sin captura de errores, reconciliador semanal y respaldo con perfil opcional (−2) |
| **Total** | **100** | **67,5 → 68** | |

## 4. ¿Qué funciona correctamente? (verificado)

**Ejecutado en la prueba de realidad (servicios reales sobre PGlite):**

- **Programa:**
  - hay un programa activo por año;
  - el contenido firmado es inmutable y los cambios pasan por una revisión v+1;
  - una actividad con ejecuciones no se puede borrar físicamente (`RESTRICT`, demostrado);
  - el retiro es lógico y lleva motivo.
- **Evidencia manual:**
  - sin evidencia → rechazado («Esta actividad exige evidencia: Acta firmada en PDF»);
  - con solo texto → rechazado;
  - con archivo registrado → aceptado.
- **Segregación manual:**
  - autoaprobar → rechazado;
  - aprobar dos veces → rechazado;
  - revisar el propio «no aplica» → rechazado.
- **«No se hizo»:** un motivo corto se rechaza (mínimo 10 caracteres). Queda `active`, sigue en el denominador y el mes explicado no cuenta como atrasado.
- **«No aplica»:** nace `pending_review` y, una vez aprobado por otra persona, sale del denominador. No se puede declarar para una celda futura.
- **Atrasadas:** un mes vencido sin ejecución queda `overdue` con su conteo de meses (A05 y A08).
- **Cálculo** (ver §9):
  - anual 12/22 = 55 % y a la fecha (hasta septiembre) 12/18 = 67 %, iguales al cálculo manual celda por celda;
  - tope por actividad y mes;
  - una ejecución «cuando corresponda» sin plan no infla el % (A03).
- **Concurrencia:** dos envíos simultáneos a la misma celda no duplican (lock por celda más id determinista).

**Recorrido de navegador (1440 y 390 px, 53 rutas):**

- 0 errores de consola.
- 0 respuestas ≥400 (salvo una ruta inventada por el auditor).
- 0 desbordes horizontales.
- 0 h1 duplicados.
- Tablero, planilla, aprobaciones y detalle de ejecución se ven legibles.
- A 390 px la planilla pasa a una vista usable, con filtros agrupados en «Más filtros».

**Verificado en código y en pruebas:**

- Las 279 server actions de Prevención tienen guard de permiso.
- La faena se valida en servidor (`assertWorksiteAccess`).
- El registro limita a actividades propias salvo Prevención (PREV-I03).
- Evidencia PDTP:
  - límite de 25 MB;
  - MIME por bytes mágicos (PDF/JPEG/PNG);
  - nombre `nanoid` y extensión según el MIME;
  - sha256;
  - fila de dueño y faena;
  - descarga por igualdad exacta y alcance.
- Sin `sql.raw` ni `dangerouslySetInnerHTML` en el módulo.
- Tokens públicos HMAC con expiración firmada.
- Trazabilidad: cada mutación crítica escribe en `pdtp_change_log`/`audit_log` **en la misma transacción**, con antes, después, actor y motivo (tabla en §10).
- Respaldo nocturno cifrado de base y storage, con ensayo semanal de restauración que cruza las referencias de evidencia.
- Escaneo diario de integridad de la evidencia PDTP, con aviso.
- `typecheck` y `lint` en verde.
- De los 19 defectos de la auditoría del 22-09 quedan **8 corregidos, 6 parciales y 5 abiertos**.

## 5. ¿Qué impide salir a producción?

**No hay bloqueadores en sentido estricto** (§2 explica por qué no se aplicó el límite 59). Aun así, **salir sin corregir PRV-01 y PRV-02 sería irresponsable** para un sistema cuyo propósito es demostrar el cumplimiento ante una fiscalización: permiten que el programa diga «cumplida, evidencia entregada» sin archivo y sin segunda persona. Son la condición mínima (§19).

## 6. Matriz funcional

| Funcionalidad | Estado | Evidencia | Problema | ¿Bloquea? |
|---|---|---|---|---|
| Crear programa | ✅ Completa | `programs.ts:119` es idempotente por año; hay índice de un activo por año | — | No |
| Configurar programa | 🟡 Parcial | Se edita solo en borrador (`helpers.ts:71-81`); los cambios van por v+1 | El padrón se edita en activo y reescribe meses pasados (PRV-11) | No |
| Crear actividad | ✅ Completa | `addPdtpActivity` (prueba de realidad) | — | No |
| Editar actividad | 🟡 Parcial | Solo en borrador; queda en el change_log | Sin lock ni control optimista de versión en los textos (M-17) | No |
| Eliminar actividad | ✅ Completa | Retiro lógico con motivo; el borrado físico lo impide `RESTRICT` (demostrado) | — | No |
| Responsable | ✅ Completa | Catálogo obligatorio más asignación nominal con vigencia (`assignees.ts`) | — | No |
| Fecha | 🔴 Defectuosa | Celdas mes/semana | Acepta y aprueba ejecuciones futuras (PRV-03, demostrado) | No |
| Recurrencia | ✅ Completa | Semanal a anual y personalizada; presets | — | No |
| Actividad condicionada | ✅ Completa | Eventos disparadores (`trigger-events.ts`) y obligaciones | Cancelación sin revisión (PRV-05) | No |
| Cuando corresponda | ✅ Completa | `on_demand` y obligaciones; no infla el % (A03) | ídem PRV-05 | No |
| Mínimo de ejecuciones | ✅ Completa | `minAnnualExecutions`; pruebas `pdtp-annual-minimum` en verde | — | No |
| Asociación con submódulo | 🟡 Parcial | Conectores con 68 actividades `enganche` (SQL) | Defectos previos abiertos y N°20 (PRV-19, PRV-22) | No |
| Evidencia | 🔴 Defectuosa | Manual: completa. Integración: sin verificar | PRV-01, PRV-04 | **Condición mínima** |
| Se hizo | 🟡 Parcial | Exige archivo; segregación manual | Futuro (PRV-03); sin anulación (PRV-12); integración sin segregación (PRV-02) | **Condición mínima** |
| No se hizo | ✅ Completa | Motivo ≥ 10, actor, fecha, changelog (demostrado) | — | No |
| No aplica | ✅ Completa | Revisión por otra persona, fuera del denominador y no a futuro (demostrado) | El NA de una casilla rechazado se pierde (PRV-16) | No |
| Pendiente | ✅ Completa | Distinto de no hecha y de atrasada (`period.ts:16`) | — | No |
| Historial | ✅ Completa | Historial de envíos por ejecución más change_log | La vista del programa muestra solo 20 (M-18) | No |
| Auditoría | 🟡 Parcial | `audit_log` en la misma transacción | Mutable (PRV-13); borrar un programa no deja rastro (M-19) | No |
| Dashboard | ✅ Completa | 4 KPI accionables, tendencia, faena, eje | Sin aviso de envíos por aprobar (PRV-20) | No |
| % de cumplimiento | 🟡 Parcial | Correcto en el indicador (demostrado) | RE-36 y reporte de gestión con otro corte (PRV-09) | No |
| Actividades atrasadas | 🟡 Parcial | Regla por mes vencido (demostrada) | Una ejecución parcial oculta el atraso (PRV-07, demostrado) | No |
| Actividades próximas | 🟡 Parcial | Recordatorios semanales, «Mis pendientes», instancias | No hay una vista explícita de «próximas N semanas» (se revisó poco) | No |
| Permisos | 🟡 Parcial | 279 acciones con guard; alcance por faena | PRV-02; `program:manage` sin alcance (M-05) | No |
| Integración entre módulos | 🟡 Parcial | Ver la matriz del §8 | PRV-01/02/04/06 | **Condición mínima** (PRV-01/02) |
| Cambio de año | ✅ Completa | Copia al año siguiente, cierre anual estricto, dos años activos | Contrato de destinos atado a 2026 (M-13): revisar antes del ciclo 2027 | No |
| Exportación | ✅ Completa | Excel, RE-36, expediente del auditor, reporte de gestión (con permiso y faena) | Corte del RE-36 (PRV-09) | No |
| Mobile/responsive | ✅ Completa | 0 desbordes a 390 px; spec `pdtp-registrar-movil` | — | No |

## 7. Hallazgos

Los críticos e importantes usan la plantilla completa. Las mejoras y los cosméticos van en formato tabular condensado, con los mismos campos esenciales, para que el informe siga siendo legible.

### 7.1 Bloqueadores

Ninguno (ver §2).

### 7.2 Críticos

```text
ID: PRV-01
Severidad: 🟠 CRÍTICO
Área: Evidencias / Integración
Título: La acreditación automática da por "evidencia entregada" una ruta o URL que no se verifica

Archivo(s): lib/services/pdtp/accreditation.ts; lib/validation/prevention-module/cgrd.ts; lib/validation/evidence-contract.ts; lib/services/pdtp-adapters/external-engagement-accreditation-connector.ts
Línea(s): accreditation.ts:589-590 (isRealEvidence), 598-601 (canAutoApprove), 880-905 (insert); cgrd.ts:13-16; evidence-contract.ts:77; external-engagement…:173-186
Ruta/pantalla: /prevencion/cgrd, /prevencion/emergencias, /prevencion/alcotest, /prevencion/higiene, /prevencion/coordinacion
Endpoint: server actions de cierre de acta / simulacro / control / medición / coordinación → accreditPdtpFromEvent
Rol afectado: quien tenga el permiso operativo del submódulo (prevencionista, prevencionista_faena, jefa_chome en CGRD)

Descripción: Para alcotest, emergencia, cgrd, higiene y engagement, la ejecución PDTP se auto-aprueba si `isRealEvidence`, que es solo `startsWith("storage/") || /^https?:\/\//`. No se comprueba que el archivo exista, ni su dominio, ni su dueño o faena. El esquema del CGRD acepta cualquier ruta con nombre válido o cualquier URL, y la UI invita a pegar un enlace ("Sube el acta… o pega su enlace", cgrd-workbench.tsx:454). En la N°20, un `officialReference` de texto libre (120 caracteres) puede servir de evidencia. El barrido de integridad solo recorre storage/pdtp-evidence/, así que una ruta `storage/cgrd-evidence/…` inexistente no se detecta nunca.

Evidencia: prueba de realidad ejecutada (§9, INT-1 e INT-2):
 accreditPdtpFromEvent({sourceType:"cgrd", evidenceRef:"storage/cgrd-evidence/no-existe.pdf", autoApproveByUserId}) → status "approved", evidenceStatus "provided"
 accreditPdtpFromEvent({sourceType:"emergencia", evidenceRef:"https://x", …}) → status "approved", evidenceStatus "provided"

Cómo reproducir:
1. En /prevencion/cgrd, cerrar un acta con quórum y, en la evidencia, pegar "https://x".
2. Abrir /prevencion/pdtp: la N°81 de esa faena queda aprobada, sin pasar por /aprobaciones.
3. (Con una petición construida) una ruta storage/cgrd-evidence/<nombre-inexistente>.pdf produce lo mismo.

Resultado actual: cumplimiento aprobado con "evidencia entregada" que no existe o no se verificó, y sin una segunda persona.
Resultado esperado: auto-aprobar solo si el archivo existe en el dominio correcto, pertenece a esa faena y tiene su sha256 registrado. Una URL externa o un texto libre deja la ejecución `submitted` para revisión.
Impacto en producción: el programa puede afirmar ante un fiscalizador que existe una evidencia que no existe. Es el tipo de dato que el módulo existe para garantizar.
Causa probable: la regla M0.4 (22-09) definió "evidencia real" por la forma del texto, no por su existencia.
Solución recomendada: en accreditPdtpFromEvent, reemplazar isRealEvidence por una verificación por dominio (existencia + fila de subida con dueño y faena + sha256); tratar las URL http(s) como evidencia descriptiva (sin auto-aprobación); en la N°20, aceptar solo el archivo vinculado. Agregar una prueba PGlite de regresión con los tres casos.
Esfuerzo estimado: Bajo–Medio
Bloquea producción: No (condición mínima de §19)
```

```text
ID: PRV-02
Severidad: 🟠 CRÍTICO
Área: Permisos / Segregación
Título: Las ejecuciones por integración no tienen segregación ni exigen evidencia al aprobarlas

Archivo(s): lib/services/pdtp/executions.ts; lib/services/pdtp/accreditation.ts
Línea(s): executions.ts:471 (se salta la evidencia si origin==="integration"), 550-552 (compara solo executedByUserId); accreditation.ts:880-905 (inserta sin executedByUserId)
Ruta/pantalla: /prevencion/pdtp/aprobaciones
Endpoint: approvePdtpExecutionAction
Rol afectado: quien registra el hecho en el submódulo y además tiene prevention:pdtp:approve (prevencionista, administrador, jefa_chome)

Descripción: Las ejecuciones que nacen de un submódulo (CPHS, MIPER, indicadores, documentación, plan de emergencia, EPP, RE-20, y alcotest/simulacro/CGRD sin archivo) quedan `submitted` sin registrante. approvePdtpExecution solo impide aprobar a `executedByUserId`, que aquí es null, y assertExecutionHasEvidenceForApproval retorna sin revisar nada para origin "integration". Quien originó el hecho aprueba su propio cumplimiento sin evidencia.

Evidencia: prueba de realidad ejecutada (§9, INT-3): accreditPdtpFromEvent({sourceType:"cphs", evidenceRef:"Constitución CPHS registrada"}) → submitted; approvePdtpExecution(id, <mismo usuario que registró>) → "approved", evidenceStatus "not_required". En las manuales, el mismo intento se rechaza ("Quien registró el cumplimiento no puede aprobarlo").

Cómo reproducir:
1. Como prevencionista, registrar en su submódulo un hecho que acredite sin archivo (p. ej. publicar una MIPER o cerrar indicadores del mes).
2. Ir a /prevencion/pdtp/aprobaciones y aprobar la ejecución resultante con el mismo usuario.
3. La celda cuenta como cumplida.

Resultado actual: la aprobación la hace la misma persona, y sin evidencia.
Resultado esperado: se guarda el actor del hecho de origen (executedByUserId o sourceActorUserId) y se compara al aprobar. Una integración sin artefacto exige al aprobador un motivo o una evidencia.
Impacto en producción: la segregación, que el resto del módulo cuida con CHECK en la base, tiene una puerta abierta en justo la vía que más actividades acredita.
Causa probable: el modelo supuso que "nadie tecleó" = "no hay conflicto de interés".
Solución recomendada: persistir el actor de origen en todas las llamadas a accreditPdtpFromEvent y compararlo en approvePdtpExecution; exigir motivo o evidencia para aprobar una integración sin artefacto; prueba de regresión.
Esfuerzo estimado: Bajo
Bloquea producción: No (condición mínima de §19)
```

### 7.3 Importantes

```text
ID: PRV-03
Severidad: 🟡 IMPORTANTE
Área: Flujo / Fechas
Título: Se puede registrar y aprobar "Se hizo" en semanas futuras
Archivo(s): lib/services/pdtp/executions.ts; lib/services/pdtp/version-window.ts; app/(app)/prevencion/pdtp/pdtp-execution-form.tsx
Línea(s): executions.ts:49-120 (sin guarda de futuro); version-window.ts:212-255; pdtp-execution-form.tsx:62-66 (ofrece hasta diciembre); comparar con deviations.ts:172 (el NA sí la tiene)
Ruta/pantalla: planilla /prevencion/pdtp/actividades → "Registrar"
Endpoint: markPdtpExecutionAction, approvePdtpExecutionAction
Rol afectado: ejecutores y aprobadores
Descripción: el NA rechaza períodos futuros, pero la ejecución no.
Evidencia: prueba de realidad A09: en septiembre, markPdtpExecution(mes 11) → "submitted"; approvePdtpExecution → "approved". El anual pasa de 12 a 13 celdas cumplidas.
Cómo reproducir: 1. Registrar una actividad planificada en noviembre, eligiendo noviembre. 2. Otra persona la aprueba. 3. El anual la cuenta.
Resultado actual: cumplimiento de algo que no pudo ocurrir.
Resultado esperado: rechazar celdas posteriores a la semana en curso, en el servicio (dentro de la transacción) y en el formulario.
Impacto en producción: infla el avance anual y la comparativa por faena (usa `annual`); un error de selección de mes pasa como cumplimiento.
Causa probable: la guarda isPdtpCellInFuture solo se cableó en desvíos.
Solución recomendada: reutilizar isPdtpCellInFuture en markPdtpExecution y approvePdtpExecution, y limitar los meses del formulario.
Esfuerzo estimado: Bajo
Bloquea producción: No
```

```text
ID: PRV-04
Severidad: 🟡 IMPORTANTE
Área: Integración / Trazabilidad
Título: Transiciones que anulan la fuente no revocan el cumplimiento
Archivo(s): lib/services/prevention-emergency.ts; lib/services/pdtp-adapters/hygiene-accreditation-connector.ts; lib/services/prevention-documents/crud.ts
Línea(s): prevention-emergency.ts:537-571 (archivar un plan aprobado, N°83); hygiene-accreditation-connector.ts:187 (retirar el pronunciamiento, N°46-49); prevention-documents/crud.ts:363-383 (archivar un documento, N°36/43); reemplazo de MIPER publicada (N°35)
Ruta/pantalla: /prevencion/emergencias, /prevencion/higiene, /prevencion/documentacion, /prevencion/miper
Endpoint: acciones de archivar/retirar de cada submódulo
Rol afectado: todos (lectura del cumplimiento)
Descripción: source_id no tiene FK (es texto). Sí revocan: inspección, ocurrencia de capacitación, CGRD, CPHS, EPP anulada, indicadores reabiertos. Las transiciones listadas no llaman a recordPdtpFulfillmentRevocation.
Evidencia: CÓDIGO (revisión de integración, contrastada).
Cómo reproducir: 1. Aprobar un plan de emergencia (acredita la N°83). 2. Archivarlo. 3. La N°83 sigue cumplida.
Resultado actual: la actividad sigue "cumplida" sin una fuente vigente.
Resultado esperado: revocación con motivo y entrada en el changelog, igual que en las fuentes que ya revocan.
Impacto en producción: cumplimiento que ya no se sostiene.
Causa probable: la revocación (PREV-B01) se cableó fuente por fuente y faltan estas.
Solución recomendada: llamar a la revocación en esas cuatro transiciones y agregar una prueba por conector.
Esfuerzo estimado: Medio
Bloquea producción: No
```

```text
ID: PRV-05
Severidad: 🟡 IMPORTANTE
Área: Integridad / Cumplimiento
Título: Cancelar una obligación la saca del denominador sin revisión y sin respetar los cierres
Archivo(s): lib/services/pdtp/obligations.ts; app/(app)/prevencion/pdtp/obligaciones/actions.ts
Línea(s): obligations.ts:390-440; obligaciones/actions.ts:87-90; exclusión en compliance.ts:177-191
Ruta/pantalla: /prevencion/pdtp/obligaciones
Endpoint: cancelación de obligación
Rol afectado: prevention:pdtp:obligation:cancel
Descripción: basta un motivo ≥10 caracteres; no pide segunda persona y no llama a assertPdtpPeriodOpen/assertPdtpProgramAcceptsPeriod. Queda trazado (change_log + evento).
Evidencia: CÓDIGO ✔ (obligations.ts, verificado en esta auditoría).
Cómo reproducir: 1. Una obligación RE-20 vencida de un mes ya cerrado. 2. Cancelarla con motivo. 3. Sale del indicador closed_on_time.
Resultado actual: una persona reduce el denominador, incluso en períodos cerrados.
Resultado esperado: el mismo flujo pending_review que el NA (decisión D8) y bloqueo en meses o años cerrados.
Impacto en producción: vía lateral para "mejorar" el indicador de plazos legales.
Causa probable: la cancelación se diseñó antes de D8.
Solución recomendada: una solicitud con revisión y las guardas de período.
Esfuerzo estimado: Medio
Bloquea producción: No
```

```text
ID: PRV-06
Severidad: 🟡 IMPORTANTE
Área: Integración / Datos
Título: Quedan ocurrencias de capacitación obsoletas después de alinear el catálogo con la grilla
Archivo(s): lib/services/prevention-training-occurrences.ts; lib/prevention/training-occurrences-catalog.ts
Línea(s): prevention-training-occurrences.ts:287-322 (el listado no filtra por slotKey vigente); la siembra es solo aditiva (onConflictDoNothing); catálogo :90
Ruta/pantalla: /prevencion/capacitacion
Endpoint: —
Rol afectado: prevencionistas y capacitación
Descripción: en bodega_dev, CAP-02 conserva m03-w2 y m04-w3 (creadas el 15-09) aunque el catálogo ya no las tiene. Pasa igual con las N°55, 56, 58, 63, 85, 86 y CAM-05.
Evidencia: SQL de solo lectura + CÓDIGO (revisión de integración). Cada celda planificada sí tiene su ocurrencia.
Cómo reproducir: 1. Abrir capacitación en una faena sembrada antes del 23-09. 2. Hay casillas "pendientes" fuera de la grilla. 3. Marcarlas hechas acredita una celda sin plan (cuenta 0).
Resultado actual: trabajo pedido que no suma, y casillas que confunden.
Resultado esperado: solo las ocurrencias del catálogo vigente.
Impacto en producción: si producción se sembró antes del 23-09, tiene el mismo residuo.
Causa probable: la alineación corrigió el catálogo, no los datos ya sembrados.
Solución recomendada: script idempotente que retire las ocurrencias `pending` fuera del catálogo (con reporte previo), y filtro en el listado.
Esfuerzo estimado: Bajo
Bloquea producción: No
```

```text
ID: PRV-07
Severidad: 🟡 IMPORTANTE
Área: Flujo / Indicadores
Título: Una ejecución parcial oculta el atraso
Archivo(s): lib/services/pdtp/period.ts
Línea(s): 237-250 (isUnpaidMonth exige executed === 0); 271-283
Ruta/pantalla: planilla y KPI "Atrasadas" de /prevencion/pdtp
Endpoint: —
Rol afectado: jefaturas y Prevención
Descripción: un mes vencido con ejecutado > 0 pero < planificado no cuenta como deuda.
Evidencia: prueba de realidad A10 (primera corrida): febrero planificado 4 y aprobado 2 → estado "not_scheduled", overdueMonths 0, aunque el % la cuenta en 2/4.
Cómo reproducir: 1. Una actividad con 4 en un mes pasado. 2. Aprobar 2. 3. No aparece en "Atrasadas".
Resultado actual: la lista de atrasadas no coincide con lo que el % dice que falta.
Resultado esperado: deuda parcial ("Atrasada · faltan 2") o un estado "incompleta".
Impacto en producción: la jefatura no ve el faltante.
Causa probable: la regla D9 se escribió para meses en cero.
Solución recomendada: comparar executed < planned y mostrar el faltante.
Esfuerzo estimado: Bajo
Bloquea producción: No
```

```text
ID: PRV-08
Severidad: 🟡 IMPORTANTE
Área: Flujo / UX
Título: No se puede completar una celda con varias ejecuciones después de aprobar la primera
Archivo(s): lib/services/pdtp/executions.ts
Línea(s): 130-146 (id determinista por celda), 220-222 ("ya fue aprobada y no se puede modificar")
Ruta/pantalla: planilla → "Registrar"
Endpoint: markPdtpExecutionAction
Rol afectado: ejecutores
Descripción: cada (actividad, faena, mes, semana) admite una sola ejecución. Con 4 charlas planificadas en la semana 1, aprobar 2 deja la celda cerrada para siempre. Las 2 restantes solo caben registrándolas en otra semana, con una fecha que no es la real.
Evidencia: prueba de realidad A10: segundo registro en la misma celda → "La ejecución ya fue aprobada y no se puede modificar."; el registro en la semana 2 → aceptado, y el mes queda 4/4.
Cómo reproducir: 1. Una actividad con planificado 4 en una semana. 2. Registrar 2 y aprobar. 3. Intentar registrar 2 más en esa semana.
Resultado actual: error sin guía, o un registro con fecha incorrecta.
Resultado esperado: sumar a la celda (una nueva ejecución o un complemento que también se revisa) o, al menos, un mensaje que indique registrar el resto en otra semana.
Impacto en producción: "actividad con múltiples ejecuciones" es un caso diario (charlas, entregas).
Causa probable: el modelo de una fila por celda privilegia la idempotencia.
Solución recomendada: una ejecución complementaria por celda, o el mensaje guiado como mínimo.
Esfuerzo estimado: Medio
Bloquea producción: No
```

```text
ID: PRV-09
Severidad: 🟡 IMPORTANTE
Área: Indicadores / Exportación
Título: El RE-36, el reporte de gestión y las constancias usan un corte de exigibilidad distinto al del indicador
Archivo(s): lib/services/pdtp/management-report.ts; lib/services/pdtp/re36-document.ts; lib/services/pdtp/constancias.ts; lib/services/pdtp/compliance.ts
Línea(s): management-report.ts:155; re36-document.ts:538-543,578; constancias.ts:112; compliance.ts:719 (usa effectiveActivationFor con el alta de la faena)
Ruta/pantalla: /prevencion/pdtp/[programId]/reporte, exportación RE-36
Endpoint: api/prevencion/pdtp/export, reporte-gestion
Rol afectado: jefatura, auditor externo
Descripción: los documentos cortan por program.activatedAt; el indicador y la planilla por max(activación, alta de la faena). El comentario de re36-document.ts:538 afirma que es el mismo recorte, y no lo es. El reporte de gestión, además, no suma las ocurrencias programadas.
Evidencia: CÓDIGO (revisión del núcleo).
Cómo reproducir: 1. Una faena incorporada en junio. 2. Exportar el RE-36 y compararlo con el tablero. 3. Enero a mayo aparecen como planificado en cero solo en el documento.
Resultado actual: el documento legal y el tablero difieren.
Resultado esperado: un solo corte por faena.
Impacto en producción: pérdida de confianza en las cifras, justo en el documento que se entrega.
Causa probable: el corte por faena se agregó al indicador (I12) sin propagarlo.
Solución recomendada: pasar el corte por faena, como loadApprovedExecutionsForWorksites (helpers.ts:455), y una prueba de dorado cruzado entre el indicador y el RE-36.
Esfuerzo estimado: Bajo–Medio
Bloquea producción: No
```

```text
ID: PRV-10
Severidad: 🟡 IMPORTANTE
Área: Datos / Fechas
Título: El estado de las ocurrencias programadas se calcula en UTC
Archivo(s): lib/services/pdtp/scheduled-instances.ts; lib/services/pdtp/re36-document.ts
Línea(s): scheduled-instances.ts:96-99 ✔; re36-document.ts:384-389
Ruta/pantalla: RE-36, vistas de ocurrencias
Endpoint: —
Rol afectado: todos
Descripción: `new Date().toISOString().slice(0,10)` y `completedAt.slice(0,10)`. Entre las 20:00 y la medianoche (hora de Chile) una ocurrencia completada a tiempo se informa `completed_late`, y una pendiente pasa a `overdue` un día antes. La regla ESLint no lo detecta porque la expresión va envuelta en `??`.
Evidencia: CÓDIGO ✔ + réplica en node (revisión de trazabilidad): completedAt "2026-09-29T01:00Z" con vencimiento el 28-09 → completed_late.
Cómo reproducir: completar a las 22:00 una ocurrencia que vence ese día y exportar el RE-36.
Resultado actual: "atrasada" falsa en el documento.
Resultado esperado: todayInChile() en ambos lados.
Impacto en producción: estados falsos en un documento legal.
Causa probable: la expresión esquiva la regla no-restricted-syntax.
Solución recomendada: todayInChile() y todayInChile(new Date(completedAt)), con una prueba de horario nocturno.
Esfuerzo estimado: Bajo
Bloquea producción: No
```

```text
ID: PRV-11
Severidad: 🟡 IMPORTANTE
Área: Integridad
Título: El padrón manual se edita con el programa activo y recalcula los meses pasados
Archivo(s): lib/services/pdtp/worksites.ts; lib/services/pdtp/compliance.ts
Línea(s): worksites.ts:660-684; compliance.ts (padronFor, dentro de computePdtpIndicatorsFromInputs)
Ruta/pantalla: /prevencion/pdtp/cobertura
Endpoint: acción de padrón por faena
Rol afectado: program:manage
Descripción: expectedSubjectCount no pasa por assertPdtpProgramEditableState y se aplica a los 12 meses.
Evidencia: CÓDIGO (revisión del núcleo).
Cómo reproducir: cambiar el padrón de 50 a 60 en septiembre; la cobertura de enero a agosto se recalcula en el tablero.
Resultado actual: el tablero en vivo deja de coincidir con la foto de los cierres.
Resultado esperado: un padrón con vigencia (validFrom).
Impacto en producción: historia reescrita en silencio (queda registro del cambio).
Causa probable: se excluyó a propósito para permitir correcciones.
Solución recomendada: validFrom por padrón.
Esfuerzo estimado: Medio
Bloquea producción: No
```

```text
ID: PRV-12
Severidad: 🟡 IMPORTANTE
Área: Evidencia / Corrección
Título: No hay forma de anular una ejecución manual ya aprobada
Archivo(s): lib/services/pdtp/executions.ts; lib/services/pdtp/accreditation.ts
Línea(s): executions.ts:220-222; accreditation.ts:988-1124 (la revocación es solo para la integración)
Ruta/pantalla: detalle de ejecución
Endpoint: —
Rol afectado: Prevención / jefatura
Descripción: una aprobación manual errónea, o con evidencia falsa, queda vigente para siempre.
Evidencia: CÓDIGO (revisión del núcleo; no hay ninguna vía que devuelva approved a otro estado).
Cómo reproducir: aprobar por error y buscar cómo revertirlo: no existe.
Resultado actual: la única salida es tocar la base.
Resultado esperado: una anulación con motivo, segunda persona e historial, solo en un mes abierto.
Impacto en producción: los errores humanos no se pueden corregir con trazabilidad.
Causa probable: se priorizó la inmutabilidad.
Solución recomendada: una acción "Anular aprobación" que reutilice el patrón de revocación.
Esfuerzo estimado: Medio
Bloquea producción: No
```

```text
ID: PRV-13
Severidad: 🟡 IMPORTANTE
Área: Trazabilidad
Título: La bitácora (audit_log, pdtp_change_log) acepta UPDATE y DELETE del rol de la aplicación
Archivo(s): db/schema/audit.ts; db/schema/prevention/pdtp.ts:1204-1217
Línea(s): —
Ruta/pantalla: —
Endpoint: —
Rol afectado: auditor / fiscalizador
Descripción: en dev solo existe el trigger audit_log_operational_activity_trigger; nada impide editar o borrar filas. El código no lo hace, pero la garantía depende de que nadie toque la base.
Evidencia: SQL de solo lectura (pg_trigger) — revisión de trazabilidad.
Cómo reproducir: `UPDATE audit_log …` con el rol de la aplicación, en dev (no ejecutado).
Resultado actual: bitácora alterable.
Resultado esperado: solo inserción.
Impacto en producción: debilita el valor probatorio.
Causa probable: no se diseñó como append-only.
Solución recomendada: un trigger BEFORE UPDATE/DELETE que lance error (con excepción SECURITY DEFINER para la limpieza de 6 años), o REVOKE al rol de la aplicación.
Esfuerzo estimado: Medio
Bloquea producción: No
```

```text
ID: PRV-14
Severidad: 🟡 IMPORTANTE
Área: Observabilidad
Título: Nadie avisa si los jobs dejan de correr, y la reconciliación del libro es semanal
Archivo(s): docker-compose.yml; app/api/cron/pdtp-weekly-reminders/route.ts; lib/services/cron-lock.ts; lib/logger.ts; instrumentation.ts
Línea(s): docker-compose.yml:359 (lunes 07:15), 171-172 (backup-scheduler bajo profiles: ["backup"]); pdtp-weekly-reminders/route.ts:47-79 (6 pasos en serie); cron-lock.ts:43 (getCronJobHealth sin uso); logger.ts:17 (warn en prod)
Ruta/pantalla: —
Endpoint: crons
Rol afectado: operación
Descripción: los reconciliadores del PDTP corren una vez por semana, encadenados; si falla un paso anterior, el libro no se reconcilia. No hay alerta de "job sin correr en N horas", ni captura de errores (Sentry o equivalente). backup-health solo lo llama el propio scheduler, que depende de un perfil que deploy-prod.sh no levanta.
Evidencia: CÓDIGO (revisión de trazabilidad). No se pudo comprobar desde el repositorio si el scheduler de respaldos corre en producción.
Cómo reproducir: detener el contenedor cron; no llega ningún aviso.
Resultado actual: una falla operativa es silenciosa hasta que alguien mira.
Resultado esperado: una alerta de staleness sobre cron_runs, reconciliación diaria por pasos independientes y respaldos monitoreados desde fuera.
Impacto en producción: respuesta a la pregunta del §20: la pérdida de evidencia se detecta al día siguiente (escaneo 05:15) y se recupera del respaldo nocturno, **siempre que el respaldo esté corriendo**, y hoy nadie avisa si no corre.
Causa probable: se construyó el registro (cron_runs) sin su vigilancia.
Solución recomendada: un job de staleness, agendar backup-health en el contenedor cron, separar la reconciliación en un job diario con try/catch por paso y evaluar la captura de errores.
Esfuerzo estimado: Medio
Bloquea producción: No
```

```text
ID: PRV-15
Severidad: 🟡 IMPORTANTE
Área: Seguridad / Incidentes (submódulo)
Título: El canal público de reporte de incidentes exige iniciar sesión
Archivo(s): proxy.ts; app/(public)/reportar-incidente/page.tsx
Línea(s): proxy.ts:49-59 (publicPaths no incluye /reportar-incidente); page.tsx:11 ("Sin sesión, como el PPA y el TAE")
Ruta/pantalla: /reportar-incidente
Endpoint: —
Rol afectado: trabajador sin cuenta
Descripción: el canal (INC-001) está diseñado como anónimo, con cuota por IP, pero el proxy lo redirige al login.
Evidencia: DEMOSTRADO: `curl http://localhost:3001/reportar-incidente` → 307 → /login?callbackUrl=%2Freportar-incidente.
Cómo reproducir: abrir la URL sin sesión.
Resultado actual: solo lo usa quien ya tiene cuenta.
Resultado esperado: formulario accesible sin sesión.
Impacto en producción: los cuasi accidentes que ve el personal sin cuenta no llegan al buzón.
Causa probable: faltó agregar la ruta a publicPaths.
Solución recomendada: agregar "/reportar-incidente" a publicPaths, con una prueba del proxy.
Esfuerzo estimado: Bajo
Bloquea producción: No
```

```text
ID: PRV-16
Severidad: 🟡 IMPORTANTE
Área: Integración
Título: Un "no aplica" o "no hecha" de una casilla que el PDTP rechaza queda solo en el log
Archivo(s): lib/services/pdtp/deviations.ts; slot-deviation-connector.ts
Línea(s): deviations.ts:88-89,337; slot-deviation-connector.ts:302-303
Ruta/pantalla: casillas de capacitación, alcotest, simulacros, CGRD, higiene
Endpoint: —
Rol afectado: responsables de las casillas
Descripción: con una semana futura, un mes cerrado o una celda sin plan, la casilla dice "No aplica" y la celda del PDTP sigue exigida, sin aviso ni reintento.
Evidencia: CÓDIGO (revisión de integración).
Cómo reproducir: declarar NA en una casilla de un mes ya cerrado.
Resultado actual: el submódulo y el programa se contradicen.
Resultado esperado: validar antes, en el servicio de la casilla, y mostrar el motivo al usuario.
Impacto en producción: incumplimientos "fantasma" que el usuario cree resueltos.
Causa probable: la propagación es best-effort.
Solución recomendada: validación previa con las mismas guardas y un error visible.
Esfuerzo estimado: Medio
Bloquea producción: No
```

```text
ID: PRV-17
Severidad: 🟡 IMPORTANTE (latente)
Área: Evidencia
Título: El GC de evidencia no considera pdtp_scheduled_instance_outcome_requests.evidence_ref
Archivo(s): lib/services/pdtp/evidence-references.ts; db/schema/prevention/pdtp.ts
Línea(s): evidence-references.ts:102-166; pdtp.ts:711
Ruta/pantalla: —
Endpoint: cron pdtp-evidence-gc
Rol afectado: —
Descripción: una solicitud que pase más de 24 h en revisión perdería su archivo cuando el GC borre de verdad.
Evidencia: CÓDIGO (revisión de integración). Hoy el GC corre en modo de prueba (PDTP_EVIDENCE_GC_DELETE vacío).
Cómo reproducir: —
Resultado actual: riesgo latente.
Resultado esperado: esa columna incluida en las referencias.
Impacto en producción: pérdida de evidencia el día que se active el borrado.
Causa probable: la columna se agregó en 0334 después de la fuente única de referencias.
Solución recomendada: sumarla y agregar una prueba de GC; **no activar PDTP_EVIDENCE_GC_DELETE antes**.
Esfuerzo estimado: Bajo
Bloquea producción: No (sí bloquea activar el borrado)
```

```text
ID: PRV-18
Severidad: 🟡 IMPORTANTE
Área: Seguridad / Evidencia
Título: La descarga de evidencia del CGRD y de Campañas autoriza con LIKE %name%
Archivo(s): app/api/prevencion/cgrd/evidence/[name]/route.ts; app/api/prevencion/campanas/evidence/[name]/route.ts
Línea(s): cgrd/…:57-73; campanas/…:47-50
Ruta/pantalla: descarga de evidencia
Endpoint: GET /api/prevencion/{cgrd,campanas}/evidence/[name]
Rol afectado: usuarios de faena
Descripción: basta que una fila propia contenga el nombre (p. ej. dentro de una URL) para descargar un archivo de otra faena. Mitiga que los nombres son nanoid.
Evidencia: CÓDIGO (revisión de integración). RIESGO TEÓRICO, no explotado.
Cómo reproducir: —
Resultado actual: autorización por coincidencia parcial.
Resultado esperado: igualdad exacta, como en el PDTP (evidence-references.ts:58-94).
Impacto en producción: posible exposición entre faenas.
Causa probable: los submódulos no adoptaron la fuente única de referencias.
Solución recomendada: igualdad exacta más un registro de dueño y faena al subir.
Esfuerzo estimado: Medio
Bloquea producción: No
```

```text
ID: PRV-19
Severidad: 🟡 IMPORTANTE
Área: Integración (defectos del 22-09 aún abiertos)
Título: Cinco defectos previos siguen abiertos
Archivo(s)/Línea(s):
 #8  prevention-emergency.ts:1034 (solo se cancela un simulacro `scheduled`; la reversión :1059-1064 es código muerto)
 #12 lib/services/pdtp/connectors.ts:167 y fulfillment-contract-2026.ts:233 → /prevencion/epp-preventivo, que ignora searchParams (page.tsx:25): "Iniciar" en la N°62 lleva a un callejón sin salida (las entregas viven en /entregas)
 #13 prevention-inspections/runs.ts:210,327-333: el servidor permite reescribir respuestas de una inspección `completed` sin recalcular (la UI lo impide)
 #15 pdtp-accreditation-connectors.ts:712,720: la N°7 acredita en el mes del cierre (M+1; diciembre cae en el programa siguiente); un mes con 0 horas no se puede cerrar
 #16 pdtp-accreditation-connectors.ts:673-674: plan de emergencia con cantidad = número de escenarios y texto sintético (el tope por celda limita el efecto)
Ruta/pantalla: emergencias, EPP, inspecciones, indicadores
Endpoint: —
Rol afectado: varios
Descripción/Evidencia: re-verificación del código actual (tabla completa en §8).
Resultado esperado: cerrarlos según la hoja de ruta del 22-09.
Impacto en producción: #13 permite alterar una inspección que ya acreditó; #15 imputa el indicador a un mes equivocado.
Solución recomendada: #13 bloquear en el servidor `completed` → solo reapertura trazada; #15 plannedPeriod = mes indicado; #8 permitir anular un simulacro completado con revocación; #12 apuntar a /entregas.
Esfuerzo estimado: Medio (conjunto)
Bloquea producción: No
```

```text
ID: PRV-20
Severidad: 🟡 IMPORTANTE
Área: UX / Proceso
Título: Gran parte del cumplimiento depende de una aprobación manual que la UI no pone en primer plano
Archivo(s): lib/services/pdtp/accreditation.ts:515-539; app/(app)/prevencion/pdtp/page.tsx
Línea(s): —
Ruta/pantalla: /prevencion/pdtp, /prevencion/pdtp/aprobaciones
Endpoint: —
Rol afectado: jefatura, Prevención
Descripción: las actividades 7, 9, 11, 15-18, 23, 35, 36, 43, 52, 62, 63, 66-80 y 83 nacen `submitted` y cuentan solo cuando alguien las aprueba (contradice la decisión D4). En bodega_dev hay 19 ejecuciones del v1 en `submitted` desde el 10-09 y ninguna aprobada. El tablero muestra "Ejecutadas 0", sin indicar que hay 19 esperando.
Evidencia: SQL + captura del tablero (1440 px).
Cómo reproducir: abrir /prevencion/pdtp en dev.
Resultado actual: el cumplimiento real está subrepresentado y nadie ve por qué.
Resultado esperado: un KPI o aviso "N por aprobar" que enlace a Aprobaciones (o la decisión de auto-aprobar con evidencia verificada, una vez corregido PRV-01).
Impacto en producción: indicadores más bajos que la realidad y una cola invisible.
Causa probable: se priorizó la revisión humana sin darle visibilidad.
Solución recomendada: mostrar el pendiente de aprobación en el tablero (dentro del tope A1: puede sustituir a "Acciones pendientes" o ir en la tira editorial).
Esfuerzo estimado: Bajo
Bloquea producción: No
```

```text
ID: PRV-21
Severidad: 🟡 IMPORTANTE
Área: Evidencia (higiene)
Título: Los informes de higiene no se pueden descargar, y el mismo PDF puede sostener la N°45 en varias faenas
Archivo(s): app/api/prevencion/higiene/evidence (solo POST); pdtp-evidence-thumbs.tsx:58-66; prevention-hygiene.ts:212-235
Línea(s): ver arriba
Ruta/pantalla: detalle de ejecución (chip sin enlace)
Endpoint: POST /api/prevencion/higiene/evidence (no hay GET)
Rol afectado: revisores y auditor
Descripción: la evidencia de la N°45 no se puede abrir desde la plataforma; se verifica el sha256, pero no el dueño ni la faena.
Evidencia: CÓDIGO (revisión de integración).
Resultado esperado: descarga con alcance y reutilización controlada.
Impacto en producción: evidencia que nadie puede revisar.
Solución recomendada: una ruta GET con la fuente única de referencias y el registro de dueño y faena.
Esfuerzo estimado: Medio
Bloquea producción: No
```

```text
ID: PRV-22
Severidad: 🟡 IMPORTANTE
Área: Integración / Despliegue
Título: La N°20 sigue como constancia donde no se corrió pdtp:apply-mechanisms, y las coordinaciones cerradas mientras tanto se pierden
Archivo(s): lib/services/pdtp-adapters/external-engagement-accreditation-connector.ts
Línea(s): 162-168 (return sin dejar un evento pendiente)
Ruta/pantalla: /prevencion/coordinacion y /prevencion/constancias
Endpoint: —
Rol afectado: prevencionistas
Descripción: en bodega_dev la N°20 tiene mechanism = constancia. El conector se abstiene y pide "Declárala en Constancias" (doble registro), y el hecho no queda para reprocesarse.
Evidencia: SQL + CÓDIGO (revisión de integración).
Resultado esperado: el hecho queda pendiente y se reprocesa cuando cambia el mecanismo; el paso apply-mechanisms queda en el checklist de despliegue.
Solución recomendada: registrar el evento como pending; verificar el mecanismo de la N°20 en cada ambiente.
Esfuerzo estimado: Bajo
Bloquea producción: No
```

### 7.4 Mejoras

| ID | Área | Hallazgo | Archivo:línea | Verificación | Solución | Esf. |
|---|---|---|---|---|---|---|
| M-01 | UX | El texto de la casilla dice que la actividad «saldrá del programa» sin mencionar que el NA debe aprobarlo otra persona | `components/prevention/program-slot-list.tsx:241` | Código | Decir «queda en revisión» | B |
| M-02 | Seguridad | Los POST multipart de `/api/prevencion/**` no comprueban `Origin` (dependen de SameSite=Lax); riesgo desde subdominios | `proxy.ts` | Teórico | Rechazar un `Origin` ajeno en no-GET a `/api` | B |
| M-03 | Seguridad | Un XML de la biblioteca documental se sirve `inline` (en dev la CSP permite inline) | `lib/file-validation.ts:51`, `documentacion/[id]/route.ts:85` | Teórico | `attachment` o `CSP: sandbox` en los archivos | B |
| M-04 | Seguridad | La IP de las auditorías sensibles se toma de `x-forwarded-for` sin validar | `salud/[id]/clinical/route.ts:23` y 2 más | Código | `resolveTrustedClientIp` | B |
| M-05 | Permisos | `program:manage` no aplica alcance de faena (hoy solo lo tienen roles globales) | `pdtp/actions/activities.ts` y otros | Teórico | Impedir otorgarlo a roles acotados | B |
| M-06 | Permisos | Las reducciones de meta y las reprogramaciones cambian el denominador sin segunda persona (sí quedan con motivo) | `overrides.ts:42-148`, `deviations.ts:232` | Código | El mismo flujo `pending_review` | M |
| M-07 | Datos | `CASCADE` desde la faena hacia los desvíos, las subidas y los overrides; `set null` de revisores | `pdtp.ts:966,760,1246,657` | Código+SQL | `RESTRICT` y solo baja lógica de faenas | B |
| M-08 | Trazabilidad | Iniciar o enviar una ocurrencia programada no se audita (solo sobrescribe JSON) | `scheduled-execution.ts:131,257-285` | Código | `recordModuleHistory` | B |
| M-09 | Datos | El NA de una ocurrencia exige 3 caracteres frente a 10 en el resto | `pdtp.ts:687-688` | Código | Unificar en 10 (migración nueva) | B |
| M-10 | Errores | `.catch(() => null)` convierte una caída de la base en «no encontrado» | `faenas/[worksiteId]/page.tsx:26`, `prevention-cphs-*.ts` | Código | Atrapar solo «no existe» | B |
| M-11 | Performance | N+1 en `runPdtpObligationReminders`; `listPendingPdtpExecutions` no pagina | `reminders.ts:283-296`, `executions.ts:736` | Código | Carga por lote y paginación | B |
| M-12 | Evidencia | Una ejecución aprobada cuyo archivo desapareció sigue «cumplida» (el escaneo solo alerta y solo mira `pdtp-evidence/`) | `evidence-integrity.ts:13-16,42` | Código | Marcar la celda «evidencia faltante» y extender el escaneo a todos los dominios | M |
| M-13 | Año siguiente | El contrato de destinos y el catálogo están atados a 2026 | `catalog.ts:46,55`, `fulfillment.ts:66-70`, `programs.ts:228-230` | Código | Parametrizar por año **antes del ciclo 2027 (Q4)** | M |
| M-14 | Flujo | Se puede enviar a revisión un programa con una actividad `scheduled` sin celdas | `lifecycle.ts:130-162` | Código | Agregarlo a `pdtpSubmitReviewBlockers` | B |
| M-15 | Indicadores | «A la fecha» incluye el mes en curso completo; la comparativa por faena usa el anual y el tile usa «a la fecha» | `compliance.ts:420-430`, `page.tsx:168` | Código | Cortar por semana y rotular o unificar | B |
| M-16 | Seguridad | `safeActionMessage` deja pasar errores de `fs` con rutas absolutas | `lib/action-error.ts:18-35` | Teórico | Filtrar `ENOENT/EACCES` y rutas | B |
| M-17 | Concurrencia | `updatePdtpActivity` valida el estado fuera de la transacción, sin lock ni versión optimista en textos | `activities.ts:487-494,633` | Código | Lock del programa más una versión esperada | B |
| M-18 | Trazabilidad | El change_log del programa muestra solo 20 entradas; `/admin/auditoria` no filtra por entidad | `executions.ts:803-810` | Código | Paginar y filtrar | B |
| M-19 | Trazabilidad | Borrar un programa en borrador, o crear o borrar una hoja, no se audita (la acción ni pasa el usuario) | `programs.ts:561-600`, `program-crud.ts:169`, `sheet-management.ts:19,43` | Código ✔ | `audit_log` con un resumen en la misma transacción | B |
| M-20 | Evidencia | La descarga del PDTP no distingue la confidencialidad del documento | `api/prevencion/pdtp/evidence/[name]/route.ts:36` | Código | Aplicar la clase de dato | M |
| M-21 | Evidencia | En CGRD, Campañas, Higiene y CAPA la extensión se toma del nombre del cliente (el MIME sí se valida) | `prevention-evidence-upload.ts:74` | Código | Extensión según el MIME | B |
| M-22 | Integración | Hay conectores declarados sin emisor (`training/session_closed`), código muerto (`onTrainingSessionClosed/Cancelled`) y 13 bindings a cursos eliminados | `connectors.ts:97`, `pdtp-accreditation-connectors.ts:234-274` | Código+SQL | Limpiar | B |
| M-23 | Integración | Un triage que agrava un incidente abre las obligaciones nuevas recién con el barrido horario | `incident-accreditation-connector.ts:275-282` | Código | Abrirlas en la misma transacción | B |

### 7.5 Cosméticos

| ID | Hallazgo | Archivo:línea |
|---|---|---|
| C-01 | `elaboratedByTitle` fijo en «Prevencionista» para cualquier usuario | `programs.ts:149-151` |
| C-02 | En el tablero, `percent === null` («sin planificación») se dibuja como 0 % | `prevencion/pdtp/page.tsx:161,171,184` |
| C-03 | La cola de Aprobaciones muestra ids internos como texto de evidencia («Entrega EPP: bYpyCTc20g…») | captura `/prevencion/pdtp/aprobaciones` |
| C-04 | Los rótulos sintéticos de integración se ven igual que una observación humana | `pdtp-evidence-thumbs.tsx:88-92` |
| C-05 | `new Date().getFullYear()` en daño material y ambiental (año UTC) | `indicadores-material-ambiental/page.tsx:24` |

## 8. Auditoría del flujo principal

```text
Programa → Actividad → Submódulo → Ejecución → Evidencia → Cumplimiento → Indicadores
   ✅         ✅          🟡           ✅(man)     ✅(man) / 🔴(int)   ✅            🟡
```

- **Programa y actividad:**
  - borrador → revisión → aprobación → activo, con firma de contenido;
  - revisión v+1 a mitad de año, con traspaso de desvíos y asignaciones;
  - retiro lógico de actividades;
  - responsables por catálogo más asignación nominal con vigencia.
- **Submódulo → ejecución:** los submódulos acreditan por conector (acreditación directa), por obligación o por evento disparador. La matriz por submódulo y su estado actual:

| Submódulo | Vía | Actividades | ¿Celda correcta? | ¿2.ª aprobación? | NA → PDTP |
|---|---|---|---|---|---|
| Inspecciones | Directa | 10, 24–27, 29, 33, 34, 39–41, 64, 65 | Fecha del run | No (automática) | Sin casilla |
| Capacitación | Directa (obligación en 16/57) | 16, 37, 38, 51, 53–60, 63, 85–89 | Sí | No (automática) | Sí, en revisión |
| Alcotest | Directa | 30/31, 32 | Sí con casilla | No con archivo (**PRV-01**) | Sí, en revisión |
| Simulacros | Directa | 84 | Sí | No con acta (**PRV-01**) | Sí; defecto #8 |
| Plan de emergencia | Directa | 83 | Fecha de aprobación | Sí (**PRV-02**) | — ; #16, PRV-04 |
| CGRD | Directa | 79, 80, 81 | 81 con casilla | 81 no (**PRV-01**) | Sí |
| CPHS | Directa | 9, 11 | Fecha | Sí (**PRV-02**) | — ; la N°9 corporativa no acredita |
| Higiene | Directa | 45–50 | 45 sí; 46–49 pagan 1 celda | 46–50 sí | 45 sí |
| Incidentes RE-20 | Obligación | 66–78 | Fecha del reporte | Sí | El triage cancela |
| Evaluación SST | Directa + obligación | 15, 17, 18, 23, 52, 63 | Fecha del cierre | Sí | — |
| Indicadores | Directa | 7 | **No** (#15) | Sí | — |
| MIPER / Documentación | Directa | 35 / 19, 36, 43 | Fecha / mes | Sí | — ; PRV-04 |
| Coordinación con mandante | Directa | 20 | Fecha | No con archivo (**PRV-01**) | PRV-22 |
| EPP (Bodega) | Directa | 62 | Fecha de entrega | Sí | #12 |
| Constancias | Manual | 3, 6, 20, 22, 28, 42, 44, 61, 82 | Celda elegida | Sí | Desvío |

- **Re-verificación de los 19 defectos del 22-09:**
  - **corregidos:** 1, 2, 5 (catálogo), 6, 7, 9, 11, 18;
  - **parciales:** 3, 4, 10, 14, 17, 19;
  - **abiertos:** 8, 12, 13, 15, 16.

  El defecto 10 (parcial): una sesión CGRD sin casilla todavía acredita y se auto-aprueba.
- **Evidencia:** en la vía manual es sólida. En la vía de integración falla PRV-01/02.
- **Cumplimiento e indicadores:** la regla es única (tope por actividad y mes; `max(manual, integración)`; solo `approved`). Diverge en los documentos (PRV-09).
- **Doble registro:**
  - el NA de una casilla se declara en el submódulo y otra persona lo aprueba en el PDTP (es revisión, no doble ingreso);
  - la N°20 como constancia (PRV-22);
  - las ~40 actividades que requieren aprobación manual (PRV-20).

## 9. Resultado de la prueba de realidad

Se usó un programa `QA_` de 2026 con activación el 05-01, una faena y dos usuarios: uno registra y otro aprueba. «Hoy» es el 28-09-2026 real. Todo pasó por los servicios de producción (`markPdtpExecution`, `approvePdtpExecution`, `recordPdtpDeviation`, `reviewPdtpNotApplicable`, `accreditPdtpFromEvent`, `getPdtpComplianceIndicators`, `getPdtpSheetViewByProgram`) contra PGlite con las 336 migraciones.

| # | Caso | Acciones | Resultado | ¿Correcto? |
|---|---|---|---|---|
| A01 | Fecha única (marzo) | Registrar con archivo → autoaprobar → aprobar (otro) → aprobar de nuevo | Autoaprobar rechazado; aprobado; doble aprobación rechazada. Estado sep.: «No programada este mes», 1/1 | ✅ |
| A02 | Mensual (12 meses) | Ene–ago registrados y aprobados; sep sin registrar | 8/12; «Pendiente» en septiembre, sin atraso | ✅ |
| A03 | Cuando corresponda (sin plan) | Registrar y aprobar un evento en mayo | Planificado 0, no infla el % | ✅ |
| A04 | Evidencia documental exigida | Sin evidencia → solo texto → con archivo | Rechazado («exige evidencia: Acta firmada en PDF»); rechazado; aprobado | ✅ |
| A05 | Cumplida desde otro submódulo | (sin hecho) → luego simulacro con `https://x` | Primero «Atrasada · 1 mes»; después **aprobada automáticamente sin archivo** | ✅ / 🔴 PRV-01 |
| A06 | No realizada | Motivo «no» → motivo válido | Rechazado (mínimo 10); `active`, sigue en el denominador (1 plan / 0) y sin atraso (explicada) | ✅ |
| A07 | No aplica | Declarar → autorrevisión → revisión por otro | `pending_review`; autorrevisión rechazada; `active`: plan de julio 0 | ✅ |
| A08 | Atrasada (agosto) | Nada → luego acta CGRD con archivo inexistente | «Atrasada · 1 mes»; después **aprobada con evidencia `provided` inexistente** | ✅ / 🔴 PRV-01 |
| A09 | Futura (noviembre) | NA futuro → ejecución futura → aprobar | NA rechazado; **ejecución aceptada y aprobada** | 🔴 PRV-03 |
| A10 | Múltiples ejecuciones (4 en feb, sem 1) | 2 aprobadas → +2 en la misma celda → 2 envíos concurrentes → +2 en la semana 2 | «ya fue aprobada»; concurrentes sin duplicar; semana 2 aceptada → 4/4. Con 2/4 no figuraba atrasada | 🟡 PRV-08, PRV-07 |
| INT-3 | Integración sin evidencia | CPHS acreditado → aprobado por el **mismo** usuario | **Aprobado**, `not_required` | 🔴 PRV-02 |
| — | Borrado de una actividad cumplida | `DELETE` directo | Rechazado por FK `RESTRICT` | ✅ |

**Cifras del indicador (antes de las demostraciones de integración)**

| | Planificado | Ejecutado | % |
|---|---:|---:|---:|
| Anual | 22 | 12 | 55 % |
| A la fecha (hasta septiembre) | 18 | 12 | 67 % |

- **Por mes:** 1/1, 5/3, 2/2, 2/2, 2/1, 2/1, 1/1, 2/1, 1/0, 1/0, 2/0, 1/0.
- **Verificación manual celda por celda:**
  - febrero = A02 (1/1) + A10 (4/2);
  - junio incluye la no realizada en el denominador;
  - el NA aprobado sacó julio del plan de A07;
  - la ejecución futura aún `submitted` no cuenta;
  - A03 no suma.
- **Tras la ejecución futura y el complemento en la semana 2:** anual 15/22 y a la fecha 14/18 (78 %).
- **Tras las tres demostraciones de integración, sin ningún archivo real ni segunda persona:** anual **18/22** y a la fecha **17/18 (94 %)**.

**Lectura:** el ciclo manual funciona como debe en 9 de 10 situaciones. La confianza se rompe en la frontera de fecha (futuro) y en la de integración.

## 10. Problemas de arquitectura y datos

**Modelo sólido:**
- CHECK por estado y motivo;
- índice único de desvío abierto por celda;
- id determinista más advisory lock por celda;
- `RESTRICT` en ejecuciones y cierres;
- ventanas por versión;
- cierre mensual y anual con foto y digest.

**Debilidades:**
- **La identidad de la fuente es texto sin FK.** Toda la consistencia fuente → cumplimiento depende de que cada conector llame a la revocación (PRV-04).
- **«Evidencia real» se define por la forma del texto** (PRV-01).
- **Lógica de corte duplicada** entre el indicador y los documentos (PRV-09).
- **Cascadas por faena** (M-07).
- **Bitácora mutable** (PRV-13).
- **Deuda de mantenimiento:** `compliance.ts` (1.709 líneas) y `fulfillment.ts` (1.648) concentran el cálculo legal.
- **Contrato 2026 fijo en el código** (M-13).
- **Sin TODO/FIXME reales, sin `any` y sin `console.log`** en el alcance.

**Trazabilidad por mutación:**
- con registro en la misma transacción: ejecución (envío, aprobación, rechazo), revocación, NA, no hecha, override, edición, retiro, responsable, ciclo de vida y cierres;
- sin registro: borrado de programa y hojas (M-19), inicio y envío de ocurrencias (M-08).

## 11. Seguridad y permisos

**Demostrado:**
- PRV-02: la segregación en integración, ejecutada.
- PRV-15: el canal público, con `curl`.

**Riesgo teórico:** PRV-18, M-02, M-03, M-04, M-05, M-16.

**Bien:**
- los permisos se recalculan por request desde la base;
- el alcance vacío significa sin acceso;
- las 279 acciones tienen guard;
- zod en las entradas;
- no hay SQL interpolado sin parámetros;
- tokens HMAC con expiración;
- los archivos sensibles se cifran y su acceso se audita;
- la importación de Excel protege contra zip-bombs y deja lo importado `submitted`;
- el test de paridad entre menú y página pasa.

**Faltó:** el recorrido en navegador con roles acotados (trabajador/jefatura/prevencionista). El usuario QA tiene todos los roles. Se recomienda crear usuarios `QA_` por rol para la validación final.

**Matriz de roles (resumen):**

| Rol | Puede |
|---|---|
| prevencionista y administrador | Administran el programa, aprueban y revisan el NA |
| jefa_chome | Aprueba, gestiona el ciclo de vida y firma legal |
| prevencionista_faena | Registra en sus faenas y cierra el mes |
| jefatura y supervisores | Registran solo lo propio o lo asignado y ven sus faenas |

No existe un rol «trabajador»: el trabajador actúa por los enlaces públicos (acuse, PPA y reporte de incidentes, este último roto por PRV-15).

## 12. Testing

**Inventario:**
- ~237 archivos de prueba unitarios o de integración relacionados con Prevención y PDTP;
- ~55 specs E2E de Prevención y PDTP;
- 29 suites `*-postgres`.

La última corrida completa, en la rama de integración (1f38cbd8), dio:
- `test:fast`: 10.324 PASS;
- `test:pglite`: 2.757 PASS;
- `test:e2e`: 759 PASS, 0 fallos.

**Ejecutado en esta auditoría sobre `7059c875`:**
- `typecheck` PASS y `lint` PASS;
- subconjuntos unitarios y PGlite en verde (núcleo 153, seguridad 107, integración 79);
- E2E del flujo PDTP (16 specs: flujo, evidencia y aprobación, NA, desvíos, atrasadas, transición anual, registro propio, móvil, cierres de mes y año, ciclo de vida, asignación nominal, inspecciones integral, ODI y capacitación, roles de inspecciones): **53 PASS, 0 fallos, 0 omitidas (6,8 min, build de producción en :3100 contra `bodega_e2e`)**.

**Brechas de cobertura:** ninguna prueba cubre los casos demostrados:
- integración con evidencia inexistente o URL (PRV-01);
- aprobación propia de una integración (PRV-02);
- ejecución futura (PRV-03);
- atraso parcial (PRV-07);
- complemento en la misma celda (PRV-08);
- equivalencia de corte entre el indicador y el RE-36 (PRV-09);
- horario nocturno de las ocurrencias (PRV-10).

Cada una debería nacer como prueba en rojo junto con su corrección.

## 13. UX/UI

- **Test de los 5 segundos: el tablero lo pasa.** Tiene 4 KPI accionables, tendencia, cumplimiento por faena y por eje, y estados vacíos con CTA.
- **Planilla:**
  - chips de estado con conteo (A5);
  - filtros primarios más «Más filtros»;
  - «Histórico completo / Exigible desde activación» con explicación.
- **Aprobaciones:** «No aplica por revisar» está separado.
- **A 390 px:** sin desborde; la planilla fija solo el N°.
- **Fricciones:**
  - «Ejecutadas 0» sin aviso de lo que espera aprobación (PRV-20);
  - mensajes que no guían (PRV-08);
  - ids internos en la cola de aprobación (C-03);
  - texto de NA que promete de más (M-01);
  - «Iniciar» de la N°62 sin salida (#12);
  - en la planilla, meses anteriores a la activación muestran «6 / -» con «No programada este mes». Es correcto por diseño y la pantalla lo explica, pero requiere lectura.

**No se evaluó:** navegación solo con teclado en profundidad, lector de pantalla y WebKit.

## 14. Performance y operación

**Performance:**
- el tablero ya se optimizó: 10 faenas × 80 actividades en 1.553 → 75 consultas y 413 → 159 ms (T7b);
- existen índices en las consultas calientes;
- mejoras menores en M-11.

**Operación:**
- respaldo cifrado de base y storage con ensayo semanal;
- escaneo diario de integridad;
- `cron_runs` con alerta de fallo;
- `/api/health`;
- **faltan** la alerta de staleness, la captura de errores y la reconciliación diaria (PRV-14).

**Pregunta del §20:** si mañana desaparecen evidencias de 40 actividades:
- **se detecta** a más tardar a las 05:15 del día siguiente, con la lista de rutas y sus dueños;
- **se sabe qué pasó** si fue el GC (auditado); no, si ocurrió fuera de la aplicación;
- **se recupera** del `storage.tar.gz` nocturno (30 días, verificable por sha256), con dos límites: un RPO de 24 h y que no existe un procedimiento documentado de restauración selectiva;
- **condición:** todo lo anterior depende de que el scheduler de respaldos esté activo, cosa que hoy nadie vigila (PRV-14).

## 15. Obligatorio antes de producción

- [ ] **PRV-01**
  - [ ] verificar la existencia, el dominio, el dueño y la faena del archivo antes de auto-aprobar;
  - [ ] una URL o un texto libre deja la ejecución `submitted`;
  - [ ] corregir las ejecuciones ya auto-aprobadas con evidencia inexistente (reporte y re-revisión).
- [ ] **PRV-02**
  - [ ] guardar el actor de origen en las ejecuciones de integración y compararlo al aprobar;
  - [ ] exigir motivo o evidencia para aprobar una integración sin artefacto.
- [ ] **PRV-03:** rechazar ejecuciones y aprobaciones en celdas futuras.
- [ ] Pruebas de regresión en rojo → verde para los tres puntos anteriores.
- [ ] Verificar en el ambiente de destino:
  - [ ] el mecanismo de la N°20 (`pdtp:apply-mechanisms`);
  - [ ] que `backup-scheduler` está activo;
  - [ ] que `PDTP_EVIDENCE_GC_DELETE` sigue vacío (PRV-17).
- [ ] Validación en navegador con usuarios `QA_` por rol (prevencionista de faena, supervisor, jefa_chome) del registro, la aprobación y el NA.

## 16. Recomendable inmediatamente después

- [ ] PRV-04: revocaciones faltantes.
- [ ] PRV-05: cancelación de obligaciones con revisión y guardas de cierre.
- [ ] PRV-06: limpieza de ocurrencias obsoletas.
- [ ] PRV-07: atraso parcial.
- [ ] PRV-09: un solo corte para el indicador y los documentos.
- [ ] PRV-10: UTC → Chile.
- [ ] PRV-13: bitácora append-only.
- [ ] PRV-14: alerta de staleness, reconciliación diaria y captura de errores.
- [ ] PRV-15: canal público de incidentes.
- [ ] PRV-16: NA rechazado visible.
- [ ] PRV-18: descarga por igualdad exacta.
- [ ] PRV-19: #13 y #15.
- [ ] PRV-20: aviso de «por aprobar» en el tablero.
- [ ] PRV-22: evento pendiente para la N°20.

## 17. Mejoras futuras (no bloquean)

- PRV-08: complemento en la misma celda.
- PRV-11: padrón con vigencia.
- PRV-12: anulación de una aprobación manual.
- PRV-21: descarga de los informes de higiene.
- PRV-19: #8, #12 y #16.
- M-01…M-23; conviene priorizar **M-13 antes del programa 2027** y M-12.
- C-01…C-05.

**Fuera de alcance** (convertirían el módulo en un ERP preventivo):
- flujos de aprobación multinivel configurables por actividad;
- firma electrónica avanzada de cada evidencia;
- versionado documental propio de las evidencias;
- BI adicional sobre el tablero;
- app móvil nativa.

## 18. Roadmap hacia producción

```text
FASE 1 — Bloqueadores/condición mínima : PRV-01, PRV-02, PRV-03 (+ saneamiento de datos auto-aprobados) y sus pruebas
FASE 2 — Integridad funcional          : PRV-04, PRV-05, PRV-06, PRV-07, PRV-09, PRV-10, PRV-16, PRV-19 (#13, #15), PRV-22
FASE 3 — Seguridad y permisos          : PRV-13, PRV-15, PRV-18, M-02, M-03, M-05, M-06
FASE 4 — UX y manejo de errores        : PRV-20, PRV-08, M-01, M-10, C-03, #12
FASE 5 — Testing y estabilización      : regresiones de cada fase; dorado cruzado indicador↔RE-36; test:fast/pglite/e2e completos; PRV-14 (staleness, captura de errores)
FASE 6 — Validación final              : recorrido por rol con usuarios QA_ a 1440/390; ensayo de restauración selectiva de evidencia; revisión del mecanismo N°20 y GC en el ambiente destino
```

## 19. Veredicto técnico

```text
Production Readiness: 68/100

Estado:
No listo para producción (60–69) — cercano: la condición mínima es acotada

Bloqueadores: 0
Críticos: 2
Importantes: 20
Mejoras: 23
Cosméticos: 5

Principal riesgo actual:
La evidencia que llega desde los submódulos no se verifica: una ruta inexistente o una URL
cualquiera auto-aprueba el cumplimiento con estado "evidencia entregada", y las ejecuciones
de integración pueden aprobarse por quien originó el hecho y sin evidencia (demostrado:
78 % → 94 % a la fecha sin un archivo ni una segunda persona).

Principal fortaleza actual:
Un núcleo manual riguroso y verificado: cuatro estados bien diferenciados, evidencia real
obligatoria con sha256 y dueño, segregación y "no aplica" con revisión reforzados por CHECK
en la base, cálculo correcto al dígito, cierres que congelan y trazabilidad transaccional.

Condición mínima para producción:
Corregir PRV-01, PRV-02 y PRV-03 con sus pruebas de regresión, sanear las ejecuciones
ya auto-aprobadas sin evidencia verificable, confirmar respaldo activo / GC en modo prueba /
mecanismo N°20 en el ambiente destino, y validar el flujo en navegador con usuarios por rol.

Áreas que NO necesitan seguir creciendo antes del lanzamiento:
Nuevos submódulos o conectores, más KPIs o vistas del tablero, más tipos de periodicidad,
flujos de aprobación configurables, exportaciones adicionales, rediseño visual. El producto
ya tiene más superficie de la que necesita; lo que falta es cerrar la confianza en la
evidencia, no agregar capacidades.
```
