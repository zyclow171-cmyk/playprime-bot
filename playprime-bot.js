require('dotenv').config();
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const redis = require('redis');
const path = require('path');

const app = express();
app.use(express.json());

// Serve a landing page
app.use(express.static(__dirname));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const REDIS_URL = process.env.REDIS_URL;
const PORT = process.env.PORT || 3000;

const MASCOTES_URL = 'https://lh3.googleusercontent.com/d/1nXzIAHNdpLxByUA966fUJ_P4uXw1Ba3h';

const redisClient = redis.createClient({
  url: REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000)
  }
});

redisClient.on('error', (err) => console.log('Redis error:', err));
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
      await sendMessage(from, result.reply);

    } catch (err) {
      console.error('Erro:', err.message);
      awai
