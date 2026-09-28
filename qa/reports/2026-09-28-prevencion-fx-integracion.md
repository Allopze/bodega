# Fixes de Prevención tras el análisis `/docs:discover` + `/docs:explore` (2026-09-28)

**Rama:** `prevencion/fx-integracion` (desde `main` d4efdac9). Sin push y sin mezclar a `main`.
**Migración:** una sola, `0335_faulty_princess_powerful`. Agrega la columna nullable
`idempotency_key unique` a `prevention_privacy_request_executions`.
**Origen:** los 63 hallazgos de `docs/.knowledge/_meta/warnings.json` y `modules/prevention/areas/*.json`,
más `qa/reports/2026-09-27-docs-explore-prevencion.md`. El plan fue aprobado por el usuario.

## Qué quedó integrado

Hubo 9 ramas por área, con archivos disjuntos. Cada hallazgo se reprodujo primero con una prueba en
rojo; se corrigió cuando la prueba pasó a verde.

| Rama | Contenido |
|---|---|
| `fx-0-errores` | `actionErrorResult`: un `ZodError` se convierte en `fieldErrors` y en la primera regla dentro del mensaje, y 23505/23503 reciben su mensaje propio. `useOperation` expone `fieldErrors`. Zod pasa a español en servidor y cliente. Las guardas de emergencias lanzan `EmergencyDomainError`. |
| `fx-a-documentos` | Confidencialidad al archivar, restaurar, enlazar y regularizar. Títulos sensibles filtrados. La versión de un documento archivado responde 410 (salvo roles de flujo). Restaurar vuelve a `vigente` si la versión sigue vigente. La confidencialidad mínima se hereda de la clase de dato y del tipo. Privacidad: permisos de salud por dominio, exportación sin aptitud si falta `view_restrictions`, auditoría filtrada e idempotencia persistente (0335). |
| `fx-b-incidentes` | Una rebaja en el triage libera los carriles fatales (`not_required`). `reported→triage` queda solo por el triage. No se clasifica ni se confirma difusión en incidentes cerrados. Una investigación completada no se rebaja. El vencimiento se calcula en día chileno. Bandeja pública: convertir o descartar. Payload reservado editable y auditado. El menú alineado a `incidents:view`. Evidencia de CAPA subible con SHA-256. Exportación de CAPA auditada. «Reabrir» y la excepción de segregación visibles. |
| `fx-c-inspecciones` | Un hallazgo cerrado no bloquea la revisión ni se deriva a CAPA. Vencimiento de permisos: solo `active→suspended`, con cron `prevention-permit-expiry` cada 15 min. El mes de alcotest es el mes civil chileno y el período debe estar cumplido. Se validan supervisor y peligro del permiso. Hay avisos al enviar, aprobar y suspender. Revisar un acta `declared_in_form` sigue una sola regla. |
| `fx-d-riesgos` | **«Aprobar cambio» se puede usar.** Aprobar un cambio con impacto en riesgo abre la revisión MIPER. El rechazo se segrega. Publicar un requisito legal se segrega. Reevaluar una aplicabilidad aprobada es explícito. La vigilancia compara la versión vista. La UI de higiene gatea por `assess`. El enlace de una CAPA de riesgo corregido. |
| `fx-e-organizacion` | Una ejecución PDTP rechazada exige reenvío, y el motivo 10 caracteres. EPP con alcance y referencias. Ficha del trabajador con alcance. Recursos de emergencia con alcance y plan en borrador. Un acta CGRD sin quórum no acredita la N°81 y su fecha no puede ser futura. Mensajes claros de unicidad en CPHS y CGRD. |
| `fx-f-nucleo` | Aviso correcto de «No aplica» en capacitación. Título de la evaluación SST. Prueba nueva de **paridad menú↔página**. Código sin llamadores eliminado. |
| `fx-g-ui-layout` | Las altas pasan a `PageHeader.actions`, con un solo «Nuevo» que pregunta qué crear en CPHS, higiene y permisos. Los KPI de gestión del cambio filtran y no muestran «0» pelado. Desbordes a 390 px corregidos en `ResponsiveDataList` y en las plantillas PDTP. |
| `fx-h-ui-dialogos` | `DatePicker`/`DateTimePicker` en CGRD y simulacros. Los 14 `window.prompt` pasan a diálogos accesibles. Confirmación antes de archivar y de escalar EPP. Etiquetas de privacidad en español. Enlaces a la ficha del control y del requisito. Errores por campo en los diálogos de alta. |
| `fx-i-cierre` (coordinador) | El inventario de privacidad no muestra títulos sensibles, solo los cuenta. Editar la clase de dato aplica el mínimo de confidencialidad. Eliminadas `reassignInspectionRun` y las altas MIPER sin UI. Textos de permiso y comentario corregidos. |

