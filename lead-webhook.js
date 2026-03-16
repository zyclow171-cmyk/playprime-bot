const express = require('express');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'playprime123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const NUMERO_ID = process.env.NUMERO_ID;

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
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (message) {
      await sendMessage(message.from, 'Bem-vindo a PlayPrime IPTV! Digite 1 para ver nossos planos.');
    }
  }
  res.sendStatus(200);
});

app.get('/', (req, res) => res.json({ status: 'online' }));

async function sendMessage(to, text) {
  const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
  await fetch('https://graph.facebook.com/v18.0/' + NUMERO_ID + '/messages', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + WHATSAPP_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } })
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Servidor na porta ' + PORT));
