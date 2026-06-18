const router = require('express').Router();
const supabase = require('../utils/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/vendas?data_inicio=&data_fim=&status=&limit=
router.get('/', async (req, res) => {
  try {
    const { data_inicio, data_fim, status, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('vendas')
      .select('*, clientes(nome, telefone), vendedores(nome)', { count: 'exact' })
      .eq('empresa_id', req.empresa_id)
      .order('criado_em', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status) query = query.eq('status', status);
    if (data_inicio) query = query.gte('criado_em', data_inicio);
    if (data_fim) query = query.lte('criado_em', data_fim + 'T23:59:59');

    const { data, count, error } = await query;
    if (error) return res.status(500).json({ erro: error.message });

    res.json({ vendas: data, total: count });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/vendas/:id
router.get('/:id', async (req, res) => {
  try {
    const { data: venda, error } = await supabase
      .from('vendas')
      .select('*, clientes(nome, telefone, email), vendedores(nome)')
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id)
      .single();

    if (error || !venda) return res.status(404).json({ erro: 'Venda não encontrada' });

    const { data: itens } = await supabase
      .from('venda_itens')
      .select('*, produtos(nome, icone, unidade)')
      .eq('venda_id', venda.id);

    res.json({ ...venda, itens: itens || [] });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/vendas — finaliza uma venda (PDV)
router.post('/', async (req, res) => {
  try {
    const {
      cliente_id,
      vendedor_id,
      itens,            // [{ produto_id, quantidade, preco_unitario, desconto }]
      forma_pagamento,  // dinheiro | pix | cartao_debito | cartao_credito | fiado
      desconto_total,
      observacoes
    } = req.body;

    if (!itens || !Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ erro: 'A venda precisa ter ao menos 1 item' });
    }
    if (!forma_pagamento) {
      return res.status(400).json({ erro: 'forma_pagamento é obrigatório' });
    }

    // Valida e busca todos os produtos de uma vez
    const produtoIds = itens.map(i => i.produto_id);
    const { data: produtos } = await supabase
      .from('produtos')
      .select('id, nome, preco_venda, estoque_atual')
      .in('id', produtoIds)
      .eq('empresa_id', req.empresa_id);

    if (!produtos || produtos.length !== produtoIds.length) {
      return res.status(400).json({ erro: 'Um ou mais produtos não encontrados' });
    }

    // Valida estoque suficiente
    for (const item of itens) {
      const produto = produtos.find(p => p.id === item.produto_id);
      if (produto.estoque_atual < item.quantidade) {
        return res.status(400).json({
          erro: `Estoque insuficiente para ${produto.nome}: disponível ${produto.estoque_atual}, solicitado ${item.quantidade}`
        });
      }
    }

    // Calcula total
    let subtotal = 0;
    for (const item of itens) {
      const preco = Number(item.preco_unitario);
      const qtd = Number(item.quantidade);
      const desc = Number(item.desconto || 0);
      subtotal += (preco * qtd) - desc;
    }
    const total = subtotal - Number(desconto_total || 0);

    // Cria a venda
    const { data: venda, error: errVenda } = await supabase
      .from('vendas')
      .insert({
        empresa_id: req.empresa_id,
        cliente_id: cliente_id || null,
        vendedor_id: vendedor_id || null,
        forma_pagamento,
        subtotal,
        desconto_total: Number(desconto_total || 0),
        total,
        observacoes: observacoes || null,
        status: 'concluida',
        usuario_id: req.usuario_id
      })
      .select()
      .single();

    if (errVenda) return res.status(500).json({ erro: errVenda.message });

    // Insere os itens
    const itensParaInserir = itens.map(item => ({
      venda_id: venda.id,
      empresa_id: req.empresa_id,
      produto_id: item.produto_id,
      quantidade: Number(item.quantidade),
      preco_unitario: Number(item.preco_unitario),
      desconto: Number(item.desconto || 0),
      total: (Number(item.preco_unitario) * Number(item.quantidade)) - Number(item.desconto || 0)
    }));

    await supabase.from('venda_itens').insert(itensParaInserir);

    // Baixa de estoque automática — atualiza um por um para precisão
    for (const item of itens) {
      const produto = produtos.find(p => p.id === item.produto_id);
      const novoEstoque = produto.estoque_atual - Number(item.quantidade);

      await supabase
        .from('produtos')
        .update({ estoque_atual: novoEstoque })
        .eq('id', item.produto_id);

      await supabase.from('estoque_movimentacoes').insert({
        empresa_id: req.empresa_id,
        produto_id: item.produto_id,
        tipo: 'saida',
        quantidade: Number(item.quantidade),
        estoque_anterior: produto.estoque_atual,
        estoque_novo: novoEstoque,
        motivo: `Venda #${venda.id.slice(0, 8)}`,
        usuario_id: req.usuario_id
      });
    }

    // Atualiza stats do cliente
    if (cliente_id) {
      const { data: cli } = await supabase
        .from('clientes')
        .select('total_compras, total_gasto')
        .eq('id', cliente_id)
        .single();

      if (cli) {
        await supabase
          .from('clientes')
          .update({
            total_compras: (cli.total_compras || 0) + 1,
            total_gasto: (cli.total_gasto || 0) + total,
            ultima_compra: new Date().toISOString()
          })
          .eq('id', cliente_id);
      }
    }

    // Lança no financeiro automaticamente (exceto fiado)
    if (forma_pagamento !== 'fiado') {
      await supabase.from('financeiro_lancamentos').insert({
        empresa_id:      req.empresa_id,
        usuario_id:      req.usuario_id,
        tipo:            'receita',
        valor:           total,
        categoria:       'Vendas',
        descricao:       'Venda #' + venda.id.slice(0, 8),
        data:            new Date().toISOString().split('T')[0],
        forma_pagamento: forma_pagamento
      });
    }

    res.status(201).json({ venda_id: venda.id, total, status: 'concluida' });
  } catch (err) {
    console.error('[VENDAS]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/vendas/:id/cancelar
router.post('/:id/cancelar', async (req, res) => {
  try {
    const { data: venda } = await supabase
      .from('vendas')
      .select('id, status, cliente_id, total')
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id)
      .single();

    if (!venda) return res.status(404).json({ erro: 'Venda não encontrada' });
    if (venda.status === 'cancelada') return res.status(400).json({ erro: 'Venda já cancelada' });

    // Busca itens para estornar estoque
    const { data: itens } = await supabase
      .from('venda_itens')
      .select('produto_id, quantidade')
      .eq('venda_id', venda.id);

    // Estorno de estoque
    for (const item of (itens || [])) {
      const { data: produto } = await supabase
        .from('produtos')
        .select('estoque_atual')
        .eq('id', item.produto_id)
        .single();

      if (produto) {
        const novoEstoque = produto.estoque_atual + item.quantidade;
        await supabase
          .from('produtos')
          .update({ estoque_atual: novoEstoque })
          .eq('id', item.produto_id);

        await supabase.from('estoque_movimentacoes').insert({
          empresa_id: req.empresa_id,
          produto_id: item.produto_id,
          tipo: 'entrada',
          quantidade: item.quantidade,
          estoque_anterior: produto.estoque_atual,
          estoque_novo: novoEstoque,
          motivo: `Cancelamento venda #${venda.id.slice(0, 8)}`,
          usuario_id: req.usuario_id
        });
      }
    }

    await supabase
      .from('vendas')
      .update({ status: 'cancelada' })
      .eq('id', venda.id);

    res.json({ mensagem: 'Venda cancelada e estoque estornado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
