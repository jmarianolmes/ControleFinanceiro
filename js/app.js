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

    const fmtMoney = (v, currency) => {
        const n = Number(v);
        const safe = Number.isFinite(n) ? n : 0;
        return `${currency || '€'} ${safe.toFixed(2).replace('.', ',')}`;
    };

    const simpleHash = (value) => {
        let hash = 2166136261;

        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }

        return (hash >>> 0).toString(16);
    };

    const hashPwd = async (value) => {
        try {
            if (window.crypto?.subtle) {
                const data = new TextEncoder().encode(value);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);

                return Array.from(new Uint8Array(hashBuffer))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');
            }
        } catch (err) {
            console.warn('crypto.subtle indisponível, usando fallback:', err);
        }

        return simpleHash(value);
    };

    let pendingToast = null;

    const showToast = (msg, type = 'success') => {
        const t = el('toast');

        if (!t) {
            pendingToast = { msg, type };
            return;
        }

        t.textContent = String(msg);
        t.className = `toast ${type} show`;

        setTimeout(() => {
            t.classList.remove('show');
        }, 3000);
    };

    const flushPendingToast = () => {
        if (!pendingToast) return;

        const pending = pendingToast;
        pendingToast = null;

        showToast(pending.msg, pending.type);
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

        const income = txs
            .filter(t => t.type === 'income')
            .reduce((s, t) => {
                const amount = Number(t.amount);
                return s + (Number.isFinite(amount) ? amount : 0);
            }, 0);

        const expense = txs
            .filter(t => t.type === 'expense')
            .reduce((s, t) => {
                const amount = Number(t.amount);
                return s + (Number.isFinite(amount) ? amount : 0);
            }, 0);

        return {
            income,
            expense,
            balance: income - expense,
            count: txs.length
        };
    };

    const getCategoryTotals = (year, month) => {
        const txs = getTransactionsForMonth(year, month);
        const map = {};

        txs.forEach(t => {
            if (!map[t.categoryId]) {
                map[t.categoryId] = {
                    amount: 0,
                    count: 0,
                    category: state.categories.find(c => c.id === t.categoryId) || {
                        name: 'Desconhecida',
                        icon: '❓'
                    }
                };
            }

            const amount = Number(t.amount);
            map[t.categoryId].amount += Number.isFinite(amount) ? amount : 0;
            map[t.categoryId].count++;
        });

        return Object.values(map).sort((a, b) => b.amount - a.amount);
    };

    const getYearlyData = (year) => {
        const months = [];
        for (let m = 1; m <= 12; m++) { months.push(getMonthTotals(year, m)); }
        return months;
    };

    const doSetup = async () => {
        try {
            const name = el('setupName')?.value.trim();
            const email = el('setupEmail')?.value.trim().toLowerCase();
            const pwd = el('setupPwd')?.value;
            const pwd2 = el('setupPwd2')?.value;

            if (!name || !email || !pwd) {
                showToast('Preencha todos os campos.', 'error');
                return;
            }

            if (pwd.length < 6) {
                showToast('A senha deve ter no mínimo 6 caracteres.', 'error');
                return;
            }

            if (pwd !== pwd2) {
                showToast('As senhas não coincidem.', 'error');
                return;
            }

            const passwordHash = await hashPwd(pwd);
            const user = {
                id: generateId(),
                name,
                email,
                passwordHash,
                role: 'admin',
                createdAt: now()
            };

            state.users = [user];
            saveState();
            setSession(user.id);
            renderApp();
            showToast('Conta criada com sucesso!');

        } catch (err) {
            console.error('Erro em doSetup:', err);
            showToast(
                'Erro ao criar a conta: ' + (err?.message || 'erro desconhecido'),
                'error'
            );
        }
    };

    const doLogin = async () => {
        try {
            const email = el('loginEmail').value.trim().toLowerCase();
            const pwd = el('loginPwd').value;

            if (!email || !pwd) {
                showToast('Preencha e-mail e senha.', 'error');
                return;
            }

            const user = state.users.find(
                u => String(u.email).toLowerCase() === email
            );

            if (!user) {
                showToast('Usuário ou senha inválidos.', 'error');
                return;
            }

            const hash = await hashPwd(pwd);
            if (user.passwordHash !== hash) {
                showToast('Usuário ou senha inválidos.', 'error');
                return;
            }

            setSession(user.id);
            renderApp();
            showToast('Login efetuado com sucesso!');

        } catch (err) {
            console.error('Erro em doLogin:', err);
            showToast(
                'Erro ao entrar: ' + (err?.message || 'erro desconhecido'),
                'error'
            );
        }
    };

    const logout = () => {
        clearSession();
        renderLogin();
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
                    <p style="text-align:center;margin-top:16px;font-size:13px;color:var(--text-light)">Acesso exclusivo para você e sua família.</p>
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
                    <h1 style="margin:0;font-size:24px;color:var(--navy)">Configuração Inicial</h1>
                    <p style="margin:8px 0 0;color:var(--text-light);font-size:14px">Cadastre o primeiro usuário administrador</p>
                </div>
                <div id="setupForm">
                    <div class="form-group"><label class="form-label">Nome Completo</label><input type="text" id="setupName" class="input-field" placeholder="Ex: João Silva"></div>
                    <div class="form-group"><label class="form-label">Email</label><input type="email" id="setupEmail" class="input-field" placeholder="joao@email.com"></div>
                    <div class="form-group"><label class="form-label">Senha (mínimo 6 caracteres)</label><input type="password" id="setupPwd" class="input-field" placeholder="Crie uma senha segura"></div>
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
                <div class="nav-item" data-page="transactions" onclick="App.nav(this)"><span>📝</span> Lançamentos</div>
                <div class="nav-item" data-page="reports" onclick="App.nav(this)"><span>📈</span> Relatório Mensal</div>
                <div class="nav-item" data-page="settings" onclick="App.nav(this)"><span>⚙️</span> Configurações</div>
            </div>
            <div style="padding:16px;border-top:1px solid rgba(255,255,255,.1)">
                <div style="display:flex;align-items:center;gap:10px">
                    <div class="user-avatar">${state.currentUser?.name?.charAt(0).toUpperCase() || 'U'}</div>
                    <div style="flex:1;min-width:0">
                        <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${state.currentUser?.name || ''}</div>
                        <div style="font-size:11px;opacity:.7">${state.currentUser?.role === 'admin' ? 'Admin' : 'Usuário'}</div>
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
        flushPendingToast();
    };

    const renderDashboard = () => {
        const { year, month } = getCurrentMonth();
        const totals = getMonthTotals(year, month);
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
            <div class="card stat-card"><div class="stat-label">Saldo do Mês</div><div class="stat-value ${totals.balance >= 0 ? 'emerald-text' : 'danger-text'}">${fmtMoney(totals.balance, totals.balance >= 0 ? state.settings.currencyES : '')}</div></div>
            <div class="card stat-card"><div class="stat-label">Entradas</div><div class="stat-value emerald-text">${fmtMoney(totals.income, state.settings.currencyES)}</div></div>
            <div class="card stat-card"><div class="stat-label">Saídas</div><div class="stat-value danger-text">${fmtMoney(totals.expense, state.settings.currencyES)}</div></div>
            <div class="card stat-card"><div class="stat-label">Lançamentos</div><div class="stat-value" style="color:var(--navy)">${totals.count}</div></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:16px;margin-bottom:24px">
            <div class="card" style="padding:20px">
                <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">📊 Despesas por Categoria</h3>
                <div class="chart-container"><canvas id="chartCategories"></canvas></div>
            </div>
            <div class="card" style="padding:20px">
                <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">📈 Evolução Anual</h3>
                <div class="chart-container"><canvas id="chartYearly"></canvas></div>
            </div>
        </div>
        <div class="card" style="padding:20px">
            <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">🕐 Lançamentos Recentes</h3>
            ${recent.length === 0 ? `<div class="empty-state"><div style="font-size:48px;margin-bottom:12px">📝</div><p>Sem lançamentos ainda</p></div>` : `
            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>País</th><th>Valor</th><th>Tipo</th></tr></thead>
                    <tbody>${recent.map(t => {
                        const cat = state.categories.find(c => c.id === t.categoryId) || { name: 'Desconhecida', icon: '❓' };
                        return `<tr><td>${fmtDate(t.date)}</td><td><span class="category-tag">${cat.icon} ${cat.name}</span></td><td>${t.description || '-'}</td><td><span class="badge ${t.country === 'BR' ? 'badge-info' : 'badge-warning'}">${t.country === 'BR' ? '🇧🇷 BR' : '🇪🇸 ES'}</span></td><td style="font-weight:600;color:${t.type === 'income' ? 'var(--emerald)' : 'var(--danger)'}">${fmtMoney(t.amount, t.country === 'BR' ? state.settings.currencyBR : state.settings.currencyES)}</td><td><span class="badge ${t.type === 'income' ? 'badge-success' : 'badge-danger'}">${t.type === 'income' ? 'Entrada' : 'Saída'}</span></td></tr>`;
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
                    plugins: { legend: { position: 'bottom', labels: { padding: 16, font: { size: 12 } } } }
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
                        { label: 'Saídas', data: yearly.map(m => m.expense), backgroundColor: '#dc2626', borderRadius: 4 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true } },
                    plugins: { legend: { position: 'bottom' } }
                }
            });
        }
    };

    const renderTransactions = () => {
        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
            <div><h2 style="margin:0;font-size:22px;color:var(--navy)">Lançamentos</h2><p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Gerencie entradas e saídas</p></div>
        </div>
        <div class="card" style="padding:20px">
            <div id="transactionsTable">${renderTransactionsTable()}</div>
        </div>`;
    };

    const renderTransactionsTable = () => {
        const txs = state.transactions.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
        if (txs.length === 0) return `<div class="empty-state"><div style="font-size:48px;margin-bottom:12px">🔍</div><p>Nenhum lançamento encontrado</p></div>`;
        return `<div class="table-container">
            <table class="data-table">
                <thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>País</th><th>Valor</th><th>Tipo</th></tr></thead>
                <tbody>${txs.map(t => {
                    const cat = state.categories.find(c => c.id === t.categoryId) || { name: 'Desconhecida', icon: '❓' };
                    return `<tr><td>${fmtDate(t.date)}</td><td><span class="category-tag">${cat.icon} ${cat.name}</span></td><td>${t.description || '-'}</td><td><span class="badge ${t.country === 'BR' ? 'badge-info' : 'badge-warning'}">${t.country === 'BR' ? '🇧🇷 BR' : '🇪🇸 ES'}</span></td><td style="font-weight:600;color:${t.type === 'income' ? 'var(--emerald)' : 'var(--danger)'}">${fmtMoney(t.amount, t.country === 'BR' ? state.settings.currencyBR : state.settings.currencyES)}</td><td><span class="badge ${t.type === 'income' ? 'badge-success' : 'badge-danger'}">${t.type === 'income' ? 'Entrada' : 'Saída'}</span></td></tr>`;
                }).join('')}</tbody>
            </table>
        </div>`;
    };

    const renderReports = () => {
        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
            <div><h2 style="margin:0;font-size:22px;color:var(--navy)">Relatório Mensal</h2><p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Análise detalhada por país e categoria</p></div>
        </div>
        <div id="reportContent">${renderReportContent(new Date().getFullYear(), new Date().getMonth() + 1)}</div>`;
    };

    const renderReportContent = (year, month) => {
        const catTotals = getCategoryTotals(year, month);
        return `<div class="card" style="padding:20px">
            <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">📊 Despesas por Categoria</h3>
            <div>${catTotals.map(c => `<div>${c.category.icon} ${c.category.name}: ${fmtMoney(c.amount, state.settings.currencyES)}</div>`).join('')}</div>
        </div>`;
    };

    const renderUsersList = () => {
        return state.users.map(u => `<div style="padding:8px 0;border-bottom:1px solid #eee">${u.name} (${u.email}) - <strong>${u.role}</strong></div>`).join('');
    };

    const renderSettings = () => {
        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
            <div><h2 style="margin:0;font-size:22px;color:var(--navy)">Configurações</h2><p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Gerencie usuários, dados e sincronização</p></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:16px">
            <div class="card" style="padding:24px">
                <h3 style="margin:0 0 20px;font-size:16px;color:var(--navy)">👥 Usuários</h3>
                <div id="usersList">${renderUsersList()}</div>
            </div>
        </div>`;
    };

    const nav = (elem) => {
        document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
        document.querySelectorAll('.page').forEach(e => e.classList.remove('active'));
        elem.classList.add('active');
        const targetPage = elem.getAttribute('data-page');
        const pageEl = el(targetPage);
        if (pageEl) pageEl.classList.add('active');
    };

    return {
        init: () => {
            initState();
            if (!isSetup()) {
                renderSetup();
            } else if (!isLoggedIn()) {
                renderLogin();
            } else {
                renderApp();
            }
        },
        doLogin,
        doSetup,
        logout,
        nav
    };
})();

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
