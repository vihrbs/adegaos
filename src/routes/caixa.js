const router = require('express').Router();
const supabase = require('../utils/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/caixa/atual — retorna o caixa aberto, se houver
router.get('/atual', async (req, res) => {
  try {
    const { data: caixa } = await supabase
      .from('caixas')
      .select('*')
      .eq('empresa_id', req.empresa_id)
      .eq('status', 'aberto')
      .order('aberto_em', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!caixa) return res.json(null);

    // Calcula valores em tempo real
    const calculo = await calcularValoresCaixa(req.empresa_id, caixa);

    const { data: movimentacoes } = await supabase
      .from('caixa_movimentacoes')
      .select('*')
      .eq('caixa_id', caixa.id)
      .order('criado_em', { ascending: false });

    res.json({ ...caixa, ...calculo, movimentacoes: movimentacoes || [] });
  } catch (err) {
    console.error('[CAIXA ATUAL]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// Função auxiliar — calcula valores esperados do caixa
async function calcularValoresCaixa(empresa_id, caixa) {
  // Vendas em dinheiro desde a abertura
  const { data: vendas } = await supabase
    .from('vendas')
    .select('total, forma_pagamento')
    .eq('empresa_id', empresa_id)
    .eq('status', 'concluida')
    .gte('criado_em', caixa.aberto_em);

  const vendasDinheiro = (vendas || [])
    .filter(v => v.forma_pagamento === 'dinheiro')
    .reduce((s, v) => s + Number(v.total), 0);

  const totalVendas = (vendas || []).reduce((s, v) => s + Number(v.total), 0);

  // Pagamentos de crediário em dinheiro desde a abertura
  const { data: pagCred } = await supabase
    .from('crediario_pagamentos')
    .select('valor, forma_pagamento')
    .eq('empresa_id', empresa_id)
    .gte('criado_em', caixa.aberto_em);

  const credDinheiro = (pagCred || [])
    .filter(p => p.forma_pagamento === 'dinheiro')
    .reduce((s, p) => s + Number(p.valor), 0);

  // Sangrias e suprimentos
  const { data: movs } = await supabase
    .from('caixa_movimentacoes')
    .select('tipo, valor')
    .eq('caixa_id', caixa.id);

  const sangrias = (movs || []).filter(m => m.tipo === 'sangria').reduce((s, m) => s + Number(m.valor), 0);
  const suprimentos = (movs || []).filter(m => m.tipo === 'suprimento').reduce((s, m) => s + Number(m.valor), 0);

  const valorEsperado = Number(caixa.valor_abertura) + vendasDinheiro + credDinheiro + suprimentos - sangrias;

  return {
    vendas_dinheiro: vendasDinheiro,
    crediario_dinheiro: credDinheiro,
    total_vendas_periodo: totalVendas,
    qtd_vendas_periodo: (vendas || []).length,
    sangrias,
    suprimentos,
    valor_esperado: valorEsperado
  };
}

// POST /api/caixa/abrir
router.post('/abrir', async (req, res) => {
  try {
    const { valor_abertura, observacoes } = req.body;

    // Verifica se já tem caixa aberto
    const { data: existente } = await supabase
      .from('caixas')
      .select('id')
      .eq('empresa_id', req.empresa_id)
      .eq('status', 'aberto')
      .maybeSingle();

    if (existente) {
      return res.status(400).json({ erro: 'Já existe um caixa aberto' });
    }

    const { data: caixa, error } = await supabase
      .from('caixas')
      .insert({
        empresa_id:          req.empresa_id,
        usuario_abertura_id: req.usuario_id,
        valor_abertura:      Number(valor_abertura || 0),
        observacoes_abertura: observacoes || null,
        status:              'aberto'
      })
      .select()
      .single();

    if (error) return res.status(500).json({ erro: error.message });
    res.status(201).json(caixa);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/caixa/movimentacao — sangria ou suprimento
router.post('/movimentacao', async (req, res) => {
  try {
    const { tipo, valor, motivo } = req.body;

    if (!['sangria', 'suprimento'].includes(tipo)) {
      return res.status(400).json({ erro: 'tipo deve ser sangria ou suprimento' });
    }
    if (!valor || Number(valor) <= 0) {
      return res.status(400).json({ erro: 'valor deve ser maior que zero' });
    }

    const { data: caixa } = await supabase
      .from('caixas')
      .select('id')
      .eq('empresa_id', req.empresa_id)
      .eq('status', 'aberto')
      .maybeSingle();

    if (!caixa) return res.status(400).json({ erro: 'Nenhum caixa aberto' });

    const { data: mov, error } = await supabase
      .from('caixa_movimentacoes')
      .insert({
        empresa_id: req.empresa_id,
        caixa_id:   caixa.id,
        usuario_id: req.usuario_id,
        tipo,
        valor: Number(valor),
        motivo: motivo || null
      })
      .select()
      .single();

    if (error) return res.status(500).json({ erro: error.message });

    // Sangria gera lançamento de despesa no financeiro
    if (tipo === 'sangria') {
      await supabase.from('financeiro_lancamentos').insert({
        empresa_id: req.empresa_id,
        usuario_id: req.usuario_id,
        tipo:       'despesa',
        valor:      Number(valor),
        categoria:  'Sangria de Caixa',
        descricao:  motivo || 'Retirada de caixa',
        data:       new Date().toISOString().split('T')[0],
        forma_pagamento: 'dinheiro'
      });
    }

    res.status(201).json(mov);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/caixa/fechar
router.post('/fechar', async (req, res) => {
  try {
    const { valor_fechamento_informado, observacoes } = req.body;

    if (valor_fechamento_informado === undefined || valor_fechamento_informado === null) {
      return res.status(400).json({ erro: 'valor_fechamento_informado é obrigatório' });
    }

    const { data: caixa } = await supabase
      .from('caixas')
      .select('*')
      .eq('empresa_id', req.empresa_id)
      .eq('status', 'aberto')
      .maybeSingle();

    if (!caixa) return res.status(400).json({ erro: 'Nenhum caixa aberto' });

    const calculo = await calcularValoresCaixa(req.empresa_id, caixa);
    const diferenca = Number(valor_fechamento_informado) - calculo.valor_esperado;

    const { data: atualizado, error } = await supabase
      .from('caixas')
      .update({
        usuario_fechamento_id:      req.usuario_id,
        valor_fechamento_informado: Number(valor_fechamento_informado),
        valor_fechamento_calculado: calculo.valor_esperado,
        diferenca,
        status:                    'fechado',
        observacoes_fechamento:    observacoes || null,
        fechado_em:                new Date().toISOString()
      })
      .eq('id', caixa.id)
      .select()
      .single();

    if (error) return res.status(500).json({ erro: error.message });

    res.json({
      ...atualizado,
      ...calculo,
      mensagem: diferenca === 0
        ? 'Caixa fechado! Valores conferem perfeitamente.'
        : diferenca > 0
        ? `Caixa fechado com sobra de R$ ${diferenca.toFixed(2)}`
        : `Caixa fechado com falta de R$ ${Math.abs(diferenca).toFixed(2)}`
    });
  } catch (err) {
    console.error('[CAIXA FECHAR]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/caixa/historico
router.get('/historico', async (req, res) => {
  try {
    const { limit = 30 } = req.query;

    const { data, error } = await supabase
      .from('caixas')
      .select('*')
      .eq('empresa_id', req.empresa_id)
      .eq('status', 'fechado')
      .order('fechado_em', { ascending: false })
      .limit(Number(limit));

    if (error) return res.status(500).json({ erro: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
