import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventBus } from '@ruan-diego/mini-event-contracts';
import {
  adicionarItem,
  alterarQuantidade,
  aplicarCupom,
  ErroDeApi,
  obterCarrinho,
  removerCupom,
  removerItem,
  type Carrinho,
  type ObterToken,
} from './api/carrinho';

export interface EstadoCarrinho {
  /** `erro` só vale para a carga inicial: sem carrinho nenhum para mostrar. Falha de uma ação vira `erroDeAcao`. */
  situacao: 'carregando' | 'erro' | 'pronto';
  carrinho: Carrinho | null;
  /** Há uma chamada em andamento. */
  ocupado: boolean;
  /** Motivo da última ação que falhou (ex.: "quantidade deve ficar entre 1 e 10"), para mostrar ao cliente. */
  erroDeAcao: string | null;
}

export interface AcoesCarrinho {
  recarregar: () => void;
  adicionar: (produtoId: string, quantidade: number) => Promise<void>;
  /** Otimista: a tela muda na hora e volta ao que o servidor confirmou por último se a chamada falhar. */
  alterar: (produtoId: string, quantidade: number) => Promise<void>;
  remover: (produtoId: string) => Promise<void>;
  /** Devolve o motivo da recusa (cupom inexistente, vencido, abaixo do mínimo...) ou null se aplicou. */
  aplicarCupom: (codigo: string) => Promise<string | null>;
  removerCupom: () => Promise<void>;
  dispensarErro: () => void;
}

function descreverErro(erro: unknown): string {
  if (erro instanceof ErroDeApi && erro.status >= 400 && erro.status < 500) return erro.message;
  return 'Não foi possível falar com o carrinho agora. Tente de novo em instantes.';
}

/** Projeção local, só para a tela responder na hora: o servidor recalcula e a resposta dele vale. */
function comQuantidade(carrinho: Carrinho, produtoId: string, quantidade: number): Carrinho {
  const itens = carrinho.itens.map((i) =>
    i.produtoId === produtoId ? { ...i, quantidade, subtotal: Math.round(i.precoUnitario * quantidade * 100) / 100 } : i,
  );
  const subtotal = Math.round(itens.reduce((s, i) => s + i.subtotal, 0) * 100) / 100;
  return {
    ...carrinho,
    itens,
    subtotal,
    quantidadeTotal: itens.reduce((s, i) => s + i.quantidade, 0),
    total: Math.round((subtotal - carrinho.desconto) * 100) / 100,
  };
}

/**
 * Estado do carrinho no servidor: carrega ao montar e depois de cada ação. Toda resposta traz o carrinho
 * inteiro (a fonte da verdade é o backend, que recalcula subtotal, desconto e total), e a cada resposta
 * este hook emite `carrinho:atualizado` para o badge do shell acompanhar, sem importar código de ninguém.
 *
 * O shell monta este MFE duas vezes (drawer e página), cada uma com o seu estado. Para não divergirem, quem
 * ouve `carrinho:atualizado` de outra instância recarrega do servidor (sem emitir de novo, senão uma
 * instância avisaria a outra para sempre).
 *
 * As ações entram numa fila: duas adições seguidas rodam uma depois da outra, então a resposta mais velha
 * nunca sobrescreve a mais nova.
 */
const CARRINHO_VAZIO: Carrinho = { itens: [], quantidadeTotal: 0, subtotal: 0, cupom: null, desconto: 0, total: 0 };

export function useCarrinho(eventBus: EventBus, obterToken: ObterToken): [EstadoCarrinho, AcoesCarrinho] {
  const [estado, setEstado] = useState<EstadoCarrinho>({ situacao: 'carregando', carrinho: null, ocupado: false, erroDeAcao: null });
  const [tentativa, setTentativa] = useState(0);
  const fila = useRef<Promise<void>>(Promise.resolve());
  const pendentes = useRef(0);
  const confirmado = useRef<Carrinho | null>(null);
  const emitindo = useRef(false);

  const aplicar = useCallback(
    (carrinho: Carrinho, avisar = true) => {
      confirmado.current = carrinho;
      setEstado((e) => ({ ...e, situacao: 'pronto', carrinho }));
      if (!avisar) return;
      emitindo.current = true;
      try {
        eventBus.emit('carrinho:atualizado', { quantidadeTotal: carrinho.quantidadeTotal, subtotal: carrinho.subtotal });
      } finally {
        emitindo.current = false;
      }
    },
    [eventBus],
  );

  // Carga inicial (e "tentar de novo"): também faz o badge mostrar o carrinho de uma visita anterior.
  useEffect(() => {
    const controle = new AbortController();
    obterCarrinho(obterToken, controle.signal).then((c) => aplicar(c), (erro: unknown) => {
      if (controle.signal.aborted) return;
      console.error('[mfe-carrinho] falha ao carregar o carrinho', erro);
      setEstado((e) => ({ ...e, situacao: e.carrinho ? e.situacao : 'erro' }));
    });
    return () => controle.abort();
  }, [obterToken, aplicar, tentativa]);

  const recarregar = useCallback(() => {
    setEstado((e) => ({ ...e, situacao: e.carrinho ? e.situacao : 'carregando' }));
    setTentativa((t) => t + 1);
  }, []);

  // Depois da compra o checkout avisa que o carrinho foi esvaziado. Vale o aviso: o estado local passa a ser vazio
  // sem consultar o servidor, porque ele esvazia o carrinho de forma assíncrona (consome PedidoCriado pela
  // outbox e pelo RabbitMQ) e uma consulta imediata ainda devolveria os itens da compra, fazendo o badge do
  // shell zerar e voltar a mostrar a quantidade antiga.
  useEffect(() => eventBus.on('carrinho:limpo', () => aplicar(CARRINHO_VAZIO)), [eventBus, aplicar]);

  // Outra instância mudou o carrinho: sincroniza sem emitir (ver o comentário do hook).
  useEffect(
    () =>
      eventBus.on('carrinho:atualizado', () => {
        if (emitindo.current) return;
        obterCarrinho(obterToken).then((c) => aplicar(c, false), () => {});
      }),
    [eventBus, obterToken, aplicar],
  );

  const executar = useCallback(
    (acao: () => Promise<Carrinho>, opcoes: { mostrarErro?: boolean; aoFalhar?: () => void } = {}): Promise<string | null> => {
      const { mostrarErro = true, aoFalhar } = opcoes;
      pendentes.current += 1;
      setEstado((e) => ({ ...e, ocupado: true, erroDeAcao: mostrarErro ? null : e.erroDeAcao }));
      const execucao = fila.current.then(async (): Promise<string | null> => {
        try {
          aplicar(await acao());
          return null;
        } catch (erro) {
          console.error('[mfe-carrinho] ação do carrinho falhou', erro);
          const motivo = descreverErro(erro);
          aoFalhar?.();
          if (mostrarErro) setEstado((e) => ({ ...e, erroDeAcao: motivo }));
          return motivo;
        } finally {
          pendentes.current -= 1;
          if (pendentes.current === 0) setEstado((e) => ({ ...e, ocupado: false }));
        }
      });
      fila.current = execucao.then(() => undefined);
      return execucao;
    },
    [aplicar],
  );

  const adicionar = useCallback(
    async (id: string, q: number) => void (await executar(() => adicionarItem(obterToken, id, q))),
    [executar, obterToken],
  );

  const alterar = useCallback(
    async (id: string, q: number) => {
      setEstado((e) => (e.carrinho ? { ...e, carrinho: comQuantidade(e.carrinho, id, q) } : e));
      await executar(() => alterarQuantidade(obterToken, id, q), {
        aoFalhar: () => setEstado((e) => ({ ...e, carrinho: confirmado.current ?? e.carrinho })),
      });
    },
    [executar, obterToken],
  );

  const remover = useCallback(async (id: string) => void (await executar(() => removerItem(obterToken, id))), [executar, obterToken]);

  const aplicarDoCupom = useCallback(
    (codigo: string) => executar(() => aplicarCupom(obterToken, codigo), { mostrarErro: false }),
    [executar, obterToken],
  );

  const removerDoCupom = useCallback(async () => void (await executar(() => removerCupom(obterToken))), [executar, obterToken]);

  const dispensarErro = useCallback(() => setEstado((e) => ({ ...e, erroDeAcao: null })), []);

  return [estado, { recarregar, adicionar, alterar, remover, aplicarCupom: aplicarDoCupom, removerCupom: removerDoCupom, dispensarErro }];
}
