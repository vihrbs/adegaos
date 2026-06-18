const router = require('express').Router();
const supabase = require('../utils/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/pedidos?status=&limit=
router.get('/', async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;

    let query = supabase
      .from('pedidos')
      .select('*, clientes(nome, telefone, endereco)')
      .eq('empresa_id', req.empresa_id)
      .order('criado_em', { ascending: false })
      .limit(Number(limit));

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/pedidos/:id
router.get('/:id', async (req, res) => {
  try {
    const { data: pedido, error } = await supabase
      .from('pedidos')
      .select('*, clientes(nome, telefone, email, endereco)')
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id)
      .single();

    if (error || !pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });

    const { data: itens } = await supabase
      .from('pedido_itens')
      .select('*, produtos(nome, icone, unidade)')
      .eq('pedido_id', pedido.id);

    res.json({ ...pedido, itens: itens || [] });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/pedidos
router.post('/', async (req, res) => {
  try {
    const { cliente_id, itens, endereco_entrega, forma_pagamento, observacoes, taxa_entrega } = req.body;

    if (!itens || !Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ erro: 'Pedido precisa ter ao menos 1 item' });
    }

    let subtotal = 0;
    for (const item of itens) {
      subtotal += Number(item.preco_unitario) * Number(item.quantidade);
    }
    const total = subtotal + Number(taxa_entrega || 0);

    const { data: pedido, error } = await supabase
      .from('pedidos')
      .insert({
        empresa_id: req.empresa_id,
        cliente_id: cliente_id || null,
        endereco_entrega: endereco_entrega || null,
        forma_pagamento: forma_pagamento || null,
        observacoes: observacoes || null,
        subtotal,
        taxa_entrega: Number(taxa_entrega || 0),
        total,
        status: 'pendente',
        usuario_id: req.usuario_id
      })
      .select()
      .single();

    if (error) return res.status(500).json({ erro: error.message });

    const itensParaInserir = itens.map(item => ({
      pedido_id: pedido.id,
      empresa_id: req.empresa_id,
      produto_id: item.produto_id,
      quantidade: Number(item.quantidade),
      preco_unitario: Number(item.preco_unitario),
      total: Number(item.preco_unitario) * Number(item.quantidade)
    }));

    await supabase.from('pedido_itens').insert(itensParaInserir);

    res.status(201).json(pedido);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// PUT /api/pedidos/:id/status
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const statusValidos = ['pendente', 'confirmado', 'em_preparo', 'saiu_entrega', 'entregue', 'cancelado'];

    if (!statusValidos.includes(status)) {
      return res.status(400).json({ erro: 'Status inválido' });
    }

    const { data, error } = await supabase
      .from('pedidos')
      .update({ status, atualizado_em: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ erro: 'Pedido não encontrado' });

    // Se entregue, converte em venda automaticamente
    if (status === 'entregue') {
      const { data: itens } = await supabase
        .from('pedido_itens')
        .select('*')
        .eq('pedido_id', data.id);

      if (itens && itens.length > 0) {
        const { data: venda } = await supabase
          .from('vendas')
          .insert({
            empresa_id: req.empresa_id,
            cliente_id: data.cliente_id || null,
            vendedor_id: null,
            forma_pagamento: data.forma_pagamento || 'dinheiro',
            subtotal: data.subtotal,
            desconto_total: 0,
            total: data.total,
            observacoes: `Delivery - Pedido #${data.id.slice(0, 8)}`,
            status: 'concluida',
            pedido_id: data.id,
            usuario_id: req.usuario_id
          })
          .select()
          .single();

        if (venda) {
          const vendaItens = itens.map(i => ({
            venda_id: venda.id,
            empresa_id: req.empresa_id,
            produto_id: i.produto_id,
            quantidade: i.quantidade,
            preco_unitario: i.preco_unitario,
            desconto: 0,
            total: i.total
          }));
          await supabase.from('venda_itens').insert(vendaItens);

          // Baixa estoque
          for (const item of itens) {
            const { data: prod } = await supabase
              .from('produtos')
              .select('estoque_atual')
              .eq('id', item.produto_id)
              .single();

            if (prod) {
              const novo = prod.estoque_atual - item.quantidade;
              await supabase.from('produtos').update({ estoque_atual: Math.max(0, novo) }).eq('id', item.produto_id);
            }
          }
        }
      }
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
