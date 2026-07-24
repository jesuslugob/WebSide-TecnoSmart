// ===== TECNOSMART — SERVIDOR MERCADOPAGO =====
// Deploy en Render.com

const http  = require('http');
const https = require('https');
const url   = require('url');

// Credenciales desde variable de entorno (se configura en Render)
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || 'APP_USR-1766369057262935-072220-775e68c2d0f707d18297c95b792543e1-3562487044'; // PRUEBA
const PORT            = process.env.PORT || 3000;

// ── Leer body JSON ───────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('JSON inválido')); }
    });
  });
}

// ── Llamar API MercadoPago ───────────────────────────────────────────────────
function mpPost(path, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const options = {
      hostname: 'api.mercadopago.com',
      path,
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Respuesta inválida de MP')); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ===== SERVIDOR =====
const server = http.createServer(async (req, res) => {

  // CORS — permite peticiones desde Netlify y localhost
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const { pathname } = url.parse(req.url);

  // ── Health check (Render lo necesita) ───────────────────────────────────
  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', app: 'TecnoSmart Server' }));
    return;
  }

  // ── POST /crear-preferencia ──────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/crear-preferencia') {
    try {
      const body  = await readBody(req);
      const { items, buyer } = body;

      const mpItems = items.map(i => ({
        id:          String(i.id),
        title:       i.name,
        quantity:    i.qty,
        unit_price:  i.price,
        currency_id: 'COP'
      }));

      const preference = {
        items: mpItems,
        payer: {
          name:  buyer?.name  || '',
          email: buyer?.email || 'comprador@tecnosmart.co'
        },
        statement_descriptor: 'TecnoSmart',
        external_reference:   `TS-${Date.now()}`
      };

      const result = await mpPost('/checkout/preferences', preference);

      console.log('MP Response:', JSON.stringify(result, null, 2));

      if (result.id) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          preferenceId: result.id,
          initPoint:    result.init_point,
          sandboxUrl:   result.sandbox_init_point
        }));
      } else {
        // Devolver el error completo de MP para depuración
        const errMsg = result.message || result.error || JSON.stringify(result);
        throw new Error(errMsg);
      }

    } catch (err) {
      console.error('Error MP:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  🚀 TecnoSmart Server corriendo en puerto ${PORT}`);
  console.log(`  ✅ MercadoPago listo\n`);
});
