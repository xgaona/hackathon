// Fechas en America/Bogota, con nombres de días y meses en español.
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const FORMATO_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Fecha de hoy en Bogotá como AAAA-MM-DD. */
export function hoyBogota(ahora: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}

function aUtc(iso: string): Date {
  const m = FORMATO_ISO.exec(iso);
  if (!m) throw new Error('FECHA_INVALIDA');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
}

export function esFechaValida(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false;
  const m = FORMATO_ISO.exec(valor);
  if (!m) return false;
  const d = aUtc(valor);
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function sumarDias(iso: string, dias: number): string {
  const d = aUtc(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** "jueves 26 de noviembre de 2026 (2026-11-26)" */
export function fechaLegible(iso: string): string {
  const d = aUtc(iso);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()} (${iso})`;
}

export function esPasada(iso: string, ahora: Date): boolean {
  return iso < hoyBogota(ahora);
}

/** Hoy y los 7 días siguientes, con el nombre de cada día. */
export function calendario8Dias(ahora: Date): string[] {
  const hoy = hoyBogota(ahora);
  return Array.from({ length: 8 }, (_, i) => fechaLegible(sumarDias(hoy, i)));
}
