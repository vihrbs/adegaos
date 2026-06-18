// ─────────────────────────────────────
// FORNECEDORES
// ─────────────────────────────────────
const routerF = require('express').Router();
const supabase = require('../utils/supabase');
const auth = require('../middleware/auth');

routerF.use(auth);

routerF.get('/', async (req, res) => {
  try {
    const { busca } = req.query;
    let q = supabase.from('fornecedores').select('*').eq('empresa_id', req.empresa_id).order('nome');
    if (busca) q = q.ilike('nome', `%${busca}%`);
    const { data, error } = await q;
    if (error) return res.status(500).json({ erro: error.message });
    res.json(data);
  } catch (e) { res.status(500).json({ erro: 'Erro interno' }); }
});

routerF.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('fornecedores').select('*').eq('id', req.params.id).eq('empresa_id', req.empresa_id).single();
    if (error || !data) return res.status(404).json({ erro: 'Fornecedor não encontrado' });
    res.json(data);
  } catch (e) { res.status(500).json({ erro: 'Erro interno' }); }
});

routerF.post('/', async (req, res) => {
  try {
    const { nome, cnpj, telefone, email, contato, endereco, observacoes } = req.body;
    if (!nome) return res.status(400).json({ erro: 'nome é obrigatório' });
    const { data, error } = await supabase.from('fornecedores')
      .insert({ empresa_id: req.empresa_id, nome: nome.trim(), cnpj: cnpj || null, telefone: telefone || null, email: email || null, contato: contato || null, endereco: endereco || null, observacoes: observacoes || null })
      .select().single();
    if (error) return res.status(500).json({ erro: error.message });
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ erro: 'Erro interno' }); }
});

routerF.put('/:id', async (req, res) => {
  try {
    const { nome, cnpj, telefone, email, contato, endereco, observacoes } = req.body;
    const updates = {};
    if (nome !== undefined) updates.nome = nome.trim();
    if (cnpj !== undefined) updates.cnpj = cnpj || null;
    if (telefone !== undefined) updates.telefone = telefone || null;
    if (email !== undefined) updates.email = email || null;
    if (contato !== undefined) updates.contato = contato || null;
    if (endereco !== undefined) updates.endereco = endereco || null;
    if (observacoes !== undefined) updates.observacoes = observacoes || null;
    const { data, error } = await supabase.from('fornecedores').update(updates).eq('id', req.params.id).eq('empresa_id', req.empresa_id).select().single();
    if (error || !data) return res.status(404).json({ erro: 'Fornecedor não encontrado' });
    res.json(data);
  } catch (e) { res.status(500).json({ erro: 'Erro interno' }); }
});

routerF.delete('/:id', async (req, res) => {
  try {
    await supabase.from('fornecedores').delete().eq('id', req.params.id).eq('empresa_id', req.empresa_id);
    res.json({ mensagem: 'Fornecedor removido' });
  } catch (e) { res.status(500).json({ erro: 'Erro interno' }); }
});

module.exports = routerF;
