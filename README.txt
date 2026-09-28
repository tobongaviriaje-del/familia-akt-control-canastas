FAMILIA AKT - CONTROL DE CANASTAS
================================

Este proyecto conserva la interfaz y la lógica del sistema actual, pero guarda
usuarios y tareas en el servidor para que PC, celular y tablet compartan datos.

Para ejecutar:
1. Instalar Node.js 18 o superior.
2. Abrir una terminal en esta carpeta.
3. Ejecutar: npm start
4. Abrir: http://localhost:8080

Para publicar en un servidor Node (por ejemplo Railway), subir esta carpeta y
usar el comando de inicio: npm start.

IMPORTANTE: data/state.json contiene los datos compartidos. Para producción
conviene usar una base de datos PostgreSQL y copias de seguridad.
