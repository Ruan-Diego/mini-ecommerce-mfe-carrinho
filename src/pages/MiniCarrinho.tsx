import { useEffect, useState } from 'react';
import { Button, QuantityStepper } from '@ruan-diego/mini-design-system';
import type { PropsRemoto } from '@ruan-diego/mini-event-contracts';
import { Drawer } from '../components/Drawer';
import { formatarPreco, textoItens } from '../formato';
import { useCarrinho } from '../useCarrinho';
import './mini-carrinho.css';

const MAX_QUANTIDADE = 10;

type Props = Pick<PropsRemoto, 'eventBus' | 'getToken'>;

/**
 * Mini-carrinho (drawer). O shell o mantém montado em toda página (rota `mini`), então ele está sempre
 * ouvindo: `carrinho:adicionar-item` (do catálogo) adiciona e abre; `carrinho:abrir` (do ícone do header)
 * só abre. É a única parte do MFE que trata esses eventos: a página do carrinho não os trata, senão cada
 * item seria adicionado duas vezes (o shell monta o ./App duas vezes quando a rota é /carrinho).
 */
export function MiniCarrinho({ eventBus, getToken }: Props) {
  const [estado, acoes] = useCarrinho(eventBus, getToken);
  const [aberto, setAberto] = useState(false);
  const { adicionar } = acoes;

  useEffect(() => eventBus.on('carrinho:abrir', () => setAberto(true)), [eventBus]);

  useEffect(
    () =>
      eventBus.on('carrinho:adicionar-item', ({ produtoId, quantidade }) => {
        setAberto(true);
        void adicionar(produtoId, quantidade);
      }),
    [eventBus, adicionar],
  );

  function ir(rota: string) {
    setAberto(false);
    eventBus.emit('navegar', { rota });
  }

  const carrinho = estado.carrinho;
  const titulo = carrinho && carrinho.quantidadeTotal > 0 ? `Carrinho · ${textoItens(carrinho.quantidadeTotal)}` : 'Carrinho';

  return (
    <Drawer aberto={aberto} titulo={titulo} aoFechar={() => setAberto(false)} rotuloFechar="Fechar carrinho">
      <div className="mini-corpo" aria-busy={estado.ocupado || estado.situacao === 'carregando'}>
        {estado.erroDeAcao && (
          <div className="mini-erro" role="alert">
            <p>{estado.erroDeAcao}</p>
            <Button variante="ghost" pequeno onClick={acoes.dispensarErro}>Dispensar</Button>
          </div>
        )}

        {estado.situacao === 'carregando' && <div className="mini-skeleton" aria-label="Carregando carrinho" />}

        {estado.situacao === 'erro' && (
          <div className="mini-vazio" role="alert">
            <p>Não consegui carregar o seu carrinho.</p>
            <Button variante="secundario" onClick={acoes.recarregar}>Tentar de novo</Button>
          </div>
        )}

        {estado.situacao === 'pronto' && carrinho && carrinho.itens.length === 0 && (
          <div className="mini-vazio">
            <p>Seu carrinho está vazio.</p>
            <Button variante="secundario" onClick={() => ir('/produtos')}>Continuar comprando</Button>
          </div>
        )}

        {estado.situacao === 'pronto' && carrinho && carrinho.itens.length > 0 && (
          <ul className="mini-itens">
            {carrinho.itens.map((item) => (
              <li key={item.produtoId} className="mini-item">
                <div className="mini-item-info">
                  <p className="mini-item-nome">{item.nome}</p>
                  <p className="mini-item-preco">{formatarPreco(item.precoUnitario)}</p>
                  {item.precoAlterado && item.precoAnterior !== null && (
                    <p className="mini-item-aviso">
                      O preço mudou: era {formatarPreco(item.precoAnterior)}, agora {formatarPreco(item.precoUnitario)}.
                    </p>
                  )}
                </div>
                <div className="mini-item-acoes">
                  <QuantityStepper
                    valor={item.quantidade}
                    aoMudar={(nova) => void acoes.alterar(item.produtoId, nova)}
                    min={1}
                    max={MAX_QUANTIDADE}
                    rotulo={`Quantidade de ${item.nome}`}
                  />
                  <p className="mini-item-subtotal">{formatarPreco(item.subtotal)}</p>
                  <Button variante="ghost" pequeno aria-label={`Remover ${item.nome} do carrinho`} onClick={() => void acoes.remover(item.produtoId)}>
                    Remover
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {estado.situacao === 'pronto' && carrinho && carrinho.itens.length > 0 && (
        <div className="mini-rodape">
          <dl className="mini-totais">
            <div>
              <dt>Subtotal</dt>
              <dd>{formatarPreco(carrinho.subtotal)}</dd>
            </div>
            {carrinho.desconto > 0 && carrinho.cupom && (
              <div>
                <dt>Cupom {carrinho.cupom.codigo}</dt>
                <dd>−{formatarPreco(carrinho.desconto)}</dd>
              </div>
            )}
            <div className="mini-total">
              <dt>Total</dt>
              <dd>{formatarPreco(carrinho.total)}</dd>
            </div>
          </dl>
          <Button variante="secundario" bloco onClick={() => ir('/carrinho')}>Ver carrinho</Button>
          <Button variante="primario" bloco onClick={() => ir('/checkout/endereco')}>Finalizar compra</Button>
        </div>
      )}
    </Drawer>
  );
}
