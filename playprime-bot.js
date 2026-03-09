const express = require("express");
const axios = require("axios");
const { MongoClient } = require("mongodb");

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
  console.log("MongoDB conectado");
}

connectDB();

app.get("/", (req, res) => {
  res.send("Bot rodando 🚀");
});

app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000");
});
