const router = require('express').Router();
const supabase = require('../utils/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/crediario — lista todos os crediários
router.get('/', async (req, res) => {
  try {
    const { status, cliente_id } = req.query;

    let q = supabase
      .from('crediarios')
      .select('*, clientes(nome, telefone)')
      .eq('empresa_id', req.empresa_id)
      .order('criado_em', { ascending: false });

    if (status) q = q.eq('status', status);
    if (cliente_id) q = q.eq('cliente_id', cliente_id);

    const { data, error } = await q;
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/crediario/resumo — total em aberto
router.get('/resumo', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('crediarios')
      .select('valor_total, valor_pago, valor_restante')
      .eq('empresa_id', req.empresa_id)
      .eq('status', 'aberto');

    if (error) return res.status(500).json({ erro: error.message });

    const total_em_aberto = (data || []).reduce((s, c) => s + Number(c.valor_restante), 0);
    const total_a_receber = (data || []).reduce((s, c) => s + Number(c.valor_total), 0);
    const total_recebido  = (data || []).reduce((s, c) => s + Number(c.valor_pago), 0);

    res.json({
      qtd_crediarios: (data || []).length,
      total_em_aberto,
      total_a_receber,
      total_recebido
    });
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/crediario/:id — detalhe com parcelas e pagamentos
router.get('/:id', async (req, res) => {
  try {
    const { data: crediario, error } = await supabase
      .from('crediarios')
      .select('*, clientes(nome, telefone, email)')
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id)
      .single();

    if (error || !crediario) return res.status(404).json({ erro: 'Crediário não encontrado' });

    const { data: parcelas } = await supabase
      .from('crediario_parcelas')
      .select('*')
      .eq('crediario_id', crediario.id)
      .order('numero');

    const { data: pagamentos } = await supabase
      .from('crediario_pagamentos')
      .select('*')
      .eq('crediario_id', crediario.id)
      .order('criado_em', { ascending: false });

    res.json({ ...crediario, parcelas: parcelas || [], pagamentos: pagamentos || [] });
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/crediario — criar crediário manualmente ou via venda
router.post('/', async (req, res) => {
  try {
    const {
      cliente_id,
      venda_id,
      descricao,
      valor_total,
      num_parcelas,
      data_primeira_parcela,
      observacoes
    } = req.body;

    if (!cliente_id || !valor_total) {
      return res.status(400).json({ erro: 'cliente_id e valor_total são obrigatórios' });
    }

    const parcelas = parseInt(num_parcelas || 1);
    const valorParcela = Number(valor_total) / parcelas;

    // Cria o crediário
    const { data: crediario, error } = await supabase
      .from('crediarios')
      .insert({
        empresa_id:     req.empresa_id,
        cliente_id,
        venda_id:       venda_id || null,
        usuario_id:     req.usuario_id,
        descricao:      descricao || null,
        valor_total:    Number(valor_total),
        valor_pago:     0,
        valor_restante: Number(valor_total),
        num_parcelas:   parcelas,
        status:         'aberto',
        observacoes:    observacoes || null
      })
      .select()
      .single();

    if (error) return res.status(500).json({ erro: error.message });

    // Cria as parcelas
    const parcelasParaInserir = [];
    const dataBase = data_primeira_parcela ? new Date(data_primeira_parcela) : new Date();

    for (let i = 0; i < parcelas; i++) {
      const vencimento = new Date(dataBase);
      vencimento.setMonth(vencimento.getMonth() + i);

      parcelasParaInserir.push({
        empresa_id:   req.empresa_id,
        crediario_id: crediario.id,
        numero:       i + 1,
        valor:        i === parcelas - 1
          ? Number(valor_total) - (valorParcela * (parcelas - 1)) // última parcela pega o resto
          : valorParcela,
        valor_pago:   0,
        vencimento:   vencimento.toISOString().split('T')[0],
        status:       'aberta'
      });
    }

    await supabase.from('crediario_parcelas').insert(parcelasParaInserir);

    res.status(201).json(crediario);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/crediario/:id/pagar — registrar pagamento (total ou parcial)
router.post('/:id/pagar', async (req, res) => {
  try {
    const { valor, forma_pagamento, parcela_id, observacoes } = req.body;

    if (!valor || Number(valor) <= 0) {
      return res.status(400).json({ erro: 'valor é obrigatório e deve ser maior que zero' });
    }

    // Busca crediário
    const { data: crediario } = await supabase
      .from('crediarios')
      .select('*')
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id)
      .single();

    if (!crediario) return res.status(404).json({ erro: 'Crediário não encontrado' });
    if (crediario.status === 'pago') return res.status(400).json({ erro: 'Crediário já está pago' });
    if (crediario.status === 'cancelado') return res.status(400).json({ erro: 'Crediário cancelado' });

    const valorPagamento = Number(valor);
    if (valorPagamento > crediario.valor_restante) {
      return res.status(400).json({
        erro: `Valor maior que o restante. Máximo: R$ ${Number(crediario.valor_restante).toFixed(2)}`
      });
    }

    // Registra o pagamento
    await supabase.from('crediario_pagamentos').insert({
      empresa_id:     req.empresa_id,
      crediario_id:   crediario.id,
      parcela_id:     parcela_id || null,
      usuario_id:     req.usuario_id,
      valor:          valorPagamento,
      forma_pagamento: forma_pagamento || 'dinheiro',
      observacoes:    observacoes || null
    });

    // Atualiza parcela se foi especificada
    if (parcela_id) {
      const { data: parcela } = await supabase
        .from('crediario_parcelas')
        .select('*')
        .eq('id', parcela_id)
        .single();

      if (parcela) {
        const novoPago = Number(parcela.valor_pago) + valorPagamento;
        const novoStatus = novoPago >= Number(parcela.valor)
          ? 'paga'
          : 'paga_parcial';

        await supabase
          .from('crediario_parcelas')
          .update({
            valor_pago: novoPago,
            status: novoStatus,
            pago_em: novoStatus === 'paga' ? new Date().toISOString() : null
          })
          .eq('id', parcela_id);
      }
    } else {
      // Se não especificou parcela, abate nas parcelas em ordem
      const { data: parcelas } = await supabase
        .from('crediario_parcelas')
        .select('*')
        .eq('crediario_id', crediario.id)
        .in('status', ['aberta', 'paga_parcial'])
        .order('numero');

      let restante = valorPagamento;
      for (const parcela of (parcelas || [])) {
        if (restante <= 0) break;
        const falta = Number(parcela.valor) - Number(parcela.valor_pago);
        const abater = Math.min(falta, restante);
        const novoPago = Number(parcela.valor_pago) + abater;
        const novoStatus = novoPago >= Number(parcela.valor) ? 'paga' : 'paga_parcial';

        await supabase
          .from('crediario_parcelas')
          .update({
            valor_pago: novoPago,
            status: novoStatus,
            pago_em: novoStatus === 'paga' ? new Date().toISOString() : null
          })
          .eq('id', parcela.id);

        restante -= abater;
      }
    }

    // Atualiza totais do crediário
    const novoValorPago = Number(crediario.valor_pago) + valorPagamento;
    const novoValorRestante = Number(crediario.valor_total) - novoValorPago;
    const novoStatus = novoValorRestante <= 0 ? 'pago' : 'aberto';

    await supabase
      .from('crediarios')
      .update({
        valor_pago:     novoValorPago,
        valor_restante: Math.max(0, novoValorRestante),
        status:         novoStatus,
        atualizado_em:  new Date().toISOString()
      })
      .eq('id', crediario.id);

    // Lança no financeiro automaticamente
    await supabase.from('financeiro_lancamentos').insert({
      empresa_id:     req.empresa_id,
      usuario_id:     req.usuario_id,
      tipo:           'receita',
      valor:          valorPagamento,
      categoria:      'Crediário',
      descricao:      `Pagamento crediário — ${crediario.descricao || 'Cliente'}`,
      data:           new Date().toISOString().split('T')[0],
      forma_pagamento: forma_pagamento || 'dinheiro'
    });

    res.json({
      mensagem: novoStatus === 'pago' ? 'Crediário quitado!' : 'Pagamento registrado!',
      valor_pago:     novoValorPago,
      valor_restante: Math.max(0, novoValorRestante),
      status:         novoStatus
    });
  } catch (e) {
    console.error('[CREDIARIO PAGAR]', e);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// DELETE /api/crediario/:id — cancelar
router.delete('/:id', async (req, res) => {
  try {
    await supabase
      .from('crediarios')
      .update({ status: 'cancelado' })
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id);

    res.json({ mensagem: 'Crediário cancelado' });
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
