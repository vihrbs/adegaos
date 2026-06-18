const router = require('express').Router();
const supabase = require('../utils/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/dashboard
router.get('/', async (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const inicioMes = hoje.slice(0, 7) + '-01';

    // Vendas de hoje
    const { data: vendasHoje } = await supabase
      .from('vendas')
      .select('total')
      .eq('empresa_id', req.empresa_id)
      .eq('status', 'concluida')
      .gte('criado_em', hoje + 'T00:00:00')
      .lte('criado_em', hoje + 'T23:59:59');

    // Vendas do mês
    const { data: vendasMes } = await supabase
      .from('vendas')
      .select('total')
      .eq('empresa_id', req.empresa_id)
      .eq('status', 'concluida')
      .gte('criado_em', inicioMes);

    // Pedidos pendentes
    const { count: pedidosPendentes } = await supabase
      .from('pedidos')
      .select('*', { count: 'exact', head: true })
      .eq('empresa_id', req.empresa_id)
      .in('status', ['pendente', 'confirmado', 'em_preparo']);

    // Total clientes
    const { count: totalClientes } = await supabase
      .from('clientes')
      .select('*', { count: 'exact', head: true })
      .eq('empresa_id', req.empresa_id);

    // Produtos com estoque baixo
    const { data: produtos } = await supabase
      .from('produtos')
      .select('estoque_atual, estoque_minimo')
      .eq('empresa_id', req.empresa_id)
      .eq('ativo', true);

    const estoqueBaixo = (produtos || []).filter(p => p.estoque_atual <= p.estoque_minimo).length;

    // Últimas 5 vendas
    const { data: ultimasVendas } = await supabase
      .from('vendas')
      .select('id, total, forma_pagamento, criado_em, clientes(nome)')
      .eq('empresa_id', req.empresa_id)
      .eq('status', 'concluida')
      .order('criado_em', { ascending: false })
      .limit(5);

    const faturamentoHoje = (vendasHoje || []).reduce((s, v) => s + Number(v.total), 0);
    const faturamentoMes  = (vendasMes || []).reduce((s, v) => s + Number(v.total), 0);

    res.json({
      faturamento_hoje: faturamentoHoje,
      faturamento_mes: faturamentoMes,
      qtd_vendas_hoje: (vendasHoje || []).length,
      qtd_vendas_mes: (vendasMes || []).length,
      pedidos_pendentes: pedidosPendentes || 0,
      total_clientes: totalClientes || 0,
      alertas_estoque: estoqueBaixo,
      ultimas_vendas: ultimasVendas || []
    });
  } catch (err) {
    console.error('[DASHBOARD]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
