const router = require('express').Router();
const supabase = require('../utils/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/financeiro/resumo?mes=&ano=
router.get('/resumo', async (req, res) => {
  try {
    const agora = new Date();
    const mes = parseInt(req.query.mes || agora.getMonth() + 1);
    const ano = parseInt(req.query.ano || agora.getFullYear());

    const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const fim    = `${ano}-${String(mes).padStart(2, '0')}-31T23:59:59`;

    // Faturamento do mês (vendas concluídas)
    const { data: vendas } = await supabase
      .from('vendas')
      .select('total, forma_pagamento')
      .eq('empresa_id', req.empresa_id)
      .eq('status', 'concluida')
      .gte('criado_em', inicio)
      .lte('criado_em', fim);

    const faturamento = (vendas || []).reduce((s, v) => s + Number(v.total), 0);

    // Pagamentos por forma
    const porForma = {};
    for (const v of (vendas || [])) {
      porForma[v.forma_pagamento] = (porForma[v.forma_pagamento] || 0) + Number(v.total);
    }

    // Lançamentos do período
    const { data: lancamentos } = await supabase
      .from('financeiro_lancamentos')
      .select('tipo, valor, categoria')
      .eq('empresa_id', req.empresa_id)
      .gte('data', inicio.split('T')[0])
      .lte('data', fim.split('T')[0]);

    let receitas = faturamento;
    let despesas = 0;
    for (const l of (lancamentos || [])) {
      if (l.tipo === 'receita') receitas += Number(l.valor);
      else despesas += Number(l.valor);
    }

    res.json({
      mes, ano,
      faturamento,
      receitas,
      despesas,
      lucro: receitas - despesas,
      por_forma_pagamento: porForma,
      total_vendas: (vendas || []).length
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/financeiro/lancamentos?tipo=&data_inicio=&data_fim=
router.get('/lancamentos', async (req, res) => {
  try {
    const { tipo, data_inicio, data_fim, limit = 50 } = req.query;

    let q = supabase
      .from('financeiro_lancamentos')
      .select('*')
      .eq('empresa_id', req.empresa_id)
      .order('data', { ascending: false })
      .limit(Number(limit));

    if (tipo) q = q.eq('tipo', tipo);
    if (data_inicio) q = q.gte('data', data_inicio);
    if (data_fim) q = q.lte('data', data_fim);

    const { data, error } = await q;
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/financeiro/lancamentos
router.post('/lancamentos', async (req, res) => {
  try {
    const { tipo, valor, categoria, descricao, data, forma_pagamento } = req.body;
    if (!tipo || !valor || !data) {
      return res.status(400).json({ erro: 'tipo, valor e data são obrigatórios' });
    }
    if (!['receita', 'despesa'].includes(tipo)) {
      return res.status(400).json({ erro: 'tipo deve ser receita ou despesa' });
    }

    const { data: lancamento, error } = await supabase
      .from('financeiro_lancamentos')
      .insert({
        empresa_id: req.empresa_id,
        tipo,
        valor: Number(valor),
        categoria: categoria || null,
        descricao: descricao || null,
        data,
        forma_pagamento: forma_pagamento || null,
        usuario_id: req.usuario_id
      })
      .select()
      .single();

    if (error) return res.status(500).json({ erro: error.message });
    res.status(201).json(lancamento);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// PUT /api/financeiro/lancamentos/:id
router.put('/lancamentos/:id', async (req, res) => {
  try {
    const { tipo, valor, categoria, descricao, data, forma_pagamento } = req.body;
    const updates = {};
    if (tipo !== undefined) updates.tipo = tipo;
    if (valor !== undefined) updates.valor = Number(valor);
    if (categoria !== undefined) updates.categoria = categoria || null;
    if (descricao !== undefined) updates.descricao = descricao || null;
    if (data !== undefined) updates.data = data;
    if (forma_pagamento !== undefined) updates.forma_pagamento = forma_pagamento || null;

    const { data: lancamento, error } = await supabase
      .from('financeiro_lancamentos')
      .update(updates)
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id)
      .select()
      .single();

    if (error || !lancamento) return res.status(404).json({ erro: 'Lançamento não encontrado' });
    res.json(lancamento);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// DELETE /api/financeiro/lancamentos/:id
router.delete('/lancamentos/:id', async (req, res) => {
  try {
    await supabase.from('financeiro_lancamentos').delete().eq('id', req.params.id).eq('empresa_id', req.empresa_id);
    res.json({ mensagem: 'Lançamento removido' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
