import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import type { Contexto } from './tipos';
import { leerConfig } from './dependencias';
import {
  buscarInvestigacion,
  investigar,
  LIMITE_INVESTIGACION_MS,
  MAX_RETRIEVE,
  MAX_RONDAS,
} from './investigacion';
import { validarSalida } from './intencion';
import { FILTRO_GENERAL, NUM_RESULTADOS } from './recuperacion';
import { MARCA_RESPUESTA, MENSAJE_SIN_FUENTE } from './respuesta';
import { crearSimulados, type ResultadoKb, type Simulados } from './pruebas/simulados';

const DOCUMENTO: ResultadoKb = {
  texto: '## Viáticos El viático nacional es de COP 280.000 por día.',
  score: 0.74,
  documentId: 'DOC-SYN-0001',
  title: 'Política de viajes corporativos',
  updatedAt: '2026-09-30',
};

function contexto(sim: Simulados): Contexto {
  return {
    deps: sim.deps,
    cfg: leerConfig({
      TABLA_ESTADO: 'eva-dev-estado',
      KB_ID: 'KB123',
      FLUJO_TRANSACCIONAL_ARN: 'arn:sfn',
      GUARDRAIL_ID: 'gr-1',
      GUARDRAIL_VERSION: '1',
      TITULOS_SECCION: 'Viáticos',
      INVESTIGACION_ACTIVA: 'true',
    }),
    identidad: { userId: 'SYN-USR-0001', grupos: [] },
    correlationId: 'corr-SYN-1',
    conversationId: 'conv-SYN-1',
  };
}

