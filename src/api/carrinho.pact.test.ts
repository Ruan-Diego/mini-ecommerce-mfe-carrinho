// @vitest-environment node
/**
 * Contrato (Pact) do mfe-carrinho com o carrinho-service: uma interação para cada chamada HTTP do MFE.
 * O cliente real (src/api/carrinho.ts) roda contra o mock do Pact e grava pacts/mfe-carrinho-carrinho-service.json;
 * `pnpm pact:copiar` leva o arquivo ao backend, que prova cumprir o contrato (ADR-0005 do backend).
 *
 * O visitante é identificado pelo X-Sessao-Id: no contrato o cabeçalho é obrigatório (qualquer valor),
 * e o provider usa o valor de exemplo "sessao-pact" nos estados.
 */
import { rmSync } from 'node:fs';
import path from 'node:path';
import { MatchersV3, PactV3 } from '@pact-foundation/pact';
import {
  adicionarItem,
  alterarQuantidade,
  aplicarCupom,
  obterCarrinho,
  removerCupom,
  removerItem,
  type ErroDeApi,
} from './carrinho';

const { like, eachLike, regex, number, integer, string, boolean, nullValue, uuid, datetime } = MatchersV3;

// O Pact mescla com o arquivo que já existe: apagar antes garante que interação removida daqui some do contrato.
const pastaDosPacts = path.resolve(process.cwd(), 'pacts');
rmSync(path.join(pastaDosPacts, 'mfe-carrinho-carrinho-service.json'), { force: true });

const provider = new PactV3({
  consumer: 'mfe-carrinho',
  provider: 'carrinho-service',
  dir: pastaDosPacts,
  logLevel: 'warn',
});

const PRODUTO = '11111111-1111-4111-8111-111111111111';
const SESSAO = regex(/.+/.source, 'sessao-pact');
const JSON_UTF8 = regex(/application\/json.*/.source, 'application/json');
const PROBLEMA = regex(/application\/(problem\+)?json.*/.source, 'application/problem+json');
const semToken = async () => null;

const cabecalhos = (comCorpo = false) => ({
  Accept: 'application/json',
  'X-Sessao-Id': SESSAO,
  ...(comCorpo ? { 'Content-Type': 'application/json' } : {}),
});

/** Item como o carrinho devolve: preço e nome vêm do catálogo; precoAnterior só existe se o preço mudou. */
const item = (quantidade: number, subtotal: number) => ({
  produtoId: uuid(PRODUTO),
  nome: string('Esfera Chrome'),
  precoUnitario: number(100.0),
  quantidade: integer(quantidade),
  subtotal: number(subtotal),
  precoAlterado: boolean(false),
  precoAnterior: nullValue(),
});

const carrinho = (itens: unknown, totais: { quantidade: number; subtotal: number }, cupom: unknown = nullValue()) => ({
  itens,
  quantidadeTotal: integer(totais.quantidade),
  subtotal: number(totais.subtotal),
  cupom,
  desconto: number(0.0),
  total: number(totais.subtotal),
});

const carrinhoVazio = { itens: [], quantidadeTotal: integer(0), subtotal: number(0.0), cupom: nullValue(), desconto: number(0.0), total: number(0.0) };

