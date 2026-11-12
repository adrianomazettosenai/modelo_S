require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// 1. CONEXÃO COM O SUPABASE
// ============================================================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('ERRO CRÍTICO: Variáveis SUPABASE_URL e SUPABASE_KEY são obrigatórias no .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================================
// 2. CLASSE DE ERRO PADRONIZADA E VALIDADORES DE ENTRADA/SAÍDA
// ============================================================================
class AppError extends Error {
  constructor(message, statusCode = 400, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Normaliza intervalo de datas (YYYY-MM-DD ou ISO) e valida coerência
 */
function validarPeriodoDatas(dataInicial, dataFinal) {
  if (!dataInicial || !dataFinal) {
    throw new AppError('Os parâmetros data_inicial e data_final são obrigatórios.', 400);
  }

  const inicioStr = dataInicial.includes('T') ? dataInicial : `${dataInicial}T00:00:00.000Z`;
  const fimStr = dataFinal.includes('T') ? dataFinal : `${dataFinal}T23:59:59.999Z`;

  const inicio = new Date(inicioStr);
  const fim = new Date(fimStr);

  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
    throw new AppError('Formato de data inválido. Utilize YYYY-MM-DD ou ISO 8601.', 400);
  }

  if (inicio > fim) {
    throw new AppError('A data inicial não pode ser maior que a data final.', 400);
  }

  return { inicioISO: inicio.toISOString(), fimISO: fim.toISOString() };
}

/**
 * Traduz erros do PostgreSQL/Supabase para respostas claras ao cliente
 */
function tratarErroBanco(error) {
  if (error instanceof AppError) throw error;

  // Código 23505: Violação de unicidade (duplicidade)
  if (error.code === '23505') {
    throw new AppError('Registro duplicado: já existe um item cadastrado com essa denominação.', 409);
  }
  // Código 23503: Violação de chave estrangeira
  if (error.code === '23503') {
    throw new AppError('Referência inválida: categoria ou produto informado não existe.', 400);
  }
  // Código 23514: Violação de regra CHECK
  if (error.code === '23514') {
    throw new AppError('Os valores informados violam as restrições de integridade do banco de dados.', 400);
  }
  // Código P0001: Exceção lançada pela Trigger (ex: saldo insuficiente)
  if (error.code === 'P0001') {
    throw new AppError(error.message, 422);
  }

  throw new AppError(`Erro interno na operação com o banco de dados: ${error.message}`, 500);
}

// ============================================================================
// 3. CAMADA DE LÓGICA DE NEGÓCIO (EstoqueService)
// ============================================================================
class EstoqueService {
  /**
   * Regra: Listar o valor total por item de produto (utilizando a view vw_estoque)
   */
  async listarValorTotalPorItem() {
    const { data, error } = await supabase
      .from('vw_estoque')
      .select('produto_id, denominacao, categoria, unidade_medida, quantidade, valor_unitario, valor_total');

    if (error) tratarErroBanco(error);

    return data.map((item) => ({
      produto_id: item.produto_id,
      denominacao: item.denominacao,
      categoria: item.categoria,
      unidade_medida: item.unidade_medida,
      quantidade: Number(item.quantidade),
      valor_unitario: Number(item.valor_unitario),
      valor_total: Number(item.valor_total),
    }));
  }

  /**
   * Regra: Consultar e retornar todos os produtos cadastrados
   */
  async listarTodosProdutos() {
    const { data, error } = await supabase
      .from('produtos')
      .select(`
        id,
        denominacao,
        unidade_medida,
        valor_unitario,
        quantidade,
        estoque_minimo,
        estoque_maximo,
        criado_em,
        categorias ( id, nome )
      `)
      .order('denominacao', { ascending: true });

    if (error) tratarErroBanco(error);
    return data;
  }

