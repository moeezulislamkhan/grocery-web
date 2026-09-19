// public/js/app.js — ShakarGanj storefront logic

/* ============ SPLASH SEQUENCE ============ */
// The dot's expansion origin is calculated from the live position of the "@"
// glyph — never hard-coded to 50%/50% — so it stays correct on any screen
// size and after any responsive reflow.
const splash = document.getElementById('splash');
const splashDot = document.getElementById('splashDot');
const atSymbol = document.getElementById('atSymbol');
let splashDone = false;
let splashExpanded = false;

function positionDotOnAt() {
  if (!atSymbol || !splashDot || splashExpanded) return;
  const rect = atSymbol.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  splashDot.style.left = cx + 'px';
  splashDot.style.top = cy + 'px';

  // Radius needed for the scaled dot to cover the farthest corner of the
  // viewport from this exact point, so the circle always fully fills the
  // screen regardless of where the "@" sits or how the screen is shaped.
  const w = window.innerWidth, h = window.innerHeight;
  const corners = [[0, 0], [w, 0], [0, h], [w, h]];
  let maxDist = 0;
  for (const [x, y] of corners) {
    const d = Math.hypot(x - cx, y - cy);
    if (d > maxDist) maxDist = d;
  }
  const neededRadius = maxDist + 24; // small buffer so no edge pixel is left uncovered
  const dotRadius = splashDot.offsetWidth / 2;
  splash.style.setProperty('--dot-scale', neededRadius / dotRadius);
}

function runSplash() {
  positionDotOnAt();
  window.addEventListener('resize', positionDotOnAt);

  // Stage 1 — "@Shakarganj" wordmark holds for 1.2s
  setTimeout(() => {
    if (splashDone) return;
    positionDotOnAt(); // final recompute right before the trigger, in case of late layout shifts
    splashExpanded = true;
    splash.classList.add('expanding');

    // Stage 2 — dot expands outward from the "@" center (2.3s, matches CSS transition)
    // Total splash duration: 1.2s + 2.3s = 3.5s.
    splashDot.addEventListener('transitionend', function onDone(e) {
      if (e.propertyName !== 'transform' || splashDone) return;
      splashDot.removeEventListener('transitionend', onDone);
      // Stage 3 — the instant the circle fully covers the screen, swap in the
      // solid fill (same color) and reveal the next screen on top of it.
      splash.classList.add('filled');
      requestAnimationFrame(() => splash.classList.add('show-logo'));
    });
  }, 1200);
}

// Wait for web fonts to finish loading before measuring/positioning the dot —
// prevents any late font-swap layout shift from moving the "@" after we've
// already anchored the animation origin to it.
//
// The splash is only ever meant to be a "first entry into the site" moment —
// sessionStorage (cleared when the tab/browser closes, but kept across page
// navigations and Back/Forward within the same tab) is exactly the right
// tool to remember "already saw the intro this session" without needing any
// bigger routing/state rework.
const INTRO_SEEN_KEY = 'sg_intro_seen';
if (sessionStorage.getItem(INTRO_SEEN_KEY)) {
  splashDone = true;
  splash.style.display = 'none';
  document.getElementById('app').classList.add('ready');
} else if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(runSplash).catch(runSplash);
} else {
  runSplash();
}
function enterSite() {
  if (splashDone) return;
  splashDone = true;
  sessionStorage.setItem(INTRO_SEEN_KEY, '1');
  splash.style.transition = 'opacity .5s ease';
  splash.style.opacity = '0';
  setTimeout(() => { splash.style.display = 'none'; document.getElementById('app').classList.add('ready'); }, 500);
}

/* ============ PRODUCT CATALOG (from API) ============ */
const CATEGORY_ICONS = {
  'Fruits & Vegetables': '🥕', 'Dairy & Eggs': '🥛', 'Bakery': '🍞',
  'Rice, Atta & Pulses': '🍚', 'Beverages': '🧃', 'Household': '🧴', 'Meat & Poultry': '🍗',
};
let PRODUCTS = [];
function fmt(n) { return 'Rs. ' + Math.round(n).toLocaleString(); }

