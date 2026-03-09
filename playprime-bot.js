require('dotenv').config();
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PORT = process.env.PORT || 3000;

const memory = {};
const MAX_HISTORY = 12;

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

  if (body.object !== 'whatsapp_business_account') return;

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

      const audioId = message.audio.id;
      text = await transcribeAudio(audioId);

    } else {

      await sendMessage(from, 'Consigo responder apenas texto e áudio por enquanto 🙂');
      return;

    }

    const lower = text.toLowerCase();

    if (lower.includes('teste') || lower.includes('trial') || lower.includes('24h')) {

      await sendMessage(from, 'Perfeito! Vou chamar o Rodrigo agora para liberar seu teste 👍');
      return;

    }

    if (lower.includes('revenda') || lower.includes('revender') || lower.includes('painel')) {

      await sendMessage(from, 'Legal! Vou chamar o Rodrigo para explicar como funciona nossa revenda 🚀');
      return;

    }

    if (lower.includes('preço') || lower.includes('valor') || lower.includes('quanto custa')) {

      await sendMessage(from, 'Temos planos a partir de R$24,99 🙂 Vou pedir para o Rodrigo te explicar certinho.');
      return;

    }

    if (lower.includes('quero') || lower.includes('assinar') || lower.includes('contratar')) {

      await sendMessage(from, 'Perfeito! Já vou chamar o Rodrigo para finalizar seu acesso 👍');
      return;

    }

    const reply = await askClaude(from, text);

    await sendMessage(from, reply);

  } catch (err) {

    console.log(err.message);
    await sendMessage(from, 'Tive um pequeno erro aqui 😅 tenta mandar novamente.');

  }

});

async function transcribeAudio(audioId) {

  const mediaRes = await axios.get(
    `https://graph.facebook.com/v18.0/${audioId}`,
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );

  const audioUrl = mediaRes.data.url;

  const audioBuffer = await axios.get(audioUrl, {

    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    responseType: 'arraybuffer'

  });

  const form = new FormData();

  form.append('file', Buffer.from(audioBuffer.data), {
    filename: 'audio.ogg',
    contentType: 'audio/ogg'
  });

  form.append('model', 'whisper-1');
  form.append('language', 'pt');

  const whisperRes = await axios.post(
    'https://api.openai.com/v1/audio/transcriptions',
    form,
    {

      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${OPENAI_API_KEY}`
      }

    }
  );

  return whisperRes.data.text;

}

async function askClaude(userId, userMessage) {

  if (!memory[userId]) memory[userId] = [];

  const history = memory[userId];

  history.push({
    role: "user",
    content: userMessage
  });

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {

      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,

      system: `Você é JARVIS, assistente virtual masculino da PlayPrime.

Seu objetivo é conversar naturalmente com clientes interessados em IPTV e streaming.

Fluxo da conversa:

1 Cumprimente e pergunte o nome.

2 Pergunte de qual cidade o cliente é.

3 Pergunte se ele já usa IPTV.

4 Apresente a PlayPrime destacando:

canais ao vivo
filmes
séries
futebol
conteúdo adulto

Tudo em um só lugar.

Funciona em:

Smart TV
celular
tablet
computador

Planos a partir de R$24,99.

Se o cliente demonstrar interesse diga:

"Perfeito! Vou chamar o Rodrigo agora para te explicar tudo e liberar seu acesso 🙂"

Regras:

Português brasileiro
linguagem informal
poucos emojis
não inventar preços
foco em venda
assistente masculino
respostas curtas e naturais`,

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

  history.push({
    role: "assistant",
    content: reply
  });

  if (history.length > MAX_HISTORY) {

    memory[userId] = history.slice(-MAX_HISTORY);

  }

  return reply;

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