  /**
   * Regra: Cadastrar novos produtos com validações de entrada e saída
   * Campos validados obrigatoriamente: valor_unitario, quantidade e denominacao
   */
  async cadastrarProduto(payload) {
    const {
      categoria_id,
      denominacao,
      unidade_medida,
      valor_unitario,
      quantidade = 0,
      estoque_minimo = 0,
      estoque_maximo,
    } = payload;

    // --- Validações de Entrada ---
    if (!denominacao || typeof denominacao !== 'string' || denominacao.trim().length < 2) {
      throw new AppError('A denominação do produto é obrigatória e deve ter ao menos 2 caracteres.', 400);
    }

    const valorUnitarioNum = Number(valor_unitario);
    if (!Number.isFinite(valorUnitarioNum) || valorUnitarioNum <= 0) {
      throw new AppError('O valor unitário deve ser um número válido maior que zero.', 400);
    }

    const quantidadeNum = Number(quantidade);
    if (!Number.isInteger(quantidadeNum) || quantidadeNum < 0) {
      throw new AppError('A quantidade inicial deve ser um número inteiro maior ou igual a zero.', 400);
    }

    if (!unidade_medida || typeof unidade_medida !== 'string' || unidade_medida.trim().length === 0) {
      throw new AppError('A unidade de medida é obrigatória (ex: UN, GL, PCT).', 400);
    }

    if (!categoria_id || !Number.isInteger(Number(categoria_id))) {
      throw new AppError('O identificador da categoria (categoria_id) é obrigatório.', 400);
    }

    const estMin = Number(estoque_minimo);
    const estMax = Number(estoque_maximo);
    if (!Number.isInteger(estMin) || estMin < 0 || !Number.isInteger(estMax) || estMax <= estMin) {
      throw new AppError('Limites inválidos: estoque_maximo deve ser um inteiro maior que estoque_minimo (>= 0).', 400);
    }

    const denominacaoLimpa = denominacao.trim();

    // --- Prevenção prévia de duplicidade (case-insensitive) ---
    const { data: existente, error: erroBusca } = await supabase
      .from('produtos')
      .select('id')
      .ilike('denominacao', denominacaoLimpa)
      .maybeSingle();

    if (erroBusca) tratarErroBanco(erroBusca);
    if (existente) {
      throw new AppError(`Já existe um produto cadastrado com a denominação "${denominacaoLimpa}".`, 409);
    }

    // --- Persistência ---
    const { data, error } = await supabase
      .from('produtos')
      .insert([
        {
          categoria_id: Number(categoria_id),
          denominacao: denominacaoLimpa,
          unidade_medida: unidade_medida.trim().toUpperCase(),
          valor_unitario: Number(valorUnitarioNum.toFixed(2)),
          quantidade: quantidadeNum,
          estoque_minimo: estMin,
          estoque_maximo: estMax,
        },
      ])
      .select()
      .single();

    if (error) tratarErroBanco(error);

    // --- Validação de Saída ---
    if (!data || !data.id) {
      throw new AppError('Falha ao confirmar a gravação do produto no banco de dados.', 500);
    }

    return {
      id: data.id,
      categoria_id: data.categoria_id,
      denominacao: data.denominacao,
      unidade_medida: data.unidade_medida,
      valor_unitario: Number(data.valor_unitario),
      quantidade: Number(data.quantidade),
      estoque_minimo: Number(data.estoque_minimo),
      estoque_maximo: Number(data.estoque_maximo),
      criado_em: data.criado_em,
    };
  }

  /**
   * Regra: Consultar todas as saídas de produtos em ordem decrescente por data
   */
  async listarSaidasDecrescente() {
    const { data, error } = await supabase
      .from('movimentacoes')
      .select(`
        id,
        produto_id,
        quantidade,
        valor_unitario_registro,
        data_movimentacao,
        observacao,
        produtos ( denominacao, unidade_medida )
      `)
      .eq('tipo', 'SAIDA')
      .order('data_movimentacao', { ascending: false });

    if (error) tratarErroBanco(error);

    return data.map((mov) => ({
      id: mov.id,
      produto_id: mov.produto_id,
      produto: mov.produtos?.denominacao,
      unidade_medida: mov.produtos?.unidade_medida,
      quantidade: mov.quantidade,
      valor_unitario: Number(mov.valor_unitario_registro),
      valor_total_saida: Number((mov.quantidade * mov.valor_unitario_registro).toFixed(2)),
      data_movimentacao: mov.data_movimentacao,
      observacao: mov.observacao,
    }));
  }