async function loadProducts() {
  try {
    const { products } = await API.get('/api/products');
    PRODUCTS = products;
    renderCategories();
    renderProducts();
    // Cart items are stored by product id in localStorage, but rendering
    // them needs each product's name/price/image from PRODUCTS — which
    // wasn't populated yet if the page's initial renderCart() ran before
    // this fetch resolved. Re-render now that PRODUCTS is actually filled,
    // so items added on another page (or in a previous visit) show up
    // immediately instead of the cart badge silently reading as empty.
    renderCart();
    loadCampaignBanner();
  } catch (err) {
    document.getElementById('productGrid').innerHTML = `<p class="empty-note">Could not load products. Is the server running?</p>`;
  }
}

function renderCategories() {
  const cats = [...new Set(PRODUCTS.map(p => p.category))];
  document.getElementById('catGrid').innerHTML = cats.map(c => `
    <a class="cat-card" href="category.html?name=${encodeURIComponent(c)}"><div class="emoji">${CATEGORY_ICONS[c] || '🛒'}</div><div class="lbl">${c}</div></a>
  `).join('');
  // Top nav bar — built from whatever categories actually exist in the
  // database right now, so it's always in sync with the Admin Panel
  // (add/edit/delete a product's category there and this updates itself).
  const navInner = document.getElementById('catNavInner');
  if (navInner) {
    navInner.innerHTML = `<a href="index.html" class="active">All Categories</a>` +
      cats.map(c => `<a href="category.html?name=${encodeURIComponent(c)}">${c}</a>`).join('');
  }
  const footerShop = document.getElementById('footerShopList');
  if (footerShop) {
    footerShop.innerHTML = cats.slice(0, 6).map(c => `<li><a href="category.html?name=${encodeURIComponent(c)}" style="color:inherit;">${c}</a></li>`).join('');
  }
}

function renderProducts() {
  document.getElementById('productGrid').innerHTML = PRODUCTS.slice(0, 8).map(p => `
    <div class="p-card">
      ${p.deal ? '<div class="tag sale">DEAL</div>' : (p.has_sale_price ? '<div class="tag sale">SALE</div>' : (p.tag ? `<div class="tag ${p.tag === 'Sale' ? 'sale' : ''}">${p.tag}</div>` : ''))}
      <div class="img-wrap"><img src="${p.image}" alt="${p.name}"></div>
      <div class="body">
        <div class="cat-lbl">${p.category}</div>
        ${p.tag ? `<div class="product-eyebrow">${p.tag}</div>` : ''}
        <div class="p-title">${p.name}</div>
        <div class="row">
          <div class="price">${p.deal || p.has_sale_price ? `<span class="old">${fmt(p.price)}</span>${fmt(p.effective_price)}` : `${p.old_price ? `<span class="old">${fmt(p.old_price)}</span>` : ''}${fmt(p.price)}`}</div>
          <button class="add-btn" onclick="addToCart(${p.id})" ${p.stock === 0 ? 'disabled style="opacity:.35;cursor:not-allowed;"' : ''}>+</button>
        </div>
      </div>
    </div>
  `).join('');
}

async function loadCampaignBanner() {
  const banner = document.getElementById('campaignBanner');
  if (!banner) return;
  try {
    const { campaigns } = await API.get('/api/deal-campaigns');
    if (!campaigns.length) { banner.style.display = 'none'; return; }
    banner.innerHTML = campaigns.map(campaign => `
      <div class="campaign-banner-item"${campaign.image ? ` style="background-image:linear-gradient(90deg, rgba(98,0,20,.96), rgba(98,0,20,.78)), url('${campaign.image}')"` : ''}>
        <div><div class="eyebrow campaign-banner-badge">${campaign.badge || 'Special Offer'}</div><h3>${campaign.title}</h3><p>${campaign.description}</p></div>
        <a class="btn" href="${campaign.button_url || 'index.html'}">${campaign.button_text || 'Shop Now'}</a>
      </div>`).join('');
  } catch { /* retain the existing banner fallback copy */ }
}

/* ============ CART (persisted in localStorage — a real browser storage use case, not a Claude.ai artifact) ============ */
let CART = JSON.parse(localStorage.getItem('sg_cart') || '{}');
function saveCart() { localStorage.setItem('sg_cart', JSON.stringify(CART)); }

