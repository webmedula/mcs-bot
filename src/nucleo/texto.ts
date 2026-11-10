/** Ferramentas de texto para comparar perguntas escritas de jeitos diferentes. */

const STOPWORDS = new Set(
  (
    'a o as os um uma uns umas de da do das dos e é em no na nos nas para pra pro por com sem se que ' +
    'qual quais me te ele ela eu voce voces vc vcs ja mais mas ou isso esse essa este esta aqui ai ' +
    'boa bom dia tarde noite ola oi obrigado obrigada grato grata favor por tudo bem amigo amiga ' +
    'gostaria saber queria quero preciso sobre ao aos tem ter sera seria fica ser como'
  ).split(/\s+/),
);

/** minúsculas, sem acento, sem pontuação, espaços simples. */
export function normalizar(texto: string): string {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palavras que carregam sentido (sem as de ligação nem cumprimentos). */
export function palavras(texto: string): string[] {
  return normalizar(texto)
    .split(' ')
    .filter((p) => p.length > 1 && !STOPWORDS.has(p));
}

/** Semelhança de Jaccard entre os conjuntos de palavras (0 a 1). */
export function semelhanca(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const sa = new Set(a);
  const sb = new Set(b);
  let comum = 0;
  for (const p of sa) if (sb.has(p)) comum++;
  return comum / (sa.size + sb.size - comum);
}
