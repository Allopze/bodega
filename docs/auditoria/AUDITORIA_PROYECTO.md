# Auditoría de Proyecto — Chome Solicitudes y Bodega

Análisis de seguridad, hallazgos, riesgos identificados y recomendaciones de mejora.

---

## Resumen ejecutivo

El sistema implementa medidas de seguridad razonables para una aplicación interna single-tenant. Los controles de autenticación, autorización y auditoría están presentes en todas las capas. Se identifican áreas de mejora en hardening de sesiones, validación de archivos adjuntos, y protección contra exposición de datos en logs.

---

## Hallazgos

### 1. Autenticación

**Fortalezas:**
- NextAuth v5 con JWT, sesiones firmadas con `AUTH_SECRET`.
- bcrypt con cost factor 12 para hashing de contraseñas.
- Rate limiting persistente en BD (IP + email) contra fuerza bruta.
- Primer usuario registrado obtiene `administrador` automáticamente. Registros subsecuentes requieren invitación.

**Observaciones:**
- No hay expiración de sesión configurada explícitamente. El JWT es válido indefinidamente mientras el secreto no cambie.
- No hay rotación de `AUTH_SECRET` documentada.
- No se implementa 2FA/MFA. Para un sistema interno es aceptable, pero debería considerarse si se expone a internet.

**Severidad:** Baja

**Recomendación:** Configurar `session.maxAge` en NextAuth. Documentar procedimiento de rotación de secretos.

---

### 2. Autorización (RBAC)

**Fortalezas:**
- 5 roles con 23 permisos granulares bien definidos.
- Guards en server actions (`requirePermission`, `can`, `canAny`).
- Scoping por faena implementado a nivel SQL (no en memoria).
- Caché RBAC de 60s con invalidación en cambio de perfil.
- Roles globales vs. scoped correctamente separados.

**Observaciones:**
- Los guards se aplican manualmente en cada server action. No hay middleware automático que verifique permisos por ruta. Un server action sin guard sería ejecutable.
- No hay prueba automatizada que verifique que cada server action tiene su guard correspondiente.

**Severidad:** Media

**Recomendación:** Agregar un test de integración que enumere todos los server actions y verifique que cada uno llama a `requirePermission` o `can`. Considerar un wrapper o decorador para aplicar guards de forma declarativa.

---

### 3. Validación de entrada

**Fortalezas:**
- Zod v4 en todos los server actions para validar entradas de usuario.
- Schemas separados para datos maestros y operaciones.
- Tipos inferidos desde schemas Zod (single source of truth).

**Observaciones:**
- Los mensajes de error de Zod no siempre se traducen a mensajes amigables para el usuario antes de mostrarse.
- No hay sanitización adicional de strings — se confía en que Drizzle parametriza las queries (lo cual es correcto contra SQL injection, pero no contra XSS si los datos se renderizan sin escape).

**Severidad:** Baja

**Recomendación:** Verificar que React escape correctamente todos los datos provenientes de BD. Agregar un mapeo de errores Zod → mensajes en español.

---

### 4. Archivos adjuntos

**Fortalezas:**
- Tabla `attachments` con metadatos (fileName, fileType, fileSize, storageKey).
- Límite de tamaño configurable vía `system_settings.pdf_max_size_mb`.

**Observaciones:**
- No se pudo verificar si hay validación de tipo MIME real (magic bytes) más allá de la extensión.
- No se pudo verificar si hay sanitización de nombres de archivo (path traversal).
- El storage es local (`storage/`). En producción esto requeriría respaldo y posiblemente migración a S3/objetos.

**Severidad:** Media

**Recomendación:**
- Validar magic bytes del archivo, no solo la extensión.
- Sanitizar nombres de archivo: eliminar `../`, caracteres especiales, limitar longitud.
- Documentar procedimiento de respaldo del directorio `storage/`.
- Considerar migración a almacenamiento de objetos (S3-compatible) para producción.

---

### 5. Rate limiting

**Fortalezas:**
- Persistente en SQLite (sobrevive a reinicios).
- Doble llave: IP + email.
- Bloqueo temporal tras intentos fallidos consecutivos.

**Observaciones:**
- La tabla `rate_limits` puede crecer indefinidamente. No se observa un mecanismo de limpieza de entradas antiguas.
- No hay rate limiting en otros endpoints (API, attachments, export). Solo en login.

**Severidad:** Baja

**Recomendación:** Agregar un job de limpieza de entradas expiradas en `rate_limits`. Considerar rate limiting en endpoints de exportación y attachments para prevenir abuso.

---

### 6. Headers de seguridad

**Fortalezas:**
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` restrictiva
- `Strict-Transport-Security` con max-age largo

**Observaciones:**
- Falta `Content-Security-Policy`. Sin CSP, el sistema es vulnerable a XSS si se logra inyectar un script (aunque React mitiga esto significativamente).
- `X-Frame-Options: DENY` es correcto, pero `Content-Security-Policy: frame-ancestors 'none'` sería más moderno.

**Severidad:** Baja

**Recomendación:** Agregar un CSP razonable para una app Next.js:
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'
```

