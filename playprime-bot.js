require('dotenv').config();
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const redis = require('redis');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/painel', (req, res) => res.sendFile(path.join(__dirname, 'painel-playprime.html')));

const WHATSAPP_TOKEN    = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID   = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const REDIS_URL         = process.env.REDIS_URL;
const PORT              = process.env.PORT || 3000;

const LEADS_FILE = path.join(__dirname, 'leads.json');

// ─── REDIS ────────────────────────────────────────────────────────────────────
const redisClient = redis.createClient({
  url: REDIS_URL,
  socket: { reconnectStrategy: (r) => Math.min(r * 100, 3000) }
});
redisClient.on('error', (err) => console.log('Redis error:', err));
redisClient.connect().catch(console.error);

// ─── CRM / LEADS ──────────────────────────────────────────────────────────────
function lerLeads() {
  if (!fs.existsSync(LEADS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')); } catch { return []; }
}

function salvarLeads(leads) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

function upsertLead(phone, dados) {
  const leads = lerLeads();
  const idx = leads.findIndex(l => l.phone === phone);
  if (idx >= 0) {
    leads[idx] = { ...leads[idx], ...dados, updatedAt: new Date().toISOString() };
  } else {
    leads.push({
      id: `GILTEC-${Date.now()}`,
      phone,
      nome_contato: '',
      nome_empresa: '',
      cidade: '',
      equipamentos_interesse: [],
      status_crm: 'novo',
      reuniao_agendada: null,
      primeiro_contato: true,
      follow_ups: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...dados
    });
  }
  salvarLeads(leads);
}

function addFollowUp(phone, nota) {
  const leads = lerLeads();
  const lead = leads.find(l => l.phone === phone);
  if (lead) {
    lead.follow_ups.push({ data: new Date().toISOString(), nota });
    lead.updatedAt = new Date().toISOString();
    salvarLeads(leads);
  }
}

// ─── WEBHOOK META ─────────────────────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return;

  const from = message.from;
  let text = '';

  try {
    if (message.type === 'text') {
      text = message.text.body;
    } else if (message.type === 'audio') {
      text = await transcribeAudio(message.audio.id);
    } else {
      await sendMessage(from, 'Por enquanto só respondo texto e áudio! 😊');
      return;
    }

    let history = [];
    try {
      const stored = await redisClient.get(`chat:${from}`);
      if (stored) history = JSON.parse(stored);
    } catch {}

    // Registra lead na primeira mensagem
    if (history.length === 0) {
      upsertLead(from, { phone: from, status_crm: 'novo' });
    }

    const result = await askClaude(from, text, history);
    const replyLower = result.reply.toLowerCase();

    // ── Detecta nome do contato ───────────────────────────────────────────────
    const nomeMatch = result.reply.match(/(?:olá|oi|prazer),?\s+([A-ZÀ-Ú][a-zà-ú]+)/i);
    if (nomeMatch) upsertLead(from, { nome_contato: nomeMatch[1] });

    // ── Detecta cidade ────────────────────────────────────────────────────────
    const cidadeMatch = result.reply.match(/(?:em|de|da cidade de)\s+([A-ZÀ-Ú][a-zà-ú\s]+)/i);
    if (cidadeMatch) upsertLead(from, { cidade: cidadeMatch[1].trim() });

    // ── Detecta equipamentos de interesse ────────────────────────────────────
    const equipamentos = ['betoneira','rolo compactador','martelo','gerador','andaime','fachadeiro','retroescavadeira','compressor','vibrador','bomba','alisadora','escora','cortadora','carrinho'];
    const encontrados = equipamentos.filter(e => text.toLowerCase().includes(e));
    if (encontrados.length > 0) {
      const lead = lerLeads().find(l => l.phone === from);
      const novos = [...new Set([...(lead?.equipamentos_interesse || []), ...encontrados])];
      upsertLead(from, { equipamentos_interesse: novos, status_crm: 'interessado' });
    }

    // ── Detecta reunião agendada ──────────────────────────────────────────────
    if (replyLower.includes('reunião confirmada') || replyLower.includes('visita confirmada')) {
      upsertLead(from, { status_crm: 'reuniao_agendada', reuniao_agendada: new Date().toISOString() });
      addFollowUp(from, 'Reunião/visita agendada pelo JOE');
    }

    // ── Detecta lead quente ───────────────────────────────────────────────────
    if (replyLower.includes('nossa equipe vai entrar em contato')) {
      upsertLead(from, { status_crm: 'quente' });
      addFollowUp(from, 'Lead quente — solicitou contato comercial');
    }

    await sendMessage(from, result.reply);

  } catch (err) {
    console.error('Erro:', err.message);
    await sendMessage(from, 'Tive um probleminha técnico! Tenta de novo em instantes. 😅');
  }
});

