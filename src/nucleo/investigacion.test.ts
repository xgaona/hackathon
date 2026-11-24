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
import { MENSAJE_SIN_FUENTE } from './respuesta';
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

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
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
  it('nunca supera 6 Retrieve ni 2 rondas', async () => {
    const sim = crearSimulados();
    sim.agente.responder = () => [];
    // Con 4 búsquedas iniciales solo quedan 2 cupos para la segunda ronda.
    sim.bedrock.colaReformulaciones.push(
      JSON.stringify({ reformulada: 'Reformulada 1' }),
      JSON.stringify({ reformulada: 'Reformulada 2' }),
    );

    const resultado = await buscarInvestigacion(contexto(sim), ['Pregunta 1', 'Pregunta 2', 'Pregunta 3', 'Pregunta 4']);

    expect(MAX_RONDAS).toBe(2);
    expect(resultado.retrieveRealizados).toBe(MAX_RETRIEVE);
    expect(sim.agente.llamadas).toHaveLength(MAX_RETRIEVE);
    expect(resultado.pasos.map((p) => p.reformulada)).toEqual([true, true, false, false]);
    expect(sim.bedrock.colaReformulaciones).toHaveLength(0);
    for (const llamada of sim.agente.llamadas) {
      expect(llamada.retrievalConfiguration?.vectorSearchConfiguration?.filter).toEqual(FILTRO_GENERAL);
      expect(llamada.retrievalConfiguration?.vectorSearchConfiguration?.numberOfResults).toBe(NUM_RESULTADOS);
    }
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
  });

  it('al agotarse los 20 s sintetiza con lo encontrado y no inicia la segunda ronda', async () => {
    const sim = crearSimulados();
    sim.agente.responder = (consulta) => (consulta === 'Con fuente' ? [DOCUMENTO] : []);
    const base = new Date('2026-11-24T15:00:00-05:00').getTime();
    let lecturasReloj = 0;
    sim.deps.ahora = () => new Date(base + (lecturasReloj++ < 2 ? 0 : LIMITE_INVESTIGACION_MS + 1));
    sim.bedrock.colaRespuestas.push('El viático nacional es de COP 280.000 por día [1]. No encontré el plazo solicitado.');

    const salida = await investigar(contexto(sim), ['Con fuente', 'Sin fuente']);

    expect(salida.status).toBe('ANSWERED');
    expect(salida.reply).toContain('COP 280.000');
    expect(sim.agente.llamadas).toHaveLength(2);
    expect(sim.bedrock.colaReformulaciones).toHaveLength(0);
    expect(salida.researchSteps?.[1]).toMatchObject({ encontrado: false, reformulada: false });
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
  });
});
