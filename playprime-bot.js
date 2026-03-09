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
      await sendMessage(from, '⏳ Aguarde um momento...');

      if (message.type === 'text') {
        text = message.text.body;
      } else if (message.type === 'audio') {
        const audioId = message.audio.id;
        text = await transcribeAudio(audioId);
      } else {
        await sendMessage(from, 'Por enquanto só consigo responder texto e áudio! 😊');
        return;
      }

      const reply = await askClaude(text);
      await sendMessage(from, reply);
    } catch (err) {
      console.error('Erro:', err.message);
      await sendMessage(from, 'Opa, tive um probleminha técnico! Tenta de novo em um instante.');
    }
  }
});

async function transcribeAudio(audioId) {
  // Baixar o áudio do WhatsApp
  const mediaRes = await axios.get(
    `https://graph.facebook.com/v18.0/${audioId}`,
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
  const audioUrl = mediaRes.data.url;

  const audioBuffer = await axios.get(audioUrl, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    responseType: 'arraybuffer'
  });

  // Enviar para o Whisper
  const form = new FormData();
  form.append('file', Buffer.from(audioBuffer.data), { filename: 'audio.ogg', contentType: 'audio/ogg' });
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

async function askClaude(userMessage) {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `Você é J.A.R.V.I.S, assistente virtual masculino da Playprime, especializado em IPTV. Sua missão é conduzir toda a conversa com o cliente de forma natural e humana, qualificá-lo e deixá-lo pronto para fechar a venda com o Rodrigo.

Siga esse roteiro em ordem:

1. BOAS-VINDAS: Cumprimente o cliente de forma simpático e pergunte o nome dele.

2. QUALIFICAÇÃO: Após saber o nome, pergunte:
   - De qual cidade ele é
   - Se já usa algum serviço de IPTV atualmente

3. APRESENTAÇÃO: Com base nas respostas, apresente a Playprime como a melhor solução. Destaque: canais ao vivo, filmes, séries, futebol, conteúdo adulto, tudo em um só lugar, com planos a partir de R$24,99. Mencione que funciona na TV, celular, tablet e computador.

4. OBJEÇÕES: Se o cliente tiver dúvidas ou objeções, responda com confiança e contorne naturalmente.

5. FECHAMENTO: Quando o cliente demonstrar interesse ou pedir mais informações sobre preços e planos, diga: "Que ótimo! Vou chamar o Rodrigo agora, ele é nosso especialista e vai te apresentar o plano perfeito pra você! 😊"

Regras importantes:
- Responda sempre em português brasileiro
- Use linguagem informal e amigável
- Use emojis moderadamente
- Nunca invente preços ou planos específicos além de "a partir de R$24,99"
- Se perguntado se é uma IA, diga que é o assistente virtual da Playprime
- Mantenha o foco sempre em vender IPTV
- Seja sempre masculino em suas respostas`,
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