---

### 7. Logs y auditoría

**Fortalezas:**
- `audit_log` con acción, entidad, usuario, estado anterior/nuevo (JSON), motivo y timestamp.
- `status_history` con transiciones de máquina de estados.
- Auditoría en cada mutación de estado.

**Observaciones:**
- Los datos en `oldState` y `newState` son JSON completos de la entidad. Esto podría incluir datos sensibles (ej. hashedPassword en users, aunque se usa bcrypt).
- No se observa rotación o purge de logs antiguos. La tabla crecerá con el tiempo.
- No hay protección contra escritura en logs de auditoría: si un atacante obtiene acceso a la BD, podría modificar los logs.

**Severidad:** Baja (para sistema interno)

**Recomendación:**
- Excluir campos sensibles del snapshot JSON en `audit_log` (ej. `hashedPassword`).
- Documentar política de retención de logs (ej. 2 años) y agregar purge manual o automático.
- Para producción, considerar append-only logs o enviar a un sistema externo inmutable.

---

### 8. Base de datos

**Fortalezas:**
- SQLite con WAL mode para concurrencia.
- Migraciones versionadas y reproducibles.
- Seed base sin datos mock (solo roles, permisos, catálogo).
- Queries parametrizadas vía Drizzle ORM (protección contra SQL injection integrada).

**Observaciones:**
- SQLite no tiene autenticación de conexión — cualquiera con acceso al archivo `chome.db` puede leer/escribir toda la BD.
- El archivo de BD no está encriptado en reposo.
- SQLite no es adecuado para múltiples instancias de la aplicación (no escala horizontalmente).

**Severidad:** Baja (para single-tenant, deployment único)

**Recomendación:**
- Asegurar permisos de archivo restrictivos en `chome.db` (600 o 640).
- No commitear `chome.db` al repositorio (ya se cumple vía `.gitignore`).
- Si se necesita alta disponibilidad, migrar a PostgreSQL.
- Considerar SQLCipher si se requiere encriptación en reposo.

---

### 9. Dependencias

**Observaciones:**
- Next.js 16.2.7 — versión bleeding edge. Puede tener vulnerabilidades no descubiertas aún.
- `bcryptjs` es JavaScript puro. `bcrypt` nativo sería más rápido pero requiere compilación.
- Las dependencias Radix UI y TanStack Query son maduras y bien mantenidas.

**Severidad:** Baja

**Recomendación:** Ejecutar `npm audit` periódicamente. Mantenerse al día con releases de seguridad de Next.js.

---

### 10. Secretos y configuración

**Fortalezas:**
- `.env` con `AUTH_SECRET` y variables SMTP.
- `.env.example` documenta las variables requeridas.
- `.env` en `.gitignore` (no versionado).

**Observaciones:**
- No se pudo verificar si hay validación de que `AUTH_SECRET` esté configurado al iniciar.
- Las variables SMTP son opcionales pero no hay advertencia si faltan y se intenta enviar correo.

**Severidad:** Baja

**Recomendación:** Agregar validación al inicio de que `AUTH_SECRET` existe y tiene longitud mínima (32+ caracteres). Mostrar advertencia si SMTP no está configurado y se requiere envío de invitaciones.

---

## Matriz de riesgos

| Riesgo | Probabilidad | Impacto | Severidad | Mitigación actual |
|---|---|---|---|---|
| Fuerza bruta en login | Baja | Medio | Baja | Rate limiting IP + email |
| Escalamiento de privilegios | Baja | Crítico | Media | Guards por permiso en server actions |
| Fuga de datos entre faenas | Baja | Alto | Baja | Scoping SQL por faena |
| XSS vía datos de usuario | Baja | Medio | Baja | React escapa por defecto |
| Path traversal en attachments | Baja | Alto | Media | No verificado |
| Exposición de BD por acceso a archivo | Baja | Crítico | Baja | Permisos de archivo |
| Inyección SQL | Muy baja | Crítico | Baja | Drizzle ORM parametriza |
| Falta de CSP | Media | Medio | Baja | Sin CSP actualmente |
| Logs sin rotación | Alta | Bajo | Baja | Sin mecanismo de purge |

---

## Resumen de recomendaciones prioritarias

1. **Alta prioridad:**
   - Validar magic bytes y sanitizar nombres de archivo en uploads.
   - Agregar CSP básico en next.config.ts.
   - Configurar `session.maxAge` en NextAuth.

2. **Media prioridad:**
   - Agregar test que verifique guards en todos los server actions.
   - Excluir campos sensibles de snapshots en `audit_log`.
   - Implementar purge de `rate_limits` antiguos.

3. **Baja prioridad:**
   - Rotación de `AUTH_SECRET`.
   - Evaluar 2FA si el sistema se expone a internet.
   - Migrar storage de attachments a S3.
   - Evaluar PostgreSQL para producción multi-instancia.
   - SQLCipher para encriptación en reposo.