**En la integración, además:**
- La evidencia subida desde la CAPA se verifica contra el archivo en disco (SHA-256 recalculado) y no se adopta entre faenas.
- **`Field` (componente compartido):** un control sin `htmlFor` que tiene ayuda o error perdía su nombre accesible. Ahora se enlaza con `useId`, sin pisar un `aria-label` propio. Lo destapó la spec nueva de gestión del cambio.

## Verificación sobre la rama final (commit 1f38cbd8)

| Puerta | Resultado |
|---|---|
| `typecheck` / `lint` | PASS / PASS (0 avisos) |
| `check:secrets` / `check:security-audit` | PASS / sin hallazgos altos ni críticos, allowlist vacío |
| `test:fast` | 795 archivos, **10.324 PASS**, 302 omitidas (suites postgres sin variables) |
| `test:pglite` | 224 archivos, **2.757 PASS**, 1 omitida |
| Suites `*-postgres` de Prevención y PDTP (17) | **262 PASS**, una por una contra :55432 |
| `db:verify-migrations` | 336 entradas hasta 0335 y checksums OK. `db:generate`: «No schema changes» |
| `test:e2e` completo | **759 PASS**, 0 fallos, 5 omitidas (Cloudreve y entregas, condicionales, iguales que antes) |
| `doctor` | 67/100, 0 errores, 964 avisos. **No se comparó con `main`** |

**Recorrido en navegador:** lo cubren las specs de Playwright contra el build de producción de la rama.
- **Spec nueva `prevencion-gestion-cambio`:** un usuario crea el cambio y evalúa las 6 dimensiones; otro lo aprueba con fecha y el cambio queda en estado Aprobado. Es la regresión del hallazgo #1, que antes era imposible.
- Las specs de reflow y densidad existentes también se corrieron.
- **No hubo recorrido manual** de las 13 páginas con UI nueva a 1440 y 390 px, fuera de lo que cubren las specs.

## Incidentes durante la verificación

- **Postgres de pruebas.** `bodega-e2e-postgres` hizo segfault durante una migración de la suite de
  higiene (`could not resize shared memory segment … No space left on device`). El `/dev/shm` del
  contenedor es de 64 MB, el valor por omisión. Se recuperó solo y las suites se reejecutaron en verde.
  Es un **automation warning** del entorno: conviene recrear el contenedor con `--shm-size=256m`.
- **Primera corrida E2E completa.** Dieron 9 fallos, todos en el acta de inspecciones. Los causó el primer
  arreglo de `Field`, que pisaba un `aria-label` propio. Se corrigió con una prueba y la segunda corrida
  completa quedó en 0 fallos.
- **`pdtp-ocurrencia-no-aplica-revision`.** Fallaba **también en `main`**. Era una carrera de la prueba:
  consultaba la base antes de que terminara la acción. Se corrigió la spec, no el producto.

## Decisiones (resueltas con el usuario, commit 113e2e63)

1. **Permisos `approved` vencidos:** siguen `approved` y la activación los bloquea. Ahora se muestran «Vencido sin activar» en la lista y en la ficha. Sin migración.
2. **Acta CGRD sin quórum:** se registra, pero no acredita la N°81. Se mantiene.
3. **Versión de un documento archivado:** 410, salvo roles del flujo documental. Se mantiene.
4. **Carga masiva `personal`/`client_secret`:** exige `manage_restricted`. Se mantiene: es la regla de la subida individual.
5. **Bandeja pública de incidentes:** convertir exige sólo `incidents:triage`; `jefa_chome` ya puede.
6. **Roles por omisión:** `prevencionista` recibe `incidents:view_sensitive`. `health:view_clinical` sigue sin rol por omisión. **Aplicar con `npm run db:seed`** al desplegar.

La prueba de la conversión con sólo `triage` se escribió junto con el fix (no se vio en rojo).

## Sin recorrer

- Recorrido manual a 1440/390 px de las páginas con UI nueva (fuera de las specs), WebKit y otros roles.
- `doctor` sobre `main` para comparar puntaje.
- La migración 0335 sobre datos reales, el cron `prevention-permit-expiry` en el contenedor real y el envío
  real de notificaciones.
- Regenerar `docs/.knowledge` (el volcado se hace desde `main`, después de mezclar).
- Tres desfases menú↔página **fuera de Prevención**, listados en `nav-page-permission-parity.test.ts`:
  `/compras`, `/recepcion` y `/ti/reportes`.
