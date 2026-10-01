# Auditoría de production readiness — agente **riesgos** (prefijo RSK-)

**Fecha:** 2026-09-29 · **Build:** HEAD `11e67621` (mismo build en :3100 y :3101) · **Alcance:** Matriz IPER (MIPER), Requisitos legales, Gestión de riesgos de desastres (CGRD + mapa de riesgos).
**Entornos:** A (`:3100`, `bodega_audit_e2e`) para accesos por rol y estados vacíos; B (`:3101`, `bodega_audit_real_e2e`, programa 2026 v2 real, activado el 17-09-2026) para todos los flujos de punta a punta e integración con el PDTP.
**Evidencia en disco:** `scratchpad/audit/riesgos/` (scripts `01…12*.mjs`, salidas `*.json`/`*.out`, capturas `shots/`, prueba temporal copiada `riesgos-zipbomb.audit-tmp.test.ts` y su resultado `zipbomb-result.json`).

> Es un diagnóstico. No se tocó código versionado. La prueba temporal `lib/__tests__/riesgos-zipbomb.audit-tmp.test.ts` se copió a mi carpeta y se **borró del repo**.

## Resumen

| Submódulo | Nota | Lectura |
|---|---:|---|
| Matriz IPER (MIPER) | **66/100** | No listo: el flujo segregado funciona, pero quien revisa y aprueba no puede ver la matriz completa (RSK-02). |
| Requisitos legales | **73/100** | Funcional, requiere correcciones: la evidencia de cumplimiento es texto libre y publicar exige al administrador (RSK-09, RSK-10). |
| CGRD + mapa | **62/100** | No listo: la N°81 se auto-aprueba y admite el mismo documento para varias sesiones (RSK-01). |

Conteo: 🔴 0 · 🟠 2 · 🟡 13 · 🔵 12 · ⚪ 4.

Datos QA creados en B (todos con `QA_RSK`): MIPER v1 (reemplazada), v2 (vigente) y v3 (borrador importado) en Horcones; lote de importación `QA_RSK_import.xlsx`; requisito `QA_RSK_LEG-01` publicado con aplicabilidad aprobada en Horcones; comité CGRD `QA_RSK Comité GRD Horcones` (luego disuelto), matriz GRD v1 publicada, 4 actas (3 anuladas), coordinador en Biodiversa (terminado); plano `QA_RSK Plano Horcones`; dos vínculos de cobertura (N°35 ← control MIPER v2, N°19 ← QA_RSK_LEG-01). Ejecuciones PDTP resultantes: N°35 ×2, N°79 ×2 (revocadas), N°80 ×1, N°81 ×4 (3 revocadas). No se tocaron registros de otros agentes (`QA_INT_grdH/grdB` ya estaban disueltos).

---

## AUDITORÍA — Matriz IPER (MIPER)

**Rutas:** `/prevencion/miper` (pestañas Versiones / Revisiones / Importaciones), `/prevencion/miper/controles/[id]`; APIs `GET /api/prevencion/miper/[id]/export`, `GET /api/prevencion/miper/importaciones/[id]/original`.
**Archivos:** `app/(app)/prevencion/miper/{page.tsx,miper-workbench.tsx,actions.ts}`, `lib/services/prevention-risk-legal.ts` (líneas 143–809, 1357–1417, 1627–1672), `lib/services/prevention-risk-import.ts`, `lib/validation/prevention-module/risk-legal.ts`, `lib/reports/miper-workbook.ts`, `lib/services/xlsx-security.ts`.
**Permisos (manifiesto):** `risk:view|edit|review|approve|publish` para prevencionista; `view|edit` para prevencionista_faena; `review|approve|publish` para jefa_chome; `view` para cphs y jefe_terreno; `sign_own_work` sólo prevencionista (y administrador). Segregación en el servicio: creador ≠ revisor (`prevention-risk-legal.ts:507`), creador/revisor ≠ aprobador (`:508`), aprobador ≠ publicador salvo `sign_own_work` (`:516-524`).

### A. UI/UX/Diseño
- Cumple el andamiaje: `PageHeader` con acciones en el header ("Nueva versión", "Importar Excel"), `PageContainer`, 4 KPI enlazados, pestañas, `EmptyState`, `DatePicker`, estados con `MetaBadge` en español. 0 `h1` duplicados, 0 desborde horizontal en 1440/1024/768/390, 0 errores de consola y 0 respuestas ≥400 en todos los roles (`01-access-{A,B}.json`, `10-responsive.json`).
- **La "matriz" no es una matriz:** cada versión se pinta como tarjetas con peligro, ruta proceso→tarea→puesto, nivel residual y controles; no se ven nivel inherente, factor, daño, expuestos, género ni sensibilidad, y sólo se muestran los **8 primeros peligros** (`miper-workbench.tsx:191`, `entries.slice(0, 8)`) sin "ver todos" (RSK-02).
- La búsqueda del TopBar aparece pero no filtra nada (3 versiones antes y después de escribir `zzzz-no-existe`); no hay filtro por faena ni estado aunque la lista mezcla todas las faenas (RSK-08).
- Pestaña Revisiones muestra jerga: "Origen risk_matrix · riskmatrix-…" (`miper-workbench.tsx:195`) (RSK-30). Panel "Actividades programadas" dice "pendiente en miper y requisitos legales" (RSK-30). Menú "Matriz IPER", título "MIPER y controles", miga "MIPER" (RSK-30).
- A 390 px la tarjeta del lote importado corta el SHA-256 (RSK-31). Diálogos "Agregar peligro" y "Nueva versión" caben a 390 px (358 px de ancho, con scroll interno).
- **Estados observados:** Sin información (B inicial: "No existe una MIPER vigente…", EmptyState), Con información, Operación exitosa (el diálogo se cierra y la lista se refresca; sin toast), Operación fallida (mensajes de dominio en el diálogo, p. ej. "Quien creó el requisito…"), Error 404 de control inexistente, Permisos insuficientes (`sup`, `legal`, `ti` → `/forbidden`). No capturé "Cargando" (hay `loading.tsx`).

### Facilidad de uso
- **Publicar una MIPER nueva** (2 peligros, 3 personas distintas): crear borrador 4 clics + 5 campos; agregar peligro 2–3 clics + 17 campos por peligro; enviar a revisión 2 clics + motivo; revisar (otra persona) 2 + motivo; aprobar (tercera persona) 2 + motivo; publicar 2 + motivo. **≈15 clics, ~45 campos, 4 sesiones, 3 personas** (`02-miper-QA_RSK_M1.json`). La versión nueva copia la vigente por defecto ("Revisar la vigente · v1"), bien resuelto.
- Fricciones: no se puede corregir ni quitar un peligro de un borrador (sólo agregar) ni descartar el borrador (RSK-05); el lote importado se corrige editando JSON crudo y un JSON inválido se ignora en silencio (RSK-06); a la jefa, tras aprobar, se le ofrece "Publicar" que el servidor rechaza (RSK-16).

### B. Funcionalidad
| Función | Estado | Evidencia |
|---|---|---|
| Crear versión (nueva o copiando la vigente) | ✅ | B: v1 nueva, v2 copia de v1 con `supersedes_matrix_id` (SQL) |
| Agregar peligro con control crítico | ✅ | B: H-1 crítico con estándar y frecuencia |
| Editar / quitar peligro en borrador | ❌ | No existe acción ni servicio (sólo `addRiskEntry`) — RSK-05 |
| Enviar a revisión / devolver a borrador | ✅ | B; bloqueo de matriz sin peligros en `:504-506` |
| Revisar / aprobar / publicar segregados | ✅ | B: creador sin botón "Aprobar"; jefa rechazada al publicar lo que aprobó (código `:522`); prev publicó |
| Publicación inmutable (hash) y reemplazo | ✅ | B: v1 `superseded`, v2 `published`, SHA distinto |
| Consultar la matriz completa | 🔴 | ≤8 peligros en pantalla; export sólo publicada/reemplazada — RSK-02 |
| Exportar Excel (publicada) | ✅ | 200 con `attachment` y `nosniff`; otra faena 404; `ti`/`sup` 403 (`07-http.json`) |
| Importar Excel → lote → resolver → aprobar (otra persona) → borrador | 🟡 | B funciona; resolución por JSON crudo y fallo silencioso — RSK-06 |
| Controles críticos y su verificación segregada | 🟡 no verificado en navegador | Código `:639-772` y pruebas PGlite/postgres en verde |
| Disparadores de revisión (anual, control ineficaz) | 🟡 | Se crean; los de la versión reemplazada quedan vivos — RSK-03 |
| Bloqueos críticos / KPI de cobertura | 🟡 | Funcionan, pero un borrador infla el denominador (1/1 → 1/2) — RSK-05 |

### C. Código y lógica
- Reglas de negocio en el servicio y en transacción con control optimista (`version`), no en la UI. Errores de dominio (`RiskLegalDomainError`) separados de los inesperados (`actions.ts:108-111`).
- `miper-workbench.tsx`: JSX en líneas únicas de 1–3 KB, difícil de mantener; `catch { return }` que traga el error de JSON (`:280`, RSK-06).
- `getRiskDashboard` (`prevention-risk-legal.ts:1357-1417`) trae todas las matrices, entradas y controles de todas las faenas visibles sin paginar, y el mapa de riesgos lo reutiliza completo (`cgrd/mapa/risk-map-data.ts:22`) (RSK-18).
- El export usa `sanitizeCell` (`excel-builder.ts:135-140`); una fila importada con `=HYPERLINK(...)` quedó como texto "=cmd|calc peligro" (sin fórmula) y se exporta con apóstrofo. Sin riesgo de inyección demostrado.
- Export con IDs de usuario y enums crudos (`miper-workbook.ts:61,64`) (RSK-17).

