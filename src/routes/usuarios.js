const router = require('express').Router();
const bcrypt = require('bcryptjs');
const supabase = require('../utils/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// Apenas admin pode gerenciar usuários
function soAdmin(req, res, next) {
  if (req.empresa && req.empresa._role !== 'admin' && req._role !== 'admin') {
    // Busca role do usuário atual
  }
  next(); // validação feita nas rotas individualmente
}

async function getRole(usuario_id) {
  const { data } = await supabase
    .from('usuarios')
    .select('role')
    .eq('id', usuario_id)
    .single();
  return data?.role || 'operador';
}

// GET /api/usuarios — lista usuários da empresa
router.get('/', async (req, res) => {
  try {
    const role = await getRole(req.usuario_id);
    if (role !== 'admin') return res.status(403).json({ erro: 'Apenas administradores podem ver usuários' });

    const { data, error } = await supabase
      .from('usuarios')
      .select('id, nome, email, role, ativo, criado_em')
      .eq('empresa_id', req.empresa_id)
      .order('nome');

    if (error) return res.status(500).json({ erro: error.message });

    // Busca permissões de cada operador
    const { data: perms } = await supabase
      .from('usuario_permissoes')
      .select('usuario_id, modulos')
      .eq('empresa_id', req.empresa_id);

    const mapPerms = {};
    (perms || []).forEach(p => { mapPerms[p.usuario_id] = p.modulos; });

    const result = (data || []).map(u => ({
      ...u,
      modulos: u.role === 'admin'
        ? ['dashboard','pdv','caixa','estoque','clientes','vendas','pedidos','financeiro','fornecedores','vendedores','relatorios','crediario','configuracoes']
        : (mapPerms[u.id] || [])
    }));

    res.json(result);
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/usuarios — criar operador
router.post('/', async (req, res) => {
  try {
    const role = await getRole(req.usuario_id);
    if (role !== 'admin') return res.status(403).json({ erro: 'Apenas administradores podem criar usuários' });

    const { nome, email, senha, modulos } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ erro: 'nome, email e senha são obrigatórios' });
    if (!senha || senha.length < 6) return res.status(400).json({ erro: 'Senha deve ter ao menos 6 caracteres' });

    // Verifica se email já existe
    const { data: existe } = await supabase
      .from('usuarios')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();
    if (existe) return res.status(409).json({ erro: 'E-mail já cadastrado' });

    const hash = await bcrypt.hash(senha, 10);

    const { data: usuario, error } = await supabase
      .from('usuarios')
      .insert({
        empresa_id: req.empresa_id,
        nome: nome.trim(),
        email: email.toLowerCase().trim(),
        senha_hash: hash,
        role: 'operador',
        ativo: true
      })
      .select('id, nome, email, role, ativo')
      .single();

    if (error) return res.status(500).json({ erro: error.message });

    // Salva permissões
    const modulosLiberados = Array.isArray(modulos) ? modulos : [];
    await supabase
      .from('usuario_permissoes')
      .upsert({
        empresa_id: req.empresa_id,
        usuario_id: usuario.id,
        modulos: modulosLiberados,
        atualizado_em: new Date().toISOString()
      }, { onConflict: 'usuario_id' });

    res.status(201).json({ ...usuario, modulos: modulosLiberados });
  } catch (e) {
    console.error('[USUARIOS POST]', e);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// PUT /api/usuarios/:id — atualizar operador (nome, senha, modulos, ativo)
router.put('/:id', async (req, res) => {
  try {
    const role = await getRole(req.usuario_id);
    if (role !== 'admin') return res.status(403).json({ erro: 'Apenas administradores podem editar usuários' });

    const { nome, senha, modulos, ativo } = req.body;

    // Verifica se pertence à empresa
    const { data: existe } = await supabase
      .from('usuarios')
      .select('id, role')
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa_id)
      .single();

    if (!existe) return res.status(404).json({ erro: 'Usuário não encontrado' });
    if (existe.role === 'admin' && req.params.id !== req.usuario_id) {
      return res.status(403).json({ erro: 'Não é possível editar outro administrador' });
    }

    const updates = {};
    if (nome) updates.nome = nome.trim();
    if (ativo !== undefined) updates.ativo = ativo;
    if (senha && senha.length >= 6) {
      updates.senha_hash = await bcrypt.hash(senha, 10);
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from('usuarios').update(updates).eq('id', req.params.id);
    }

    // Atualiza permissões se for operador
    if (existe.role === 'operador' && Array.isArray(modulos)) {
      await supabase
        .from('usuario_permissoes')
        .upsert({
          empresa_id: req.empresa_id,
          usuario_id: req.params.id,
          modulos,
          atualizado_em: new Date().toISOString()
        }, { onConflict: 'usuario_id' });
    }

    res.json({ mensagem: 'Usuário atualizado' });
  } catch (e) {
    console.error('[USUARIOS PUT]', e);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// DELETE /api/usuarios/:id — desativar
router.delete('/:id', async (req, res) => {
  try {
    const role = await getRole(req.usuario_id);
    if (role !== 'admin') return res.status(403).json({ erro: 'Apenas administradores podem remover usuários' });
    if (req.params.id === req.usuario_id) return res.status(400).json({ erro: 'Você não pode remover a si mesmo' });

    await supabase.from('usuarios').update({ ativo: false }).eq('id', req.params.id).eq('empresa_id', req.empresa_id);
    res.json({ mensagem: 'Usuário desativado' });
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
