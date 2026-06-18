const router = require('express').Router();
const supabase = require('../utils/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/clientes?busca=&limit=&offset=
router.get('/', async (req, res) => {
  try {
    const { busca, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('clientes')
      .select('*', { count: 'exact' })
      .eq('empresa_id', req.empresa_id)
      .order('nome')
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (busca) {
      query = query.or(`nome.ilike.%${busca}%,telefone.ilike.%${busca}%,email.ilike.%${busca}%`);
    }

    const { data, count, error } = await query;
    if (error) return res.status(500).json({ erro: error.message });

    res.json({ clientes: data, total: count });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/clientes/:id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id)
      .single();

    if (error || !data) return res.status(404).json({ erro: 'Cliente não encontrado' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/clientes
router.post('/', async (req, res) => {
  try {
    const { nome, telefone, email, cpf, endereco, observacoes } = req.body;

    if (!nome) return res.status(400).json({ erro: 'nome é obrigatório' });

    const { data, error } = await supabase
      .from('clientes')
      .insert({
        empresa_id: req.empresa_id,
        nome: nome.trim(),
        telefone: telefone || null,
        email: email ? email.toLowerCase().trim() : null,
        cpf: cpf || null,
        endereco: endereco || null,
        observacoes: observacoes || null,
        total_compras: 0,
        total_gasto: 0
      })
      .select()
      .single();

    if (error) return res.status(500).json({ erro: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// PUT /api/clientes/:id
router.put('/:id', async (req, res) => {
  try {
    const { nome, telefone, email, cpf, endereco, observacoes } = req.body;
    const updates = {};
    if (nome !== undefined) updates.nome = nome.trim();
    if (telefone !== undefined) updates.telefone = telefone || null;
    if (email !== undefined) updates.email = email ? email.toLowerCase().trim() : null;
    if (cpf !== undefined) updates.cpf = cpf || null;
    if (endereco !== undefined) updates.endereco = endereco || null;
    if (observacoes !== undefined) updates.observacoes = observacoes || null;

    const { data, error } = await supabase
      .from('clientes')
      .update(updates)
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ erro: 'Cliente não encontrado' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// DELETE /api/clientes/:id
router.delete('/:id', async (req, res) => {
  try {
    await supabase
      .from('clientes')
      .delete()
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id);

    res.json({ mensagem: 'Cliente removido' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/clientes/:id/historico — histórico de compras do cliente
router.get('/:id/historico', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vendas')
      .select('id, total, forma_pagamento, criado_em, status')
      .eq('empresa_id', req.empresa_id)
      .eq('cliente_id', req.params.id)
      .order('criado_em', { ascending: false })
      .limit(20);

    if (error) return res.status(500).json({ erro: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