### D. Modelo de datos
- Versionado por fila (`prevention_risk_matrices` con `matrix_version`, `supersedes_matrix_id`, `published_hash_sha256`), entradas y controles copiados en cada versión; índice único de identidad del peligro. Sin borrado físico de versiones.
- Procesos/tareas/puestos se crean al agregar peligros **a un borrador** y cuentan como "activos" en la cobertura aunque nunca se publiquen (RSK-05).
- Obligación de 30 días (`prevention_pdtp_update_obligations`) y disparador anual por versión; al reemplazar no se cierran (RSK-03).

### E. Permisos y seguridad
- Página y APIs: `sup`, `legal`, `ti` → `/forbidden`/403; `otrafaena` no ve Horcones y recibe 404 al exportar su matriz (`07-http.json`). Segregación comprobada en navegador (ver B).
- Descarga del original importado con alcance de faena (código `prevention-risk-import.ts:618-625`, prueba de ruta en verde).
- **Importación Excel:** `.xls`, cifrados, rutas internas raras y MIME ajeno se rechazan; celdas enormes (40.000 caracteres) quedan observadas por contrato; fórmulas se leen como su resultado. **Pero el tope de expansión se evade** con un ZIP que declara tamaños falsos: 185 KB que declaran 2 KB pasan `validateXlsxEnvelope` y ExcelJS infla 180 MB (pico +129 MB) antes de fallar (RSK-07, validador compartido con PDTP).
- POST multipart con `Origin` ajeno → 403 "Origen no permitido" (M-02, verificado sobre `/api/prevencion/cgrd/evidence`).

### F. Testing
- Ejecuté (verde): `prevention-risk-legal.test.ts`, `miper-ui-contract.test.ts`, `prevention-risk-import.test.ts`, `miper/actions.test.ts`, rutas `miper/[id]/export` e `importaciones/[id]/original` (parte de 13 archivos / 65 pruebas, `tests-unit.out`); PGlite `prevention-risk-control-ineffective-capa.test.ts` (parte de 3 archivos / 43 pruebas, `tests-pglite.out`); **postgres `prevention-risk-legal-postgres.test.ts`: 21/21 PASS** contra `bodega_test_rsk_risk_legal` (`pg-risk.out`, no skipped).
- E2E `prevencion-miper-matriz.spec.ts` sólo comprueba que la página carga (leído, no corrido). Sin E2E del flujo crear→revisar→aprobar→publicar, de la importación ni de la verificación de controles (RSK-26).

### G. Integración con Programa Anual (ejecutado en B)
- **N°35 (acreditación directa):** al publicar v1 se creó `pdtp-accredit-iGH9…` en Horcones, septiembre semana 4, `submitted`, `origin=integration`, `executed_by=qa-prev` (quien publicó), `evidence_status=not_required`, `evidence_text="MIPER v1 publicada: riskmatrix-…"` (sin enlace ni archivo).
- **PRV-02:** `prev` (publicador) intentó aprobar desde `/prevencion/pdtp/aprobaciones` → "Quien registró el cumplimiento no puede aprobarlo. Debe hacerlo otra persona." `prev2` aprobó con el diálogo "Aprobar sin evidencia verificada" y su motivo quedó en `source_metadata_json.approvalReason` (`approve-*.json`). **Corregido (verificado).**
- **Reemplazo (PRV-04):** al publicar v2, v1 pasa a `superseded`; su N°35 **sigue `approved`** y v2 crea **otra** ejecución en la misma celda (sep. sem. 4, `submitted`). No revocar es coherente con la decisión declarada (v1 respaldó el período en que rigió), pero deja una segunda ejecución redundante en la cola de aprobación (RSK-24) y dos pendientes vivos de v1: el disparador "Revisión anual de MIPER v1" y la obligación de 30 días, que **no puede cerrarse** porque sólo se vinculan controles de la matriz publicada ("No se puede cerrar el reloj…", `12-coverage.json`) (RSK-03).
- **Desajuste de programación:** en el programa real la N°35 está planificada **mensualmente** (12 celdas, semana 3). La publicación acredita una sola celda; las otras 11 sólo se cumplen con registros manuales o publicando una MIPER por mes (RSK-04).
- Obligación de 30 días de v2: se cerró desde `/prevencion/pdtp/cobertura` tras vincular un control de v2 a la N°35 (DEMOSTRADO).

### H. Hallazgos
Ver sección común "Hallazgos" (RSK-02, RSK-03, RSK-04, RSK-05, RSK-06, RSK-07, RSK-08 y menores RSK-16, RSK-17, RSK-18, RSK-24, RSK-26, RSK-30, RSK-31).

### I. Readiness individual: **66/100**
| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 16 | RSK-02 −4, RSK-05 −3, RSK-03 −2 |
| UI/UX y facilidad de uso | 20 | 11 | RSK-02 −3, RSK-06 −2, RSK-08 −2, RSK-16 −1, RSK-30/31 −1 |
| Integridad de datos | 15 | 12 | RSK-03 −2, RSK-05 −1 |
| Integración con Programa Anual | 15 | 10 | RSK-04 −4, RSK-24 −1 |
| Código y mantenibilidad | 10 | 7 | RSK-17 −1, RSK-18 −1, RSK-06 (`catch{return}`, JSX de una línea) −1 |
| Permisos y seguridad | 5 | 3 | RSK-07 −2 |
| Testing | 5 | 3 | RSK-26 −2 |
| Manejo de errores | 5 | 4 | RSK-06 −1 |

### Estado de hallazgos previos en este alcance
| Previo | Dictamen | Evidencia |
|---|---|---|
| PRV-02 (MIPER, N°35) | **Corregido (verificado)** | Publicador rechazado; otra persona aprueba con motivo obligatorio |
| PRV-04 (MIPER reemplazada) | **Sigue abierto por decisión**; coherencia parcial | v1 sigue aprobada (coherente), pero quedan pendientes imposibles de cerrar (RSK-03) y doble ejecución (RSK-24) |
| MIPER-01…11 (correcciones anteriores citadas en el código) | Corregidos en lo recorrido | Niveles canónicos, copia de la vigente, devolución a borrador, reapertura de lote, CAS de aprobación: todos observados |

### Qué no se pudo verificar y por qué
- Verificación de un control en `/prevencion/miper/controles/[id]` y la CAPA automática por control crítico ineficaz: sólo código y pruebas PGlite/postgres (límite de tiempo).
- Resolución de un disparador de revisión en la UI; archivado del Excel publicado en Cloudreve (no hay Cloudreve en B).
- Contenido del Excel exportado (se verificaron cabeceras y alcance, no las celdas).
- Comportamiento con una MIPER real de decenas de peligros (no hay datos así en A ni B).

---

## AUDITORÍA — Requisitos legales

**Rutas:** `/prevencion/requisitos-legales` (pestañas Registro legal / Aplicabilidad / Brechas), `/prevencion/requisitos-legales/[id]`; API `GET /api/prevencion/requisitos-legales/export`.
**Archivos:** `app/(app)/prevencion/requisitos-legales/{page.tsx,legal-requirements-workbench.tsx,actions.ts,[id]/page.tsx,[id]/layout.tsx}`, `lib/services/prevention-risk-legal.ts:811-1220, 1419-1472, 1674-1685`, `lib/validation/prevention-module/risk-legal.ts:127-193`.
**Permisos:** `legal:view|assess|export` prevencionista; `view|assess` prevencionista_faena y admin_contrato; `view|assess|approve_applicability|export` jefa_chome; `view` cphs; todo el administrador. `approve_applicability` cubre aprobar y publicar requisitos y aprobar aplicabilidad.

### A. UI/UX/Diseño
- `PageHeader` con "Exportar Excel" y "Nuevo requisito", 4 KPI enlazados, pestañas con contadores, `EmptyState` en cada pestaña, `DatePicker`, estados en español. 0 errores de consola/red, 0 desborde en los 4 anchos.
- La búsqueda del TopBar no filtra (1 → 1 requisito) y no hay filtro por faena en Aplicabilidad (con 16 faenas × N requisitos la lista crece sin control) (RSK-08).
- El código de **cada** requisito enlaza a su ficha, pero la ficha sólo existe para publicados/reemplazados: un borrador abre "Error 404 · No encontramos este registro" con HTTP 200 (RSK-11). La ficha no muestra las evaluaciones ni los vínculos al PDTP aunque el servicio los carga (RSK-11).
- **Estados observados:** Sin información (B inicial), Con información, Operación exitosa (diálogo se cierra), Operación fallida ("Quien creó el requisito no puede revisarlo."; "Quien aprobó el requisito legal no puede publicarlo…"), 404 blando, Permisos insuficientes (`jt`, `sup`, `legal`, `ti` → `/forbidden`; export 403 para prevfaena/otrafaena/cphs).

