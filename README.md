# EVA — Enterprise Virtual Assistant (hackathon)

Asistente conversacional corporativo de Redeban sobre AWS: responde con el conocimiento de la empresa citando sus fuentes (Amazon Bedrock Knowledge Base), busca documentos, reserva puestos por piso en Skkeda (mock) con la confirmación de la persona y consulta tareas en Jira (mock de solo lectura).

> **La IA propone, el Policy Engine autoriza, los conectores ejecutan.**

Construido con **Kiro** y **Spec-Driven Development**: los specs están en `.kiro/specs/` y el contexto del proyecto en `.kiro/steering/`.

## Cómo correr

```bash
npm ci
npm run build
npm test
npm run synth
```

## Estructura

| Carpeta | Contenido | Dueña |
|---|---|---|
| `src/nucleo/` | Orquestador, recuperación y respuesta con citas, Policy Engine | Xio |
| `data/conocimiento/`, `src/conectores/skkeda/`, `src/conectores/jira/` | Corpus de documentos, evaluación y mocks de Skkeda y Jira | Rochi |
| `infra/`, `src/portal/` | CDK (incluida la base de conocimiento) y portal web | Liz |
| `docs/spec/`, `docs/contratos/` | Spec y contratos de la liga (referencia) | — |
| `data/` | Datos sintéticos | — |
