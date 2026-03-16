require('dotenv').config();

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
const LEADS_FILE = path.join(__dirname, "leads.json");

app.use(express.json());
app.use(express.static(__dirname));

// Load leads from file
function loadLeads() {
  if (!fs.existsSync(LEADS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(LEADS_FILE, "utf8")); } catch { return []; }
}

// Save leads to file
function saveLeads(leads) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

// Send WhatsApp message
async function sendWhatsApp(phone, message) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${process.env.NUMERO_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: message }
    },
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
  );
}

// Dashboard
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

// Receive lead via webhook
app.post("/lead", async (req, res) => {
  const leads = loadLeads();
  const lead = {
    id: Date.now().toString(),
    name: req.body.name || "Desconhecido",
    phone: req.body.phone,
    email: req.body.email || "",
    status: "pendente",
    createdAt: new Date().toISOString(),
    messages: []
  };

  console.log("Novo lead recebido:", lead);

  const welcomeMsg = "Olá! 👋 Seja bem-vindo à PlayPrime IPTV! 🎬📺 Temos os melhores planos com mais de 500 canais, filmes e séries. Quer saber mais sobre nossos planos e preços? Responda SIM que te envio tudo!";

  try {
    await sendWhatsApp(lead.phone, welcomeMsg);
    lead.status = "enviado";
    lead.messages.push({ text: welcomeMsg, sentAt: new Date().toISOString(), direction: "out" });
  } catch (e) {
    console.log("Erro ao enviar mensagem:", e.message);
  }

  leads.unshift(lead);
  saveLeads(leads);
  res.sendStatus(200);
});

// Get all leads
app.get("/api/leads", (req, res) => {
  res.json(loadLeads());
});

// Update lead status
app.put("/api/leads/:id/status", (req, res) => {
  const leads = loadLeads();
  const lead = leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: "Lead não encontrado" });
  lead.status = req.body.status;
  saveLeads(leads);
  res.json(lead);
});

// Send manual message
app.post("/api/leads/:id/message", async (req, res) => {
  const leads = loadLeads();
  const lead = leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: "Lead não encontrado" });

  try {
    await sendWhatsApp(lead.phone, req.body.message);
    lead.messages = lead.messages || [];
    lead.messages.push({ text: req.body.message, sentAt: new Date().toISOString(), direction: "out" });
    lead.status = "enviado";
    saveLeads(leads);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Webhook reply from WhatsApp (mark as responded)
app.post("/webhook/whatsapp", (req, res) => {
  const body = req.body;
  if (body.object === "whatsapp_business_account") {
    const entry = body.entry?.[0]?.changes?.[0]?.value;
    const message = entry?.messages?.[0];
    if (message) {
      const leads = loadLeads();
      const lead = leads.find(l => l.phone === message.from);
      if (lead) {
        lead.status = "respondeu";
        lead.messages = lead.messages || [];
        lead.messages.push({ text: message.text?.body || "", sentAt: new Date().toISOString(), direction: "in" });
        saveLeads(leads);
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dashboard rodando na porta ${PORT}`);
  console.log("Webhook de leads em POST /lead");
});
