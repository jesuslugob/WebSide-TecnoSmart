// ===== STATE =====
let cart = JSON.parse(localStorage.getItem('tsCart') || '[]');

// Llamar carga de productos desde Firestore (se ejecuta después del DOM)
document.addEventListener('DOMContentLoaded', async () => {
  if (typeof window.cargarProductosTienda === 'function') {
    await window.cargarProductosTienda();
    actualizarPreciosDOM();
  }
  if (typeof window.cargarCalificaciones === 'function') {
    window.cargarCalificaciones(); // onSnapshot — no necesita await
  }
  // Detectar retorno de Wompi (pago por PSE / Bancolombia / Nequi)
  procesarRetornoWompi();
});

// ===== STARS HELPER =====
function renderStarHTML(avg, count) {
  const full  = Math.floor(avg);
  const half  = (avg - full) >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  const stars = '<i class="fas fa-star"></i>'.repeat(full)
    + (half ? '<i class="fas fa-star-half-alt"></i>' : '')
    + '<i class="far fa-star"></i>'.repeat(empty);
  return `<div class="stars">${stars}</div><span class="star-count">${avg.toFixed(1)} (${count.toLocaleString('es-CO')})</span>`;
}

// ===== WOMPI REDIRECT HANDLER =====
// Guarda el pedido pendiente antes de abrir el widget (por si Wompi redirige)
function guardarPedidoPendiente(buyer, address, cartItems, reference) {
  const pedido = { buyer, address, cartItems, reference, ts: Date.now() };
  localStorage.setItem('wompPedidoPendiente', JSON.stringify(pedido));
}

// Al cargar la página detecta si venimos de un redirect de Wompi
async function procesarRetornoWompi() {
  const params = new URLSearchParams(window.location.search);
  const transactionId = params.get('id') || params.get('transaction_id');
  if (!transactionId) return;

  // Limpiar la URL sin recargar
  window.history.replaceState({}, '', window.location.pathname);

  const pendienteRaw = localStorage.getItem('wompPedidoPendiente');
  if (!pendienteRaw) return;

  let pedido;
  try { pedido = JSON.parse(pendienteRaw); } catch { return; }

  // Evitar procesar dos veces
  localStorage.removeItem('wompPedidoPendiente');

  // Verificar estado de la transacción con Wompi
  try {
    const res  = await fetch(`https://production.wompi.co/v1/transactions/${transactionId}`);
    const json = await res.json();
    const status = json?.data?.status;
    if (status !== 'APPROVED') return;
  } catch { /* si falla la verificación igual procesamos */ }

  const { buyer, address, cartItems, reference, esContraEntrega, valorProducto, valorEnvio } = pedido;
  const total = cartItems.reduce((s, i) => s + (i.price * i.qty), 0);

  if (esContraEntrega) {
    await completarPedidoCE({ buyer, address, cartSnapshot: cartItems, referencia: reference, transactionId, total });
    return;
  }

  // Guardar pedido en Firebase
  try {
    await fetch(`${SERVER_URL}/guardar-pedido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyer, address, items: cartItems, reference, transactionId, total })
    });
  } catch (err) { console.error('❌ Error guardando pedido:', err); }

  // Enviar emails
  enviarEmailPedido(buyer, address, cartItems, reference)
    .catch(err => console.error('❌ Email dueño:', err));
  enviarEmailCliente(buyer, address, cartItems, reference)
    .catch(err => console.error('❌ Email cliente:', err));

  clearCart();
  showToast('✅ ¡Pago confirmado! Revisa tu correo.', 'success');
}

// Actualiza las tarjetas de producto en el DOM con TODOS los datos de Firebase
function actualizarPreciosDOM() {
  Object.values(products).forEach(p => {
    const card = document.querySelector(`.product-card[data-id="${p.id}"]`);
    if (!card) return;

    // Nombre
    const titleEl = card.querySelector('.card-title');
    if (titleEl) titleEl.textContent = p.name;

    // Tag
    const tagEl = card.querySelector('.card-tag');
    if (tagEl && p.tag) tagEl.textContent = p.tag;

    // Descripción corta
    const descEl = card.querySelector('.card-desc');
    if (descEl && p.desc) descEl.textContent = p.desc.length > 80 ? p.desc.slice(0, 80) + '…' : p.desc;

    // Precio y precio anterior
    const priceEl    = card.querySelector('.price');
    const priceOldEl = card.querySelector('.price-old');
    if (priceEl)    priceEl.textContent    = formatCOP(p.price);
    if (priceOldEl) priceOldEl.textContent = formatCOP(p.oldPrice);

    // Badge — siempre visible, nunca vacío
    const badgeEl = card.querySelector('.card-badge');
    if (badgeEl) {
      const badgeText  = (p.badge && p.badge.trim()) ? p.badge.trim() : 'Nuevo';
      const badgeColor = (p.badgeColor && p.badgeColor.trim()) ? p.badgeColor : 'linear-gradient(135deg,#6c63ff,#a78bfa)';
      badgeEl.textContent      = badgeText;
      badgeEl.style.background = badgeColor;
      badgeEl.style.display    = '';
    }

    // Imagen principal
    const firstImg = card.querySelector('.card-img-wrap img.active-slide');
    if (firstImg && p.img) {
      firstImg.src = p.img;
      firstImg.alt = p.name;
    }

    // Botón agregar
    const btn = card.querySelector('.add-cart-btn');
    if (btn) {
      btn.setAttribute('onclick',
        `event.stopPropagation();addToCart(${p.id},'${p.name.replace(/'/g,"\\'")}',${p.price},'${p.img}')`);
    }

    // onclick de la card
    card.setAttribute('onclick', `openModal(${p.id})`);
    const qvBtn = card.querySelector('.quick-view');
    if (qvBtn) qvBtn.setAttribute('onclick', `event.stopPropagation();openModal(${p.id})`);
  });
}

// ===== EMAILJS CONFIG =====
const EMAILJS_SERVICE_ID       = 'service_7liinxs';
const EMAILJS_TEMPLATE_PEDIDO  = 'template_g2sa7yg';   // Notificación al dueño
const EMAILJS_TEMPLATE_CLIENTE = 'template_st3y1xl';   // Confirmación al cliente

