// ===== NETLIFY FUNCTION — WOMPI con firma de integridad =====
const crypto = require('crypto');

const WOMPI_PUBLIC_KEY     = process.env.WOMPI_PUBLIC_KEY     || 'pub_prod_LwLNiMwdT5z9TX4w01aiRB5rbzNzLADV';
const WOMPI_INTEGRITY_KEY  = process.env.WOMPI_INTEGRITY_KEY  || 'prod_integrity_cFbyIGSxCmI2urffQBA5gFII0254Ysaj';

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
    const { items } = JSON.parse(event.body);

    // Total en centavos
    const totalCOP       = items.reduce((s, i) => s + (i.price * i.qty), 0);
    const amountInCents  = totalCOP * 100;
    const currency       = 'COP';
    const reference      = `TS-${Date.now()}`;

    // Generar firma de integridad SHA256
    // Formato: reference + amountInCents + currency + integrityKey
    const signatureStr   = `${reference}${amountInCents}${currency}${WOMPI_INTEGRITY_KEY}`;
    const signature      = crypto.createHash('sha256').update(signatureStr).digest('hex');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        publicKey:     WOMPI_PUBLIC_KEY,
        amountInCents,
        currency,
        reference,
        signature
      })
    };

  } catch (err) {
    console.error('Error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
