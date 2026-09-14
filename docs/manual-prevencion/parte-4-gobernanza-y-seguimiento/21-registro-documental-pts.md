# Capítulo 21: Registro Documental y Difusión de Procedimientos (PTS)

> **Marco Normativo:** Decreto Supremo 44 (DS 44, Artículo 72: *Registro documental de la actividad preventiva*).  
> **Ruta en Plataforma:** Menú > Seguimiento > **Registro documental** (`/prevencion/documentacion`).  
> **Actividades PDTP Asociadas:** N° 43 (Elaboración y publicación de PTS) y N° 36 (Acuse de difusión).

---

## 1. El Sistema Documental Preventivo según el DS 44

El Artículo 72 del Decreto Supremo 44 exige que las empresas mantengan un registro documental formal, trazable y actualizado de toda la normativa interna de seguridad.

En `/prevencion/documentacion` se gestionan los siguientes tipos de documentos:

| Tipo | Sigla | Descripción | Ejemplo Típico |
|---|---|---|---|
| **Procedimiento de Trabajo Seguro** | **PTS** | Define el paso a paso seguro y los controles obligatorios para una tarea crítica. | *PTS-04: Procedimiento de carguío y amarre de trozos forestales*. |
| **Procedimiento Operacional** | **PROC** | Describe la secuencia operativa estándar de un proceso. | *PROC-12: Procedimiento de ingreso y pesaje en romana*. |
| **Instructivo de Trabajo** | **INSTR** | Instrucción técnica breve y específica de una herramienta o equipo. | *INSTR-02: Uso y mantención de motosierra*. |
| **Formato Oficial** | **FORMATO**| Plantilla o checklist estándar para levantamiento de datos. | *RE-20: Formato de investigación de accidentes*. |
| **Reglamento Interno** | **RIOHS** | Reglamento Interno de Orden, Higiene y Seguridad de la empresa. | *RIOHS Corporativo CHOME*. |

---

## 2. El Ciclo de Aprobación de un Procedimiento (Actividad PDTP N° 43)

Para que un Procedimiento de Trabajo Seguro (PTS) tenga validez legal ante un fiscalizador o un tribunal laboral, debe cumplir con el ciclo de firmas segregadas:

```mermaid
graph LR
    A[1. Redacción Borrador] --> B[2. Envío a Revisión]
    B --> C[3. Aprobación Técnica]
    C --> D[4. Publicación Oficial]
```

1. **Redacción (Draft):** El Prevencionista de Faena y el Administrador de Contrato redactan o actualizan el procedimiento considerando la realidad del terreno.
2. **Revisión (Review):** Un profesional técnico distinto (Jefe de Operaciones o Asesor Mutual) revisa que el procedimiento sea viable y cumpla la normativa.
3. **Aprobación (Approve):** La Jefa del Departamento de Prevención aprueba el texto definitivo.
4. **Publicación (Publish):** Se emite la versión oficial inmutable con código y número de versión. Este acto acredita la actividad **N° 43** en el PDTP.

---

## 3. Difusión y Acuse de Recibo Firmado por los Trabajadores

Un procedimiento publicado no protege a nadie si queda guardado en una carpeta: **los trabajadores que realizan la tarea deben conocerlo y firmar su recepción**:

### Cómo Distribuir y Registrar el Acuse de Recibo:
1. Abre el documento vigente en `/prevencion/documentacion/[id]`.
2. Presiona **"Distribuir a dotación"**:
   * Selecciona tu faena y los cargos destinatarios (ej. *Todos los conductores de Faena Biodiversa*).
3. **Registro de la Difusión en Terreno:**
   * **Opción A (Firma Digital):** Los trabajadores ingresan a la plataforma desde su teléfono o kiosco de faena y marcan *"Acepto y he leído el procedimiento"*.
   * **Opción B (Lista de Asistencia en Papel):** Imprimes la hoja de difusión del documento, los trabajadores firman de puño y letra tras la capacitación en terreno, y tú subes el PDF firmado en la pestaña **"Acuses de recibo"**.
4. El sistema calculará el porcentaje de dotación que ha tomado conocimiento formal del documento.
