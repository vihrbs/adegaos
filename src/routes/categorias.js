const router = require('express').Router();
const supabase = require('../utils/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/categorias
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('categorias')
      .select('*')
      .eq('empresa_id', req.empresa_id)
      .order('nome');

    if (error) return res.status(500).json({ erro: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/categorias
router.post('/', async (req, res) => {
  try {
    const { nome, icone } = req.body;
    if (!nome) return res.status(400).json({ erro: 'nome é obrigatório' });

    const { data, error } = await supabase
      .from('categorias')
      .insert({ empresa_id: req.empresa_id, nome: nome.trim(), icone: icone || '📦' })
      .select()
      .single();

    if (error) return res.status(500).json({ erro: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// PUT /api/categorias/:id
router.put('/:id', async (req, res) => {
  try {
    const { nome, icone } = req.body;
    const updates = {};
    if (nome) updates.nome = nome.trim();
    if (icone) updates.icone = icone;

    const { data, error } = await supabase
      .from('categorias')
      .update(updates)
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ erro: 'Categoria não encontrada' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// DELETE /api/categorias/:id
router.delete('/:id', async (req, res) => {
  try {
    await supabase
      .from('categorias')
      .delete()
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id);

    res.json({ mensagem: 'Categoria removida' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
