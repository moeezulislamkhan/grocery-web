// public/js/admin.js — ShakarGanj admin dashboard logic

const ROLE_INFO = {
  admin: { label: 'Administrator', desc: 'Full access to all modules' },
  manager: { label: 'Manager', desc: 'Products, orders & analytics' },
  staff: { label: 'Staff', desc: 'Products & orders only' },
  employee: { label: 'Employee', desc: 'Products & orders only' },
};

function fmt(n) { return 'Rs. ' + Math.round(n).toLocaleString(); }
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

/* ============ AUTH ============ */
// Server-side authorization (checked on every API call) is what actually
// protects admin data. This guard just sends an unauthenticated or
// wrong-role visitor straight to the unified login page instead of showing
// them an empty dashboard full of 403s. There is no login form on this page
// at all — sign-in only happens through login.html.
(function guard() {
  try {
    const user = API.user();
    if (!user || !API.token() || !['admin', 'manager', 'staff', 'employee'].includes(user.role)) {
      location.href = 'login.html';
      return;
    }
    enterDashboard(user);
  } catch (err) {
    // Never let a single unexpected error (a bad CDN load, a stale/odd
    // localStorage value, etc.) silently break every future nav click.
    console.error('[admin] guard/enterDashboard failed:', err);
    showToast('Something went wrong loading the dashboard — check the browser console.');
  }
})();

function logout() {
  API.logout().then(() => { location.href = 'login.html'; });
}

function enterDashboard(user) {
  const info = ROLE_INFO[user.role];
  // The Deals markup is kept in one place and moved into the dashboard content
  // area at runtime so it works with the existing sidebar layout on all sizes.
  const dealsPage = document.getElementById('page-deals');
  const adminMain = document.querySelector('.admin-main');
  if (dealsPage && adminMain && dealsPage.parentElement !== adminMain) adminMain.appendChild(dealsPage);
  document.getElementById('sidebarRoleName').textContent = info.label;
  document.getElementById('sidebarRoleDesc').textContent = info.desc;
  document.querySelectorAll('#adminNav a').forEach(a => {
    const req = a.dataset.req;
    if (req) a.classList.toggle('locked', !req.split(',').includes(user.role));
  });
  loadGatewayMode();
  showAdminPage('overview');
  // Each of these manages its own try/catch internally and is independent —
  // if one fails (e.g. Chart.js didn't load from the CDN), the others and
  // all page navigation still work fine.
  loadOverview();
  loadProducts();
  loadDeals();
  loadCampaigns();
  loadPinkSaltAdmin();
  loadOrders();
  loadSupport();
  loadSettings();
  loadMembers();
}