  /**
   * Regra: Registrar entradas (e saídas) de itens no estoque com atualização automática de saldo
   */
  async registrarMovimentacao(tipo, payload) {
    const { produto_id, quantidade, valor_unitario, observacao } = payload;

    if (!['ENTRADA', 'SAIDA'].includes(tipo)) {
      throw new AppError('Tipo de movimentação inválido. Utilize ENTRADA ou SAIDA.', 400);
    }

    const produtoIdNum = Number(produto_id);
    if (!Number.isInteger(produtoIdNum) || produtoIdNum <= 0) {
      throw new AppError('O campo produto_id deve ser um inteiro positivo válido.', 400);
    }

    const quantidadeNum = Number(quantidade);
    if (!Number.isInteger(quantidadeNum) || quantidadeNum <= 0) {
      throw new AppError('A quantidade movimentada deve ser um número inteiro maior que zero.', 400);
    }

    // Busca o produto para validar existência e obter o valor unitário atual
    const { data: produto, error: erroProduto } = await supabase
      .from('produtos')
      .select('id, denominacao, valor_unitario, quantidade')
      .eq('id', produtoIdNum)
      .maybeSingle();

    if (erroProduto) tratarErroBanco(erroProduto);
    if (!produto) {
      throw new AppError(`Produto com ID ${produtoIdNum} não encontrado.`, 404);
    }

    const valorRegistro = valor_unitario !== undefined ? Number(valor_unitario) : Number(produto.valor_unitario);
    if (!Number.isFinite(valorRegistro) || valorRegistro <= 0) {
      throw new AppError('O valor unitário deve ser maior que zero.', 400);
    }

    // Insere na tabela movimentacoes (a Trigger no Supabase atualiza o saldo de produtos automaticamente)
    const { data: movimento, error: erroInsert } = await supabase
      .from('movimentacoes')
      .insert([
        {
          produto_id: produtoIdNum,
          tipo,
          quantidade: quantidadeNum,
          valor_unitario_registro: Number(valorRegistro.toFixed(2)),
          observacao: observacao ? String(observacao).trim() : null,
        },
      ])
      .select()
      .single();

    if (erroInsert) tratarErroBanco(erroInsert);

    // Consulta o saldo atualizado para confirmar consistência de ponta a ponta
    const { data: produtoAtualizado, error: erroSaldo } = await supabase
      .from('produtos')
      .select('id, denominacao, quantidade')
      .eq('id', produtoIdNum)
      .single();

    if (erroSaldo) tratarErroBanco(erroSaldo);

    return {
      mensagem: `${tipo} registrada com sucesso.`,
      movimentacao: movimento,
      saldo_atualizado: produtoAtualizado,
    };
  }

  /**
   * Regra: Relatório de movimentações (entradas e saídas) por período para cada item
   */
  async gerarRelatorioMovimentacoesPeriodo(dataInicial, dataFinal) {
    const { inicioISO, fimISO } = validarPeriodoDatas(dataInicial, dataFinal);

    const [resProdutos, resMovimentos] = await Promise.all([
      supabase.from('produtos').select('id, denominacao, unidade_medida').order('denominacao'),
      supabase
        .from('movimentacoes')
        .select('produto_id, tipo, quantidade, valor_unitario_registro, data_movimentacao')
        .gte('data_movimentacao', inicioISO)
        .lte('data_movimentacao', fimISO),
    ]);

    if (resProdutos.error) tratarErroBanco(resProdutos.error);
    if (resMovimentos.error) tratarErroBanco(resMovimentos.error);

    // Inicializa mapa com todos os produtos cadastrados
    const mapaItens = new Map();
    for (const prod of resProdutos.data) {
      mapaItens.set(prod.id, {
        nome_produto: prod.denominacao,
        unidade_medida: prod.unidade_medida,
        total_entradas: 0,
        total_saidas: 0,
        saldo_periodo: 0,
        valor_total_financeiro_entradas: 0,
        valor_total_financeiro_saidas: 0,
      });
    }

    // Agrega movimentações no período
    for (const mov of resMovimentos.data) {
      const item = mapaItens.get(mov.produto_id);
      if (!item) continue;

      const valorOperacao = Number(mov.quantidade) * Number(mov.valor_unitario_registro);

      if (mov.tipo === 'ENTRADA') {
        item.total_entradas += Number(mov.quantidade);
        item.valor_total_financeiro_entradas += valorOperacao;
      } else if (mov.tipo === 'SAIDA') {
        item.total_saidas += Number(mov.quantidade);
        item.valor_total_financeiro_saidas += valorOperacao;
      }
    }

    // Finaliza cálculos de saldo e arredondamento financeiro
    const relatorio = Array.from(mapaItens.values()).map((item) => ({
      ...item,
      saldo_periodo: item.total_entradas - item.total_saidas,
      valor_total_financeiro_entradas: Number(item.valor_total_financeiro_entradas.toFixed(2)),
      valor_total_financeiro_saidas: Number(item.valor_total_financeiro_saidas.toFixed(2)),
    }));

    return {
      periodo: { data_inicial: inicioISO, data_final: fimISO },
      itens: relatorio,
    };
  }

  /**
   * Regra: Produtos com maior volume de saída no período informado
   */
  async gerarRankingMaiorVolumeSaida(dataInicial, dataFinal) {
    const { inicioISO, fimISO } = validarPeriodoDatas(dataInicial, dataFinal);

    const { data, error } = await supabase
      .from('movimentacoes')
      .select(`
        produto_id,
        quantidade,
        valor_unitario_registro,
        produtos ( denominacao )
      `)
      .eq('tipo', 'SAIDA')
      .gte('data_movimentacao', inicioISO)
      .lte('data_movimentacao', fimISO);

    if (error) tratarErroBanco(error);

    const agrupado = new Map();

    for (const mov of data) {
      const atual = agrupado.get(mov.produto_id) || {
        nome_produto: mov.produtos?.denominacao || `Produto #${mov.produto_id}`,
        quantidade_total_saida: 0,
        valor_total_financeiro_saidas: 0,
      };

      atual.quantidade_total_saida += Number(mov.quantidade);
      atual.valor_total_financeiro_saidas += Number(mov.quantidade) * Number(mov.valor_unitario_registro);
      agrupado.set(mov.produto_id, atual);
    }

    const ranking = Array.from(agrupado.values())
      .map((item) => ({
        nome_produto: item.nome_produto,
        quantidade_total_saida: item.quantidade_total_saida,
        valor_total_financeiro_saidas: Number(item.valor_total_financeiro_saidas.toFixed(2)),
      }))
      .sort((a, b) => b.quantidade_total_saida - a.quantidade_total_saida);

    return {
      periodo: { data_inicial: inicioISO, data_final: fimISO },
      produtos_maior_saida: ranking,
    };
  }