/**
 * Envía email de notificación al dueño de la tienda.
 */
function enviarEmailPedido(buyer, address, cartItems, reference) {
  const productos = cartItems.map(i =>
    `• ${i.name} x${i.qty} — ${formatCOP(i.price * i.qty)}`
  ).join('\n');
  const total = cartItems.reduce((s, i) => s + (i.price * i.qty), 0);

  return emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_PEDIDO, {
    asunto:           `🛍️ Nuevo pedido TecnoSmart — ${reference}`,
    order_ref:        reference,
    cliente_nombre:   buyer.name    || 'No especificado',
    cliente_email:    buyer.email   || 'No especificado',
    cliente_telefono: buyer.phone   || 'No especificado',
    direccion:        address.street || 'No especificada',
    ciudad:           address.city   || 'No especificada',
    departamento:     address.dept   || 'No especificado',
    productos,
    total:            formatCOP(total),
    fecha:            new Date().toLocaleString('es-CO')
  });
}

/**
 * Envía email de confirmación de compra al cliente.
 */
function enviarEmailCliente(buyer, address, cartItems, reference) {
  const productos = cartItems.map(i =>
    `• ${i.name} x${i.qty} — ${formatCOP(i.price * i.qty)}`
  ).join('\n');
  const total = cartItems.reduce((s, i) => s + (i.price * i.qty), 0);

  return emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_CLIENTE, {
    to_email:         buyer.email   || '',
    to_name:          buyer.name    || 'Cliente',
    order_ref:        reference,
    cliente_nombre:   buyer.name    || 'No especificado',
    cliente_telefono: buyer.phone   || 'No especificado',
    direccion:        address.street || 'No especificada',
    ciudad:           address.city   || 'No especificada',
    departamento:     address.dept   || 'No especificado',
    productos,
    total:            formatCOP(total),
    fecha:            new Date().toLocaleString('es-CO')
  });
}

// ===== PRODUCT DATA =====
// Formato pesos colombianos
function formatCOP(value) {
  return '$' + value.toLocaleString('es-CO');
}

const products = {
  1: {
    id: 1, name: 'AirPods Pro 3', price: 1600, oldPrice: 2000,
    badge: 'Nuevo', badgeColor: 'linear-gradient(135deg,#6c63ff,#a78bfa)',
    img: 'img/Airpods Pro 3/pro3-1.jpg',
    fallback: 'https://images.unsplash.com/photo-1600294037547-5cb5c1d0edd0?w=400&q=80',
    gallery: [
      'img/Airpods Pro 3/pro3-1.jpg',
      'img/Airpods Pro 3/pro3-2.jpg',
      'img/Airpods Pro 3/pro3-3.jpg',
      'img/Airpods Pro 3/pro3-4.jpg',
      'img/Airpods Pro 3/pro3-5.jpg'
    ],
    tag: 'Pro Series',
    desc: 'Disfruta de un sonido potente con cancelación activa de ruido (ANC), modo transparencia y audio espacial personalizado. Calidad 1.1 con hasta 24h de batería total.',
    features: ['2× mejor cancelación de ruido activa', 'Modo transparencia', 'Audio espacial personalizado', 'Carga MagSafe y USB-C', 'Resistencia IPX4'],
    specs: {}
  },
  2: {
    id: 2, name: 'AirPods Pro 2', price: 1600, oldPrice: 2000,
    badge: 'Nuevo', badgeColor: 'linear-gradient(135deg,#6c63ff,#a78bfa)',
    img: 'img/Airpods Pro 2/pro2-1.jpg',
    fallback: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=400&q=80',
    gallery: [
      'img/Airpods Pro 2/pro2-1.jpg',
      'img/Airpods Pro 2/pro2-2.jpg',
      'img/Airpods Pro 2/pro2-3.jpg',
      'img/Airpods Pro 2/pro2-4.jpg'
    ],
    tag: 'Pro Series',
    desc: 'Audífonos inalámbricos Calidad 1.1 con sonido de alta definición, cancelación de ruido activa y estuche con altavoz integrado. Compatibles con iOS y Android.',
    features: ['Cancelación activa de ruido', 'Modo de sonido ambiente', 'Estuche con altavoz integrado', 'Audio espacial personalizado', 'Resistencia IPX4'],
    specs: {}
  },
  3: {
    id: 3, name: 'AirPods Series 3', price: 1600, oldPrice: 2000,
    badge: 'Nuevo', badgeColor: 'linear-gradient(135deg,#6c63ff,#a78bfa)',
    img: 'img/Series 3/series3-1.jpg',
    fallback: 'https://images.unsplash.com/photo-1631176093617-43abc0cbcb09?w=400&q=80',
    gallery: [
      'img/Series 3/series3-1.jpg',
      'img/Series 3/series3-2.jpg',
      'img/Series 3/series3-3.jpg',
      'img/Series 3/series3-4.jpg'
    ],
    tag: 'Standard Series',
    desc: 'Una excelente alternativa para quienes buscan calidad de sonido, comodidad y una conexión estable. Incorporan Bluetooth 5.3, control táctil y batería de larga duración.',
    features: ['Audio espacial dinámico', 'EQ adaptativo automático', 'Diseño ergonómico ligero', 'Resistencia IPX4', 'Carga MagSafe'],
    specs: {}
  },
  4: {
    id: 4, name: 'AirPods Series 4', price: 1600, oldPrice: 2000,
    badge: 'Nuevo', badgeColor: 'linear-gradient(135deg,#6c63ff,#a78bfa)',
    img: 'img/Series 4/series4-1.jpg',
    fallback: 'https://images.unsplash.com/photo-1580894906475-403275592de5?w=400&q=80',
    gallery: [
      'img/Series 4/series4-1.jpg',
      'img/Series 4/series4-2.jpg',
      'img/Series 4/series4-3.jpg'
    ],
    tag: 'Standard Series',
    desc: 'Los AirPods de 4ta generación con nuevo diseño ergonómico sin silicona, audio adaptativo, detección de conversación y hasta 24 horas de batería total.',
    features: ['Nuevo diseño ergonómico sin almohadilla', 'Audio adaptativo', 'Detección de conversación', 'Carga USB-C y MagSafe', 'Hasta 24h con estuche'],
    specs: {}
  }
};

