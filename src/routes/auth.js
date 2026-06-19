const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const supabase = require('../utils/supabase');
const auth = require('../middleware/auth');

function gerarToken(empresa_id, usuario_id) {
  return jwt.sign(
    { empresa_id, usuario_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

async function notificarTelegram(mensagem) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: mensagem, parse_mode: 'HTML' })
      }
    );
  } catch (_) {}
}

// POST /api/auth/registro
router.post('/registro', async (req, res) => {
  try {
    const { nome_empresa, nome_responsavel, email, senha, telefone, celular } = req.body;
    const telefoneFinal = celular || telefone || null;

    if (!nome_empresa || !email || !senha) {
      return res.status(400).json({ erro: 'nome_empresa, email e senha são obrigatórios' });
    }
    if (!telefoneFinal) {
      return res.status(400).json({ erro: 'celular é obrigatório' });
    }
    if (senha.length < 6) {
      return res.status(400).json({ erro: 'Senha deve ter pelo menos 6 caracteres' });
    }

    // Email já cadastrado?
    const { data: existe } = await supabase
      .from('usuarios')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (existe) return res.status(409).json({ erro: 'Este e-mail já está cadastrado' });

    // Trial de 14 dias
    const trial_expira_em = new Date();
    trial_expira_em.setDate(trial_expira_em.getDate() + 14);

    // Criar empresa
    const { data: empresa, error: errEmpresa } = await supabase
      .from('empresas')
      .insert({
        nome: nome_empresa.trim(),
        telefone: telefoneFinal,
        plano_ativo: false,
        trial_expira_em: trial_expira_em.toISOString()
      })
      .select()
      .single();

    if (errEmpresa) {
      console.error('[REGISTRO] Erro empresa:', errEmpresa);
      return res.status(500).json({ erro: 'Erro ao criar empresa' });
    }

    // Criar usuário admin
    const hash = await bcrypt.hash(senha, 10);
    const { data: usuario, error: errUser } = await supabase
      .from('usuarios')
      .insert({
        empresa_id: empresa.id,
        nome: nome_responsavel ? nome_responsavel.trim() : nome_empresa.trim(),
        email: email.toLowerCase().trim(),
        senha_hash: hash,
        role: 'admin'
      })
      .select()
      .single();

    if (errUser) {
      // Rollback manual da empresa
      await supabase.from('empresas').delete().eq('id', empresa.id);
      console.error('[REGISTRO] Erro usuario:', errUser);
      return res.status(500).json({ erro: 'Erro ao criar usuário' });
    }

    const token = gerarToken(empresa.id, usuario.id);

    await notificarTelegram(
      `🍷 <b>Novo cadastro BebidaOS</b>\nEmpresa: ${nome_empresa}\nEmail: ${email}\nTrial até: ${trial_expira_em.toLocaleDateString('pt-BR')}`
    );

    res.status(201).json({
      token,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role },
      empresa: { id: empresa.id, nome: empresa.nome, trial_expira_em: empresa.trial_expira_em, plano_ativo: empresa.plano_ativo }
    });
  } catch (err) {
    console.error('[REGISTRO]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ erro: 'email e senha são obrigatórios' });

    const { data: usuario, error } = await supabase
      .from('usuarios')
      .select('id, empresa_id, nome, email, senha_hash, role, ativo')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (error || !usuario) return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
    if (!usuario.ativo) return res.status(403).json({ erro: 'Conta desativada. Contate o suporte.' });

    const senhaOk = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaOk) return res.status(401).json({ erro: 'E-mail ou senha incorretos' });

    const { data: empresa } = await supabase
      .from('empresas')
      .select('id, nome, plano_ativo, trial_expira_em')
      .eq('id', usuario.empresa_id)
      .single();

    const token = gerarToken(empresa.id, usuario.id);

    res.json({
      token,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role },
      empresa: { id: empresa.id, nome: empresa.nome, trial_expira_em: empresa.trial_expira_em, plano_ativo: empresa.plano_ativo }
    });
  } catch (err) {
    console.error('[LOGIN]', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('id, nome, email, role')
      .eq('id', req.usuario_id)
      .single();

    res.json({ usuario, empresa: req.empresa });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// PUT /api/auth/senha
router.put('/senha', auth, async (req, res) => {
  try {
    const { senha_atual, senha_nova } = req.body;
    if (!senha_atual || !senha_nova) return res.status(400).json({ erro: 'Campos obrigatórios' });
    if (senha_nova.length < 6) return res.status(400).json({ erro: 'Nova senha deve ter pelo menos 6 caracteres' });

    const { data: usuario } = await supabase
      .from('usuarios')
      .select('senha_hash')
      .eq('id', req.usuario_id)
      .single();

    const ok = await bcrypt.compare(senha_atual, usuario.senha_hash);
    if (!ok) return res.status(401).json({ erro: 'Senha atual incorreta' });

    const hash = await bcrypt.hash(senha_nova, 10);
    await supabase.from('usuarios').update({ senha_hash: hash }).eq('id', req.usuario_id);

    res.json({ mensagem: 'Senha atualizada com sucesso' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
