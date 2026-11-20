import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { criarEventBus, type EventBus, type EventosMini } from '@ruan-diego/mini-event-contracts';
import { MiniCarrinho } from './MiniCarrinho';
import { backend } from '../backendFalso';

function montarDrawer(opcoes: { token?: string | null } = {}) {
  const eventBus: EventBus = criarEventBus(new EventTarget());
  const atualizados: EventosMini['carrinho:atualizado'][] = [];
  const navegacoes: string[] = [];
  eventBus.on('carrinho:atualizado', (p) => atualizados.push(p));
  eventBus.on('navegar', (p) => navegacoes.push(p.rota));
  render(<MiniCarrinho eventBus={eventBus} getToken={async () => opcoes.token ?? null} />);
  return { eventBus, atualizados, navegacoes };
}

const abrir = (eventBus: EventBus) => act(() => eventBus.emit('carrinho:abrir', {}));
const adicionar = (eventBus: EventBus, produtoId: string, quantidade = 1) =>
  act(() => eventBus.emit('carrinho:adicionar-item', { produtoId, quantidade }));

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

describe('MiniCarrinho: abrir e mostrar o carrinho', () => {
  it('começa fechado, mas já carrega o carrinho e avisa o badge do shell', async () => {
    const b = backend();
    b.estado.itens = [b.item('p1', 2), b.item('p2', 1)];
    const { atualizados } = montarDrawer();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(atualizados).toEqual([{ quantidadeTotal: 3, subtotal: 250 }]));
  });

  it('carrinho:abrir abre o drawer com itens, subtotal e total', async () => {
    const b = backend();
    b.estado.itens = [b.item('p1', 2), b.item('p2', 1)];
    const { eventBus, atualizados } = montarDrawer();
    await waitFor(() => expect(atualizados).toHaveLength(1));

    abrir(eventBus);

    const drawer = await screen.findByRole('dialog', { name: 'Carrinho · 3 itens' });
    expect(within(drawer).getByText('Esfera Chrome')).toBeInTheDocument();
    expect(within(drawer).getByText('Cubo Preto')).toBeInTheDocument();
    expect(within(drawer).getByText('Subtotal').nextSibling).toHaveTextContent('R$ 250,00');
    expect(within(drawer).getByText('Total').nextSibling).toHaveTextContent('R$ 250,00');
  });

  it('mostra o cupom e o desconto quando há', async () => {
    const b = backend({
      cupom: { codigo: 'BEMVINDO', tipo: 'PERCENTUAL', valor: 10, validoAte: '2030-12-31T23:59:59Z', valorMinimo: 100 },
      desconto: 25,
    });
    b.estado.itens = [b.item('p1', 2), b.item('p2', 1)];
    const { eventBus, atualizados } = montarDrawer();
    await waitFor(() => expect(atualizados).toHaveLength(1));

    abrir(eventBus);

    expect((await screen.findByText('Cupom BEMVINDO')).nextSibling).toHaveTextContent('−R$ 25,00');
    expect(screen.getByText('Total').nextSibling).toHaveTextContent('R$ 225,00');
  });

  it('avisa quando o preço de um item mudou, com o valor antigo e o novo', async () => {
    const b = backend();
    b.estado.itens = [{ ...b.item('p1', 1), precoUnitario: 120, subtotal: 120, precoAlterado: true, precoAnterior: 100 }];
    const { eventBus, atualizados } = montarDrawer();
    await waitFor(() => expect(atualizados).toHaveLength(1));

    abrir(eventBus);

    expect(await screen.findByText(/O preço mudou: era R\$ 100,00, agora R\$ 120,00/)).toBeInTheDocument();
  });

  it('carrinho vazio mostra a mensagem e "Continuar comprando" leva ao catálogo e fecha', async () => {
    backend();
    const { eventBus, navegacoes } = montarDrawer();
    abrir(eventBus);

    expect(await screen.findByText('Seu carrinho está vazio.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finalizar compra' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar comprando' }));

    expect(navegacoes).toEqual(['/produtos']);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('"Ver carrinho" e "Finalizar compra" pedem a navegação ao shell e fecham o drawer', async () => {
    const b = backend();
    b.estado.itens = [b.item('p1', 1)];
    const { eventBus, navegacoes, atualizados } = montarDrawer();
    await waitFor(() => expect(atualizados).toHaveLength(1));

    abrir(eventBus);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver carrinho' }));
    expect(navegacoes).toEqual(['/carrinho']);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    abrir(eventBus);
    await userEvent.click(await screen.findByRole('button', { name: 'Finalizar compra' }));
    expect(navegacoes).toEqual(['/carrinho', '/checkout/endereco']);
  });
});

describe('MiniCarrinho: carrinho:adicionar-item', () => {
  it('abre na hora, adiciona pelo backend e avisa o badge', async () => {
    const b = backend();
    const { eventBus, atualizados } = montarDrawer();
    await waitFor(() => expect(atualizados).toHaveLength(1));

    adicionar(eventBus, 'p1', 2);

    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByText('Esfera Chrome')).toBeInTheDocument();
    const post = b.chamadas.find((c) => c.metodo === 'POST');
    expect(post?.corpo).toEqual({ produtoId: 'p1', quantidade: 2 });
    expect(post?.caminho).toMatch(/\/carrinhos\/atual\/itens$/);
    expect(atualizados.at(-1)).toEqual({ quantidadeTotal: 2, subtotal: 200 });
  });

  it('manda a sessão do visitante e, havendo login, o token', async () => {
    const b = backend();
    const { eventBus } = montarDrawer({ token: 'token-do-cliente' });

    adicionar(eventBus, 'p1');
    await screen.findByText('Esfera Chrome');

    const post = b.chamadas.find((c) => c.metodo === 'POST')!;
    expect(post.cabecalhos['X-Sessao-Id']).toBe(localStorage.getItem('mini:sessao'));
    expect(post.cabecalhos.Authorization).toBe('Bearer token-do-cliente');
  });

  it('dois eventos seguidos viram duas chamadas em ordem e o total final é o certo', async () => {
    const b = backend();
    const { eventBus, atualizados } = montarDrawer();
    await waitFor(() => expect(atualizados).toHaveLength(1));

    adicionar(eventBus, 'p1');
    adicionar(eventBus, 'p2');
    await screen.findByText('Cubo Preto');

    const posts = b.chamadas.filter((c) => c.metodo === 'POST').map((c) => (c.corpo as { produtoId: string }).produtoId);
    expect(posts).toEqual(['p1', 'p2']);
    expect(atualizados.at(-1)).toEqual({ quantidadeTotal: 2, subtotal: 150 });
    expect(screen.getByRole('dialog', { name: 'Carrinho · 2 itens' })).toBeInTheDocument();
  });

  it('produto inexistente mostra o motivo e "Dispensar" tira o aviso', async () => {
    backend();
    const { eventBus } = montarDrawer();

    adicionar(eventBus, 'fantasma');

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('produto fantasma não existe ou está inativo');
    await userEvent.click(within(alerta).getByRole('button', { name: 'Dispensar' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('passar de 10 unidades mostra a regra do backend e mantém o carrinho como estava', async () => {
    const b = backend();
    b.estado.itens = [b.item('p1', 9)];
    const { eventBus, atualizados } = montarDrawer();
    await waitFor(() => expect(atualizados).toHaveLength(1));

    adicionar(eventBus, 'p1', 3);

    expect(await screen.findByRole('alert')).toHaveTextContent('entre 1 e 10');
    expect(screen.getByRole('group', { name: 'Quantidade de Esfera Chrome' })).toHaveTextContent('9');
  });

  it('falha de rede mostra aviso genérico, sem expor detalhes técnicos', async () => {
    backend();
    const { eventBus, atualizados } = montarDrawer();
    await waitFor(() => expect(atualizados).toHaveLength(1));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    adicionar(eventBus, 'p1');

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível falar com o carrinho agora');
  });
});

describe('MiniCarrinho: alterar e remover', () => {
  it('o + do seletor altera a quantidade e o subtotal da linha', async () => {
    const b = backend();
    b.estado.itens = [b.item('p1', 1)];
    const { eventBus, atualizados } = montarDrawer();
    await waitFor(() => expect(atualizados).toHaveLength(1));
    abrir(eventBus);
    const grupo = await screen.findByRole('group', { name: 'Quantidade de Esfera Chrome' });

    await userEvent.click(within(grupo).getByRole('button', { name: /aumentar|mais|\+/i }));

    await waitFor(() => expect(grupo).toHaveTextContent('2'));
    expect(b.chamadas.find((c) => c.metodo === 'PUT')?.corpo).toEqual({ quantidade: 2 });
    expect(atualizados.at(-1)).toEqual({ quantidadeTotal: 2, subtotal: 200 });
  });

  it('"Remover" tira o item e, sendo o último, mostra o carrinho vazio', async () => {
    const b = backend();
    b.estado.itens = [b.item('p1', 1)];
    const { eventBus, atualizados } = montarDrawer();
    await waitFor(() => expect(atualizados).toHaveLength(1));
    abrir(eventBus);

    await userEvent.click(await screen.findByRole('button', { name: 'Remover Esfera Chrome do carrinho' }));

    expect(await screen.findByText('Seu carrinho está vazio.')).toBeInTheDocument();
    expect(b.chamadas.find((c) => c.metodo === 'DELETE')?.caminho).toMatch(/\/itens\/p1$/);
    expect(atualizados.at(-1)).toEqual({ quantidadeTotal: 0, subtotal: 0 });
  });
});

describe('MiniCarrinho: falha ao carregar e carrinho:limpo', () => {
  it('erro na carga mostra aviso e "Tentar de novo" refaz a chamada', async () => {
    const b = backend();
    b.estado.itens = [b.item('p1', 1)];
    b.estado.falhaNaCarga = true;
    const { eventBus } = montarDrawer();
    abrir(eventBus);
    expect(await screen.findByText('Não consegui carregar o seu carrinho.')).toBeInTheDocument();

    b.estado.falhaNaCarga = false;
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    expect(await screen.findByText('Esfera Chrome')).toBeInTheDocument();
  });

  // Achado no E2E: o servidor esvazia o carrinho depois (evento assíncrono); reconsultar na hora devolvia os itens
  // da compra e o badge voltava à quantidade antiga.
  it('carrinho:limpo (compra concluída) esvazia na hora, sem reconsultar o servidor, e o badge zera', async () => {
    const b = backend();
    b.estado.itens = [b.item('p1', 2)];
    const { eventBus, atualizados } = montarDrawer();
    await waitFor(() => expect(atualizados.at(-1)).toEqual({ quantidadeTotal: 2, subtotal: 200 }));
    const consultasAntes = b.chamadas.filter((c) => c.metodo === 'GET').length;

    // O servidor ainda tem os itens (ainda não consumiu o evento do pedido): o aviso do checkout é que vale.
    act(() => eventBus.emit('carrinho:limpo', {}));

    await waitFor(() => expect(atualizados.at(-1)).toEqual({ quantidadeTotal: 0, subtotal: 0 }));
    expect(b.chamadas.filter((c) => c.metodo === 'GET')).toHaveLength(consultasAntes);
  });
});

describe('MiniCarrinho: acessibilidade do drawer', () => {
  async function aberto() {
    const b = backend();
    b.estado.itens = [b.item('p1', 1)];
    const ctx = montarDrawer();
    await waitFor(() => expect(ctx.atualizados).toHaveLength(1));
    return ctx;
  }

  it('o foco vai para o painel ao abrir', async () => {
    const { eventBus } = await aberto();
    abrir(eventBus);

    expect(await screen.findByRole('dialog')).toHaveFocus();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('Esc fecha e devolve o foco para quem estava focado', async () => {
    const { eventBus } = await aberto();
    const gatilho = document.body.appendChild(document.createElement('button'));
    gatilho.textContent = 'ícone do carrinho';
    gatilho.focus();

    abrir(eventBus);
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(gatilho).toHaveFocus();
    gatilho.remove();
  });

  it('o X fecha', async () => {
    const { eventBus } = await aberto();
    abrir(eventBus);

    await userEvent.click(await screen.findByRole('button', { name: 'Fechar carrinho' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clique fora (no fundo) fecha, mas clique dentro do painel não', async () => {
    const { eventBus } = await aberto();
    abrir(eventBus);
    const painel = await screen.findByRole('dialog');

    await userEvent.click(within(painel).getByText('Esfera Chrome'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.click(painel.parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Tab fica preso no drawer: do último volta ao primeiro, e Shift+Tab do primeiro vai ao último', async () => {
    const { eventBus } = await aberto();
    abrir(eventBus);
    const painel = await screen.findByRole('dialog');
    const focaveis = within(painel).getAllByRole('button');
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    expect(primeiro).toHaveAccessibleName('Fechar carrinho');

    ultimo.focus();
    await userEvent.tab();
    expect(primeiro).toHaveFocus();

    await userEvent.tab({ shift: true });
    expect(ultimo).toHaveFocus();
  });
});