// ===== NAVBAR SCROLL =====
window.addEventListener('scroll', () => {
  const nav = document.getElementById('navbar');
  if (window.scrollY > 50) nav.classList.add('scrolled');
  else nav.classList.remove('scrolled');
});

// ===== MOBILE MENU =====
function toggleMenu() {
  const links = document.getElementById('navLinks');
  const ham = document.getElementById('hamburger');
  links.classList.toggle('open');
  ham.classList.toggle('active');
}

// Close menu on link click
document.querySelectorAll('.nav-links a').forEach(a => {
  a.addEventListener('click', () => {
    document.getElementById('navLinks').classList.remove('open');
    document.getElementById('hamburger').classList.remove('active');
  });
});

// ===== CART =====
function addToCart(id, name, price, img) {
  const existing = cart.find(i => i.id === id);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ id, name, price, img, qty: 1 });
  }
  saveCart();
  renderCart();
  showToast(`✅ ${name} agregado al carrito`, 'success');
  // Animate button
  const btn = event.currentTarget;
  btn.innerHTML = '<i class="fas fa-check"></i> Agregado!';
  btn.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
  setTimeout(() => {
    btn.innerHTML = '<i class="fas fa-bag-shopping"></i> Agregar';
    btn.style.background = '';
  }, 1500);
}

function saveCart() {
  localStorage.setItem('tsCart', JSON.stringify(cart));
  document.getElementById('cartCount').textContent = cart.reduce((s, i) => s + i.qty, 0);
}

