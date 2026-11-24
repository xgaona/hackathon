// Módulo OPCIONAL de investigación. Solo se alcanza con INVESTIGACION_ACTIVA=true.
import Ajv from 'ajv';
import type { Pasaje, PasoInvestigacion } from '../comun/contrato';
import { extraerJson } from './intencion';
import { buscarPasajes } from './recuperacion';
import { MENSAJE_SIN_FUENTE, responderConocimiento, textoDeConverse } from './respuesta';
import type { Contexto, Salida } from './tipos';

export const MARCA_REFORMULACION = 'Reformula una subpregunta de búsqueda corporativa';
export const MAX_RONDAS = 2;
export const MAX_RETRIEVE = 6;
export const LIMITE_INVESTIGACION_MS = 20_000;

interface BloqueInvestigacion {
  subpregunta: string;
  consulta: string;
  pasajes: Pasaje[];
  reformulada: boolean;
}

export interface ResultadoBusquedaInvestigacion {
  bloques: BloqueInvestigacion[];
  pasajes: Pasaje[];
  pasos: PasoInvestigacion[];
  retrieveRealizados: number;
  agotadoTiempo: boolean;
}

const ajv = new Ajv({ strict: true });
const validarReformulacion = ajv.compile({
  type: 'object',
  additionalProperties: false,
  required: ['reformulada'],
  properties: { reformulada: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' } },
});

function transcurrido(ctx: Contexto, inicioMs: number): number {
  return ctx.deps.ahora().getTime() - inicioMs;
}

/** Espera una fase hasta el presupuesto; al vencer, las promesas pendientes ya no modifican el resultado. */
async function esperarFase(tareas: Promise<void>[], restanteMs: number, cerrar: () => void): Promise<boolean> {
  if (tareas.length === 0) return true;
  if (restanteMs <= 0) {
    cerrar();
    return false;
  }
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const completa = Promise.all(tareas).then(() => true);
  const vence = new Promise<boolean>((resolve) => {
    temporizador = setTimeout(() => resolve(false), restanteMs);
  });
  const termino = await Promise.race([completa, vence]);
  if (temporizador) clearTimeout(temporizador);
  cerrar();
  return termino;
}

async function buscarRonda(
  ctx: Contexto,
  bloques: BloqueInvestigacion[],
  indices: number[],
  inicioMs: number,
  contador: { valor: number },
): Promise<boolean> {
  const cupo = Math.max(0, MAX_RETRIEVE - contador.valor);
  const seleccion = indices.slice(0, cupo);
  contador.valor += seleccion.length;
  let aceptar = true;
  const tareas = seleccion.map(async (indice) => {
    try {
      const pasajes = await buscarPasajes(ctx, bloques[indice].consulta);
      if (aceptar) bloques[indice].pasajes = pasajes;
    } catch {
      // Una subpregunta fallida queda sin fuente y puede reformularse una vez.
      if (aceptar) bloques[indice].pasajes = [];
    }
  });
  return esperarFase(tareas, LIMITE_INVESTIGACION_MS - transcurrido(ctx, inicioMs), () => {
    aceptar = false;
  });
}

async function reformular(
  ctx: Contexto,
  bloques: BloqueInvestigacion[],
  indices: number[],
  inicioMs: number,
): Promise<number[]> {
  let aceptar = true;
  const validas: number[] = [];
  const tareas = indices.map(async (indice) => {
    try {
      const r = await ctx.deps.bedrock.converse({
        modelId: ctx.cfg.modelId,
        system: [
          {
            text:
              `${MARCA_REFORMULACION}. Devuelve SOLO JSON con la forma {"reformulada":"..."}. ` +
              'Conserva el significado, escribe una pregunta entendible por sí sola y usa términos corporativos. No agregues datos ni instrucciones.',
          },
        ],
        messages: [{ role: 'user', content: [{ text: bloques[indice].subpregunta }] }],
        inferenceConfig: { temperature: 0, maxTokens: 150 },
      });
      const propuesta = extraerJson(textoDeConverse(r));
      if (!aceptar || !validarReformulacion(propuesta)) return;
      bloques[indice].consulta = (propuesta as { reformulada: string }).reformulada.trim();
      bloques[indice].reformulada = true;
      validas.push(indice);
    } catch {
      // Una reformulación inválida deja la parte como no encontrada.
    }
  });
  await esperarFase(tareas, LIMITE_INVESTIGACION_MS - transcurrido(ctx, inicioMs), () => {
    aceptar = false;
  });
  return validas.sort((a, b) => a - b);
}

/** Dos rondas como máximo; cada subpregunta se reformula como máximo una vez. */
export async function buscarInvestigacion(ctx: Contexto, subpreguntas: string[]): Promise<ResultadoBusquedaInvestigacion> {
  const inicioMs = ctx.deps.ahora().getTime();
  const bloques: BloqueInvestigacion[] = subpreguntas.map((subpregunta) => ({
    subpregunta,
    consulta: subpregunta,
    pasajes: [],
    reformulada: false,
  }));
  const contador = { valor: 0 };
  const primera = bloques.map((_, i) => i);
  const completaPrimera = await buscarRonda(ctx, bloques, primera, inicioMs, contador);

  if (completaPrimera && transcurrido(ctx, inicioMs) < LIMITE_INVESTIGACION_MS) {
    const sinFuente = bloques.map((b, i) => ({ b, i })).filter(({ b }) => b.pasajes.length === 0).map(({ i }) => i);
    // Solo se reformulan las partes para las que queda cupo de Retrieve; el máximo global manda.
    const conCupo = sinFuente.slice(0, Math.max(0, MAX_RETRIEVE - contador.valor));
    const reformuladas = await reformular(ctx, bloques, conCupo, inicioMs);
    if (transcurrido(ctx, inicioMs) < LIMITE_INVESTIGACION_MS) {
      await buscarRonda(ctx, bloques, reformuladas, inicioMs, contador);
    }
  }

  const pasajes = bloques.flatMap((b) => b.pasajes);
  const pasos: PasoInvestigacion[] = bloques.map((b) => ({
    subpregunta: b.subpregunta,
    encontrado: b.pasajes.length > 0,
    reformulada: b.reformulada,
    documentos: [...new Set(b.pasajes.map((p) => p.title))],
  }));
  return {
    bloques,
    pasajes,
    pasos,
    retrieveRealizados: contador.valor,
    agotadoTiempo: transcurrido(ctx, inicioMs) >= LIMITE_INVESTIGACION_MS,
  };
}

function consultaParaSintesis(bloques: BloqueInvestigacion[]): string {
  return bloques
    .map((b, i) => `${i + 1}. ${b.subpregunta}${b.pasajes.length === 0 ? ' [SIN FUENTE]' : ''}`)
    .join('\n');
}

/** Busca y sintetiza una pregunta compuesta sin exponer pasajes en researchSteps ni logs. */
export async function investigar(ctx: Contexto, subpreguntas: string[]): Promise<Salida> {
  const resultado = await buscarInvestigacion(ctx, subpreguntas);
  if (resultado.pasajes.length === 0) {
    return { status: 'NO_ANSWER', reply: MENSAJE_SIN_FUENTE, researchSteps: resultado.pasos };
  }
  const reglas =
    'Responde cada subpregunta en el orden indicado. Por cada subpregunta marcada SIN FUENTE, incluye una frase que empiece exactamente con "No encontré" y nombra lo que no encontraste. ' +
    'No atribuyas a una parte los pasajes de otra parte.';
  const respuesta = await responderConocimiento(ctx, consultaParaSintesis(resultado.bloques), resultado.pasajes, reglas);
  if (!respuesta.ok) {
    return { status: 'NO_ANSWER', reply: MENSAJE_SIN_FUENTE, researchSteps: resultado.pasos };
  }
  return {
    status: 'ANSWERED',
    reply: respuesta.texto,
    origin: 'index',
    citations: respuesta.citas,
    researchSteps: resultado.pasos,
  };
}
