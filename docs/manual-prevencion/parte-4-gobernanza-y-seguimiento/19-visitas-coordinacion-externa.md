# Capítulo 19: Visitas, Fiscalizaciones y Coordinación Externa

> **Marco Normativo:** Decreto Supremo 44, Artículos 20 (Coordinación en el Centro de Trabajo) y 70 (Medidas Prescritas por el Organismo Administrador), Decreto Supremo 76 (Subcontratación).  
> **Ruta en Plataforma:** Menú > Seguimiento > **Visitas y coordinación** (`/prevencion/coordinacion`).  
> **Permisos del Sistema:** `prevention:engagement:view` (ver) y `prevention:engagement:manage` (registrar y gestionar).

---

## 1. El Control de Interacciones con Entidades Externas

En una faena industrial o forestal, el equipo de prevención interactúa constantemente con entidades fuera de la empresa:
1. **Fiscalizadores del Estado:** Inspectores de la **Dirección del Trabajo (DT)**, fiscalizadores de la **SEREMI de Salud** y autoridades del transporte o ambientales.
2. **Organismo Administrador (Mutual de Seguridad, ACHS o IST):** Visitas técnicas de expertos en prevención, evaluaciones de higiene o auditorías.
3. **Empresa Mandante:** Reuniones mensuales de coordinación de seguridad exigidas por el mandante (Arauco, Masisa, Biodiversa, etc.) bajo el régimen de subcontratación (DS 76).

El módulo centraliza el registro de todas estas visitas y, lo más importante: **el seguimiento riguroso de las medidas prescritas con plazo legal para evitar multas graves o paralizaciones**.

---

## 2. Paso a Paso: Cómo Registrar una Fiscalización o Visita Técnica

```
[Visita del Fiscalizador o Asesor Mutual]
                   │
                   ▼
[Recepción del Acta o Informe Técnico]
                   │
                   ▼
[Ir a /prevencion/coordinacion > "Nueva interacción"]
                   │
                   ▼
1. Seleccionar Faena, Entidad Externa y Fecha
2. Ingresar Nombre y RUT del Inspector / Asesor
3. Digitar el Objeto de la Fiscalización
4. Registrar Medidas Prescritas con Plazo Legal
5. Adjuntar Acta de Fiscalización Escaneada
                   │
                   ▼
[Guardar y Activar Monitoreo de Plazos]
```

### Paso 1: Ingreso de Datos Básicos
En `/prevencion/coordinacion`, haz clic en **"Nueva interacción externa"**:
*   **Entidad:** Dirección del Trabajo, SEREMI de Salud, Mutual de Seguridad, Mandante u Otra.
*   **Tipo de Interacción:** Fiscalización en terreno, Visita de asesoría técnica, Reunión de coordinación de faena.
*   **Profesional Externo:** Nombre completo del fiscalizador o experto asesor.
*   **Carga del Documento Original:** Sube el escaneo completo y legible del **Acta de Fiscalización** o del informe de visita firmado.

---

## 3. Gestión de Medidas Prescritas (Evitar Multas y Sanciones)

Cuando un fiscalizador de la DT o la SEREMI deja observaciones en el acta, suele otorgar plazos perentorios (habitualmente **5 a 15 días hábiles**):

1. En la ficha de la interacción, dirígete a la sección **"Medidas prescritas"**.
2. Presiona **"Agregar medida"**:
   *   **Descripción textual de la exigencia:** (ej. *Instalar baranda de protección perimetral en fosa de lubricación del taller mecánico*).
   *   **Plazo Fatal:** Fecha exacta indicada en el acta para presentar descargos o correcciones.
   *   **Responsable Interno:** Jefe de Taller, Jefe de Terreno o Administrador de Contrato.
3. El sistema monitoreará el plazo y enviará alertas en el panel de inicio.

### Cómo Acreditar el Cumplimiento de la Medida ante la Autoridad:
1. Una vez ejecutada la corrección física o documental en terreno:
2. Abre la medida en `/prevencion/coordinacion/[id]`.
3. Sube la fotografía del trabajo terminado o el comprobante presentado a la autoridad.
4. Presiona **"Marcar medida como subsanada"**.
5. Adjunta la carta formal de respuesta timbrada por la oficina de partes de la DT o SEREMI.