function renderCart() {
  const container = document.getElementById('cartItems');
  const footer    = document.getElementById('cartFooter');
  const countEl   = document.getElementById('cartItemCount');

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty-icon"><i class="fas fa-bag-shopping"></i></div>
        <h4>Tu carrito está vacío</h4>
        <p>Aún no has agregado ningún producto. Explora nuestra colección y encuentra los AirPods ideales para ti.</p>
        <button class="cart-empty-btn" onclick="toggleCart(); document.getElementById('productos').scrollIntoView({behavior:'smooth'})">
          <i class="fas fa-headphones-alt"></i> Explorar productos
        </button>
      </div>`;
    footer.style.display = 'none';
    if (countEl) countEl.textContent = '0 productos';
    return;
  }

  const totalItems = cart.reduce((s, i) => s + i.qty, 0);
  if (countEl) countEl.textContent = `${totalItems} producto${totalItems !== 1 ? 's' : ''}`;

  container.innerHTML = cart.map(item => {
    const subtotal = item.price * item.qty;
    return `
    <div class="cart-item" id="cart-item-${item.id}">
      <img class="cart-item-img"
           src="${item.img}"
           alt="${item.name}"
           onerror="this.src='https://images.unsplash.com/photo-1600294037547-5cb5c1d0edd0?w=80&q=80'" />
      <div class="cart-item-body">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">${formatCOP(item.price)} c/u</div>
        <div class="cart-item-row">
          <div class="cart-item-qty">
            <button class="qty-btn" onclick="changeQty(${item.id}, -1)" aria-label="Reducir">−</button>
            <span class="qty-num">${item.qty}</span>
            <button class="qty-btn" onclick="changeQty(${item.id}, 1)" aria-label="Aumentar">+</button>
          </div>
          <span class="cart-item-subtotal">${formatCOP(subtotal)}</span>
        </div>
      </div>
      <button class="remove-item" onclick="removeItem(${item.id})" aria-label="Eliminar ${item.name}">
        <i class="fas fa-trash-alt"></i>
      </button>
    </div>`;
  }).join('');

  const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);
  const subtotalEl = document.getElementById('cartSubtotal');
  const totalEl    = document.getElementById('cartTotal');
  if (subtotalEl) subtotalEl.textContent = formatCOP(subtotal);
  if (totalEl)    totalEl.textContent    = formatCOP(subtotal);
  footer.style.display = 'block';
}

function changeQty(id, delta) {
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(i => i.id !== id);
  saveCart();
  renderCart();
}

function removeItem(id) {
  const el = document.getElementById(`cart-item-${id}`);
  if (el) {
    el.classList.add('removing');
    setTimeout(() => {
      cart = cart.filter(i => i.id !== id);
      saveCart();
      renderCart();
    }, 250);
  } else {
    cart = cart.filter(i => i.id !== id);
    saveCart();
    renderCart();
  }
  showToast('Producto eliminado del carrito');
}

function clearCart() {
  cart = [];
  saveCart();
  renderCart();
}

function toggleCart() {
  const sidebar = document.getElementById('cartSidebar');
  const overlay = document.getElementById('cartOverlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('active');
  document.body.style.overflow = sidebar.classList.contains('open') ? 'hidden' : '';
}

// ===== PRODUCT MODAL =====
let modalQty = 1;
let currentModalProduct = null;

function openModal(id) {
  const p = products[id];
  if (!p) return;
  currentModalProduct = p;
  modalQty = 1;

  const discount = Math.round((1 - p.price / p.oldPrice) * 100);
  const featuresHTML = (p.features || []).map(f => `
    <li><i class="fas fa-check-circle"></i> ${f}</li>
  `).join('');
  const galleryThumbs = [
    // Primero el video como miniatura
    `<button class="gallery-thumb active" onclick="changeGalleryMedia(this,'video','img/Series 4/airpods-promo.mp4')">
      <video muted loop style="width:100%;height:100%;object-fit:cover;pointer-events:none">
        <source src="img/Series 4/airpods-promo.mp4" type="video/mp4"/>
      </video>
     </button>`,
    // Luego las fotos
    ...(p.gallery || [p.img]).map((src, i) => `
      <button class="gallery-thumb" onclick="changeGalleryMedia(this,'img','${src}')">
        <img src="${src}" alt="foto ${i+1}" onerror="this.src='${p.fallback}'" />
      </button>
    `)
  ].join('');

  document.getElementById('modalContent').innerHTML = `
    <div class="product-detail">
      <!-- Galería -->
      <div class="pd-gallery">
        <div class="pd-main-img-wrap">
          <video id="pdMainVideo" autoplay muted loop playsinline style="display:none;width:100%;height:100%;object-fit:cover;border-radius:16px">
            <source id="pdMainVideoSrc" src="img/Series 4/airpods-promo.mp4" type="video/mp4" />
          </video>
          <img id="pdMainImg" src="${p.gallery?.[0]||p.img}" alt="${p.name}" onerror="this.src='${p.fallback}'" style="display:block" />
          ${p.badge ? `<div class="pd-badge" style="background:${p.badgeColor}">${p.badge}</div>` : ''}
          <div class="pd-discount-badge">-${discount}%</div>
        </div>
        <div class="pd-thumbs">${galleryThumbs}</div>
      </div>

      <!-- Info -->
      <div class="pd-info">
        <div class="pd-tag">🎧 AirPods Calidad 1.1</div>
        <h2 class="pd-title">${p.name}</h2>
        <div class="pd-stars" id="pd-stars-${p.id}">
          ${(()=>{
            const cal = window._calificaciones?.[p.id];
            if (!cal) return '<i class="fas fa-star"></i>'.repeat(5) + '<span>4.9 (327)</span>';
            const avg   = cal.modoManual ? cal.manualEstrellas : cal.promedioReal;
            const count = cal.modoManual ? cal.manualCantidad  : cal.cantidadReal;
            return avg ? renderStarHTML(avg, count) : '<i class="fas fa-star"></i>'.repeat(5) + '<span>4.9 (327)</span>';
          })()}
        </div>

        <div class="pd-price-row">
          <span class="pd-price">${formatCOP(p.price)}</span>
          <span class="pd-old-price">${formatCOP(p.oldPrice)}</span>
          <span class="pd-save-badge">Ahorras ${formatCOP(p.oldPrice - p.price)}</span>
        </div>

        <div class="pd-stock"><i class="fas fa-circle" style="color:#22c55e;font-size:8px"></i> En stock — Envío hoy</div>

        <p class="pd-desc">${p.desc}</p>

        <ul class="pd-features">${featuresHTML}</ul>

        <!-- Cantidad -->
        <div class="pd-qty-row">
          <span class="pd-qty-label">Cantidad:</span>
          <div class="pd-qty-ctrl">
            <button class="pd-qty-btn" onclick="changeModalQty(-1)">−</button>
            <span id="pdQtyNum">1</span>
            <button class="pd-qty-btn" onclick="changeModalQty(1)">+</button>
          </div>
          <span class="pd-qty-total" id="pdQtyTotal">${formatCOP(p.price)}</span>
        </div>

        <!-- Botones -->
        <div class="pd-btns">
          <button class="pd-btn-cart" onclick="addToCartFromModal()">
            <i class="fas fa-bag-shopping"></i> Agregar al carrito
          </button>
          <button class="pd-btn-buy" onclick="buyNowFromModal()">
            <i class="fas fa-lock"></i> Comprar ahora
          </button>
        </div>

        <!-- Trust badges -->
        <div class="pd-trust">
          <div class="pd-trust-item"><i class="fas fa-shipping-fast"></i><span>Envío gratis</span></div>
          <div class="pd-trust-item"><i class="fas fa-shield-alt"></i><span>Garantía 1 mes</span></div>
          <div class="pd-trust-item"><i class="fas fa-undo"></i><span>Devolución 30 días</span></div>
          <div class="pd-trust-item"><i class="fas fa-lock"></i><span>Pago seguro</span></div>
        </div>

        <!-- Widget calificación cliente -->
        <div class="rating-widget" id="ratingWidget-${p.id}">
          ${(()=>{
            const lsKey = `cal_voted_prod_${p.id}`;
            const last  = parseInt(localStorage.getItem(lsKey) || '0');
            const yaCalifico = (Date.now() - last) < 24 * 60 * 60 * 1000;
            if (yaCalifico) return `
              <p style="color:var(--text2);font-size:13px;text-align:center">
                <i class="fas fa-check-circle" style="color:#22c55e"></i> Ya calificaste este producto. ¡Gracias!
              </p>`;
            return `
              <p>¿Qué te pareció este producto?</p>
              <div class="star-picker" id="picker-${p.id}">
                ${[1,2,3,4,5].map(n=>`<button onclick="hoverStar(${p.id},${n})" onmouseout="resetStarHover(${p.id})" data-val="${n}">★</button>`).join('')}
              </div>
              <button class="btn-rate" id="btnRate-${p.id}" disabled onclick="enviarCalificacion(${p.id}, '${`prod_${p.id}`}')">
                Enviar calificación
              </button>`;
          })()}
        </div>

      </div>
      </div>
    </div>

    <!-- Sticky bar (móvil) -->
    <div class="pd-sticky-bar">
      <div class="pd-sticky-info">
        <span class="pd-sticky-name">${p.name}</span>
        <span class="pd-sticky-price">${formatCOP(p.price)}</span>
      </div>
      <button class="pd-btn-buy" onclick="addToCartFromModal(); closeModal()">
        <i class="fas fa-bag-shopping"></i> Agregar
      </button>
    </div>
  `;

  document.getElementById('modalOverlay').classList.add('active');
  document.getElementById('productModal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function changeGalleryMedia(btn, type, src) {
  const img   = document.getElementById('pdMainImg');
  const video = document.getElementById('pdMainVideo');
  document.querySelectorAll('.gallery-thumb').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  if (type === 'video') {
    img.style.display   = 'none';
    video.style.display = 'block';
    const vsrc = document.getElementById('pdMainVideoSrc');
    if (vsrc.src !== src) { vsrc.src = src; video.load(); }
    video.play();
  } else {
    video.style.display = 'none';
    video.pause();
    img.style.display = 'block';
    img.src = src;
  }
}

function changeModalQty(delta) {
  modalQty = Math.max(1, modalQty + delta);
  document.getElementById('pdQtyNum').textContent = modalQty;
  if (currentModalProduct) {
    document.getElementById('pdQtyTotal').textContent = formatCOP(currentModalProduct.price * modalQty);
  }
}

function addToCartFromModal() {
  if (!currentModalProduct) return;
  const p = currentModalProduct;
  const img = p.gallery?.[0] || p.img;
  const existing = cart.find(i => i.id === p.id);
  if (existing) existing.qty += modalQty;
  else cart.push({ id: p.id, name: p.name, price: p.price, img, qty: modalQty });
  saveCart();
  renderCart();
  showToast(`✅ ${p.name} × ${modalQty} agregado`, 'success');
  closeModal();
}

function buyNowFromModal() {
  if (!currentModalProduct) return;
  addToCartFromModal();
  setTimeout(() => openCheckout(), 300);
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  document.getElementById('productModal').classList.remove('active');
  document.body.style.overflow = '';
  currentModalProduct = null;
  modalQty = 1;
}

// ===== CHECKOUT =====
let currentStep = 1;

function openCheckout() {
  if (cart.length === 0) { showToast('Tu carrito está vacío', 'error'); return; }
  toggleCart();
  setTimeout(() => {
    renderOrderSummary();
    document.getElementById('checkoutOverlay').classList.add('active');
    document.getElementById('checkoutModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    goStep(1);

    // Pre-rellenar con datos del usuario logueado
    const u = window.currentUser;
    if (u) {
      const nameEl  = document.getElementById('co-name');
      const emailEl = document.getElementById('co-email');
      const phoneEl = document.getElementById('co-phone');
      if (nameEl  && !nameEl.value)  nameEl.value  = u.name  || '';
      if (emailEl && !emailEl.value) emailEl.value = u.email || '';
      if (phoneEl && !phoneEl.value) phoneEl.value = u.phone || '';

      // Pre-rellenar dirección guardada
      if (u.address?.street) {
        const addrEl = document.getElementById('co-address');
        const cityEl = document.getElementById('co-city');
        const deptEl = document.getElementById('co-dept');
        if (addrEl) addrEl.value = u.address.street || '';
        if (cityEl) cityEl.value = u.address.city   || '';
        if (deptEl) deptEl.value = u.address.dept   || '';
      }
    }
  }, 400);
}

function closeCheckout() {
  document.getElementById('checkoutOverlay').classList.remove('active');
  document.getElementById('checkoutModal').classList.remove('active');
  document.body.style.overflow = '';
  currentStep = 1;
}

// Variable global para el método de pago seleccionado
let selectedPaymentMethod = 'wompi';
const COSTO_ENVIO = 8000; // $8.000 COP — costo del envío para contra entrega

function selectPaymentMethod(method) {
  selectedPaymentMethod = method;
  document.getElementById('pmWompi').classList.toggle('active', method === 'wompi');
  document.getElementById('pmContraEntrega').classList.toggle('active', method === 'contraentrega');
  document.getElementById('infoWompi').style.display         = method === 'wompi' ? '' : 'none';
  document.getElementById('infoContraEntrega').style.display = method === 'contraentrega' ? '' : 'none';
  const btn = document.getElementById('btnPagar');
  if (method === 'contraentrega') {
    btn.innerHTML = '<i class="fas fa-truck"></i> Confirmar y pagar envío';
    const total = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    document.getElementById('ceEnvioVal').textContent    = formatCOP(COSTO_ENVIO);
    document.getElementById('ceProductoVal').textContent = formatCOP(total);
  } else {
    btn.innerHTML = '<i class="fas fa-lock"></i> Pagar ahora';
  }
}

function goStep(n) {
  [1, 2, 3].forEach(s => {
    document.getElementById(`checkoutStep${s}`).style.display = s === n ? 'block' : 'none';
    const ind = document.getElementById(`step${s}-indicator`);
    ind.classList.remove('active', 'done');
    if (s === n) ind.classList.add('active');
    else if (s < n) ind.classList.add('done');
  });
  document.getElementById('checkoutSuccess').style.display = 'none';
  currentStep = n;
  // Reset método de pago al entrar al step 3
  if (n === 3) selectPaymentMethod('wompi');
}

function renderOrderSummary() {
  const summary = document.getElementById('orderSummary');
  if (!summary) return;
  const items = cart.map(i => `
    <div class="order-summary-item"><span>${i.name} × ${i.qty}</span><span>${formatCOP(i.price * i.qty)}</span></div>
  `).join('');
  const total = cart.reduce((s, i) => s + (i.price * i.qty), 0);
  const esCE  = selectedPaymentMethod === 'contraentrega';
  summary.innerHTML = `
    ${items}
    <div class="order-summary-item"><span>Envío</span><span style="color:${esCE ? 'var(--accent)' : 'var(--green)'}">${esCE ? formatCOP(COSTO_ENVIO) : 'GRATIS'}</span></div>
    <div class="order-summary-item"><span>${esCE ? 'Total (envío + producto)' : 'Total'}</span><span style="color:var(--accent2)">${formatCOP(esCE ? total + COSTO_ENVIO : total)}</span></div>
  `;
}

async function processPayment() {
  const payBtn = document.getElementById('btnPagar');

  const buyer = {
    name:  document.getElementById('co-name')?.value  || '',
    email: document.getElementById('co-email')?.value || '',
    phone: document.getElementById('co-phone')?.value || ''
  };

  if (!buyer.email || !buyer.email.includes('@')) {
    showToast('Por favor regresa y completa tu correo electrónico', 'error');
    return;
  }

  // ── FLUJO CONTRA ENTREGA ──────────────────────────────────────────────────
  if (selectedPaymentMethod === 'contraentrega') {
    await processContraEntrega(payBtn, buyer);
    return;
  }

  payBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparando pago...';
  payBtn.disabled = true;

  try {
    // Obtener firma del servidor
    const response = await fetch(`${SERVER_URL}/crear-transaccion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: cart, buyer })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    // Guardar pedido pendiente por si Wompi redirige (PSE/Bancolombia/Nequi)
    const address = {
      street: document.getElementById('co-address')?.value || '',
      city:   document.getElementById('co-city')?.value    || '',
      dept:   document.getElementById('co-dept')?.value    || ''
    };
    guardarPedidoPendiente(buyer, address, [...cart], data.reference);

    // Abrir widget de Wompi con firma de integridad
    const checkout = new WidgetCheckout({
      currency:        data.currency,
      amountInCents:   data.amountInCents,
      reference:       data.reference,
      publicKey:       data.publicKey,
      signature:       { integrity: data.signature },
      redirectUrl:     'https://tecnosmartstore.com/',
      customerData: {
        email:             buyer.email,
        fullName:          buyer.name,
        phoneNumber:       buyer.phone || '3000000000',
        phoneNumberPrefix: '+57',
        legalId:           '1000000000',
        legalIdType:       'CC'
      }
    });

    payBtn.innerHTML = '<i class="fas fa-lock"></i> Pagar ahora';
    payBtn.disabled = false;

    // Liberar scroll del body para que el widget de Wompi funcione bien
    document.body.style.overflow = '';

    checkout.open(async (result) => {
      const { transaction } = result;
      console.log('Wompi:', transaction);
      if (transaction?.status === 'APPROVED') {
        // Limpiar pedido pendiente — ya lo procesamos aquí
        localStorage.removeItem('wompPedidoPendiente');

        // Capturar datos de envío en el momento del pago
        const address = {
          street: document.getElementById('co-address')?.value || '',
          city:   document.getElementById('co-city')?.value    || '',
          dept:   document.getElementById('co-dept')?.value    || ''
        };

        const total = cart.reduce((s, i) => s + (i.price * i.qty), 0);
        const cartSnapshot = [...cart];

        // 1. Guardar pedido en Firestore
        try {
          await fetch(`${SERVER_URL}/guardar-pedido`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              buyer,
              address,
              items:         cartSnapshot,
              reference:     data.reference,
              transactionId: transaction.id || '',
              total
            })
          });
          console.log('✅ Pedido guardado en Firestore');
        } catch (err) {
          console.error('❌ Error guardando pedido:', err);
        }

        // Guardar dirección del cliente para próximas compras
        if (window.currentUser && address.street) {
          window.guardarDireccion(address)
            .then(() => console.log('✅ Dirección guardada'))
            .catch(err => console.error('❌ Error guardando dirección:', err));
        }

        // 2. Enviar email de notificación al dueño de la tienda
        enviarEmailPedido(buyer, address, cartSnapshot, data.reference)
          .then(() => console.log('✅ Email al dueño enviado'))
          .catch(err => console.error('❌ Error email dueño:', err));

        // 3. Enviar email de confirmación al cliente
        enviarEmailCliente(buyer, address, cartSnapshot, data.reference)
          .then(() => console.log('✅ Email de confirmación al cliente enviado'))
          .catch(err => console.error('❌ Error email cliente:', err));

        // 3. Mostrar pantalla de éxito
        [1, 2, 3].forEach(s => {
          document.getElementById(`checkoutStep${s}`).style.display = 'none';
          document.getElementById(`step${s}-indicator`).classList.add('done');
        });
        document.getElementById('checkoutSuccess').style.display = 'block';
        clearCart();
      } else if (transaction?.status === 'DECLINED') {
        showToast('❌ Pago rechazado. Intenta con otra tarjeta.', 'error');
      } else {
        showToast('⚠️ Pago cancelado.', 'error');
      }
    });

  } catch (err) {
    console.error(err);
    showToast(`Error: ${err.message}`, 'error');
    payBtn.innerHTML = '<i class="fas fa-lock"></i> Pagar ahora';
    payBtn.disabled = false;
  }
}

