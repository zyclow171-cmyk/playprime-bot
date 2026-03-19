require('dotenv').config();
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const redis = require('redis');
const path = require('path');

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

// ─── REDIS ────────────────────────────────────────────────────────────────────
const redisClient = redis.createClient({
  url: REDIS_URL,
  socket: { reconnectStrategy: (r) => Math.min(r * 100, 3000) }
});
redisClient.on('error', (err) => console.log('Redis error:', err));
redisClient.connect().catch(console.error);

// ─── CRM / LEADS (salvo no Redis) ─────────────────────────────────────────────
async function lerLeads() {
  try {
    const data = await redisClient.get('giltec:leads');
    return data ? JSON.parse(data) : [];
  } catch { return []; }
}

async function salvarLeads(leads) {
  try {
    await redisClient.set('giltec:leads', JSON.stringify(leads));
  } catch (e) { console.log('Erro ao salvar leads:', e.message); }
}

async function upsertLead(phone, dados) {
  const leads = await lerLeads();
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
  await salvarLeads(leads);
}

async function addFollowUp(phone, nota) {
  const leads = await lerLeads();
  const lead = leads.find(l => l.phone === phone);
  if (lead) {
    lead.follow_ups.push({ data: new Date().toISOString(), nota });
    lead.updatedAt = new Date().toISOString();
    await salvarLeads(leads);
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
      await upsertLead(from, { phone: from, status_crm: 'novo' });
    }

    const result = await askClaude(from, text, history);
    const replyLower = result.reply.toLowerCase();

    // ── Detecta nome do contato ───────────────────────────────────────────────
    const nomeMatch = result.reply.match(/(?:olá|oi|prazer),?\s+([A-ZÀ-Ú][a-zà-ú]+)/i);
    if (nomeMatch) await upsertLead(from, { nome_contato: nomeMatch[1] });

    // ── Detecta cidade ────────────────────────────────────────────────────────
    const cidadeMatch = result.reply.match(/(?:em|de|da cidade de)\s+([A-ZÀ-Ú][a-zà-ú\s]+)/i);
    if (cidadeMatch) await upsertLead(from, { cidade: cidadeMatch[1].trim() });

    // ── Detecta equipamentos de interesse ────────────────────────────────────
    const equipamentos = ['betoneira','rolo compactador','martelo','gerador','andaime','fachadeiro','retroescavadeira','compressor','vibrador','bomba','alisadora','escora','cortadora','carrinho'];
    const encontrados = equipamentos.filter(e => text.toLowerCase().includes(e));
    if (encontrados.length > 0) {
      const leads = await lerLeads();
      const lead = leads.find(l => l.phone === from);
      const novos = [...new Set([...(lead?.equipamentos_interesse || []), ...encontrados])];
      await upsertLead(from, { equipamentos_interesse: novos, status_crm: 'interessado' });
    }

    // ── Detecta reunião agendada ──────────────────────────────────────────────
    if (replyLower.includes('reunião confirmada') || replyLower.includes('visita confirmada')) {
      await upsertLead(from, { status_crm: 'reuniao_agendada', reuniao_agendada: new Date().toISOString() });
      await addFollowUp(from, 'Reunião/visita agendada pela LIS');
    }

    // ── Detecta NETO — envia link do WhatsApp ────────────────────────────────
    if (replyLower.includes('neto')) {
      await upsertLead(from, { status_crm: 'quente' });
      await addFollowUp(from, 'Cliente encaminhado para o Neto');
      await sendMessage(from, result.reply);
      await sendMessage(from, '👷 Clique aqui para falar com o *Neto* agora:\nhttps://wa.me/5521974766117');
      return;
    }

    // ── Detecta lead quente ───────────────────────────────────────────────────
    if (replyLower.includes('nossa equipe vai entrar em contato')) {
      await upsertLead(from, { status_crm: 'quente' });
      await addFollowUp(from, 'Lead quente — solicitou contato comercial');
    }

    await sendMessage(from, result.reply);

  } catch (err) {
    console.error('Erro:', err.message);
    await sendMessage(from, 'Tive um probleminha técnico! Tenta de novo em instantes. 😅');
  }
});

