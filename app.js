// ===== STATE =====
let cart = JSON.parse(localStorage.getItem('tsCart') || '[]');
let currentPayMethod = 'card';

// ===== WOMPI CONFIG =====
const WOMPI_PUBLIC_KEY = 'pub_test_TGKHUGlVCnz9SKz2BcUr1GpBKJxFEUoM';
const SERVER_URL = '/.netlify/functions';

// ===== PRODUCT DATA =====
// Formato pesos colombianos
function formatCOP(value) {
  return '$' + value.toLocaleString('es-CO');
}

const products = {
  1: {
    id: 1, name: 'AirPods Pro 3', price: 100,
    img: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/airpods-pro-2-hero-select-202209?wid=600&hei=528&fmt=jpeg&qlt=90',
    fallback: 'https://images.unsplash.com/photo-1600294037547-5cb5c1d0edd0?w=400&q=80',
    desc: 'Los AirPods Pro 3 son los auriculares más avanzados de Apple. Con 2× mejor cancelación de ruido activa, chip H3, sensor de frecuencia cardíaca integrado y hasta 36 horas de batería con el estuche MagSafe.',
    specs: { 'Chip': 'H3', 'ANC': 'Ultra (2×)', 'Batería': '6h + 30h estuche', 'Bluetooth': '5.3', 'Resistencia': 'IPX4', 'Carga': 'MagSafe / Lightning / USB-C' }
  },
  2: {
    id: 2, name: 'AirPods Pro 2', price: 100,
    img: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/airpods-pro-2-hero-select-202209?wid=600&hei=528&fmt=jpeg&qlt=90',
    fallback: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=400&q=80',
    desc: 'Los AirPods Pro 2 con chip H2 ofrecen cancelación activa de ruido mejorada, modo de sonido ambiente y audio espacial personalizado. El estuche incluye altavoz integrado y correa.',
    specs: { 'Chip': 'H2', 'ANC': 'Activa', 'Batería': '6h + 24h estuche', 'Bluetooth': '5.3', 'Resistencia': 'IPX4', 'Carga': 'MagSafe / Lightning' }
  },
  3: {
    id: 3, name: 'AirPods Series 3', price: 100,
    img: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/airpods-3rd-gen-hero-select-202110?wid=600&hei=528&fmt=jpeg&qlt=90',
    fallback: 'https://images.unsplash.com/photo-1631176093617-43abc0cbcb09?w=400&q=80',
    desc: 'Los AirPods de 3ra generación con audio espacial dinámico, EQ adaptativo y resistencia al sudor IPX4. Diseño remodelado con tallo más corto, inspirado en los Pro.',
    specs: { 'Chip': 'H1', 'ANC': 'No', 'Batería': '6h + 24h estuche', 'Bluetooth': '5.0', 'Resistencia': 'IPX4', 'Carga': 'MagSafe / Lightning' }
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
  const footer = document.getElementById('cartFooter');
  if (cart.length === 0) {
    container.innerHTML = '<div class="cart-empty"><i class="fas fa-bag-shopping"></i><p>Tu carrito está vacío</p></div>';
    footer.style.display = 'none';
    return;
  }
  footer.style.display = 'block';
  container.innerHTML = cart.map(item => `
    <div class="cart-item">
      <img src="${item.img}" alt="${item.name}" onerror="this.src='https://images.unsplash.com/photo-1600294037547-5cb5c1d0edd0?w=80&q=80'" />
      <div class="cart-item-info">
        <h4>${item.name}</h4>
        <p>${formatCOP(item.price)}</p>
        <div class="cart-item-qty">
          <button class="qty-btn" onclick="changeQty(${item.id}, -1)">−</button>
          <span class="qty-num">${item.qty}</span>
          <button class="qty-btn" onclick="changeQty(${item.id}, 1)">+</button>
        </div>
      </div>
      <button class="remove-item" onclick="removeItem(${item.id})"><i class="fas fa-trash-alt"></i></button>
    </div>
  `).join('');
  const total = cart.reduce((s, i) => s + (i.price * i.qty), 0);
  document.getElementById('cartTotal').textContent = formatCOP(total);
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
  cart = cart.filter(i => i.id !== id);
  saveCart();
  renderCart();
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
function openModal(id) {
  const p = products[id];
  if (!p) return;
  const specsHTML = Object.entries(p.specs).map(([k, v]) => `
    <div class="modal-spec"><label>${k}</label><span>${v}</span></div>
  `).join('');
  document.getElementById('modalContent').innerHTML = `
    <img class="modal-img" src="${p.img}" alt="${p.name}" onerror="this.src='${p.fallback}'" />
    <h2>${p.name}</h2>
    <div class="price">${formatCOP(p.price)}</div>
    <p class="desc">${p.desc}</p>
    <div class="modal-specs-list">${specsHTML}</div>
    <button class="btn-primary full-width" onclick="addToCart(${p.id},'${p.name}',${p.price},'${p.fallback}'); closeModal();">
      <i class="fas fa-bag-shopping"></i> Agregar al carrito
    </button>
  `;
  document.getElementById('modalOverlay').classList.add('active');
  document.getElementById('productModal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  document.getElementById('productModal').classList.remove('active');
  document.body.style.overflow = '';
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
  }, 400);
}

function closeCheckout() {
  document.getElementById('checkoutOverlay').classList.remove('active');
  document.getElementById('checkoutModal').classList.remove('active');
  document.body.style.overflow = '';
  currentStep = 1;
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
}

function selectPay(method) {
  currentPayMethod = method;
  document.querySelectorAll('.pay-option').forEach(el => el.classList.remove('active'));
  document.getElementById(`pay-${method}`).classList.add('active');
  document.getElementById('card-form').style.display = method === 'card' ? 'block' : 'none';
}

function renderOrderSummary() {
  const summary = document.getElementById('orderSummary');
  if (!summary) return;
  const items = cart.map(i => `
    <div class="order-summary-item"><span>${i.name} × ${i.qty}</span><span>${formatCOP(i.price * i.qty)}</span></div>
  `).join('');
  const total = cart.reduce((s, i) => s + (i.price * i.qty), 0);
  summary.innerHTML = `
    ${items}
    <div class="order-summary-item"><span>Envío</span><span style="color: var(--green)">GRATIS</span></div>
    <div class="order-summary-item"><span>Total</span><span style="color: var(--accent2)">${formatCOP(total)}</span></div>
  `;
}

async function processPayment() {
  const payBtn = document.querySelector('#checkoutStep3 .btn-primary:last-child');

  const buyer = {
    name:  document.getElementById('co-name')?.value  || '',
    email: document.getElementById('co-email')?.value || '',
    phone: document.getElementById('co-phone')?.value || ''
  };

  if (!buyer.email || !buyer.email.includes('@')) {
    showToast('Por favor regresa y completa tu correo electrónico', 'error');
    return;
  }

  payBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Conectando con Wompi...';
  payBtn.disabled = true;

  try {
    const response = await fetch(`${SERVER_URL}/crear-transaccion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: cart, buyer })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    // Abrir widget de Wompi
    const checkout = new WidgetCheckout({
      currency:        'COP',
      amountInCents:   data.amountInCents,
      reference:       data.reference,
      publicKey:       WOMPI_PUBLIC_KEY,
      redirectUrl:     window.location.href,
      customerData: {
        email:       buyer.email,
        fullName:    buyer.name,
        phoneNumber: buyer.phone || '',
        phoneNumberPrefix: '+57'
      }
    });

    payBtn.innerHTML = '<i class="fas fa-lock"></i> Pagar ahora';
    payBtn.disabled = false;

    checkout.open((result) => {
      const { transaction } = result;
      if (transaction && transaction.status === 'APPROVED') {
        [1, 2, 3].forEach(s => {
          document.getElementById(`checkoutStep${s}`).style.display = 'none';
          const ind = document.getElementById(`step${s}-indicator`);
          ind.classList.remove('active');
          ind.classList.add('done');
        });
        document.getElementById('checkoutSuccess').style.display = 'block';
        clearCart();
      } else if (transaction && transaction.status === 'DECLINED') {
        showToast('❌ Pago rechazado. Intenta con otra tarjeta.', 'error');
      } else {
        showToast('⚠️ Pago pendiente o cancelado.', 'error');
      }
    });

  } catch (err) {
    console.error(err);
    showToast(`Error: ${err.message}`, 'error');
    payBtn.innerHTML = '<i class="fas fa-lock"></i> Pagar ahora';
    payBtn.disabled = false;
  }
}

function shakeInput(el) {
  el.style.borderColor = 'var(--red)';
  el.style.animation = 'shake 0.4s ease';
  setTimeout(() => {
    el.style.borderColor = '';
    el.style.animation = '';
  }, 800);
}

// ===== CARD FORMATTING =====
function formatCard(input) {
  let v = input.value.replace(/\D/g, '').substring(0, 16);
  input.value = v.replace(/(.{4})/g, '$1 ').trim();
  // Detect card brand
  const brands = document.querySelectorAll('.card-brands i');
  if (!brands.length) return;
  brands.forEach(b => b.style.color = 'var(--text3)');
  if (/^4/.test(v)) brands[0].style.color = '#1a1f71';
  else if (/^5[1-5]/.test(v) || /^2[2-7]/.test(v)) brands[1].style.color = '#eb001b';
  else if (/^3[47]/.test(v)) brands[2].style.color = '#007bc1';
  else if (/^6/.test(v)) brands[3].style.color = '#e65c00';
}

function formatExpiry(input) {
  let v = input.value.replace(/\D/g, '').substring(0, 4);
  if (v.length >= 3) v = v.substring(0,2) + '/' + v.substring(2);
  input.value = v;
}

// ===== TOAST =====
let toastTimer;
function showToast(msg, type = 'default') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ===== NEWSLETTER =====
function subscribeNewsletter(e) {
  e.preventDefault();
  const input = e.target.querySelector('input');
  showToast(`✅ ¡${input.value} suscrito! Revisa tu correo.`, 'success');
  input.value = '';
}

// ===== CONTACT FORM =====
function sendContact(e) {
  e.preventDefault();
  showToast('✅ Mensaje enviado. Te responderemos pronto!', 'success');
  e.target.reset();
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
