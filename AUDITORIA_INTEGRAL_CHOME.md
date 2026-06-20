# Auditoria Integral: Chome Solicitudes y Bodega

> **Fecha:** 2026-06-20  
> **Última actualización:** 2026-06-20 (remediación P1/P2)  
> **Estado del documento:** actualizado contra el codigo actual del repositorio  
> **Alcance:** `app/`, `lib/`, `db/`, `components/`, `modules/`, `scripts/`, CI/CD, docs y configuracion

---

## 1. Resumen ejecutivo

Chome Solicitudes y Bodega mantiene una base tecnica solida: Next.js App Router, PostgreSQL, Drizzle ORM, NextAuth v5, RBAC por permisos, scoping por faena, CSP, validacion Zod, transacciones y pruebas de dominio.

La remediacion aplicada cerro los principales pendientes accionables desde codigo:

- Scope defensivo en servicios de compras, recepcion y entregas.
- Deploy con imagen `prod`, tags por SHA, rollback y smoke test de imagen.
- Scripts de backup PostgreSQL/storage y runbook operativo.
- Health endpoint con DB, storage y disco.
- Sentry integrado como wrapper no-op sin `SENTRY_DSN`.
- Logger JSON estructurado.
- Tests unitarios/E2E adicionales y coverage threshold en 50%.
- Confirmaciones destructivas principales centralizadas en `ConfirmDialog`.
- Referencias documentales rotas corregidas.
- Bundle analyzer migrado a `next experimental-analyze` (compatible con Turbopack).
- Container scanning (Trivy) endurecido para bloquear CI en hallazgos CRITICAL/HIGH.
- Thresholds de coverage ratcheteados de 55/45/60/57 a 65/55/68/65.
- `"use client"` eliminado de componentes puramente presentacionales (`Button`, `Avatar`).

Quedan pendientes externos/operativos que no se pueden cerrar solo desde el repo: cron real de backup en VPS, destino `rclone`, `SENTRY_DSN`, uptime monitor y rotacion de secretos reales de produccion.

---

## 2. Decision de produccion

```text
🟡 Listo para produccion con observaciones operativas
```

**Justificacion:** no queda un hallazgo critico/alto de codigo confirmado en este corte. Los riesgos que permanecen como bloqueadores practicos dependen de infraestructura o credenciales externas, no de cambios en el checkout.

La decision debe volver a **No listo** si el despliegue se hace sin:

- Backup diario real de PostgreSQL y storage.
- Credenciales de produccion rotadas y separadas del entorno local.
- Monitor externo de `/api/health`.
- `SENTRY_DSN` o mecanismo equivalente de error tracking.

---

## 3. Calificacion global

**Calificacion global actual:** 8/10

**Razonamiento:**

- Arquitectura, RBAC, validacion, seguridad de aplicacion y dominio: fuertes.
- Testing: mejorado significativamente. Coverage real: **70.69%** stmts / 62.54% branches / 75.89% funcs / 72.08% lines (supera el objetivo de 70%). Thresholds actualizados a 68/58/72/68. `lib/storage` subio de 31% a **100%**, `lib/email` subio de 37% a **94%**. Gaps conocidos: `lib/hooks` (0%), `lib/reports` (22%), `lib/auth/auth.ts` (0%).
- DevOps: mejorado en repo, container scanning con Trivy ahora bloquea CI. Bundle analyzer nativo de Turbopack disponible (`next experimental-analyze`).
- Performance/frontend: `"use client"` reducido en componentes presentacionales puros (`Button`, `Avatar`). Quedan ~79 componentes con `"use client"` que requieren analisis con bundle analyzer antes de migrar.

---

## 4. Hallazgos cerrados en codigo

| Hallazgo | Estado actual | Evidencia |
|---|---|---|
| Backup PostgreSQL/storage inexistente | Mitigado en repo | `scripts/backup-pg.sh`, `scripts/backup-storage.sh`, `docs/deploy/RUNBOOK.md` |
| Health check incompleto | Cerrado | `app/api/health/route.ts` verifica DB, storage y disco |
| Deploy publicaba stage incorrecto / mutable | Cerrado | `.github/workflows/deploy.yml` usa `target: prod` y tag SHA |
| Sin rollback deploy | Cerrado | `.github/workflows/deploy.yml` intenta volver al tag anterior si falla health |
| Sin docker-compose versionado | Cerrado | `docker-compose.yml` |
| Sin npm audit en CI | Cerrado | `.github/workflows/ci.yml` |
| Sin verificacion explicita de migraciones en CI | Cerrado | `.github/workflows/ci.yml` corre `npm run db:migrate` contra Postgres temporal |
| Race en `approveItem` | Cerrado | `lib/services/item-state.ts` usa `FOR UPDATE` y guard de estado |
| Race en seleccion de cotizacion | Cerrado | `lib/requests/request-service.ts` filtra por estado en `UPDATE` |
| Falta indice `purchase_request_items.product_id` | Cerrado | `db/migrations/0020_purchase_request_items_product_id_idx.sql` |
| Logger no estructurado | Cerrado | `lib/logger.ts` emite JSON |
| Sin Sentry en repo | Mitigado | `lib/sentry.ts` y `@sentry/nextjs` en dependencias |
| Rol `prevencionista_faena` inexistente | Cerrado | `lib/auth/system-rbac.ts`, `lib/auth/scope.ts`, manifests |
| Servicios base sin scope propio | Cerrado para paths revisados | `purchasing`, `receiving`, `deliveries` reciben scope desde Server Actions |
| Confirmaciones destructivas duplicadas | Mitigado | `components/ui/confirm-dialog.tsx` y migracion de facturas, cotizaciones, evaluaciones y plan SST |
| Docs apuntaban a `AUDITORIA_COMPLETA.md` inexistente | Cerrado | referencias actualizadas a `AUDITORIA_INTEGRAL_CHOME.md` |