function verificarLlamadas(sim: Simulados): void {
  for (const llamada of sim.agente.llamadas) {
    expect(llamada.retrievalConfiguration?.vectorSearchConfiguration?.filter).toEqual(FILTRO_GENERAL);
    expect(llamada.retrievalConfiguration?.vectorSearchConfiguration?.numberOfResults).toBe(NUM_RESULTADOS);
  }
  for (const llamada of sim.bedrock.llamadasConverse) {
    expect(llamada).not.toHaveProperty('toolConfig');
    expect(llamada.inferenceConfig?.temperature).toBe(0);
  }
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('esquema opcional del clasificador', () => {
  const investigacion = {
    tipo: 'INVESTIGACION',
    subpreguntas: ['¿Cuál es el plazo?', '¿Cuál es el monto?'],
  };
  const aclarar = { tipo: 'ACLARAR', aclaracion: '¿El viaje es nacional o internacional?' };

  it('acepta INVESTIGACION y ACLARAR solo cuando el interruptor está activo', () => {
    expect(validarSalida(investigacion, true)).toEqual(investigacion);
    expect(validarSalida(aclarar, true)).toEqual(aclarar);
    expect(validarSalida(investigacion, false)).toBeNull();
    expect(validarSalida(aclarar, false)).toBeNull();
  });

  it('rechaza menos de 2, más de 4 y subpreguntas vacías', () => {
    expect(validarSalida({ tipo: 'INVESTIGACION', subpreguntas: ['una'] }, true)).toBeNull();
    expect(validarSalida({ tipo: 'INVESTIGACION', subpreguntas: ['1', '2', '3', '4', '5'] }, true)).toBeNull();
    expect(validarSalida({ tipo: 'INVESTIGACION', subpreguntas: ['bien', '   '] }, true)).toBeNull();
    expect(validarSalida({ tipo: 'ACLARAR', aclaracion: '  ' }, true)).toBeNull();
  });
});

describe('búsqueda de investigación', () => {
  it('nunca supera 6 Retrieve, dos rondas ni una reformulación por subpregunta', async () => {
    const sim = crearSimulados();
    sim.agente.responder = () => [];
    // Con 4 búsquedas iniciales solo quedan 2 cupos para la segunda ronda.
    sim.bedrock.colaReformulaciones.push(
      JSON.stringify({ reformulada: 'Reformulada 1' }),
      JSON.stringify({ reformulada: 'Reformulada 2' }),
    );

    const resultado = await buscarInvestigacion(contexto(sim), ['Pregunta 1', 'Pregunta 2', 'Pregunta 3', 'Pregunta 4']);

    expect(MAX_RONDAS).toBe(2);
    expect(resultado.rondasRealizadas).toBe(MAX_RONDAS);
    expect(resultado.retrieveRealizados).toBe(MAX_RETRIEVE);
    expect(sim.agente.llamadas).toHaveLength(MAX_RETRIEVE);
    expect(resultado.pasos.map((p) => p.reformulada)).toEqual([true, true, false, false]);
    expect(sim.bedrock.colaReformulaciones).toHaveLength(0);
    expect(sim.agente.llamadas.map((l) => l.retrievalQuery?.text)).toEqual([
      'Pregunta 1',
      'Pregunta 2',
      'Pregunta 3',
      'Pregunta 4',
      'Reformulada 1',
      'Reformulada 2',
    ]);
    verificarLlamadas(sim);
  });

  it('lanza cada ronda en paralelo', async () => {
    const sim = crearSimulados();
    const pendientes: (() => void)[] = [];
    sim.agente.responder = () =>
      new Promise<ResultadoKb[]>((resolve) => {
        pendientes.push(() => resolve([DOCUMENTO]));
      });

    const tarea = buscarInvestigacion(contexto(sim), ['Pregunta 1', 'Pregunta 2', 'Pregunta 3']);
    await Promise.resolve();

    expect(sim.agente.llamadas).toHaveLength(3);
    expect(pendientes).toHaveLength(3);
    pendientes.forEach((resolver) => resolver());
    const resultado = await tarea;
    expect(resultado.rondasRealizadas).toBe(1);
    verificarLlamadas(sim);
  });

  it('sin pasajes en ninguna parte → NO_ANSWER sin llamar al modelo de síntesis', async () => {
    const sim = crearSimulados();
    sim.agente.responder = () => [];
    sim.bedrock.colaReformulaciones.push(
      JSON.stringify({ reformulada: 'Primera reformulada' }),
      JSON.stringify({ reformulada: 'Segunda reformulada' }),
    );

    const salida = await investigar(contexto(sim), ['Primera pregunta', 'Segunda pregunta']);

    expect(salida.status).toBe('NO_ANSWER');
    expect(salida.reply).toBe(MENSAJE_SIN_FUENTE);
    expect(salida.researchSteps).toEqual([
      { subpregunta: 'Primera pregunta', encontrado: false, reformulada: true, documentos: [] },
      { subpregunta: 'Segunda pregunta', encontrado: false, reformulada: true, documentos: [] },
    ]);
    expect(sim.bedrock.contar('respuesta')).toBe(0);
    expect(sim.agente.llamadas).toHaveLength(4);
    verificarLlamadas(sim);
  });

  it('una reformulación inválida no dispara un segundo Retrieve', async () => {
    const sim = crearSimulados();
    sim.agente.responder = (consulta) => (consulta === 'Con fuente' ? [DOCUMENTO] : []);
    sim.bedrock.colaReformulaciones.push('{"otro":"valor"}');
    sim.bedrock.colaRespuestas.push('Encontré el monto de viáticos [1]. No encontré la otra parte.');

    const salida = await investigar(contexto(sim), ['Con fuente', 'Sin fuente']);

    expect(salida.status).toBe('ANSWERED');
    expect(sim.agente.llamadas).toHaveLength(2);
    expect(salida.researchSteps?.[1]).toMatchObject({ encontrado: false, reformulada: false });
    verificarLlamadas(sim);
  });

  it('corta la búsqueda, conserva el pasaje terminado y sintetiza antes de 20 s', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-24T20:00:00.000Z'));
    const sim = crearSimulados();
    sim.agente.responder = (consulta) =>
      consulta === 'Con fuente'
        ? Promise.resolve([DOCUMENTO])
        : new Promise<ResultadoKb[]>((resolve) => setTimeout(() => resolve([]), LIMITE_INVESTIGACION_MS + 5_000));
    sim.bedrock.colaRespuestas.push('El viático nacional es de COP 280.000 por día [1].');
    const inicio = Date.now();

    const tarea = investigar(contexto(sim), ['Con fuente', 'Sin fuente']);
    await jest.advanceTimersByTimeAsync(LIMITE_INVESTIGACION_MS - 2_000);
    const salida = await tarea;

    expect(Date.now() - inicio).toBeLessThan(LIMITE_INVESTIGACION_MS);
    expect(salida.status).toBe('ANSWERED');
    expect(salida.reply).toContain('COP 280.000');
    expect(salida.reply).toContain('No encontré información para responder "Sin fuente".');
    expect(sim.agente.llamadas).toHaveLength(2);
    expect(sim.bedrock.colaReformulaciones).toHaveLength(0);
    expect(salida.researchSteps?.[0]).toMatchObject({ encontrado: true });
    expect(salida.researchSteps?.[1]).toMatchObject({ encontrado: false, reformulada: false });
    verificarLlamadas(sim);
    await jest.runOnlyPendingTimersAsync();
  });

  it('el corte duro también limita Converse y Guardrails de la síntesis', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-24T20:00:00.000Z'));
    const sim = crearSimulados();
    sim.agente.responder = () => [DOCUMENTO];
    const converseOriginal = sim.bedrock.converse.bind(sim.bedrock);
    sim.bedrock.converse = async (entrada: ConverseCommandInput) => {
      if (!entrada.system?.[0]?.text?.startsWith(MARCA_RESPUESTA)) return converseOriginal(entrada);
      sim.bedrock.llamadasConverse.push(entrada);
      return new Promise((resolve) => setTimeout(() => resolve({} as never), LIMITE_INVESTIGACION_MS + 5_000));
    };
    const inicio = Date.now();

    const tarea = investigar(contexto(sim), ['Pregunta 1', 'Pregunta 2']);
    await jest.advanceTimersByTimeAsync(LIMITE_INVESTIGACION_MS - 1);
    const salida = await tarea;

    expect(Date.now() - inicio).toBeLessThan(LIMITE_INVESTIGACION_MS);
    expect(salida.status).toBe('NO_ANSWER');
    expect(sim.bedrock.llamadasGuardrail).toHaveLength(0);
    verificarLlamadas(sim);
    await jest.runOnlyPendingTimersAsync();
  });

  it('el corte duro también limita un Guardrail de salida pendiente', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-24T20:00:00.000Z'));
    const sim = crearSimulados();
    sim.agente.responder = () => [DOCUMENTO];
    sim.bedrock.colaRespuestas.push('El viático nacional es de COP 280.000 por día [1].');
    sim.bedrock.applyGuardrail = async (entrada) => {
      const texto = (entrada.content?.[0] as { text?: { text?: string } } | undefined)?.text?.text ?? '';
      sim.bedrock.llamadasGuardrail.push({ fuente: String(entrada.source), texto });
      return new Promise((resolve) => setTimeout(() => resolve({ action: 'NONE' } as never), LIMITE_INVESTIGACION_MS + 5_000));
    };
    const inicio = Date.now();

    const tarea = investigar(contexto(sim), ['Pregunta 1', 'Pregunta 2']);
    await jest.advanceTimersByTimeAsync(LIMITE_INVESTIGACION_MS - 1);
    const salida = await tarea;

    expect(Date.now() - inicio).toBeLessThan(LIMITE_INVESTIGACION_MS);
    expect(salida.status).toBe('NO_ANSWER');
    expect(sim.bedrock.llamadasGuardrail).toHaveLength(1);
    verificarLlamadas(sim);
    await jest.runOnlyPendingTimersAsync();
  });

  it('researchSteps solo contiene subpregunta, estado y títulos; nunca el texto del pasaje', async () => {
    const sim = crearSimulados();
    sim.agente.responder = () => [DOCUMENTO];
    sim.bedrock.colaRespuestas.push('El viático nacional es de COP 280.000 por día [1].');

    const salida = await investigar(contexto(sim), ['¿Cuál es el viático?', '¿Cuánto pagan por día?']);

    const pasos = JSON.stringify(salida.researchSteps);
    expect(pasos).toContain('Política de viajes corporativos');
    expect(pasos).not.toContain('COP 280.000');
    expect(Object.keys(salida.researchSteps![0]).sort()).toEqual(
      ['documentos', 'encontrado', 'reformulada', 'subpregunta'].sort(),
    );
    verificarLlamadas(sim);
  });
});