function apontarPara(url: string) {
  vi.stubEnv('VITE_API_URL', url);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('contrato mfe-carrinho → carrinho-service', () => {
  it('lê o carrinho do visitante', async () => {
    provider
      .given('o visitante sessao-pact tem 2 unidades do produto 11111111-1111-4111-8111-111111111111')
      .uponReceiving('a leitura do carrinho do visitante')
      .withRequest({ method: 'GET', path: '/carrinhos/atual', headers: cabecalhos() })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': JSON_UTF8 },
        body: carrinho(eachLike(item(2, 200.0)), { quantidade: 2, subtotal: 200.0 }),
      });

    await provider.executeTest(async (mock) => {
      apontarPara(mock.url);
      const lido = await obterCarrinho(semToken);
      expect(lido.itens[0].produtoId).toBe(PRODUTO);
      expect(lido.quantidadeTotal).toBe(2);
    });
  });

  it('adiciona um produto', async () => {
    provider
      .given('o produto 11111111-1111-4111-8111-111111111111 está à venda e o visitante sessao-pact tem o carrinho vazio')
      .uponReceiving('a adição de 1 unidade de um produto')
      .withRequest({
        method: 'POST',
        path: '/carrinhos/atual/itens',
        headers: cabecalhos(true),
        body: { produtoId: PRODUTO, quantidade: 1 },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': JSON_UTF8 },
        body: carrinho(eachLike(item(1, 100.0)), { quantidade: 1, subtotal: 100.0 }),
      });

    await provider.executeTest(async (mock) => {
      apontarPara(mock.url);
      const resultado = await adicionarItem(semToken, PRODUTO, 1);
      expect(resultado.itens[0].quantidade).toBe(1);
    });
  });

  it('muda a quantidade de um item', async () => {
    provider
      .given('o visitante sessao-pact tem 2 unidades do produto 11111111-1111-4111-8111-111111111111')
      .uponReceiving('a mudança da quantidade de um item para 3')
      .withRequest({
        method: 'PUT',
        path: `/carrinhos/atual/itens/${PRODUTO}`,
        headers: cabecalhos(true),
        body: { quantidade: 3 },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': JSON_UTF8 },
        body: carrinho(eachLike(item(3, 300.0)), { quantidade: 3, subtotal: 300.0 }),
      });

    await provider.executeTest(async (mock) => {
      apontarPara(mock.url);
      const resultado = await alterarQuantidade(semToken, PRODUTO, 3);
      expect(resultado.itens[0].quantidade).toBe(3);
    });
  });

  it('remove um item', async () => {
    provider
      .given('o visitante sessao-pact tem 2 unidades do produto 11111111-1111-4111-8111-111111111111')
      .uponReceiving('a remoção de um item')
      .withRequest({ method: 'DELETE', path: `/carrinhos/atual/itens/${PRODUTO}`, headers: cabecalhos() })
      .willRespondWith({ status: 200, headers: { 'Content-Type': JSON_UTF8 }, body: carrinhoVazio });

    await provider.executeTest(async (mock) => {
      apontarPara(mock.url);
      const resultado = await removerItem(semToken, PRODUTO);
      expect(resultado.itens).toEqual([]);
    });
  });

  it('aplica um cupom válido', async () => {
    provider
      .given('o visitante sessao-pact tem 2 unidades do produto 11111111-1111-4111-8111-111111111111')
      .uponReceiving('a aplicação do cupom BEMVINDO')
      .withRequest({ method: 'POST', path: '/carrinhos/atual/cupom', headers: cabecalhos(true), body: { codigo: 'BEMVINDO' } })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': JSON_UTF8 },
        body: {
          ...carrinho(eachLike(item(2, 200.0)), { quantidade: 2, subtotal: 200.0 }),
          cupom: {
            codigo: string('BEMVINDO'),
            tipo: regex(/PERCENTUAL|VALOR_FIXO/.source, 'PERCENTUAL'),
            valor: number(10.0),
            validoAte: datetime("yyyy-MM-dd'T'HH:mm:ssX", '2030-12-31T23:59:59Z'),
            valorMinimo: number(100.0),
          },
          desconto: number(20.0),
          total: number(180.0),
        },
      });

    await provider.executeTest(async (mock) => {
      apontarPara(mock.url);
      const resultado = await aplicarCupom(semToken, 'BEMVINDO');
      expect(resultado.cupom?.codigo).toBe('BEMVINDO');
      expect(resultado.total).toBe(180);
    });
  });

  it('cupom que não existe é recusado com o motivo (a tela mostra junto ao campo)', async () => {
    provider
      .given('o visitante sessao-pact tem 2 unidades do produto 11111111-1111-4111-8111-111111111111')
      .uponReceiving('a aplicação de um cupom que não existe')
      .withRequest({ method: 'POST', path: '/carrinhos/atual/cupom', headers: cabecalhos(true), body: { codigo: 'NAOEXISTE' } })
      .willRespondWith({
        status: 404,
        headers: { 'Content-Type': PROBLEMA },
        body: like({ detail: string('cupom NAOEXISTE não existe') }),
      });

    await provider.executeTest(async (mock) => {
      apontarPara(mock.url);
      await expect(aplicarCupom(semToken, 'NAOEXISTE')).rejects.toMatchObject({
        status: 404,
        message: 'cupom NAOEXISTE não existe',
      } satisfies Partial<ErroDeApi>);
    });
  });

  it('remove o cupom', async () => {
    provider
      .given('o visitante sessao-pact tem 2 unidades do produto 11111111-1111-4111-8111-111111111111 e o cupom BEMVINDO')
      .uponReceiving('a remoção do cupom')
      .withRequest({ method: 'DELETE', path: '/carrinhos/atual/cupom', headers: cabecalhos() })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': JSON_UTF8 },
        body: carrinho(eachLike(item(2, 200.0)), { quantidade: 2, subtotal: 200.0 }),
      });

    await provider.executeTest(async (mock) => {
      apontarPara(mock.url);
      const resultado = await removerCupom(semToken);
      expect(resultado.cupom).toBeNull();
    });
  });
});
