import { useState, type FormEvent } from 'react';
import { Button, QuantityStepper } from '@ruan-diego/mini-design-system';
import type { PropsRemoto } from '@ruan-diego/mini-event-contracts';
import { formatarPreco } from '../formato';
import { useCarrinho } from '../useCarrinho';
import './carrinho.css';

const MAX_QUANTIDADE = 10;

type Props = Pick<PropsRemoto, 'eventBus' | 'getToken'>;

/**
 * Página do carrinho (rota index). Não trata `carrinho:adicionar-item` nem `carrinho:abrir`: isso é do
 * drawer, que o shell mantém montado; tratar aqui adicionaria cada item duas vezes. As duas instâncias se
 * mantêm iguais pelo `carrinho:atualizado` (ver useCarrinho).
 */
export function Carrinho({ eventBus, getToken }: Props) {
  const [estado, acoes] = useCarrinho(eventBus, getToken);
  const [codigo, setCodigo] = useState('');
  const [motivoDoCupom, setMotivoDoCupom] = useState<string | null>(null);
  const carrinho = estado.carrinho;

  async function aplicarCupom(e: FormEvent) {
    e.preventDefault();
    if (!codigo.trim()) {
      setMotivoDoCupom('Digite o código do cupom.');
      return;
    }
    const motivo = await acoes.aplicarCupom(codigo.trim());
    setMotivoDoCupom(motivo);
    if (!motivo) setCodigo('');
  }

  return (
    <section className="wrap car" aria-busy={estado.ocupado || estado.situacao === 'carregando'}>
      <h1 className="h2">Carrinho</h1>

      {estado.erroDeAcao && (
        <div className="car-erro" role="alert">
          <p>{estado.erroDeAcao}</p>
          <Button variante="ghost" pequeno onClick={acoes.dispensarErro}>Dispensar</Button>
        </div>
      )}

      {estado.situacao === 'carregando' && <div className="car-skeleton" aria-label="Carregando carrinho" />}

      {estado.situacao === 'erro' && (
        <div className="car-vazio" role="alert">
          <p>Não consegui carregar o seu carrinho.</p>
          <Button variante="secundario" onClick={acoes.recarregar}>Tentar de novo</Button>
        </div>
      )}

      {estado.situacao === 'pronto' && carrinho && carrinho.itens.length === 0 && (
        <div className="car-vazio">
          <p>Seu carrinho está vazio.</p>
          <Button variante="primario" onClick={() => eventBus.emit('navegar', { rota: '/produtos' })}>Continuar comprando</Button>
        </div>
      )}

      {estado.situacao === 'pronto' && carrinho && carrinho.itens.length > 0 && (
        <div className="car-grade">
          <table className="car-tabela">
            <caption className="sr">Itens do carrinho</caption>
            <thead>
              <tr>
                <th scope="col">Produto</th>
                <th scope="col">Preço</th>
                <th scope="col">Quantidade</th>
                <th scope="col">Subtotal</th>
                <th scope="col"><span className="sr">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {carrinho.itens.map((item) => (
                <tr key={item.produtoId}>
                  <th scope="row" className="car-produto">
                    {item.nome}
                    {item.precoAlterado && item.precoAnterior !== null && (
                      <span className="car-aviso">
                        O preço mudou: era {formatarPreco(item.precoAnterior)}, agora {formatarPreco(item.precoUnitario)}.
                      </span>
                    )}
                  </th>
                  <td>{formatarPreco(item.precoUnitario)}</td>
                  <td>
                    <QuantityStepper
                      valor={item.quantidade}
                      aoMudar={(nova) => void acoes.alterar(item.produtoId, nova)}
                      min={1}
                      max={MAX_QUANTIDADE}
                      rotulo={`Quantidade de ${item.nome}`}
                    />
                  </td>
                  <td className="car-valor">{formatarPreco(item.subtotal)}</td>
                  <td>
                    <Button variante="ghost" pequeno aria-label={`Remover ${item.nome} do carrinho`} onClick={() => void acoes.remover(item.produtoId)}>
                      Remover
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <aside className="car-resumo" aria-label="Resumo do pedido">
            <h2 className="h3">Resumo</h2>

            {carrinho.cupom ? (
              <p className="car-cupom">
                Cupom <strong>{carrinho.cupom.codigo}</strong> aplicado
                <Button variante="ghost" pequeno onClick={() => void acoes.removerCupom()}>Remover cupom</Button>
              </p>
            ) : (
              <form className="car-cupom-form" onSubmit={aplicarCupom} noValidate>
                <label htmlFor="cupom">Cupom de desconto</label>
                <div className="car-cupom-linha">
                  <input
                    id="cupom"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    autoComplete="off"
                    aria-invalid={motivoDoCupom ? true : undefined}
                    aria-describedby={motivoDoCupom ? 'cupom-motivo' : undefined}
                  />
                  <Button type="submit" variante="secundario">Aplicar</Button>
                </div>
                {motivoDoCupom && <p id="cupom-motivo" className="car-cupom-motivo" role="alert">{motivoDoCupom}</p>}
              </form>
            )}

            <dl className="car-totais">
              <div>
                <dt>Subtotal</dt>
                <dd>{formatarPreco(carrinho.subtotal)}</dd>
              </div>
              {carrinho.desconto > 0 && (
                <div>
                  <dt>Desconto</dt>
                  <dd>−{formatarPreco(carrinho.desconto)}</dd>
                </div>
              )}
              <div className="car-total">
                <dt>Total</dt>
                <dd>{formatarPreco(carrinho.total)}</dd>
              </div>
            </dl>
            <Button variante="primario" bloco onClick={() => eventBus.emit('navegar', { rota: '/checkout/endereco' })}>
              Finalizar compra
            </Button>
          </aside>
        </div>
      )}
    </section>
  );
}