/* ============ NAVIGATION ============ */
function showAdminPage(page) {
  try {
    const currentUser = API.user();
    const link = document.querySelector(`#adminNav a[data-page="${page}"]`);
    const req = link ? link.dataset.req : null;
    const allowed = !req || (currentUser && req.split(',').includes(currentUser.role));
    document.querySelectorAll('.admin-page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('#adminNav a').forEach(a => a.classList.remove('active'));
    if (!allowed) { document.getElementById('page-denied').classList.add('active'); return; }
    document.getElementById('page-' + page).classList.add('active');
    if (link) link.classList.add('active');
    if (page === 'analytics') loadAnalytics();
    updateAdminBackButton(page);
  } catch (err) {
    console.error('[admin] showAdminPage failed for', page, err);
  }
}

// One shared Back button (see admin.html, right above the page content) that
// adapts to whichever section is currently open — matches the requested
// navigation rule: any sub-page → Overview, and Overview → the public site's
// Home page. No per-page duplicate nav bars needed.
function updateAdminBackButton(page) {
  const btn = document.getElementById('adminBackBtn');
  if (!btn) return;
  if (page === 'overview') {
    btn.textContent = '← Back to Home';
    btn.onclick = () => { window.location.href = 'index.html'; };
  } else {
    btn.textContent = '← Back to Overview';
    btn.onclick = () => showAdminPage('overview');
  }
}

/* ============ GATEWAY MODE ============ */
async function loadGatewayMode() {
  try {
    const { live } = await API.get('/api/payments/mode');
    const pill = document.getElementById('gwPill');
    pill.textContent = live ? 'JazzCash: LIVE' : 'JazzCash: SANDBOX';
    pill.className = 'gw-pill ' + (live ? 'live' : 'sandbox');
  } catch { /* ignore */ }
}

/* ============ OVERVIEW ============ */
let overviewChart = null;
async function loadOverview() {
  try {
    const s = await API.get('/api/analytics/summary');
    const cards = document.querySelectorAll('#kpiGrid .kpi-card .val');
    cards[0].textContent = fmt(s.revenue);
    cards[1].textContent = s.orderCount;
    cards[2].textContent = fmt(s.avgOrder);
    cards[3].textContent = s.customerCount;

    // Chart.js loads from a CDN — kept in its own try/catch so a blocked or
    // failed CDN load (e.g. no internet on this network) never prevents the
    // KPI cards or the rest of the dashboard from showing.
    try {
      const ctx = document.getElementById('overviewChart');
      const labels = s.dailyRevenue.map(d => d.day.slice(5));
      const data = s.dailyRevenue.map(d => d.total);
      if (overviewChart) overviewChart.destroy();
      overviewChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: [{ data, borderColor: '#620014', backgroundColor: 'rgba(98,0,20,0.08)', fill: true, tension: .4, pointRadius: 0, borderWidth: 2.5 }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { display: false }, x: { grid: { display: false }, ticks: { color: '#7A5C61', font: { size: 10 } } } } },
      });
    } catch (chartErr) {
      console.error('[admin] Chart.js unavailable — is the CDN reachable?', chartErr);
    }

    document.getElementById('topProductsList').innerHTML = s.topProducts.length
      ? s.topProducts.map(p => `<div class="top-prod-row"><div class="name">${p.name}</div><div class="amt">${fmt(p.revenue)}</div></div>`).join('')
      : '<p class="empty-note">No sales yet.</p>';
  } catch (err) {
    // KPI cards hidden from staff role — expected 403, show placeholders instead
    document.querySelectorAll('#kpiGrid .kpi-card .val').forEach(el => el.textContent = '—');
  }
}

/* ============ PRODUCTS ============ */
let ALL_PRODUCTS = [];
async function loadProducts() {
  try {
    const { products } = await API.get('/api/products');
    ALL_PRODUCTS = products;
    renderAdminProducts();
  } catch (err) { showToast(err.message); }
}
function renderAdminProducts(filter = '') {
  const list = ALL_PRODUCTS.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()));
  document.getElementById('prodCount').textContent = list.length + ' products';
  document.getElementById('adminProductsTbody').innerHTML = list.map(p => {
    const status = p.stock === 0 ? '<span class="pill out">Out of stock</span>' : p.stock < 15 ? '<span class="pill low">Low stock</span>' : '<span class="pill instock">In stock</span>';
    return `<tr>
      <td><img src="${p.image}"></td>
      <td>${p.name}</td>
      <td>${p.category}</td>
      <td>${p.sale_price && p.sale_price < p.price ? `<span class="old">${fmt(p.price)}</span>${fmt(p.sale_price)}` : fmt(p.price)}</td>
      <td>${p.stock}</td>
      <td>${status}</td>
      <td class="row-actions"><button class="edt" onclick="openEditProduct(${p.id})">Edit</button><button class="del" onclick="deleteProduct(${p.id})">Delete</button></td>
    </tr>`;
  }).join('');
}
function filterAdminProducts(v) { renderAdminProducts(v); }

/* ============ DEALS ============ */
let ALL_DEALS = [];
let CURRENT_EDIT_DEAL_ID = null;
async function loadDeals() {
  try {
    const { deals } = await API.get('/api/admin/deals');
    ALL_DEALS = deals || [];
    renderAdminDeals();
  } catch (err) { showToast(err.message); }
}

