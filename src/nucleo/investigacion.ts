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
const MARGEN_SINTESIS_MS = 2_000;

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
  rondasRealizadas: number;
  agotadoTiempo: boolean;
}

const ajv = new Ajv({ strict: true });
const validarReformulacion = ajv.compile({
  type: 'object',
  additionalProperties: false,
  required: ['reformulada'],
  properties: { reformulada: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' } },
});

interface ResultadoFase {
  completa: boolean;
  lanzadas: number;
}

/** Espera una fase hasta el plazo; al vencer, las promesas pendientes ya no modifican el resultado. */
async function esperarFase(tareas: Promise<void>[], plazoMs: number, cerrar: () => void): Promise<boolean> {
  if (tareas.length === 0) return true;
  const restanteMs = plazoMs - Date.now();
  if (restanteMs <= 0) {
    cerrar();
    return false;
  }
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const completa = Promise.all(tareas).then(() => true);
  const vence = new Promise<boolean>((resolve) => {
    temporizador = setTimeout(() => resolve(false), restanteMs);
  });
  try {
    return await Promise.race([completa, vence]);
  } finally {
    if (temporizador) clearTimeout(temporizador);
    cerrar();
  }
}

async function esperarResultado<T>(tarea: Promise<T>, plazoMs: number): Promise<T | undefined> {
  const restanteMs = plazoMs - Date.now();
  if (restanteMs <= 0) return undefined;
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const completa = tarea.then((valor) => ({ completa: true as const, valor }));
  const vence = new Promise<{ completa: false }>((resolve) => {
    temporizador = setTimeout(() => resolve({ completa: false }), restanteMs);
  });
  const resultado = await Promise.race([completa, vence]);
  if (temporizador) clearTimeout(temporizador);
  return resultado.completa ? resultado.valor : undefined;
}

async function buscarRonda(
  ctx: Contexto,
  bloques: BloqueInvestigacion[],
  indices: number[],
  plazoBusquedaMs: number,
  contador: { valor: number },
): Promise<ResultadoFase> {
  if (Date.now() >= plazoBusquedaMs) return { completa: false, lanzadas: 0 };
  const cupo = Math.max(0, MAX_RETRIEVE - contador.valor);
  const seleccion = indices.slice(0, cupo);
  contador.valor += seleccion.length;
  let aceptar = true;
  const tareas = seleccion.map(async (indice) => {
    const pasajes = await buscarPasajes(ctx, bloques[indice].consulta);
    if (aceptar) bloques[indice].pasajes = pasajes;
  });
  const completa = await esperarFase(tareas, plazoBusquedaMs, () => {
    aceptar = false;
  });
  return { completa, lanzadas: seleccion.length };
}

async function reformular(
  ctx: Contexto,
  bloques: BloqueInvestigacion[],
  indices: number[],
  plazoBusquedaMs: number,
): Promise<number[]> {
  if (Date.now() >= plazoBusquedaMs) return [];
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
  await esperarFase(tareas, plazoBusquedaMs, () => {
    aceptar = false;
  });
  return validas.sort((a, b) => a - b);
}

/** Dos rondas como máximo; cada subpregunta se reformula como máximo una vez. */
export async function buscarInvestigacion(
  ctx: Contexto,
  subpreguntas: string[],
  inicioMs = Date.now(),
): Promise<ResultadoBusquedaInvestigacion> {
  const plazoBusquedaMs = inicioMs + LIMITE_INVESTIGACION_MS - MARGEN_SINTESIS_MS;
  const bloques: BloqueInvestigacion[] = subpreguntas.map((subpregunta) => ({
    subpregunta,
    consulta: subpregunta,
    pasajes: [],
    reformulada: false,
  }));
  const contador = { valor: 0 };
  let rondasRealizadas = 0;
  const primera = bloques.map((_, i) => i);
  const resultadoPrimera = await buscarRonda(ctx, bloques, primera, plazoBusquedaMs, contador);
  if (resultadoPrimera.lanzadas > 0) rondasRealizadas++;

  if (resultadoPrimera.completa && rondasRealizadas < MAX_RONDAS && Date.now() < plazoBusquedaMs) {
    const sinFuente = bloques
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => b.pasajes.length === 0 && !b.reformulada)
      .map(({ i }) => i);
    // Solo se reformulan las partes para las que queda cupo de Retrieve; el máximo global manda.
    const conCupo = sinFuente.slice(0, Math.max(0, MAX_RETRIEVE - contador.valor));
    const reformuladas = await reformular(ctx, bloques, conCupo, plazoBusquedaMs);
    if (reformuladas.length > 0 && Date.now() < plazoBusquedaMs) {
      const resultadoSegunda = await buscarRonda(ctx, bloques, reformuladas, plazoBusquedaMs, contador);
      if (resultadoSegunda.lanzadas > 0) rondasRealizadas++;
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
    rondasRealizadas,
    agotadoTiempo: Date.now() >= plazoBusquedaMs,
  };
}

function consultaParaSintesis(bloques: BloqueInvestigacion[]): string {
  return bloques
    .map((b, i) => `${i + 1}. ${b.subpregunta}${b.pasajes.length === 0 ? ' [SIN FUENTE]' : ''}`)
    .join('\n');
}

function completarPartesSinFuente(texto: string, bloques: BloqueInvestigacion[]): string {
  const sinFuente = bloques.filter((b) => b.pasajes.length === 0);
  const yaIncluidas = texto.match(/(?:^|[.!?]\s+|\n)No encontré\b/g)?.length ?? 0;
  const faltantes = sinFuente.slice(yaIncluidas).map((b) => `No encontré información para responder "${b.subpregunta}".`);
  return faltantes.length > 0 ? `${texto.trim()} ${faltantes.join(' ')}` : texto;
}

/** Busca y sintetiza una pregunta compuesta sin exponer pasajes en researchSteps ni logs. */
export async function investigar(ctx: Contexto, subpreguntas: string[]): Promise<Salida> {
  const inicioMs = Date.now();
  const resultado = await buscarInvestigacion(ctx, subpreguntas, inicioMs);
  if (resultado.pasajes.length === 0) {
    return { status: 'NO_ANSWER', reply: MENSAJE_SIN_FUENTE, researchSteps: resultado.pasos };
  }
  const reglas =
    'Responde cada subpregunta en el orden indicado. Por cada subpregunta marcada SIN FUENTE, incluye una frase que empiece exactamente con "No encontré" y nombra lo que no encontraste. ' +
    'No atribuyas a una parte los pasajes de otra parte.';
  const plazoFinalMs = inicioMs + LIMITE_INVESTIGACION_MS - 1;
  if (Date.now() >= plazoFinalMs) {
    return { status: 'NO_ANSWER', reply: MENSAJE_SIN_FUENTE, researchSteps: resultado.pasos };
  }
  const tarea = responderConocimiento(
    ctx,
    consultaParaSintesis(resultado.bloques),
    resultado.pasajes,
    reglas,
    (texto) => completarPartesSinFuente(texto, resultado.bloques),
  );
  const respuesta = await esperarResultado(tarea, plazoFinalMs);
  if (!respuesta?.ok) {
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