function addToCart(id) {
  CART[id] = (CART[id] || 0) + 1;
  saveCart(); renderCart(); toggleCart(true);
}
function changeQty(id, delta) {
  CART[id] = (CART[id] || 0) + delta;
  if (CART[id] <= 0) delete CART[id];
  saveCart(); renderCart();
}
function removeFromCart(id) { delete CART[id]; saveCart(); renderCart(); }

function cartLines() {
  return Object.entries(CART).map(([id, qty]) => {
    const p = PRODUCTS.find(x => x.id == id);
    return { p, qty };
  }).filter(l => l.p);
}

function renderCart() {
  const lines = cartLines();
  const wrap = document.getElementById('cartItemsWrap');
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const badge = document.getElementById('cartBadge');
  badge.style.display = count > 0 ? 'flex' : 'none';
  badge.textContent = count;

  if (lines.length === 0) {
    wrap.innerHTML = `<div class="cart-empty">Your cart is empty.<br>Add some fresh groceries!</div>`;
    document.getElementById('cartFoot').style.display = 'none';
    return;
  }
  document.getElementById('cartFoot').style.display = 'block';
  wrap.innerHTML = lines.map(l => `
    <div class="cart-item">
      <img src="${l.p.image}" alt="">
      <div class="info">
        <div class="t">${l.p.name}</div>
        <div class="p">${fmt(l.p.effective_price || l.p.price)}</div>
        <div class="qty-ctrl">
          <button onclick="changeQty(${l.p.id},-1)">−</button>
          <span>${l.qty}</span>
          <button onclick="changeQty(${l.p.id},1)">+</button>
        </div>
      </div>
      <div class="remove-x" onclick="removeFromCart(${l.p.id})">✕</div>
    </div>
  `).join('');

  const subtotal = lines.reduce((s, l) => s + (l.p.effective_price || l.p.price) * l.qty, 0);
  const delivery = subtotal > 2000 ? 0 : 150;
  document.getElementById('cartSubtotal').textContent = fmt(subtotal);
  document.getElementById('cartDelivery').textContent = delivery === 0 ? 'Free' : fmt(delivery);
  document.getElementById('cartTotal').textContent = fmt(subtotal + delivery);
}

function toggleCart(open) {
  document.getElementById('cartDrawer').classList.toggle('open', open);
  document.getElementById('overlay').classList.toggle('open', open);
}

/* ============ CHECKOUT ============ */
let selectedPay = 'jazzcash';
const PAY_LABELS = { jazzcash: 'JazzCash', bank: 'Bank Transfer', cod: 'Cash on Delivery' };
function selectPay(p) {
  selectedPay = p;
  document.querySelectorAll('.pay-opt').forEach(el => el.classList.toggle('selected', el.dataset.pay === p));
  const btn = document.getElementById('placeOrderBtn');
  btn.textContent = p === 'cod' ? 'Place Order — Cash on Delivery' : `Place Order — Pay via ${PAY_LABELS[p]}`;
  document.getElementById('payNote').textContent = p === 'cod'
    ? '🚪 Your order is confirmed instantly — pay cash when it arrives at your door.'
    : p === 'bank'
      ? '🏦 Your order is confirmed once we verify your bank transfer.'
      : '🔒 You\u2019ll be redirected to JazzCash\u2019s secure checkout page to complete payment.';
}

function openCheckout() {
  const lines = cartLines();
  if (lines.length === 0) return;
  document.getElementById('checkoutItemsList').innerHTML = lines.map(l => `
    <div class="totals-row"><span>${l.qty} × ${l.p.name}</span><span>${fmt((l.p.effective_price || l.p.price) * l.qty)}</span></div>
  `).join('');
  const subtotal = lines.reduce((s, l) => s + (l.p.effective_price || l.p.price) * l.qty, 0);
  const delivery = subtotal > 2000 ? 0 : 150;
  document.getElementById('coSubtotal').textContent = fmt(subtotal);
  document.getElementById('coDelivery').textContent = delivery === 0 ? 'Free' : fmt(delivery);
  document.getElementById('coTotal').textContent = fmt(subtotal + delivery);
  document.getElementById('checkoutModal').classList.add('open');
  document.getElementById('overlay').classList.add('open');
  selectPay(selectedPay);
}
function closeCheckout() {
  document.getElementById('checkoutModal').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}