### Facilidad de uso
- Crear requisito: 2 clics + 12 campos. Ciclo completo: enviar (prev) → revisar (prev2) → aprobar (jefa) → publicar (**admin**, única persona restante con el permiso) — 4 sesiones, 8 clics. Aplicabilidad: 2 clics + 3 campos (prevfaena) → aprobar 2 clics (jefa). Evaluar cumplimiento: 2 clics + 1 campo (`08-legal-*.json`).
- Fricciones: al creador se le ofrece "Revisar" y a la aprobadora "Publicar", ambos rechazados por el servidor (RSK-16); un requisito en revisión con un error no puede devolverse ni editarse (RSK-05).

### B. Funcionalidad
| Función | Estado | Evidencia |
|---|---|---|
| Crear requisito (borrador) | ✅ | B `QA_RSK_LEG-01` |
| Editar / devolver / descartar borrador | ❌ | Sin servicio; `LEGAL_TRANSITIONS` no tiene retorno (`prevention-risk-legal.ts:924`) — RSK-05 |
| Revisión / aprobación / publicación segregadas | ✅ | Creador rechazado al revisar; aprobadora rechazada al publicar; admin publicó |
| Supersesión automática al publicar versión nueva | ✅ código + postgres | `:966-1026`, suite postgres |
| Aplicabilidad propuesta → aprobada por otra persona | ✅ | prevfaena propone, jefa aprueba; crea obligación PDTP de 30 días |
| Evaluación de cumplimiento con evidencia | 🟡 | "Cumple" con evidencia `"abc"` → KPI 1/1 — RSK-09 |
| Brecha → CAPA en la misma transacción | ✅ código + pruebas | `:1185-1202`; no recorrido en navegador |
| Ficha del requisito | 🟡 | 404 para no publicados, sin historial — RSK-11 |
| Exportar Excel | ✅ | 200 para prev/jefa/admin; 403 sin permiso |

### C. Código y lógica
- Vigencia centralizada en una sola regla en dos formas (`isLegalRequirementInForce` y `legalRequirementInForceCondition`, `:835-857`); re-evaluar lo aprobado exige motivo (`:1067-1075`); CAPA abierta impide declarar "Cumple" (`:1172-1183`). Buena calidad.
- `assessLegalCompliance` sobrescribe `assessedByUserId` de la aplicabilidad (`:1215`), así que la fila pierde a quien la propuso (queda en la bitácora) (RSK-25).
- Export con IDs de usuario, `sourceType` y `processId` crudos (`requisitos-legales/export/route.ts:30,33`) (RSK-17).

### D. Modelo de datos
- Requisito global versionado por `code` + `requirement_version`, índice parcial de un publicado por código; aplicabilidad por faena/proceso con índice único; evaluaciones append-only. Sin borrado físico.
- La evidencia es un campo de texto (`evidence_reference`), no un archivo ni un vínculo verificable (RSK-09).

### E. Permisos y seguridad
- Alcance por faena en aplicabilidad y evaluación (`requireAccess(..., worksiteId)`); `otrafaena` no ve la aplicabilidad de Horcones. Export sólo con `legal:export`.
- `legal:assess` sin faena permite a un prevencionista_faena crear borradores del **registro global** (`:883-884`), que luego revisa otra persona (RSK-10).

### F. Testing
- Verde: `requisitos-legales/actions.test.ts`, `requisitos-legales/export/route.test.ts`, `prevention-risk-legal.test.ts`; postgres `prevention-risk-legal-postgres.test.ts` 21/21 (incluye bloque legal).
- E2E `prevencion-cumplimiento-legal.spec.ts` sólo verifica que la página carga. Sin E2E del ciclo del requisito ni de aplicabilidad/cumplimiento (RSK-26).

### G. Integración con Programa Anual (ejecutado en B)
- **No acredita ninguna actividad** (coincide con el mapa: relación indirecta). Al aprobar la aplicabilidad de `QA_RSK_LEG-01` en Horcones nació la obligación "Requisito QA_RSK_LEG-01 v1", vence 29-10-2026. Desde `/prevencion/pdtp/cobertura` vinculé el requisito a la N°19 y la obligación se cerró (DEMOSTRADO, `12-coverage.json`).
- La relación con la N°19 (carpeta legal en Documentación) es sólo de cobertura: la evaluación "Cumple" y su evidencia no llegan a la carpeta ni a ninguna ejecución. Es lo que el mapa declara; lo débil es que la evidencia sea texto libre (RSK-09).

### H. Hallazgos
Ver sección común (RSK-05, RSK-08, RSK-09, RSK-10, RSK-11; menores RSK-16, RSK-17, RSK-25, RSK-26).

### I. Readiness individual: **73/100**
| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 17 | RSK-11 −3, RSK-05 −3, RSK-10 −2 |
| UI/UX y facilidad de uso | 20 | 14 | RSK-08 −2, RSK-11 −3, RSK-16 −1 |
| Integridad de datos | 15 | 10 | RSK-09 −4, RSK-25 −1 |
| Integración con Programa Anual | 15 | 12 | RSK-09 −3 (la evidencia no es reutilizable como respaldo de la N°19) |
| Código y mantenibilidad | 10 | 8 | RSK-17 −1, JSX de una línea −1 |
| Permisos y seguridad | 5 | 4 | RSK-10 −1 |
| Testing | 5 | 3 | RSK-26 −2 |
| Manejo de errores | 5 | 5 | — |

### Estado de hallazgos previos en este alcance
No hay PRV-/M- específicos del registro legal en la auditoría anterior. Correcciones LEGAL-01…06 y D4/D5 citadas en el código: observadas en funcionamiento (vigencia, publicación segregada, re-evaluación con motivo).

### Qué no se pudo verificar y por qué
- Evaluación "No cumple" con CAPA en navegador; supersesión v1→v2 en navegador (cubierta por la suite postgres); contenido de la planilla exportada.

---

## AUDITORÍA — Gestión de riesgos de desastres (CGRD) y mapa de riesgos

**Rutas:** `/prevencion/cgrd?faena=`, `/prevencion/cgrd/mapa?mapWorksite=`; APIs `POST /api/prevencion/cgrd/evidence`, `GET /api/prevencion/cgrd/evidence/[name]`, `POST /api/prevencion/cgrd/mapa`, `GET /api/prevencion/cgrd/mapa/[name]`.
**Archivos:** `app/(app)/prevencion/cgrd/{page.tsx,cgrd-workbench.tsx,actions.ts}`, `app/(app)/prevencion/cgrd/mapa/*`, `lib/services/prevention-cgrd.ts`, `lib/services/prevention-cgrd-access.ts`, `lib/services/prevention-risk-map.ts`, `lib/services/prevention-evidence-upload.ts`, `lib/services/pdtp/integration-evidence.ts`, `lib/validation/prevention-module/cgrd.ts`, conectores `pdtp-accreditation-connectors.ts:759-878`.
**Permisos:** `cgrd:view|committee:manage|meeting:manage|matrix:edit` para prevencionista_faena; además `matrix:publish` para prevencionista; jefa_chome `view|committee|meeting|publish`; `view` cphs y jefe_terreno. El mapa usa `risk:view|edit`. En B existen además `cgrd:matrix:review|approve` heredados de `bodega_dev`, ausentes del manifiesto y del código (RSK-22).

### A. UI/UX/Diseño
- `PageHeader` sin acciones de página; selector de faena como filtro estructurado; secciones en tarjetas; `ConfirmDialog` con motivo para disolver, terminar designación, quitar integrante y anular acta; `EvidenceField` que sube el archivo al elegirlo. 0 errores de consola/red, 0 desborde en 1440/1024/768/390.
- **Jerarquía:** en una faena sin órgano, lo primero que hay que hacer (designar coordinador / constituir comité) queda al final, debajo de las casillas y de la matriz; las casillas no tienen un botón "Registrar acta", sólo "No hecha"/"No aplica" (RSK-23).
- **Trazabilidad visual:** un acta registrada sólo muestra código y fecha; no se puede abrir su tabla, acta, quórum ni el archivo; tampoco la evidencia del comité o de la matriz. Al disolver el comité desaparecen de la pantalla sus integrantes, actas y acuerdos, y la casilla "Acta registrada" queda sin acta consultable. Sólo se ve la última versión de la matriz GRD (RSK-14).
- Fechas crudas "designado el 2026-09-21", "Constituido 2026-09-20 · mandato hasta …" y plazos CAPA en ISO (`cgrd-workbench.tsx:242,286,386`) (RSK-28). Casillas fuera de orden (febrero, marzo, **mayo, abril**) (RSK-29). Checkbox nativo "Hubo quórum".
- Mapa: estado vacío con CTA correcto, "Cargar plano" en el header; el parámetro de faena es `?mapWorksite=` y no `?faena=` como en CGRD, y la miga a CGRD no conserva la faena (RSK-18).
- **Estados observados:** Sin información (sin coordinador, sin matriz, sin plano), Con información, Operación exitosa, Operación fallida (mensaje genérico en RSK-15; mensajes de dominio en la acción), Permisos insuficientes (`sup`, `legal`, `ti`), casilla anterior a la activación ("no se exige, pero se puede registrar").

