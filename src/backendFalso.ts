/** Só para testes: carrinho-service de mentira, em memória, que responde como o de verdade. */
import type { Carrinho, CupomAplicado, ItemCarrinho } from './api/carrinho';

export const CATALOGO: Record<string, { nome: string; preco: number }> = {
  p1: { nome: 'Esfera Chrome', preco: 100 },
  p2: { nome: 'Cubo Preto', preco: 50 },
};

/** Cupons que o backend falso conhece (percentual com mínimo, um vencido). */
const CUPONS: Record<string, { cupom: CupomAplicado; recusa?: string }> = {
  DEZ: { cupom: { codigo: 'DEZ', tipo: 'PERCENTUAL', valor: 10, validoAte: '2030-12-31T23:59:59Z', valorMinimo: 0 } },
  VENCIDO: { cupom: { codigo: 'VENCIDO', tipo: 'PERCENTUAL', valor: 10, validoAte: '2020-01-01T00:00:00Z', valorMinimo: 0 }, recusa: 'cupom VENCIDO vencido' },
  GRANDE: { cupom: { codigo: 'GRANDE', tipo: 'PERCENTUAL', valor: 10, validoAte: '2030-12-31T23:59:59Z', valorMinimo: 1000 }, recusa: 'cupom GRANDE exige subtotal mínimo de R$ 1000,00' },
};

export interface Chamada {
  metodo: string;
  caminho: string;
  cabecalhos: Record<string, string>;
  corpo: unknown;
}

export function backend(inicial: { itens?: ItemCarrinho[]; cupom?: CupomAplicado; desconto?: number } = {}) {
  const estado = {
    itens: inicial.itens ?? [],
    cupom: inicial.cupom ?? null,
    desconto: inicial.desconto ?? 0,
    falhaNaCarga: false,
    /** Falha só as chamadas de alteração (PUT) com este status, para provar a reversão otimista. */
    falhaNoPut: null as number | null,
  };
  const chamadas: Chamada[] = [];

  const recalcularDesconto = () => {
    const subtotal = estado.itens.reduce((s, i) => s + i.subtotal, 0);
    estado.desconto = estado.cupom ? Math.round(subtotal * estado.cupom.valor) / 100 : 0;
  };
  const montar = (): Carrinho => {
    const subtotal = estado.itens.reduce((s, i) => s + i.subtotal, 0);
    return {
      itens: estado.itens,
      quantidadeTotal: estado.itens.reduce((s, i) => s + i.quantidade, 0),
      subtotal,
      cupom: estado.cupom,
      desconto: estado.desconto,
      total: subtotal - estado.desconto,
    };
  };
  const json = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status });
  const problema = (status: number, detail: string) => json(status, { title: 'erro', detail });
  const item = (id: string, quantidade: number): ItemCarrinho => ({
    produtoId: id, nome: CATALOGO[id].nome, precoUnitario: CATALOGO[id].preco, quantidade,
    subtotal: CATALOGO[id].preco * quantidade, precoAlterado: false, precoAnterior: null,
  });

  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const caminho = new URL(url, 'http://gateway').pathname;
    const metodo = init.method ?? 'GET';
    const corpo = init.body ? JSON.parse(init.body as string) : undefined;
    chamadas.push({ metodo, caminho, cabecalhos: init.headers as Record<string, string>, corpo });

    if (caminho.endsWith('/cupom')) {
      if (metodo === 'DELETE') {
        estado.cupom = null;
        estado.desconto = 0;
        return json(200, montar());
      }
      const conhecido = CUPONS[String(corpo.codigo).trim().toUpperCase()];
      if (!conhecido) return problema(404, `cupom ${corpo.codigo} não existe`);
      if (conhecido.recusa) return problema(422, conhecido.recusa);
      estado.cupom = conhecido.cupom;
      recalcularDesconto();
      return json(200, montar());
    }
    if (metodo === 'GET') return estado.falhaNaCarga ? json(500, {}) : json(200, montar());
    if (metodo === 'POST') {
      if (!CATALOGO[corpo.produtoId]) return problema(404, `produto ${corpo.produtoId} não existe ou está inativo`);
      const atual = estado.itens.find((i) => i.produtoId === corpo.produtoId);
      const total = (atual?.quantidade ?? 0) + corpo.quantidade;
      if (total > 10) return problema(422, `quantidade deve ficar entre 1 e 10 por item: ${total}`);
      estado.itens = atual ? estado.itens.map((i) => (i === atual ? item(i.produtoId, total) : i)) : [...estado.itens, item(corpo.produtoId, total)];
      recalcularDesconto();
      return json(200, montar());
    }
    const id = decodeURIComponent(caminho.split('/').pop() ?? '');
    if (metodo === 'PUT') {
      if (estado.falhaNoPut) return problema(estado.falhaNoPut, 'quantidade deve ficar entre 1 e 10 por item: 11');
      estado.itens = estado.itens.map((i) => (i.produtoId === id ? item(id, corpo.quantidade) : i));
      recalcularDesconto();
      return json(200, montar());
    }
    estado.itens = estado.itens.filter((i) => i.produtoId !== id);
    recalcularDesconto();
    return json(200, montar());
  }));

  return { estado, chamadas, item };
}