let ALL_CAMPAIGNS = [];
let CURRENT_EDIT_CAMPAIGN_ID = null;
function campaignDate(value) {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}
async function loadCampaigns() {
  try { const { campaigns } = await API.get('/api/admin/deal-campaigns'); ALL_CAMPAIGNS = campaigns || []; renderAdminCampaigns(); } catch (err) { console.error('[admin] Could not load deal containers:', err); showToast(err.message || 'Could not load deal containers.'); }
}
function renderAdminCampaigns() {
  const filter = document.getElementById('campaignStatusFilter')?.value || 'all';
  const list = ALL_CAMPAIGNS.filter(c => filter === 'all' || c.status === filter);
  document.getElementById('campaignCount').textContent = list.length + ' containers';
  document.getElementById('adminCampaignsTbody').innerHTML = list.map(c => `<tr><td><strong>${c.title}</strong></td><td style="max-width:280px;">${c.description}</td><td style="font-size:11px;">${campaignDate(c.end_date)}</td><td><span class="pill ${c.status === 'active' ? 'active' : c.status === 'expired' ? 'out' : 'pending'}">${c.status}</span></td><td class="row-actions"><button onclick="openCampaignForm(${c.id})">Edit</button>${c.status === 'disabled' ? `<button onclick="setCampaignVisibility(${c.id}, true)">Show</button>` : `<button onclick="setCampaignVisibility(${c.id}, false)">Hide</button>`}<button class="del" onclick="deleteCampaign(${c.id})">Delete</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty-note">No deal containers published yet.</td></tr>';
}
function openCampaignForm(id = null) {
  CURRENT_EDIT_CAMPAIGN_ID = id;
  const c = id ? ALL_CAMPAIGNS.find(item => item.id === id) : null;
  document.getElementById('campaignFormTitle').textContent = c ? 'Edit deal container' : 'Add deal container';
  document.getElementById('campaignTitle').value = c?.title || '';
  document.getElementById('campaignDescription').value = c?.description || '';
  document.getElementById('campaignEnd').value = c?.end_date ? String(c.end_date).replace(' ', 'T').slice(0, 16) : '';
  document.getElementById('campaignFormPanel').style.display = 'block';
  document.getElementById('campaignFormPanel').scrollIntoView({ behavior: 'smooth' });
}
function closeCampaignForm() { document.getElementById('campaignFormPanel').style.display = 'none'; CURRENT_EDIT_CAMPAIGN_ID = null; }
async function saveCampaign() {
  const body = { title: document.getElementById('campaignTitle').value.trim(), description: document.getElementById('campaignDescription').value.trim(), end_date: document.getElementById('campaignEnd').value, is_active: true };
  try { if (CURRENT_EDIT_CAMPAIGN_ID) await API.put(`/api/admin/deal-campaigns/${CURRENT_EDIT_CAMPAIGN_ID}`, body); else await API.post('/api/admin/deal-campaigns', body); showToast('Deal container saved.'); closeCampaignForm(); loadCampaigns(); } catch (err) { showToast(err.status === 405 ? 'Server is using an older version. Restart Flask, then try again.' : err.message); }
}
async function setCampaignVisibility(id, visible) {
  const campaign = ALL_CAMPAIGNS.find(item => item.id === id);
  if (!campaign) return;
  const body = { title: campaign.title, description: campaign.description, end_date: campaign.end_date, is_active: visible };
  try { await API.put(`/api/admin/deal-campaigns/${id}`, body); showToast(visible ? 'Container shown.' : 'Container hidden.'); loadCampaigns(); } catch (err) { showToast(err.message); }
}
async function deleteCampaign(id) { if (!window.confirm('Delete this deal container?')) return; try { await API.delete(`/api/admin/deal-campaigns/${id}`); showToast('Deal container deleted.'); loadCampaigns(); } catch (err) { showToast(err.message); } }
function renderAdminDeals() {
  const filter = document.getElementById('dealStatusFilter')?.value || 'all';
  const list = ALL_DEALS.filter(d => filter === 'all' || d.status === filter);
  document.getElementById('dealCount').textContent = list.length + ' deals';
  document.getElementById('adminDealsTbody').innerHTML = list.map(d => `<tr>
    <td><strong>${d.product.name}</strong><br><span style="color:var(--ink-soft);font-size:11px;">${d.product.category}</span></td>
    <td>${d.discount_label}</td>
    <td><span class="old">${fmt(d.original_price)}</span> <strong>${fmt(d.final_price)}</strong></td>
    <td style="font-size:11px;">${new Date(d.start_date.replace(' ', 'T') + 'Z').toLocaleString()}<br>to ${new Date(d.end_date.replace(' ', 'T') + 'Z').toLocaleString()}</td>
    <td><span class="pill ${d.status === 'active' ? 'active' : d.status === 'expired' ? 'out' : 'pending'}">${d.status}</span></td>
    <td class="row-actions"><button onclick="openDealForm(${d.id})">Edit</button><button class="del" onclick="deleteDeal(${d.id})">Delete</button></td>
  </tr>`).join('') || '<tr><td colspan="6" class="empty-note">No deals match this status.</td></tr>';
}

let PINK_SALT_EDIT_ID = null;
async function loadPinkSaltAdmin() {
  try {
    const { settings, sliders, products } = await API.get('/api/admin/pink-salt');
    window.PINK_SALT_SLIDERS = sliders || [];
    window.PINK_SALT_PRODUCTS = products || [];
    document.getElementById('pinkSaltEnabled').value = settings.is_enabled ? '1' : '0';
    document.getElementById('pinkSaltTitle').value = settings.title || '';
    document.getElementById('pinkSaltSubtitle').value = settings.subtitle || '';
    document.getElementById('pinkSaltDescription').value = settings.description || '';
    document.getElementById('pinkSaltCtaText').value = settings.cta_text || '';
    document.getElementById('pinkSaltCtaLink').value = settings.cta_link || '';
    document.getElementById('pinkSaltHeroImage').value = settings.hero_image || '';
    const select = document.getElementById('psSliderProduct');
    const productOptions = (window.PINK_SALT_PRODUCTS || []).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    select.innerHTML = '<option value="">None</option>' + productOptions;
    const rows = (window.PINK_SALT_SLIDERS || []).map(slider => `
      <tr>
        <td>${slider.title}</td>
        <td>${slider.button_text || 'Shop Now'}</td>
        <td>${slider.product ? slider.product.name : '—'}</td>
        <td><span class="pill ${slider.is_active ? 'active' : 'pending'}">${slider.is_active ? 'Active' : 'Inactive'}</span></td>
        <td class="row-actions"><button onclick="openPinkSaltSliderForm(${slider.id})">Edit</button><button class="del" onclick="deletePinkSaltSlider(${slider.id})">Delete</button></td>
      </tr>
    `).join('') || '<tr><td colspan="5" class="empty-note">No Pink Salt sliders yet.</td></tr>';
    document.getElementById('pinkSaltSlidersTbody').innerHTML = rows;
  } catch (err) {
    console.error('[admin] Pink Salt dashboard failed to load:', err);
  }
}
function openPinkSaltSliderForm(id = null) {
  PINK_SALT_EDIT_ID = id;
  const panel = document.getElementById('pinkSaltSliderPanel');
  const form = document.getElementById('pinkSaltSliderFormTitle');
  const select = document.getElementById('psSliderProduct');
  select.innerHTML = '<option value="">None</option>' + (window.PINK_SALT_PRODUCTS || []).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  const slider = (window.PINK_SALT_SLIDERS || []).find(item => item.id === id) || null;
  form.textContent = slider ? 'Edit slider' : 'Add slider';
  if (slider) {
    document.getElementById('psSliderTitle').value = slider.title || '';
    document.getElementById('psSliderSubtitle').value = slider.subtitle || '';
    document.getElementById('psSliderDescription').value = slider.description || '';
    document.getElementById('psSliderImage').value = slider.image || '';
    document.getElementById('psSliderButtonText').value = slider.button_text || 'Shop Now';
    document.getElementById('psSliderButtonUrl').value = slider.button_url || 'pink-salt.html';
    document.getElementById('psSliderProduct').value = slider.product_id ? String(slider.product_id) : '';
    document.getElementById('psSliderOrder').value = slider.display_order || 0;
    document.getElementById('psSliderActive').value = slider.is_active ? '1' : '0';
    document.getElementById('psSliderStart').value = slider.start_date ? String(slider.start_date).replace(' ', 'T').slice(0, 16) : '';
    document.getElementById('psSliderEnd').value = slider.end_date ? String(slider.end_date).replace(' ', 'T').slice(0, 16) : '';
  } else {
    document.getElementById('psSliderTitle').value = '';
    document.getElementById('psSliderSubtitle').value = '';
    document.getElementById('psSliderDescription').value = '';
    document.getElementById('psSliderImage').value = '';
    document.getElementById('psSliderButtonText').value = 'Shop Now';
    document.getElementById('psSliderButtonUrl').value = 'pink-salt.html';
    document.getElementById('psSliderProduct').value = '';
    document.getElementById('psSliderOrder').value = 0;
    document.getElementById('psSliderActive').value = '1';
    document.getElementById('psSliderStart').value = '';
    document.getElementById('psSliderEnd').value = '';
  }
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth' });
}
function closePinkSaltSliderPanel() {
  document.getElementById('pinkSaltSliderPanel').style.display = 'none';
  PINK_SALT_EDIT_ID = null;
}
async function savePinkSaltSettings() {
  const payload = {
    is_enabled: document.getElementById('pinkSaltEnabled').value === '1',
    title: document.getElementById('pinkSaltTitle').value.trim(),
    subtitle: document.getElementById('pinkSaltSubtitle').value.trim(),
    description: document.getElementById('pinkSaltDescription').value.trim(),
    cta_text: document.getElementById('pinkSaltCtaText').value.trim(),
    cta_link: document.getElementById('pinkSaltCtaLink').value.trim(),
    hero_image: document.getElementById('pinkSaltHeroImage').value.trim(),
  };
  try {
    await API.post('/api/admin/pink-salt', payload);
    showToast('Pink Salt settings saved.');
    loadPinkSaltAdmin();
  } catch (err) { showToast(err.message); }
}
async function savePinkSaltSlider() {
  const body = {
    title: document.getElementById('psSliderTitle').value.trim(),
    subtitle: document.getElementById('psSliderSubtitle').value.trim(),
    description: document.getElementById('psSliderDescription').value.trim(),
    image: document.getElementById('psSliderImage').value.trim(),
    button_text: document.getElementById('psSliderButtonText').value.trim(),
    button_url: document.getElementById('psSliderButtonUrl').value.trim(),
    product_id: document.getElementById('psSliderProduct').value || null,
    display_order: Number(document.getElementById('psSliderOrder').value || 0),
    is_active: document.getElementById('psSliderActive').value === '1',
    start_date: document.getElementById('psSliderStart').value || '',
    end_date: document.getElementById('psSliderEnd').value || '',
  };
  if (!body.title) { showToast('Slider title is required.'); return; }
  try {
    if (PINK_SALT_EDIT_ID) await API.put(`/api/admin/pink-salt/sliders/${PINK_SALT_EDIT_ID}`, body);
    else await API.post('/api/admin/pink-salt/sliders', body);
    showToast('Pink Salt slider saved.');
    closePinkSaltSliderPanel();
    loadPinkSaltAdmin();
  } catch (err) { showToast(err.message); }
}
async function deletePinkSaltSlider(id) {
  if (!window.confirm('Delete this Pink Salt slider?')) return;
  try { await API.delete(`/api/admin/pink-salt/sliders/${id}`); showToast('Pink Salt slider removed.'); loadPinkSaltAdmin(); } catch (err) { showToast(err.message); }
}

function openDealForm(dealId = null) {
  CURRENT_EDIT_DEAL_ID = dealId;
  const deal = dealId ? ALL_DEALS.find(d => d.id === dealId) : null;
  const productSelect = document.getElementById('dealProduct');
  const assigned = new Set(ALL_DEALS.filter(d => d.id !== dealId).map(d => d.product_id));
  productSelect.innerHTML = ALL_PRODUCTS.filter(p => !assigned.has(p.id) || (deal && p.id === deal.product_id)).map(p => `<option value="${p.id}">${p.name} — ${fmt(p.price)}</option>`).join('');
  if (deal) {
    document.getElementById('dealFormTitle').textContent = 'Edit deal';
    productSelect.value = deal.product_id;
    document.getElementById('dealType').value = deal.discount_type;
    document.getElementById('dealValue').value = deal.discount_value;
    document.getElementById('dealStart').value = deal.start_date.replace(' ', 'T').slice(0, 16);
    document.getElementById('dealEnd').value = deal.end_date.replace(' ', 'T').slice(0, 16);
    document.getElementById('dealEnabled').value = deal.is_active ? '1' : '0';
  } else {
    document.getElementById('dealFormTitle').textContent = 'Add deal';
    document.getElementById('dealValue').value = '';
    document.getElementById('dealStart').value = new Date().toISOString().slice(0, 16);
    document.getElementById('dealEnd').value = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16);
    document.getElementById('dealEnabled').value = '1';
  }
  document.getElementById('dealFormPanel').style.display = 'block';
  document.getElementById('dealFormPanel').scrollIntoView({ behavior: 'smooth' });
}
function closeDealForm() { document.getElementById('dealFormPanel').style.display = 'none'; CURRENT_EDIT_DEAL_ID = null; }
async function saveDeal() {
  const body = { product_id: Number(document.getElementById('dealProduct').value), discount_type: document.getElementById('dealType').value, discount_value: Number(document.getElementById('dealValue').value), start_date: document.getElementById('dealStart').value, end_date: document.getElementById('dealEnd').value, is_active: document.getElementById('dealEnabled').value === '1' };
  try {
    if (CURRENT_EDIT_DEAL_ID) await API.put(`/api/admin/deals/${CURRENT_EDIT_DEAL_ID}`, body);
    else await API.post('/api/admin/deals', body);
    showToast('Deal saved.'); closeDealForm(); loadDeals();
  } catch (err) { showToast(err.message); }
}
async function deleteDeal(dealId) {
  if (!window.confirm('Remove this deal? The original product will remain.')) return;
  try { await API.delete(`/api/admin/deals/${dealId}`); showToast('Deal removed.'); loadDeals(); } catch (err) { showToast(err.message); }
}
function openAddProduct() { document.getElementById('addProductPanel').style.display = 'block'; document.getElementById('addProductPanel').scrollIntoView({ behavior: 'smooth' }); }
function closeAddProduct() { document.getElementById('addProductPanel').style.display = 'none'; }

async function addProduct() {
  const name = document.getElementById('npName').value.trim();
  const category = document.getElementById('npCat').value;
  const price = parseFloat(document.getElementById('npPrice').value) || 0;
  const salePriceValue = document.getElementById('npSalePrice').value.trim();
  const salePrice = salePriceValue ? parseFloat(salePriceValue) : null;
  const tag = document.getElementById('npTag').value.trim();
  const stock = parseInt(document.getElementById('npStock').value) || 0;
  const image = document.getElementById('npImg').value.trim() || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=300&q=80';
  const isPinkSalt = document.getElementById('npPinkSalt').checked;
  if (!name || !price) { showToast('Please enter at least a product name and price.'); return; }
  try {
    await API.post('/api/products', { name, category, price, salePrice, tag, stock, image, is_pink_salt: isPinkSalt });
    showToast('Product added.');
    closeAddProduct();
    document.getElementById('npName').value = ''; document.getElementById('npPrice').value = ''; document.getElementById('npSalePrice').value = ''; document.getElementById('npTag').value = ''; document.getElementById('npStock').value = ''; document.getElementById('npImg').value = '';
    loadProducts();
  } catch (err) { showToast(err.message); }
}
async function deleteProduct(id) {
  try {
    await API.delete(`/api/products/${id}`);
    showToast('Product deleted.');
    loadProducts();
  } catch (err) { showToast(err.message); }
}

/* ============ ORDERS ============ */
const ORDER_STATUSES = ['processing', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled'];
async function loadOrders() {
  try {
    const { orders } = await API.get('/api/orders');
    const header = `<thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Payment status</th><th>Order status</th></tr></thead>`;
    const rowsHtml = orders.map(o => `
      <tr>
        <td>${o.order_code}</td>
        <td>${o.customer_name}</td>
        <td>${fmt(o.total)}</td>
        <td>${o.payment_method}</td>
        <td><span class="pill ${o.payment_status}">${o.payment_status.replace('_', ' ')}</span></td>
        <td class="row-actions">
          <select onchange="updateOrderStatus(${o.id}, this.value)">
            ${ORDER_STATUSES.map(s => `<option value="${s}" ${s === o.order_status ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}
          </select>
        </td>
      </tr>`).join('');
    document.getElementById('ordersTable').innerHTML = header + '<tbody>' + (rowsHtml || '<tr><td colspan="6" class="empty-note">No orders yet.</td></tr>') + '</tbody>';
    document.getElementById('recentOrdersTable').innerHTML = header + '<tbody>' + (orders.slice(0, 5).map(o => `
      <tr>
        <td>${o.order_code}</td><td>${o.customer_name}</td><td>${fmt(o.total)}</td><td>${o.payment_method}</td>
        <td><span class="pill ${o.payment_status}">${o.payment_status.replace('_', ' ')}</span></td>
        <td><span class="pill ${o.order_status}">${o.order_status.replace('_', ' ')}</span></td>
      </tr>`).join('') || '<tr><td colspan="6" class="empty-note">No orders yet.</td></tr>') + '</tbody>';
  } catch (err) { showToast(err.message); }
}
async function updateOrderStatus(id, status) {
  try {
    await API.patch(`/api/orders/${id}/status`, { status });
    showToast('Order status updated.');
    loadOrders();
  } catch (err) { showToast(err.message); }
}

/* ============ ANALYTICS ============ */
let catChart = null, payChart = null;
async function loadAnalytics() {
  try {
    const s = await API.get('/api/analytics/summary');
    if (catChart) catChart.destroy();
    if (payChart) payChart.destroy();
    catChart = new Chart(document.getElementById('catChart'), {
      type: 'bar',
      data: { labels: s.byCategory.map(c => c.category), datasets: [{ data: s.byCategory.map(c => c.total), backgroundColor: '#620014', borderRadius: 6 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#ECE3E0' } }, x: { grid: { display: false } } } },
    });
    payChart = new Chart(document.getElementById('payChart'), {
      type: 'doughnut',
      data: {
        labels: s.byPayment.map(p => p.method),
        datasets: [{ data: s.byPayment.map(p => p.count), backgroundColor: ['#DA1C5C', '#28A745', '#620014', '#3B3B3B', '#D98A2B'] }],
      },
      options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } } },
    });
  } catch (err) { showToast(err.message); }
}

/* ============ SUPPORT INBOX ============ */
async function loadSupport() {
  try {
    const { messages } = await API.get('/api/support/messages');
    const header = `<thead><tr><th>From</th><th>Topic</th><th>Message</th><th>Status</th><th>Actions</th></tr></thead>`;
    const rows = messages.map(m => `
      <tr>
        <td>${m.name}<br><span style="color:var(--ink-soft); font-size:11px;">${m.email}</span></td>
        <td>${m.topic || 'General'}</td>
        <td style="max-width:280px;">${m.message}</td>
        <td><span class="pill ${m.status}">${m.status}</span></td>
        <td class="row-actions">${m.status === 'open' ? `<button onclick="resolveSupport(${m.id})">Mark resolved</button>` : ''}</td>
      </tr>`).join('');
    document.getElementById('supportTable').innerHTML = header + '<tbody>' + (rows || '<tr><td colspan="5" class="empty-note">No messages yet.</td></tr>') + '</tbody>';
  } catch (err) { showToast(err.message); }
}
async function resolveSupport(id) {
  try {
    await API.patch(`/api/support/messages/${id}/resolve`);
    showToast('Marked as resolved.');
    loadSupport();
  } catch (err) { showToast(err.message); }
}

/* ============ PRODUCT EDITING ============ */
let CURRENT_EDIT_PRODUCT_ID = null;
function openEditProduct(productId) {
  const product = ALL_PRODUCTS.find(p => p.id === productId);
  if (!product) return;
  CURRENT_EDIT_PRODUCT_ID = productId;
  document.getElementById('epName').value = product.name;
  document.getElementById('epCat').value = product.category;
  document.getElementById('epPrice').value = product.price;
  document.getElementById('epSalePrice').value = product.sale_price || '';
  document.getElementById('epTag').value = product.tag || '';
  document.getElementById('epStock').value = product.stock;
  document.getElementById('epImg').value = product.image || '';
  document.getElementById('epPinkSalt').checked = !!product.is_pink_salt;
  document.getElementById('editProductPanel').style.display = 'block';
  document.getElementById('editProductPanel').scrollIntoView({ behavior: 'smooth' });
}
function closeEditProduct() {
  document.getElementById('editProductPanel').style.display = 'none';
  CURRENT_EDIT_PRODUCT_ID = null;
}
async function saveEditProduct() {
  if (!CURRENT_EDIT_PRODUCT_ID) return;
  const name = document.getElementById('epName').value.trim();
  const category = document.getElementById('epCat').value;
  const price = parseFloat(document.getElementById('epPrice').value) || 0;
  const salePriceValue = document.getElementById('epSalePrice').value.trim();
  const salePrice = salePriceValue ? parseFloat(salePriceValue) : null;
  const tag = document.getElementById('epTag').value.trim();
  const stock = parseInt(document.getElementById('epStock').value) || 0;
  const image = document.getElementById('epImg').value.trim() || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=300&q=80';
  const isPinkSalt = document.getElementById('epPinkSalt').checked;
  if (!name || !price) { showToast('Please enter at least a product name and price.'); return; }
  try {
    await API.put(`/api/products/${CURRENT_EDIT_PRODUCT_ID}`, { name, category, price, salePrice, tag, stock, image, is_pink_salt: isPinkSalt });
    showToast('Product updated.');
    closeEditProduct();
    loadProducts();
  } catch (err) { showToast(err.message); }
}

/* ============ SETTINGS ============ */
async function loadSettings() {
  try {
    const { settings } = await API.get('/api/settings');
    if (settings) {
      document.getElementById('setPhone').value = settings.support_phone || '+92 300 1234567';
      document.getElementById('setEmail').value = settings.support_email || 'orders@shakarganj.pk';
    }
    document.getElementById('setTheme').value = sessionStorage.getItem('sg_theme') || 'maroon';
  } catch (err) {
    // If no settings exist yet, that's fine — use defaults
  }
}
async function saveSettings() {
  try {
    const settingsData = {
      support_phone: document.getElementById('setPhone').value || '+92 300 1234567',
      support_email: document.getElementById('setEmail').value.trim() || 'orders@shakarganj.pk'
    };
    await API.put('/api/settings', settingsData);
    sessionStorage.setItem('sg_theme', document.getElementById('setTheme').value);
    applyTemporaryTheme(document.getElementById('setTheme').value);
    showToast('Settings saved successfully.');
  } catch (err) { showToast(err.message); }
}

/* ============ MEMBERS/EMPLOYEES ============ */
let ALL_MEMBERS = [];
async function loadMembers() {
  try {
    const { members } = await API.get('/api/employees');
    ALL_MEMBERS = members || [];
    renderMembers();
  } catch (err) { 
    ALL_MEMBERS = [];
    renderMembers();
  }
}
function renderMembers(filter = '') {
  const list = ALL_MEMBERS.filter(m => 
    m.name.toLowerCase().includes(filter.toLowerCase()) || 
    m.email.toLowerCase().includes(filter.toLowerCase())
  );
  document.getElementById('memberCount').textContent = list.length + ' members';
  document.getElementById('membersTbody').innerHTML = list.map(m => {
    const created = new Date(m.created_at).toLocaleDateString();
    return `<tr>
      <td>${m.name}</td>
      <td>${m.email}</td>
      <td>${m.role}</td>
      <td>${created}</td>
      <td class="row-actions"><button class="del" onclick="deleteMember(${m.id})">Remove</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="empty-note">No members yet. Create one with the button above.</td></tr>';
}
function filterMembers(v) { renderMembers(v); }
function openAddMember() { document.getElementById('addMemberPanel').style.display = 'block'; document.getElementById('addMemberPanel').scrollIntoView({ behavior: 'smooth' }); }
function closeAddMember() { document.getElementById('addMemberPanel').style.display = 'none'; }
async function addMember() {
  const name = document.getElementById('nmName').value.trim();
  const email = document.getElementById('nmEmail').value.trim().toLowerCase();
  const password = document.getElementById('nmPassword').value;
  if (!name || !email || !password) { showToast('Please fill in all fields.'); return; }
  if (password.length < 8) { showToast('Password must be at least 8 characters.'); return; }
  try {
    await API.post('/api/employees', { name, email, password });
    showToast('Member created successfully. They can now log in.');
    closeAddMember();
    document.getElementById('nmName').value = '';
    document.getElementById('nmEmail').value = '';
    document.getElementById('nmPassword').value = '';
    loadMembers();
  } catch (err) { showToast(err.message); }
}
async function deleteMember(id) {
  if (!confirm('Remove this member? They will no longer be able to log in.')) return;
  try {
    await API.delete(`/api/employees/${id}`);
    showToast('Member removed.');
    loadMembers();
  } catch (err) { showToast(err.message); }
}
