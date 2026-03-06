// ============================================
// BOT WHATSAPP BUSINESS + CLAUDE AI
// Empresa: Play Prime — Streaming
// Funcionalidades: FAQ | Pedidos | Atendente Humano
// ============================================

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ============================================
// ⚙️ CONFIGURAÇÕES
// ============================================
const CONFIG = {
  WHATSAPP_TOKEN:    process.env.WHATSAPP_TOKEN    || "SEU_TOKEN_WHATSAPP",
  PHONE_NUMBER_ID:   process.env.PHONE_NUMBER_ID   || "SEU_PHONE_NUMBER_ID",
  VERIFY_TOKEN:      process.env.VERIFY_TOKEN      || "playprime_token_secreto",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "SUA_CHAVE_ANTHROPIC",

  BUSINESS_NAME: "Play Prime",
  BUSINESS_INFO: `
    🎬 Play Prime — Sua plataforma de streaming completa!
    
    O que oferecemos:
    - Pacotes de streaming com acesso a TV ao vivo, filmes e séries
    - Conteúdo nacional e internacional
    - Funciona em Smart TV, celular, tablet, computador e TV Box
    - Ativação imediata após confirmação do pagamento

    💰 Planos e Preços:
    - Plano Básico (1 tela)         — R$ 24,99/mês
    - Plano Padrão (2 telas)        — R$ 34,99/mês
    - Plano Premium (4 telas)       — R$ 49,99/mês
    - Plano Família (6 telas)       — R$ 64,99/mês
    - Plano Anual (1 tela - 12 meses) — R$ 199,99 (economize 33%)

    ⏰ Horário de atendimento:
    - Segunda a Domingo, das 09h às 20h

    💳 Pagamento:
    - Somente via PIX
    - Chave PIX: 21964816185
    - Titular: Rodrigo A. Carvalho
    - Banco: PicPay
    - Após o pagamento, envie o comprovante aqui no WhatsApp
    - Ativação em até 15 minutos após confirmação

    ❓ Perguntas frequentes:
    1. Como funciona? → Após o pagamento via PIX, você recebe o login e senha para acessar a plataforma em qualquer dispositivo.
    2. Tem teste grátis? → Sim! Oferecemos 24h de teste gratuito, basta solicitar.
    3. Em quantas telas posso assistir? → Depende do plano escolhido (1 a 6 telas simultâneas).
    4. Funciona em qual TV? → Funciona em qualquer Smart TV, além de celular, tablet, PC e TV Box com Android.
    5. E se travar ou der problema? → Suporte técnico disponível todos os dias das 09h às 20h via WhatsApp.
    6. Posso cancelar quando quiser? → Sim, sem fidelidade. O acesso fica ativo até o fim do período pago.
    7. Tem canais ao vivo? → Sim! Mais de 100 canais ao vivo incluídos em todos os planos.
    8. Tem conteúdo adulto bloqueado? → Sim, controle parental disponível em todos os planos.
  `,
};

// ============================================
// 📦 GERENCIAMENTO DE PEDIDOS
// ============================================
const orders = new Map();
const conversations = new Map();
const userStates = new Map();

const PLANOS = {
  "basico":  { nome: "Plano Básico (1 tela)",           preco: 24.99 },
  "padrao":  { nome: "Plano Padrão (2 telas)",          preco: 34.99 },
  "premium": { nome: "Plano Premium (4 telas)",         preco: 49.99 },
  "familia": { nome: "Plano Família (6 telas)",         preco: 64.99 },
  "anual":   { nome: "Plano Anual (1 tela - 12 meses)", preco: 199.99 },
};

function getHistory(userId) {
  if (!conversations.has(userId)) conversations.set(userId, []);
  return conversations.get(userId);
}

function addToHistory(userId, role, content) {
  const history = getHistory(userId);
  history.push({ role, content });
  if (history.length > 20) history.splice(0, history.length - 20);
}

function getState(userId) {
  return userStates.get(userId) || "normal";
}

function setState(userId, state) {
  userStates.set(userId, state);
}

