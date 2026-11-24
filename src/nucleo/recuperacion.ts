// Recuperación con Retrieve: filtro obligatorio, pasajes por sección y umbrales.
import type { RetrievalFilter } from '@aws-sdk/client-bedrock-agent-runtime';
import type { Pasaje } from '../comun/contrato';
import type { Contexto } from './tipos';

/** Único filtro de las consultas: nada restringido llega al modelo (invariante 6). */
export const FILTRO_GENERAL: RetrievalFilter = { equals: { key: 'classification', value: 'GENERAL' } };

export const NUM_RESULTADOS = 5;
export const UMBRAL_PREGUNTA = 0.5;
export const MARGEN_MEJOR = 0.1;
export const MAX_DOCUMENTOS = 3;

/** Un fragmento tal como lo devuelve Retrieve, ya normalizado. */
export interface Fragmento {
  texto: string;
  puntaje: number;
  documentId: string;
  title: string;
  updatedAt: string;
}

export interface Documento {
  documentId: string;
  title: string;
  updatedAt: string;
  puntaje: number;
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

export async function recuperar(ctx: Contexto, consulta: string): Promise<Fragmento[]> {
  const r = await ctx.deps.agente.retrieve({
    knowledgeBaseId: ctx.cfg.kbId,
    retrievalQuery: { text: consulta },
    retrievalConfiguration: {
      vectorSearchConfiguration: { numberOfResults: NUM_RESULTADOS, filter: FILTRO_GENERAL },
    },
  });
  const fragmentos: Fragmento[] = [];
  for (const res of r.retrievalResults ?? []) {
    const meta = (res.metadata ?? {}) as Record<string, unknown>;
    // Segunda barrera: solo contenido GENERAL.
    if (meta.classification !== 'GENERAL') continue;
    const documentId = texto(meta.documentId);
    const title = texto(meta.title);
    const contenido = res.content?.text ?? '';
    if (!documentId || !title || !contenido) continue;
    fragmentos.push({
      texto: contenido,
      puntaje: typeof res.score === 'number' ? res.score : 0,
      documentId,
      title,
      updatedAt: texto(meta.updatedAt),
    });
  }
  return fragmentos;
}

/**
 * Parte un fragmento por "##". El parser junta las líneas ("## Viáticos El viático…"), así que
 * el título se separa con la lista de títulos del corpus (del más largo al más corto).
 */
export function partirPorSecciones(contenido: string, titulos: string[]): { seccion?: string; texto: string }[] {
  const trozos = contenido.split(/(?:^|\s)##\s+/);
  if (trozos.length === 1) return contenido.trim() ? [{ texto: contenido.trim() }] : [];
  const pasajes: { seccion?: string; texto: string }[] = [];
  const preambulo = trozos[0].trim();
  // Un preámbulo que empieza con "#" es solo el título del documento.
  if (preambulo && !preambulo.startsWith('#')) pasajes.push({ texto: preambulo });
  for (const trozo of trozos.slice(1)) {
    const limpio = trozo.trim();
    if (!limpio) continue;
    const titulo = titulos.find((t) => limpio.startsWith(t) && (limpio.length === t.length || /\s/.test(limpio[t.length])));
    if (titulo) {
      const resto = limpio.slice(titulo.length).trim();
      if (resto) pasajes.push({ seccion: titulo, texto: resto });
      continue;
    }
    const salto = limpio.indexOf('\n');
    if (salto > 0) {
      const resto = limpio.slice(salto + 1).trim();
      if (resto) pasajes.push({ seccion: limpio.slice(0, salto).trim(), texto: resto });
    } else {
      pasajes.push({ texto: limpio });
    }
  }
  return pasajes;
}

/** Puntaje mínimo y a menos de `margen` del mejor. */
export function filtrarPorUmbral(pasajes: Pasaje[], umbral = UMBRAL_PREGUNTA, margen = MARGEN_MEJOR): Pasaje[] {
  const validos = pasajes.filter((p) => p.puntaje >= umbral);
  if (validos.length === 0) return [];
  const mejor = Math.max(...validos.map((p) => p.puntaje));
  return validos.filter((p) => mejor - p.puntaje < margen).sort((a, b) => b.puntaje - a.puntaje);
}

export async function buscarPasajes(ctx: Contexto, consulta: string): Promise<Pasaje[]> {
  const fragmentos = await recuperar(ctx, consulta);
  const pasajes: Pasaje[] = fragmentos.flatMap((f) =>
    partirPorSecciones(f.texto, ctx.cfg.titulosSeccion).map(
      (p): Pasaje => ({
        texto: p.texto,
        puntaje: f.puntaje,
        documentId: f.documentId,
        title: f.title,
        seccion: p.seccion,
        updatedAt: f.updatedAt,
      }),
    ),
  );
  return filtrarPorUmbral(pasajes);
}

/** Búsqueda de documentos: umbral propio y un resultado por documentId. */
export async function buscarDocumentos(ctx: Contexto, tema: string): Promise<Documento[]> {
  const fragmentos = await recuperar(ctx, `Documento sobre ${tema}`);
  const porId = new Map<string, Documento>();
  for (const f of fragmentos) {
    if (f.puntaje < ctx.cfg.umbralDocumento) continue;
    const previo = porId.get(f.documentId);
    if (!previo || f.puntaje > previo.puntaje) {
      porId.set(f.documentId, { documentId: f.documentId, title: f.title, updatedAt: f.updatedAt, puntaje: f.puntaje });
    }
  }
  return [...porId.values()].sort((a, b) => b.puntaje - a.puntaje).slice(0, MAX_DOCUMENTOS);
}
