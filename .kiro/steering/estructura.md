---
inclusion: always
---

# Estructura del repositorio y dueñas

```text
hackathon/
├── .kiro/steering/                 contexto que Kiro carga siempre
├── .kiro/specs/                    un spec por frente: infra-y-portal, nucleo-agente, conocimiento-y-acciones
├── docs/spec/                      spec de la liga (requisitos, diseño, flujos, datos, seguridad, API). Solo consulta
├── docs/contratos/                 connector-port.v1.json, knowledge-port.v1.json, skkeda-v1.yaml, escenarios-mock.md
├── data/
│   ├── conocimiento/semilla/       artículos de la liga en JSON (solo referencia: si contradicen el corpus, manda el corpus)
│   ├── conocimiento/documentos/
│   │   ├── general/                Rochi: corpus que SÍ se indexa (x.md + x.md.metadata.json)
│   │   └── restringido/            Rochi: documentos que NUNCA se suben a la base de conocimiento
│   ├── conocimiento/evaluacion.json Rochi: preguntas de prueba con el documento esperado
│   ├── skkeda/catalogo.json        capacidades de Skkeda (con pisos)
│   └── jira/catalogo.json          capacidad de lectura de Jira (mock)
├── src/
│   ├── comun/contrato.ts           tipos compartidos (solo tipos; cambia solo con acuerdo de las tres)
│   ├── nucleo/                     Xio: orquestador, NLU, recuperación y respuesta con citas, Policy Engine
│   ├── conectores/skkeda/          Rochi: mock persistente y handler de Skkeda
│   ├── conectores/jira/            Rochi: mock de solo lectura de Jira
│   └── portal/                     Liz: index.html, styles.css (boilerplate), app.js, assets/
├── infra/                          Liz: CDK (bin/app.ts, lib/*.ts, test/) y scripts/
│   └── scripts/                    prueba-humo.mjs (Liz), evaluar-conocimiento.mjs (Rochi)
└── package.json, tsconfig.json, jest.config.js, eslint.config.mjs
```

## Regla de oro para trabajar sin pisarse

- **Cada persona modifica solo su carpeta.** Si una tarea necesita tocar la carpeta de otra, se detiene y lo avisa.
- `src/comun/contrato.ts` y `.kiro/steering/contrato-mvp.md` son el acuerdo entre las tres: no se cambian sin hablarlo.
- Los puntos de entrada ya existen como stubs (`src/nucleo/handler.ts`, `src/conectores/skkeda/handler.ts`, `src/conectores/jira/handler.ts`, `src/portal/app.js`) y el stack vacío en `infra/lib/eva-stack.ts`. Se reemplaza su contenido; no se mueven ni se renombran.
- Con una sola estación de Kiro: un commit directo en `main` al terminar cada turno, con el nombre de la conductora. Con una cuenta por persona: una rama por frente (`feat/infra-y-portal`, `feat/nucleo-agente`, `feat/conocimiento-y-acciones`). El módulo de investigación (opcional) va en su propio commit y se apaga sin `-c investigacion=true`.