// Builds a real HTML form from JazzCash's pp_* fields and submits it with
// method="post" — exactly how JazzCash's Hosted Checkout Page integration
// works. The browser navigates away to actionUrl (JazzCash's real servers
// once live credentials are configured, or our own sandbox simulation page
// until then) carrying the same fields either way.
function submitJazzCashForm(actionUrl, fields) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = actionUrl;
  Object.entries(fields).forEach(([key, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = value;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}

async function placeOrder() {
  const name = document.getElementById('coName').value.trim();
  const phone = document.getElementById('coPhone').value.trim();
  const address = document.getElementById('coAddress').value.trim();
  const city = document.getElementById('coCity').value;
  const slot = document.getElementById('coSlot').value;

  if (!name || !phone || !address) {
    alert('Please fill in your name, phone and delivery address.');
    return;
  }
  const lines = cartLines();
  if (lines.length === 0) return;

  const btn = document.getElementById('placeOrderBtn');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Placing order…';

  try {
    const res = await API.post('/api/orders', {
      customerName: name, phone, address, city, deliverySlot: slot,
      items: lines.map(l => ({ productId: l.p.id, qty: l.qty })),
      paymentMethod: selectedPay,
    });

    if (res.jazzcash) {
      // Cart is about to be paid for — clear it locally before leaving the
      // page, then hand off to JazzCash's Hosted Checkout Page.
      CART = {}; saveCart();
      submitJazzCashForm(res.jazzcash.actionUrl, res.jazzcash.fields);
      return;
    }

    // COD or Bank Transfer — order is already recorded, show confirmation inline
    CART = {}; saveCart(); renderCart();
    closeCheckout(); toggleCart(false);
    const msg = res.paymentMethod === 'cod'
      ? `Order ${res.orderCode} confirmed! Pay cash when it arrives.`
      : `Order ${res.orderCode} created. Transfer to ${res.bankInstructions.bank} — ${res.bankInstructions.iban} (${res.bankInstructions.accountTitle}), and we'll confirm once received.`;
    alert(msg);
  } catch (err) {
    alert(err.message || 'Could not place your order — please try again.');
  } finally {
    btn.disabled = false; btn.textContent = originalText;
  }
}

/* ============ ACCOUNT LINK (header) ============ */
// Reflects whatever the backend told us at login — no separate "Admin"
// button anywhere; this single link goes wherever this signed-in account
// actually belongs, or to the unified sign-in page for a guest.
function updateAccountLink() {
  const link = document.getElementById('accountLink');
  const label = document.getElementById('accountLabel');
  if (!link || !label) return;
  const user = API.user();
  if (user && API.token()) {
    if (['admin', 'manager', 'staff'].includes(user.role)) {
      link.href = 'admin.html';
      label.textContent = 'Admin Panel';
    } else {
      link.href = 'user-dashboard.html';
      label.textContent = user.name.split(' ')[0];
    }
  } else {
    link.href = 'login.html';
    label.textContent = 'Sign In';
  }
}

/* ============ FOOTER SETTINGS (live from Admin → Settings) ============ */
async function loadFooterSettings() {
  try {
    const { settings } = await API.get('/api/settings/public');
    const phoneEl = document.getElementById('footerPhone');
    const nameEl = document.getElementById('footerStoreName');
    const copyEl = document.getElementById('footerCopyrightName');
    const bankEl = document.getElementById('checkoutBankDetails');
    if (phoneEl && settings.support_phone) phoneEl.textContent = settings.support_phone;
    if (nameEl && settings.store_name) nameEl.textContent = settings.store_name;
    if (copyEl && settings.store_name) copyEl.textContent = settings.store_name;
    if (bankEl) bankEl.textContent = `Account title: ${settings.store_name || 'ShakarGanj Grocery Store'}. Bank: ${settings.bank_name || 'Meezan Bank'}. IBAN: ${settings.bank_iban || 'PK00 MEZN 0000 0000 1234 567'}.`;
  } catch (err) {
    // Footer already shows sensible hard-coded defaults in the HTML — if this
    // call fails for any reason, the page still looks correct, just not live.
  }
}

/* ============ INIT ============ */
loadProducts();
renderCart();
updateAccountLink();
loadFooterSettings();
document.addEventListener('DOMContentLoaded', () => {
  if (typeof initSupportWidget === 'function') initSupportWidget();
});
