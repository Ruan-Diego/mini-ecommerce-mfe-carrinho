import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventBus } from '@ruan-diego/mini-event-contracts';
import {
  adicionarItem,
  alterarQuantidade,
  ErroDeApi,
  obterCarrinho,
  removerItem,
  type Carrinho,
  type ObterToken,
} from './api/carrinho';

export interface EstadoCarrinho {
  /** `erro` só vale para a carga inicial: sem carrinho nenhum para mostrar. Falha de uma ação vira `erroDeAcao`. */
  situacao: 'carregando' | 'erro' | 'pronto';
  carrinho: Carrinho | null;
  /** Há uma chamada em andamento (a tela desabilita os controles para não atropelar respostas). */
  ocupado: boolean;
  /** Motivo da última ação que falhou (ex.: "quantidade deve ficar entre 1 e 10"), para mostrar ao cliente. */
  erroDeAcao: string | null;
}

export interface AcoesCarrinho {
  recarregar: () => void;
  adicionar: (produtoId: string, quantidade: number) => Promise<void>;
  alterar: (produtoId: string, quantidade: number) => Promise<void>;
  remover: (produtoId: string) => Promise<void>;
  dispensarErro: () => void;
}

function descreverErro(erro: unknown): string {
  if (erro instanceof ErroDeApi && erro.status >= 400 && erro.status < 500) return erro.message;
  return 'Não foi possível falar com o carrinho agora. Tente de novo em instantes.';
}

/**
 * Estado do carrinho no servidor: carrega ao montar e depois de cada ação. Toda resposta traz o carrinho
 * inteiro (a fonte da verdade é o backend, que recalcula subtotal, desconto e total), e a cada resposta
 * este hook emite `carrinho:atualizado` para o badge do shell acompanhar, sem importar código de ninguém.
 *
 * As ações entram numa fila: duas adições seguidas (clique rápido, dois eventos) rodam uma depois da outra,
 * então a resposta mais velha nunca sobrescreve a mais nova.
 */
export function useCarrinho(eventBus: EventBus, obterToken: ObterToken): [EstadoCarrinho, AcoesCarrinho] {
  const [estado, setEstado] = useState<EstadoCarrinho>({ situacao: 'carregando', carrinho: null, ocupado: false, erroDeAcao: null });
  const [tentativa, setTentativa] = useState(0);
  const fila = useRef<Promise<void>>(Promise.resolve());
  const pendentes = useRef(0);

  const aplicar = useCallback(
    (carrinho: Carrinho) => {
      setEstado((e) => ({ ...e, situacao: 'pronto', carrinho }));
      eventBus.emit('carrinho:atualizado', { quantidadeTotal: carrinho.quantidadeTotal, subtotal: carrinho.subtotal });
    },
    [eventBus],
  );

  // Carga inicial (e "tentar de novo"): também faz o badge mostrar o carrinho de uma visita anterior.
  useEffect(() => {
    const controle = new AbortController();
    obterCarrinho(obterToken, controle.signal).then(aplicar, (erro: unknown) => {
      if (controle.signal.aborted) return;
      console.error('[mfe-carrinho] falha ao carregar o carrinho', erro);
      setEstado((e) => ({ ...e, situacao: 'erro' }));
    });
    return () => controle.abort();
  }, [obterToken, aplicar, tentativa]);

  const recarregar = useCallback(() => {
    setEstado((e) => ({ ...e, situacao: e.carrinho ? e.situacao : 'carregando' }));
    setTentativa((t) => t + 1);
  }, []);

  // Depois da compra o checkout avisa que o carrinho foi esvaziado: busca de novo o que o servidor tem.
  useEffect(() => eventBus.on('carrinho:limpo', recarregar), [eventBus, recarregar]);

  const executar = useCallback(
    (acao: () => Promise<Carrinho>): Promise<void> => {
      pendentes.current += 1;
      setEstado((e) => ({ ...e, ocupado: true, erroDeAcao: null }));
      const execucao = fila.current.then(async () => {
        try {
          aplicar(await acao());
        } catch (erro) {
          console.error('[mfe-carrinho] ação do carrinho falhou', erro);
          setEstado((e) => ({ ...e, erroDeAcao: descreverErro(erro) }));
        } finally {
          pendentes.current -= 1;
          if (pendentes.current === 0) setEstado((e) => ({ ...e, ocupado: false }));
        }
      });
      fila.current = execucao;
      return execucao;
    },
    [aplicar],
  );

  const acoes: AcoesCarrinho = {
    recarregar,
    adicionar: useCallback((id, q) => executar(() => adicionarItem(obterToken, id, q)), [executar, obterToken]),
    alterar: useCallback((id, q) => executar(() => alterarQuantidade(obterToken, id, q)), [executar, obterToken]),
    remover: useCallback((id) => executar(() => removerItem(obterToken, id)), [executar, obterToken]),
    dispensarErro: useCallback(() => setEstado((e) => ({ ...e, erroDeAcao: null })), []),
  };
  return [estado, acoes];
}