// ─── CLAUDE / LIS ─────────────────────────────────────────────────────────────
async function askClaude(from, userMessage, history) {
  history.push({ role: 'user', content: userMessage });
  if (history.length > 20) history = history.slice(-20);

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `Você é LIS, assistente virtual da Giltec Locações, empresa com 15 anos de experiência em locação de equipamentos para construção civil no Rio de Janeiro. Seja profissional, direta e simpática. Mensagens CURTAS — máximo 4 linhas.

EQUIPAMENTOS DISPONÍVEIS PARA LOCAÇÃO:
- Containers
- Exaustores
- Equipamentos para lava jato
- Rolos compactadores
- Sopradores térmicos
- Perfuratrizes
- Martelos pneumáticos de 30kg
- Lixadeiras
- Serras mármore
- Cortadoras de piso manuais
- Placas vibratórias
- Vibradores portáteis
- Níveis a laser
- Compactadores de solo
- Passa-fios de fibra
- Parafusadeiras
- Máquinas de solda
- Aspiradores de pó
- Dutos condutores para escoar entulho de obra
- Bombas de lama
- Serras de bancada
- Cilindros de solda oxiacetileno
- Betoneiras (diversas capacidades)
- Andaimes e fachadeiros
- Compressores de ar
- Geradores de energia (diversas potências)
- Escoras metálicas
- Retroescavadeiras
- Bombas d'água
- Alisadoras de concreto
- Carrinhos manuais

SITE DA GILTEC: https://gilteclocacoes.com.br — envie quando cliente quiser ver os equipamentos.

DIFERENCIAIS DA GILTEC:
- 15 anos de experiência no mercado
- Equipamentos revisados e prontos para uso
- Entrega e retirada no canteiro de obra
- Suporte técnico incluso
- Atendimento em todo o Rio de Janeiro
- Preços negociáveis para obras de grande porte
- Sede em Duque de Caxias — atendemos Grande RJ

ROTEIRO DE ATENDIMENTO:
1. Se apresente como LIS e pergunte o nome do responsável e o nome da empresa. Depois que souber, NUNCA mais pergunte.
2. Pergunte sobre a obra (tipo, localização no RJ, prazo estimado)
3. Pergunte quais equipamentos precisam e por quanto tempo
4. Quando cliente perguntar sobre equipamento, diga que vai consultar disponibilidade e preço com o Neto
5. Ofereça conectar com o Neto para fazer uma proposta personalizada
6. Quando cliente aceitar reunião/visita, confirme: "Reunião confirmada! Nossa equipe vai entrar em contato em breve para definir data e horário. 👷"
7. Se cliente quiser falar com humano, saber preço ou fechar negócio, diga: "Claro! Vou te conectar com o NETO agora mesmo! 😊" — use a palavra NETO para acionar o atendimento.

CAPTAÇÃO DE DADOS — IMPORTANTE:
- Quando souber o nome: diga "Olá, [Nome]!" para o sistema registrar
- Quando souber a cidade: diga "Ótimo, você é de [Cidade]!" para o sistema registrar

REGRAS IMPORTANTES:
- Português formal mas acessível
- Máximo 4 linhas por resposta
- Emojis moderados (👷 🏗️ ✅)
- NUNCA diga que não tem algum equipamento — sempre diga que vai consultar disponibilidade com o Neto
- NUNCA informe preços — todos os preços e disponibilidade são consultados com o Neto
- O NETO é o vendedor da Giltec — ele verifica estoque e preços e fecha negócios
- Se perguntado se é IA, diga que é a LIS, assistente virtual da Giltec
- NUNCA repita perguntas já feitas
- Foco total em conectar o cliente com o Neto para fechar negócio
- Quando usar a palavra NETO na resposta, o sistema encaminha automaticamente para o vendedor`,
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
app.post('/api/crm/leads', async (req, res) => {
  const lead = req.body;
  await upsertLead(lead.phone || lead.whatsapp, lead);
  res.json({ ok: true });
});

// n8n dispara o primeiro contato
app.post('/api/crm/leads/primeiro-contato', async (req, res) => {
  const { phone, nome_empresa } = req.body;
  try {
    const mensagem = `Olá! 👷 Sou a *LIS*, assistente virtual da *Giltec Locações*.\n\nVi que a *${nome_empresa}* atua no setor de construção civil e gostaria de apresentar nossos serviços de locação de equipamentos para obras no RJ.\n\nPosso te mostrar o que temos disponível? 😊`;
    await sendMessage(phone, mensagem);
    await upsertLead(phone, { status_crm: 'contatado' });
    await addFollowUp(phone, 'Primeiro contato enviado pelo n8n');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar todos os leads
app.get('/api/leads', async (req, res) => {
  const leads = await lerLeads();
  const { status } = req.query;
  if (status) return res.json(leads.filter(l => l.status_crm === status));
  res.json(leads);
});

// Atualizar status do lead
app.put('/api/leads/:id/status', async (req, res) => {
  const leads = await lerLeads();
  const lead = leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
  lead.status_crm = req.body.status;
  lead.updatedAt = new Date().toISOString();
  await salvarLeads(leads);
  res.json({ ok: true });
});

// Adicionar follow-up manual
app.post('/api/leads/:id/followup', async (req, res) => {
  const leads = await lerLeads();
  const lead = leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
  lead.follow_ups.push({ data: new Date().toISOString(), nota: req.body.nota, tipo: 'manual' });
  lead.updatedAt = new Date().toISOString();
  await salvarLeads(leads);
  res.json({ ok: true });
});

// Enviar mensagem manual para lead
app.post('/api/leads/:id/message', async (req, res) => {
  const leads = await lerLeads();
  const lead = leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
  try {
    await sendMessage(lead.phone, req.body.message);
    await addFollowUp(lead.phone, `Mensagem manual: ${req.body.message}`);
    lead.status_crm = 'contatado';
    await salvarLeads(leads);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Follow-up automático disparado pelo n8n
app.post('/api/leads/followup-auto', async (req, res) => {
  const { phone, mensagem, tentativa, lead_id } = req.body;
  try {
    await sendMessage(phone, mensagem);
    const leads = await lerLeads();
    const lead = leads.find(l => l.id === lead_id || l.phone === phone);
    if (lead) {
      lead.follow_ups.push({
        data: new Date().toISOString(),
        nota: `Follow-up automático #${tentativa} enviado pela LIS`,
        tipo: 'automatico'
      });
      lead.updatedAt = new Date().toISOString();
      if (tentativa >= 3) lead.status_crm = 'sem_resposta';
      await salvarLeads(leads);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deletar lead
app.delete('/api/leads/:id', async (req, res) => {
  let leads = await lerLeads();
  leads = leads.filter(l => l.id !== req.params.id);
  await salvarLeads(leads);
  res.json({ ok: true });
});

// ─── STATUS ───────────────────────────────────────────────────────────────────
const startTime = Date.now();
app.get('/status', async (req, res) => {
  const leads = await lerLeads();
  res.json({
    status: 'online',
    empresa: 'Giltec Locações',
    assistente: 'LIS',
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

app.listen(PORT, () => console.log(`✅ Giltec Bot (LIS) rodando na porta ${PORT}`));
