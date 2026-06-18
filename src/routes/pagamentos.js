const router = require('express').Router();
const supabase = require('../utils/supabase');
const auth = require('../middleware/auth');

// POST /api/pagamentos/checkout (autenticado)
router.post('/checkout', auth, async (req, res) => {
  try {
    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(500).json({ erro: 'Pagamento não configurado. Contate o suporte.' });
    }

    const empresa = req.empresa;
    const plano = { titulo: 'BebidaOS Pro', valor: 59.99 };

    const body = {
      items: [{
        id: 'bebidaos-pro',
        title: plano.titulo,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: plano.valor
      }],
      back_urls: {
        success: `${process.env.FRONTEND_URL}/painel.html?pagamento=sucesso`,
        failure: `${process.env.FRONTEND_URL}/painel.html?pagamento=falha`,
        pending: `${process.env.FRONTEND_URL}/painel.html?pagamento=pendente`
      },
      auto_return: 'approved',
      notification_url: `${process.env.RAILWAY_PUBLIC_DOMAIN
        ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN
        : 'https://bebidaos-production.up.railway.app'}/api/pagamentos/webhook`,
      metadata: { empresa_id: empresa.id, empresa_nome: empresa.nome },
      statement_descriptor: 'BEBIDAOS'
    };

    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('[MP CHECKOUT]', data);
      return res.status(500).json({ erro: 'Erro ao criar preferência de pagamento' });
    }

    res.json({ url: data.init_point, id: data.id });
  } catch (err) {
    console.error('[CHECKOUT]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/pagamentos/webhook (sem auth — chamado pelo MP)
async function webhookMP(req, res) {
  try {
    res.sendStatus(200); // responde rápido pro MP

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (body.type !== 'payment') return;
    const paymentId = body.data?.id;
    if (!paymentId) return;

    // Consulta pagamento no MP
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    const pagamento = await mpRes.json();

    if (pagamento.status !== 'approved') return;

    const empresa_id = pagamento.metadata?.empresa_id;
    if (!empresa_id) return;

    // Ativa por 30 dias
    const expira = new Date();
    expira.setDate(expira.getDate() + 30);

    await supabase
      .from('empresas')
      .update({
        plano_ativo: true,
        plano_expira_em: expira.toISOString(),
        ultimo_pagamento_id: String(paymentId),
        ultimo_pagamento_em: new Date().toISOString()
      })
      .eq('id', empresa_id);

    console.log(`[WEBHOOK] Empresa ${empresa_id} ativada até ${expira.toLocaleDateString('pt-BR')}`);
  } catch (err) {
    console.error('[WEBHOOK]', err);
  }
}

// GET /api/pagamentos/status (autenticado)
router.get('/status', auth, (req, res) => {
  const empresa = req.empresa;
  const agora = new Date();
  const trialExpira = empresa.trial_expira_em ? new Date(empresa.trial_expira_em) : null;
  const planoExpira = empresa.plano_expira_em ? new Date(empresa.plano_expira_em) : null;

  const diasTrial = trialExpira ? Math.ceil((trialExpira - agora) / (1000 * 60 * 60 * 24)) : 0;

  res.json({
    plano_ativo: empresa.plano_ativo,
    trial_expira_em: empresa.trial_expira_em,
    plano_expira_em: empresa.plano_expira_em || null,
    dias_trial_restantes: Math.max(0, diasTrial),
    em_trial: !empresa.plano_ativo && trialExpira && trialExpira > agora
  });
});

module.exports = router;
module.exports.webhookMP = webhookMP;