// ============================================
// 🤖 INTEGRAÇÃO COM CLAUDE AI
// ============================================
async function askClaude(userId, userMessage) {
  const history = getHistory(userId);
  const state = getState(userId);

  const systemPrompt = `Você é o assistente virtual da *Play Prime* 🎬, empresa de streaming.

${CONFIG.BUSINESS_INFO}

Estado atual do atendimento: ${state}
Data/hora atual: ${new Date().toLocaleString("pt-BR")}

=== COMO SE COMPORTAR ===
- Responda SEMPRE em português brasileiro
- Seja simpático, animado e use linguagem descontraída
- Mensagens curtas e objetivas (é WhatsApp!)
- Use emojis para deixar a conversa mais leve 🎬📺✅
- NUNCA invente informações que não estão aqui

=== FLUXO DE VENDA ===
Quando o cliente quiser assinar:
1. Apresente os planos disponíveis com preços
2. Confirme qual plano o cliente quer
3. Envie os dados do PIX de forma clara:
   📲 *Chave PIX:* 21964816185
   👤 *Titular:* Rodrigo A. Carvalho
   🏦 *Banco:* PicPay
   💰 *Valor:* R$ XX,XX
4. Peça para enviar o comprovante
5. Informe que a ativação é em até 15 minutos
6. Ao confirmar pedido, inclua: [PEDIDO: nome_do_plano|preco]

=== TESTE GRÁTIS ===
Se cliente pedir teste:
1. Explique que é 24h gratuito
2. Peça nome completo e o dispositivo que vai usar
3. Inclua no final: [TESTE_SOLICITADO]

=== TRANSFERÊNCIA PARA HUMANO ===
Se cliente reclamar de problema técnico, quiser negociar preço,
ou pedir atendimento humano, inclua: [TRANSFERIR_HUMANO]

=== ENCERRAMENTO ===
Se cliente se despedir, inclua: [ENCERRAR_ATENDIMENTO]`;

  try {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [...history, { role: "user", content: userMessage }],
      },
      {
        headers: {
          "x-api-key": CONFIG.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
      }
    );

    const reply = response.data.content[0].text;
    addToHistory(userId, "user", userMessage);
    addToHistory(userId, "assistant", reply);
    return reply;

  } catch (err) {
    console.error("❌ Erro Claude:", err.response?.data || err.message);
    return "Opa, tive um probleminha técnico aqui! 😅 Tenta de novo em um instante, por favor.";
  }
}

// ============================================
// 📤 ENVIAR MENSAGEM WHATSAPP
// ============================================
async function sendMessage(to, text) {
  const clean = text
    .replace(/\[TRANSFERIR_HUMANO\]/g, "")
    .replace(/\[ENCERRAR_ATENDIMENTO\]/g, "")
    .replace(/\[TESTE_SOLICITADO\]/g, "")
    .replace(/\[PEDIDO:[^\]]*\]/g, "")
    .trim();

  if (!clean) return;

  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${CONFIG.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: clean },
      },
      {
        headers: {
          Authorization: `Bearer ${CONFIG.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`✅ Enviado para ${to}`);
  } catch (err) {
    console.error("❌ Erro ao enviar:", err.response?.data || err.message);
  }
}

// ============================================
// 🔄 PROCESSAR AÇÕES ESPECIAIS
// ============================================
function processActions(userId, reply) {
  const actions = { transferir: false, encerrar: false, teste: false, pedido: null };

  if (reply.includes("[TRANSFERIR_HUMANO]")) {
    actions.transferir = true;
    setState(userId, "aguardando_humano");
  }

  if (reply.includes("[ENCERRAR_ATENDIMENTO]")) {
    actions.encerrar = true;
    conversations.delete(userId);
    userStates.delete(userId);
    orders.delete(userId);
  }

  if (reply.includes("[TESTE_SOLICITADO]")) {
    actions.teste = true;
    setState(userId, "teste_solicitado");
  }

  const pedidoMatch = reply.match(/\[PEDIDO:([^\]]+)\]/);
  if (pedidoMatch) {
    const parts = pedidoMatch[1].split("|");
    if (parts.length === 2) {
      actions.pedido = { plano: parts[0].trim(), preco: parseFloat(parts[1]) };
      setState(userId, "aguardando_comprovante");
      orders.set(userId, {
        id: `PP-${Date.now()}`,
        userId,
        plano: parts[0].trim(),
        preco: parseFloat(parts[1]),
        status: "aguardando_pagamento",
        criadoEm: new Date().toISOString(),
      });
    }
  }

  return actions;
}

// ============================================
// 📩 WEBHOOK — VERIFICAÇÃO (GET)
// ============================================
app.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && token === CONFIG.VERIFY_TOKEN) {
    console.log("✅ Webhook verificado!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ============================================
// 📩 WEBHOOK — RECEBER MENSAGENS (POST)
// ============================================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const messages = req.body?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (!messages?.length) return;

    for (const msg of messages) {
      const from = msg.from;
      const type = msg.type;

      console.log(`\n📩 [${new Date().toLocaleTimeString("pt-BR")}] Mensagem de ${from} (${type})`);

      // Verificar horário de atendimento (09h-20h)
      const hora = new Date().getHours();
      if (hora < 9 || hora >= 20) {
        const state = getState(from);
        if (state !== "fora_horario_avisado") {
          await sendMessage(
            from,
            "Olá! 👋 Nosso atendimento é das *09h às 20h*, todos os dias.\n\nAssim que abrirmos, respondemos você! 😊\n\n_— Equipe Play Prime_ 🎬"
          );
          setState(from, "fora_horario_avisado");
        }
        continue;
      } else if (getState(from) === "fora_horario_avisado") {
        setState(from, "normal");
      }

      // Bloquear se já aguarda humano
      if (getState(from) === "aguardando_humano") {
        await sendMessage(from, "⏳ Você já está na fila para atendimento com nossa equipe. Em breve um atendente responde você!");
        continue;
      }

      // Processar imagem/documento (comprovante de pagamento)
      if (type === "image" || type === "document") {
        const state = getState(from);
        if (state === "aguardando_comprovante") {
          const order = orders.get(from);
          if (order) {
            order.status = "comprovante_recebido";
            order.comprovanteEm = new Date().toISOString();
            console.log(`\n💰 COMPROVANTE RECEBIDO — Pedido ${order.id} | Plano: ${order.plano} | R$ ${order.preco}`);
            // 👉 ADICIONE AQUI: notificar Rodrigo via e-mail, Telegram, etc.
            await sendMessage(
              from,
              `✅ Comprovante recebido! Obrigado!\n\n🎬 *Plano:* ${order.plano}\n⏳ Estamos ativando seu acesso em até *15 minutos*.\n\nQualquer dúvida é só chamar aqui! 😊`
            );
            setState(from, "ativacao_pendente");
          }
        } else {
          await sendMessage(from, "Recebi sua imagem! 😊 Como posso te ajudar?");
        }
        continue;
      }

      // Processar apenas texto
      if (type !== "text") {
        await sendMessage(from, "Oi! 😊 No momento só consigo ler mensagens de texto. Escreve sua dúvida que te respondo na hora!");
        continue;
      }

      const text = msg.text.body;
      console.log(`💬 "${text}"`);

      const reply = await askClaude(from, text);
      const actions = processActions(from, reply);

      await sendMessage(from, reply);

      // Logs de ações
      if (actions.transferir) {
        console.log(`\n🔔 ATENDIMENTO HUMANO SOLICITADO — ${from}`);
        console.log(`   👉 Acesse o WhatsApp e responda manualmente!`);
      }
      if (actions.teste) {
        console.log(`\n🆓 TESTE GRÁTIS SOLICITADO — ${from}`);
      }
      if (actions.pedido) {
        console.log(`\n🛒 NOVO PEDIDO — ${from}`);
        console.log(`   Plano: ${actions.pedido.plano} | R$ ${actions.pedido.preco}`);
        console.log(`   Aguardando comprovante de pagamento...`);
      }
      if (actions.encerrar) {
        console.log(`\n👋 Conversa encerrada com ${from}`);
      }
    }
  } catch (err) {
    console.error("❌ Erro no webhook:", err);
  }
});

// ============================================
// 🖥️ PAINEL DE CONTROLE
// ============================================
const path = require("path");
const fs = require("fs");

app.get("/painel", (req, res) => {
  const painelPath = path.join(__dirname, "painel-playprime.html");
  if (fs.existsSync(painelPath)) {
    res.sendFile(painelPath);
  } else {
    res.send("<h2>Painel não encontrado. Faça upload do arquivo painel-playprime.html</h2>");
  }
});

// ============================================
// 📊 STATUS
// ============================================
app.get("/status", (req, res) => {
  const pedidosPorStatus = {};
  for (const order of orders.values()) {
    pedidosPorStatus[order.status] = (pedidosPorStatus[order.status] || 0) + 1;
  }

  res.json({
    status: "online",
    empresa: "Play Prime 🎬",
    conversas_ativas: conversations.size,
    pedidos: pedidosPorStatus,
    aguardando_humano: [...userStates.values()].filter(s => s === "aguardando_humano").length,
    horario_atendimento: "09h às 20h",
    uptime: `${Math.floor(process.uptime() / 60)} minutos`,
    timestamp: new Date().toLocaleString("pt-BR"),
  });
});

// ============================================
// 🚀 INICIAR
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║  🎬  Play Prime — Bot WhatsApp       ║
║  📺  Streaming | IA | Pedidos        ║
╠══════════════════════════════════════╣
║  Porta   : ${PORT}                      ║
║  Webhook : /webhook                  ║
║  Status  : /status                   ║
╚══════════════════════════════════════╝
  `);
});
