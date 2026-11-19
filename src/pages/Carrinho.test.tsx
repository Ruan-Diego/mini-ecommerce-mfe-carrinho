import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { criarEventBus, type EventBus } from '@ruan-diego/mini-event-contracts';
import { Carrinho } from './Carrinho';
import { MiniCarrinho } from './MiniCarrinho';
import { backend } from '../backendFalso';

function montar() {
  const eventBus: EventBus = criarEventBus(new EventTarget());
  const navegacoes: string[] = [];
  eventBus.on('navegar', (p) => navegacoes.push(p.rota));
  render(<Carrinho eventBus={eventBus} getToken={async () => null} />);
  return { eventBus, navegacoes };
}

function comItens() {
  const b = backend();
  b.estado.itens = [b.item('p1', 2), b.item('p2', 1)];
  return b;
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

describe('Carrinho: tabela', () => {
  it('lista os itens com preço, quantidade e subtotal da linha, e o resumo bate com o backend', async () => {
    comItens();
    montar();

    const tabela = await screen.findByRole('table', { name: 'Itens do carrinho' });
    const linha = within(tabela).getByRole('row', { name: /Esfera Chrome/ });
    expect(within(linha).getByText('R$ 100,00')).toBeInTheDocument();
    expect(within(linha).getByRole('group', { name: 'Quantidade de Esfera Chrome' })).toHaveTextContent('2');
    expect(within(linha).getByText('R$ 200,00')).toBeInTheDocument();
    const resumo = screen.getByRole('complementary', { name: 'Resumo do pedido' });
    expect(within(resumo).getByText('Subtotal').nextSibling).toHaveTextContent('R$ 250,00');
    expect(within(resumo).getByText('Total').nextSibling).toHaveTextContent('R$ 250,00');
  });

  it('avisa o preço alterado na linha, com o valor antigo e o novo', async () => {
    const b = backend();
    b.estado.itens = [{ ...b.item('p1', 1), precoUnitario: 120, subtotal: 120, precoAlterado: true, precoAnterior: 100 }];
    montar();

    expect(await screen.findByText(/O preço mudou: era R\$ 100,00, agora R\$ 120,00/)).toBeInTheDocument();
  });

  it('carrinho vazio mostra o estado vazio e "Continuar comprando" leva ao catálogo', async () => {
    backend();
    const { navegacoes } = montar();

    expect(await screen.findByText('Seu carrinho está vazio.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar comprando' }));

    expect(navegacoes).toEqual(['/produtos']);
  });

  it('erro ao carregar mostra aviso e "Tentar de novo" refaz a chamada', async () => {
    const b = comItens();
    b.estado.falhaNaCarga = true;
    montar();
    expect(await screen.findByText('Não consegui carregar o seu carrinho.')).toBeInTheDocument();

    b.estado.falhaNaCarga = false;
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('"Remover" tira a linha', async () => {
    const b = comItens();
    montar();

    await userEvent.click(await screen.findByRole('button', { name: 'Remover Cubo Preto do carrinho' }));

    await waitFor(() => expect(screen.queryByText('Cubo Preto')).not.toBeInTheDocument());
    expect(b.chamadas.find((c) => c.metodo === 'DELETE')?.caminho).toMatch(/\/itens\/p2$/);
  });

  it('"Finalizar compra" pede ao shell a rota do checkout', async () => {
    comItens();
    const { navegacoes } = montar();

    await userEvent.click(await screen.findByRole('button', { name: 'Finalizar compra' }));

    expect(navegacoes).toEqual(['/checkout/endereco']);
  });
});

describe('Carrinho: quantidade otimista', () => {
  it('a tela muda na hora, antes de o servidor responder, e a resposta dele vale no fim', async () => {
    const b = comItens();
    montar();
    const grupo = await screen.findByRole('group', { name: 'Quantidade de Esfera Chrome' });

    // Deixa o PUT preso para enxergar a tela antes da resposta.
    const original = fetch;
    let liberar: () => void = () => {};
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? new Promise<Response>((r) => { liberar = () => r(original(url, init)); }) : original(url, init),
    );
    await userEvent.click(within(grupo).getByRole('button', { name: /aumentar|mais|\+/i }));

    expect(grupo).toHaveTextContent('3');
    expect(screen.getByText('R$ 300,00')).toBeInTheDocument();
    expect(b.chamadas.some((c) => c.metodo === 'PUT')).toBe(false);

    await act(async () => liberar());
    await waitFor(() => expect(b.chamadas.some((c) => c.metodo === 'PUT')).toBe(true));
    expect(grupo).toHaveTextContent('3');
  });

  it('se o servidor recusar, volta ao valor confirmado e mostra o motivo', async () => {
    const b = comItens();
    b.estado.falhaNoPut = 422;
    montar();
    const grupo = await screen.findByRole('group', { name: 'Quantidade de Esfera Chrome' });

    await userEvent.click(within(grupo).getByRole('button', { name: /aumentar|mais|\+/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('entre 1 e 10');
    await waitFor(() => expect(grupo).toHaveTextContent('2'));
    expect(screen.getByText('R$ 200,00')).toBeInTheDocument();
  });
});

describe('Carrinho: cupom', () => {
  async function aplicar(codigo: string) {
    const campo = await screen.findByRole('textbox', { name: 'Cupom de desconto' });
    await userEvent.clear(campo);
    if (codigo) await userEvent.type(campo, codigo);
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    return campo;
  }

  it('cupom válido mostra o desconto e o total do backend, e pode ser removido', async () => {
    comItens();
    montar();

    await aplicar('dez');

    expect(await screen.findByText('DEZ')).toBeInTheDocument();
    const resumo = screen.getByRole('complementary', { name: 'Resumo do pedido' });
    expect(within(resumo).getByText('Desconto').nextSibling).toHaveTextContent('−R$ 25,00');
    expect(within(resumo).getByText('Total').nextSibling).toHaveTextContent('R$ 225,00');

    await userEvent.click(screen.getByRole('button', { name: 'Remover cupom' }));

    expect(await screen.findByRole('textbox', { name: 'Cupom de desconto' })).toBeInTheDocument();
    expect(within(resumo).getByText('Total').nextSibling).toHaveTextContent('R$ 250,00');
    expect(within(resumo).queryByText('Desconto')).not.toBeInTheDocument();
  });

  it.each([
    ['NADA', 'cupom NADA não existe'],
    ['VENCIDO', 'cupom VENCIDO vencido'],
    ['GRANDE', 'exige subtotal mínimo'],
  ])('cupom %s recusado mostra o motivo junto ao campo', async (codigo, motivo) => {
    comItens();
    montar();

    const campo = await aplicar(codigo);

    const aviso = await screen.findByText(new RegExp(motivo));
    expect(aviso).toHaveAttribute('role', 'alert');
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(campo).toHaveAccessibleDescription(expect.stringContaining(motivo));
    expect(campo).toHaveValue(codigo);
  });

  it('código vazio pede para digitar, sem chamar o backend', async () => {
    const b = comItens();
    montar();
    await screen.findByRole('table');
    const antes = b.chamadas.length;

    await aplicar('');

    expect(await screen.findByText('Digite o código do cupom.')).toBeInTheDocument();
    expect(b.chamadas).toHaveLength(antes);
  });

  it('depois de um cupom recusado, um válido limpa o motivo', async () => {
    comItens();
    montar();
    await aplicar('NADA');
    await screen.findByText(/não existe/);

    await aplicar('DEZ');

    await screen.findByText('DEZ');
    expect(screen.queryByText(/não existe/)).not.toBeInTheDocument();
  });
});

describe('Carrinho e drawer na mesma página (o shell monta o ./App duas vezes em /carrinho)', () => {
  it('adicionar pelo drawer aparece na página, cada item entra uma vez só e as instâncias não ficam se chamando', async () => {
    const b = backend();
    const eventBus: EventBus = criarEventBus(new EventTarget());
    render(
      <>
        <Carrinho eventBus={eventBus} getToken={async () => null} />
        <MiniCarrinho eventBus={eventBus} getToken={async () => null} />
      </>,
    );
    await screen.findByText('Seu carrinho está vazio.');

    act(() => eventBus.emit('carrinho:adicionar-item', { produtoId: 'p1', quantidade: 1 }));

    const tabela = await screen.findByRole('table', { name: 'Itens do carrinho' });
    expect(within(tabela).getByRole('group', { name: 'Quantidade de Esfera Chrome' })).toHaveTextContent('1');
    await act(async () => new Promise((r) => setTimeout(r, 200)));
    expect(b.chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(1);
    // Sem laço: depois de assentar, esperar mais não gera nenhuma chamada nova entre as instâncias.
    const assentado = b.chamadas.length;
    await act(async () => new Promise((r) => setTimeout(r, 300)));
    expect(b.chamadas).toHaveLength(assentado);
  });

  it('mudar na página atualiza o drawer aberto', async () => {
    const b = comItens();
    const eventBus: EventBus = criarEventBus(new EventTarget());
    render(
      <>
        <Carrinho eventBus={eventBus} getToken={async () => null} />
        <MiniCarrinho eventBus={eventBus} getToken={async () => null} />
      </>,
    );
    const grupoDaPagina = await screen.findByRole('group', { name: 'Quantidade de Esfera Chrome' });
    act(() => eventBus.emit('carrinho:abrir', {}));
    const drawer = await screen.findByRole('dialog');

    await userEvent.click(within(grupoDaPagina).getByRole('button', { name: /aumentar|mais|\+/i }));

    await waitFor(() => expect(within(drawer).getByRole('group', { name: 'Quantidade de Esfera Chrome' })).toHaveTextContent('3'));
    expect(b.chamadas.filter((c) => c.metodo === 'PUT')).toHaveLength(1);
  });
});
