---
inclusion: always
---

# Cómo trabaja el equipo con Kiro

- **Spec-Driven Development:** primero el spec del frente (requisitos en EARS → diseño → tareas), aprobado por su dueña; después el código, tarea por tarea.
- **Una tarea a la vez.** Al terminar cada tarea: `npm run build`, `npm test` y `npm run lint` pasan; luego un commit con el formato `feat(<frente>): <qué> [<tarea>]`, en español.
- **No inventes requisitos.** Si algo no está en el spec, en el contrato o en el steering, pregunta antes de implementarlo.
- **No toques carpetas de otro frente** (ver `estructura.md`). Si es inevitable, detente y avisa.
- **Respuestas cortas:** al terminar una tarea, di qué archivos cambiaste, qué pruebas agregaste y si queda algo pendiente.
- **Comandos contra AWS** (`cdk deploy`, `aws ...`) los ejecuta solo la operadora de AWS (Liz). Kiro puede proponerlos, no ejecutarlos.
- Commits con la cuenta de quien conduce Kiro en ese turno (`git config user.name` y `user.email` se cambian al rotar).
