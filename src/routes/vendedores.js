// ── VENDEDORES ──────────────────────────
const routerV = require('express').Router();
const supabase = require('../utils/supabase');
const auth = require('../middleware/auth');

routerV.use(auth);

routerV.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vendedores')
      .select('*')
      .eq('empresa_id', req.empresa_id)
      .order('nome');
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data);
  } catch (e) { res.status(500).json({ erro: 'Erro interno' }); }
});

routerV.post('/', async (req, res) => {
  try {
    const { nome, telefone, email, percentual_comissao } = req.body;
    if (!nome) return res.status(400).json({ erro: 'nome é obrigatório' });
    const { data, error } = await supabase.from('vendedores')
      .insert({ empresa_id: req.empresa_id, nome: nome.trim(), telefone: telefone || null, email: email || null, percentual_comissao: Number(percentual_comissao || 0), ativo: true })
      .select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ erro: 'Erro interno' }); }
});

routerV.put('/:id', async (req, res) => {
  try {
    const { nome, telefone, email, percentual_comissao, ativo } = req.body;
    const updates = {};
    if (nome !== undefined) updates.nome = nome.trim();
    if (telefone !== undefined) updates.telefone = telefone || null;
    if (email !== undefined) updates.email = email || null;
    if (percentual_comissao !== undefined) updates.percentual_comissao = Number(percentual_comissao);
    if (ativo !== undefined) updates.ativo = ativo;
    const { data, error } = await supabase.from('vendedores').update(updates).eq('id', req.params.id).eq('empresa_id', req.empresa_id).select().single();
    if (error || !data) return res.status(404).json({ erro: 'Vendedor não encontrado' });
    res.json(data);
  } catch (e) { res.status(500).json({ erro: 'Erro interno' }); }
});

routerV.delete('/:id', async (req, res) => {
  try {
    await supabase.from('vendedores').update({ ativo: false }).eq('id', req.params.id).eq('empresa_id', req.empresa_id);
    res.json({ mensagem: 'Vendedor desativado' });
  } catch (e) { res.status(500).json({ erro: 'Erro interno' }); }
});

module.exports = routerV;
