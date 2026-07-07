# Next.js Auth (next-auth) Status y Plan de Migración

**Fecha**: 2026-07-07  
**Versión actual**: `next-auth@5.0.0-beta.31`  
**Canal estable**: `next-auth@4.x` disponible

## Estado Actual

### Implementación en Plataforma Chome

**Ubicación**: `lib/auth/auth.ts`

**Features críticas implementadas**:
- ✅ **Credentials provider** con email/password
- ✅ **JWT session strategy** con callbacks personalizados
- ✅ **Rate limiting** por IP y email (integrado con `rate_limits` table)
- ✅ **RBAC system** incrustado en JWT tokens (`applyRbacToToken`)
- ✅ **Custom error handling** (`IpRateLimited`, `EmailRateLimited`)
- ✅ **Trust host** enabled (`trustHost: true`)
- ✅ **Timing-safe password comparison** (anti user enumeration)

### Dependencia del Canal Beta

**Riesgos identificados**:
1. **API inestable**: NextAuth v5 beta puede cambiar breaking changes sin aviso
2. **Security patches**: Patches de seguridad van primero al canal estable
3. **Ecosistema**: Librerías de terceros (middleware, adapters) pueden no ser compatibles
4. **Debugging**: Errores en beta pueden ser difíciles de debuggear vs versiones estables

**Mitigaciones actuales**:
- ✅ Suite de tests de auth existe (`lib/__tests__/auth-*.test.ts`)
- ✅ Tests de integración pasan
- ✅ Configuración es minimalista y bien documentada
- ⚠️ **Falta**: Smoke tests de login/logout/post-migration en pipeline de CI/CD

## Evaluación de Riesgos

### Severidad: **MEDIO-ALTO**

**Justificación**:
- La autenticación es **superficie crítica**: un fallo aquí bloquea toda la aplicación
- NextAuth v5 introduce **cambios arquitecturales** vs v4 (nuevo sistema de callbacks, cambios en JWT)
- Beta 31 indica que aún está en flujo: pueden haber bugs o cambios de API

**Factores atenuantes**:
- Config actual es **simple y well-tested**
- No se usan features complejos (OAuth, SAML, multi-factor)
- Tests de auth pasan consistentemente

## Decisión: **Permanencia en Beta con Plan de Escape**

### Opción A: Migrar a v4 estable
**Costos**: Muy alto  
**Beneficios**: API estable, parches de seguridad garantizados  
**Riesgos**: Refactor mayor, breaking changes significativos entre v4 y v5

### Opción B: Permanecer en v5 beta
**Costos**: Bajo  
**Beneficios**: Código actual funciona, features modernas ( mejor trust host, callbacks)  
**Riesgos**: API inestable, posible migración forzada en el futuro

### **Decisión**: **Opción B (Permanencia en beta) con condiciones**

#### Condiciones para permanecer en v5 beta:

1. ✅ **Tests existentes**: Ya hay suite de tests funcional
2. ⚠️ **Smoke tests**: Faltan en pipeline de CI/CD
3. ✅ **Documentación**: Este documento existe
4. ⚠️ **Monitoreo**: No hay alertas de fallos de auth

#### Plan de mitigación:

1. **Agregar smoke tests de auth** en CI/CD (ver abajo)
2. **Documentar configuración actual** (hecho en este doc)
3. **Configurar alertas** para fallos de login (>5% error rate)
4. **Reevaluar cada 3 meses** o cuando next-auth anuncia release candidate estable

## Smoke Tests de Auth (Pendiente de Implementación)

### Tests requeridos en pipeline de CI/CD:

```typescript
// tests/auth-smoke.test.ts
import { test, expect } from "@playwright/test"

test.describe("Auth smoke tests", () => {
  test("login con credenciales válidas", async ({ page }) => {
    await page.goto("/login")
    await page.fill("input[name='email']", "test-user@example.com")
    await page.fill("input[name='password']", "valid-password")
    await page.click("button[type='submit']")
    
    // Should redirect to dashboard
    await expect(page).toHaveURL("/dashboard", { timeout: 10_000 })
    
    // Should have session cookies
    const cookies = await page.context().cookies()
    const sessionCookie = cookies.find(c => c.name.includes("next-auth"))
    expect(sessionCookie).toBeDefined()
  })

  test("login con credenciales inválidas falla graceful", async ({ page }) => {
    await page.goto("/login")
    await page.fill("input[name='email']", "test-user@example.com")
    await page.fill("input[name='password']", "wrong-password")
    await page.click("button[type='submit']")
    
    // Should show error message
    await expect(page.getByText("Correo o contraseña incorrectos")).toBeVisible()
    await expect(page).toHaveURL("/login")
  })

  test("logout termina sesión correctamente", async ({ page }) => {
    // First login
    await page.goto("/login")
    await page.fill("input[name='email']", "test-user@example.com")
    await page.fill("input[name='password']", "valid-password")
    await page.click("button[type='submit']")
    await expect(page).toHaveURL("/dashboard")
    
    // Then logout
    await page.click("button[aria-label='Cerrar sesión']")
    await expect(page).toHaveURL("/login")
    
    // Should not have access to protected routes
    await page.goto("/dashboard")
    await expect(page).toHaveURL("/login") // Redirect back to login
  })

  test("JWT token contiene RBAC correcto", async ({ page }) => {
    // This requires a test user with known permissions
    await page.goto("/login")
    await page.fill("input[name='email']", "admin@example.com")
    await page.fill("input[name='password']", "admin-password")
    await page.click("button[type='submit']")
    
    // Verify JWT has roles by checking API response
    const response = await page.evaluate(async () => {
      const res = await fetch("/api/auth/session")
      return res.json()
    })
    
    expect(response.user).toHaveProperty("roles")
    expect(response.user.roles).toContain("admin")
  })
})
```

### Integración en CI/CD:

```yaml
# .github/workflows/smoke-tests.yml
name: Auth Smoke Tests
on:
  push:
    paths:
      - 'lib/auth/**'
      - 'package.json'
  pull_request:
    paths:
      - 'lib/auth/**'

jobs:
  auth-smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:e2e -- tests/auth-smoke.test.ts
```

## Plan de Emergencia: Migración a v4

### Si next-auth v5 beta se vuelve inestable:

1. **Crear feature branch**: `feat/migrate-next-auth-v4`
2. **Downgrade package**: `npm install next-auth@4.x`
3. **Refactor lib/auth/auth.ts**:
   - Cambiar `NextAuth()` por `NextAuth()` v4 API
   - Adaptar callbacks (v4 usa diferente estructura)
   - Migrar `trustHost` a configuración equivalente
4. **Actualizar imports**: Cambiar paths de imports si es necesario
5. **Ejecutar tests existentes**: Validar que `lib/__tests__/auth-*.test.ts` pasan
6. **Agregar smoke tests**: Implementar los tests de arriba
7. **Ejecutar smoke tests**: Validar login/logout/manual
8. **Deploy a staging**: Validar en ambiente staging primero
9. **Monitorizar**: Buscar errores de auth en logs por 48h
10. **Deploy a producción**: Si staging sale bien

**Tiempo estimado**: 4-6 horas de trabajo + testing

**Señales para activar plan de emergencia**:
- next-auth v5 beta tiene breaking changes que rompen nuestra config
- Aumentan bugs de auth en producción no reproducibles en desarrollo
- next-auth anuncia que v5 será deprecated sin release estable

## Recursos

- **Documentación next-auth**: https://next-auth.docs.js.org/
- **Guía migración v4→v5**: https://authjs.dev/getting-started/migration
- **Repositorio next-auth**: https://github.com/nextauthjs/next-auth
- **Discussions v5 beta**: https://github.com/nextauthjs/next-auth/discussions/categories/next-auth-v5-beta

## Próxima Revisión

**Fecha**: 2026-10-07 (3 meses desde documento)  
**Responsable**: Equipo de desarrollo  
**Acción**: Reevaluar estado de next-auth v5, revisar si hay release estable, actualizar este documento
