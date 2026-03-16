// Main application logic
let currentEditId = null;
let budgetSelectedProducts = [];

const AUTH_STORAGE_KEY_USERS = 'crm_users';
const AUTH_STORAGE_KEY_SESSION = 'crm_session';

// Optional: configure to enable Google Sign-In (Google Identity Services).
// Example: const GOOGLE_CLIENT_ID = '123...apps.googleusercontent.com';
const GOOGLE_CLIENT_ID = '';
let googleAuthInitialized = false;

const APP_LOCALE = 'pt-BR';
let lastCalculatedBudgetTotals = { subtotal: 0, discountAmount: 0, taxesAmount: 0, total: 0 };

const LOADING_OVERLAY_ID = 'loadingOverlay';
const LOADING_OVERLAY_MESSAGE_ID = 'loadingOverlayMessage';

function showLoadingOverlay(message = 'Carregando...') {
    const overlay = document.getElementById(LOADING_OVERLAY_ID);
    if (!overlay) return;

    const msg = document.getElementById(LOADING_OVERLAY_MESSAGE_ID);
    if (msg) msg.textContent = message;

    overlay.classList.add('is-visible');
    overlay.setAttribute('aria-hidden', 'false');
}

function hideLoadingOverlay() {
    const overlay = document.getElementById(LOADING_OVERLAY_ID);
    if (!overlay) return;

    overlay.classList.remove('is-visible');
    overlay.setAttribute('aria-hidden', 'true');
}

const STATUS_MAP = {
    Draft: 'Rascunho',
    Sent: 'Enviado',
    Approved: 'Aprovado',
    Rejected: 'Rejeitado',
    Active: 'Ativo',
    Inactive: 'Inativo'
};

function normalizeStatus(value) {
    return STATUS_MAP[value] || value;
}

function getCurrencyCode() {
    return 'BRL';
}

function formatMoney(amount) {
    const value = Number(amount);
    const safeValue = Number.isFinite(value) ? value : 0;
    const currency = getCurrencyCode();
    try {
        return new Intl.NumberFormat(APP_LOCALE, { style: 'currency', currency }).format(safeValue);
    } catch {
        return `R$ ${safeValue.toFixed(2)}`;
    }
}

function readCssVar(name, fallback) {
    try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
    } catch {
        return fallback;
    }
}

const dashboardBuilder = {
    chartsByWidgetId: new Map(),
    lastRenderKey: '',
    menuListenerAttached: false
};

function destroyChart(chart) {
    try {
        if (chart && typeof chart.destroy === 'function') chart.destroy();
    } catch {
        // no-op
    }
}

function destroyWidgetChart(widgetId) {
    const chart = dashboardBuilder.chartsByWidgetId.get(widgetId);
    if (chart) destroyChart(chart);
    dashboardBuilder.chartsByWidgetId.delete(widgetId);
}

function closeAllWidgetMenus() {
    document.querySelectorAll('.db-menu').forEach(m => m.classList.remove('open'));
}

function ensureDashboardMenuListeners() {
    if (dashboardBuilder.menuListenerAttached) return;
    dashboardBuilder.menuListenerAttached = true;

    document.addEventListener('click', () => closeAllWidgetMenus());
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllWidgetMenus();
    });
}

function setDashboardCompanyName() {
    const el = document.getElementById('dashboardCompanyName');
    if (!el) return;
    const name = (dataManager?.company?.name || '').toString().trim();
    el.textContent = name ? `Empresa: ${name}` : 'Empresa: (sem nome)';

    const compact = document.getElementById('dashboardCompanyNameCompact');
    if (compact) compact.textContent = name || 'Empresa';

    const logoUrl = (dataManager?.company?.logo || '').toString().trim();
    const logoImg = document.getElementById('dashboardLogo');
    const logoFallback = document.getElementById('dashboardLogoFallback');
    if (logoImg) {
        if (logoUrl) {
            logoImg.src = logoUrl;
            logoImg.style.display = 'block';
            if (logoFallback) logoFallback.style.display = 'none';
        } else {
            logoImg.style.display = 'none';
            if (logoFallback) logoFallback.style.display = 'block';
        }
    }
}

function ensureCompanyId() {
    if (!dataManager?.company) return null;
    if (dataManager.company.id) return dataManager.company.id;
    const id = `cmp_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    dataManager.saveCompany({ id });
    return id;
}

function getDashState() {
    const companyId = ensureCompanyId();
    if (!dataManager.ui.dashboardsByCompany) dataManager.ui.dashboardsByCompany = {};
    if (!dataManager.ui.dashboardsByCompany[companyId]) {
        dataManager.ui.dashboardsByCompany[companyId] = {
            activeDashboardId: null,
            dashboards: [],
            filters: { dateFrom: '', dateTo: '', budgetStatus: '' }
        };
        dataManager.saveData();
    }
    return dataManager.ui.dashboardsByCompany[companyId];
}

function saveDashState(state) {
    const companyId = ensureCompanyId();
    dataManager.ui.dashboardsByCompany[companyId] = state;
    dataManager.saveData();
}

function uid(prefix) {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function getDefaultDashboard() {
    const id = uid('db');
    return {
        id,
        name: 'Principal',
        widgets: [
            createWidgetFromTemplate('metric_total_revenue'),
            createWidgetFromTemplate('metric_avg_ticket'),
            createWidgetFromTemplate('metric_conversion_rate'),
            createWidgetFromTemplate('bar_revenue_by_month'),
            createWidgetFromTemplate('bar_revenue_by_product'),
            createWidgetFromTemplate('pie_budgets_by_status'),
            createWidgetFromTemplate('table_recent_budgets')
        ].map((w, idx) => ({ ...w, order: idx }))
    };
}

function ensureDashboards() {
    const state = getDashState();
    if (!Array.isArray(state.dashboards) || state.dashboards.length === 0) {
        const d = getDefaultDashboard();
        state.dashboards = [d];
        state.activeDashboardId = d.id;
        saveDashState(state);
    }
    if (!state.activeDashboardId && state.dashboards[0]) {
        state.activeDashboardId = state.dashboards[0].id;
        saveDashState(state);
    }
}

function getActiveDashboard() {
    ensureDashboards();
    const state = getDashState();
    return state.dashboards.find(d => d.id === state.activeDashboardId) || state.dashboards[0];
}

function setActiveDashboardId(id) {
    const state = getDashState();
    state.activeDashboardId = id;
    saveDashState(state);
}

function getDashboardFilters() {
    ensureDashboards();
    return getDashState().filters || { dateFrom: '', dateTo: '', budgetStatus: '' };
}

function setDashboardFilters(filters) {
    const state = getDashState();
    state.filters = { ...(state.filters || {}), ...filters };
    saveDashState(state);
}

function getMonthKey(dateStr) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function parseDateOnly(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function inDateRange(dateStr, filters) {
    const d = parseDateOnly(dateStr);
    if (!d) return false;
    const from = parseDateOnly(filters.dateFrom);
    const to = parseDateOnly(filters.dateTo);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
}

function filterBudgetsByDashboardFilters(budgets, filters) {
    const safeBudgets = Array.isArray(budgets) ? budgets : [];
    let out = safeBudgets.slice();
    if (filters.dateFrom || filters.dateTo) {
        out = out.filter(b => inDateRange(b.date, filters));
    }
    if (filters.budgetStatus) {
        out = out.filter(b => normalizeStatus(b.status) === filters.budgetStatus);
    }
    return out;
}

function selectDashboardFromUi() {
    const sel = document.getElementById('dashboardSelect');
    if (!sel) return;
    setActiveDashboardId(sel.value);
    renderDashboardBuilder(true);
}

function updateDashboardFiltersFromUi() {
    const dateFrom = document.getElementById('dbDateFrom')?.value || '';
    const dateTo = document.getElementById('dbDateTo')?.value || '';
    const budgetStatus = document.getElementById('dbBudgetStatus')?.value || '';
    setDashboardFilters({ dateFrom, dateTo, budgetStatus });
    renderDashboardBuilder(true);
}

function createDashboard() {
    ensureDashboards();
    const state = getDashState();
    const name = prompt('Nome do painel:', `Painel ${state.dashboards.length + 1}`);
    if (!name) return;
    const d = { id: uid('db'), name: name.trim(), widgets: [] };
    state.dashboards.push(d);
    state.activeDashboardId = d.id;
    saveDashState(state);
    renderDashboardBuilder(true);
}

function duplicateActiveDashboard() {
    ensureDashboards();
    const state = getDashState();
    const active = getActiveDashboard();
    const copy = {
        id: uid('db'),
        name: `${active.name} (copia)`,
        widgets: (active.widgets || []).map(w => ({ ...w, id: uid('w') }))
    };
    state.dashboards.push(copy);
    state.activeDashboardId = copy.id;
    saveDashState(state);
    renderDashboardBuilder(true);
}

function deleteActiveDashboard() {
    ensureDashboards();
    const state = getDashState();
    if (state.dashboards.length <= 1) {
        alert('Mantenha pelo menos 1 painel.');
        return;
    }
    const active = getActiveDashboard();
    if (!confirm(`Excluir o painel "${active.name}"?`)) return;
    state.dashboards = state.dashboards.filter(d => d.id !== active.id);
    state.activeDashboardId = state.dashboards[0].id;
    saveDashState(state);
    renderDashboardBuilder(true);
}

function createWidgetFromTemplate(templateKey) {
    const base = { id: uid('w'), order: 0, w: 6, h: 6, title: 'Widget', type: 'chart', spec: {} };
    switch (templateKey) {
        case 'metric_total_revenue':
            return { ...base, w: 3, h: 4, type: 'metric', title: 'Receita total', spec: { metric: 'total_revenue' } };
        case 'metric_avg_ticket':
            return { ...base, w: 3, h: 4, type: 'metric', title: 'Ticket medio', spec: { metric: 'avg_ticket' } };
        case 'metric_conversion_rate':
            return { ...base, w: 3, h: 4, type: 'metric', title: 'Conversao de orcamentos', spec: { metric: 'budget_conversion_rate' } };
        case 'bar_revenue_by_month':
            return { ...base, w: 6, h: 6, type: 'chart', title: 'Vendas por mes', spec: { chartType: 'bar', metric: 'revenue_by_month' } };
        case 'line_new_clients_by_month': // legacy
        case 'line_new_leads_by_month':
            return { ...base, w: 6, h: 6, type: 'chart', title: 'Novos leads', spec: { chartType: 'line', metric: 'new_leads_by_month' } };
        case 'pie_budgets_by_status':
            return { ...base, w: 6, h: 6, type: 'chart', title: 'Orcamentos por status', spec: { chartType: 'pie', metric: 'budgets_by_status' } };
        case 'bar_revenue_by_product':
            return { ...base, w: 6, h: 6, type: 'chart', title: 'Receita por produto', spec: { chartType: 'bar', metric: 'revenue_by_product' } };
        case 'table_recent_budgets':
            return { ...base, w: 12, h: 7, type: 'table', title: 'Orcamentos recentes', spec: { metric: 'recent_budgets' } };
        case 'ranking_top_products':
            return { ...base, w: 6, h: 7, type: 'ranking', title: 'Top produtos (receita)', spec: { metric: 'revenue_by_product', limit: 8 } };
        case 'funnel_budget_status':
            return { ...base, w: 6, h: 7, type: 'funnel', title: 'Funil de orcamentos', spec: { metric: 'budgets_by_status' } };
        default:
            return base;
    }
}

function addWidgetFromTemplate() {
    const templateKey = document.getElementById('dbWidgetTemplate')?.value;
    if (!templateKey) return;
    const dash = getActiveDashboard();
    const widgets = Array.isArray(dash.widgets) ? dash.widgets : [];
    const nextOrder = widgets.length ? Math.max(...widgets.map(w => w.order || 0)) + 1 : 0;
    const widget = { ...createWidgetFromTemplate(templateKey), order: nextOrder };
    dash.widgets = widgets.concat(widget);

    const state = getDashState();
    state.dashboards = state.dashboards.map(d => d.id === dash.id ? dash : d);
    saveDashState(state);
    renderDashboardBuilder(true);
}

function closeDashboardModal() {
    const b = document.getElementById('dashboardModalBackdrop');
    const m = document.getElementById('dashboardModal');
    if (b) b.style.display = 'none';
    if (m) m.style.display = 'none';
}

function openDashboardModal(title, bodyHtml) {
    const b = document.getElementById('dashboardModalBackdrop');
    const m = document.getElementById('dashboardModal');
    const t = document.getElementById('dashboardModalTitle');
    const body = document.getElementById('dashboardModalBody');
    if (t) t.textContent = title;
    if (body) body.innerHTML = bodyHtml;
    if (b) b.style.display = 'block';
    if (m) m.style.display = 'block';
}

function getBudgetsFilteredForDashboard() {
    try {
        const filters = getDashboardFilters();
        const budgets = Array.isArray(dataManager.budgets) ? dataManager.budgets : [];
        return filterBudgetsByDashboardFilters(budgets, filters);
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('getBudgetsFilteredForDashboard failed', err);
        return [];
    }
}

function computeMetric(metricKey) {
    try {
        const budgets = getBudgetsFilteredForDashboard();
        const safeBudgets = Array.isArray(budgets) ? budgets : [];
        switch (metricKey) {
            case 'total_revenue': {
                const sum = safeBudgets.reduce((acc, b) => acc + (Number(b.total) || 0), 0);
                return { value: sum, display: formatMoney(sum), note: `${safeBudgets.length} orcamentos no periodo` };
            }
            case 'avg_ticket': {
                const total = safeBudgets.length;
                const sum = safeBudgets.reduce((acc, b) => acc + (Number(b.total) || 0), 0);
                const avg = total ? (sum / total) : 0;
                return { value: avg, display: formatMoney(avg), note: total ? `media em ${total} orcamentos` : 'sem orcamentos no periodo' };
            }
            case 'budget_conversion_rate': {
                const total = safeBudgets.length;
                const approved = safeBudgets.filter(b => normalizeStatus(b.status) === 'Aprovado').length;
                const rate = total ? (approved / total) : 0;
                return { value: rate, display: `${Math.round(rate * 100)}%`, note: `${approved}/${total} aprovados` };
            }
            default:
                return { value: 0, display: '0', note: '' };
        }
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('computeMetric failed', { metricKey }, err);
        return { value: 0, display: '-', note: 'erro' };
    }
}

function computeSeries(metricKey) {
    let filters = { dateFrom: '', dateTo: '', budgetStatus: '' };
    let budgets = [];
    try {
        filters = getDashboardFilters();
        budgets = getBudgetsFilteredForDashboard();
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('computeSeries failed (init)', { metricKey }, err);
        filters = { dateFrom: '', dateTo: '', budgetStatus: '' };
        budgets = [];
    }
    const safeBudgets = Array.isArray(budgets) ? budgets : [];

    if (metricKey === 'revenue_by_month') {
        const monthly = new Map();
        safeBudgets.forEach(b => {
            const key = getMonthKey(b.date);
            if (!key) return;
            monthly.set(key, (monthly.get(key) || 0) + (Number(b.total) || 0));
        });
        const labels = Array.from(monthly.keys()).sort();
        const data = labels.map(l => monthly.get(l) || 0);
        return { labels, data, kind: 'money', filters };
    }

    if (metricKey === 'new_clients_by_month' || metricKey === 'new_leads_by_month') {
        // Approx: use id timestamp as createdAt if not present.
        const monthly = new Map();
        (dataManager.leads || []).forEach(l => {
            const d = l.createdAt ? l.createdAt : (l.id ? new Date(l.id).toISOString().slice(0, 10) : '');
            if ((filters.dateFrom || filters.dateTo) && !inDateRange(d, filters)) return;
            const key = getMonthKey(d);
            if (!key) return;
            monthly.set(key, (monthly.get(key) || 0) + 1);
        });
        const labels = Array.from(monthly.keys()).sort();
        const data = labels.map(l => monthly.get(l) || 0);
        return { labels, data, kind: 'count', filters };
    }

    if (metricKey === 'budgets_by_status') {
        const order = ['Rascunho', 'Enviado', 'Aprovado', 'Rejeitado'];
        const counts = new Map(order.map(s => [s, 0]));
        safeBudgets.forEach(b => {
            const s = normalizeStatus(b.status) || 'Rascunho';
            counts.set(s, (counts.get(s) || 0) + 1);
        });
        const labels = order;
        const data = labels.map(l => counts.get(l) || 0);
        return { labels, data, kind: 'count', filters };
    }

    if (metricKey === 'revenue_by_product') {
        const byProduct = new Map();
        safeBudgets.forEach(b => {
            (b.productQuantities || []).forEach(pq => {
                const product = (dataManager.products || []).find(p => p.id === pq.id);
                if (!product) return;
                const amount = (Number(product.price) || 0) * (Number(pq.qty) || 0);
                const name = product.name || 'Produto';
                byProduct.set(name, (byProduct.get(name) || 0) + amount);
            });
        });
        const labels = Array.from(byProduct.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]);
        const data = labels.map(l => byProduct.get(l) || 0);
        return { labels, data, kind: 'money', filters };
    }

    return { labels: [], data: [], kind: 'count', filters };
}

function renderWidget(widget) {
    const span = Math.max(1, Math.min(12, Number(widget.w) || 6));
    const height = Math.max(3, Number(widget.h) || 6);

    const el = document.createElement('div');
    el.className = 'db-widget';
    el.style.gridColumn = `span ${span}`;
    el.style.minHeight = `${height * 36}px`;
    el.draggable = true;
    el.dataset.widgetId = widget.id;

    const header = document.createElement('div');
    header.className = 'db-widget-header';
    header.title = 'Duplo clique para editar o widget';
    header.addEventListener('dblclick', () => openWidgetEditor(widget.id));

    const title = document.createElement('div');
    title.className = 'db-widget-title';
    title.textContent = widget.title || 'Widget';

    const actions = document.createElement('div');
    actions.className = 'db-widget-actions';

    const menuBtn = document.createElement('button');
    menuBtn.className = 'db-icon-btn';
    menuBtn.type = 'button';
    menuBtn.setAttribute('aria-label', 'Editar widget');
    menuBtn.title = 'Editar';
    menuBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="currentColor"/>
          <path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/>
        </svg>
    `;

    const menu = document.createElement('div');
    menu.className = 'db-menu';
    menu.innerHTML = `
        <button type="button" class="db-menu-item" data-action="up">Subir</button>
        <button type="button" class="db-menu-item" data-action="down">Descer</button>
        <button type="button" class="db-menu-item db-menu-danger" data-action="remove">Remover</button>
    `;

    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = menu.classList.contains('open');
        closeAllWidgetMenus();
        if (!isOpen) menu.classList.add('open');
    });

    menu.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.dataset.action;
        closeAllWidgetMenus();
        if (action === 'up') reorderWidget(widget.id, -1);
        if (action === 'down') reorderWidget(widget.id, +1);
        if (action === 'remove') removeWidget(widget.id);
    });

    actions.appendChild(menuBtn);
    actions.appendChild(menu);

    header.appendChild(title);
    header.appendChild(actions);

    const body = document.createElement('div');
    body.className = 'db-widget-body';

    const spec = widget.spec && typeof widget.spec === 'object' ? widget.spec : {};

    if (widget.type === 'metric') {
        const m = computeMetric(spec.metric);
        body.innerHTML = `<div class="db-metric">${m.display}</div><div class="db-subtle">${m.note || ''}</div>`;
    } else if (widget.type === 'table') {
        const budgets = getBudgetsFilteredForDashboard().slice().sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 10);
        body.innerHTML = `
            <table class="db-table">
                <thead><tr><th>ID</th><th>Data</th><th>Status</th><th>Total</th></tr></thead>
                <tbody>
                    ${budgets.map(b => `<tr>
                        <td>${b.id}</td>
                        <td>${b.date}</td>
                        <td>${normalizeStatus(b.status)}</td>
                        <td>${formatMoney(b.total)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            <div class="db-subtle">Clique em um grafico para filtrar ou ver detalhes.</div>
        `;
    } else if (widget.type === 'ranking') {
        const series = computeSeries(spec.metric);
        const limit = spec.limit || 8;
        body.innerHTML = `
            <table class="db-table">
                <thead><tr><th>#</th><th>Item</th><th>Valor</th></tr></thead>
                <tbody>
                    ${series.labels.slice(0, limit).map((l, i) => `<tr>
                        <td>${i + 1}</td>
                        <td>${l}</td>
                        <td>${formatMoney(series.data[i])}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        `;
    } else if (widget.type === 'funnel') {
        const series = computeSeries(spec.metric);
        body.innerHTML = `
            <table class="db-table">
                <thead><tr><th>Etapa</th><th>Qtd</th></tr></thead>
                <tbody>
                    ${series.labels.map((l, i) => `<tr><td>${l}</td><td>${series.data[i]}</td></tr>`).join('')}
                </tbody>
            </table>
            <div class="db-subtle">Use o filtro global de status para segmentar.</div>
        `;
    } else {
        const canvasId = `wcanvas_${widget.id}`;
        body.innerHTML = `<canvas id="${canvasId}" height="140"></canvas>`;
        scheduleWidgetChartRender(widget, canvasId);
    }

    el.appendChild(header);
    el.appendChild(body);

    el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', widget.id);
    });
    el.addEventListener('dragover', (e) => e.preventDefault());
    el.addEventListener('drop', (e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('text/plain');
        if (draggedId && draggedId !== widget.id) swapWidgetOrder(draggedId, widget.id);
    });

    return el;
}