// ===== RATING WIDGET =====
let _selectedStar = {}; // { prodId: número }

function hoverStar(prodId, val) {
  _selectedStar[prodId] = val;
  const picker = document.getElementById(`picker-${prodId}`);
  if (!picker) return;
  picker.querySelectorAll('button').forEach((btn, i) => {
    btn.classList.toggle('active', i < val);
  });
  const btnRate = document.getElementById(`btnRate-${prodId}`);
  if (btnRate) btnRate.disabled = false;
}

function resetStarHover(prodId) {
  // Mantener la selección activa, no resetear al salir
}

async function enviarCalificacion(prodId, prodDocId) {
  const estrellas = _selectedStar[prodId];
  if (!estrellas) return;

  const btn = document.getElementById(`btnRate-${prodId}`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...'; }

  const resultado = await window.guardarCalificacionCliente(prodDocId, estrellas);

  const widget = document.getElementById(`ratingWidget-${prodId}`);
  if (!widget) return;

  if (resultado === 'ok') {
    widget.innerHTML = '<p style="color:#22c55e;font-size:14px;font-weight:700;text-align:center"><i class="fas fa-check-circle"></i> ¡Gracias por tu calificación!</p>';
    // onSnapshot actualiza automáticamente las estrellas en tarjeta y modal
  } else if (resultado === 'ya_voto') {
    widget.innerHTML = '<p style="color:var(--text2);font-size:13px;text-align:center"><i class="fas fa-info-circle"></i> Ya calificaste este producto hoy. ¡Gracias!</p>';
  } else {
    widget.innerHTML = '<p style="color:var(--red);font-size:13px;text-align:center"><i class="fas fa-exclamation-circle"></i> Error al enviar. Intenta de nuevo.</p>';
  }
}

// ===== CONTRA ENTREGA =====
async function processContraEntrega(payBtn, buyer) {
  payBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparando pago del envío...';
  payBtn.disabled = true;

  const address = {
    street: document.getElementById('co-address')?.value || '',
    city:   document.getElementById('co-city')?.value    || '',
    dept:   document.getElementById('co-dept')?.value    || ''
  };

  const total        = cart.reduce((s, i) => s + (i.price * i.qty), 0);
  const cartSnapshot = [...cart];

  try {
    // Cobrar solo el envío por Wompi
    const response = await fetch(`${SERVER_URL}/crear-transaccion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ price: COSTO_ENVIO, qty: 1, name: 'Costo de envío' }], buyer })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);

    // Guardar pedido CE pendiente antes de abrir widget
    const referencia = data.reference;
    const pedidoCE = {
      buyer, address,
      cartItems:      cartSnapshot,
      reference:      referencia,
      esContraEntrega: true,
      valorEnvio:     COSTO_ENVIO,
      valorProducto:  total,
      ts: Date.now()
    };
    localStorage.setItem('wompPedidoPendiente', JSON.stringify(pedidoCE));

    const checkout = new WidgetCheckout({
      currency:      data.currency,
      amountInCents: data.amountInCents,
      reference:     referencia,
      publicKey:     data.publicKey,
      signature:     { integrity: data.signature },
      redirectUrl:   'https://tecnosmartstore.com/',
      customerData: {
        email:             buyer.email,
        fullName:          buyer.name,
        phoneNumber:       buyer.phone || '3000000000',
        phoneNumberPrefix: '+57',
        legalId:           '1000000000',
        legalIdType:       'CC'
      }
    });

    payBtn.innerHTML = '<i class="fas fa-truck"></i> Confirmar y pagar envío';
    payBtn.disabled = false;
    document.body.style.overflow = '';

    checkout.open(async (result) => {
      const { transaction } = result;
      if (transaction?.status === 'APPROVED') {
        localStorage.removeItem('wompPedidoPendiente');
        await completarPedidoCE({ buyer, address, cartSnapshot, referencia, transactionId: transaction.id || '', total });
      } else if (transaction?.status === 'DECLINED') {
        showToast('❌ Pago rechazado. Intenta de nuevo.', 'error');
      } else {
        showToast('⚠️ Pago cancelado.', 'error');
      }
    });

  } catch (err) {
    console.error(err);
    showToast(`Error: ${err.message}`, 'error');
    payBtn.innerHTML = '<i class="fas fa-truck"></i> Confirmar y pagar envío';
    payBtn.disabled = false;
  }
}

async function completarPedidoCE({ buyer, address, cartSnapshot, referencia, transactionId, total }) {
  try {
    await fetch(`${SERVER_URL}/guardar-pedido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buyer, address, items: cartSnapshot,
        reference:       referencia,
        transactionId,
        total:           total + COSTO_ENVIO,
        valorProducto:   total,
        valorEnvio:      COSTO_ENVIO,
        esContraEntrega: true,
        estadoRecaudo:   'Pendiente',
        estado:          'Contra entrega - Envío pagado'
      })
    });
  } catch (err) { console.error('❌ Error guardando pedido CE:', err); }

  enviarEmailPedido(buyer, address, cartSnapshot, referencia)
    .catch(err => console.error('❌ Email dueño:', err));
  enviarEmailCliente(buyer, address, cartSnapshot, referencia)
    .catch(err => console.error('❌ Email cliente:', err));

  [1, 2, 3].forEach(s => {
    document.getElementById(`checkoutStep${s}`).style.display = 'none';
    document.getElementById(`step${s}-indicator`).classList.add('done');
  });
  document.getElementById('checkoutSuccess').style.display = 'block';
  clearCart();
}

