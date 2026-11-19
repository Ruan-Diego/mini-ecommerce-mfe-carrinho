/**
 * Cliente HTTP do carrinho-service, sempre pelo gateway (VITE_API_URL aponta para a rota do carrinho,
 * ex.: http://localhost:8080/api/carrinho). O MFE chama só o próprio serviço.
 *
 * Quem pede: o visitante é identificado por um id de sessão que o navegador gera e guarda (header
 * X-Sessao-Id); o cliente logado manda o token (Authorization: Bearer). Hoje o backend só entende a sessão,
 * e o token passa a valer quando o login chegar (Fase 3): este arquivo já manda os dois.
 */

export interface ItemCarrinho {
  produtoId: string;
  nome: string;
  precoUnitario: number;
  quantidade: number;
  subtotal: number;
  /** O preço mudou desde que o cliente viu o item; `precoUnitario` é o valor atual. */
  precoAlterado: boolean;
  /** Valor que o cliente tinha visto antes da mudança (nulo se o preço não mudou). */
  precoAnterior: number | null;
}

export interface CupomAplicado {
  codigo: string;
  tipo: 'PERCENTUAL' | 'VALOR_FIXO';
  valor: number;
  validoAte: string;
  valorMinimo: number;
}

export interface Carrinho {
  itens: ItemCarrinho[];
  quantidadeTotal: number;
  subtotal: number;
  cupom: CupomAplicado | null;
  desconto: number;
  total: number;
}

/** Erro de HTTP com a explicação que o backend mandou (problem+json: título e detalhe). */
export class ErroDeApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** Fonte do token do shell (`props.getToken`): null enquanto não há login. */
export type ObterToken = () => Promise<string | null>;

const CHAVE_SESSAO = 'mini:sessao';

const baseUrl = () => (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

function novoId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Id de sessão do visitante, gerado na primeira vez e guardado no navegador para o carrinho sobreviver
 * a recarregar a página (no servidor ele expira em 7 dias sem uso). Sem localStorage (modo privado, por
 * exemplo), o id vale só até recarregar.
 */
let sessaoEmMemoria: string | null = null;
export function idDaSessao(): string {
  try {
    const guardado = localStorage.getItem(CHAVE_SESSAO);
    if (guardado) return guardado;
    const novo = novoId();
    localStorage.setItem(CHAVE_SESSAO, novo);
    return novo;
  } catch {
    sessaoEmMemoria ??= novoId();
    return sessaoEmMemoria;
  }
}

async function chamar(
  metodo: 'GET' | 'POST' | 'PUT' | 'DELETE',
  caminho: string,
  obterToken: ObterToken,
  corpo?: unknown,
  sinal?: AbortSignal,
): Promise<Carrinho> {
  const cabecalhos: Record<string, string> = { Accept: 'application/json', 'X-Sessao-Id': idDaSessao() };
  const token = await obterToken();
  if (token) cabecalhos.Authorization = `Bearer ${token}`;
  if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';

  const resposta = await fetch(`${baseUrl()}${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: sinal,
  });
  if (!resposta.ok) throw new ErroDeApi(resposta.status, await mensagemDoErro(resposta));
  return (await resposta.json()) as Carrinho;
}

/** Texto para mostrar ao cliente: o `detail` do problem+json quando existe, senão uma frase genérica. */
async function mensagemDoErro(resposta: Response): Promise<string> {
  try {
    const problema = (await resposta.json()) as { detail?: string };
    if (problema.detail) return problema.detail;
  } catch {
    // corpo vazio ou que não é JSON: cai na frase genérica
  }
  return `o carrinho respondeu HTTP ${resposta.status}`;
}

export const obterCarrinho = (obterToken: ObterToken, sinal?: AbortSignal) =>
  chamar('GET', '/carrinhos/atual', obterToken, undefined, sinal);

export const adicionarItem = (obterToken: ObterToken, produtoId: string, quantidade: number) =>
  chamar('POST', '/carrinhos/atual/itens', obterToken, { produtoId, quantidade });

export const alterarQuantidade = (obterToken: ObterToken, produtoId: string, quantidade: number) =>
  chamar('PUT', `/carrinhos/atual/itens/${encodeURIComponent(produtoId)}`, obterToken, { quantidade });

export const removerItem = (obterToken: ObterToken, produtoId: string) =>
  chamar('DELETE', `/carrinhos/atual/itens/${encodeURIComponent(produtoId)}`, obterToken);