let editingWidgetId = null;

function openWidgetEditor(widgetId) {
    const dash = getActiveDashboard();
    const widget = (dash.widgets || []).find(w => w.id === widgetId);
    if (!widget) return;

    editingWidgetId = widgetId;

    const w = Math.max(1, Math.min(12, Number(widget.w) || 6));
    const h = Math.max(3, Number(widget.h) || 6);
    const title = (widget.title || '').toString();
    const type = widget.type || 'chart';

    const metricOptions = {
        metric: [
            { v: 'total_revenue', t: 'Receita total' },
            { v: 'avg_ticket', t: 'Ticket medio' },
            { v: 'budget_conversion_rate', t: 'Conversao de orcamentos' }
        ],
        chart: [
            { v: 'revenue_by_month', t: 'Vendas por mes' },
            { v: 'new_leads_by_month', t: 'Novos leads por mes' },
            { v: 'budgets_by_status', t: 'Orcamentos por status' },
            { v: 'revenue_by_product', t: 'Receita por produto' }
        ]
    };

    const chartType = widget.spec?.chartType || 'bar';
    const metric = widget.spec?.metric || (type === 'metric' ? 'total_revenue' : 'revenue_by_month');
    const limit = Number(widget.spec?.limit) || 8;

    const body = `
        <div class="db-form">
            <div class="form-group">
                <label>Titulo</label>
                <input type="text" id="weTitle" value="${title.replace(/"/g, '&quot;')}">
            </div>
            <div class="form-group">
                <label>Tipo</label>
                <select id="weType" onchange="renderWidgetEditorFields()">
                    <option value="chart" ${type === 'chart' ? 'selected' : ''}>Grafico</option>
                    <option value="metric" ${type === 'metric' ? 'selected' : ''}>Contador</option>
                    <option value="table" ${type === 'table' ? 'selected' : ''}>Tabela</option>
                    <option value="ranking" ${type === 'ranking' ? 'selected' : ''}>Ranking</option>
                    <option value="funnel" ${type === 'funnel' ? 'selected' : ''}>Funil</option>
                </select>
            </div>
            <div class="form-group">
                <label>Largura (1-12)</label>
                <input type="number" id="weW" min="1" max="12" value="${w}">
            </div>
            <div class="form-group">
                <label>Altura (unidades)</label>
                <input type="number" id="weH" min="3" max="20" value="${h}">
            </div>
        </div>
        <div id="weDynamic"></div>
        <div style="margin-top: 10px; display:flex; gap:10px; flex-wrap:wrap;">
            <button class="db-btn" type="button" onclick="saveWidgetEditor()">Salvar</button>
            <button class="db-btn db-danger" type="button" onclick="closeDashboardModal()">Cancelar</button>
        </div>
    `;

    openDashboardModal('Editar widget', body);

    // Store defaults for dynamic fields
    window.__we = { chartType, metric, limit, metricOptions };
    renderWidgetEditorFields();
}

function renderWidgetEditorFields() {
    const type = document.getElementById('weType')?.value || 'chart';
    const dynamic = document.getElementById('weDynamic');
    if (!dynamic) return;

    const { chartType, metric, limit, metricOptions } = window.__we || {};

    if (type === 'chart') {
        dynamic.innerHTML = `
            <div class="db-form" style="margin-top: 10px;">
                <div class="form-group">
                    <label>Tipo de grafico</label>
                    <select id="weChartType">
                        <option value="bar" ${chartType === 'bar' ? 'selected' : ''}>Barras</option>
                        <option value="line" ${chartType === 'line' ? 'selected' : ''}>Linha</option>
                        <option value="area" ${chartType === 'area' ? 'selected' : ''}>Area</option>
                        <option value="pie" ${chartType === 'pie' ? 'selected' : ''}>Pizza</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Metrica</label>
                    <select id="weMetric">
                        ${(metricOptions?.chart || []).map(o => `<option value="${o.v}" ${metric === o.v ? 'selected' : ''}>${o.t}</option>`).join('')}
                    </select>
                </div>
            </div>
        `;
        return;
    }

    if (type === 'metric') {
        dynamic.innerHTML = `
            <div class="db-form" style="margin-top: 10px;">
                <div class="form-group">
                    <label>Metrica</label>
                    <select id="weMetric">
                        ${(metricOptions?.metric || []).map(o => `<option value="${o.v}" ${metric === o.v ? 'selected' : ''}>${o.t}</option>`).join('')}
                    </select>
                </div>
            </div>
        `;
        return;
    }

    if (type === 'ranking') {
        dynamic.innerHTML = `
            <div class="db-form" style="margin-top: 10px;">
                <div class="form-group">
                    <label>Metrica</label>
                    <select id="weMetric">
                        <option value="revenue_by_product" selected>Receita por produto</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Limite</label>
                    <input type="number" id="weLimit" min="3" max="50" value="${limit || 8}">
                </div>
            </div>
        `;
        return;
    }

    if (type === 'funnel') {
        dynamic.innerHTML = `
            <div class="db-form" style="margin-top: 10px;">
                <div class="form-group">
                    <label>Metrica</label>
                    <select id="weMetric">
                        <option value="budgets_by_status" selected>Orcamentos por status</option>
                    </select>
                </div>
            </div>
        `;
        return;
    }

    // table
    dynamic.innerHTML = `
        <div class="db-form" style="margin-top: 10px;">
            <div class="form-group">
                <label>Tabela</label>
                <select id="weMetric">
                    <option value="recent_budgets" selected>Orcamentos recentes</option>
                </select>
            </div>
        </div>
    `;
}

function saveWidgetEditor() {
    const dash = getActiveDashboard();
    const widget = (dash.widgets || []).find(w => w.id === editingWidgetId);
    if (!widget) return;

    const title = document.getElementById('weTitle')?.value?.trim() || widget.title;
    const type = document.getElementById('weType')?.value || widget.type;
    const w = Math.max(1, Math.min(12, Number(document.getElementById('weW')?.value) || 6));
    const h = Math.max(3, Number(document.getElementById('weH')?.value) || 6);

    const metric = document.getElementById('weMetric')?.value || widget.spec?.metric;
    const chartType = document.getElementById('weChartType')?.value || widget.spec?.chartType;
    const limit = Number(document.getElementById('weLimit')?.value) || widget.spec?.limit || 8;

    widget.title = title;
    widget.type = type;
    widget.w = w;
    widget.h = h;

    widget.spec = widget.spec || {};
    widget.spec.metric = metric;
    if (type === 'chart') widget.spec.chartType = chartType || 'bar';
    if (type === 'ranking') widget.spec.limit = limit;

    const state = getDashState();
    state.dashboards = state.dashboards.map(d => d.id === dash.id ? dash : d);
    saveDashState(state);

    closeDashboardModal();
    renderDashboardBuilder(true);
}

function renderWidgetChart(widget, canvasId) {
    if (!window.Chart) return;

    const themeText = readCssVar('--text-secondary', 'rgba(255,255,255,0.82)');
    const themeBorder = readCssVar('--border', 'rgba(255,255,255,0.12)');
    const accent = readCssVar('--accent', '#3B82F6');
    const accent2 = readCssVar('--accent-2', '#22C55E');
    const warning = readCssVar('--warning', '#F59E0B');
    const danger = readCssVar('--danger', '#EF4444');

    // Theme defaults (safe to set multiple times).
    try {
        Chart.defaults.color = themeText;
        Chart.defaults.borderColor = themeBorder;
        if (Chart.defaults.plugins?.legend?.labels) Chart.defaults.plugins.legend.labels.color = themeText;
    } catch {
        // no-op
    }

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    destroyWidgetChart(widget.id);

    const series = computeSeries(widget.spec.metric);
    const chartType = widget.spec.chartType || 'bar';

    const piePalette = [
        accent,
        accent2,
        warning,
        danger,
        '#8B5CF6', // violet
        '#06B6D4', // cyan
        '#F97316'  // orange
    ];

    const config = {
        type: chartType === 'area' ? 'line' : chartType,
        data: {
            labels: series.labels,
            datasets: [{
                label: widget.title || 'Serie',
                data: series.data,
                backgroundColor: chartType === 'pie' ? piePalette : `${accent}55`,
                borderColor: accent,
                fill: chartType === 'area',
                tension: chartType === 'line' || chartType === 'area' ? 0.35 : 0
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: chartType === 'pie' }
            },
            onClick: (_, elements) => {
                if (!elements || !elements.length) return;
                const index = elements[0].index;
                const label = series.labels[index];
                handleWidgetClick(widget, label);
            }
        }
    };

    if (series.kind === 'money' && chartType !== 'pie') {
        config.options.scales = {
            y: {
                grid: { color: 'rgba(51,65,85,0.55)' },
                ticks: { callback: (value) => formatMoney(value), color: themeText }
            },
            x: {
                grid: { color: 'rgba(51,65,85,0.35)' },
                ticks: { color: themeText }
            }
        };
    } else if (chartType !== 'pie') {
        config.options.scales = {
            y: {
                grid: { color: 'rgba(51,65,85,0.55)' },
                ticks: { color: themeText }
            },
            x: {
                grid: { color: 'rgba(51,65,85,0.35)' },
                ticks: { color: themeText }
            }
        };
    }

    const chart = new Chart(canvas, config);
    dashboardBuilder.chartsByWidgetId.set(widget.id, chart);
}

function scheduleWidgetChartRender(widget, canvasId) {
    const run = () => {
        try {
            renderWidgetChart(widget, canvasId);
        } catch (err) {
            const canvas = document.getElementById(canvasId);
            const host = canvas?.closest('.db-widget-body');
            if (host) {
                host.innerHTML = `<div class="db-subtle">Erro ao renderizar grafico. Verifique o carregamento do Chart.js.</div>`;
            }
            // eslint-disable-next-line no-console
            console.error('Dashboard chart render failed', err);
        }
    };

    // Ensure the widget is attached and has layout before initializing Chart.js.
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(run));
        return;
    }

    if (typeof queueMicrotask === 'function') {
        queueMicrotask(run);
        return;
    }

    setTimeout(run, 0);
}

