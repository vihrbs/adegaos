const jwt = require('jsonwebtoken');
const supabase = require('../utils/supabase');

module.exports = async function auth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ erro: 'Token não fornecido' });
    }

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Busca empresa para confirmar que ainda existe e está ativa
    const { data: empresa, error } = await supabase
      .from('empresas')
      .select('id, nome, plano_ativo, trial_expira_em')
      .eq('id', decoded.empresa_id)
      .single();

    if (error || !empresa) {
      return res.status(401).json({ erro: 'Sessão inválida' });
    }

    // Verificar acesso (plano ativo OU trial ainda válido)
    const agora = new Date();
    const trialValido = empresa.trial_expira_em && new Date(empresa.trial_expira_em) > agora;

    if (!empresa.plano_ativo && !trialValido) {
      return res.status(403).json({
        erro: 'Assinatura expirada',
        codigo: 'ASSINATURA_EXPIRADA'
      });
    }

    req.empresa_id = empresa.id;
    req.usuario_id = decoded.usuario_id;
    req.empresa = empresa;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ erro: 'Token expirado. Faça login novamente.' });
    }
    return res.status(401).json({ erro: 'Token inválido' });
  }
};
