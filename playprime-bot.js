require('dotenv').config();
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const redis = require('redis');

const app = express();
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const REDIS_URL = process.env.REDIS_URL;
const PORT = process.env.PORT || 3000;

const MASCOTES_URL = 'https://drive.google.com/uc?id=1nXzIAHNdpLxByUA966fUJ_P4uXw1Ba3h';
const LOGO_URL = 'https://drive.google.com/uc?id=1OqF9Tt6yquEsjgU6m2bOlrgo9s3d39mE';

const redisClient = redis.createClient({ url: REDIS_URL });
redisClient.connect().catch(console.error);

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

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
      } catch (e) {}

      const isFirstMessage = history.length === 0;

      if (isFirstMessage) {
        await sendImage(from, MASCOTES_URL, '🎉 Bem-vindo à Playprime!');
      }

      const result = await askClaude(from, text, history);

      const replyLower = result.reply.toLowerCase();

      if (replyLower.includes('rodrigo')) {
        await sendImage(from, LOGO_URL, '👽 Nossa equipe vai te atender agora!');
      }

      await sendMessage(from, result.reply);

    } catch (err) {
      console.error('Erro:', err.message);
      await sendMessage(from, 'Tive um probleminha técnico! Tenta de novo. 😅');
    }
  }
});

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

async function askClaude(from, userMessage, history) {
  history.push({ role: 'user', content: userMessage });

  if (history.length > 20) history = history.slice(-20);

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `Você é J.A.R.V.I.S, assistente virtual masculino da Playprime, especializado em IPTV. Seja direto, simpático e objetivo. Mensagens CURTAS — máximo 3 linhas.

ROTEIRO:
1. Primeira mensagem: cumprimente e pergunte o nome. Depois que souber o nome, NUNCA mais pergunte.
2. Pergunte a cidade e se já usa IPTV. Uma pergunta por vez.
3. Apresente a Playprime: +15.000 conteúdos, Full HD/4K, sem fidelidade, suporte online. TV, celular, tablet e PC.

SERVIDORES E PREÇOS:

🔵 Slim TV (mais em conta):
- 1 mês: R$24,90 | 3 meses: R$49,90 | 6 meses: R$94,90 | 12 meses: R$149,90
- Site: https://slimtv.fun/#inicio

🟣 Outros servidores (Unitv, Uniplay, Wares, Space Play, Fast, Fire, Now, New TVS):
- 1 tela: R$30/mês | R$50/bimestral | R$90/trimestral
- 2 telas: R$50/mês
- 3 telas: R$70/mês
- Preços revendedor: consultar Rodrigo

FECHAMENTO: Quando cliente quiser comprar, diga: "Ótimo! Vou chamar o Rodrigo agora pra te ajudar a fechar! 😊" — use a palavra RODRIGO para acionar o atendimento.

REGRAS:
- Português informal
- Máximo 3 linhas por resposta
- Emojis moderados
- Nunca invente preços fora da tabela
- Se perguntado se é IA, diga que é o assistente virtual da Playprime
- NUNCA repita perguntas já feitas
- Foco total em vender IPTV`,
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
  } catch (e) {}

  return { reply, history };
}

async function sendImage(to, imageUrl, caption) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: to,
      type: 'image',
      image: {
        link: imageUrl,
        caption: caption
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: to,
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
