# Capítulo 11: Requisitos de EPP y Detección de Brechas

> **Marco Normativo:** Ley 16.744 (Artículo 68: Obligación del empleador de entregar EPP adecuados libre de costo) y Decreto Supremo 594 (Certificación de EPP).  
> **Ruta en Plataforma:** Menú > Cumplimiento del programa > **Requisitos de EPP** (`/prevencion/epp-preventivo`).

---

## 1. El Puente entre Prevención y Bodega

En muchas empresas, Prevención define qué EPP debe usar la gente, pero Bodega entrega lo que hay disponible y nadie sabe con certeza si los trabajadores en terreno están realmente protegidos.

En esta plataforma, **Prevención y Bodega están integradas en tiempo real**:
1. **Prevención define la Matriz:** Se establecen los EPP obligatorios para cada cargo en cada faena (ej. *Operador de Grúa en Masisa: Casco con barbiquejo, calzado de seguridad dieléctrico, lentes de seguridad con filtro UV y chaleco reflectante clase 3*).
2. **Bodega registra las Entregas:** Cada vez que el pañolero o bodeguero entrega un elemento a un trabajador, queda registrado con su RUT y fecha.
3. **El Tablero Preventivo Detecta Brechas:** El sistema cruza automáticamente la dotación activa de la faena contra las entregas de bodega y te muestra instantáneamente a cualquier trabajador que esté operando sin su equipo reglamentario.

---

## 2. Cómo Monitorear el Tablero de Cobertura de EPP

Al ingresar a `/prevencion/epp-preventivo`:

### Vista de Semáforo por Trabajador y por Cargo:

```
FAENA: Cholguan - Arauco │ Cargo: Conductor de Camión Forestal
───────────────────────────────────────────────────────────────────────────────
Trabajador         Calzado Seg.   Casco + Barb.  Lentes UV      Chaleco C3
───────────────────────────────────────────────────────────────────────────────
Marcos Díaz        🟢 Vigente     🟢 Vigente     🟢 Vigente     🟢 Vigente
Carlos Vera        🟢 Vigente     🔴 Sin entrega 🟢 Vigente     🟢 Vigente  <-- BRECHA!
Luis Alarcón       🟡 Por vencer  🟢 Vigente     🟢 Vigente     🟢 Vigente
```

### Significado de los Estados:
*   🟢 **Vigente:** El trabajador recibió su EPP certificado y está dentro de su vida útil estimada.
*   🟡 **Por vencer (Próximo recambio):** El elemento está cerca de cumplir su ciclo de uso normal (ej. calzado de seguridad con 6 meses de uso intenso).
*   🔴 **Brecha Crítica (Sin entrega / Vencido):** El trabajador está asignado a un puesto que exige ese equipo, pero Bodega no registra ninguna entrega válida.

---

## 3. Qué Hacer Cuando Detectas una Brecha Crítica

Si encuentras a un trabajador con una brecha roja:

1. **Gestión Inmediata con Bodega:**
   * Haz clic sobre la celda roja del trabajador.
   * Presiona el botón **"Solicitar entrega prioritaria a Bodega"**.
   * El sistema enviará una notificación a la bodega central o pañol de faena para que preparen el equipo de su talla correspondiente.
2. **Escalamiento a Acción Correctiva (CAPA):**
   * Si la falta de EPP se debe a un **quiebre de stock prolongado** o retraso del proveedor:
   * Presiona **"Escalar brecha a CAPA"**.
   * Esto generará una acción correctiva formal para que Adquisiciones o Gerencia resuelva la compra urgente con respaldo auditable.

---

## 4. Auditoría de EPP en Terreno

> [!TIP]
> **Consejo de terreno:**  
> Realiza una revisión semanal de este tablero antes de tus inspecciones en terreno. Si el sistema dice que a Carlos Vera se le entregaron guantes anticorte hace 3 días, compruébalo visualmente en su puesto de trabajo. Si el trabajador no los está usando, aplícale una observación de conducta e infórmale de su obligación legal de usarlos conforme al Reglamento Interno.
