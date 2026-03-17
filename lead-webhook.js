const fs = require('fs');
const path = require('path');

const LEADS_FILE = path.join(__dirname, 'leads.json');

function lerLeads() {
  if (!fs.existsSync(LEADS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function salvarLeads(leads) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

function registrarLeadRoutes(app, sendMessage) {
  app.get('/painel', (req, res) => {
    res.sendFile(path.join(__dirname, 'painel-playprime.html'));
  });

  app.get('/api/leads', (req, res) => {
    res.json(lerLeads());
  });

  app.put('/api/leads/:id/status', (req, res) => {
    const leads = lerLeads();
    const lead = leads.find(l => l.id === req.params.id);
    if (lead) {
      lead.status = req.body.status;
      salvarLeads(leads);
    }
    res.json({ ok: true });
  });

  app.post('/api/leads/:id/message', (req, res) => {
    const leads = lerLeads();
    const lead = leads.find(l => l.id === req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
    sendMessage(lead.phone, req.body.message);
    lead.status = 'enviado';
    salvarLeads(leads);
    res.json({ ok: true });
  });
}

function adicionarLead(lead) {
  const leads = lerLeads();
  const existe = leads.find(l => l.id === lead.id);
  if (!existe) {
    leads.push(lead);
    salvarLeads(leads);
  }
}

module.exports = { registrarLeadRoutes, adicionarLead, lerLeads, salvarLeads };