// ===== CARD SLIDESHOW =====
function initCardSlideshows() {
  [1, 2, 3, 4].forEach(id => {
    const wrap = document.getElementById(`slide-${id}`);
    if (!wrap) return;
    const imgs = wrap.querySelectorAll('img');
    const dotsEl = document.getElementById(`dots-${id}`);
    if (imgs.length <= 1) return;

    // Crear dots
    imgs.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.className = 'slide-dot' + (i === 0 ? ' active' : '');
      dot.onclick = (e) => { e.stopPropagation(); goSlide(id, i); };
      dotsEl?.appendChild(dot);
    });

    let current = 0;
    const intervals = {};
    intervals[id] = setInterval(() => {
      current = (current + 1) % imgs.length;
      goSlide(id, current);
    }, 2800 + id * 400); // offset para que no cambien todas al mismo tiempo
  });
}

function goSlide(cardId, idx) {
  const wrap = document.getElementById(`slide-${cardId}`);
  if (!wrap) return;
  const imgs = wrap.querySelectorAll('img');
  const dots = wrap.querySelectorAll('.slide-dot');
  imgs.forEach((img, i) => {
    img.style.opacity = i === idx ? '1' : '0';
    img.classList.toggle('active-slide', i === idx);
  });
  dots.forEach((d, i) => d.classList.toggle('active', i === idx));
}

