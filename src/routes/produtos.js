const router = require('express').Router();
const supabase = require('../utils/supabase');
const auth = require('../middleware/auth');

// Todos os endpoints exigem autenticação
router.use(auth);

// GET /api/produtos?busca=&categoria_id=&ativo=
router.get('/', async (req, res) => {
  try {
    const { busca, categoria_id, ativo } = req.query;

    let query = supabase
      .from('produtos')
      .select('*, categorias(nome)')
      .eq('empresa_id', req.empresa_id)
      .order('nome');

    if (busca) query = query.ilike('nome', `%${busca}%`);
    if (categoria_id) query = query.eq('categoria_id', categoria_id);
    if (ativo !== undefined) query = query.eq('ativo', ativo === 'true');

    const { data, error } = await query;
    if (error) return res.status(500).json({ erro: error.message });

    res.json(data);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/produtos/:id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('produtos')
      .select('*, categorias(nome)')
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id)
      .single();

    if (error || !data) return res.status(404).json({ erro: 'Produto não encontrado' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/produtos
router.post('/', async (req, res) => {
  try {
    const {
      nome, descricao, codigo_barras, categoria_id,
      preco_custo, preco_venda, estoque_atual, estoque_minimo,
      unidade, icone, ativo
    } = req.body;

    if (!nome || preco_venda === undefined) {
      return res.status(400).json({ erro: 'nome e preco_venda são obrigatórios' });
    }

    const { data, error } = await supabase
      .from('produtos')
      .insert({
        empresa_id: req.empresa_id,
        nome: nome.trim(),
        descricao: descricao || null,
        codigo_barras: codigo_barras || null,
        categoria_id: categoria_id || null,        // null, nunca string vazia
        preco_custo: preco_custo || 0,
        preco_venda: Number(preco_venda),
        estoque_atual: estoque_atual || 0,
        estoque_minimo: estoque_minimo || 0,
        unidade: unidade || 'un',
        icone: icone || '🍷',
        ativo: ativo !== false
      })
      .select()
      .single();

    if (error) return res.status(500).json({ erro: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// PUT /api/produtos/:id
router.put('/:id', async (req, res) => {
  try {
    // Verifica se o produto pertence à empresa
    const { data: existe } = await supabase
      .from('produtos')
      .select('id')
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id)
      .single();

    if (!existe) return res.status(404).json({ erro: 'Produto não encontrado' });

    const {
      nome, descricao, codigo_barras, categoria_id,
      preco_custo, preco_venda, estoque_minimo,
      unidade, icone, ativo
    } = req.body;

    const updates = {};
    if (nome !== undefined) updates.nome = nome.trim();
    if (descricao !== undefined) updates.descricao = descricao || null;
    if (codigo_barras !== undefined) updates.codigo_barras = codigo_barras || null;
    if (categoria_id !== undefined) updates.categoria_id = categoria_id || null;
    if (preco_custo !== undefined) updates.preco_custo = Number(preco_custo);
    if (preco_venda !== undefined) updates.preco_venda = Number(preco_venda);
    if (estoque_minimo !== undefined) updates.estoque_minimo = Number(estoque_minimo);
    if (unidade !== undefined) updates.unidade = unidade;
    if (icone !== undefined) updates.icone = icone;
    if (ativo !== undefined) updates.ativo = ativo;

    const { data, error } = await supabase
      .from('produtos')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(500).json({ erro: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// DELETE /api/produtos/:id
router.delete('/:id', async (req, res) => {
  try {
    const { data: existe } = await supabase
      .from('produtos')
      .select('id')
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id)
      .single();

    if (!existe) return res.status(404).json({ erro: 'Produto não encontrado' });

    // Soft delete: desativa em vez de apagar
    await supabase
      .from('produtos')
      .update({ ativo: false })
      .eq('id', req.params.id);

    res.json({ mensagem: 'Produto desativado' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
