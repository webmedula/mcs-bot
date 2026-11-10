import type { Conector, Plataforma } from '../nucleo/tipos';
import { conectorMercadoLivre } from './mercadolivre/conector';

/** Plataformas ligadas. Para entrar outra (Shopee, Amazon...), escreva o conector e acrescente aqui. */
export const CONECTORES: Record<Plataforma, Conector> = {
  mercadolivre: conectorMercadoLivre,
};

export function conector(p: Plataforma): Conector {
  const c = CONECTORES[p];
  if (!c) throw new Error(`Plataforma sem conector: ${p}`);
  return c;
}