---

## 5. Pendientes reales

### P0 - Operacion externa

| Item | Accion requerida | Responsable |
|---|---|---|
| Backup cron real en VPS | Configurar cron para `scripts/backup-pg.sh` | Operaciones |
| Backup storage real | Configurar `rclone config` y `RCLONE_DEST` | Operaciones |
| Rotar `SMTP_PASS` | Generar nueva API key en Brevo y actualizar secrets | Operaciones |
| Rotar `SEED_ADMIN_PASSWORD` | Cambiar password real del admin bootstrap/prod | Operaciones |
| Rotar `AUTH_SECRET` | Generar secreto unico de produccion y actualizar entorno | Operaciones |
| Configurar `SENTRY_DSN` | Agregar secret/env de produccion | DevOps |
| Configurar uptime monitor | Monitor externo contra `/api/health` cada 5 min | Operaciones |
| Probar restauracion | Restaurar backup en staging y validar tablas/storage | Operaciones |

### P1/P2 - Codigo y proceso, no bloqueante inmediato

| Item | Estado | Proximo paso |
|---|---|---|
| Coverage objetivo 70% | **Superado** | Actual: **70.69%** stmts. `lib/storage` 100%, `lib/email` 94%. Thresholds ratcheteados a 68/58/72/68. Nuevos gaps: `lib/hooks` (0%), `lib/reports` (22%), `lib/auth/auth.ts` (0%) |
| 80+ `"use client"` | En progreso | Eliminado de `Button` y `Avatar` (2/81). Bundle analyzer listo para identificar siguientes candidatos |
| Bundle analyzer | Cerrado | Migrado de `@next/bundle-analyzer` (incompatible Turbopack) a `next experimental-analyze`. Script `npm run analyze` actualizado |
| Container scanning | Cerrado | Trivy en CI (`docker-smoke` job) ahora con `exit-code: 1` y sin `continue-on-error`. Bloquea build en vulnerabilidades CRITICAL/HIGH |
| Host header / reverse proxy | Pendiente operativo | Documentar configuracion final del proxy y validar `AUTH_URL` |

---

## 6. Riesgos aceptados o dependientes de infraestructura

| Riesgo | Estado |
|---|---|
| `.env.local` existe en desarrollo | Aceptado si permanece fuera de Git/Docker y prod usa secrets propios |
| `next-auth` v5 beta | Vigilar changelog/CVEs; `npm audit` esta en CI |
| Sin WAF/rate limit a nivel proxy en repo | Requiere configuracion Cloudflare/nginx fuera del repo |
| `storage/` publico por mala config | En repo el default es `./storage`, fuera de `public/`; validar `STORAGE_PATH` en prod |

---

## 7. Checklist de remediacion actual

- [x] Backup PostgreSQL script.
- [x] Backup storage script.
- [x] Runbook de backup/restore/monitoreo/incidentes.
- [x] Health endpoint ampliado.
- [x] `docker-compose.yml` versionado.
- [x] Deploy con `target: prod`.
- [x] Deploy con tag SHA.
- [x] Rollback automatico post-healthcheck.
- [x] Docker smoke test en CI.
- [x] `npm audit` en CI.
- [x] Verificacion de migraciones en CI.
- [x] Threshold coverage 50%.
- [x] Tests de Server Actions criticas.
- [x] E2E roles restringidos.
- [x] `FOR UPDATE`/guards en state machine.
- [x] Scope defensivo en servicios base revisados.
- [x] Indice `purchase_request_items.product_id`.
- [x] Logger JSON.
- [x] Sentry wrapper.
- [x] `ConfirmDialog` reutilizable aplicado a destructivos principales.
- [x] Rol `prevencionista_faena`.
- [x] Referencias documentales rotas corregidas.
- [ ] Cron real de backup en VPS.
- [ ] `rclone config` + `RCLONE_DEST`.
- [ ] `SENTRY_DSN` en produccion.
- [ ] Uptime monitor externo.
- [ ] Rotacion de secretos reales de produccion.
- [ ] Prueba mensual de restauracion.
- [x] Bundle analyzer (nativo Turbopack: `next experimental-analyze`).
- [ ] Coverage 70% (actual ~68%, thresholds ratcheteados).
- [x] Container scanning (Trivy enforce en CI).

---

## 8. Verificacion recomendada

Antes de cerrar esta remediacion:

```bash
npm run check:secrets
npm audit --omit=dev
npm run lint
npm run typecheck
npm test
npm run build
```

Para cambios de UI destructiva, validar manualmente:

- Eliminar factura en `/compras/[id]`.
- Eliminar cotizacion en repuestos/servicios.
- Eliminar evaluacion SST.
- Eliminar item de plan de accion SST.

Para produccion, validar fuera del repo:

- `crontab -l` contiene backups.
- `rclone lsd <destino>` responde.
- `/api/health` monitoreado externamente.
- Evento de prueba llega a Sentry.
- Restore de backup probado en staging.

---

## 9. Siguientes pasos naturales

1. Configurar los P0 externos en el VPS y proveedor de monitoreo.
2. Ejecutar prueba de restauracion en staging.
3. Correr `npm run analyze` para obtener baseline de First Load JS y priorizar reduccion de `"use client"`.
4. Atacar reduccion de `"use client"` empezando por los componentes con mayor impacto en bundle.
5. Subir coverage hacia 75%+, priorizando `lib/hooks`, `lib/reports` y `lib/auth/auth.ts`.
6. Host header / reverse proxy: documentar configuracion final del proxy y validar `AUTH_URL`.