// ─── CLAUDE / JOE ─────────────────────────────────────────────────────────────
async function askClaude(from, userMessage, history) {
  history.push({ role: 'user', content: userMessage });
  if (history.length > 20) history = history.slice(-20);

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `Você é JOE, assistente comercial da Giltec Locações, empresa com 15 anos de experiência em locação de equipamentos para construção civil no Rio de Janeiro. Seja profissional, direto e simpático. Mensagens CURTAS — máximo 4 linhas.

EQUIPAMENTOS QUE LOCAMOS:
- Betoneiras (diversas capacidades)
- Rolos compactadores e compactadores de solo
- Martelos pneumáticos
- Geradores de energia (diversas potências)
- Andaimes e fachadeiros
- Retroescavadeiras
- Compressores de ar
- Vibradores de concreto
- Bombas d'água
- Alisadoras de concreto
- Escoras metálicas
- Cortadoras de ferro, pedra e piso
- Carrinhos manuais

DIFERENCIAIS DA GILTEC:
- 15 anos de experiência no mercado
- Equipamentos revisados e prontos para uso
- Entrega e retirada no canteiro de obra
- Suporte técnico incluso
- Atendimento em todo o Rio de Janeiro
- Preços negociáveis para obras de grande porte
- Sede em Duque de Caxias — atendemos Grande RJ

ROTEIRO DE ATENDIMENTO:
1. Se apresente como JOE e pergunte o nome do responsável e o nome da empresa. Depois que souber, NUNCA mais pergunte.
2. Pergunte sobre a obra (tipo, localização no RJ, prazo estimado)
3. Pergunte quais equipamentos precisam e por quanto tempo
4. Informe que os preços variam conforme prazo e quantidade — nossa equipe faz proposta personalizada
5. Ofereça agendar visita técnica sem compromisso: "Posso agendar uma visita técnica gratuita!"
6. Quando cliente aceitar reunião/visita, confirme: "Reunião confirmada! Nossa equipe vai entrar em contato em breve para definir data e horário. 👷"
7. Se cliente quiser falar com comercial agora: "Nossa equipe vai entrar em contato com você em breve! 😊"

CAPTAÇÃO DE DADOS — IMPORTANTE:
- Quando souber o nome: diga "Olá, [Nome]!" para o sistema registrar
- Quando souber a cidade: diga "Ótimo, você é de [Cidade]!" para o sistema registrar

REGRAS:
- Português formal mas acessível
- Máximo 4 linhas por resposta
- Emojis moderados (👷 🏗️ ✅)
- Nunca invente preços (são negociáveis e personalizados)
- Se perguntado se é IA, diga que é o JOE, assistente virtual da Giltec
- NUNCA repita perguntas já feitas
- Foco total em agendar visita técnica ou reunião comercial`,
      messages: history
    },
    {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    }
  );

  const reply = response.data.content[0].text;
  history.push({ role: 'assistant', content: reply });

  try {
    await redisClient.setEx(`chat:${from}`, 604800, JSON.stringify(history));
  } catch {}

  return { reply, history };
}

