const router = require('express').Router();
const supabase = require('../utils/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/estoque/alertas — produtos abaixo do estoque mínimo
router.get('/alertas', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('produtos')
      .select('id, nome, icone, estoque_atual, estoque_minimo, unidade')
      .eq('empresa_id', req.empresa_id)
      .eq('ativo', true)
      .filter('estoque_atual', 'lte', 'estoque_minimo');

    // Supabase não suporta filter coluna vs coluna diretamente, fazemos no JS
    // A query acima pode não funcionar como esperado — usando abordagem segura:
    const { data: produtos, error: err2 } = await supabase
      .from('produtos')
      .select('id, nome, icone, estoque_atual, estoque_minimo, unidade')
      .eq('empresa_id', req.empresa_id)
      .eq('ativo', true);

    if (err2) return res.status(500).json({ erro: err2.message });

    const alertas = (produtos || []).filter(p => p.estoque_atual <= p.estoque_minimo);
    res.json(alertas);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/estoque/movimentacoes?produto_id=&tipo=&limit=
router.get('/movimentacoes', async (req, res) => {
  try {
    const { produto_id, tipo, limit = 50 } = req.query;

    let query = supabase
      .from('estoque_movimentacoes')
      .select('*, produtos(nome, icone)')
      .eq('empresa_id', req.empresa_id)
      .order('criado_em', { ascending: false })
      .limit(Number(limit));

    if (produto_id) query = query.eq('produto_id', produto_id);
    if (tipo) query = query.eq('tipo', tipo);

    const { data, error } = await query;
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/estoque/movimentacao — entrada ou saída manual
router.post('/movimentacao', async (req, res) => {
  try {
    const { produto_id, tipo, quantidade, motivo } = req.body;

    if (!produto_id || !tipo || !quantidade) {
      return res.status(400).json({ erro: 'produto_id, tipo e quantidade são obrigatórios' });
    }
    if (!['entrada', 'saida', 'ajuste'].includes(tipo)) {
      return res.status(400).json({ erro: 'tipo deve ser entrada, saida ou ajuste' });
    }
    if (Number(quantidade) <= 0) {
      return res.status(400).json({ erro: 'quantidade deve ser maior que zero' });
    }

    // Verifica produto pertence à empresa
    const { data: produto } = await supabase
      .from('produtos')
      .select('id, estoque_atual, nome')
      .eq('id', produto_id)
      .eq('empresa_id', req.empresa_id)
      .single();

    if (!produto) return res.status(404).json({ erro: 'Produto não encontrado' });

    // Calcula novo estoque
    let novoEstoque = produto.estoque_atual;
    if (tipo === 'entrada') novoEstoque += Number(quantidade);
    else if (tipo === 'saida') novoEstoque -= Number(quantidade);
    else novoEstoque = Number(quantidade); // ajuste

    if (novoEstoque < 0) {
      return res.status(400).json({ erro: 'Estoque ficaria negativo' });
    }

    // Registra movimentação
    const { data: mov, error: errMov } = await supabase
      .from('estoque_movimentacoes')
      .insert({
        empresa_id: req.empresa_id,
        produto_id,
        tipo,
        quantidade: Number(quantidade),
        estoque_anterior: produto.estoque_atual,
        estoque_novo: novoEstoque,
        motivo: motivo || null,
        usuario_id: req.usuario_id
      })
      .select()
      .single();

    if (errMov) return res.status(500).json({ erro: errMov.message });

    // Atualiza estoque do produto
    await supabase
      .from('produtos')
      .update({ estoque_atual: novoEstoque })
      .eq('id', produto_id);

    res.status(201).json({ movimentacao: mov, estoque_atual: novoEstoque });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