function handleWidgetClick(widget, label) {
    if (widget.spec.metric === 'revenue_by_month' || widget.spec.metric === 'new_clients_by_month' || widget.spec.metric === 'new_leads_by_month') {
        // Drilldown by month
        const filters = getDashboardFilters();
        const month = label;
        const budgets = getBudgetsFilteredForDashboard().filter(b => getMonthKey(b.date) === month);
        openDashboardModal(`Detalhes: ${month}`, `
            <div class="db-subtle">Orcamentos no mes: ${budgets.length}</div>
            <table class="db-table">
                <thead><tr><th>ID</th><th>Data</th><th>Status</th><th>Total</th></tr></thead>
                <tbody>
                    ${budgets.slice(0, 100).map(b => `<tr>
                        <td>${b.id}</td>
                        <td>${b.date}</td>
                        <td>${normalizeStatus(b.status)}</td>
                        <td>${formatMoney(b.total)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        `);
        return;
    }

    if (widget.spec.metric === 'budgets_by_status') {
        setDashboardFilters({ budgetStatus: label });
        const statusSel = document.getElementById('dbBudgetStatus');
        if (statusSel) statusSel.value = label;
        renderDashboardBuilder(true);
        return;
    }
}

function reorderWidget(widgetId, delta) {
    const dash = getActiveDashboard();
    const widgets = (dash.widgets || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const idx = widgets.findIndex(w => w.id === widgetId);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= widgets.length) return;
    const a = widgets[idx];
    const b = widgets[target];
    const tmp = a.order;
    a.order = b.order;
    b.order = tmp;

    dash.widgets = widgets;
    const state = getDashState();
    state.dashboards = state.dashboards.map(d => d.id === dash.id ? dash : d);
    saveDashState(state);
    renderDashboardBuilder(true);
}

function swapWidgetOrder(widgetIdA, widgetIdB) {
    const dash = getActiveDashboard();
    const widgets = dash.widgets || [];
    const a = widgets.find(w => w.id === widgetIdA);
    const b = widgets.find(w => w.id === widgetIdB);
    if (!a || !b) return;
    const tmp = a.order;
    a.order = b.order;
    b.order = tmp;
    const state = getDashState();
    state.dashboards = state.dashboards.map(d => d.id === dash.id ? dash : d);
    saveDashState(state);
    renderDashboardBuilder(true);
}

function removeWidget(widgetId) {
    const dash = getActiveDashboard();
    if (!confirm('Remover este widget?')) return;
    dash.widgets = (dash.widgets || []).filter(w => w.id !== widgetId);
    destroyWidgetChart(widgetId);

    const state = getDashState();
    state.dashboards = state.dashboards.map(d => d.id === dash.id ? dash : d);
    saveDashState(state);
    renderDashboardBuilder(true);
}

function renderDashboardBuilder(force = false) {
    ensureDashboards();

    const state = getDashState();
    const active = getActiveDashboard();
    const filters = getDashboardFilters();

    const renderKey = JSON.stringify({
        activeId: state.activeDashboardId,
        dashboardsCount: state.dashboards.length,
        widgetsCount: active.widgets?.length || 0,
        filters,
        leadsCount: dataManager.leads?.length || 0,
        budgetsCount: dataManager.budgets?.length || 0,
        productsCount: dataManager.products?.length || 0
    });

    if (!force && dashboardBuilder.lastRenderKey === renderKey) return;
    dashboardBuilder.lastRenderKey = renderKey;

    const sel = document.getElementById('dashboardSelect');
    if (sel) {
        sel.innerHTML = state.dashboards.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
        sel.value = active.id;
    }

    const dateFromEl = document.getElementById('dbDateFrom');
    const dateToEl = document.getElementById('dbDateTo');
    const statusEl = document.getElementById('dbBudgetStatus');
    if (dateFromEl) dateFromEl.value = filters.dateFrom || '';
    if (dateToEl) dateToEl.value = filters.dateTo || '';
    if (statusEl) statusEl.value = filters.budgetStatus || '';

    const grid = document.getElementById('dashboardGrid');
    if (!grid) return;

    ensureDashboardMenuListeners();

    // Clean old widget charts
    Array.from(dashboardBuilder.chartsByWidgetId.keys()).forEach(id => destroyWidgetChart(id));

    const widgets = (active.widgets || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    grid.innerHTML = '';
    if (!window.Chart) {
        const warn = document.createElement('div');
        warn.className = 'db-subtle';
        warn.textContent = 'Chart.js nao carregou. Graficos podem nao aparecer.';
        grid.appendChild(warn);
    }
    widgets.forEach(w => {
        try {
            grid.appendChild(renderWidget(w));
        } catch (err) {
            const fallback = document.createElement('div');
            fallback.className = 'db-widget';
            fallback.style.gridColumn = 'span 6';
            fallback.innerHTML = `
                <div class="db-widget-header"><div class="db-widget-title">Widget com erro</div></div>
                <div class="db-widget-body"><div class="db-subtle">Nao foi possivel renderizar este widget.</div></div>
            `;
            grid.appendChild(fallback);
            // eslint-disable-next-line no-console
            console.error('Widget render failed', err, w);
        }
    });
}

function showSignup() {
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('signupView').style.display = 'block';
}

function showLogin() {
    document.getElementById('signupView').style.display = 'none';
    document.getElementById('loginView').style.display = 'block';
}

function loadUsers() {
    try {
        const raw = localStorage.getItem(AUTH_STORAGE_KEY_USERS);
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveUsers(users) {
    localStorage.setItem(AUTH_STORAGE_KEY_USERS, JSON.stringify(Array.isArray(users) ? users : []));
}

function getSession() {
    try {
        return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY_SESSION) || 'null');
    } catch {
        return null;
    }
}

function setSession(session) {
    const safe = {
        sessionId: `sess_${Math.random().toString(36).slice(2)}_${Date.now()}`,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
        ...session
    };
    localStorage.setItem(AUTH_STORAGE_KEY_SESSION, JSON.stringify(safe));
}

function clearSession() {
    localStorage.removeItem(AUTH_STORAGE_KEY_SESSION);
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password) {
    return typeof password === 'string' && password.length >= 6;
}

function sanitizeInput(value) {
    return String(value || '').replace(/[<>"'`\/]/g, '');
}

async function sha256Hex(text) {
    if (!window.crypto?.subtle) return null;
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password) {
    const hex = await sha256Hex(password);
    return hex ? `sha256:${hex}` : `plain:${password}`;
}

async function verifyPassword(password, stored) {
    if (!stored) return false;
    if (stored.startsWith('sha256:')) {
        const hex = await sha256Hex(password);
        return stored === `sha256:${hex}`;
    }
    if (stored.startsWith('plain:')) return stored === `plain:${password}`;
    return false;
}

function enterApp() {
    showLoadingOverlay('Carregando CRM...');
    document.getElementById('loginContainer').style.display = 'none';
    document.getElementById('appContainer').style.display = 'flex';

    // Defer heavy initialization to allow the overlay to paint.
    requestAnimationFrame(() => {
        try {
            dataManager.loadData();
            initializeApp();
        } finally {
            hideLoadingOverlay();
        }
    });
}

function leaveApp() {
    document.getElementById('loginContainer').style.display = 'flex';
    document.getElementById('appContainer').style.display = 'none';
    showLogin();

    const loginEmail = document.getElementById('loginEmail');
    const loginPassword = document.getElementById('loginPassword');
    if (loginEmail) loginEmail.value = '';
    if (loginPassword) loginPassword.value = '';

    const signupName = document.getElementById('signupName');
    const signupEmail = document.getElementById('signupEmail');
    const signupPassword = document.getElementById('signupPassword');
    if (signupName) signupName.value = '';
    if (signupEmail) signupEmail.value = '';
    if (signupPassword) signupPassword.value = '';
}

const AUTH_MAX_FAILED_ATTEMPTS = 5;
const AUTH_LOCK_MINUTES = 15;

function generateLockKey(email) {
    return `crm_lock_${email}`;
}

function getLockInfo(email) {
    try {
        return JSON.parse(localStorage.getItem(generateLockKey(email)) || 'null');
    } catch {
        return null;
    }
}

function setLockInfo(email, info) {
    localStorage.setItem(generateLockKey(email), JSON.stringify(info));
}

function clearLockInfo(email) {
    localStorage.removeItem(generateLockKey(email));
}

function isLockedOut(email) {
    const info = getLockInfo(email);
    if (!info || !info.lockedAt) return false;
    const lockedAt = new Date(info.lockedAt).getTime();
    const expiresAt = lockedAt + AUTH_LOCK_MINUTES * 60 * 1000;
    if (Date.now() > expiresAt) {
        clearLockInfo(email);
        return false;
    }
    return true;
}

async function signup() {
    const name = sanitizeInput(document.getElementById('signupName').value.trim());
    const email = sanitizeInput(document.getElementById('signupEmail').value.trim().toLowerCase());
    const password = document.getElementById('signupPassword').value;

    if (!name) return alert('Informe seu nome.');
    if (!email || !isValidEmail(email)) return alert('Informe um email valido.');
    if (!isValidPassword(password)) return alert('Senha fraca: use 6+ caracteres.');

    const users = loadUsers();
    const existing = users.find(u => u.email === email);
    if (existing) return alert('Este email ja esta cadastrado. Faca login.');

    const passwordHash = await hashPassword(password);
    const user = {
        id: `user_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name,
        email,
        provider: 'local',
        passwordHash,
        createdAt: new Date().toISOString()
    };

    users.push(user);
    saveUsers(users);
    clearLockInfo(email);
    setSession({ userId: user.id, email: user.email, provider: user.provider, loggedInAt: new Date().toISOString() });
    console.log('[CRM] signup success', email);
    enterApp();
}

async function login() {
    const email = sanitizeInput(document.getElementById('loginEmail').value.trim().toLowerCase());
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) return alert('Informe email e senha.');
    if (!isValidEmail(email)) return alert('Email invalido.');
    if (isLockedOut(email)) {
        return alert('Conta bloqueada temporariamente devido a tentativas falhas. Tente novamente mais tarde.');
    }

    const users = loadUsers();
    const user = users.find(u => u.email === email);
    if (!user) {
        return alert('Conta nao encontrada. Crie uma conta.');
    }
    if (user.provider === 'google') {
        return alert('Esta conta usa Google. Entre com o botao "Entrar com Google".');
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
        const info = getLockInfo(email) || { failedAttempts: 0 };
        info.failedAttempts = (info.failedAttempts || 0) + 1;
        if (info.failedAttempts >= AUTH_MAX_FAILED_ATTEMPTS) {
            info.lockedAt = new Date().toISOString();
        }
        setLockInfo(email, info);
        console.warn('[CRM] login failed:', email, 'attempts', info.failedAttempts);
        return alert('Email ou senha invalidos. Tente novamente.');
    }

    clearLockInfo(email);
    setSession({ userId: user.id, email: user.email, provider: user.provider, loggedInAt: new Date().toISOString() });
    console.log('[CRM] login success', email);
    enterApp();
}

function logout() {
    clearSession();
    leaveApp();
}

const AUTH_SESSION_TIMEOUT_MINUTES = 30;
let authInactivityTimer = null;

function isSessionValid(session) {
    if (!session || typeof session !== 'object') return false;
    if (!session.userId || !session.email) return false;
    if (!session.expiresAt) return false;
    const expires = Date.parse(session.expiresAt);
    if (Number.isNaN(expires)) return false;
    return Date.now() < expires;
}

function refreshSessionTimeout() {
    const session = getSession();
    if (!isSessionValid(session)) return;
    const newExpire = new Date(Date.now() + AUTH_SESSION_TIMEOUT_MINUTES * 60 * 1000).toISOString();
    setSession({ ...session, expiresAt: newExpire });
}

function scheduleAutoLogout() {
    if (authInactivityTimer) clearTimeout(authInactivityTimer);
    authInactivityTimer = setTimeout(() => {
        alert('Sessão expirada por inatividade. Faça login novamente.');
        logout();
    }, AUTH_SESSION_TIMEOUT_MINUTES * 60 * 1000);
}

function resetAutoLogout() {
    refreshSessionTimeout();
    scheduleAutoLogout();
}

function enforceSecureContext() {
    if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && !window.location.hostname.startsWith('127.')) {
        const login = document.getElementById('loginContainer');
        if (login) login.innerHTML = '<div style="padding:24px;background:#fff;color:#000;border-radius:8px;max-width:560px;margin:40px auto;font-family:inherit;">Conexão não segura detectada. Use HTTPS para acessar este sistema com segurança.</div>';
        const app = document.getElementById('appContainer');
        if (app) app.style.display = 'none';
        return false;
    }
    return true;
}

function initAppEventListeners() {
    const customFieldTypeEl = document.getElementById('customFieldType');
    if (customFieldTypeEl) {
        customFieldTypeEl.addEventListener('change', toggleCustomFieldOptions);
    }

    document.addEventListener('change', function(e) {
        if (!e.target || !e.target.id) return;
        if (['budgetDiscount', 'budgetTaxes'].includes(e.target.id)) {
            calculateBudgetTotal();
        }
    });
}

function initSecurity() {
    enforceSecureContext();

    document.addEventListener('mousemove', resetAutoLogout);
    document.addEventListener('keydown', resetAutoLogout);
    document.addEventListener('click', resetAutoLogout);
    document.addEventListener('touchstart', resetAutoLogout);

    const session = getSession();
    if (isSessionValid(session)) {
        enterApp();
        refreshSessionTimeout();
        scheduleAutoLogout();
    } else {
        clearSession();
        leaveApp();
    }
}

window.addEventListener('load', () => {
    try {
        initSecurity();
        initAppEventListeners();
        console.log('[CRM] Security initialized. Session:', getSession());
    } catch (err) {
        console.error('[CRM] initSecurity failed:', err);
    }
});

function decodeJwtPayload(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
            atob(base64)
                .split('')
                .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                .join('')
        );
        return JSON.parse(jsonPayload);
    } catch {
        return null;
    }
}

function ensureGoogleAuth() {
    if (!GOOGLE_CLIENT_ID) {
        alert('Google login nao configurado. Defina GOOGLE_CLIENT_ID no app.js.');
        return false;
    }
    if (!window.google?.accounts?.id) {
        alert('Biblioteca do Google nao carregou. Verifique sua internet e tente novamente.');
        return false;
    }
    if (!googleAuthInitialized) {
        google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleGoogleCredentialResponse
        });
        googleAuthInitialized = true;
    }
    return true;
}

function loginWithGoogle() {
    if (!GOOGLE_CLIENT_ID) {
        alert('Entrar com Google não está configurado. Defina GOOGLE_CLIENT_ID em app.js.');
        return;
    }
    if (!ensureGoogleAuth()) return;
    google.accounts.id.prompt();
}

function handleGoogleCredentialResponse(response) {
    const payload = decodeJwtPayload(response?.credential || '');
    const email = (payload?.email || '').toLowerCase();
    const name = payload?.name || payload?.given_name || '';
    const sub = payload?.sub || '';

    if (!email) return alert('Nao foi possivel obter o email do Google. Confira as permissoes.');

    const users = loadUsers();
    const existing = users.find(u => u.email === email);

    if (existing && existing.provider === 'local') {
        return alert('Este email ja esta cadastrado com senha. Faça login com email e senha.');
    }

    let user = existing;
    if (!user) {
        user = {
            id: Date.now(),
            name: name || email.split('@')[0],
            email,
            provider: 'google',
            googleSub: sub,
            createdAt: new Date().toISOString()
        };
        users.push(user);
        saveUsers(users);
    }

    setSession({ userId: user.id, email: user.email, provider: user.provider, loggedInAt: new Date().toISOString() });
    enterApp();
}

function getDefaultModules() {
    return [
        { id: 'dashboard', label: 'Painel', enabled: true, locked: true },
        { id: 'company', label: 'Perfil da Empresa', enabled: true, locked: false },
        { id: 'leads', label: 'Leads', enabled: true, locked: false },
        { id: 'products', label: 'Produtos', enabled: true, locked: false },
        { id: 'budgets', label: 'Orcamentos', enabled: true, locked: false },
        { id: 'whatsapp', label: 'Campanhas WhatsApp', enabled: true, locked: false },
        { id: 'campaigns', label: 'Dashboard Campanhas', enabled: true, locked: false },
        { id: 'settings', label: 'Configuracoes', enabled: true, locked: true }
    ];
}

function getDefaultEntityTabConfigs() {
    return {
        leads: {
            fields: {
                name: { label: 'Nome', enabled: true, required: true, showInTable: true, locked: true },
                phone: { label: 'Telefone', enabled: true, required: false, showInTable: true },
                source: { label: 'Origem', enabled: true, required: false, showInTable: true },
                campaign: { label: 'Campanha', enabled: true, required: false, showInTable: true },
                interest: { label: 'Interesse', enabled: true, required: false, showInTable: false },
                status: { label: 'Status', enabled: true, required: false, showInTable: true },
                conversationStatus: { label: 'Conversa', enabled: true, required: false, showInTable: true },
                classification: { label: 'Classificacao', enabled: true, required: false, showInTable: true },
                notes: { label: 'Observacoes', enabled: true, required: false, showInTable: false },
                content: { label: 'Conteudo', enabled: true, required: false, showInTable: false }
            }
        },
        products: {
            defaults: { status: 'Ativo' },
            fields: {
                name: { label: 'Nome', enabled: true, required: true, showInTable: true, locked: true },
                code: { label: 'Codigo', enabled: true, required: false, showInTable: true },
                category: { label: 'Categoria', enabled: true, required: false, showInTable: true },
                description: { label: 'Descricao', enabled: true, required: false, showInTable: false },
                price: { label: 'Preco', enabled: true, required: true, showInTable: true, locked: true },
                cost: { label: 'Custo', enabled: true, required: false, showInTable: true },
                unit: { label: 'Unidade', enabled: true, required: false, showInTable: true },
                status: { label: 'Status', enabled: true, required: false, showInTable: true }
            }
        }
    };
}

function ensureEntityTabConfigs() {
    if (!dataManager.ui) dataManager.ui = { modules: [] };
    if (!dataManager.ui.entities) dataManager.ui.entities = {};

    const defaults = getDefaultEntityTabConfigs();
    ['leads', 'products'].forEach(entity => {
        const existing = dataManager.ui.entities[entity] || {};
        const merged = { ...defaults[entity], ...existing };
        merged.fields = { ...defaults[entity].fields, ...(existing.fields || {}) };
        dataManager.ui.entities[entity] = merged;
    });

    dataManager.saveData();
}

function getEntityTabConfig(entity) {
    ensureEntityTabConfigs();
    return dataManager.ui.entities[entity];
}

function setEntityTabConfig(entity, config) {
    ensureEntityTabConfigs();
    dataManager.ui.entities[entity] = config;
    dataManager.saveData();
}

function renderEntityTabSettings(entity) {
    const containerId = entity === 'leads' ? 'leadsTabSettings' : 'productsTabSettings';
    const container = document.getElementById(containerId);
    if (!container) return;

    const config = getEntityTabConfig(entity);
    const fieldOrder = entity === 'leads'
        ? ['name', 'phone', 'source', 'campaign', 'status', 'conversationStatus', 'classification', 'interest', 'content', 'notes']
        : ['name', 'code', 'category', 'description', 'price', 'cost', 'unit', 'status'];

    let html = '';

    if (entity === 'products') {
        const current = config.defaults?.status || 'Ativo';
        html += `
            <div class="form-group" style="background: white; padding: 12px; border-radius: 8px; box-shadow: 0 1px 6px rgba(0,0,0,0.06);">
                <label>Status padrao do produto</label>
                <select id="productsDefaultStatus">
                    <option ${current === 'Ativo' ? 'selected' : ''}>Ativo</option>
                    <option ${current === 'Inativo' ? 'selected' : ''}>Inativo</option>
                </select>
            </div>
        `;
    }

    html += fieldOrder.map(key => {
        const f = config.fields[key];
        const disabled = f.locked ? 'disabled' : '';
        const checkedEnabled = f.enabled ? 'checked' : '';
        const checkedRequired = f.required ? 'checked' : '';
        const checkedTable = f.showInTable ? 'checked' : '';
        return `
            <div class="entity-config-row" data-entity="${entity}" data-field="${key}">
                <div class="ec-title">${key}</div>
                <input type="text" value="${(f.label || key).replace(/"/g, '&quot;')}" data-role="label">
                <div class="ec-checks">
                    <label><input type="checkbox" data-role="enabled" ${checkedEnabled} ${disabled}> Ativo</label>
                    <label><input type="checkbox" data-role="required" ${checkedRequired} ${disabled}> Obrigatorio</label>
                </div>
                <div class="ec-checks">
                    <label><input type="checkbox" data-role="showInTable" ${checkedTable}> Mostrar na tabela</label>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = html;
}

