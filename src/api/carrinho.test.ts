import { adicionarItem, alterarQuantidade, ErroDeApi, idDaSessao, obterCarrinho, removerItem } from './carrinho';

const vazio = { itens: [], quantidadeTotal: 0, subtotal: 0, cupom: null, desconto: 0, total: 0 };

function responder(status: number, corpo: unknown = vazio) {
  const fetchFalso = vi.fn(async () => new Response(JSON.stringify(corpo), { status }));
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

const cabecalhosDa = (fetchFalso: ReturnType<typeof responder>) =>
  (fetchFalso.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('idDaSessao', () => {
  it('gera um id na primeira vez e reaproveita nas seguintes (sobrevive a recarregar a página)', () => {
    const primeiro = idDaSessao();

    expect(primeiro).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(idDaSessao()).toBe(primeiro);
    expect(localStorage.getItem('mini:sessao')).toBe(primeiro);
  });

  it('sem localStorage, mantém o mesmo id enquanto a página não recarrega', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });

    expect(idDaSessao()).toBe(idDaSessao());
    vi.restoreAllMocks();
  });
});

describe('chamadas ao carrinho-service', () => {
  it('GET /carrinhos/atual manda a sessão do visitante e não manda Authorization sem login', async () => {
    const f = responder(200);

    await obterCarrinho(async () => null);

    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/carrinhos\/atual$/);
    expect(init.method).toBe('GET');
    expect(cabecalhosDa(f)['X-Sessao-Id']).toBe(idDaSessao());
    expect(cabecalhosDa(f).Authorization).toBeUndefined();
  });

  it('com login, manda o token em Authorization: Bearer', async () => {
    const f = responder(200);

    await obterCarrinho(async () => 'abc.def');

    expect(cabecalhosDa(f).Authorization).toBe('Bearer abc.def');
    expect(cabecalhosDa(f)['X-Sessao-Id']).toBe(idDaSessao());
  });

  it('POST de item leva só produtoId e quantidade (nome e preço o servidor busca no catálogo)', async () => {
    const f = responder(200);

    await adicionarItem(async () => null, 'p1', 2);

    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/carrinhos\/atual\/itens$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ produtoId: 'p1', quantidade: 2 });
    expect(cabecalhosDa(f)['Content-Type']).toBe('application/json');
  });

  it('PUT e DELETE usam o id do produto na URL, codificado', async () => {
    const f = responder(200);

    await alterarQuantidade(async () => null, 'a/b', 4);
    await removerItem(async () => null, 'a/b');

    const [urlPut, put] = f.mock.calls[0] as unknown as [string, RequestInit];
    const [urlDelete, del] = f.mock.calls[1] as unknown as [string, RequestInit];
    expect(urlPut).toMatch(/\/itens\/a%2Fb$/);
    expect(put.method).toBe('PUT');
    expect(JSON.parse(put.body as string)).toEqual({ quantidade: 4 });
    expect(urlDelete).toMatch(/\/itens\/a%2Fb$/);
    expect(del.method).toBe('DELETE');
  });

  it('erro HTTP vira ErroDeApi com o detalhe do problem+json', async () => {
    responder(422, { title: 'Regra de negócio violada', detail: 'quantidade deve ficar entre 1 e 10 por item: 11' });

    await expect(adicionarItem(async () => null, 'p1', 11)).rejects.toMatchObject({
      status: 422,
      message: 'quantidade deve ficar entre 1 e 10 por item: 11',
    });
  });

  it('erro sem corpo JSON cai numa frase genérica com o status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 502 })));

    const erro = await obterCarrinho(async () => null).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeApi);
    expect((erro as ErroDeApi).status).toBe(502);
    expect((erro as ErroDeApi).message).toContain('502');
  });
});
