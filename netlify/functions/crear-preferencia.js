// ===== NETLIFY FUNCTION — MERCADOPAGO =====
const https = require('https');

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

function mpPost(data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const options = {
      hostname: 'api.mercadopago.com',
      path:     '/checkout/preferences',
      method:   'POST',
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

exports.handler = async (event) => {
  // CORS
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { items, buyer } = JSON.parse(event.body);

    const mpItems = items.map(i => ({
      id:          String(i.id),
      title:       i.name,
      quantity:    Number(i.qty),
      unit_price:  Number(i.price),
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

    const result = await mpPost(preference);

    console.log('MP Result:', JSON.stringify(result));

    if (result.id) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          preferenceId: result.id,
          initPoint:    result.init_point,
          sandboxUrl:   result.sandbox_init_point
        })
      };
    } else {
      throw new Error(result.message || result.error || JSON.stringify(result));
    }

  } catch (err) {
    console.error('Error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