function saveEntityTabSettings(entity) {
    const config = getEntityTabConfig(entity);
    const containerId = entity === 'leads' ? 'leadsTabSettings' : 'productsTabSettings';
    const container = document.getElementById(containerId);
    if (!container) return;

    const rows = Array.from(container.querySelectorAll('.entity-config-row'));
    rows.forEach(row => {
        const field = row.dataset.field;
        const label = row.querySelector('[data-role="label"]')?.value?.trim() || field;
        const enabled = !!row.querySelector('[data-role="enabled"]')?.checked;
        const required = !!row.querySelector('[data-role="required"]')?.checked;
        const showInTable = !!row.querySelector('[data-role="showInTable"]')?.checked;

        const current = config.fields[field] || {};
        const locked = !!current.locked;
        config.fields[field] = {
            ...current,
            label,
            enabled: locked ? true : enabled,
            required: locked ? true : required,
            showInTable
        };
    });

    if (entity === 'products') {
        const def = document.getElementById('productsDefaultStatus')?.value || 'Ativo';
        config.defaults = { ...(config.defaults || {}), status: def };
    }

    setEntityTabConfig(entity, config);
    applyEntityTabConfig('leads');
    applyEntityTabConfig('products');
    displayLeads();
    displayProducts();
    alert('Configuracoes salvas!');
}

function applyEntityTabConfig(entity) {
    const config = getEntityTabConfig(entity);

    const map = entity === 'leads' ? {
        name: { group: 'leadNameGroup', input: 'leadName' },
        phone: { group: 'leadPhoneGroup', input: 'leadPhone' },
        source: { group: 'leadSourceGroup', input: 'leadSource' },
        campaign: { group: 'leadCampaignGroup', input: 'leadCampaign' },
        content: { group: 'leadContentGroup', input: 'leadContent' },
        interest: { group: 'leadInterestGroup', input: 'leadInterest' },
        status: { group: 'leadStatusGroup', input: 'leadStatus' },
        conversationStatus: { group: 'leadConversationStatusGroup', input: 'leadConversationStatus' },
        classification: { group: 'leadClassificationGroup', input: 'leadClassification' },
        notes: { group: 'leadNotesGroup', input: 'leadNotes' }
    } : {
        name: { group: 'productNameGroup', input: 'productName' },
        code: { group: 'productCodeGroup', input: 'productCode' },
        category: { group: 'productCategoryGroup', input: 'productCategory' },
        description: { group: 'productDescriptionGroup', input: 'productDescription' },
        price: { group: 'productPriceGroup', input: 'productPrice' },
        cost: { group: 'productCostGroup', input: 'productCost' },
        unit: { group: 'productUnitGroup', input: 'productUnit' },
        status: { group: 'productStatusGroup', input: 'productStatus' }
    };

    Object.keys(map).forEach(key => {
        const cfg = config.fields[key];
        const groupEl = document.getElementById(map[key].group);
        const inputEl = document.getElementById(map[key].input);
        if (!groupEl || !inputEl) return;

        groupEl.style.display = cfg.enabled ? '' : 'none';
        const labelEl = groupEl.querySelector('label');
        if (labelEl) labelEl.textContent = cfg.label || key;

        if ('required' in cfg) inputEl.required = !!cfg.required;
    });
}

function getModulesConfig() {
    const defaults = getDefaultModules();
    const stored = Array.isArray(dataManager?.ui?.modules) ? dataManager.ui.modules : [];

    const defaultsById = new Map(defaults.map(m => [m.id, m]));
    const output = [];

    stored.forEach(m => {
        if (!m?.id) return;
        if (m.id === 'clients') return; // removed module (base unificada em Leads)
        const base = defaultsById.get(m.id) || { id: m.id, label: m.label || m.id, enabled: true, locked: false };
        const merged = { ...base, ...m };
        if (merged.locked) merged.enabled = true;
        if (typeof merged.enabled !== 'boolean') merged.enabled = !!merged.enabled;
        merged.label = (merged.label || base.label || merged.id).toString();
        output.push(merged);
    });

    defaults.forEach(m => {
        if (!output.some(x => x.id === m.id)) output.push({ ...m });
    });

    return output;
}

function setModulesConfig(modules) {
    dataManager.ui.modules = modules;
    dataManager.saveData();
}

function getActiveTabId() {
    return document.querySelector('.tab.active')?.id || 'dashboard';
}

function updateTopbarIdentity() {
    const companyName = (dataManager?.company?.name || '').toString().trim();
    const companyEl = document.getElementById('topbarCompany');
    if (companyEl) companyEl.textContent = companyName || 'Empresa';

    const userEl = document.getElementById('topbarUser');
    if (userEl) {
        const session = getSession();
        if (!session) {
            userEl.textContent = '-';
        } else {
            const users = loadUsers();
            const user = users.find(u => u.id === session.userId && u.email === session.email);
            userEl.textContent = (user?.name || user?.email || session.email || '-').toString();
        }
    }
}

function wireGlobalSearch() {
    const el = document.getElementById('globalSearch');
    if (!el || el.dataset.wired === '1') return;
    el.dataset.wired = '1';

    const apply = () => {
        const q = el.value || '';
        const active = getActiveTabId();
        if (active === 'leads') {
            const target = document.getElementById('leadSearch');
            if (target) target.value = q;
            filterLeads();
            return;
        }
        if (active === 'products') {
            const target = document.getElementById('productSearch');
            if (target) target.value = q;
            filterProducts();
            return;
        }
    };

    el.addEventListener('input', apply);
}

function renderSidebar() {
    const container = document.getElementById('sidebarButtons');
    if (!container) return;

    const activeTabId = getActiveTabId();
    const modules = getModulesConfig().filter(m => m.enabled);

    container.innerHTML = '';
    modules.forEach(m => {
        const btn = document.createElement('button');
        btn.textContent = m.label;
        btn.dataset.tab = m.id;
        if (m.id === activeTabId) btn.classList.add('active');
        btn.addEventListener('click', () => switchTab(m.id, btn));
        container.appendChild(btn);
    });
}

function renderModulesSettings() {
    const container = document.getElementById('modulesSettings');
    if (!container) return;

    const modules = getModulesConfig();
    container.innerHTML = '';

    modules.forEach((m, idx) => {
        const row = document.createElement('div');
        row.className = 'module-row';

        const enabled = document.createElement('input');
        enabled.type = 'checkbox';
        enabled.checked = !!m.enabled;
        enabled.disabled = !!m.locked;
        enabled.dataset.moduleId = m.id;

        const enabledLabel = document.createElement('label');
        enabledLabel.textContent = 'Ativo';

        const name = document.createElement('input');
        name.type = 'text';
        name.value = m.label;
        name.placeholder = 'Nome do modulo';
        name.dataset.moduleId = m.id;

        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'small-btn';
        up.textContent = 'Subir';
        up.disabled = idx === 0;
        up.addEventListener('click', () => moveModule(m.id, -1));

        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'small-btn';
        down.textContent = 'Descer';
        down.disabled = idx === modules.length - 1;
        down.addEventListener('click', () => moveModule(m.id, +1));

        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = m.locked ? 'Este modulo e essencial e nao pode ser desativado.' : 'Voce pode renomear e ocultar este modulo.';

        row.appendChild(enabled);
        row.appendChild(enabledLabel);
        row.appendChild(name);
        row.appendChild(up);
        row.appendChild(down);
        row.appendChild(hint);

        container.appendChild(row);
    });
}

function moveModule(moduleId, delta) {
    const modules = getModulesConfig();
    const index = modules.findIndex(m => m.id === moduleId);
    const targetIndex = index + delta;
    if (index < 0 || targetIndex < 0 || targetIndex >= modules.length) return;

    const updated = modules.slice();
    const tmp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = tmp;

    setModulesConfig(updated);
    renderSidebar();
    renderModulesSettings();
}

function saveModulesSettings() {
    const modules = getModulesConfig();

    const enabledEls = Array.from(document.querySelectorAll('#modulesSettings input[type="checkbox"][data-module-id]'));
    const nameEls = Array.from(document.querySelectorAll('#modulesSettings input[type="text"][data-module-id]'));

    const enabledById = new Map(enabledEls.map(el => [el.dataset.moduleId, el.checked]));
    const nameById = new Map(nameEls.map(el => [el.dataset.moduleId, el.value]));

    const updated = modules.map(m => {
        const label = (nameById.get(m.id) ?? m.label).toString().trim() || m.label;
        const enabled = m.locked ? true : (enabledById.get(m.id) ?? m.enabled);
        return { ...m, label, enabled };
    });

    setModulesConfig(updated);
    applyModuleVisibility();
    renderSidebar();
    renderModulesSettings();
    alert('Modulos salvos!');
}

function applyModuleVisibility() {
    const modules = getModulesConfig();
    const enabledIds = modules.filter(m => m.enabled).map(m => m.id);
    const allowed = new Set(modules.map(m => m.id));

    // Hide any legacy/unused tabs that are not in module config (e.g., old "clients").
    document.querySelectorAll('.tab').forEach(tab => {
        if (!tab?.id) return;
        if (!allowed.has(tab.id)) tab.style.display = 'none';
    });

    modules.forEach(m => {
        const el = document.getElementById(m.id);
        if (!el) return;
        el.style.display = m.enabled ? '' : 'none';
    });

    const current = getActiveTabId();
    const next = enabledIds.includes(current) ? current : (enabledIds[0] || 'dashboard');
    switchTab(next);
}

function switchTab(tabName, clickedButton) {
    const targetTab = document.getElementById(tabName);
    if (!targetTab) return;

    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    targetTab.classList.add('active');

    document.querySelectorAll('#sidebarButtons button').forEach(btn => btn.classList.remove('active'));
    if (clickedButton) {
        clickedButton.classList.add('active');
    } else {
        const btn = Array.from(document.querySelectorAll('#sidebarButtons button')).find(b => b.dataset.tab === tabName);
        if (btn) btn.classList.add('active');
    }

    if (tabName === 'dashboard') {
        // Charts need a visible container to size correctly.
        renderDashboardBuilder(true);
    }

    if (tabName === 'whatsapp') {
        initWhatsAppCampaigns();
        waRenderWhatsAppContacts();
    }

    if (tabName === 'campaigns') {
        initCampaignsDashboard();
        renderCampaignsDashboard();
    }

    // Keep topbar context fresh when navigating.
    updateTopbarIdentity();
}

function initializeApp() {
    // Initialize module config on first run
    if (!Array.isArray(dataManager.ui?.modules) || dataManager.ui.modules.length === 0) {
        setModulesConfig(getDefaultModules());
    }
    ensureEntityTabConfigs();
    renderSidebar();
    renderModulesSettings();
    renderEntityTabSettings('leads');
    renderEntityTabSettings('products');
    renderMessageTemplatesSettings();
    applyEntityTabConfig('leads');
    applyEntityTabConfig('products');
    applyModuleVisibility();

    loadCompanyProfile();
    loadCategories();
    loadCustomFields();
    displayLeads();
    displayProducts();
    displayBudgets();
    loadLeadsInBudgetForm();
    loadProductsInBudgetForm();
    updateDashboard();
    initLeadCaptureIntegrations();
    processLeadCaptureFromUrl();

    updateTopbarIdentity();
    wireGlobalSearch();
    initWhatsAppCampaigns();
    initCampaignsDashboard();
}

// WhatsApp Campaigns (client-side queue using WhatsApp Web deep links)
const waCampaignState = {
    search: '',
    leadStatus: 'Todos',
    defaultCountry: '55',
    onlyValidPhones: true,
    imageUrl: '',
    includeImageInText: true,
    selectedIds: new Set(),
    lastVisibleIds: [],
    queue: [],
    queueIndex: 0
};

function waEscapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function waNormalizeCountryCode(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits || '55';
}

function waPhoneToWhatsAppId(phone, defaultCountry) {
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (!digits) return null;

    const ddi = waNormalizeCountryCode(defaultCountry);
    let id = digits;

    // If user stored local BR-style number, prefix DDI.
    if (digits.length <= 11) id = `${ddi}${digits}`;

    if (id.length < 10 || id.length > 15) return null;
    return id;
}

function waGetLeadsContacts() {
    return (dataManager.leads || []).map(l => ({
        id: l.id,
        name: (l.name || '').toString(),
        phone: (l.phone || '').toString(),
        source: (l.source || '').toString(),
        campaign: (l.campaign || '').toString(),
        status: (l.status || 'Novo').toString(),
        conversationStatus: (l.conversationStatus || '').toString(),
        classification: (l.classification || '').toString(),
        interest: (l.interest || '').toString(),
        content: (l.content || '').toString()
    }));
}

function waUpdateSelectedCount() {
    const el = document.getElementById('waSelectedCount');
    if (!el) return;
    el.textContent = `${waCampaignState.selectedIds.size} selecionados`;
}

function waToggleContact(id, checked) {
    const key = String(id);
    if (checked) waCampaignState.selectedIds.add(key);
    else waCampaignState.selectedIds.delete(key);
    waUpdateSelectedCount();
}

function waSelectAllVisible(select) {
    if (select) {
        waCampaignState.lastVisibleIds.forEach(k => waCampaignState.selectedIds.add(k));
    } else {
        waCampaignState.selectedIds.clear();
    }
    waUpdateSelectedCount();
    waRenderWhatsAppContacts();
}

function waContactMatchesSearch(contact, query) {
    const q = (query || '').toString().trim().toLowerCase();
    if (!q) return true;
    const hay = `${contact.name} ${contact.phone} ${contact.source} ${contact.campaign} ${contact.content} ${contact.interest} ${contact.status}`.toLowerCase();
    return hay.includes(q);
}

function waGetDisplayName(contact) {
    return (contact.name || contact.phone || '').toString().trim() || '(sem nome)';
}

function waRenderWhatsAppContacts() {
    const tbody = document.getElementById('waContactsBody');
    if (!tbody) return;

    const audienceContacts = waGetLeadsContacts();
    const search = waCampaignState.search;
    const defaultCountry = waCampaignState.defaultCountry;
    const onlyValid = !!waCampaignState.onlyValidPhones;

    const filtered = audienceContacts.filter(c => {
        if (!waContactMatchesSearch(c, search)) return false;
        if (waCampaignState.leadStatus !== 'Todos' && (c.status || 'Novo') !== waCampaignState.leadStatus) return false;

        if (onlyValid) {
            const id = waPhoneToWhatsAppId(c.phone, defaultCountry);
            if (!id) return false;
        }

        return true;
    });

    waCampaignState.lastVisibleIds = filtered.map(c => String(c.id));

    tbody.innerHTML = filtered.map(contact => {
        const key = String(contact.id);
        const checked = waCampaignState.selectedIds.has(key) ? 'checked' : '';
        const whatsappId = waPhoneToWhatsAppId(contact.phone, defaultCountry);
        const badge = whatsappId
            ? `<span class="wa-badge wa-badge-ok">ok</span>`
            : `<span class="wa-badge wa-badge-bad">inv</span>`;

        return `
            <tr>
                <td><input type="checkbox" ${checked} onclick="waToggleContact(${Number(contact.id)}, this.checked)"></td>
                <td>${waEscapeHtml(waGetDisplayName(contact))}</td>
                <td>${waEscapeHtml(`${contact.source || ''}${contact.campaign ? ` • ${contact.campaign}` : ''}`)}</td>
                <td>${waEscapeHtml(contact.phone || '')} ${badge}</td>
                <td>${waEscapeHtml(contact.status || 'Novo')}</td>
            </tr>
        `;
    }).join('');

    waUpdateSelectedCount();
}

function waInsertToken(token) {
    const el = document.getElementById('waMessageTemplate');
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    el.value = `${before}${token}${after}`;
    const cursor = start + token.length;
    el.setSelectionRange(cursor, cursor);
    el.focus();
}

