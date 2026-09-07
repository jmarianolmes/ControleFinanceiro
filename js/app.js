const App = (() => {
    const STORAGE_KEY = 'finfam_data_v1';
    const SESSION_KEY = 'finfam_session';
    const GIST_KEY = 'finfam_gist_config';
    let state = {
        users: [],
        transactions: [],
        categories: [],
        settings: { currencyBR: 'R$', currencyES: '€', monthStartDay: 1 },
        currentUser: null,
        sessionExpiry: null
    };
    let charts = {};

    const el = id => document.getElementById(id);
    const fmtDate = d => new Date(d).toLocaleDateString('pt-BR');
    const fmtMoney = (v, currency) => `${currency || '€'} ${v.toFixed(2).replace('.', ',')}`;

    const hashPwd = async (pwd, salt = 'finfam2026') => {
        const enc = new TextEncoder();
        const data = enc.encode(pwd + salt);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    };

    const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    const now = () => new Date().toISOString();

    const defaultCategories = [
        { id: 'cat_aluguel', name: 'Aluguel (Receita)', type: 'income', country: 'BR', icon: '🏠' },
        { id: 'cat_cc_br', name: 'Cartão de Crédito BR', type: 'expense', country: 'BR', icon: '💳' },
        { id: 'cat_agua', name: 'Água', type: 'expense', country: 'ES', icon: '💧' },
        { id: 'cat_luz', name: 'Luz / Eletricidade', type: 'expense', country: 'ES', icon: '⚡' },
        { id: 'cat_internet', name: 'Internet + TV', type: 'expense', country: 'ES', icon: '🌐' },
        { id: 'cat_telefone', name: 'Telefone / Celular', type: 'expense', country: 'ES', icon: '📱' },
        { id: 'cat_escola', name: 'Escola das Crianças', type: 'expense', country: 'ES', icon: '🎒' },
        { id: 'cat_metro', name: 'Transporte / Metro', type: 'expense', country: 'ES', icon: '🚇' },
        { id: 'cat_saude', name: 'Seguro Saúde', type: 'expense', country: 'ES', icon: '🏥' },
        { id: 'cat_alimentacao', name: 'Alimentação / Mercado', type: 'expense', country: 'ES', icon: '🛒' },
        { id: 'cat_lazer', name: 'Lazer / Entretenimento', type: 'expense', country: 'ES', icon: '🎬' },
        { id: 'cat_compras', name: 'Compras / Utensílios', type: 'expense', country: 'ES', icon: '🛍️' },
        { id: 'cat_trabalho', name: 'Material de Trabalho', type: 'expense', country: 'ES', icon: '💼' },
        { id: 'cat_outros_br', name: 'Outros (BR)', type: 'expense', country: 'BR', icon: '📋' },
        { id: 'cat_outros_es', name: 'Outros (ES)', type: 'expense', country: 'ES', icon: '📋' }
    ];

    const initState = () => {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            try {
                state = JSON.parse(raw);
                if (!state.categories || state.categories.length === 0) state.categories = [...defaultCategories];
                if (!state.settings) state.settings = { currencyBR: 'R$', currencyES: '€', monthStartDay: 1 };
            } catch (e) { resetState(); }
        } else { resetState(); }
    };

    const resetState = () => {
        state = {
            users: [], transactions: [], categories: [...defaultCategories],
            settings: { currencyBR: 'R$', currencyES: '€', monthStartDay: 1 },
            currentUser: null, sessionExpiry: null
        };
        saveState();
    };

    const saveState = () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    };

    const getSession = () => {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        try {
            const s = JSON.parse(raw);
            if (new Date(s.expires) < new Date()) {
                sessionStorage.removeItem(SESSION_KEY);
                return null;
            }
            return s;
        } catch (e) { return null; }
    };

    const setSession = (userId, hours = 8) => {
        const expires = new Date(Date.now() + hours * 3600000).toISOString();
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId, expires }));
        state.currentUser = state.users.find(u => u.id === userId);
        state.sessionExpiry = expires;
    };

    const clearSession = () => {
        sessionStorage.removeItem(SESSION_KEY);
        state.currentUser = null;
        state.sessionExpiry = null;
    };

    const isSetup = () => state.users.length > 0;
    const isLoggedIn = () => {
        const s = getSession();
        if (!s) return false;
        state.currentUser = state.users.find(u => u.id === s.userId);
        return true;
    };

    const getMonthRange = (year, month) => {
        const start = new Date(year, month - 1, state.settings.monthStartDay || 1);
        const end = new Date(year, month, state.settings.monthStartDay || 1);
        end.setMilliseconds(-1);
        return { start, end };
    };

    const getTransactionsForMonth = (year, month) => {
        const { start, end } = getMonthRange(year, month);
        return state.transactions.filter(t => {
            const d = new Date(t.date);
            return d >= start && d <= end;
        }).sort((a, b) => new Date(b.date) - new Date(a.date));
    };

    const getCurrentMonth = () => {
        const d = new Date();
        return { year: d.getFullYear(), month: d.getMonth() + 1 };
    };

    const getMonthTotals = (year, month) => {
        const txs = getTransactionsForMonth(year, month);
        const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        return { income, expense, balance: income - expense, count: txs.length };
    };

    const getCategoryTotals = (year, month) => {
        const txs = getTransactionsForMonth(year, month);
        const map = {};
        txs.forEach(t => {
            if (!map[t.categoryId]) map[t.categoryId] = { amount: 0, count: 0, category: state.categories.find(c => c.id === t.categoryId) };
            map[t.categoryId].amount += t.amount;
            map[t.categoryId].count++;
        });
        return Object.values(map).sort((a, b) => b.amount - a.amount);
    };

    const getYearlyData = (year) => {
        const months = [];
        for (let m = 1; m <= 12; m++) { months.push(getMonthTotals(year, m)); }
        return months;
    };

    const renderLogin = () => {
        const app = el('app');
        app.innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a5f 0%,#2c5282 50%,#059669 100%)">
            <div style="background:#fff;border-radius:20px;padding:40px;max-width:420px;width:90%;box-shadow:0 25px 80px rgba(0,0,0,.3)">
                <div style="text-align:center;margin-bottom:28px">
                    <div style="width:64px;height:64px;background:var(--navy);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px">💰</div>
                    <h1 style="margin:0;font-size:24px;color:var(--navy)">Controle Financeiro</h1>
                    <p style="margin:8px 0 0;color:var(--text-light);font-size:14px">Familiar - Brasil & Espanha</p>
                </div>
                <div id="loginForm">
                    <div class="form-group"><label class="form-label">Email</label><input type="email" id="loginEmail" class="input-field" placeholder="seu@email.com"></div>
                    <div class="form-group"><label class="form-label">Senha</label><input type="password" id="loginPwd" class="input-field" placeholder="Sua senha"></div>
                    <button class="btn-primary" style="width:100%;padding:14px" onclick="App.doLogin()">Entrar</button>
                    <p style="text-align:center;margin-top:16px;font-size:13px;color:var(--text-light)">Acesso exclusivo para voce e sua esposa.</p>
                </div>
            </div>
        </div>`;
    };

    const renderSetup = () => {
        const app = el('app');
        app.innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a5f 0%,#2c5282 50%,#059669 100%)">
            <div style="background:#fff;border-radius:20px;padding:40px;max-width:480px;width:90%;box-shadow:0 25px 80px rgba(0,0,0,.3)">
                <div style="text-align:center;margin-bottom:28px">
                    <div style="width:64px;height:64px;background:var(--navy);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px">🔐</div>
                    <h1 style="margin:0;font-size:24px;color:var(--navy)">Configuracao Inicial</h1>
                    <p style="margin:8px 0 0;color:var(--text-light);font-size:14px">Cadastre o primeiro usuario administrador</p>
                </div>
                <div id="setupForm">
                    <div class="form-group"><label class="form-label">Nome Completo</label><input type="text" id="setupName" class="input-field" placeholder="Ex: Joao Silva"></div>
                    <div class="form-group"><label class="form-label">Email</label><input type="email" id="setupEmail" class="input-field" placeholder="joao@email.com"></div>
                    <div class="form-group"><label class="form-label">Senha (minimo 6 caracteres)</label><input type="password" id="setupPwd" class="input-field" placeholder="Crie uma senha segura"></div>
                    <div class="form-group"><label class="form-label">Confirmar Senha</label><input type="password" id="setupPwd2" class="input-field" placeholder="Repita a senha"></div>
                    <button class="btn-primary" style="width:100%;padding:14px" onclick="App.doSetup()">Criar Conta Administrador</button>
                </div>
            </div>
        </div>`;
    };

    const renderApp = () => {
        const app = el('app');
        app.innerHTML = `<div class="sidebar">
            <div class="logo">
                <div style="display:flex;align-items:center;gap:12px">
                    <div style="width:40px;height:40px;background:rgba(255,255,255,.15);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px">💰</div>
                    <div><div style="font-weight:700;font-size:16px">FinFam</div><div style="font-size:11px;opacity:.7">BR & ES</div></div>
                </div>
            </div>
            <div style="flex:1;padding:12px 0">
                <div class="nav-item active" data-page="dashboard" onclick="App.nav(this)"><span>📊</span> Dashboard</div>
                <div class="nav-item" data-page="transactions" onclick="App.nav(this)"><span>📝</span> Lancamentos</div>
                <div class="nav-item" data-page="reports" onclick="App.nav(this)"><span>📈</span> Relatorio Mensal</div>
                <div class="nav-item" data-page="settings" onclick="App.nav(this)"><span>⚙️</span> Configuracoes</div>
            </div>
            <div style="padding:16px;border-top:1px solid rgba(255,255,255,.1)">
                <div style="display:flex;align-items:center;gap:10px">
                    <div class="user-avatar">${state.currentUser.name.charAt(0).toUpperCase()}</div>
                    <div style="flex:1;min-width:0">
                        <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${state.currentUser.name}</div>
                        <div style="font-size:11px;opacity:.7">${state.currentUser.role === 'admin' ? 'Admin' : 'Usuario'}</div>
                    </div>
                    <button onclick="App.logout()" style="background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:18px;padding:4px" title="Sair">🚪</button>
                </div>
            </div>
        </div>
        <div class="main-content">
            <div id="dashboard" class="page active">${renderDashboard()}</div>
            <div id="transactions" class="page">${renderTransactions()}</div>
            <div id="reports" class="page">${renderReports()}</div>
            <div id="settings" class="page">${renderSettings()}</div>
        </div>
        <div id="modalOverlay" class="modal-overlay"><div id="modalContent" class="modal"></div></div>
        <div id="toast" class="toast"></div>`;
        renderDashboardCharts();
    };

    const renderDashboard = () => {
        const { year, month } = getCurrentMonth();
        const totals = getMonthTotals(year, month);
        const catTotals = getCategoryTotals(year, month);
        const recent = state.transactions.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
        const monthName = new Date(year, month - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
            <div>
                <h2 style="margin:0;font-size:22px;color:var(--navy)">Dashboard</h2>
                <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Resumo de ${monthName}</p>
            </div>
            <div class="sync-status" id="syncStatus"><span>💾</span> Dados locais</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px">
            <div class="card stat-card"><div class="stat-label">Saldo do Mes</div><div class="stat-value ${totals.balance >= 0 ? 'emerald-text' : 'danger-text'}">${fmtMoney(totals.balance, totals.balance >= 0 ? state.settings.currencyES : '')}</div></div>
            <div class="card stat-card"><div class="stat-label">Entradas</div><div class="stat-value emerald-text">${fmtMoney(totals.income, state.settings.currencyES)}</div></div>
            <div class="card stat-card"><div class="stat-label">Saidas</div><div class="stat-value danger-text">${fmtMoney(totals.expense, state.settings.currencyES)}</div></div>
            <div class="card stat-card"><div class="stat-label">Lancamentos</div><div class="stat-value" style="color:var(--navy)">${totals.count}</div></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:16px;margin-bottom:24px">
            <div class="card" style="padding:20px">
                <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">📊 Despesas por Categoria</h3>
                <div class="chart-container"><canvas id="chartCategories"></canvas></div>
            </div>
            <div class="card" style="padding:20px">
                <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">📈 Evolucao Anual</h3>
                <div class="chart-container"><canvas id="chartYearly"></canvas></div>
            </div>
        </div>
        <div class="card" style="padding:20px">
            <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">🕐 Lancamentos Recentes</h3>
            ${recent.length === 0 ? `<div class="empty-state"><div style="font-size:48px;margin-bottom:12px">📝</div><p>Sem lancamentos ainda</p><button class="btn-primary" onclick="App.navTo('transactions')" style="margin-top:12px">Fazer Primeiro Lancamento</button></div>` : `
            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>Data</th><th>Categoria</th><th>Descricao</th><th>Pais</th><th>Valor</th><th>Tipo</th></tr></thead>
                    <tbody>${recent.map(t => {
                        const cat = state.categories.find(c => c.id === t.categoryId) || { name: 'Desconhecida', icon: '❓' };
                        return `<tr><td>${fmtDate(t.date)}</td><td><span class="category-tag">${cat.icon} ${cat.name}</span></td><td>${t.description || '-'}</td><td><span class="badge ${t.country === 'BR' ? 'badge-info' : 'badge-warning'}">${t.country === 'BR' ? '🇧🇷 BR' : '🇪🇸 ES'}</span></td><td style="font-weight:600;color:${t.type === 'income' ? 'var(--emerald)' : 'var(--danger)'}">${fmtMoney(t.amount, t.country === 'BR' ? state.settings.currencyBR : state.settings.currencyES)}</td><td><span class="badge ${t.type === 'income' ? 'badge-success' : 'badge-danger'}">${t.type === 'income' ? 'Entrada' : 'Saida'}</span></td></tr>`;
                    }).join('')}</tbody>
                </table>
            </div>`}
        </div>`;
    };

    const renderDashboardCharts = () => {
        const { year, month } = getCurrentMonth();
        const catTotals = getCategoryTotals(year, month);
        if (charts.categories) charts.categories.destroy();
        if (charts.yearly) charts.yearly.destroy();

        const ctx1 = document.getElementById('chartCategories');
        if (ctx1 && catTotals.length > 0) {
            charts.categories = new Chart(ctx1, {
                type: 'doughnut',
                data: {
                    labels: catTotals.map(c => c.category.name),
                    datasets: [{
                        data: catTotals.map(c => c.amount),
                        backgroundColor: ['#1e3a5f', '#059669', '#dc2626', '#d97706', '#7c3aed', '#0891b2', '#be123c', '#4338ca', '#047857', '#b45309'],
                        borderWidth: 2, borderColor: '#fff'
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { padding: 16, font: { size: 12 } } },
                        tooltip: { callbacks: { label: (ctx) => { const val = ctx.raw; const total = ctx.dataset.data.reduce((a, b) => a + b, 0); const pct = ((val / total) * 100).toFixed(1); return `${ctx.label}: €${val.toFixed(2)} (${pct}%)`; } } }
                    }
                }
            });
        }

        const ctx2 = document.getElementById('chartYearly');
        if (ctx2) {
            const yearly = getYearlyData(year);
            charts.yearly = new Chart(ctx2, {
                type: 'bar',
                data: {
                    labels: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
                    datasets: [
                        { label: 'Entradas', data: yearly.map(m => m.income), backgroundColor: '#059669', borderRadius: 4 },
                        { label: 'Saidas', data: yearly.map(m => m.expense), backgroundColor: '#dc2626', borderRadius: 4 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } },
                    plugins: { legend: { position: 'bottom' } }
                }
            });
        }
    };

    const renderTransactions = () => {
        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
            <div><h2 style="margin:0;font-size:22px;color:var(--navy)">Lancamentos</h2><p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Gerencie entradas e saidas</p></div>
            <button class="btn-primary" onclick="App.openTransactionModal()"><span style="margin-right:6px">+</span> Novo Lancamento</button>
        </div>
        <div class="card" style="padding:20px">
            <div class="filter-bar">
                <div style="display:flex;align-items:center;gap:8px"><label style="font-size:13px;font-weight:600;color:var(--text-light)">Mes:</label><input type="month" id="txFilterMonth" class="input-field" style="width:160px" onchange="App.filterTransactions()" value="${new Date().toISOString().slice(0, 7)}"></div>
                <div style="display:flex;align-items:center;gap:8px"><label style="font-size:13px;font-weight:600;color:var(--text-light)">Tipo:</label><select id="txFilterType" class="input-field" style="width:130px" onchange="App.filterTransactions()"><option value="all">Todos</option><option value="income">Entradas</option><option value="expense">Saidas</option></select></div>
                <div style="display:flex;align-items:center;gap:8px"><label style="font-size:13px;font-weight:600;color:var(--text-light)">Pais:</label><select id="txFilterCountry" class="input-field" style="width:120px" onchange="App.filterTransactions()"><option value="all">Todos</option><option value="BR">Brasil</option><option value="ES">Espanha</option></select></div>
                <input type="text" id="txFilterSearch" class="input-field" style="flex:1;min-width:200px" placeholder="Buscar descricao..." oninput="App.filterTransactions()">
            </div>
            <div id="transactionsTable">${renderTransactionsTable()}</div>
        </div>`;
    };

    const renderTransactionsTable = () => {
        const month = el('txFilterMonth')?.value || new Date().toISOString().slice(0, 7);
        const type = el('txFilterType')?.value || 'all';
        const country = el('txFilterCountry')?.value || 'all';
        const search = (el('txFilterSearch')?.value || '').toLowerCase();
        const [y, m] = month.split('-').map(Number);
        let txs = state.transactions.filter(t => { const d = new Date(t.date); return d.getFullYear() === y && d.getMonth() + 1 === m; });
        if (type !== 'all') txs = txs.filter(t => t.type === type);
        if (country !== 'all') txs = txs.filter(t => t.country === country);
        if (search) txs = txs.filter(t => (t.description || '').toLowerCase().includes(search));
        txs.sort((a, b) => new Date(b.date) - new Date(a.date));
        if (txs.length === 0) return `<div class="empty-state"><div style="font-size:48px;margin-bottom:12px">🔍</div><p>Nenhum lancamento encontrado</p></div>`;
        return `<div class="table-container">
            <table class="data-table">
                <thead><tr><th>Data</th><th>Categoria</th><th>Descricao</th><th>Pais</th><th>Valor</th><th>Tipo</th><th style="text-align:center">Acoes</th></tr></thead>
                <tbody>${txs.map(t => {
                    const cat = state.categories.find(c => c.id === t.categoryId) || { name: 'Desconhecida', icon: '❓' };
                    return `<tr><td>${fmtDate(t.date)}</td><td><span class="category-tag">${cat.icon} ${cat.name}</span></td><td>${t.description || '-'}</td><td><span class="badge ${t.country === 'BR' ? 'badge-info' : 'badge-warning'}">${t.country === 'BR' ? '🇧🇷 BR' : '🇪🇸 ES'}</span></td><td style="font-weight:600;color:${t.type === 'income' ? 'var(--emerald)' : 'var(--danger)'}">${fmtMoney(t.amount, t.country === 'BR' ? state.settings.currencyBR : state.settings.currencyES)}</td><td><span class="badge ${t.type === 'income' ? 'badge-success' : 'badge-danger'}">${t.type === 'income' ? 'Entrada' : 'Saida'}</span></td><td style="text-align:center"><button onclick='App.editTransaction("${t.id}")' style="background:none;border:none;cursor:pointer;font-size:16px;padding:4px" title="Editar">✏️</button><button onclick='App.deleteTransaction("${t.id}")' style="background:none;border:none;cursor:pointer;font-size:16px;padding:4px" title="Excluir">🗑️</button></td></tr>`;
                }).join('')}</tbody>
            </table>
        </div>`;
    };

    const renderReports = () => {
        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
            <div><h2 style="margin:0;font-size:22px;color:var(--navy)">Relatorio Mensal</h2><p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Analise detalhada por pais e categoria</p></div>
            <div style="display:flex;gap:8px">
                <input type="month" id="reportMonth" class="input-field" style="width:160px" value="${new Date().toISOString().slice(0, 7)}" onchange="App.renderReportContent()">
                <button class="btn-secondary" onclick="App.exportReportPDF()">📄 Exportar</button>
            </div>
        </div>
        <div id="reportContent">${renderReportContent(new Date().getFullYear(), new Date().getMonth() + 1)}</div>`;
    };

    const renderReportContent = (year, month) => {
        const totals = getMonthTotals(year, month);
        const catTotals = getCategoryTotals(year, month);
        const { start, end } = getMonthRange(year, month);
        const brTxs = state.transactions.filter(t => t.country === 'BR' && new Date(t.date) >= start && new Date(t.date) <= end).sort((a, b) => new Date(b.date) - new Date(a.date));
        const esTxs = state.transactions.filter(t => t.country === 'ES' && new Date(t.date) >= start && new Date(t.date) <= end).sort((a, b) => new Date(b.date) - new Date(a.date));
        const brIncome = brTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const brExpense = brTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        const esIncome = esTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const esExpense = esTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        const monthLabel = new Date(year, month - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-bottom:24px">
            <div class="card" style="padding:20px">
                <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">🇧🇷 Brasil</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div><div class="stat-label">Entradas</div><div class="stat-value" style="color:var(--emerald);font-size:20px">${fmtMoney(brIncome, state.settings.currencyBR)}</div></div>
                    <div><div class="stat-label">Saidas</div><div class="stat-value" style="color:var(--danger);font-size:20px">${fmtMoney(brExpense, state.settings.currencyBR)}</div></div>
                    <div style="grid-column:1/-1"><div class="stat-label">Saldo BR</div><div class="stat-value" style="color:${brIncome - brExpense >= 0 ? 'var(--emerald)' : 'var(--danger)'};font-size:22px">${fmtMoney(brIncome - brExpense, state.settings.currencyBR)}</div></div>
                </div>
            </div>
            <div class="card" style="padding:20px">
                <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">🇪🇸 Espanha</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div><div class="stat-label">Entradas</div><div class="stat-value" style="color:var(--emerald);font-size:20px">${fmtMoney(esIncome, state.settings.currencyES)}</div></div>
                    <div><div class="stat-label">Saidas</div><div class="stat-value" style="color:var(--danger);font-size:20px">${fmtMoney(esExpense, state.settings.currencyES)}</div></div>
                    <div style="grid-column:1/-1"><div class="stat-label">Saldo ES</div><div class="stat-value" style="color:${esIncome - esExpense >= 0 ? 'var(--emerald)' : 'var(--danger)'};font-size:22px">${fmtMoney(esIncome - esExpense, state.settings.currencyES)}</div></div>
                </div>
            </div>
        </div>
        <div class="card" style="padding:20px;margin-bottom:24px">
            <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">📊 Despesas por Categoria - ${monthLabel}</h3>
            <div style="display:flex;flex-direction:column;gap:10px">
                ${catTotals.length === 0 ? '<p style="color:var(--text-light)">Sem despesas no periodo</p>' : catTotals.map(c => {
                    const totalExpense = catTotals.reduce((s, x) => s + x.amount, 0);
                    const pct = totalExpense > 0 ? ((c.amount / totalExpense) * 100).toFixed(1) : 0;
                    return `<div style="display:flex;align-items:center;gap:12px"><div style="width:120px;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.category.icon} ${c.category.name}</div><div style="flex:1"><div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%;background:${c.category.type === 'income' ? 'var(--emerald)' : 'var(--navy)'}"></div></div></div><div style="width:80px;text-align:right;font-size:13px;font-weight:600">${fmtMoney(c.amount, c.category.country === 'BR' ? state.settings.currencyBR : state.settings.currencyES)}</div><div style="width:50px;text-align:right;font-size:12px;color:var(--text-light)">${pct}%</div></div>`;
                }).join('')}
            </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:16px">
            <div class="card" style="padding:20px">
                <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">🇧🇷 Lancamentos Brasil</h3>
                ${brTxs.length === 0 ? '<p style="color:var(--text-light)">Sem lancamentos</p>' : `
                <div class="table-container">
                    <table class="data-table"><thead><tr><th>Data</th><th>Categoria</th><th>Valor</th></tr></thead>
                    <tbody>${brTxs.map(t => { const cat = state.categories.find(c => c.id === t.categoryId) || { name: '?', icon: '' }; return `<tr><td>${fmtDate(t.date)}</td><td>${cat.icon} ${cat.name}</td><td style="color:${t.type === 'income' ? 'var(--emerald)' : 'var(--danger)'};font-weight:600">${fmtMoney(t.amount, state.settings.currencyBR)}</td></tr>`; }).join('')}</tbody>
                    </table>
                </div>`}
            </div>
            <div class="card" style="padding:20px">
                <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">🇪🇸 Lancamentos Espanha</h3>
                ${esTxs.length === 0 ? '<p style="color:var(--text-light)">Sem lancamentos</p>' : `
                <div class="table-container">
                    <table class="data-table"><thead><tr><th>Data</th><th>Categoria</th><th>Valor</th></tr></thead>
                    <tbody>${esTxs.map(t => { const cat = state.categories.find(c => c.id === t.categoryId) || { name: '?', icon: '' }; return `<tr><td>${fmtDate(t.date)}</td><td>${cat.icon} ${cat.name}</td><td style="color:${t.type === 'income' ? 'var(--emerald)' : 'var(--danger)'};font-weight:600">${fmtMoney(t.amount, state.settings.currencyES)}</td></tr>`; }).join('')}</tbody>
                    </table>
                </div>`}
            </div>
        </div>`;
    };

    const renderSettings = () => {
        const gistCfg = JSON.parse(localStorage.getItem(GIST_KEY) || '{}');
        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
            <div><h2 style="margin:0;font-size:22px;color:var(--navy)">Configuracoes</h2><p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Gerencie usuarios, dados e sincronizacao</p></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:16px">
            <div class="card" style="padding:24px">
                <h3 style="margin:0 0 20px;font-size:16px;color:var(--navy)">👥 Usuarios</h3>
                <div id="usersList">${renderUsersList()}</div>
                ${state.currentUser?.role === 'admin' ? `
                <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
                    <h4 style="margin:0 0 12px;font-size:14px;color:var(--text-light)">Adicionar Novo Usuario</h4>
                    <div class="form-group"><label class="form-label">Nome</label><input type="text" id="newUserName" class="input-field" placeholder="Nome completo"></div>
                    <div class="form-group"><label class="form-label">Email</label><input type="email" id="newUserEmail" class="input-field" placeholder="email@exemplo.com"></div>
                    <div class="form-group"><label class="form-label">Senha Temporaria</label><input type="text" id="newUserPwd" class="input-field" placeholder="Senha para primeiro acesso" value="senha123"></div>
                    <button class="btn-primary" onclick="App.addUser()" style="width:100%">Adicionar Usuario</button>
                </div>` : '<p style="font-size:13px;color:var(--text-light)">Apenas o administrador pode adicionar usuarios.</p>'}
            </div>
            <div class="card" style="padding:24px">
                <h3 style="margin:0 0 20px;font-size:16px;color:var(--navy)">💾 Dados & Backup</h3>
                <div style="display:flex;flex-direction:column;gap:12px">
                    <button class="btn-secondary" onclick="App.exportData()" style="width:100%;text-align:left;display:flex;align-items:center;gap:10px"><span>📤</span> Exportar Dados (JSON)</button>
                    <button class="btn-secondary" onclick="App.importData()" style="width:100%;text-align:left;display:flex;align-items:center;gap:10px"><span>📥</span> Importar Dados (JSON)</button>
                    <button class="btn-danger" onclick="App.clearAllData()" style="width:100%;text-align:left;display:flex;align-items:center;gap:10px"><span>🗑️</span> Limpar Todos os Dados</button>
                    <input type="file" id="importFile" accept=".json" style="display:none" onchange="App.handleImport(event)">
                </div>
            </div>
            <div class="card" style="padding:24px">
                <h3 style="margin:0 0 20px;font-size:16px;color:var(--navy)">🌐 Sincronizacao (GitHub Gist)</h3>
                <p style="font-size:13px;color:var(--text-light);margin-bottom:16px">Sincronize dados entre dispositivos usando GitHub Gist gratuitamente.</p>
                <div class="form-group"><label class="form-label">GitHub Token (classic)</label><input type="password" id="gistToken" class="input-field" placeholder="ghp_xxxxxxxxxxxx" value="${gistCfg.token || ''}"></div>
                <div class="form-group"><label class="form-label">Gist ID (deixe em branco para criar novo)</label><input type="text" id="gistId" class="input-field" placeholder="abc123..." value="${gistCfg.gistId || ''}"></div>
                <div style="display:flex;gap:8px">
                    <button class="btn-primary" onclick="App.saveGistConfig()" style="flex:1">Salvar Config</button>
                    <button class="btn-secondary" onclick="App.syncToGist()" style="flex:1">☁️ Enviar</button>
                    <button class="btn-secondary" onclick="App.syncFromGist()" style="flex:1">⬇️ Baixar</button>
                </div>
                <div id="gistStatus" style="margin-top:12px;font-size:13px"></div>
            </div>
            <div class="card" style="padding:24px">
                <h3 style="margin:0 0 20px;font-size:16px;color:var(--navy)">⚙️ Preferencias</h3>
                <div class="form-group"><label class="form-label">Moeda Brasil</label><input type="text" id="cfgCurrencyBR" class="input-field" value="${state.settings.currencyBR}"></div>
                <div class="form-group"><label class="form-label">Moeda Espanha</label><input type="text" id="cfgCurrencyES" class="input-field" value="${state.settings.currencyES}"></div>
                <div class="form-group"><label class="form-label">Dia de Inicio do Mes</label><input type="number" id="cfgMonthStart" class="input-field" value="${state.settings.monthStartDay}" min="1" max="31"></div>
                <button class="btn-primary" onclick="App.saveSettings()" style="width:100%">Salvar Preferencias</button>
            </div>
        </div>`;
    };

    const renderUsersList = () => {
        if (state.users.length === 0) return '<p style="color:var(--text-light)">Nenhum usuario cadastrado</p>';
        return `<div style="display:flex;flex-direction:column;gap:10px">${state.users.map(u => `
            <div style="display:flex;align-items:center;gap:12px;padding:12px;background:#f8fafc;border-radius:8px">
                <div class="user-avatar" style="width:32px;height:32px;font-size:12px">${u.name.charAt(0).toUpperCase()}</div>
                <div style="flex:1"><div style="font-weight:600;font-size:14px">${u.name}</div><div style="font-size:12px;color:var(--text-light)">${u.email}</div></div>
                <span class="badge ${u.role === 'admin' ? 'badge-info' : 'badge-success'}">${u.role === 'admin' ? 'Admin' : 'Usuario'}</span>
                ${u.forcePasswordChange ? '<span class="badge badge-warning">Alterar Senha</span>' : ''}
            </div>`).join('')}</div>`;
    };

    const openModal = content => { el('modalContent').innerHTML = content; el('modalOverlay').classList.add('active'); };
    const closeModal = () => { el('modalOverlay').classList.remove('active'); };
    const showToast = (msg, type = 'success') => {
        const t = el('toast');
        t.textContent = msg;
        t.className = `toast ${type} show`;
        setTimeout(() => t.classList.remove('show'), 3000);
    };

    const openTransactionModal = (tx = null) => {
        const isEdit = !!tx;
        const cats = state.categories;
        const countries = [{ value: 'BR', label: '🇧🇷 Brasil' }, { value: 'ES', label: '🇪🇸 Espanha' }];
        const content = `
        <div class="modal-header"><div class="modal-title">${isEdit ? '✏️ Editar' : '➕ Novo'} Lancamento</div><button class="close-btn" onclick="App.closeModal()">&times;</button></div>
        <div class="form-group">
            <label class="form-label">Tipo</label>
            <div style="display:flex;gap:8px">
                <button type="button" id="btnTypeIncome" class="btn-primary" style="flex:1;background:var(--emerald)" onclick="App.setTxType('income')">Entrada</button>
                <button type="button" id="btnTypeExpense" class="btn-secondary" style="flex:1" onclick="App.setTxType('expense')">Saida</button>
            </div>
            <input type="hidden" id="txType" value="${tx?.type || 'expense'}">
        </div>
        <div class="form-group"><label class="form-label">Data</label><input type="date" id="txDate" class="input-field" value="${tx?.date || new Date().toISOString().slice(0, 10)}"></div>
        <div class="form-group"><label class="form-label">Pais</label><select id="txCountry" class="input-field" onchange="App.updateTxCategories()">${countries.map(c => `<option value="${c.value}" ${tx?.country === c.value ? 'selected' : ''}>${c.label}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Categoria</label><select id="txCategory" class="input-field">${cats.filter(c => c.country === (tx?.country || 'ES') && c.type === (tx?.type || 'expense')).map(c => `<option value="${c.id}" ${tx?.categoryId === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Valor</label><input type="number" id="txAmount" class="input-field" step="0.01" min="0" placeholder="0,00" value="${tx?.amount || ''}"></div>
        <div class="form-group"><label class="form-label">Descricao (opcional)</label><input type="text" id="txDesc" class="input-field" placeholder="Ex: Conta de luz janeiro" value="${tx?.description || ''}"></div>
        <div style="display:flex;gap:10px;margin-top:20px">
            <button class="btn-primary" style="flex:1" onclick='App.saveTransaction("${tx?.id || ''}")'>${isEdit ? 'Salvar Alteracoes' : 'Salvar Lancamento'}</button>
            ${isEdit ? `<button class="btn-danger" onclick='App.confirmDelete("${tx.id}")'>Excluir</button>` : ''}
        </div>`;
        openModal(content);
        setTimeout(() => App.updateTxTypeUI(tx?.type || 'expense'), 10);
    };

    const setTxType = type => { el('txType').value = type; updateTxTypeUI(type); updateTxCategories(); };
    const updateTxTypeUI = type => {
        const btnInc = el('btnTypeIncome');
        const btnExp = el('btnTypeExpense');
        if (!btnInc || !btnExp) return;
        if (type === 'income') {
            btnInc.className = 'btn-primary'; btnInc.style.background = 'var(--emerald)'; btnExp.className = 'btn-secondary'; btnExp.style.background = '';
        } else {
            btnInc.className = 'btn-secondary'; btnInc.style.background = ''; btnExp.className = 'btn-primary'; btnExp.style.background = 'var(--danger)';
        }
    };
    const updateTxCategories = () => {
        const country = el('txCountry').value;
        const type = el('txType').value;
        const select = el('txCategory');
        const cats = state.categories.filter(c => c.country === country && c.type === type);
        select.innerHTML = cats.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
    };

    const saveTransaction = async txId => {
        const type = el('txType').value;
        const date = el('txDate').value;
        const country = el('txCountry').value;
        const categoryId = el('txCategory').value;
        const amount = parseFloat(el('txAmount').value);
        const description = el('txDesc').value.trim();
        if (!date || !amount || amount <= 0) { showToast('Preencha data e valor validos', 'error'); return; }
        const tx = { id: txId || generateId(), type, date, country, categoryId, amount, description, createdAt: txId ? undefined : now(), updatedAt: now(), createdBy: state.currentUser.id };
        if (txId) {
            const idx = state.transactions.findIndex(t => t.id === txId);
            if (idx >= 0) { tx.createdAt = state.transactions[idx].createdAt; state.transactions[idx] = tx; }
        } else { state.transactions.push(tx); }
        saveState(); closeModal(); showToast(txId ? 'Lancamento atualizado!' : 'Lancamento salvo!');
        refreshCurrentPage();
    };

    const confirmDelete = txId => { if (!confirm('Tem certeza que deseja excluir este lancamento?')) return; deleteTransaction(txId); closeModal(); };
    const deleteTransaction = txId => { state.transactions = state.transactions.filter(t => t.id !== txId); saveState(); showToast('Lancamento excluido'); refreshCurrentPage(); };
    const editTransaction = txId => { const tx = state.transactions.find(t => t.id === txId); if (tx) openTransactionModal(tx); };
    const filterTransactions = () => { el('transactionsTable').innerHTML = renderTransactionsTable(); };
    const renderReportContentWrapper = () => {
        const month = el('reportMonth')?.value || new Date().toISOString().slice(0, 7);
        const [y, m] = month.split('-').map(Number);
        el('reportContent').innerHTML = renderReportContent(y, m);
    };
    const exportReportPDF = () => {
        const month = el('reportMonth')?.value || new Date().toISOString().slice(0, 7);
        const content = el('reportContent').innerHTML;
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`<html><head><title>Relatorio ${month}</title><style>body{font-family:Inter,sans-serif;padding:40px;color:#1e293b}h2{color:#1e3a5f}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:10px;border:1px solid #e2e8f0;text-align:left}th{background:#f8fafc}</style></head><body><h2>Relatorio Financeiro - ${month}</h2>${content}</body></html>`);
        printWindow.document.close();
        printWindow.print();
    };

    const addUser = async () => {
        const name = el('newUserName').value.trim();
        const email = el('newUserEmail').value.trim();
        const pwd = el('newUserPwd').value;
        if (!name || !email || !pwd) { showToast('Preencha todos os campos', 'error'); return; }
        if (state.users.find(u => u.email === email)) { showToast('Email ja cadastrado', 'error'); return; }
        const hash = await hashPwd(pwd);
        const user = { id: generateId(), name, email, passwordHash: hash, role: 'user', forcePasswordChange: true, createdAt: now() };
        state.users.push(user); saveState();
        el('newUserName').value = ''; el('newUserEmail').value = ''; el('newUserPwd').value = 'senha123';
        showToast('Usuario adicionado! Senha temporaria: ' + pwd);
        refreshCurrentPage();
    };

    const exportData = () => {
        const dataStr = JSON.stringify(state, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `finfam_backup_${new Date().toISOString().slice(0, 10)}.json`; a.click();
        URL.revokeObjectURL(url); showToast('Dados exportados!');
    };
    const importData = () => { el('importFile').click(); };
    const handleImport = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const data = JSON.parse(ev.target.result);
                if (!data.transactions || !data.categories) { showToast('Arquivo invalido', 'error'); return; }
                if (confirm('Isso substituira todos os dados atuais. Deseja continuar?')) {
                    state = { ...state, ...data, currentUser: state.currentUser, sessionExpiry: state.sessionExpiry };
                    saveState(); showToast('Dados importados com sucesso!'); location.reload();
                }
            } catch (err) { showToast('Erro ao importar: ' + err.message, 'error'); }
        };
        reader.readAsText(file);
    };
    const clearAllData = () => {
        if (!confirm('ATENCAO: Isso apagara TODOS os dados permanentemente. Tem certeza?')) return;
        if (!confirm('Confirma novamente? Esta acao nao pode ser desfeita.')) return;
        localStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem(SESSION_KEY); resetState();
        showToast('Todos os dados foram removidos'); setTimeout(() => location.reload(), 1000);
    };

    const saveGistConfig = () => {
        const token = el('gistToken').value.trim();
        const gistId = el('gistId').value.trim();
        localStorage.setItem(GIST_KEY, JSON.stringify({ token, gistId }));
        showToast('Configuracao salva!');
    };
    const syncToGist = async () => {
        const cfg = JSON.parse(localStorage.getItem(GIST_KEY) || '{}');
        if (!cfg.token) { showToast('Configure o GitHub Token primeiro', 'error'); return; }
        const dataToSync = { ...state, currentUser: null, sessionExpiry: null, syncedAt: now() };
        const payload = { description: 'FinFam Backup', public: false, files: { 'finfam_data.json': { content: JSON.stringify(dataToSync, null, 2) } } };
        try {
            let url = 'https://api.github.com/gists'; let method = 'POST';
            if (cfg.gistId) { url += `/${cfg.gistId}`; method = 'PATCH'; }
            const res = await fetch(url, { method, headers: { Authorization: `token ${cfg.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const json = await res.json();
            if (!res.ok) throw new Error(json.message);
            if (!cfg.gistId && json.id) { cfg.gistId = json.id; localStorage.setItem(GIST_KEY, JSON.stringify(cfg)); el('gistId').value = json.id; }
            el('gistStatus').innerHTML = `<span style="color:var(--emerald)">✅ Sincronizado em ${new Date().toLocaleString('pt-BR')}</span>`;
            showToast('Dados enviados para nuvem!');
        } catch (err) {
            el('gistStatus').innerHTML = `<span style="color:var(--danger)">❌ Erro: ${err.message}</span>`;
            showToast('Erro ao sincronizar: ' + err.message, 'error');
        }
    };
    const syncFromGist = async () => {
        const cfg = JSON.parse(localStorage.getItem(GIST_KEY) || '{}');
        if (!cfg.token || !cfg.gistId) { showToast('Configure Token e Gist ID', 'error'); return; }
        try {
            const res = await fetch(`https://api.github.com/gists/${cfg.gistId}`, { headers: { Authorization: `token ${cfg.token}` } });
            const json = await res.json();
            if (!res.ok) throw new Error(json.message);
            const content = json.files['finfam_data.json']?.content;
            if (!content) { showToast('Arquivo nao encontrado no Gist', 'error'); return; }
            const data = JSON.parse(content);
            if (!data.transactions) { showToast('Dados invalidos no Gist', 'error'); return; }
            if (!confirm('Isso substituira os dados locais pelos da nuvem. Continuar?')) return;
            state = { ...state, ...data, currentUser: state.currentUser, sessionExpiry: state.sessionExpiry };
            saveState(); el('gistStatus').innerHTML = `<span style="color:var(--emerald)">✅ Baixado em ${new Date().toLocaleString('pt-BR')}</span>`;
            showToast('Dados baixados da nuvem!'); setTimeout(() => location.reload(), 500);
        } catch (err) {
            el('gistStatus').innerHTML = `<span style="color:var(--danger)">❌ Erro: ${err.message}</span>`;
            showToast('Erro ao baixar: ' + err.message, 'error');
        }
    };

    const saveSettings = () => {
        state.settings.currencyBR = el('cfgCurrencyBR').value || 'R$';
        state.settings.currencyES = el('cfgCurrencyES').value || '€';
        state.settings.monthStartDay = parseInt(el('cfgMonthStart').value) || 1;
        saveState(); showToast('Preferencias salvas!');
    };

    const doSetup = async () => {
        const name = el('setupName').value.trim();
        const email = el('setupEmail').value.trim();
        const pwd = el('setupPwd').value;
        const pwd2 = el('setupPwd2').value;
        if (!name || !email || !pwd) { showToast('Preencha todos os campos', 'error'); return; }
        if (pwd !== pwd2) { showToast('As senhas nao conferem', 'error'); return; }
        if (pwd.length < 6) { showToast('A senha deve ter no minimo 6 caracteres', 'error'); return; }
        const hash = await hashPwd(pwd);
        const user = { id: generateId(), name, email, passwordHash: hash, role: 'admin', forcePasswordChange: false, createdAt: now() };
        state.users = [user]; saveState(); setSession(user.id);
        showToast('Conta criada com sucesso!'); renderApp();
    };

    const doLogin = async () => {
        const email = el('loginEmail').value.trim();
        const pwd = el('loginPwd').value;
        if (!email || !pwd) { showToast('Preencha email e senha', 'error'); return; }
        const user = state.users.find(u => u.email === email);
        if (!user) { showToast('Usuario nao encontrado', 'error'); return; }
        const hash = await hashPwd(pwd);
        if (hash !== user.passwordHash) { showToast('Senha incorreta', 'error'); return; }
        if (user.forcePasswordChange) { openChangePasswordModal(user.id); return; }
        setSession(user.id); showToast(`Bem-vindo, ${user.name}!`); renderApp();
    };

    const openChangePasswordModal = userId => {
        const content = `
        <div class="modal-header"><div class="modal-title">🔐 Alterar Senha</div></div>
        <p style="font-size:14px;color:var(--text-light);margin-bottom:16px">E necessario alterar sua senha no primeiro acesso.</p>
        <div class="form-group"><label class="form-label">Senha Atual</label><input type="password" id="cpOld" class="input-field"></div>
        <div class="form-group"><label class="form-label">Nova Senha (min. 6 caracteres)</label><input type="password" id="cpNew" class="input-field"></div>
        <div class="form-group"><label class="form-label">Confirmar Nova Senha</label><input type="password" id="cpNew2" class="input-field"></div>
        <button class="btn-primary" style="width:100%" onclick='App.changePassword("${userId}")'>Alterar Senha</button>`;
        openModal(content);
    };

    const changePassword = async userId => {
        const oldPwd = el('cpOld').value;
        const newPwd = el('cpNew').value;
        const newPwd2 = el('cpNew2').value;
        if (!oldPwd || !newPwd) { showToast('Preencha todos os campos', 'error'); return; }
        if (newPwd !== newPwd2) { showToast('As novas senhas nao conferem', 'error'); return; }
        if (newPwd.length < 6) { showToast('A senha deve ter no minimo 6 caracteres', 'error'); return; }
        const user = state.users.find(u => u.id === userId);
        const oldHash = await hashPwd(oldPwd);
        if (oldHash !== user.passwordHash) { showToast('Senha atual incorreta', 'error'); return; }
        const newHash = await hashPwd(newPwd);
        user.passwordHash = newHash; user.forcePasswordChange = false; saveState(); closeModal();
        showToast('Senha alterada com sucesso!');
        if (!isLoggedIn()) { setSession(user.id); renderApp(); }
    };

    const logout = () => { clearSession(); showToast('Sessao encerrada'); setTimeout(() => location.reload(), 500); };
    const nav = elem => {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        elem.classList.add('active');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const page = elem.dataset.page; el(page).classList.add('active');
        if (page === 'dashboard') setTimeout(renderDashboardCharts, 50);
        if (page === 'reports') setTimeout(renderReportContentWrapper, 50);
    };
    const navTo = page => { const navItem = document.querySelector(`.nav-item[data-page="${page}"]`); if (navItem) nav(navItem); };

    const refreshCurrentPage = () => {
        const active = document.querySelector('.page.active');
        if (!active) return;
        const page = active.id;
        if (page === 'dashboard') { el('dashboard').innerHTML = renderDashboard(); setTimeout(renderDashboardCharts, 50); }
        if (page === 'transactions') el('transactions').innerHTML = renderTransactions();
        if (page === 'reports') { el('reports').innerHTML = renderReports(); setTimeout(renderReportContentWrapper, 50); }
        if (page === 'settings') el('settings').innerHTML = renderSettings();
    };

    const init = () => {
        initState();
        if (!isSetup()) renderSetup();
        else if (!isLoggedIn()) renderLogin();
        else renderApp();
    };

    return {
        init, doSetup, doLogin, logout, nav, navTo,
        openTransactionModal, closeModal, saveTransaction, setTxType, updateTxCategories, updateTxTypeUI,
        editTransaction, deleteTransaction, confirmDelete, filterTransactions,
        renderReportContent: renderReportContentWrapper, exportReportPDF,
        addUser, exportData, importData, handleImport, clearAllData,
        saveGistConfig, syncToGist, syncFromGist, saveSettings, changePassword, openChangePasswordModal
    };
})();

document.addEventListener('DOMContentLoaded', App.init);