### Facilidad de uso
- **Registrar un acta CGRD con evidencia:** abrir diálogo 1 + casilla 2 + fecha 2 + subir archivo 1 + registrar 1 = **7 clics** y 3 campos de texto (5 clics sin casilla) (`03-cgrd-meetings.json`). Constituir comité: 7 clics. Publicar matriz: 3 clics.
- Fricciones: el calendario de la sesión abre en el mes actual y no hay escritura directa de fecha; registrar una sesión de mayo exige navegar meses (mi script terminó registrando el 6-09 contra la casilla de mayo, y el sistema lo aceptó, RSK-13); el mensaje "No se pudo completar la acción. Intenta nuevamente." ante un mandato que termina antes de la constitución no dice qué corregir (RSK-15).

### B. Funcionalidad
| Función | Estado | Evidencia (B) |
|---|---|---|
| Designar coordinador (≤25) / terminar designación | ✅ | Biodiversa; N°79 creada y revocada al terminar |
| Constituir comité / disolver | ✅ | Horcones; N°79 revocada al disolver |
| Validar mandato posterior a la constitución | 🟡 | Sólo CHECK de la base → error genérico — RSK-15 |
| Integrantes | ✅ | Alta con trabajador de la faena |
| Matriz GRD: borrador, amenazas, publicar con archivo | ✅ | N°80 `submitted` con `evidence_status=provided` |
| Acta con casilla + archivo real | ✅ | N°81 `approved` automática |
| Acta con URL externa / ruta inexistente / otro dominio / traversal / archivo de otra faena / archivo sin reclamar de otra persona | ✅ rechazadas | Replay de la server action (`04-replay-replay.json`) |
| Acta con el **mismo** archivo o el mismo contenido que otra acta | 🔴 | Aceptada y auto-aprobada — RSK-01 |
| Acta sin casilla (extraordinaria) | 🔴 | Acredita y auto-aprueba N°81 — RSK-12 |
| Anular acta | ✅ | N°81 revocada (`draft`), casilla → "no hecha" con motivo |
| Consultar acta / evidencia / historial | ❌ | RSK-14 |
| Mapa: subir plano, alcance, tipo real | ✅ | PDF renombrado a .png → 400; otra faena 403/404 |

### C. Código y lógica
- Reglas en el servicio y en transacción; acreditación y revocación después del commit (`prevention-cgrd.ts:172-182, 227, 335, 917`). La N°81 usa la celda planificada de la casilla (`:668`) y se auto-aprueba con quien registra (`pdtp-accreditation-connectors.ts:876`).
- `requireGrdAccess` y las reglas lanzan `Error` común (`prevention-cgrd-access.ts:30`); la acción los muestra, pero un error de la base cae al genérico (`cgrd/actions.ts:54`) (RSK-15).
- `listGrdMeetingSlots` y `listGrdMeetings` sin `ORDER BY` (`prevention-program-slots.ts:502-507`, `prevention-cgrd.ts:945-957`) (RSK-29). La anulación devuelve la casilla sin subir su `version` (`prevention-cgrd.ts:878-885`) (RSK-20). Marcadores del mapa se crean y borran sin bitácora (`prevention-risk-map.ts:145-173`) (RSK-19). Subidas no reclamadas quedan huérfanas (`fmbps1wLNIzctSOJVZJR.pdf` tras la constitución fallida) (RSK-21).

### D. Modelo de datos
- Comité/coordinador con índices únicos parciales de "uno activo por faena"; CHECK de mandato; actas no se borran (anulación con motivo); acuerdos → CAPA común. `prevention_evidence_uploads` registra dueño, faena y sha256, pero no impide que un mismo archivo o un mismo sha256 respalde varios actos (RSK-01).

### E. Permisos y seguridad
- **PRV-18 verificado:** descarga por igualdad exacta: nombre sin extensión o prefijo → 404; archivo de Biodiversa como prevfaena/cphs/jt → 404; `ti` → 403; `..%2F..%2F.env` → 400; respuesta con `nosniff`. Mapa: plano de Horcones para `otrafaena` → 404; subida a faena ajena → 403.
- IDOR en la acción: `otrafaena` registrando un acta en el comité de Horcones → "Registro de CGRD no encontrado o fuera de alcance."
- Extensión del archivo según el MIME real (M-21): rutas `.pdf` generadas por el servidor (`prevention-evidence-upload.ts`, `QUOTATION_EXTENSION_BY_MIME[validated.mimeType]`).

### F. Testing
- Verde: `cgrd/actions.test.ts`, `cgrd/mapa/actions.test.ts`, `cgrd/mapa/route.test.ts`, `risk-map-ui-contract.test.ts`; PGlite `prevention-cgrd.test.ts` y `risk-map-gc.test.ts`; **postgres `prevention-cgrd-postgres.test.ts`: 2/2 PASS** en `bodega_test_rsk_cgrd` (no skipped).
- E2E: sólo `prevencion-cgrd-risk-map.spec.ts` (plano y marcador). Nada de comité, acta ni N°79–81 (RSK-26). Ninguna prueba cubre reutilizar evidencia ni la casilla con una sesión de otro mes.

### G. Integración con Programa Anual (ejecutado en B, Horcones)
| Hecho | Ejecución PDTP | ¿Correcto? |
|---|---|---|
| Constituir comité con acta subida | N°79 sep. sem. 3, `submitted`, `executed_by=qa-prev-faena`, evidencia `provided` | ✅ (revisión manual) |
| Disolver comité | N°79 → `draft` (revocada) | ✅ |
| Terminar coordinador (Biodiversa) | N°79 → `draft` | ✅ |
| Publicar matriz GRD (prev) | N°80 sep. sem. 4, `submitted`, evidencia `provided` | ✅ |
| Acta con casilla mayo + archivo | N°81 **mayo** sem. 1, `approved` por `qa-prev-faena` (= quien registró) | 🟡 sin segunda persona; sesión del 6-09 acreditada en mayo (RSK-13) |
| Acta sin casilla + archivo | N°81 sep. sem. 4, `approved` automático | 🔴 defecto 10 (RSK-12) |
| Acta reutilizando la ruta de otra acta (replay) | N°81 sep. sem. 4, `approved` | 🔴 RSK-01 |
| Acta subiendo de nuevo el mismo PDF (UI, casilla abril) | N°81 abril sem. 1, `approved`; sha256 idéntico al de mayo | 🔴 RSK-01 |
| Acta con URL / ruta inexistente / archivo de otra faena | Rechazada por la acción, sin ejecución | ✅ PRV-01 |
| Anular actas | N°81 → `draft` y casilla abril → "no hecha" | ✅ |

Nota de datos: en el programa 2026 v2 las N°79/80 están planificadas en enero/febrero y la N°81 de febrero a mayo, todas **antes de la activación (17-09)**; por eso los actos de septiembre caen en celdas sin planificación y no mueven el porcentaje exigible. Es configuración del programa de B, no un defecto del submódulo.

### H. Hallazgos
Ver sección común (RSK-01, RSK-12, RSK-13, RSK-14, RSK-15; menores RSK-18…RSK-23, RSK-26…RSK-29).

### I. Readiness individual: **62/100** (62,5)
| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 17 | RSK-14 −3, RSK-12 −2, RSK-13 −2, RSK-15 −1 |
| UI/UX y facilidad de uso | 20 | 12 | RSK-14 −3, RSK-23 −2, RSK-28/29 −2, RSK-18 −1 |
| Integridad de datos | 15 | 7 | RSK-01 −5, RSK-13 −2, RSK-20 −1 |
| Integración con Programa Anual | 15 | 9 | RSK-01 −4, RSK-12 −2 |
| Código y mantenibilidad | 10 | 7 | RSK-19, RSK-21, RSK-29 −3 |
| Permisos y seguridad | 5 | 4 | RSK-01 (reúso por otra persona de la faena) −1 |
| Testing | 5 | 3 | RSK-26 −2 |
| Manejo de errores | 5 | 3,5 | RSK-15 −1,5 |

### Estado de hallazgos previos en este alcance
| Previo | Dictamen | Evidencia |
|---|---|---|
| PRV-01 (CGRD) | **Parcial** | URL, ruta inexistente, otro dominio, traversal, archivo de otra faena y archivo sin reclamar de otra persona: rechazados en la **acción del servidor** (replay) y la UI ya no acepta enlaces. Pero el mismo archivo (o el mismo contenido) respalda varias actas y cada una se auto-aprueba (RSK-01). |
| PRV-02 (CGRD) | **Parcial** | N°79/N°80 guardan el actor y quedan para otra persona. N°81 se auto-aprueba con quien registró el acta (`executed_by = approved_by`), por diseño M0.4 (RSK-01). |
| PRV-04 (CGRD) | Corregido en CGRD | Disolver/terminar/anular revocan (demostrado). Reemplazar la matriz GRD no revoca la N°80 anterior (no probado en navegador; mismo criterio que MIPER). |
| PRV-18 | **Corregido (verificado)** | Igualdad exacta y alcance por faena en `/cgrd/evidence/[name]`; `/cgrd/mapa/[name]` también. |
| Defecto 10 del 22-09 | **Sigue abierto** | Acta sin casilla acredita y auto-aprueba N°81 (RSK-12). |
| M-21 (CGRD) | **Corregido (verificado por código y rutas generadas)** | Extensión desde el MIME detectado. |
| M-02 | **Corregido (verificado)** | POST a `/api/prevencion/cgrd/evidence` con `Origin` ajeno → 403. |

