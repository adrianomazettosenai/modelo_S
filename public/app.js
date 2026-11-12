const state = { products: [], inventory: [], alerts: { atingiram_limite_minimo: [], atingiram_limite_maximo: [] }, toastTimer: null };
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const number = new Intl.NumberFormat('pt-BR');
const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const dateLabel = (value) => value ? new Date(value).toLocaleDateString('pt-BR') : '—';

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.mensagem || 'Não foi possível concluir a operação.');
  return data;
}

function notify(message, error = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

function badgeFor(product) {
  const quantity = Number(product.quantidade);
  const min = Number(product.estoque_minimo);
  const max = Number(product.estoque_maximo);
  if (Number.isFinite(min) && quantity <= min) return '<span class="badge badge-low">Estoque baixo</span>';
  if (Number.isFinite(max) && quantity >= max) return '<span class="badge badge-high">Limite máximo</span>';
  return '<span class="badge badge-ok">Em estoque</span>';
}

function renderInventory() {
  const search = ($('#stock-search')?.value || '').trim().toLocaleLowerCase('pt-BR');
  const products = state.products.filter((product) => `${product.denominacao} ${product.categorias?.nome || ''}`.toLocaleLowerCase('pt-BR').includes(search));
  $('#stock-count').textContent = `${products.length} ${products.length === 1 ? 'produto' : 'produtos'} encontrados`;
  $('#stock-table').innerHTML = products.map((product) => {
    const inventory = state.inventory.find((item) => item.produto_id === product.id);
    return `<tr><td class="product-name">${escapeHTML(product.denominacao)}</td><td class="product-category">${escapeHTML(product.categorias?.nome || '—')}</td><td class="quantity-value">${number.format(product.quantidade)} ${escapeHTML(product.unidade_medida)}</td><td>${currency.format(Number(product.valor_unitario) || 0)}</td><td class="value-strong">${currency.format(Number(inventory?.valor_total) || 0)}</td><td>${badgeFor(product)}</td></tr>`;
  }).join('');
  $('#stock-empty').classList.toggle('hidden', products.length > 0);

  const dashboardProducts = state.products.slice(0, 6);
  $('#dashboard-inventory').innerHTML = dashboardProducts.map((product) => {
    const inventory = state.inventory.find((item) => item.produto_id === product.id);
    return `<tr><td class="product-name">${escapeHTML(product.denominacao)}</td><td class="product-category">${escapeHTML(product.categorias?.nome || '—')}</td><td class="quantity-value">${number.format(product.quantidade)} ${escapeHTML(product.unidade_medida)}</td><td class="value-strong">${currency.format(Number(inventory?.valor_total) || 0)}</td><td>${badgeFor(product)}</td></tr>`;
  }).join('');
  $('#dashboard-empty').classList.toggle('hidden', state.products.length > 0);
  $('#stat-products').textContent = number.format(state.products.length);

  const productOptions = state.products.map((product) => `<option value="${product.id}">${escapeHTML(product.denominacao)} · ${number.format(product.quantidade)} ${escapeHTML(product.unidade_medida)}</option>`).join('');
  $('#movement-product').innerHTML = `<option value="">Selecione um produto</option>${productOptions}`;
}

function renderAlerts() {
  const low = state.alerts.atingiram_limite_minimo || [];
  const high = state.alerts.atingiram_limite_maximo || [];
  const alerts = [
    ...low.map((item) => ({ ...item, max: false })),
    ...high.map((item) => ({ ...item, max: true })),
  ];
  $('#alert-count').textContent = number.format(alerts.length);
  $('#stat-low').textContent = number.format(low.length);
  $('#stat-high').textContent = number.format(high.length);
  $('#alerts-list').innerHTML = alerts.slice(0, 5).map((item) => `<div class="alert-item ${item.max ? 'max' : ''}"><span class="alert-dot">${item.max ? '↗' : '!'}</span><div class="alert-copy"><strong>${escapeHTML(item.denominacao)}</strong><small>${number.format(item.quantidade)} ${escapeHTML(item.unidade_medida)} em estoque</small></div><span class="alert-level">${item.max ? 'No máximo' : 'Estoque baixo'}</span></div>`).join('');
  $('#alerts-empty').classList.toggle('hidden', alerts.length > 0);
}

async function loadDashboard() {
  const [inventory, products, alerts] = await Promise.all([
    api('/api/estoque/valor-total'),
    api('/api/produtos'),
    api('/api/estoque/limites'),
  ]);
  state.inventory = inventory;
  state.products = products;
  state.alerts = alerts;
  const total = inventory.reduce((sum, item) => sum + (Number(item.valor_total) || 0), 0);
  $('#stat-value').textContent = currency.format(total);
  renderInventory();
  renderAlerts();
}

async function loadCategories() {
  const categories = await api('/api/categorias');
  const select = $('#product-category');
  select.innerHTML = `<option value="">Selecione uma categoria</option>${categories.map((category) => `<option value="${category.id}">${escapeHTML(category.nome)}</option>`).join('')}`;
}

async function loadExits() {
  const exits = await api('/api/movimentacoes/saidas');
  $('#exits-table').innerHTML = exits.slice(0, 8).map((exit) => `<tr><td class="product-name">${escapeHTML(exit.produto || 'Produto')}</td><td class="quantity-value">${number.format(exit.quantidade)} ${escapeHTML(exit.unidade_medida)}</td><td>${dateLabel(exit.data_movimentacao)}</td></tr>`).join('');
  $('#exits-empty').classList.toggle('hidden', exits.length > 0);
}

function showPage(name) {
  const titles = { dashboard: 'Visão geral', stock: 'Estoque', movements: 'Movimentações', reports: 'Relatórios' };
  document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === `page-${name}`));
  document.querySelectorAll('.nav-link').forEach((button) => button.classList.toggle('active', button.dataset.page === name));
  $('#breadcrumb-current').textContent = titles[name] || titles.dashboard;
  if (name === 'movements') loadExits().catch((error) => notify(error.message, true));
}

