// ===== NETLIFY FUNCTION — WOMPI =====
const https = require('https');
const crypto = require('crypto');

const WOMPI_PUBLIC_KEY  = process.env.WOMPI_PUBLIC_KEY  || 'pub_test_TGKHUGlVCnz9SKz2BcUr1GpBKJxFEUoM';
const WOMPI_PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY || 'prv_test_vYrkQDyphweluspErGR6wFK8wGEks4pM';
const WOMPI_BASE        = 'sandbox.wompi.co'; // pruebas — cambiar a 'production.wompi.co' para producción

function wompiPost(path, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const options = {
      hostname: WOMPI_BASE,
      path,
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${WOMPI_PRIVATE_KEY}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Respuesta inválida de Wompi')); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function wompiGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: WOMPI_BASE,
      path,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${WOMPI_PUBLIC_KEY}` }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Error leyendo Wompi')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { items, buyer } = JSON.parse(event.body);

    // Calcular total en centavos (Wompi usa centavos de COP)
    const totalCOP = items.reduce((s, i) => s + (i.price * i.qty), 0);
    const amountInCents = totalCOP * 100;

    // Crear referencia única
    const reference = `TS-${Date.now()}`;

    // Obtener token de aceptación de Wompi
    const merchantData = await wompiGet('/v1/merchants/' + WOMPI_PUBLIC_KEY);
    const acceptanceToken = merchantData?.data?.presigned_acceptance?.acceptance_token;

    if (!acceptanceToken) throw new Error('No se pudo obtener el token de aceptación');

    // Crear transacción en Wompi
    const transaction = {
      amount_in_cents: amountInCents,
      currency:        'COP',
      customer_email:  buyer?.email || 'cliente@tecnosmart.co',
      reference,
      payment_method: {
        type:           'CARD',
        installments:   1
      },
      acceptance_token: acceptanceToken,
      customer_data: {
        full_name: buyer?.name  || '',
        phone_number: buyer?.phone || ''
      }
    };

    const result = await wompiPost('/v1/transactions', transaction);

    console.log('Wompi result:', JSON.stringify(result));

    if (result.data?.id) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          transactionId:  result.data.id,
          status:         result.data.status,
          reference,
          publicKey:      WOMPI_PUBLIC_KEY,
          amountInCents,
          currency:       'COP',
          redirectUrl:    result.data.redirect_url || null
        })
      };
    } else {
      throw new Error(result.error?.reason || JSON.stringify(result));
    }

  } catch (err) {
    console.error('Error Wompi:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
