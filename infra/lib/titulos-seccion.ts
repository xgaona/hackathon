// Valores que el CDK calcula al sintetizar y entrega al núcleo como variables de entorno.
import * as fs from 'fs';
import * as path from 'path';

/**
 * Títulos `##` de los documentos del corpus, sin repetidos, del más largo al más corto
 * y unidos con `|` (lección 7 de tecnologia.md). Carpeta inexistente → cadena vacía.
 */
export function titulosSeccion(carpeta: string): string {
  if (!fs.existsSync(carpeta)) {
    return '';
  }
  const titulos = new Set<string>();
  for (const archivo of fs.readdirSync(carpeta).filter((f) => f.endsWith('.md'))) {
    const texto = fs.readFileSync(path.join(carpeta, archivo), 'utf8');
    for (const linea of texto.split(/\r?\n/)) {
      const coincidencia = /^##\s+(.+?)\s*$/.exec(linea);
      if (coincidencia) {
        titulos.add(coincidencia[1]);
      }
    }
  }
  return [...titulos].sort((a, b) => b.length - a.length || a.localeCompare(b)).join('|');
}

/** `"true"` solo si el contexto `-c investigacion=true` está presente; en otro caso `"false"`. */
export function investigacionActiva(valorContexto: unknown): string {
  return valorContexto === true || valorContexto === 'true' ? 'true' : 'false';
}