function waIsValidHttpUrl(value) {
    const v = (value || '').toString().trim();
    if (!v) return false;
    try {
        const u = new URL(v);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

function waUpdateImagePreview() {
    const url = (waCampaignState.imageUrl || '').toString().trim();
    const wrap = document.getElementById('waImagePreviewWrap');
    const img = document.getElementById('waImagePreview');
    if (!wrap || !img) return;

    if (waIsValidHttpUrl(url)) {
        img.src = url;
        wrap.style.display = 'block';
    } else {
        img.removeAttribute('src');
        wrap.style.display = 'none';
    }
}

function waOpenImageUrl() {
    const url = (waCampaignState.imageUrl || '').toString().trim();
    if (!waIsValidHttpUrl(url)) {
        alert('Informe uma URL válida (http/https) para a imagem.');
        return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
}

function waClearImageUrl() {
    waCampaignState.imageUrl = '';
    const el = document.getElementById('waImageUrl');
    if (el) el.value = '';
    waUpdateImagePreview();
}

function waRenderMessageTemplatesSelect() {
    const sel = document.getElementById('waMessageTemplateSelect');
    if (!sel) return;
    const templates = typeof getMessageTemplates === 'function' ? getMessageTemplates() : [];
    sel.innerHTML = '<option value=\"\">(selecione)</option>' + templates.map(t => `<option value="${waEscapeHtml(t.id)}">${waEscapeHtml(t.name || 'Modelo')}</option>`).join('');
}

function waApplySelectedTemplate() {
    const sel = document.getElementById('waMessageTemplateSelect');
    const textarea = document.getElementById('waMessageTemplate');
    if (!sel || !textarea) return;
    const id = sel.value || '';
    if (!id) return;
    const templates = typeof getMessageTemplates === 'function' ? getMessageTemplates() : [];
    const t = templates.find(x => String(x.id) === String(id));
    if (!t) return;
    textarea.value = (t.text || '').toString();
    textarea.focus();
}

function waBuildMessage(template, contact) {
    const values = {
        nome: waGetDisplayName(contact),
        empresa: '',
        email: '',
        telefone: (contact.phone || '').toString(),
        categoria: '',
        status: (contact.status || 'Novo').toString(),
        origem: (contact.source || '').toString(),
        campanha: (contact.campaign || '').toString(),
        conteudo: (contact.content || '').toString(),
        interesse: (contact.interest || '').toString(),
        conversa: (contact.conversationStatus || '').toString(),
        classificacao: (contact.classification || '').toString()
    };

    return String(template ?? '').replace(/\{([a-zA-Z_]+)\}/g, (m, token) => {
        const key = token.toLowerCase();
        if (key in values) return values[key] || '';
        return m;
    });
}

function waCopyText(text) {
    const value = String(text ?? '');
    if (!value) return;

    try {
        if (navigator?.clipboard?.writeText) {
            navigator.clipboard.writeText(value);
            return;
        }
    } catch {
        // fallback below
    }

    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* no-op */ }
    document.body.removeChild(ta);
}

function waRenderQueue() {
    const status = document.getElementById('waQueueStatus');
    const list = document.getElementById('waQueueList');
    if (!status || !list) return;

    const total = waCampaignState.queue.length;
    if (!total) {
        status.textContent = 'Fila vazia';
        list.innerHTML = '';
        return;
    }

    if (waCampaignState.queueIndex >= total) {
        status.textContent = `Fim da fila: ${total}/${total}`;
    } else {
        status.textContent = `Proximo: ${waCampaignState.queueIndex + 1}/${total}`;
    }

    list.innerHTML = waCampaignState.queue.map((item, idx) => {
        const title = `${idx + 1}. ${waEscapeHtml(item.name)} (${waEscapeHtml(item.phone)})`;
        const meta = waEscapeHtml(item.preview);
        const imgBtn = item.imageUrl ? `<button class="action-btn" type="button" onclick="waOpenImageAt(${idx})">Imagem</button>` : '';
        return `
            <div class="wa-queue-item">
                <div class="wa-queue-main">
                    <div class="wa-queue-title">${title}</div>
                    <div class="wa-queue-meta">${meta}</div>
                </div>
                <div>
                    <button class="action-btn" type="button" onclick="waOpenQueueAt(${idx})">Abrir</button>
                    <button class="action-btn" type="button" onclick="waCopyMessageAt(${idx})">Copiar</button>
                    ${imgBtn}
                </div>
            </div>
        `;
    }).join('');
}

function waOpenImageAt(index) {
    const item = waCampaignState.queue[index];
    if (!item?.imageUrl) return;
    window.open(item.imageUrl, '_blank', 'noopener,noreferrer');
}

function waGenerateQueue() {
    const templateEl = document.getElementById('waMessageTemplate');
    if (!templateEl) return;

    const template = (templateEl.value || '').toString();
    if (!template.trim()) {
        alert('Digite a mensagem do template.');
        return;
    }

    const contacts = waGetLeadsContacts();
    const byId = new Map(contacts.map(c => [String(c.id), c]));

    const imageUrl = (waCampaignState.imageUrl || '').toString().trim();
    const includeImage = !!waCampaignState.includeImageInText;
    if (imageUrl && includeImage && !waIsValidHttpUrl(imageUrl)) {
        alert('A URL da imagem precisa começar com http:// ou https://');
        return;
    }

    const ddi = waNormalizeCountryCode(waCampaignState.defaultCountry);
    const selected = Array.from(waCampaignState.selectedIds).map(k => byId.get(k)).filter(Boolean);
    if (selected.length === 0) {
        alert('Selecione pelo menos 1 contato.');
        return;
    }

    let invalidPhones = 0;
    const queue = [];

    selected.forEach(contact => {
        const whatsappId = waPhoneToWhatsAppId(contact.phone, ddi);
        if (!whatsappId) {
            invalidPhones += 1;
            return;
        }

        let message = waBuildMessage(template, contact).trim();
        if (imageUrl && includeImage) {
            message = `${message}\n\n${imageUrl}`.trim();
        }
        const url = `https://wa.me/${whatsappId}?text=${encodeURIComponent(message)}`;
        queue.push({
            key: String(contact.id),
            name: waGetDisplayName(contact),
            phone: contact.phone || '',
            whatsappId,
            message,
            url,
            imageUrl: imageUrl || '',
            preview: message.length > 140 ? `${message.slice(0, 140)}...` : message
        });
    });

    waCampaignState.queue = queue;
    waCampaignState.queueIndex = 0;
    waRenderQueue();

    if (invalidPhones > 0) {
        alert(`Fila gerada, mas ${invalidPhones} contato(s) foram ignorados por telefone invalido.`);
    } else if (queue.length === 0) {
        alert('Nenhum contato com telefone valido para gerar a fila.');
    }
}

function waOpenQueueAt(index) {
    const item = waCampaignState.queue[index];
    if (!item) return;
    window.open(item.url, '_blank', 'noopener,noreferrer');
    waCampaignState.queueIndex = Math.min(index + 1, waCampaignState.queue.length);
    waRenderQueue();
}

function waOpenNext() {
    if (!waCampaignState.queue.length) {
        alert('A fila esta vazia. Gere a fila primeiro.');
        return;
    }

    const index = waCampaignState.queueIndex;
    const item = waCampaignState.queue[index];
    if (!item) {
        alert('Fim da fila.');
        return;
    }

    window.open(item.url, '_blank', 'noopener,noreferrer');
    waCampaignState.queueIndex = Math.min(index + 1, waCampaignState.queue.length);
    waRenderQueue();
}

function waCopyMessageAt(index) {
    const item = waCampaignState.queue[index];
    if (!item) return;
    waCopyText(item.message);
    alert('Mensagem copiada!');
}

function waCopyCurrentMessage() {
    if (!waCampaignState.queue.length) {
        alert('A fila esta vazia.');
        return;
    }
    const idx = Math.max(0, Math.min(waCampaignState.queueIndex - 1, waCampaignState.queue.length - 1));
    waCopyMessageAt(idx);
}

function initWhatsAppCampaigns() {
    const tab = document.getElementById('whatsapp');
    if (!tab || tab.dataset.initialized === '1') return;
    tab.dataset.initialized = '1';

    const searchEl = document.getElementById('waSearch');
    const leadStatusEl = document.getElementById('waLeadStatusFilter');
    const ddiEl = document.getElementById('waDefaultCountry');
    const onlyValidEl = document.getElementById('waOnlyValidPhones');
    const templateEl = document.getElementById('waMessageTemplate');
    const templateSelEl = document.getElementById('waMessageTemplateSelect');
    const imageUrlEl = document.getElementById('waImageUrl');
    const includeImageEl = document.getElementById('waIncludeImageInText');

    if (templateEl && !templateEl.value) {
        templateEl.value = 'Ola {nome}, tudo bem?';
    }

    if (templateSelEl) waRenderMessageTemplatesSelect();

    if (imageUrlEl) {
        imageUrlEl.value = waCampaignState.imageUrl || '';
        imageUrlEl.addEventListener('input', () => {
            waCampaignState.imageUrl = imageUrlEl.value || '';
            waUpdateImagePreview();
        });
    }

    if (includeImageEl) {
        includeImageEl.checked = !!waCampaignState.includeImageInText;
        includeImageEl.addEventListener('change', () => {
            waCampaignState.includeImageInText = !!includeImageEl.checked;
        });
    }

    if (searchEl) {
        searchEl.addEventListener('input', () => {
            waCampaignState.search = searchEl.value || '';
            waRenderWhatsAppContacts();
        });
    }

    if (leadStatusEl) {
        leadStatusEl.value = waCampaignState.leadStatus || 'Todos';
        leadStatusEl.addEventListener('change', () => {
            waCampaignState.leadStatus = leadStatusEl.value || 'Todos';
            waRenderWhatsAppContacts();
        });
    }

    if (ddiEl) {
        ddiEl.value = waCampaignState.defaultCountry;
        ddiEl.addEventListener('input', () => {
            waCampaignState.defaultCountry = ddiEl.value || '55';
            waRenderWhatsAppContacts();
        });
    }

    if (onlyValidEl) {
        onlyValidEl.checked = !!waCampaignState.onlyValidPhones;
        onlyValidEl.addEventListener('change', () => {
            waCampaignState.onlyValidPhones = !!onlyValidEl.checked;
            waRenderWhatsAppContacts();
        });
    }

    waRenderWhatsAppContacts();
    waRenderQueue();
    waUpdateImagePreview();
}

// Campaigns dashboard (social)
const campaignsDash = {
    charts: new Map()
};

function destroyCampaignChart(id) {
    const chart = campaignsDash.charts.get(id);
    if (chart) destroyChart(chart);
    campaignsDash.charts.delete(id);
}

function setCampaignChart(id, ctx, config) {
    destroyCampaignChart(id);
    try {
        // Chart.js is loaded in index.html
        const chart = new Chart(ctx, config);
        campaignsDash.charts.set(id, chart);
    } catch {
        // no-op (Chart.js missing or invalid config)
    }
}

function initCampaignsDashboard() {
    const tab = document.getElementById('campaigns');
    if (!tab || tab.dataset.initialized === '1') return;
    tab.dataset.initialized = '1';

    const fromEl = document.getElementById('campDateFrom');
    const toEl = document.getElementById('campDateTo');

    const today = new Date();
    const to = new Date(today);
    const from = new Date(today);
    from.setDate(from.getDate() - 30);

    const toIso = to.toISOString().slice(0, 10);
    const fromIso = from.toISOString().slice(0, 10);

    if (toEl && !toEl.value) toEl.value = toIso;
    if (fromEl && !fromEl.value) fromEl.value = fromIso;

    renderCampaignsDashboard();
}

function getCampaignCosts() {
    if (!dataManager.ui) dataManager.ui = { modules: [] };
    if (!dataManager.ui.campaignCosts || typeof dataManager.ui.campaignCosts !== 'object') dataManager.ui.campaignCosts = {};
    return dataManager.ui.campaignCosts;
}

function saveCampaignCosts() {
    const container = document.getElementById('campCosts');
    if (!container) return;
    const inputs = Array.from(container.querySelectorAll('input[data-campaign]'));
    const costs = getCampaignCosts();
    inputs.forEach(inp => {
        let key = (inp.dataset.campaign || '').toString();
        try { key = decodeURIComponent(key); } catch { /* no-op */ }
        const value = Number(String(inp.value || '').replace(',', '.'));
        if (!key) return;
        if (Number.isFinite(value) && value >= 0) costs[key] = value;
    });
    dataManager.saveData();
    renderCampaignsDashboard();
    alert('Custos salvos!');
}

function renderCampaignsDashboard() {
    const tab = document.getElementById('campaigns');
    if (!tab) return;

    const from = document.getElementById('campDateFrom')?.value || '';
    const to = document.getElementById('campDateTo')?.value || '';

    const inRange = (iso) => {
        const d = (iso || '').slice(0, 10);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
    };

    const leads = (dataManager.leads || []).filter(l => inRange(l.createdAt || (l.id ? new Date(l.id).toISOString() : '')));

    const conversionStatuses = new Set(['Convertido', 'Fechado']);
    const respondedConversation = new Set(['Respondido', 'Em conversa']);

    const byChannel = new Map();
    const convByChannel = new Map();
    const byCampaign = new Map();
    const convByCampaign = new Map();
    const byContent = new Map();
    const convByContent = new Map();
    const byStage = new Map();
    const byDay = new Map();

    let whatsappTotal = 0;
    let whatsappResponded = 0;

    const stages = getLeadStages();
    stages.forEach(s => byStage.set(s, 0));

    leads.forEach(l => {
        const channel = (l.source || 'N/D').toString().trim() || 'N/D';
        const campaign = (l.campaign || 'N/D').toString().trim() || 'N/D';
        const content = (l.content || 'N/D').toString().trim() || 'N/D';
        const status = (l.status || 'Novo').toString();
        const conv = conversionStatuses.has(status);

        byChannel.set(channel, (byChannel.get(channel) || 0) + 1);
        if (conv) convByChannel.set(channel, (convByChannel.get(channel) || 0) + 1);

        byCampaign.set(campaign, (byCampaign.get(campaign) || 0) + 1);
        if (conv) convByCampaign.set(campaign, (convByCampaign.get(campaign) || 0) + 1);

        byContent.set(content, (byContent.get(content) || 0) + 1);
        if (conv) convByContent.set(content, (convByContent.get(content) || 0) + 1);

        const stageKey = stages.includes(status) ? status : 'Novo';
        byStage.set(stageKey, (byStage.get(stageKey) || 0) + 1);

        const day = (l.createdAt || '').slice(0, 10);
        if (day) byDay.set(day, (byDay.get(day) || 0) + 1);

        if ((l.source || '').toString().toLowerCase().includes('whatsapp')) {
            whatsappTotal += 1;
            if (respondedConversation.has((l.conversationStatus || '').toString())) whatsappResponded += 1;
        }
    });

    const conversions = leads.filter(l => conversionStatuses.has((l.status || 'Novo').toString())).length;
    const responseRate = whatsappTotal ? (whatsappResponded / whatsappTotal) : 0;

    const costs = getCampaignCosts();
    const totalSpend = Object.values(costs).reduce((sum, v) => sum + (Number(v) || 0), 0);
    const cpl = (totalSpend > 0 && leads.length > 0) ? (totalSpend / leads.length) : null;
    const cpc = (totalSpend > 0 && conversions > 0) ? (totalSpend / conversions) : null;

    const kpisEl = document.getElementById('campKpis');
    if (kpisEl) {
        const topCampaign = Array.from(convByCampaign.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/D';
        kpisEl.innerHTML = `
            <div class="camp-kpi"><div class="camp-kpi-label">Leads</div><div class="camp-kpi-value">${leads.length}</div></div>
            <div class="camp-kpi"><div class="camp-kpi-label">Conversões</div><div class="camp-kpi-value">${conversions}</div></div>
            <div class="camp-kpi"><div class="camp-kpi-label">Taxa resposta (WhatsApp)</div><div class="camp-kpi-value">${(responseRate * 100).toFixed(1)}%</div></div>
            <div class="camp-kpi"><div class="camp-kpi-label">Custo por lead</div><div class="camp-kpi-value">${cpl == null ? '-' : formatMoney(cpl)}</div></div>
            <div class="camp-kpi"><div class="camp-kpi-label">Custo por conversão</div><div class="camp-kpi-value">${cpc == null ? '-' : formatMoney(cpc)}</div></div>
            <div class="camp-kpi"><div class="camp-kpi-label">Melhor campanha</div><div class="camp-kpi-value">${waEscapeHtml(topCampaign)}</div></div>
        `;
    }

    // Bar by channel
    const barLabels = Array.from(byChannel.entries()).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    const barData = barLabels.map(l => byChannel.get(l) || 0);
    const barConv = barLabels.map(l => convByChannel.get(l) || 0);
    const barCtx = document.getElementById('campBarByChannel')?.getContext?.('2d');
    if (barCtx) {
        setCampaignChart('bar_channel', barCtx, {
            type: 'bar',
            data: {
                labels: barLabels,
                datasets: [
                    { label: 'Leads', data: barData, backgroundColor: 'rgba(59,130,246,0.55)', borderColor: 'rgba(59,130,246,0.9)', borderWidth: 1 },
                    { label: 'ConversÃµes', data: barConv, backgroundColor: 'rgba(34,197,94,0.35)', borderColor: 'rgba(34,197,94,0.9)', borderWidth: 1 }
                ]
            },
            options: { responsive: true, plugins: { legend: { display: true } } }
        });
    }

    // Line by day
    const dayLabels = Array.from(byDay.keys()).sort();
    const dayData = dayLabels.map(d => byDay.get(d) || 0);
    const lineCtx = document.getElementById('campLineByPeriod')?.getContext?.('2d');
    if (lineCtx) {
        setCampaignChart('line_period', lineCtx, {
            type: 'line',
            data: {
                labels: dayLabels,
                datasets: [{ label: 'Leads', data: dayData, tension: 0.25, borderColor: 'rgba(34,197,94,0.95)', backgroundColor: 'rgba(34,197,94,0.18)', fill: true, pointRadius: 2 }]
            },
            options: { responsive: true, plugins: { legend: { display: false } } }
        });
    }

    // Funnel (by stage)
    const funnelLabels = stages;
    const funnelData = funnelLabels.map(s => byStage.get(s) || 0);
    const funnelCtx = document.getElementById('campFunnel')?.getContext?.('2d');
    if (funnelCtx) {
        setCampaignChart('funnel', funnelCtx, {
            type: 'bar',
            data: { labels: funnelLabels, datasets: [{ label: 'Leads', data: funnelData, backgroundColor: 'rgba(148,163,184,0.35)', borderColor: 'rgba(148,163,184,0.7)', borderWidth: 1 }] },
            options: { responsive: true, plugins: { legend: { display: false } }, indexAxis: 'y' }
        });
    }

    // Rankings
    const rankCampaignsEl = document.getElementById('campRankCampaigns');
    if (rankCampaignsEl) {
        const rows = Array.from(byCampaign.entries())
            .map(([k, v]) => ({ k, leads: v, conv: convByCampaign.get(k) || 0 }))
            .sort((a, b) => (b.conv - a.conv) || (b.leads - a.leads))
            .slice(0, 12);
        rankCampaignsEl.innerHTML = `
            <table class="rank-table">
                <thead><tr><th>Campanha</th><th>Leads</th><th>Conv</th></tr></thead>
                <tbody>${rows.map(r => `<tr><td>${waEscapeHtml(r.k)}</td><td>${r.leads}</td><td>${r.conv}</td></tr>`).join('')}</tbody>
            </table>
        `;
    }

    const rankContentsEl = document.getElementById('campRankContents');
    if (rankContentsEl) {
        const rows = Array.from(byContent.entries())
            .map(([k, v]) => ({ k, leads: v, conv: convByContent.get(k) || 0 }))
            .sort((a, b) => (b.conv - a.conv) || (b.leads - a.leads))
            .slice(0, 12);
        rankContentsEl.innerHTML = `
            <table class="rank-table">
                <thead><tr><th>Conteudo</th><th>Leads</th><th>Conv</th></tr></thead>
                <tbody>${rows.map(r => `<tr><td>${waEscapeHtml(r.k)}</td><td>${r.leads}</td><td>${r.conv}</td></tr>`).join('')}</tbody>
            </table>
        `;
    }

    // Costs editor
    const costsEl = document.getElementById('campCosts');
    if (costsEl) {
        const campaigns = Array.from(new Set(leads.map(l => (l.campaign || 'N/D').toString().trim() || 'N/D'))).sort();
        const known = Object.keys(costs);
        known.forEach(k => { if (!campaigns.includes(k)) campaigns.push(k); });
        costsEl.innerHTML = campaigns.map(c => {
            const v = costs[c] ?? 0;
            return `
                <div class="cost-row">
                    <div>${waEscapeHtml(c)}</div>
                    <input type="number" step="0.01" min="0" data-campaign="${encodeURIComponent(c)}" value="${Number(v) || 0}">
                </div>
            `;
        }).join('');
    }
}

// Dashboard
function updateDashboard() {
    const totalLeadsEl = document.getElementById('totalLeads') || document.getElementById('totalClients');
    if (totalLeadsEl) totalLeadsEl.textContent = (dataManager.leads || []).length;
    document.getElementById('totalProducts').textContent = dataManager.products.length;
    document.getElementById('totalBudgets').textContent = dataManager.budgets.length;
    document.getElementById('approvedBudgets').textContent = dataManager.budgets.filter(b => normalizeStatus(b.status) === 'Aprovado').length;

    setDashboardCompanyName();
    renderDashboardBuilder();
}

// Company Profile
function loadCompanyProfile() {
    document.getElementById('companyName').value = dataManager.company.name || '';
    document.getElementById('companyLogo').value = dataManager.company.logo || '';
    document.getElementById('companyDescription').value = dataManager.company.description || '';
    document.getElementById('companySegment').value = dataManager.company.segment || '';
    document.getElementById('companyContact').value = dataManager.company.contact || '';
    document.getElementById('companyAddress').value = dataManager.company.address || '';

    const currentCurrency = (dataManager.company.currency || 'BRL').toString().trim().toUpperCase();
    if (currentCurrency !== 'BRL') {
        dataManager.saveCompany({ currency: 'BRL' });
    }
    document.getElementById('companyCurrency').value = 'BRL';

    const currentLanguage = (dataManager.company.language || 'pt-BR').toString().trim();
    if (currentLanguage !== 'pt-BR') {
        dataManager.saveCompany({ language: 'pt-BR' });
    }
    document.getElementById('companyLanguage').value = 'pt-BR';
}

function saveCompanyProfile() {
    const data = {
        name: document.getElementById('companyName').value,
        logo: document.getElementById('companyLogo').value,
        description: document.getElementById('companyDescription').value,
        segment: document.getElementById('companySegment').value,
        contact: document.getElementById('companyContact').value,
        address: document.getElementById('companyAddress').value,
        currency: (document.getElementById('companyCurrency').value || 'BRL').toString().trim().toUpperCase(),
        language: document.getElementById('companyLanguage').value || 'pt-BR'
    };
    dataManager.saveCompany(data);
    alert('Perfil da empresa salvo com sucesso!');
    updateDashboard();
    updateTopbarIdentity();
}

// Products
function openProductForm() {
    currentEditId = null;
    document.getElementById('productForm').style.display = 'block';
    clearProductForm();
    loadProductCategories();
    renderCustomFields('products', 'productCustomFields');
}

function closeProductForm() {
    document.getElementById('productForm').style.display = 'none';
}

function clearProductForm() {
    document.getElementById('productName').value = '';
    document.getElementById('productCode').value = '';
    document.getElementById('productCategory').value = '';
    document.getElementById('productDescription').value = '';
    document.getElementById('productPrice').value = '';
    document.getElementById('productCost').value = '';
    document.getElementById('productUnit').value = '';
    const defStatus = getEntityTabConfig('products')?.defaults?.status || 'Ativo';
    document.getElementById('productStatus').value = defStatus;
}

function saveProduct() {
    const name = document.getElementById('productName').value.trim();
    const price = parseFloat(document.getElementById('productPrice').value);
    if (!name) {
        alert('O nome do produto e obrigatorio.');
        return;
    }
    if (isNaN(price) || price < 0) {
        alert('Informe um preco valido.');
        return;
    }
    const product = {
        name: name,
        code: document.getElementById('productCode').value,
        category: document.getElementById('productCategory').value,
        description: document.getElementById('productDescription').value,
        price: price,
        cost: parseFloat(document.getElementById('productCost').value) || 0,
        unit: document.getElementById('productUnit').value,
        status: document.getElementById('productStatus').value,
        customFields: getCustomFieldValues('products', 'productCustomFields')
    };

    if (currentEditId) {
        dataManager.updateProduct(currentEditId, product);
    } else {
        dataManager.addProduct(product);
    }
    
    displayProducts();
    closeProductForm();
    updateDashboard();
}

function getProductsTableColumns() {
    const config = getEntityTabConfig('products');
    const order = ['name', 'code', 'category', 'price', 'cost', 'unit', 'status', 'description'];

    const getters = {
        name: p => p.name,
        code: p => p.code || '',
        category: p => p.category || '',
        description: p => p.description || '',
        price: p => formatMoney(p.price),
        cost: p => formatMoney(p.cost),
        unit: p => p.unit || '',
        status: p => normalizeStatus(p.status)
    };

    return order
        .filter(k => config.fields[k]?.showInTable && config.fields[k]?.enabled)
        .map(k => ({ key: k, label: config.fields[k].label || k, get: getters[k] }));
}

function renderProductsTable(products) {
    const headRow = document.getElementById('productsHeadRow');
    const tbody = document.getElementById('productsBody');
    if (!tbody) return;

    const cols = getProductsTableColumns();
    if (headRow) {
        headRow.innerHTML = cols.map(c => `<th>${c.label}</th>`).join('') + '<th>Acoes</th>';
    }

    tbody.innerHTML = products.map(product => `
        <tr>
            ${cols.map(c => `<td>${c.get(product)}</td>`).join('')}
            <td>
                <button class="action-btn edit-btn" onclick="editProduct(${product.id})">Editar</button>
                <button class="action-btn delete-btn" onclick="deleteProduct(${product.id})">Excluir</button>
            </td>
        </tr>
    `).join('');
}

function displayProducts() {
    renderProductsTable(dataManager.products);
}

function editProduct(id) {
    const product = dataManager.products.find(p => p.id === id);
    currentEditId = id;
    document.getElementById('productName').value = product.name;
    document.getElementById('productCode').value = product.code;
    document.getElementById('productCategory').value = product.category;
    document.getElementById('productDescription').value = product.description;
    document.getElementById('productPrice').value = product.price;
    document.getElementById('productCost').value = product.cost;
    document.getElementById('productUnit').value = product.unit;
    document.getElementById('productStatus').value = normalizeStatus(product.status);
    renderCustomFields('products', 'productCustomFields', product.customFields);
    document.getElementById('productForm').style.display = 'block';
}

function deleteProduct(id) {
    if (confirm('Tem certeza?')) {
        dataManager.deleteProduct(id);
        displayProducts();
        updateDashboard();
    }
}

function filterProducts() {
    const searchTerm = document.getElementById('productSearch').value.toLowerCase();
    const categoryFilter = document.getElementById('productCategoryFilter').value;
    const statusFilter = document.getElementById('productStatusFilter').value;
    let filtered = dataManager.products.filter(p => 
        p.name.toLowerCase().includes(searchTerm) ||
        (p.code || '').toLowerCase().includes(searchTerm)
    );
    if (categoryFilter !== 'Todas as categorias') {
        filtered = filtered.filter(p => p.category === categoryFilter);
    }
    if (statusFilter !== 'Todos os status') {
        filtered = filtered.filter(p => normalizeStatus(p.status) === statusFilter);
    }
    displayFilteredProducts(filtered);
}

function displayFilteredProducts(filteredProducts) {
    renderProductsTable(filteredProducts);
}

// Leads
let currentLeadEditId = null;
let leadsViewMode = 'table';

function getLeadStages() {
    return ['Novo', 'Em contato', 'Qualificado', 'Proposta', 'Fechado', 'Perdido', 'Convertido'];
}

function leadAddHistory(lead, type, text) {
    if (!lead || typeof lead !== 'object') return;
    if (!Array.isArray(lead.history)) lead.history = [];
    lead.history.unshift({ at: new Date().toISOString(), type: type || 'evento', text: (text || '').toString() });
}

function openLeadForm() {
    currentLeadEditId = null;
    document.getElementById('leadForm').style.display = 'block';
    closeWhatsAppImport();
    clearLeadForm();
    renderLeadHistory({ history: [] });
    renderLeadMessageTemplatesSelect();
}

function closeLeadForm() {
    document.getElementById('leadForm').style.display = 'none';
}

function clearLeadForm() {
    document.getElementById('leadName').value = '';
    document.getElementById('leadPhone').value = '';
    document.getElementById('leadSource').value = '';
    document.getElementById('leadCampaign').value = '';
    document.getElementById('leadContent').value = '';
    document.getElementById('leadInterest').value = '';
    document.getElementById('leadStatus').value = 'Novo';
    document.getElementById('leadScheduledAt').value = '';
    document.getElementById('leadConversationStatus').value = '';
    document.getElementById('leadClassification').value = '';
    document.getElementById('leadNotes').value = '';
    const note = document.getElementById('leadHistoryNote');
    if (note) note.value = '';
}

function saveLead() {
    const name = document.getElementById('leadName').value.trim();
    const phone = document.getElementById('leadPhone').value.trim();
    if (!name && !phone) {
        alert('Informe pelo menos nome ou telefone.');
        return;
    }

    const now = new Date().toISOString();
    const existing = currentLeadEditId ? (dataManager.leads || []).find(l => l.id === currentLeadEditId) : null;

    const lead = {
        name,
        phone,
        source: document.getElementById('leadSource').value.trim(),
        campaign: document.getElementById('leadCampaign').value.trim(),
        content: document.getElementById('leadContent').value.trim(),
        interest: document.getElementById('leadInterest').value.trim(),
        status: document.getElementById('leadStatus').value,
        scheduledAt: document.getElementById('leadScheduledAt').value || null,
        conversationStatus: document.getElementById('leadConversationStatus').value,
        classification: document.getElementById('leadClassification').value,
        notes: document.getElementById('leadNotes').value.trim(),
        updatedAt: now
    };

    if (currentLeadEditId) {
        const prevStatus = (existing?.status || '').toString();
        const prevConversation = (existing?.conversationStatus || '').toString();
        const next = { ...(existing || {}), ...lead };
        next.history = Array.isArray(existing?.history) ? existing.history.slice() : [];
        if (prevStatus && prevStatus !== next.status) leadAddHistory(next, 'status', `Status: ${prevStatus} -> ${next.status}`);
        if (prevConversation !== (next.conversationStatus || '')) leadAddHistory(next, 'conversa', `Conversa: ${prevConversation || '(vazio)'} -> ${next.conversationStatus || '(vazio)'}`);
        dataManager.updateLead(currentLeadEditId, next);
    } else {
        lead.createdAt = now;
        lead.history = [];
        leadAddHistory(lead, 'criacao', 'Lead criado.');
        dataManager.addLead(lead);
    }

    displayLeads();
    loadLeadsInBudgetForm();
    closeLeadForm();
    updateDashboard();
    try { renderCampaignsDashboard(); } catch { /* no-op */ }
}

function displayLeads() {
    const tbody = document.getElementById('leadsBody');
    if (!tbody) return;
    const filtered = getFilteredLeads();

    tbody.innerHTML = filtered
        .slice()
        .sort((a, b) => (b.id || 0) - (a.id || 0))
        .map(lead => `
            <tr>
                <td>${waEscapeHtml(lead.name || '')}</td>
                <td>${waEscapeHtml(lead.phone || '')}</td>
                <td>${waEscapeHtml(lead.source || '')}</td>
                <td>${waEscapeHtml(lead.campaign || '')}</td>
                <td>${waEscapeHtml(lead.status || 'Novo')}</td>
                <td>${waEscapeHtml(lead.conversationStatus || '')}</td>
                <td>${waEscapeHtml(lead.classification || '')}</td>
                <td>${waEscapeHtml((lead.createdAt || '').slice(0, 10))}</td>
                <td>
                    <button class="action-btn edit-btn" onclick="editLead(${lead.id})">Editar</button>
                    <button class="action-btn delete-btn" onclick="deleteLead(${lead.id})">Excluir</button>
                </td>
            </tr>
        `).join('');

    syncLeadSourceFilterOptions();

    renderLeadCalendar();

    if (leadsViewMode === 'funnel') {
        renderLeadsFunnel(filtered);
    }
}

const leadCalendarState = {
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    selectedDay: null
};

function getLeadEvents() {
    return (dataManager.leads || []).filter(l => l.scheduledAt).map(l => ({
        id: l.id,
        name: l.name || '(sem nome)',
        campaign: l.campaign || '(sem campanha)',
        date: l.scheduledAt,
        status: l.status || 'Novo'
    }));
}

function renderLeadCalendar() {
    const panel = document.getElementById('leadCalendarPanel');
    if (!panel) return;

    const header = document.getElementById('leadCalendarHeader');
    const grid = document.getElementById('leadCalendarGrid');
    const eventsContainer = document.getElementById('leadCalendarDayEvents');
    if (!header || !grid || !eventsContainer) return;

    const monthNames = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];

    const { year, month, selectedDay } = leadCalendarState;
    header.textContent = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1);
    const startDay = (firstDay.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const events = getLeadEvents();
    const eventsByDate = new Map();
    events.forEach(e => {
        if (!e.date) return;
        const d = e.date.slice(0, 10);
        if (!eventsByDate.has(d)) eventsByDate.set(d, []);
        eventsByDate.get(d).push(e);
    });

    grid.innerHTML = '';
    ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].forEach(d => {
        const dayEl = document.createElement('div');
        dayEl.style.fontWeight = 'bold';
        dayEl.style.textAlign = 'center';
        dayEl.textContent = d;
        grid.appendChild(dayEl);
    });

    const totalCells = 42;
    for (let i = 0; i < totalCells; i++) {
        const cell = document.createElement('div');
        cell.style.border = '1px solid #ddd';
        cell.style.minHeight = '60px';
        cell.style.padding = '4px';
        cell.style.fontSize = '12px';
        cell.style.borderRadius = '4px';
        cell.style.background = '#fff';

        const dayNumber = i - startDay + 1;
        if (i >= startDay && dayNumber <= daysInMonth) {
            const isoDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
            cell.innerHTML = `<div style="font-weight:600; margin-bottom:4px;">${dayNumber}</div>`;
            const dayEvents = eventsByDate.get(isoDate) || [];
            if (dayEvents.length) {
                const badge = document.createElement('div');
                badge.textContent = `${dayEvents.length} agend.`;
                badge.style.fontSize = '11px';
                badge.style.background = '#2b7cff';
                badge.style.color = '#fff';
                badge.style.borderRadius = '4px';
                badge.style.padding = '2px 4px';
                badge.style.display = 'inline-block';
                cell.appendChild(badge);
            }
            cell.style.cursor = 'pointer';
            if (selectedDay === isoDate) {
                cell.style.boxShadow = 'inset 0 0 0 2px #2b7cff';
            }
            cell.addEventListener('click', () => {
                leadCalendarState.selectedDay = isoDate;
                renderLeadCalendar();
            });
        } else {
            cell.style.color = '#aaa';
            let dayText = '';
            if (i < startDay) {
                dayText = String(prevMonthDays - (startDay - i - 1));
            } else {
                dayText = String(i - startDay - daysInMonth + 1);
            }
            cell.innerHTML = `<div style="font-size:11px;">${dayText}</div>`;
        }

        grid.appendChild(cell);
    }

    const selectedDate = leadCalendarState.selectedDay || `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const selectedEvents = eventsByDate.get(selectedDate) || [];
    eventsContainer.innerHTML = `<h4 style="margin:0 0 6px 0;">Eventos em ${selectedDate}</h4>`;
    if (!selectedEvents.length) {
        eventsContainer.innerHTML += '<div style="font-size:12px; color:#666;">Nenhuma campanha agendada.</div>';
    } else {
        eventsContainer.innerHTML += selectedEvents.map(e => `<div style="margin-bottom:4px; border-left:3px solid #2b7cff; padding-left:8px;"><strong>${waEscapeHtml(e.name)}</strong> — ${waEscapeHtml(e.campaign)} <span style="font-size:11px;color:#444;">(${waEscapeHtml(e.status)})</span></div>`).join('');
    }
}

function changeLeadCalendarMonth(delta) {
    const d = new Date(leadCalendarState.year, leadCalendarState.month + delta, 1);
    leadCalendarState.year = d.getFullYear();
    leadCalendarState.month = d.getMonth();
    renderLeadCalendar();
}

function changeLeadCalendarYear(delta) {
    leadCalendarState.year += delta;
    renderLeadCalendar();
}

function editLead(id) {
    const lead = (dataManager.leads || []).find(l => l.id === id);
    if (!lead) return;
    currentLeadEditId = id;
    document.getElementById('leadName').value = lead.name || '';
    document.getElementById('leadPhone').value = lead.phone || '';
    document.getElementById('leadSource').value = lead.source || '';
    document.getElementById('leadCampaign').value = lead.campaign || '';
    document.getElementById('leadContent').value = lead.content || '';
    document.getElementById('leadInterest').value = lead.interest || '';
    document.getElementById('leadStatus').value = lead.status || 'Novo';
    document.getElementById('leadScheduledAt').value = lead.scheduledAt || '';
    document.getElementById('leadConversationStatus').value = lead.conversationStatus || '';
    document.getElementById('leadClassification').value = lead.classification || '';
    document.getElementById('leadNotes').value = lead.notes || '';
    document.getElementById('leadForm').style.display = 'block';
    closeWhatsAppImport();
    renderLeadHistory(lead);
    renderLeadMessageTemplatesSelect();
}

function deleteLead(id) {
    if (!confirm('Tem certeza?')) return;
    dataManager.deleteLead(id);
    displayLeads();
    loadLeadsInBudgetForm();
    updateDashboard();
    try { renderCampaignsDashboard(); } catch { /* no-op */ }
}

function filterLeads() {
    displayLeads();
}

function getFilteredLeads() {
    const searchTerm = (document.getElementById('leadSearch')?.value || '').toLowerCase().trim();
    const statusFilter = (document.getElementById('leadStatusFilter')?.value || 'Todos').toString();
    const sourceFilter = (document.getElementById('leadSourceFilter')?.value || '').toString();
    const campaignFilter = (document.getElementById('leadCampaignFilter')?.value || '').toLowerCase().trim();

    let filtered = (dataManager.leads || []).filter(l => {
        const hay = `${l.name || ''} ${l.phone || ''} ${l.source || ''} ${l.campaign || ''} ${l.interest || ''} ${l.notes || ''}`.toLowerCase();
        if (searchTerm && !hay.includes(searchTerm)) return false;
        if (statusFilter !== 'Todos' && (l.status || 'Novo') !== statusFilter) return false;
        if (sourceFilter && (l.source || '') !== sourceFilter) return false;
        if (campaignFilter && !(`${l.campaign || ''}`.toLowerCase().includes(campaignFilter))) return false;
        return true;
    });

    return filtered;
}

function syncLeadSourceFilterOptions() {
    const sel = document.getElementById('leadSourceFilter');
    if (!sel) return;

    const current = sel.value || '';
    const sources = Array.from(new Set((dataManager.leads || []).map(l => (l.source || '').toString().trim()).filter(Boolean))).sort();
    sel.innerHTML = '<option value=\"\">Todas as origens</option>' + sources.map(s => `<option value="${waEscapeHtml(s)}">${waEscapeHtml(s)}</option>`).join('');
    sel.value = sources.includes(current) ? current : '';
}

function toggleLeadsView() {
    leadsViewMode = leadsViewMode === 'table' ? 'funnel' : 'table';
    const table = document.getElementById('leadsTableWrap');
    const funnel = document.getElementById('leadsFunnelWrap');
    if (table) table.style.display = leadsViewMode === 'table' ? '' : 'none';
    if (funnel) funnel.style.display = leadsViewMode === 'funnel' ? '' : 'none';
    displayLeads();
}

function renderLeadsFunnel(leads) {
    const board = document.getElementById('leadsFunnelBoard');
    if (!board) return;

    const stages = getLeadStages();
    const byStage = new Map(stages.map(s => [s, []]));
    (leads || []).forEach(l => {
        const s = stages.includes(l.status) ? l.status : 'Novo';
        byStage.get(s).push(l);
    });

    board.className = 'funnel-board';
    board.innerHTML = stages.map(stage => {
        const items = byStage.get(stage) || [];
        return `
            <div class="funnel-col">
                <div class="funnel-col-title">
                    <h3>${waEscapeHtml(stage)}</h3>
                    <div class="funnel-col-count">${items.length}</div>
                </div>
                ${items
                    .slice()
                    .sort((a, b) => (b.id || 0) - (a.id || 0))
                    .map(l => `
                        <div class="funnel-card">
                            <div class="funnel-card-title">${waEscapeHtml(l.name || l.phone || '')}</div>
                            <div class="funnel-card-meta">
                                ${waEscapeHtml(l.phone || '')}<br>
                                ${waEscapeHtml(l.source || '')}${l.campaign ? ` • ${waEscapeHtml(l.campaign)}` : ''}
                            </div>
                            <div class="funnel-card-actions">
                                <button class="action-btn edit-btn" type="button" onclick="editLead(${l.id})">Abrir</button>
                                <button class="action-btn" type="button" onclick="moveLeadStage(${l.id}, -1)">←</button>
                                <button class="action-btn" type="button" onclick="moveLeadStage(${l.id}, 1)">→</button>
                            </div>
                        </div>
                    `).join('')}
            </div>
        `;
    }).join('');
}

function moveLeadStage(id, delta) {
    const stages = getLeadStages();
    const lead = (dataManager.leads || []).find(l => l.id === id);
    if (!lead) return;
    const idx = Math.max(0, stages.indexOf(lead.status || 'Novo'));
    const next = stages[Math.max(0, Math.min(stages.length - 1, idx + delta))];
    if (!next || next === lead.status) return;
    const updated = { ...lead, status: next, updatedAt: new Date().toISOString() };
    leadAddHistory(updated, 'status', `Status: ${(lead.status || 'Novo')} -> ${next}`);
    dataManager.updateLead(id, updated);
    displayLeads();
    updateDashboard();
    try { renderCampaignsDashboard(); } catch { /* no-op */ }
}

function renderLeadHistory(lead) {
    const list = document.getElementById('leadHistoryList');
    if (!list) return;
    const history = Array.isArray(lead?.history) ? lead.history : [];
    if (history.length === 0) {
        list.innerHTML = '<div class="wa-hint">Sem eventos no histÃ³rico.</div>';
        return;
    }
    list.innerHTML = history.map(ev => `
        <div class="lead-history-item">
            <div class="lead-history-at">${waEscapeHtml((ev.at || '').slice(0, 10))}</div>
            <div class="lead-history-text">${waEscapeHtml(ev.text || '')}</div>
        </div>
    `).join('');
}

function addLeadHistoryNote() {
    if (!currentLeadEditId) {
        alert('Abra um lead para registrar histÃ³rico.');
        return;
    }
    const text = (document.getElementById('leadHistoryNote')?.value || '').trim();
    if (!text) return;
    const lead = (dataManager.leads || []).find(l => l.id === currentLeadEditId);
    if (!lead) return;
    const updated = { ...lead, history: Array.isArray(lead.history) ? lead.history.slice() : [] };
    leadAddHistory(updated, 'nota', text);
    updated.updatedAt = new Date().toISOString();
    dataManager.updateLead(currentLeadEditId, updated);
    const note = document.getElementById('leadHistoryNote');
    if (note) note.value = '';
    renderLeadHistory(updated);
    displayLeads();
}

function openWhatsAppImport() {
    const panel = document.getElementById('whatsAppImportPanel');
    if (panel) panel.style.display = 'block';
    closeLeadForm();
}

function closeWhatsAppImport() {
    const panel = document.getElementById('whatsAppImportPanel');
    if (panel) panel.style.display = 'none';
}

function parseWhatsAppPhone(input) {
    const raw = (input || '').toString().trim();
    if (!raw) return '';
    const waMe = raw.match(/wa\.me\/(\d{8,20})/i);
    if (waMe) return waMe[1];
    const api = raw.match(/phone=(\d{8,20})/i);
    if (api) return api[1];
    return raw.replace(/\D/g, '');
}

function importLeadFromWhatsApp() {
    const phoneDigits = parseWhatsAppPhone(document.getElementById('waImportInput')?.value || '');
    if (!phoneDigits) {
        alert('Informe um telefone ou link wa.me valido.');
        return;
    }
    const name = (document.getElementById('waImportName')?.value || '').trim();
    const campaign = (document.getElementById('waImportCampaign')?.value || '').trim();
    const content = (document.getElementById('waImportContent')?.value || '').trim();

    const now = new Date().toISOString();
    const lead = {
        name,
        phone: phoneDigits,
        source: 'WhatsApp',
        campaign,
        content,
        interest: '',
        status: 'Novo',
        conversationStatus: 'Sem contato',
        classification: '',
        notes: '',
        createdAt: now,
        updatedAt: now,
        history: [{ at: now, type: 'whatsapp', text: 'Lead importado do WhatsApp.' }]
    };

    dataManager.addLead(lead);
    closeWhatsAppImport();
    displayLeads();
    loadLeadsInBudgetForm();
    updateDashboard();
    try { renderCampaignsDashboard(); } catch { /* no-op */ }
    alert('Lead registrado!');
}

function getMessageTemplates() {
    if (!dataManager.ui) dataManager.ui = { modules: [] };
    if (!Array.isArray(dataManager.ui.messageTemplates)) dataManager.ui.messageTemplates = [];
    return dataManager.ui.messageTemplates;
}

let currentMessageTemplateEditId = null;

function renderMessageTemplatesSettings() {
    const container = document.getElementById('messageTemplatesList');
    if (!container) return;

    const templates = getMessageTemplates();
    if (templates.length === 0) {
        container.innerHTML = '<div class="wa-hint">Nenhum modelo cadastrado.</div>';
        return;
    }

    container.innerHTML = templates.map(t => {
        const preview = (t.text || '').toString().slice(0, 120);
        const safeId = JSON.stringify(String(t.id));
        return `
            <div class="wa-queue-item">
                <div class="wa-queue-main">
                    <div class="wa-queue-title">${waEscapeHtml(t.name || 'Modelo')}</div>
                    <div class="wa-queue-meta">${waEscapeHtml(preview)}${(t.text || '').length > 120 ? '...' : ''}</div>
                </div>
                <div>
                    <button class="action-btn edit-btn" type="button" onclick="editMessageTemplate(${safeId})">Editar</button>
                    <button class="action-btn delete-btn" type="button" onclick="deleteMessageTemplate(${safeId})">Excluir</button>
                </div>
            </div>
        `;
    }).join('');
}

function openMessageTemplateForm() {
    currentMessageTemplateEditId = null;
    const form = document.getElementById('messageTemplateForm');
    if (!form) return;
    form.style.display = 'block';
    document.getElementById('messageTemplateName').value = '';
    document.getElementById('messageTemplateText').value = '';
}

function closeMessageTemplateForm() {
    const form = document.getElementById('messageTemplateForm');
    if (form) form.style.display = 'none';
    currentMessageTemplateEditId = null;
}

function editMessageTemplate(id) {
    const t = getMessageTemplates().find(x => String(x.id) === String(id));
    if (!t) return;
    currentMessageTemplateEditId = t.id;
    const form = document.getElementById('messageTemplateForm');
    if (!form) return;
    form.style.display = 'block';
    document.getElementById('messageTemplateName').value = t.name || '';
    document.getElementById('messageTemplateText').value = t.text || '';
}

function saveMessageTemplate() {
    const name = (document.getElementById('messageTemplateName')?.value || '').trim();
    const text = (document.getElementById('messageTemplateText')?.value || '').trim();
    if (!name || !text) {
        alert('Informe nome e texto do modelo.');
        return;
    }

    const templates = getMessageTemplates();
    if (currentMessageTemplateEditId) {
        const idx = templates.findIndex(t => String(t.id) === String(currentMessageTemplateEditId));
        if (idx >= 0) templates[idx] = { ...templates[idx], name, text };
    } else {
        templates.push({ id: `mt_${Date.now()}`, name, text, createdAt: new Date().toISOString() });
    }

    dataManager.ui.messageTemplates = templates;
    dataManager.saveData();

    renderMessageTemplatesSettings();
    renderLeadMessageTemplatesSelect();
    try { waRenderMessageTemplatesSelect(); } catch { /* no-op */ }
    closeMessageTemplateForm();
}

function deleteMessageTemplate(id) {
    if (!confirm('Excluir este modelo?')) return;
    const templates = getMessageTemplates().filter(t => String(t.id) !== String(id));
    dataManager.ui.messageTemplates = templates;
    dataManager.saveData();
    renderMessageTemplatesSettings();
    renderLeadMessageTemplatesSelect();
    try { waRenderMessageTemplatesSelect(); } catch { /* no-op */ }
}

function renderLeadMessageTemplatesSelect() {
    const sel = document.getElementById('leadMessageTemplateSelect');
    if (!sel) return;
    const templates = getMessageTemplates();
    sel.innerHTML = '<option value=\"\">(selecione)</option>' + templates.map(t => `<option value="${waEscapeHtml(t.id)}">${waEscapeHtml(t.name || 'Modelo')}</option>`).join('');
}

function applyTemplateTextToLead(templateText, lead) {
    const contact = {
        type: 'leads',
        id: lead?.id,
        name: lead?.name || '',
        companyOrSource: '',
        email: '',
        phone: lead?.phone || '',
        category: '',
        status: lead?.status || ''
    };
    return waBuildMessage(templateText, contact);
}

function leadGetSelectedTemplate() {
    const sel = document.getElementById('leadMessageTemplateSelect');
    if (!sel) return null;
    const id = sel.value || '';
    if (!id) return null;
    return getMessageTemplates().find(t => String(t.id) === String(id)) || null;
}

function leadOpenWhatsAppWithTemplate() {
    if (!currentLeadEditId) {
        alert('Abra um lead primeiro.');
        return;
    }
    const lead = (dataManager.leads || []).find(l => l.id === currentLeadEditId);
    if (!lead) return;
    const template = leadGetSelectedTemplate();
    if (!template) {
        alert('Selecione um modelo de mensagem.');
        return;
    }
    const phoneId = waPhoneToWhatsAppId(lead.phone || '', waCampaignState.defaultCountry || '55');
    if (!phoneId) {
        alert('Telefone invalido para WhatsApp.');
        return;
    }
    const msg = applyTemplateTextToLead(template.text || '', lead).trim();
    const url = `https://wa.me/${phoneId}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
}

function leadRegisterTemplateSend() {
    if (!currentLeadEditId) {
        alert('Abra um lead primeiro.');
        return;
    }
    const lead = (dataManager.leads || []).find(l => l.id === currentLeadEditId);
    if (!lead) return;
    const template = leadGetSelectedTemplate();
    if (!template) {
        alert('Selecione um modelo de mensagem.');
        return;
    }
    const updated = { ...lead, history: Array.isArray(lead.history) ? lead.history.slice() : [] };
    leadAddHistory(updated, 'mensagem', `Mensagem enviada (${template.name || 'modelo'}).`);
    updated.updatedAt = new Date().toISOString();
    dataManager.updateLead(currentLeadEditId, updated);
    renderLeadHistory(updated);
}

// Integrations: lead capture from external sites (Hostinger/HostGator/Google Ads/etc.)
function initLeadCaptureIntegrations() {
    const crmUrlInput = document.getElementById('leadCaptureCrmUrl');
    const snippetEl = document.getElementById('leadCaptureSnippet');
    if (!crmUrlInput || !snippetEl) return;

    const origin = (window.location.origin && window.location.origin !== 'null') ? window.location.origin : '';
    const crmUrl = origin ? `${origin}${window.location.pathname}` : window.location.href.split('?')[0].split('#')[0];
    crmUrlInput.value = crmUrl;

    // This snippet works in most website builders by redirecting to the CRM with query params.
    // The CRM will capture the lead and store it in the Leads tab, then remove the params from the URL.
    snippetEl.value =
`<form action="${crmUrl}" method="get">
  <input type="text" name="lead_name" placeholder="Nome" required>
  <input type="text" name="lead_phone" placeholder="Telefone" required>
  <input type="hidden" name="lead_source" value="site">
  <input type="text" name="lead_campaign" placeholder="Campanha">
  <input type="text" name="lead_content" placeholder="Conteúdo">
  <input type="text" name="lead_interest" placeholder="Interesse">
  <textarea name="lead_notes" placeholder="Observações"></textarea>
  <button type="submit">Enviar</button>
</form>`;
}

function copyLeadCaptureSnippet() {
    const snippetEl = document.getElementById('leadCaptureSnippet');
    if (!snippetEl) return;
    snippetEl.select();
    try {
        document.execCommand('copy');
        alert('Snippet copiado!');
    } catch {
        alert('Nao foi possivel copiar automaticamente. Copie manualmente.');
    }
}

function processLeadCaptureFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const name = (params.get('lead_name') || '').trim();
    const phone = (params.get('lead_phone') || '').trim();
    const source = (params.get('lead_source') || params.get('lead_channel') || params.get('utm_source') || '').trim();
    const campaign = (params.get('lead_campaign') || params.get('utm_campaign') || '').trim();
    const content = (params.get('lead_content') || params.get('utm_content') || '').trim();
    const interest = (params.get('lead_interest') || '').trim();
    const notes = (params.get('lead_notes') || params.get('lead_message') || '').trim();

    const hasLead = !!(name || phone || source || campaign || content || interest || notes);
    if (!hasLead) return;

    const utm = {
        utm_source: params.get('utm_source') || '',
        utm_medium: params.get('utm_medium') || '',
        utm_campaign: params.get('utm_campaign') || '',
        utm_term: params.get('utm_term') || '',
        utm_content: params.get('utm_content') || '',
        gclid: params.get('gclid') || ''
    };

    const now = new Date().toISOString();
    const lead = {
        name,
        phone,
        source: source || 'site',
        campaign,
        content,
        interest,
        status: (params.get('lead_status') || 'Novo').trim() || 'Novo',
        conversationStatus: (params.get('lead_conversation') || 'Sem contato').trim(),
        classification: (params.get('lead_classification') || '').trim(),
        notes,
        utm,
        createdAt: now,
        updatedAt: now,
        history: [{ at: now, type: 'captura', text: 'Lead capturado por link.' }]
    };

    dataManager.addLead(lead);

    displayLeads();
    loadLeadsInBudgetForm();
    updateDashboard();
    try { renderCampaignsDashboard(); } catch { /* no-op */ }

    // Remove query params to avoid duplicating the lead on refresh.
    history.replaceState({}, document.title, window.location.pathname);

    alert('Lead capturado com sucesso!');
}

