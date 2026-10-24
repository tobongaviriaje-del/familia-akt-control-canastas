# Plan de persistencia para Familia AKT

## Resultado de la inspección

- Servicio Render: `familia-akt-control-canastas`.
- Rama desplegada en Render: `main`.
- Plan del servicio: `free`.
- El código escribe el estado en `data/state.json` y el histórico en `data/history/`.
- El servicio gratuito de Render tiene sistema de archivos efímero y no admite discos persistentes. No usar esta instancia como fuente oficial de datos.
- La instancia gratuita de Render Postgres no es una solución duradera porque expira a los 30 días.

## Decisión segura

No migrar los datos reales todavía. Mantener Railway activo y sin cambios hasta elegir y probar una opción persistente.

Opciones a evaluar:
1. Mantener el alojamiento actual mientras se corrigen permisos, persistencia y respaldos.
2. Render con servicio de pago y disco persistente, configurando `DATA_DIR` dentro del punto de montaje y verificando que tanto `state.json` como `history/` queden bajo ese directorio.
3. Un proveedor de base de datos persistente con un plan y política de retención adecuados. Esto requiere adaptar y probar el servidor; no basta con crear una base de datos.

## Requisitos de aceptación antes de mover datos

- Ejecutar todas las pruebas automatizadas en CI.
- Probar login y permisos para Admin, Mesanín, Supervisor y Patinador con datos ficticios.
- Crear tarea, registrar entregas parciales y completas, cerrar una jornada de prueba y verificar el archivo histórico.
- Reiniciar y volver a desplegar el entorno de prueba; verificar que tareas, entregas, catálogos, estándares e históricos permanezcan.
- Exportar respaldo desde el origen y validar conteos/checksums contra una importación de ensayo.
- Confirmar que CR4 150 = 110 unidades; CR4 125 = 270 unidades; VOGE/VOGI 180 = 62 por referencia; CH = 300 por referencia, incluida la información de canastas y referencias de CR4 125.
- No importar datos reales hasta que todas las verificaciones estén aprobadas.

## Acciones expresamente fuera de alcance

- No cancelar ni modificar Railway.
- No borrar, reiniciar ni reemplazar datos de producción.
- No ejecutar `reiniciarDiaNKD()`.
- No tocar Cloudflare ni D1.
- No desplegar la rama de trabajo en producción sin revisión y autorización explícita.
