require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();

// ── Segurança e parsing ───────────────────────────────────────
app.use(helmet());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── CORS ──────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000'
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS não permitido: ' + origin));
  },
  credentials: true
}));

// ── Rate limiting ─────────────────────────────────────────────
const limiterGeral = rateLimit({ windowMs: 15 * 60 * 1000, max: 500 });
const limiterAuth  = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { erro: 'Muitas tentativas. Tente em 15 minutos.' } });
app.use('/api/', limiterGeral);
app.use('/api/auth/', limiterAuth);

// ── Webhook MP sem JSON middleware (raw body necessário) ───────
const { webhookMP } = require('./routes/pagamentos');
app.post('/api/pagamentos/webhook', express.raw({ type: 'application/json' }), webhookMP);

// ── Rotas da API ──────────────────────────────────────────────
// ORDEM IMPORTA: específicas antes de genéricas, 404 no final
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/produtos',    require('./routes/produtos'));
app.use('/api/categorias',  require('./routes/categorias'));
app.use('/api/estoque',     require('./routes/estoque'));
app.use('/api/clientes',    require('./routes/clientes'));
app.use('/api/vendas',      require('./routes/vendas'));
app.use('/api/pedidos',     require('./routes/pedidos'));
app.use('/api/fornecedores',require('./routes/fornecedores'));
app.use('/api/financeiro',  require('./routes/financeiro'));
app.use('/api/vendedores',  require('./routes/vendedores'));
app.use('/api/comissoes',   require('./routes/comissoes'));
app.use('/api/relatorios',  require('./routes/relatorios'));
app.use('/api/pagamentos',  require('./routes/pagamentos'));
app.use('/api/dashboard',   require('./routes/dashboard'));

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── 404 — SEMPRE no final ────────────────────────────────────
app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

// ── Handler global de erros ───────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERRO]', err.message);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

// ── Start ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`BebidaOS API rodando na porta ${PORT}`);
  console.log(`Ambiente: ${process.env.NODE_ENV}`);
});