// Budgets
function loadLeadsInBudgetForm() {
    const select = document.getElementById('budgetClient');
    if (!select) return;
    const leads = (dataManager.leads || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0));
    select.innerHTML = leads.map(l => `<option value="${l.id}">${(l.name || l.phone || l.id)}</option>`).join('');
}

function loadProductsInBudgetForm() {
    const select = document.getElementById('budgetProductSelect');
    select.innerHTML = dataManager.products.map(p => `<option value="${p.id}">${p.name} - ${formatMoney(p.price)}</option>`).join('');
}

function openBudgetForm() {
    currentEditId = null;
    budgetSelectedProducts = [];
    displayBudgetSelectedProducts();
    document.getElementById('budgetForm').style.display = 'block';
    document.getElementById('budgetDate').value = new Date().toISOString().split('T')[0];
    calculateBudgetTotal();
}

function closeBudgetForm() {
    document.getElementById('budgetForm').style.display = 'none';
}

function addProductToBudget() {
    const productId = parseInt(document.getElementById('budgetProductSelect').value);
    const qty = parseInt(document.getElementById('budgetProductQty').value);
    if (productId && qty > 0) {
        const existing = budgetSelectedProducts.find(p => p.id === productId);
        if (existing) {
            existing.qty += qty;
        } else {
            budgetSelectedProducts.push({id: productId, qty: qty});
        }
        displayBudgetSelectedProducts();
        calculateBudgetTotal();
    }
}

