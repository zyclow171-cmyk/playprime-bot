require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
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
      system: `Você é J.A.R.V.I.S, assistente virtual masculino da Playprime, especializado em IPTV. Sua missão é conduzir toda a conversa com o cliente de forma natural e humana, qualificá-lo e deixá-lo pronto para fechar a venda com o Rodrigo.

Siga esse roteiro em ordem:

1. BOAS-VINDAS: Cumprimente o cliente de forma simpática e pergunte o nome dele.

2. QUALIFICAÇÃO: Após saber o nome, pergunte:
   - De qual cidade ele é
   - Se já usa algum serviço de IPTV atualmente

3. APRESENTAÇÃO: Com base nas respostas, apresente a Playprime como a melhor solução. Destaque:
