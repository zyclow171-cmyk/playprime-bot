app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    body.entry?.forEach(entry => {
      entry.changes?.forEach(change => {
        const messages = change.value?.messages;
        if (messages) {
          messages.forEach(msg => {
            const phone = msg.from;
            enviarMensagem(phone, 'Olá! 👋 Seja bem-vindo à PlayPrime IPTV! 🎬📺 Temos os melhores planos com mais de 500 canais, filmes e séries. Quer saber mais sobre nossos planos e preços? Responda SIM que te envio tudo!');
          });
        }
      });
    });
  }
  res.sendStatus(200);
});
