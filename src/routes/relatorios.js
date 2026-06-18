const router = require('express').Router();
const supabase = require('../utils/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/relatorios/vendas?data_inicio=&data_fim=
router.get('/vendas', async (req, res) => {
  try {
    const { data_inicio, data_fim } = req.query;
    if (!data_inicio || !data_fim) return res.status(400).json({ erro: 'data_inicio e data_fim são obrigatórios' });

    const { data: vendas } = await supabase
      .from('vendas')
      .select('id, total, forma_pagamento, criado_em, clientes(nome), vendedores(nome)')
      .eq('empresa_id', req.empresa_id)
      .eq('status', 'concluida')
      .gte('criado_em', data_inicio)
      .lte('criado_em', data_fim + 'T23:59:59')
      .order('criado_em');

    const total_geral = (vendas || []).reduce((s, v) => s + Number(v.total), 0);
    const por_forma = {};
    for (const v of (vendas || [])) {
      por_forma[v.forma_pagamento] = (por_forma[v.forma_pagamento] || 0) + Number(v.total);
    }

    // Agrupa por dia
    const por_dia = {};
    for (const v of (vendas || [])) {
      const dia = v.criado_em.split('T')[0];
      por_dia[dia] = (por_dia[dia] || 0) + Number(v.total);
    }

    res.json({
      total_geral,
      qtd_vendas: (vendas || []).length,
      ticket_medio: (vendas || []).length > 0 ? total_geral / (vendas || []).length : 0,
      por_forma_pagamento: por_forma,
      por_dia: Object.entries(por_dia).map(([data, total]) => ({ data, total })),
      vendas: vendas || []
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/relatorios/estoque
router.get('/estoque', async (req, res) => {
  try {
    const { data: produtos } = await supabase
      .from('produtos')
      .select('*, categorias(nome)')
      .eq('empresa_id', req.empresa_id)
      .eq('ativo', true)
      .order('nome');

    const abaixo_minimo = (produtos || []).filter(p => p.estoque_atual <= p.estoque_minimo);
    const valor_total_estoque = (produtos || []).reduce((s, p) => s + (p.estoque_atual * p.preco_custo), 0);

    res.json({
      total_produtos: (produtos || []).length,
      valor_total_estoque,
      alertas_reposicao: abaixo_minimo.length,
      produtos: produtos || [],
      produtos_criticos: abaixo_minimo
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/relatorios/financeiro?mes=&ano=
router.get('/financeiro', async (req, res) => {
  try {
    const agora = new Date();
    const mes = parseInt(req.query.mes || agora.getMonth() + 1);
    const ano = parseInt(req.query.ano || agora.getFullYear());

    // Últimos 6 meses de faturamento
    const historico = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(ano, mes - 1 - i, 1);
      const m = d.getMonth() + 1;
      const a = d.getFullYear();
      const inicio = `${a}-${String(m).padStart(2, '0')}-01`;
      const fim    = `${a}-${String(m).padStart(2, '0')}-31T23:59:59`;

      const { data: vs } = await supabase
        .from('vendas')
        .select('total')
        .eq('empresa_id', req.empresa_id)
        .eq('status', 'concluida')
        .gte('criado_em', inicio)
        .lte('criado_em', fim);

      const total = (vs || []).reduce((s, v) => s + Number(v.total), 0);
      historico.push({ mes: m, ano: a, total, label: `${String(m).padStart(2, '0')}/${a}` });
    }

    res.json({ historico });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/relatorios/top-produtos?data_inicio=&data_fim=&limit=
router.get('/top-produtos', async (req, res) => {
  try {
    const { data_inicio, data_fim, limit = 10 } = req.query;

    const { data: itens } = await supabase
      .from('venda_itens')
      .select('produto_id, quantidade, total, produtos(nome, icone)')
      .eq('empresa_id', req.empresa_id);

    // Agrupa por produto
    const mapa = {};
    for (const item of (itens || [])) {
      const id = item.produto_id;
      if (!mapa[id]) {
        mapa[id] = {
          produto_id: id,
          nome: item.produtos?.nome || 'Desconhecido',
          icone: item.produtos?.icone || '🍷',
          qtd_vendida: 0,
          total_faturado: 0
        };
      }
      mapa[id].qtd_vendida += Number(item.quantidade);
      mapa[id].total_faturado += Number(item.total);
    }

    const top = Object.values(mapa)
      .sort((a, b) => b.total_faturado - a.total_faturado)
      .slice(0, Number(limit));

    res.json(top);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