function removeProductFromBudget(id) {
    budgetSelectedProducts = budgetSelectedProducts.filter(p => p.id !== id);
    displayBudgetSelectedProducts();
    calculateBudgetTotal();
}

function displayBudgetSelectedProducts() {
    const container = document.getElementById('budgetSelectedProducts');
    container.innerHTML = budgetSelectedProducts.map(p => {
        const product = dataManager.products.find(pr => pr.id === p.id);
        if (!product) return `<div>Produto removido <button onclick="removeProductFromBudget(${p.id})">Remover</button></div>`;
        return `<div>${product.name} x${p.qty} - ${formatMoney(product.price * p.qty)} <button onclick="removeProductFromBudget(${p.id})">Remover</button></div>`;
    }).join('');
}

function calculateBudgetTotal() {
    let subtotal = budgetSelectedProducts.reduce((sum, p) => {
        const product = dataManager.products.find(pr => pr.id === p.id);
        return sum + (product ? product.price * p.qty : 0);
    }, 0);

    const discount = parseFloat(document.getElementById('budgetDiscount').value) || 0;
    const taxes = parseFloat(document.getElementById('budgetTaxes').value) || 0;
    
    const discountAmount = subtotal * (discount / 100);
    const taxesAmount = (subtotal - discountAmount) * (taxes / 100);
    const total = subtotal - discountAmount + taxesAmount;

    lastCalculatedBudgetTotals = { subtotal, discountAmount, taxesAmount, total };

    document.getElementById('budgetSubtotal').textContent = formatMoney(subtotal);
    document.getElementById('budgetDiscountAmount').textContent = formatMoney(discountAmount);
    document.getElementById('budgetTaxesAmount').textContent = formatMoney(taxesAmount);
    document.getElementById('budgetTotal').textContent = formatMoney(total);
}