document.addEventListener('DOMContentLoaded', () => {
  initCardSlideshows();
});
function toggleWaMenu() {
  const menu = document.getElementById('waMenu');
  menu.classList.toggle('open');
}

// Cerrar menú WA al hacer clic fuera
document.addEventListener('click', (e) => {
  const float = document.getElementById('waFloat');
  if (float && !float.contains(e.target)) {
    document.getElementById('waMenu')?.classList.remove('open');
  }
});


let toastTimer;
function showToast(msg, type = 'default') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ===== CONTACT FORM =====
function sendContact(e) {
  e.preventDefault();
  const form    = e.target;
  const nombre  = form.querySelector('input[type="text"]').value.trim();
  const email   = form.querySelector('input[type="email"]').value.trim();
  const telefono= form.querySelector('input[type="tel"]')?.value.trim() || '—';
  const tema    = form.querySelector('.cf-select')?.value || '—';
  const mensaje = form.querySelector('textarea').value.trim();
  const btn     = form.querySelector('button[type="submit"]');

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';

  const temaTexto = {
    pedido:   'Consulta sobre un pedido',
    producto: 'Información de producto',
    garantia: 'Garantía / devolución',
    envio:    'Tiempos de envío',
    otro:     'Otro'
  }[tema] || tema;

  emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_PEDIDO, {
    asunto:          `📩 ${temaTexto} — ${nombre}`,
    cliente_nombre:  nombre,
    cliente_email:   email,
    cliente_telefono: telefono,
    direccion:       temaTexto,
    ciudad:          '—',
    departamento:    '—',
    productos:       mensaje,
    total:           '— Formulario de contacto —',
    fecha:           new Date().toLocaleString('es-CO')
  })
  .then(() => {
    showToast('✅ Mensaje enviado. ¡Te responderemos pronto!', 'success');
    form.reset();
  })
  .catch(err => {
    console.error('Error contacto:', err);
    showToast('❌ Error al enviar. Intenta de nuevo.', 'error');
  })
  .finally(() => {
    btn.disabled = false;
    btn.innerHTML = 'Enviar mensaje <i class="fas fa-paper-plane"></i>';
  });
}