### Qué no se pudo verificar y por qué
- Reemplazo de una matriz GRD publicada (v2) y su efecto en la N°80 anterior; ubicar/quitar marcadores (hay E2E que no corrí); acuerdos del acta → CAPA en navegador; "No aplica" de una casilla y su aprobación en el PDTP; la vista del PDTP para N°79–81 (no localicé la fila en la hoja paginada; me apoyé en SQL).

---

## Hallazgos (formato §6)

```
ID: RSK-01
Severidad: 🟠 CRÍTICO
Submódulo: CGRD
Categoría: Integridad de datos / Integración PDTP / Segregación
Título: La N°81 se auto-aprueba con quien registra el acta y el mismo documento puede respaldar cualquier número de sesiones
Archivo(s): lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts; lib/services/prevention-evidence-upload.ts; lib/services/prevention-cgrd.ts; lib/services/pdtp/integration-evidence.ts
Línea(s): pdtp-accreditation-connectors.ts:866-877 (autoApproveByUserId = recordedByUserId); prevention-evidence-upload.ts:126-131 (archivo ya ligado a la faena: se reutiliza sin límite); prevention-cgrd.ts:627 (claim) y 710-716; integration-evidence.ts:103-112
Pantalla/ruta: /prevencion/cgrd → "Registrar acta"
Endpoint: server action recordGrdMeetingAction
Rol: prevencionista_faena (y cualquiera con cgrd:meeting:manage)
Descripción: tras PRV-01 la evidencia se verifica (existe, dominio, faena, sha256), pero nada impide que un archivo ya reclamado por la faena vuelva a usarse en otra acta, ni que se suba dos veces el mismo PDF. Cada acta crea una ejecución N°81 `approved` con approved_by = executed_by = quien registró: no interviene una segunda persona en ningún punto.
Evidencia: DEMOSTRADO en B. (1) Replay de la acción con evidenceUrl = ruta del acta de mayo → acta CGRD-2026-UBIVJMPL y N°81 sep. `approved`. (2) Por la UI, subiendo otra vez QA_RSK_acta-mayo.pdf contra la casilla de abril → ruta nueva con el mismo sha256 126c0e2c… y N°81 abril `approved`. SQL: tres actas con sha256 idéntico, tres N°81 aprobadas por qa-prev-faena (04-replay-replay.json, 03-cgrd-dup.json).
Cómo reproducir:
1. En /prevencion/cgrd (Horcones) registrar un acta con casilla y un PDF.
2. Registrar otra acta en otra casilla subiendo el mismo PDF (o reenviar la acción con la misma ruta).
3. Ver pdtp_executions N°81: ambas `approved` por quien las registró.
Resultado actual: una sola acta firmada acredita todas las sesiones del año, aprobadas sin revisión.
Resultado esperado: un documento respalda un solo acto (unicidad por ruta y por sha256 en el dominio), y la N°81 pasa por otra persona o, al menos, no la aprueba quien la registró.
Impacto: el programa puede mostrar la N°81 al 100 % con "evidencia entregada" sin que existan esas sesiones; es la afirmación que el módulo existe para garantizar.
Causa probable: la regla M0.4 ("quien registró el acta la valida") se mantuvo al corregir PRV-01; la fila de subida controla dueño y faena, no unicidad.
Solución recomendada: índice único por (dominio, sha256) o marca de "consumido" en prevention_evidence_uploads para actas; rechazar ruta ya usada en otro registro; quitar la auto-aprobación de la N°81 (o exigir approved_by ≠ executed_by) y dejarla `submitted` con la evidencia verificada.
Esfuerzo: Bajo–Medio
Bloquea producción: No (corregir antes del lanzamiento)
Clasificación: A
```

```
ID: RSK-02
Severidad: 🟠 CRÍTICO
Submódulo: MIPER
Categoría: Funcionalidad / UI / Segregación efectiva
Título: Quien revisa y aprueba una MIPER no puede ver su contenido completo
Archivo(s): app/(app)/prevencion/miper/miper-workbench.tsx; lib/services/prevention-risk-legal.ts; app/api/prevencion/miper/[id]/export/route.ts
Línea(s): miper-workbench.tsx:190-191 (export sólo si published; entries.slice(0, 8)); prevention-risk-legal.ts:1629 (getPublishedRiskMatrix sólo published/superseded)
Pantalla/ruta: /prevencion/miper (Versiones)
Endpoint: GET /api/prevencion/miper/[id]/export
Rol: revisor (risk:review) y aprobador (risk:approve)
Descripción: cada versión muestra como máximo 8 peligros, sin enlace a "ver todos", y de cada uno sólo peligro, ruta, nivel residual y controles (no inherente, factor, daño, expuestos, género, sensibilidad). El Excel, única vista completa, sólo existe para versiones publicadas o reemplazadas. En `in_review`, `reviewed` y `approved` el revisor y el aprobador firman un contenido que no pueden leer.
Evidencia: CÓDIGO (líneas citadas) + DEMOSTRADO parcial: en B las tarjetas de v1–v3 muestran sólo esos campos (shots/R-1440-miper.png); la exportación de un borrador no está disponible en la UI y la ruta devuelve 404 para estados no publicados.
Cómo reproducir:
1. Crear un borrador con 10 peligros y enviarlo a revisión.
2. Entrar como revisor: se ven 8 tarjetas.
3. No hay botón de exportar ni ficha de peligro.
Resultado actual: revisión y aprobación "a ciegas" para matrices reales (decenas o cientos de peligros).
Resultado esperado: vista tabular completa de la versión (todas las columnas de la metodología) disponible en cualquier estado, o exportación del borrador marcada como no vigente.
Impacto: la segregación de cuatro firmas pierde su sentido; un fiscalizador preguntará qué revisó cada firmante.
Causa probable: la pantalla se diseñó como resumen y la exportación como documento oficial.
Solución recomendada: tabla paginada de peligros por versión (reutilizar DataTable) con los campos del Excel, y exportación de borradores con sello "BORRADOR — no vigente".
Esfuerzo: Medio
Bloquea producción: No (corregir antes del lanzamiento)
Clasificación: A
```