function saveBudget() {
    calculateBudgetTotal();
    if (budgetSelectedProducts.length === 0) {
        alert('Adicione pelo menos um produto.');
        return;
    }
    const budget = {
        clientId: parseInt(document.getElementById('budgetClient').value),
        date: document.getElementById('budgetDate').value,
        productQuantities: budgetSelectedProducts.slice(),
        discount: parseFloat(document.getElementById('budgetDiscount').value) || 0,
        taxes: parseFloat(document.getElementById('budgetTaxes').value) || 0,
        status: normalizeStatus(document.getElementById('budgetStatus').value),
        total: lastCalculatedBudgetTotals.total
    };

    if (currentEditId) {
        dataManager.updateBudget(currentEditId, budget);
    } else {
        dataManager.addBudget(budget);
    }
    
    displayBudgets();
    closeBudgetForm();
    updateDashboard();
}

function displayBudgets() {
    const statusFilter = document.getElementById('budgetStatusFilter').value;
    let filtered = dataManager.budgets;
    if (statusFilter !== 'Todos os status') {
        filtered = dataManager.budgets.filter(b => normalizeStatus(b.status) === statusFilter);
    }
    const tbody = document.getElementById('budgetsBody');
    tbody.innerHTML = filtered.map(budget => {
        const lead = (dataManager.leads || []).find(l => l.id === budget.clientId);
        return `
            <tr>
                <td>${budget.id}</td>
                <td>${lead ? (lead.name || lead.phone || 'N/D') : 'N/D'}</td>
                <td>${budget.date}</td>
                <td>${formatMoney(budget.total)}</td>
                <td>${normalizeStatus(budget.status)}</td>
                <td>
                    <button class="action-btn edit-btn" onclick="editBudget(${budget.id})">Editar</button>
                    <button class="action-btn delete-btn" onclick="deleteBudget(${budget.id})">Excluir</button>
                </td>
            </tr>
        `;
    }).join('');
}

function editBudget(id) {
    const budget = dataManager.budgets.find(b => b.id === id);
    currentEditId = id;
    document.getElementById('budgetClient').value = budget.clientId;
    document.getElementById('budgetDate').value = budget.date;
    budgetSelectedProducts = budget.productQuantities.slice();
    displayBudgetSelectedProducts();
    document.getElementById('budgetDiscount').value = budget.discount;
    document.getElementById('budgetTaxes').value = budget.taxes;
    document.getElementById('budgetStatus').value = normalizeStatus(budget.status) || 'Rascunho';
    document.getElementById('budgetForm').style.display = 'block';
    calculateBudgetTotal();
}

function deleteBudget(id) {
    if (confirm('Tem certeza?')) {
        dataManager.deleteBudget(id);
        displayBudgets();
        updateDashboard();
    }
}

function duplicateBudget() {
    if (currentEditId) {
        const budget = dataManager.budgets.find(b => b.id === currentEditId);
        const duplicated = { ...budget };
        delete duplicated.id;
        duplicated.status = 'Rascunho';
        dataManager.addBudget(duplicated);
        displayBudgets();
        updateDashboard();
        alert('Orcamento duplicado com sucesso!');
    }
}

function exportBudgetPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const budget = dataManager.budgets.find(b => b.id === currentEditId);
    if (!budget) return;

    const lead = (dataManager.leads || []).find(l => l.id === budget.clientId);

    const subtotal = (budget.productQuantities || []).reduce((sum, pq) => {
        const product = dataManager.products.find(p => p.id === pq.id);
        return sum + (product ? product.price * pq.qty : 0);
    }, 0);
    const discountAmount = subtotal * ((budget.discount || 0) / 100);
    const taxesAmount = (subtotal - discountAmount) * ((budget.taxes || 0) / 100);

    doc.text('Relatorio de Orcamento', 20, 20);
    doc.text(`Lead: ${lead ? (lead.name || lead.phone || 'N/D') : 'N/D'}`, 20, 40);
    doc.text(`Data: ${budget.date}`, 20, 50);
    doc.text(`Status: ${normalizeStatus(budget.status)}`, 20, 60);

    let y = 80;
    doc.text('Produtos:', 20, y);
    y += 10;
    budget.productQuantities.forEach(pq => {
        const product = dataManager.products.find(p => p.id === pq.id);
        if (product) {
            doc.text(`${product.name} x${pq.qty} - ${formatMoney(product.price * pq.qty)}`, 20, y);
            y += 10;
        }
    });

    doc.text(`Subtotal: ${formatMoney(subtotal)}`, 20, y + 10);
    doc.text(`Desconto: ${budget.discount}% (-${formatMoney(discountAmount)})`, 20, y + 20);
    doc.text(`Impostos: ${budget.taxes}% (${formatMoney(taxesAmount)})`, 20, y + 30);
    doc.text(`Total: ${formatMoney(budget.total)}`, 20, y + 40);

    doc.save(`budget_${budget.id}.pdf`);
}

function filterBudgets() {
    displayBudgets();
}

// Custom Fields
let currentCustomFieldEditId = null;
let currentCustomFieldEditEntity = null;
let currentCategoryEditId = null;
let currentCategoryEditEntity = null;

function openCustomFieldForm() {
    document.getElementById('customFieldForm').style.display = 'block';
    document.getElementById('customFieldName').value = '';
    document.getElementById('customFieldType').value = 'text';
    document.getElementById('customFieldEntity').value = 'leads';
    document.getElementById('customFieldOptions').value = '';
    document.getElementById('customFieldType').disabled = false;
    document.getElementById('customFieldEntity').disabled = false;
    currentCustomFieldEditId = null;
    currentCustomFieldEditEntity = null;
    toggleCustomFieldOptions();
}

function closeCustomFieldForm() {
    document.getElementById('customFieldForm').style.display = 'none';
    currentCustomFieldEditId = null;
    currentCustomFieldEditEntity = null;
    document.getElementById('customFieldType').disabled = false;
    document.getElementById('customFieldEntity').disabled = false;
}

function saveCustomField() {
    const name = document.getElementById('customFieldName').value.trim();
    if (!name) {
        alert('O nome do campo e obrigatorio.');
        return;
    }
    const field = {
        name: name,
        type: document.getElementById('customFieldType').value,
        entity: document.getElementById('customFieldEntity').value,
        options: document.getElementById('customFieldOptions').value.split(',').map(o => o.trim()).filter(o => o)
    };
    if (currentCustomFieldEditId && currentCustomFieldEditEntity) {
        dataManager.updateCustomField(currentCustomFieldEditEntity, currentCustomFieldEditId, field);
    } else {
        dataManager.addCustomField(field.entity, field);
    }
    loadCustomFields();
    closeCustomFieldForm();
}

function toggleCustomFieldOptions() {
    const type = document.getElementById('customFieldType').value;
    document.getElementById('customFieldOptionsGroup').style.display = (type === 'select' || type === 'multiple') ? 'block' : 'none';
}

function loadCustomFields() {
    const container = document.getElementById('customFieldsList');
    container.innerHTML = '';
    ['leads', 'products'].forEach(entity => {
        if (dataManager.customFields[entity].length > 0) {
            container.innerHTML += `<h4>Campos (${entity})</h4>`;
            dataManager.customFields[entity].forEach(field => {
                container.innerHTML += `<div>${field.name} (${field.type}) <button onclick="editCustomField('${entity}', ${field.id})">Editar</button> <button onclick="deleteCustomField('${entity}', ${field.id})">Excluir</button></div>`;
            });
        }
    });
}

function editCustomField(entity, id) {
    const field = dataManager.customFields[entity].find(f => f.id === id);
    if (!field) return;
    currentCustomFieldEditId = id;
    currentCustomFieldEditEntity = entity;

    document.getElementById('customFieldForm').style.display = 'block';
    document.getElementById('customFieldName').value = field.name || '';
    document.getElementById('customFieldType').value = field.type || 'text';
    document.getElementById('customFieldEntity').value = entity;
    document.getElementById('customFieldOptions').value = (field.options || []).join(', ');

    // Avoid type/entity changes to keep data consistent
    document.getElementById('customFieldType').disabled = true;
    document.getElementById('customFieldEntity').disabled = true;

    toggleCustomFieldOptions();
}

function deleteCustomField(entity, id) {
    if (confirm('Tem certeza?')) {
        dataManager.deleteCustomField(entity, id);
        loadCustomFields();
    }
}

function renderCustomFields(entity, containerId, values = {}) {
    const container = document.getElementById(containerId);
    container.innerHTML = dataManager.customFields[entity].map(field => {
        let input = '';
        const value = values[field.name] || '';
        switch (field.type) {
            case 'text':
                input = `<input type="text" name="${field.name}" value="${value}">`;
                break;
            case 'number':
                input = `<input type="number" name="${field.name}" value="${value}">`;
                break;
            case 'date':
                input = `<input type="date" name="${field.name}" value="${value}">`;
                break;
            case 'select':
                input = `<select name="${field.name}">${field.options.map(opt => `<option value="${opt}" ${opt === value ? 'selected' : ''}>${opt}</option>`).join('')}</select>`;
                break;
            case 'multiple':
                input = `<select name="${field.name}" multiple>${field.options.map(opt => `<option value="${opt}" ${value.includes(opt) ? 'selected' : ''}>${opt}</option>`).join('')}</select>`;
                break;
        }
        return `<div class="form-group"><label>${field.name}</label>${input}</div>`;
    }).join('');
}

function getCustomFieldValues(entity, containerId) {
    const values = {};
    dataManager.customFields[entity].forEach(field => {
        const input = document.querySelector(`#${containerId} [name="${field.name}"]`);
        if (input) {
            if (field.type === 'multiple') {
                values[field.name] = Array.from(input.selectedOptions).map(opt => opt.value);
            } else {
                values[field.name] = input.value;
            }
        }
    });
    return values;
}

// Categories
function openCategoryForm() {
    document.getElementById('categoryForm').style.display = 'block';
    document.getElementById('categoryName').value = '';
    document.getElementById('categoryEntity').value = 'leads';
    document.getElementById('categoryEntity').disabled = false;
    currentCategoryEditId = null;
    currentCategoryEditEntity = null;
}

function closeCategoryForm() {
    document.getElementById('categoryForm').style.display = 'none';
    document.getElementById('categoryEntity').disabled = false;
    currentCategoryEditId = null;
    currentCategoryEditEntity = null;
}

function saveCategory() {
    const name = document.getElementById('categoryName').value.trim();
    if (!name) {
        alert('O nome da categoria e obrigatorio.');
        return;
    }
    const category = {
        name: name,
        entity: document.getElementById('categoryEntity').value
    };
    if (currentCategoryEditId && currentCategoryEditEntity) {
        dataManager.updateCategory(currentCategoryEditEntity, currentCategoryEditId, { name: category.name });
    } else {
        dataManager.addCategory(category.entity, category);
    }
    loadCategories();
    closeCategoryForm();
}

function loadCategories() {
    const container = document.getElementById('categoriesList');
    container.innerHTML = '';
    ['leads', 'products'].forEach(entity => {
        if (dataManager.categories[entity].length > 0) {
            container.innerHTML += `<h4>Categorias (${entity})</h4>`;
            dataManager.categories[entity].forEach(cat => {
                container.innerHTML += `<div>${cat.name} <button onclick="editCategory('${entity}', ${cat.id})">Editar</button> <button onclick="deleteCategory('${entity}', ${cat.id})">Excluir</button></div>`;
            });
        }
    });
    loadProductCategories();
}

function editCategory(entity, id) {
    const cat = dataManager.categories[entity].find(c => c.id === id);
    if (!cat) return;
    currentCategoryEditId = id;
    currentCategoryEditEntity = entity;
    document.getElementById('categoryForm').style.display = 'block';
    document.getElementById('categoryName').value = cat.name || '';
    document.getElementById('categoryEntity').value = entity;
    document.getElementById('categoryEntity').disabled = true;
}

function deleteCategory(entity, id) {
    if (confirm('Tem certeza?')) {
        dataManager.deleteCategory(entity, id);
        loadCategories();
    }
}

function loadProductCategories() {
    const select = document.getElementById('productCategory');
    select.innerHTML = '<option>Selecione a categoria</option>' + dataManager.categories.products.map(c => `<option>${c.name}</option>`).join('');
    const filter = document.getElementById('productCategoryFilter');
    filter.innerHTML = '<option>Todas as categorias</option>' + dataManager.categories.products.map(c => `<option>${c.name}</option>`).join('');
}

// Event listeners are initialized during window load by initAppEventListeners().
// Bootstrapping is handled by initSecurity on window load.