// ===== SCROLL ANIMATIONS =====
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, observerOptions);

// Add animation classes to elements
document.addEventListener('DOMContentLoaded', () => {
  // Animate cards on scroll
  const animEls = document.querySelectorAll('.product-card, .feature-card, .review-card, .trust-item');
  animEls.forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px)';
    el.style.transition = `opacity 0.6s ease ${i * 0.1}s, transform 0.6s ease ${i * 0.1}s`;
    observer.observe(el);
  });

  // Init cart from storage
  saveCart();
  renderCart();

  // Add visible class handler
  const style = document.createElement('style');
  style.textContent = `.visible { opacity: 1 !important; transform: translateY(0) !important; }
  @keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }`;
  document.head.appendChild(style);

  // ---- AUTH init ----
  updateNavForUser();

  // Update nav login button behaviour
  document.querySelector('.nav-btn-login')?.addEventListener('click', () => {
    if (currentUser) {
      document.getElementById('profileGreeting').textContent = `¡Hola, ${currentUser.name}!`;
      document.getElementById('profileEmail').textContent = currentUser.email;
      document.getElementById('profileInfo').innerHTML = `
        <div class="profile-row"><i class="fas fa-phone"></i> ${currentUser.phone || 'Sin teléfono'}</div>
        <div class="profile-row"><i class="fas fa-calendar"></i> Miembro activo</div>
      `;
    }
  });
});

// ===== KEYBOARD CLOSE =====
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    closeCheckout();
    if (document.getElementById('cartSidebar').classList.contains('open')) toggleCart();
  }
});

// ===== SMOOTH NAV HIGHLIGHT =====
const sections = document.querySelectorAll('section[id]');
window.addEventListener('scroll', () => {
  let current = '';
  sections.forEach(s => {
    if (window.scrollY >= s.offsetTop - 120) current = s.id;
  });
  document.querySelectorAll('.nav-links a').forEach(a => {
    a.style.color = a.getAttribute('href') === `#${current}` ? 'var(--accent2)' : '';
  });
});

const SERVER_URL = '/.netlify/functions';

// ===== AUTH SYSTEM =====
// currentUser es manejado por Firebase (ver script en index.html)
// window.currentUser se actualiza via onAuthStateChanged

function openAuthModal(tab = 'login') {
  if (window.currentUser) {
    switchAuth('profile');
    // Poblar datos del perfil
    document.getElementById('profileGreeting').textContent = `¡Hola, ${window.currentUser.name}!`;
    document.getElementById('profileEmail').textContent = window.currentUser.email;
    const addr = window.currentUser.address || {};
    document.getElementById('profileInfo').innerHTML = `
      <div class="profile-row"><i class="fas fa-phone"></i> ${window.currentUser.phone || 'Sin teléfono'}</div>
      <div class="profile-row"><i class="fas fa-map-marker-alt"></i> ${addr.street ? `${addr.street}, ${addr.city}` : 'Sin dirección guardada'}</div>
      <div class="profile-row"><i class="fas fa-calendar"></i> Miembro activo</div>
    `;
  } else {
    switchAuth(tab);
  }
  document.getElementById('authOverlay').classList.add('active');
  document.getElementById('authModal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeAuthModal() {
  document.getElementById('authOverlay').classList.remove('active');
  document.getElementById('authModal').classList.remove('active');
  document.body.style.overflow = '';
}

function switchAuth(panel) {
  ['authLogin', 'authRegister', 'authProfile'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById(`auth${panel.charAt(0).toUpperCase() + panel.slice(1)}`).style.display = 'block';
}

async function registerUser(e) {
  e.preventDefault();
  const name     = document.getElementById('regName').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const phone    = document.getElementById('regPhone').value.trim();
  const password = document.getElementById('regPassword').value;
  const btn      = e.target.querySelector('button[type="submit"]');

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando cuenta...';

  try {
    await window.firebaseRegister(name, email, phone, password);
    showToast(`✅ ¡Bienvenido, ${name}! Cuenta creada.`, 'success');
    closeAuthModal();
  } catch (err) {
    const msg = err.code === 'auth/email-already-in-use'
      ? 'Ya existe una cuenta con ese email'
      : err.code === 'auth/weak-password'
      ? 'La contraseña debe tener al menos 6 caracteres'
      : err.message;
    showToast(`❌ ${msg}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Crear cuenta';
  }
}

async function loginUser(e) {
  e.preventDefault();
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn      = e.target.querySelector('button[type="submit"]');

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ingresando...';

  try {
    await window.firebaseLogin(email, password);
    showToast(`✅ ¡Bienvenido de nuevo!`, 'success');
    closeAuthModal();
  } catch (err) {
    showToast('❌ Email o contraseña incorrectos', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Ingresar';
  }
}

async function logoutUser() {
  await window.firebaseLogout();
  showToast('Sesión cerrada', 'default');
  closeAuthModal();
}

function updateNavForUser() {
  const loginBtn    = document.querySelector('.nav-btn-login');
  const registerBtn = document.querySelector('.nav-btn-register');
  if (!loginBtn || !registerBtn) return;

  if (window.currentUser) {
    loginBtn.innerHTML        = `<i class="fas fa-user-circle"></i> ${window.currentUser.name.split(' ')[0]}`;
    registerBtn.style.display = 'none';
  } else {
    loginBtn.innerHTML        = '<i class="fas fa-user"></i> Ingresar';
    registerBtn.style.display = '';
  }
}