  /**
   * Regra: Identificar produtos que atingiram os limites mínimo e máximo de estoque
   */
  async identificarLimitesEstoque() {
    const { data, error } = await supabase
      .from('vw_estoque')
      .select('produto_id, denominacao, unidade_medida, quantidade, estoque_minimo, estoque_maximo, status_estoque')
      .neq('status_estoque', 'NORMAL');

    if (error) tratarErroBanco(error);

    return {
      atingiram_limite_minimo: data.filter((p) => p.status_estoque === 'LIMITE_MINIMO'),
      atingiram_limite_maximo: data.filter((p) => p.status_estoque === 'LIMITE_MAXIMO'),
    };
  }
}

const estoqueService = new EstoqueService();

// ============================================================================
// 4. ENDPOINTS REST (ROTAS DA API)
// ============================================================================

// Wrapper assíncrono para capturar erros sem derrubar o servidor
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// 1. Listar valor total por item (via vw_estoque)
app.get('/api/estoque/valor-total', asyncHandler(async (req, res) => {
  const resultado = await estoqueService.listarValorTotalPorItem();
  res.status(200).json(resultado);
}));

// 2. Consultar todos os produtos cadastrados
app.get('/api/produtos', asyncHandler(async (req, res) => {
  const produtos = await estoqueService.listarTodosProdutos();
  res.status(200).json(produtos);
}));

// Listar categorias disponíveis para o formulário de cadastro
app.get('/api/categorias', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('categorias')
    .select('id, nome')
    .order('nome', { ascending: true });

  if (error) tratarErroBanco(error);
  res.status(200).json(data);
}));

// 3. Cadastrar novo produto (com validações de valor_unitario, quantidade e denominacao)
app.post('/api/produtos', asyncHandler(async (req, res) => {
  const novoProduto = await estoqueService.cadastrarProduto(req.body);
  res.status(201).json(novoProduto);
}));

// 4. Consultar todas as saídas em ordem decrescente por data
app.get('/api/movimentacoes/saidas', asyncHandler(async (req, res) => {
  const saidas = await estoqueService.listarSaidasDecrescente();
  res.status(200).json(saidas);
}));

// 5. Registrar entrada de itens no estoque
app.post('/api/movimentacoes/entradas', asyncHandler(async (req, res) => {
  const resultado = await estoqueService.registrarMovimentacao('ENTRADA', req.body);
  res.status(201).json(resultado);
}));

// (Complementar) Registrar saída de itens no estoque
app.post('/api/movimentacoes/saidas', asyncHandler(async (req, res) => {
  const resultado = await estoqueService.registrarMovimentacao('SAIDA', req.body);
  res.status(201).json(resultado);
}));

// 6. Relatório de entradas e saídas por período para cada item
app.get('/api/relatorios/movimentacoes', asyncHandler(async (req, res) => {
  const { data_inicial, data_final } = req.query;
  const relatorio = await estoqueService.gerarRelatorioMovimentacoesPeriodo(data_inicial, data_final);
  res.status(200).json(relatorio);
}));

// 7. Relatório de produtos com maior volume de saída no período
app.get('/api/relatorios/maior-saida', asyncHandler(async (req, res) => {
  const { data_inicial, data_final } = req.query;
  const ranking = await estoqueService.gerarRankingMaiorVolumeSaida(data_inicial, data_final);
  res.status(200).json(ranking);
}));

// 8. Identificar produtos nos limites mínimo e máximo de estoque
app.get('/api/estoque/limites', asyncHandler(async (req, res) => {
  const alertas = await estoqueService.identificarLimitesEstoque();
  res.status(200).json(alertas);
}));

// ============================================================================
// 5. MIDDLEWARE GLOBAL DE TRATAMENTO DE ERROS (PONTA A PONTA)
// ============================================================================
app.use((err, req, res, next) => {
  const status = err.statusCode || 500;
  res.status(status).json({
    erro: true,
    mensagem: err.message || 'Erro interno inesperado no servidor.',
    detalhes: err.details || null,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor de Almoxarifado rodando na porta ${PORT}`);
});

module.exports = { app, EstoqueService };
