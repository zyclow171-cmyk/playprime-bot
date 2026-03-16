require('dotenv').config();

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

app.post("/lead", async (req, res) => {

const lead = req.body;

console.log("Novo lead recebido:", lead);

try {

await axios.post(
`https://graph.facebook.com/v18.0/${process.env.NUMERO_ID}/messages`,
{
messaging_product: "whatsapp",
to: lead.phone,
type: "text",
text: { body: "Olá! Recebi seu interesse no streaming. Quer testar grátis?" }
},
{
headers:{
Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`
}
}
);

} catch(e){
console.log("Erro ao enviar mensagem:",e.message)
}

res.sendStatus(200);

});

app.listen(4000, () => {
console.log("Webhook rodando na porta 4000");
});
