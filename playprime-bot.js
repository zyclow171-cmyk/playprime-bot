import express from "express";
import axios from "axios";
import { MongoClient } from "mongodb";

const app = express();
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;

const client = new MongoClient(MONGODB_URI);

let db;

async function connectDB() {
  await client.connect();
  db = client.db("whatsapp-bot");
}

connectDB();

async function getMemory(user) {
  const data = await db.collection("memory").findOne({ user });
  return data?.messages || [];
}

async function saveMemory(user, messages) {
  await db.collection("memory").updateOne(
    { user },
    { $set: { messages } },
    { upsert: true }
  );
}

async function askClaude(messages) {

  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-3-haiku-20240307",
      max_tokens: 500,
      messages
    },
    {
      headers: {
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      }
    }
  );

  return response.data.content[0].text;
}

async function sendMessage(to, text) {

  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

async function sendImage(to, imageUrl, caption) {

  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: {
        link: imageUrl,
        caption
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

app.post("/webhook", async (req, res) => {

  try {

    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body || "";

    let history = await getMemory(from);

    if (history.length === 0) {

      await sendImage(
        from,
        "https://i.imgur.com/7lq3xQk.png",
        "👋 Olá! Seja bem-vindo à *PlayPrime*.\n\n🎬 Filmes\n📺 Séries\n⚽ Futebol\n🔞 Conteúdo adulto\n\nTudo em um só lugar!\n\nQual seu nome?"
      );

      await saveMemory(from, []);

      return res.sendStatus(200);
    }

    history.push({
      role: "user",
      content: text
    });

    const messages = [
      {
        role: "system",
        content: "Você é Jarvis, assistente virtual da PlayPrime IPTV. Seja educado e ajude o cliente a testar ou comprar o serviço."
      },
      ...history
    ];

    const reply = await askClaude(messages);

    history.push({
      role: "assistant",
      content: reply
    });

    await saveMemory(from, history);

    await sendMessage(from, reply);

    res.sendStatus(200);

  } catch (error) {

    console.error(error);
    res.sendStatus(500);

  }

});

app.get("/", (req, res) => {
  res.send("Bot rodando 🚀");
});

app.listen(3000, () => {
  console.log("Servidor rodando");
});
