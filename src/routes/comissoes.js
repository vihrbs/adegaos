const router = require('express').Router();
const supabase = require('../utils/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/comissoes?mes=&ano=
router.get('/', async (req, res) => {
  try {
    const agora = new Date();
    const mes = parseInt(req.query.mes || agora.getMonth() + 1);
    const ano = parseInt(req.query.ano || agora.getFullYear());

    const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const fim    = `${ano}-${String(mes).padStart(2, '0')}-31T23:59:59`;

    // Busca vendedores ativos
    const { data: vendedores } = await supabase
      .from('vendedores')
      .select('id, nome, percentual_comissao')
      .eq('empresa_id', req.empresa_id)
      .eq('ativo', true);

    // Busca vendas do período com vendedor
    const { data: vendas } = await supabase
      .from('vendas')
      .select('vendedor_id, total')
      .eq('empresa_id', req.empresa_id)
      .eq('status', 'concluida')
      .gte('criado_em', inicio)
      .lte('criado_em', fim)
      .not('vendedor_id', 'is', null);

    // Calcula por vendedor
    const resultado = (vendedores || []).map(v => {
      const vendasDoVendedor = (vendas || []).filter(vn => vn.vendedor_id === v.id);
      const total_vendido = vendasDoVendedor.reduce((s, vn) => s + Number(vn.total), 0);
      const comissao = total_vendido * (v.percentual_comissao / 100);
      return {
        vendedor_id: v.id,
        vendedor_nome: v.nome,
        percentual: v.percentual_comissao,
        qtd_vendas: vendasDoVendedor.length,
        total_vendido,
        comissao
      };
    });

    res.json({ mes, ano, vendedores: resultado });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
