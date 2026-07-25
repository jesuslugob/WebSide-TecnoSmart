// ===== NETLIFY FUNCTION — GUARDAR PEDIDO EN FIRESTORE =====
const https = require('https');

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'tecnosmart-f357b';
const FIREBASE_API_KEY    = process.env.FIREBASE_API_KEY    || 'AIzaSyDCHxSYD4gtsCyNkgarDCXXu0p7GRuHPhQ';

// ── Llamar REST API de Firestore ─────────────────────────────────────────────
function firestorePost(collection, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ fields: toFirestoreFields(data) });
    const path = `/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}`;
    const options = {
      hostname: 'firestore.googleapis.com',
      path:     `${path}?key=${FIREBASE_API_KEY}`,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Respuesta inválida de Firestore')); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Convertir objeto JS a formato Firestore ──────────────────────────────────
function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string')       fields[key] = { stringValue: value };
    else if (typeof value === 'number')  fields[key] = { integerValue: String(value) };
    else if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else if (Array.isArray(value))       fields[key] = { stringValue: JSON.stringify(value) };
    else if (value === null)             fields[key] = { nullValue: null };
    else                                 fields[key] = { stringValue: JSON.stringify(value) };
  }
  return fields;
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
    const { reference, buyer, address, items, total, status, transactionId } = JSON.parse(event.body);

    const pedido = {
      reference:     reference     || '',
      estado:        status         || 'APROBADO',
      nombre:        buyer?.name    || '',
      email:         buyer?.email   || '',
      telefono:      buyer?.phone   || '',
      direccion:     address?.street || '',
      ciudad:        address?.city   || '',
      departamento:  address?.dept   || '',
      productos:     JSON.stringify(items || []),
      total:         total          || 0,
      transactionId: transactionId  || '',
      fecha:         new Date().toISOString(),
      fechaLegible:  new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })
    };

    const result = await firestorePost('pedidos', pedido);

    if (result.name) {
      console.log('✅ Pedido guardado:', result.name);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, id: result.name })
      };
    } else {
      throw new Error(result.error?.message || JSON.stringify(result));
    }

  } catch (err) {
    console.error('Error Firestore:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