// ─── WHATSAPP HELPERS ─────────────────────────────────────────────────────────
async function transcribeAudio(audioId) {
  const mediaRes = await axios.get(
    `https://graph.facebook.com/v18.0/${audioId}`,
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
  const audioBuffer = await axios.get(mediaRes.data.url, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    responseType: 'arraybuffer'
  });
  const form = new FormData();
  form.append('file', Buffer.from(audioBuffer.data), { filename: 'audio.ogg', contentType: 'audio/ogg' });
  form.append('model', 'whisper-1');
  form.append('language', 'pt');
  const whisperRes = await axios.post(
    'https://api.openai.com/v1/audio/transcriptions',
    form,
    { headers: { ...form.getHeaders(), Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );
  return whisperRes.data.text;
}

async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    { messaging_product: 'whatsapp', to, text: { body: text } },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
  );
}

// ─── API CRM ──────────────────────────────────────────────────────────────────

// Recebe lead captado pelo n8n
app.post('/api/crm/leads', (req, res) => {
  const lead = req.body;
  upsertLead(lead.phone || lead.whatsapp, lead);
  res.json({ ok: true });
});

// n8n dispara o primeiro contato
app.post('/api/crm/leads/:id/primeiro-contato', async (req, res) => {
  const { phone, nome_empresa } = req.body;
  try {
    const mensagem = `Olá! 👷 Sou o *JOE*, assistente virtual da *Giltec Locações*.\n\nVi que a *${nome_empresa}* atua no setor de construção civil e gostaria de apresentar nossos serviços de locação de equipamentos para obras no RJ.\n\nPosso te mostrar o que temos disponível? 😊`;
    await sendMessage(phone, mensagem);
    upsertLead(phone, { status_crm: 'contatado' });
    addFollowUp(phone, 'Primeiro contato enviado pelo n8n');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar todos os leads
app.get('/api/leads', (req, res) => {
  const leads = lerLeads();
  const { status } = req.query;
  if (status) return res.json(leads.filter(l => l.status_crm === status));
  res.json(leads);
});

// Atualizar status do lead
app.put('/api/leads/:id/status', (req, res) => {
  const leads = lerLeads();
  const lead = leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
  lead.status_crm = req.body.status;
  lead.updatedAt = new Date().toISOString();
  salvarLeads(leads);
  res.json({ ok: true });
});

// Adicionar follow-up manual
app.post('/api/leads/:id/followup', (req, res) => {
  const leads = lerLeads();
  const lead = leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
  lead.follow_ups.push({ data: new Date().toISOString(), nota: req.body.nota, tipo: 'manual' });
  lead.updatedAt = new Date().toISOString();
  salvarLeads(leads);
  res.json({ ok: true });
});

// Enviar mensagem manual para lead
app.post('/api/leads/:id/message', async (req, res) => {
  const leads = lerLeads();
  const lead = leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
  try {
    await sendMessage(lead.phone, req.body.message);
    addFollowUp(lead.phone, `Mensagem manual: ${req.body.message}`);
    lead.status_crm = 'contatado';
    salvarLeads(leads);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deletar lead
app.delete('/api/leads/:id', (req, res) => {
  let leads = lerLeads();
  leads = leads.filter(l => l.id !== req.params.id);
  salvarLeads(leads);
  res.json({ ok: true });
});

// ─── STATUS ───────────────────────────────────────────────────────────────────
const startTime = Date.now();
app.get('/status', (req, res) => {
  const leads = lerLeads();
  res.json({
    status: 'online',
    empresa: 'Giltec Locações',
    assistente: 'JOE',
    uptime_segundos: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toLocaleString('pt-BR'),
    crm: {
      total: leads.length,
      novos: leads.filter(l => l.status_crm === 'novo').length,
      contatados: leads.filter(l => l.status_crm === 'contatado').length,
      interessados: leads.filter(l => l.status_crm === 'interessado').length,
      quentes: leads.filter(l => l.status_crm === 'quente').length,
      reuniao_agendada: leads.filter(l => l.status_crm === 'reuniao_agendada').length,
      fechados: leads.filter(l => l.status_crm === 'fechado').length,
    }
  });
});

app.listen(PORT, () => console.log(`✅ Giltec Bot (JOE) rodando na porta ${PORT}`));
