import { createHash, timingSafeEqual } from 'node:crypto';

export function sha256Hex(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

/** JSON con las claves ordenadas, para que el hash no dependa del orden de inserción. */
export function jsonCanonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`;
  if (valor !== null && typeof valor === 'object') {
    const objeto = valor as Record<string, unknown>;
    const claves = Object.keys(objeto)
      .filter((k) => objeto[k] !== undefined)
      .sort();
    return `{${claves.map((k) => `${JSON.stringify(k)}:${jsonCanonico(objeto[k])}`).join(',')}}`;
  }
  return JSON.stringify(valor);
}

/** Comparación en tiempo constante de dos textos. */
export function igualesSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