function setDefaultReportDates() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const localISO = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  $('#report-form [name="data_inicial"]').value = localISO(start);
  $('#report-form [name="data_final"]').value = localISO(today);
}

async function loadReports(start, end) {
  const params = new URLSearchParams({ data_inicial: start, data_final: end });
  const [report, ranking] = await Promise.all([
    api(`/api/relatorios/movimentacoes?${params}`),
    api(`/api/relatorios/maior-saida?${params}`),
  ]);
  $('#report-table').innerHTML = report.itens.map((item) => `<tr><td class="product-name">${escapeHTML(item.nome_produto)}</td><td>${number.format(item.total_entradas)} ${escapeHTML(item.unidade_medida)}</td><td>${number.format(item.total_saidas)} ${escapeHTML(item.unidade_medida)}</td><td class="quantity-value">${number.format(item.saldo_periodo)} ${escapeHTML(item.unidade_medida)}</td></tr>`).join('');
  $('#report-empty').classList.toggle('hidden', report.itens.length > 0);
  $('#ranking-list').innerHTML = ranking.produtos_maior_saida.slice(0, 6).map((item, index) => `<div class="ranking-item"><span class="ranking-number">${index + 1}</span><div class="ranking-copy"><strong>${escapeHTML(item.nome_produto)}</strong><small>${currency.format(item.valor_total_financeiro_saidas)}</small></div><span class="ranking-total">${number.format(item.quantidade_total_saida)} un.</span></div>`).join('');
  $('#ranking-empty').classList.toggle('hidden', ranking.produtos_maior_saida.length > 0);
}

document.querySelectorAll('.nav-link').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page)));
document.querySelectorAll('[data-goto]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.goto)));
$('#stock-search').addEventListener('input', renderInventory);
$('#refresh-button').addEventListener('click', () => loadDashboard().then(() => notify('Dados atualizados.')).catch((error) => notify(error.message, true)));

$('#open-product-form').addEventListener('click', () => {
  loadCategories().then(() => $('#product-dialog').showModal()).catch((error) => notify(error.message, true));
});
document.querySelectorAll('.close-modal').forEach((button) => button.addEventListener('click', () => $('#product-dialog').close()));
$('#product-dialog').addEventListener('click', (event) => {
  if (event.target === $('#product-dialog')) $('#product-dialog').close();
});

$('#product-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const payload = Object.fromEntries(new FormData(form));
  submit.disabled = true;
  try {
    await api('/api/produtos', { method: 'POST', body: JSON.stringify(payload) });
    $('#product-dialog').close();
    form.reset();
    await loadDashboard();
    notify('Produto cadastrado com sucesso.');
  } catch (error) {
    notify(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

$('#movement-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  const kind = payload.tipo;
  const submit = form.querySelector('[type="submit"]');
  delete payload.tipo;
  Object.keys(payload).forEach((key) => { if (!payload[key]) delete payload[key]; });
  submit.disabled = true;
  try {
    await api(`/api/movimentacoes/${kind === 'ENTRADA' ? 'entradas' : 'saidas'}`, { method: 'POST', body: JSON.stringify(payload) });
    form.reset();
    await Promise.all([loadDashboard(), loadExits()]);
    notify(`${kind === 'ENTRADA' ? 'Entrada' : 'Saída'} registrada com sucesso.`);
  } catch (error) {
    notify(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

$('#report-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const values = Object.fromEntries(new FormData(form));
  submit.disabled = true;
  try {
    await loadReports(values.data_inicial, values.data_final);
  } catch (error) {
    notify(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

$('#today-label').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
setDefaultReportDates();
Promise.all([loadDashboard(), loadCategories()]).catch((error) => notify(error.message, true));
