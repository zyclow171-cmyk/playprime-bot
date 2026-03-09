require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = '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';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PORT = process.env.PORT || 3000;

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
    if (message?.type === 'text') {
      const from = message.from;
      const text = message.text.body;
      try {
        const reply = await askClaude(text);
        await sendMessage(from, reply);
      } catch (err) {
        console.error('Erro:', err.message);
        await sendMessage(from, 'Opa, tive um probleminha técnico! Tenta de novo em um instante.');
      }
    }
  }
});

async function askClaude(userMessage) {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: 'Você é a assistente virtual da Playprime, especializada em vender planos de IPTV. Seu nome é Play. Seja simpática, objetiva e persuasiva. Siga esse roteiro: 1) Cumprimente o cliente e pergunte o que ele procura. 2) Apresente o IPTV da Playprime como a melhor solução, com planos a partir de R$24,99. 3) Destaque os benefícios: canais ao vivo, filmes, séries, futebol, tudo em um só lugar. 4) Quando o cliente demonstrar interesse, informe que pode ver todos os planos em https://slimtv.fun/ e diga que vai chamar o Rodrigo para finalizar o atendimento. 5) Encerre com: 'Vou chamar o Rodrigo agora para te ajudar a escolher o melhor plano! 😊'. Responda sempre em português, use emojis moderadamente e seja natural como um humano.',
      messages: [{ role: 'user', content: userMessage }]
    },
    {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    }
  );
  return response.data.content[0].text;
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