```
ID: RSK-03
Severidad: 🟡 IMPORTANTE
Submódulo: MIPER
Categoría: Integridad / Integración
Título: Reemplazar una MIPER deja vivos su disparador anual y una obligación de 30 días imposible de cerrar
Archivo(s): lib/services/prevention-risk-legal.ts
Línea(s): 534-561 (supersesión sin tocar disparadores ni obligaciones), 569-587 (se crean por versión), 1238-1240 (sólo se vinculan controles de matriz publicada), 1341-1344 (el cierre exige vínculo a controles de esa matriz)
Pantalla/ruta: /prevencion/miper (Revisiones), /prevencion/pdtp/cobertura (Relojes)
Endpoint: resolvePdtpUpdateObligationAction
Rol: prevencionista (program:manage)
Descripción: al publicar v2, v1 queda `superseded` pero su "Revisión anual de MIPER v1" sigue `pending` (y cuenta en el KPI "Revisiones pendientes") y su obligación "MIPER v1 · <hash>" sigue `pending`. Para cerrarla hay que vincular un control de v1, y los controles de una matriz reemplazada ya no se pueden vincular.
Evidencia: DEMOSTRADO en B: SQL con dos disparadores y dos obligaciones pending; en /prevencion/pdtp/cobertura las opciones sólo listan controles de v2 y "Declarar incorporada" sobre v1 responde "No se puede cerrar el reloj: el programa no tiene una actividad vinculada a esta fuente." (12-coverage.json).
Cómo reproducir:
1. Publicar MIPER v1 y luego v2 en la misma faena.
2. Ir a Cobertura MIPER y legal, vincular un control de v2 y cerrar el reloj de v2.
3. Intentar cerrar el de v1.
Resultado actual: la obligación de v1 vencerá el 29-10-2026 y quedará vencida para siempre; el KPI de revisiones queda inflado.
Resultado esperado: al reemplazar, cerrar (o marcar "superada por vN") el disparador anual y la obligación de la versión anterior, con traza.
Impacto: alarmas falsas permanentes en los relojes legales y en el tablero.
Causa probable: el reemplazo sólo cambia el estado de la matriz.
Solución recomendada: en la misma transacción del reemplazo, cerrar disparadores `annual` y obligaciones `pending/overdue` de las versiones reemplazadas con resolución "Reemplazada por vN".
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: RSK-04
Severidad: 🟡 IMPORTANTE
Submódulo: MIPER
Categoría: Integración con Programa Anual
Título: La N°35 está planificada todos los meses, pero una publicación acredita una sola celda
Archivo(s): lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts; datos del programa 2026 v2
Línea(s): pdtp-accreditation-connectors.ts:499-528 (una ejecución por publicación, occurredAt = publishedAt)
Pantalla/ruta: /prevencion/pdtp/actividades (N°35)
Endpoint: onRiskMatrixPublished
Rol: todos (lectura del cumplimiento)
Descripción: en el programa real la N°35 "Mantener y actualizar inventario de riesgos MIPER" tiene 12 celdas (una por mes, semana 3). Publicar la MIPER acredita el mes de publicación; los otros 11 meses quedan pendientes o atrasados salvo registro manual mensual o una publicación por mes.
Evidencia: DEMOSTRADO (SQL en B): pdtp_activity_schedule de pdtp-2026-v2-a-035 = 12 filas; tras dos publicaciones sólo hay ejecuciones en sep. sem. 4.
Cómo reproducir:
1. Consultar el cronograma de la N°35 del programa activo.
2. Publicar una MIPER.
3. Ver que sólo se acredita el mes de publicación.
Resultado actual: la N°35 no puede cumplirse desde su submódulo; el usuario tendrá que registrar a mano 11 meses o verla atrasada.
Resultado esperado: una regla explícita: o la actividad es anual/por evento, o "mantener vigente" acredita cada mes en que existe una MIPER publicada y no vencida (con su respaldo).
Impacto: indicador de cumplimiento distorsionado o doble registro manual.
Causa probable: el conector se diseñó para "publicar", el programa pide "mantener".
Solución recomendada: decidir con Prevención la semántica de la N°35; si es "mantener", acreditación mensual automática por vigencia (patrón de la carpeta legal N°19).
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: RSK-05
Severidad: 🟡 IMPORTANTE
Submódulo: MIPER y Requisitos legales
Categoría: Funcionalidad / Integridad
Título: Los borradores no se pueden corregir ni descartar
Archivo(s): lib/services/prevention-risk-legal.ts; app/(app)/prevencion/miper/miper-workbench.tsx
Línea(s): prevention-risk-legal.ts:299-380 (sólo addRiskEntry), 382-391, 924 (LEGAL_TRANSITIONS sin retorno ni descarte), 883-922 (sin edición); 1398 y 1411-1414 (cobertura cuenta procesos activos de cualquier matriz)
Pantalla/ruta: /prevencion/miper, /prevencion/requisitos-legales
Endpoint: —
Rol: prevencionista, prevencionista_faena
Descripción: en un borrador MIPER sólo se agregan peligros (no se editan ni se quitan); un requisito legal no se edita, no vuelve de "en revisión" y no se descarta; ninguna versión borrador se elimina. Los procesos y puestos de un borrador abandonado cuentan para siempre en el denominador de "Procesos/Puestos cubiertos".
Evidencia: CÓDIGO + DEMOSTRADO: activar el lote importado (borrador v3 nunca publicado) cambió los KPI de 1/1 y 1/1 a 1/2 y 1/3 (09-import-approve.json).
Cómo reproducir:
1. Crear un borrador MIPER con un peligro mal escrito: no hay forma de corregirlo.
2. Importar un lote y activarlo sin publicar: la cobertura baja.
3. Enviar un requisito legal a revisión con un error: sólo puede avanzar.
Resultado actual: correcciones imposibles o creando versiones nuevas; borradores huérfanos permanentes.
Resultado esperado: editar/quitar peligro en borrador, devolver requisito en revisión, descartar borrador con motivo; cobertura calculada sobre la versión publicada.
Impacto: datos erróneos que no se pueden limpiar e indicador de cobertura engañoso.
Causa probable: máquinas de estado pensadas sólo hacia adelante.
Solución recomendada: acciones de edición/eliminación de entrada en `draft`, transición `in_review → draft` en legal y `draft → discarded` en ambos; filtrar la cobertura por procesos presentes en matrices publicadas.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: RSK-06
Severidad: 🟡 IMPORTANTE
Submódulo: MIPER (importación)
Categoría: UI / Manejo de errores
Título: Corregir una fila importada exige editar JSON crudo y un JSON inválido se ignora sin aviso
Archivo(s): app/(app)/prevencion/miper/miper-workbench.tsx
Línea(s): 278-282 (textarea con JSON; `catch { return }`)
Pantalla/ruta: /prevencion/miper?tab=imports → "Resolver"
Endpoint: resolveRiskImportRowAction
Rol: prevencionista_faena
Descripción: el diálogo muestra la normalización como JSON para editar a mano. Si el JSON no parsea, el envío no hace nada y no dice por qué.
Evidencia: DEMOSTRADO en B: con "{ esto no es json" el diálogo quedó abierto y sin mensaje; con el JSON corregido (`inherentLevel: "alto"`) la fila pasó a lista (09-import-upload.json, shots/B-import-02-resolve-dialog.png).
Cómo reproducir:
1. Importar un Excel con un nivel "Altísimo".
2. Resolver la fila, dejar el JSON inválido y guardar.
3. No pasa nada.
Resultado actual: operación fallida silenciosa y una tarea que exige saber JSON.
Resultado esperado: formulario con los campos de la fila (niveles como selector) y errores por campo.
Impacto: la importación, principal vía de carga de una MIPER real, no es usable por un prevencionista.
Causa probable: diálogo técnico provisional.
Solución recomendada: reutilizar el formulario de "Agregar peligro" precargado con la normalización; mostrar el error de parseo si se mantiene el JSON.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: RSK-07
Severidad: 🟡 IMPORTANTE
Submódulo: MIPER (importación) — validador compartido con PDTP
Categoría: Seguridad (disponibilidad)
Título: El tope de expansión del Excel confía en los tamaños que declara el propio ZIP
Archivo(s): lib/services/xlsx-security.ts; lib/services/prevention-risk-import.ts
Línea(s): xlsx-security.ts:60-110 (suma `uncompressed` declarado en el directorio central); prevention-risk-import.ts:295-313 (luego `workbook.xlsx.load`)
Pantalla/ruta: /prevencion/miper → "Importar Excel"
Endpoint: stageRiskImportAction (y la importación PDTP)
Rol: cualquiera con prevention:risk:edit (incluye prevencionista_faena)
Descripción: un ZIP que declara 1 KB para una entrada que en realidad descomprime cientos de MB pasa la envolvente; ExcelJS (JSZip) infla todo y recién al final detecta el desajuste.
Evidencia: DEMOSTRADO en proceso aislado (prueba temporal riesgos-zipbomb.audit-tmp.test.ts, copiada a mi carpeta): archivo de 185 KB, total declarado 2.214 bytes → validateXlsxEnvelope lo acepta; ExcelJS infló 180 MB (pico +129 MB de memoria) en 450 ms y falló con "Bug : uncompressed data size mismatch" (zipbomb-result.json). TEÓRICO: con el límite real de 20 MB (≈1000:1) serían decenas de GB por petición; no lo lancé contra :3101 para no tumbar el entorno compartido.
Cómo reproducir:
1. Construir un .xlsx mínimo con `xl/media/x.bin` deflate de 180 MB y tamaño declarado 1024.
2. Llamar validateXlsxEnvelope y luego ExcelJS load.
3. Observar la memoria.
Resultado actual: un usuario autenticado puede agotar la memoria del proceso Node.
Resultado esperado: inflar por streaming con conteo real de bytes y cortar al superar el tope, o descartar entradas no usadas (media) sin inflarlas.
Impacto: caída del servidor para todos los usuarios.
Causa probable: se validan metadatos, no el flujo real.
Solución recomendada: descomprimir con un inflador que cuente bytes (p. ej. yauzl/fflate con límite) antes de ExcelJS, o rechazar entradas cuyo inflado supere el declarado.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: RSK-08
Severidad: 🟡 IMPORTANTE
Submódulo: MIPER y Requisitos legales
Categoría: UI/UX (regla de búsqueda y filtros de AGENTS.md)
Título: La búsqueda del TopBar se muestra pero no filtra, y no hay filtro por faena ni estado
Archivo(s): app/(app)/prevencion/miper/miper-workbench.tsx; app/(app)/prevencion/requisitos-legales/legal-requirements-workbench.tsx
Línea(s): ninguno de los dos usa useSafeShellHeader/searchQuery (miper-workbench.tsx:146-208; legal-requirements-workbench.tsx:44-62)
Pantalla/ruta: /prevencion/miper, /prevencion/requisitos-legales
Endpoint: —
Rol: todos
Descripción: la caja "Filtrar en esta página…" aparece y no tiene efecto. Las listas mezclan todas las faenas visibles (16 en B) sin selector.
Evidencia: DEMOSTRADO: al escribir "zzzz-no-existe" MIPER siguió con 3 versiones y legal con 1 requisito (10-responsive.json).
Cómo reproducir:
1. Abrir /prevencion/miper como prevencionista global.
2. Escribir en la búsqueda del TopBar.
3. La lista no cambia.
Resultado actual: un control que no hace nada y listas sin acotar.
Resultado esperado: conectar searchQuery o agregar la ruta a ROUTES_WITH_OWN_SEARCH; selector de faena y estado.
Impacto: con datos reales, encontrar la MIPER o la aplicabilidad de una faena será lento y confuso.
Causa probable: los workbench no adoptaron el patrón.
Solución recomendada: filtro por faena (como CGRD) y conexión del texto al TopBar.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: RSK-09
Severidad: 🟡 IMPORTANTE
Submódulo: Requisitos legales (también la verificación de controles MIPER)
Categoría: Integridad / Evidencia
Título: "Cumple" se acepta con un texto de 3 caracteres como evidencia
Archivo(s): lib/validation/prevention-module/risk-legal.ts; lib/services/prevention-risk-legal.ts
Línea(s): risk-legal.ts:181 y 191 (evidenceReference texto, mínimo 3); risk-legal.ts:110 (verificación de control, mínimo 5); prevention-risk-legal.ts:869-881 (brecha sólo si falta el texto)
Pantalla/ruta: /prevencion/requisitos-legales → Aplicabilidad → "Evaluar cumplimiento"
Endpoint: assessLegalComplianceAction
Rol: prevencionista_faena
Descripción: la evidencia de cumplimiento legal es un campo de texto libre; no hay archivo ni referencia verificable. Con "abc" la aplicabilidad queda "Cumple" y el KPI "Con evidencia y cumplimiento" sube.
Evidencia: DEMOSTRADO en B: evaluación con evidencia "abc" → compliance_status=compliant, KPI 1/1, 0 brechas (08-legal-*.json, SQL).
Cómo reproducir:
1. Aprobar la aplicabilidad de un requisito en una faena.
2. Evaluar cumplimiento "Cumple" con evidencia "abc".
3. El tablero lo cuenta como cumplido con evidencia.
Resultado actual: el registro legal afirma evidencia que no existe.
Resultado esperado: evidencia como archivo subido (contrato P4) o vínculo a un documento/ejecución de la plataforma; el texto, sólo como nota.
Impacto: el registro legal y su exportación ante un fiscalizador no se sostienen.
Causa probable: el módulo es anterior al contrato único de evidencia.
Solución recomendada: EvidenceField con dominio propio o vínculo a Documentación; mantener el texto como observación.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: RSK-10
Severidad: 🟡 IMPORTANTE
Submódulo: Requisitos legales
Categoría: Permisos / Operación
Título: Publicar un requisito exige a una segunda persona con approve_applicability, y sólo la jefa y el administrador lo tienen
Archivo(s): lib/services/prevention-risk-legal.ts; modules/prevention/manifest.ts
Línea(s): prevention-risk-legal.ts:925 y 941-949; manifest.ts:858-866 (grants legales), 1222 (sign_own_work sólo prevencionista); prevention-risk-legal.ts:883-884 (crear requisito global sin faena)
Pantalla/ruta: /prevencion/requisitos-legales
Endpoint: transitionLegalRequirementAction
Rol: jefa_chome, administrador
Descripción: la jefa aprueba y no puede publicar (no tiene sign_own_work); el único otro titular del permiso es el administrador de la plataforma, que termina firmando el registro legal. A la inversa, cualquier prevencionista_faena con legal:assess crea borradores del registro global.
Evidencia: DEMOSTRADO en B: jefa → "Quien aprobó el requisito legal no puede publicarlo: debe firmarlo otra persona."; publicó qa-admin (SQL published_by_user_id=qa-admin).
Cómo reproducir:
1. Llevar un requisito a "Aprobado" con la jefa.
2. Intentar publicar con la jefa: rechazado.
3. Sólo el administrador puede publicar.
Resultado actual: cuello de botella en dos personas y firma legal del administrador técnico.
Resultado esperado: una matriz de firmas explícita (p. ej. gerente_legal_rrhh o JDPR publica) o sign_own_work documentado para la jefatura.
Impacto: requisitos detenidos en "Aprobado" o firmados por quien no responde por su contenido.
Causa probable: se copió la regla de cuatro firmas de la MIPER sin revisar quién tiene el permiso.
Solución recomendada: decidir con negocio el rol publicador y otorgarlo; acotar la creación de requisitos globales a roles globales.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: RSK-11
Severidad: 🟡 IMPORTANTE
Submódulo: Requisitos legales
Categoría: UI / Trazabilidad
Título: La ficha del requisito responde "no existe" para todo lo no publicado y no muestra evaluaciones ni vínculos
Archivo(s): app/(app)/prevencion/requisitos-legales/legal-requirements-workbench.tsx; lib/services/prevention-risk-legal.ts; app/(app)/prevencion/requisitos-legales/[id]/page.tsx
Línea(s): legal-requirements-workbench.tsx:58 (todos los códigos enlazan); prevention-risk-legal.ts:1676 (sólo published/superseded); [id]/page.tsx:33-35 (no pinta assessments ni links)
Pantalla/ruta: /prevencion/requisitos-legales/[id]
Endpoint: —
Rol: todos
Descripción: los borradores, en revisión y aprobados se enlazan y abren "Error 404 · No encontramos este registro" con estado HTTP 200. La ficha publicada no muestra el historial de evaluaciones, hallazgos, CAPA ni vínculos al PDTP, aunque los carga.
Evidencia: DEMOSTRADO en B (href del borrador → 200 + "ERROR 404", 08-legal-*.json) + CÓDIGO.
Cómo reproducir:
1. Crear un requisito.
2. Hacer clic en su código.
3. Aparece la página de "no existe".
Resultado actual: enlace roto y sin forma de consultar la historia de cumplimiento en pantalla.
Resultado esperado: ficha para todos los estados y sección de evaluaciones.
Impacto: el registro no se puede auditar desde la aplicación (sólo en Excel).
Causa probable: la ficha se pensó para el fiscalizador (sólo lo vigente).
Solución recomendada: mostrar cualquier estado con badge; pintar assessments y links.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: RSK-12
Severidad: 🟡 IMPORTANTE
Submódulo: CGRD
Categoría: Integración con Programa Anual (defecto 10 del 22-09)
Título: Un acta "extraordinaria" sin casilla acredita y auto-aprueba la N°81, aunque la UI dice que no cuenta
Archivo(s): lib/services/prevention-cgrd.ts; app/(app)/prevencion/cgrd/cgrd-workbench.tsx; lib/validation/prevention-module/cgrd.ts
Línea(s): prevention-cgrd.ts:709-716 (acredita con o sin casilla); cgrd-workbench.tsx:619-625 ("no cuenta en el denominador"); cgrd.ts:107-111
Pantalla/ruta: /prevencion/cgrd → "Registrar acta" → "Ninguna (sesión extraordinaria)"
Endpoint: recordGrdMeetingAction
Rol: prevencionista_faena
Descripción: sin casilla, la N°81 se acredita en la celda de la fecha de la sesión y queda aprobada automáticamente.
Evidencia: DEMOSTRADO en B: acta CGRD-2026-A848SQGH sin casilla → N°81 sep. sem. 4 `approved` por qa-prev-faena.
Cómo reproducir:
1. Registrar un acta con casilla "Ninguna" y un PDF.
2. Consultar pdtp_executions de la N°81.
3. Hay una ejecución aprobada en el mes de la sesión.
Resultado actual: contradicción entre lo que la pantalla promete y lo que hace el programa.
Resultado esperado: o no acredita (coherente con el texto), o acredita `submitted` para revisión y la UI lo dice.
Impacto: ejecuciones fuera de plan aprobadas sin revisión; en meses planificados pueden sustituir a la sesión ordinaria.
Causa probable: la casilla se volvió opcional pero el conector siguió igual.
Solución recomendada: sin slotId, no llamar a onGrdMeetingClosed o hacerlo sin autoApprove.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: RSK-13
Severidad: 🟡 IMPORTANTE
Submódulo: CGRD
Categoría: Integridad temporal
Título: Una sesión realizada en septiembre llena la casilla de mayo y se acredita como cumplida en mayo
Archivo(s): lib/services/prevention-cgrd.ts
Línea(s): 648-669 (no compara heldOn con el mes de la casilla; plannedPeriod = celda de la casilla)
Pantalla/ruta: /prevencion/cgrd → "Registrar acta"
Endpoint: recordGrdMeetingAction
Rol: prevencionista_faena
Descripción: el servicio acepta cualquier fecha pasada para cualquier casilla abierta y acredita la celda planificada, sin marcar atraso ni guardar la diferencia en la ejecución.
Evidencia: DEMOSTRADO en B: acta del 06-09-2026 contra la casilla "mayo · semana 1" → N°81 mayo sem. 1 `approved`; acta del 15-09 contra "abril" → N°81 abril `approved`.
Cómo reproducir:
1. Registrar un acta con fecha de septiembre eligiendo la casilla de mayo.
2. Ver la N°81 de mayo aprobada.
3. Nada indica que la sesión fue cuatro meses tarde.
Resultado actual: el programa muestra cumplimiento a tiempo de sesiones hechas tarde.
Resultado esperado: rechazar fechas fuera del mes de la casilla o acreditar con indicación de atraso (fecha real visible en la celda).
Impacto: el "cuándo" del programa deja de ser confiable.
Causa probable: la regla buscó evitar que una carga tardía pague otro mes, y no distinguió carga tardía de sesión tardía.
Solución recomendada: validar heldOn contra el mes de la casilla (o una tolerancia) y registrar "realizada fuera de plazo".
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: RSK-14
Severidad: 🟡 IMPORTANTE
Submódulo: CGRD
Categoría: UI / Trazabilidad
Título: No se puede consultar un acta, su archivo ni el historial del comité; al disolverlo, todo desaparece de la pantalla
Archivo(s): app/(app)/prevencion/cgrd/cgrd-workbench.tsx; app/(app)/prevencion/cgrd/page.tsx
Línea(s): cgrd-workbench.tsx:336-365 (acta = código + fecha, sin detalle ni enlace), 190-228 (sólo la última matriz, sin enlace a su evidencia); page.tsx:52 y 61-67 (sólo el comité activo)
Pantalla/ruta: /prevencion/cgrd
Endpoint: GET /api/prevencion/cgrd/evidence/[name] (existe, nadie lo enlaza en CGRD)
Rol: todos
Descripción: la tabla, el acta, el quórum y el PDF de una sesión no se ven en ninguna pantalla del módulo; tampoco la evidencia de la constitución ni de la matriz publicada; las versiones anteriores de la matriz no se listan. Tras disolver, integrantes, actas y acuerdos dejan de mostrarse.
Evidencia: DEMOSTRADO en B: texto de la lista de actas ("REGISTRADA CGRD-2026-… · 06-09-2026 10:00 · Anular") y de la página tras disolver (03-cgrd-dissolve.json); los archivos sí se descargan por URL directa.
Cómo reproducir:
1. Registrar un acta con PDF.
2. Buscar cómo ver el acta: no hay.
3. Disolver el comité: su historia ya no aparece.
Resultado actual: la evidencia existe pero sólo es alcanzable desde el PDTP o por URL.
Resultado esperado: ficha del acta con enlace al archivo, historial de comités y versiones de matriz.
Impacto: ante una fiscalización no se puede mostrar el expediente del CGRD desde su módulo.
Causa probable: simplificación del 14-09 centrada en el alta.
Solución recomendada: detalle expandible del acta con enlace a la evidencia; lista de comités/coordinadores anteriores; historial de matrices.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: RSK-15
Severidad: 🟡 IMPORTANTE
Submódulo: CGRD
Categoría: Validaciones / Manejo de errores
Título: El mandato que termina antes de la constitución sólo lo frena la base, con un mensaje genérico
Archivo(s): lib/validation/prevention-module/cgrd.ts; app/(app)/prevencion/cgrd/actions.ts
Línea(s): cgrd.ts:20-26 (sin refine de fechas); actions.ts:54 (fallback "No se pudo completar la acción. Intenta nuevamente.")
Pantalla/ruta: /prevencion/cgrd → "Constituir comité"
Endpoint: constituteGrdCommitteeAction
Rol: prevencionista_faena
Descripción: el CHECK prevention_grd_committee_mandate_valid rechaza la fila y la acción muestra el genérico "Intenta nuevamente", que sugiere un fallo pasajero. Además el archivo ya subido queda huérfano.
Evidencia: DEMOSTRADO en B: constituido 20-09, mandato 10-09 → alerta genérica; log del servidor con la violación del CHECK; subida fmbps1wLNIzctSOJVZJR.pdf sin reclamar (03-cgrd-committee.json, SQL).
Cómo reproducir:
1. Constituir un comité con "Mandato hasta" anterior a "Constituido el".
2. Pulsar Constituir.
3. Aparece "No se pudo completar la acción. Intenta nuevamente."
Resultado actual: el usuario no sabe qué corregir.
Resultado esperado: error de campo "El mandato debe terminar después de la constitución" desde zod.
Impacto: bajo en datos, alto en frustración.
Causa probable: regla sólo en la base.
Solución recomendada: superRefine en grdCommitteeConstituteSchema y `min` en el DatePicker.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

### Mejoras y cosméticos (🔵 / ⚪)

| ID | Sev. | Submódulo | Hallazgo | Archivo:línea | Evidencia | Solución | Esfuerzo |
|---|---|---|---|---|---|---|---|
| RSK-16 | 🔵 | MIPER/Legal/PDTP | Se ofrecen botones que el servidor rechaza: "Publicar" a la jefa que aprobó; "Revisar" al creador del requisito; el publicador de la MIPER llena el motivo antes de saber que no puede aprobar la N°35 | miper-workbench.tsx:230; legal-requirements-workbench.tsx:68; pdtp-approval-buttons.tsx:96-104 | DEMOSTRADO (02, 08, approve-*.json) | Ocultar según approvedBy/createdBy/executedBy | Bajo |
| RSK-17 | 🔵 | MIPER/Legal | Exportaciones con IDs de usuario y enums crudos (hierarchy, status, effectiveness, sourceType, processId, riskEntryId) | miper-workbook.ts:61,64; requisitos-legales/export/route.ts:30,33 | CÓDIGO | Nombres y etiquetas en español | Bajo |
| RSK-18 | 🔵 | Mapa | Parámetro `?mapWorksite=` distinto de `?faena=`; miga a CGRD pierde la faena; carga el tablero MIPER completo de todas las faenas | risk-map-panel.tsx:56-74; risk-map-data.ts:22 | DEMOSTRADO (11-map.json) + CÓDIGO | Unificar parámetro; consulta acotada | Bajo |
| RSK-19 | 🔵 | Mapa | Crear/quitar marcadores no deja bitácora | prevention-risk-map.ts:145-173 | CÓDIGO | recordModuleHistory en ambos | Bajo |
| RSK-20 | 🔵 | CGRD | Anular un acta devuelve la casilla sin subir `version` | prevention-cgrd.ts:878-885 | CÓDIGO + SQL (version 2 tras anular) | `version + 1` | Bajo |
| RSK-21 | 🔵 | CGRD | Subidas no reclamadas quedan huérfanas (sin GC visible) | prevention-evidence-upload.ts:73-112 | DEMOSTRADO (SQL) | GC de subidas sin claim tras N horas | Bajo |
| RSK-22 | 🔵 | CGRD (datos) | En B existen `cgrd:matrix:review/approve` otorgados a prevencionista y jefa; no están en el manifiesto ni en el código | — | SQL (A ≠ B) | Limpiar permisos huérfanos en el seed/bootstrap | Bajo |
| RSK-23 | 🔵 | CGRD/MIPER | Acción principal (designar/constituir) bajo las casillas y la matriz; casillas sin "Registrar acta"; KPI en 0 sin CTA | cgrd-workbench.tsx:166-280; miper-workbench.tsx:179-184 | DEMOSTRADO (shots) | Reordenar; CTA por casilla | Bajo |
| RSK-24 | 🔵 | MIPER | Republicar crea otra ejecución N°35 en la misma celda ya aprobada: trabajo redundante en Aprobaciones | pdtp-accreditation-connectors.ts:517-527 | DEMOSTRADO (SQL) | Omitir o marcar "complemento" si la celda ya está aprobada | Bajo |
| RSK-25 | 🔵 | Legal | Evaluar cumplimiento sobrescribe `assessedByUserId` de la aplicabilidad | prevention-risk-legal.ts:1215 | CÓDIGO | Columna propia del evaluador | Bajo |
| RSK-26 | 🔵 | Los tres | E2E de MIPER y legal sólo cargan la página; ningún E2E de comité/acta/N°79–81 ni de reúso de evidencia | e2e/prevencion-miper-matriz.spec.ts; prevencion-cumplimiento-legal.spec.ts; prevencion-cgrd-risk-map.spec.ts | CÓDIGO (lectura) | E2E del flujo segregado y del acta | Medio |
| RSK-27 | 🔵 | CGRD | La matriz GRD la crea y publica la misma persona (prevencionista tiene ambos); "Quitar" amenaza sin confirmación | manifest.ts:718-719; cgrd-workbench.tsx:221 | CÓDIGO | Aceptable por diseño (N°80 queda `submitted`); confirmar al quitar | Bajo |
| RSK-28 | ⚪ | CGRD | Fechas ISO crudas (designación, constitución, mandato, plazo CAPA) | cgrd-workbench.tsx:242,286,386 | DEMOSTRADO | formatDate | Bajo |
| RSK-29 | ⚪ | CGRD | Casillas y actas sin ORDER BY (feb, mar, may, abr) | prevention-program-slots.ts:502-507; prevention-cgrd.ts:945-957 | DEMOSTRADO | orderBy mes/semana y heldOn | Bajo |
| RSK-30 | ⚪ | MIPER | Terminología: "Matriz IPER" / "MIPER y controles" / "MIPER"; "Origen risk_matrix · id"; "pendiente en miper / en cgrd" | miper-workbench.tsx:195; panel PDTP | DEMOSTRADO | Un nombre y etiquetas legibles | Bajo |
| RSK-31 | ⚪ | MIPER | A 390 px el SHA-256 del lote se sale de la tarjeta | miper-workbench.tsx:255 | DEMOSTRADO (R-390-miper-imports.png) | `break-all` o truncar | Bajo |

## Integración con el Programa Anual — síntesis

| Submódulo | Actividad | Vía | Estado al nacer | Evidencia | Segregación | Revocación |
|---|---|---|---|---|---|---|
| MIPER | N°35 | Directa al publicar | `submitted` | Texto "MIPER vN publicada" (`not_required`) | ✅ publicador no aprueba (PRV-02) | No al reemplazar (decisión PRV-04); pendientes de v1 quedan vivos (RSK-03) |
| Requisitos legales | N°19 (indirecta) | Obligación de 30 días + vínculo de cobertura | — | Texto libre (RSK-09) | Aplicabilidad segregada ✅ | — |
| CGRD | N°79 | Directa al constituir/designar | `submitted` | Archivo verificado (`provided`) | ✅ | ✅ al disolver/terminar |
| CGRD | N°80 | Directa al publicar | `submitted` | Archivo verificado | ✅ | No probado al reemplazar |
| CGRD | N°81 | Directa al registrar acta | **`approved` automático** | Archivo verificado pero reutilizable (RSK-01) | ❌ executed_by = approved_by | ✅ al anular |
