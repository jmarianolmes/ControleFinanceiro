const App = (() => {
    const STORAGE_KEY = 'finfam_data_v1';
    const SESSION_KEY = 'finfam_session';

    let state = {
        users: [],
        transactions: [],
        categories: [],
        settings: { currencyBR: 'R$', currencyES: '€', monthStartDay: 1 },
        currentUser: null,
        sessionExpiry: null
    };
    let charts = {};

    // --- HELPER FUNCTIONS ---
    const el = id => document.getElementById(id);
    
    const fmtDate = d => {
        if (!d) return '-';
        const parts = d.split('-');
        if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
        return new Date(d).toLocaleDateString('pt-BR');
    };

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

    // --- TOAST NOTIFICATIONS ---
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

    // --- LISTA DE CATEGORIAS ---
    const defaultCategories = [
        // Receitas Espanha
        { id: 'cat_salario_es', name: 'Salário / Emprego', type: 'income', country: 'ES', icon: '💼' },
        { id: 'cat_freelance_es', name: 'Trabalho Freelance / Extras', type: 'income', country: 'ES', icon: '💻' },
        { id: 'cat_outras_entradas_es', name: 'Outras Receitas', type: 'income', country: 'ES', icon: '💶' },

        // Receitas Brasil
        { id: 'cat_aluguel_br', name: 'Receita Aluguel', type: 'income', country: 'BR', icon: '🏠' },
        { id: 'cat_outras_entradas_br', name: 'Outras Receitas', type: 'income', country: 'BR', icon: '🇧🇷' },
        
        // Despesas Espanha
        { id: 'cat_aluguel_es', name: 'Aluguel de Moradia', type: 'expense', country: 'ES', icon: '🔑' },
        { id: 'cat_hipoteca_es', name: 'Hipoteca / Financiamento', type: 'expense', country: 'ES', icon: '🏛️' },
        { id: 'cat_comunidad', name: 'Comunidad / Condomínio', type: 'expense', country: 'ES', icon: '🏢' },
        { id: 'cat_agua', name: 'Água', type: 'expense', country: 'ES', icon: '💧' },
        { id: 'cat_luz', name: 'Energia / Luz', type: 'expense', country: 'ES', icon: '⚡' },
        { id: 'cat_gas', name: 'Gás', type: 'expense', country: 'ES', icon: '🔥' },
        { id: 'cat_mercado', name: 'Mercado / Alimentação', type: 'expense', country: 'ES', icon: '🛒' },
        { id: 'cat_escola', name: 'Escola / Crianças', type: 'expense', country: 'ES', icon: '🎒' },
        { id: 'cat_metro', name: 'Metrô / Transporte Público', type: 'expense', country: 'ES', icon: '🚇' },
        { id: 'cat_veiculo', name: 'Veículo / Manutenção', type: 'expense', country: 'ES', icon: '🚗' },
        { id: 'cat_combustivel', name: 'Combustível', type: 'expense', country: 'ES', icon: '⛽' },
        { id: 'cat_seguros', name: 'Seguros', type: 'expense', country: 'ES', icon: '🛡️' },
        { id: 'cat_impostos', name: 'Impostos / Tasas / IRPF', type: 'expense', country: 'ES', icon: '🧾' },
        { id: 'cat_telecom', name: 'Internet + Celulares', type: 'expense', country: 'ES', icon: '📱' },
        { id: 'cat_utensilios', name: 'Utensílios / Casa', type: 'expense', country: 'ES', icon: '📦' },
        { id: 'cat_trabalho', name: 'Materiais de Trabalho', type: 'expense', country: 'ES', icon: '💻' },
        { id: 'cat_lazer', name: 'Lazer & Família', type: 'expense', country: 'ES', icon: '🎬' },
        { id: 'cat_outros_es', name: 'Outros Despesas', type: 'expense', country: 'ES', icon: '📋' },

        // Despesas Brasil
        { id: 'cat_cc_br', name: 'Cartão de Crédito', type: 'expense', country: 'BR', icon: '💳' },
        { id: 'cat_impostos_br', name: 'Impostos / Taxas', type: 'expense', country: 'BR', icon: '🧾' },
        { id: 'cat_outros_br', name: 'Compromissos Diversos', type: 'expense', country: 'BR', icon: '🇧🇷' }
    ];

    // --- PERSISTÊNCIA ---
    const initState = () => {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            try {
                state = JSON.parse(raw);
                state.categories = [...defaultCategories];
                if (!state.settings) state.settings = { currencyBR: 'R$', currencyES: '€', monthStartDay: 1 };
            } catch (e) { resetState(); }
        } else { resetState(); }
    };

    const resetState = () => {
        state = {
            users: [], 
            transactions: [], 
            categories: [...defaultCategories],
            settings: { currencyBR: 'R$', currencyES: '€', monthStartDay: 1 },
            currentUser: null, 
            sessionExpiry: null
        };
        saveState();
    };

    const saveState = () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    };

    const resetAllData = () => {
        if (confirm('Isso apagará todos os dados locais e redefinirá o sistema. Deseja continuar?')) {
            localStorage.clear();
            sessionStorage.clear();
            location.reload();
        }
    };

    // --- GESTÃO DE SESSÃO ---
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

    const setSession = (userId, hours = 12) => {
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

    // --- CÁLCULOS ---
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
        const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);

        return { income, expense, balance: income - expense, count: txs.length };
    };

    const getCategoryTotals = (year, month) => {
        const txs = getTransactionsForMonth(year, month);
        const map = {};

        txs.forEach(t => {
            if (!map[t.categoryId]) {
                map[t.categoryId] = {
                    amount: 0,
                    count: 0,
                    category: state.categories.find(c => c.id === t.categoryId) || { name: 'Outros', icon: '📋' }
                };
            }
            map[t.categoryId].amount += Number(t.amount) || 0;
            map[t.categoryId].count++;
        });

        return Object.values(map).sort((a, b) => b.amount - a.amount);
    };

    const getYearlyData = (year) => {
        const months = [];
        for (let m = 1; m <= 12; m++) { months.push(getMonthTotals(year, m)); }
        return months;
    };

    // --- AUTENTICAÇÃO ---
    const doSetup = async () => {
        try {
            const name = el('setupName')?.value.trim();
            const email = el('setupEmail')?.value.trim().toLowerCase();
            const pwd = el('setupPwd')?.value;
            const pwd2 = el('setupPwd2')?.value;

            if (!name || !email || !pwd) { showToast('Preencha todos os campos.', 'error'); return; }
            if (pwd.length < 6) { showToast('A senha deve ter no mínimo 6 caracteres.', 'error'); return; }
            if (pwd !== pwd2) { showToast('As senhas não coincidem.', 'error'); return; }

            const passwordHash = await hashPwd(pwd);
            const user = { id: generateId(), name, email, passwordHash, role: 'admin', createdAt: now() };

            state.users = [user];
            saveState();
            setSession(user.id);
            renderApp();
            showToast('Conta principal criada!');
        } catch (err) {
            console.error(err);
            showToast('Erro ao criar a conta.', 'error');
        }
    };

    const doLogin = async () => {
        try {
            const email = el('loginEmail')?.value.trim().toLowerCase();
            const pwd = el('loginPwd')?.value;

            if (!email || !pwd) { showToast('Preencha e-mail e senha.', 'error'); return; }
            const user = state.users.find(u => String(u.email).toLowerCase() === email);

            if (!user) { showToast('Usuário ou senha inválidos.', 'error'); return; }
            const hash = await hashPwd(pwd);
            if (user.passwordHash !== hash) { showToast('Usuário ou senha inválidos.', 'error'); return; }

            setSession(user.id);
            renderApp();
            showToast(`Bem-vindo(a), ${user.name}!`);
        } catch (err) {
            console.error(err);
            showToast('Erro ao entrar.', 'error');
        }
    };

    const logout = () => { clearSession(); renderLogin(); };

    // --- RENDERIZADORES DE TELA ---
    const renderLogin = () => {
        const app = el('app');
        app.innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a5f 0%,#2c5282 50%,#059669 100%)">
            <div style="background:#fff;border-radius:20px;padding:40px;max-width:420px;width:90%;box-shadow:0 25px 80px rgba(0,0,0,.3)">
                <div style="text-align:center;margin-bottom:28px">
                    <div style="width:64px;height:64px;background:var(--navy);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px">💶</div>
                    <h1 style="margin:0;font-size:24px;color:var(--navy)">Controle Financeiro</h1>
                    <p style="margin:8px 0 0;color:var(--text-light);font-size:14px">València 🇪🇸 & Brasil 🇧🇷</p>
                </div>
                <form id="loginForm" onsubmit="event.preventDefault(); App.doLogin();">
                    <div class="form-group">
                        <label class="form-label">Email</label>
                        <input type="email" id="loginEmail" name="username" autocomplete="username" class="input-field" placeholder="seu@email.com" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Senha</label>
                        <input type="password" id="loginPwd" name="password" autocomplete="current-password" class="input-field" placeholder="Sua senha" required>
                    </div>
                    <button type="submit" class="btn-primary" style="width:100%;padding:14px">Entrar</button>
                </form>
                <div style="text-align:center;margin-top:20px;display:flex;flex-direction:column;gap:10px">
                    <button onclick="App.resetAllData()" style="background:none;border:none;color:var(--danger);font-size:12px;cursor:pointer;text-decoration:underline">Redefinir Dados / Criar Conta do Zero</button>
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
                    <h1 style="margin:0;font-size:24px;color:var(--navy)">Primeiro Acesso</h1>
                    <p style="margin:8px 0 0;color:var(--text-light);font-size:14px">Cadastre o usuário administrador da família</p>
                </div>
                <form onsubmit="event.preventDefault(); App.doSetup();">
                    <div class="form-group"><label class="form-label">Nome Completo</label><input type="text" id="setupName" class="input-field" placeholder="Ex: João Silva" required></div>
                    <div class="form-group"><label class="form-label">Email</label><input type="email" id="setupEmail" class="input-field" placeholder="joao@email.com" required></div>
                    <div class="form-group"><label class="form-label">Senha (mínimo 6 caracteres)</label><input type="password" id="setupPwd" class="input-field" required minlength="6"></div>
                    <div class="form-group"><label class="form-label">Confirmar Senha</label><input type="password" id="setupPwd2" class="input-field" required minlength="6"></div>
                    <button type="submit" class="btn-primary" style="width:100%;padding:14px">Criar Conta Administrador</button>
                </form>
            </div>
        </div>`;
    };

    const renderApp = () => {
        const app = el('app');
        app.innerHTML = `<div class="sidebar">
            <div class="logo">
                <div style="display:flex;align-items:center;gap:12px">
                    <div style="width:40px;height:40px;background:rgba(255,255,255,.15);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px">💶</div>
                    <div><div style="font-weight:700;font-size:16px">FinFam</div><div style="font-size:11px;opacity:.7">ES 🇪🇸 & BR 🇧🇷</div></div>
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
                        <div style="font-size:11px;opacity:.7">${state.currentUser?.role === 'admin' ? 'Administrador' : 'Usuário'}</div>
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
        
        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px">
            <div>
                <h2 style="margin:0;font-size:22px;color:var(--navy)">Dashboard</h2>
                <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Resumo financeiro - ${monthName}</p>
            </div>
            <button class="btn-primary" onclick="App.showAddTransactionModal()">+ Novo Lançamento</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px">
            <div class="card stat-card"><div class="stat-label">Saldo do Mês</div><div class="stat-value ${totals.balance >= 0 ? 'emerald-text' : 'danger-text'}">${fmtMoney(totals.balance, state.settings.currencyES)}</div></div>
            <div class="card stat-card"><div class="stat-label">Total Entradas</div><div class="stat-value emerald-text">${fmtMoney(totals.income, state.settings.currencyES)}</div></div>
            <div class="card stat-card"><div class="stat-label">Total Saídas</div><div class="stat-value danger-text">${fmtMoney(totals.expense, state.settings.currencyES)}</div></div>
            <div class="card stat-card"><div class="stat-label">Lançamentos</div><div class="stat-value" style="color:var(--navy)">${totals.count}</div></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:16px;margin-bottom:24px">
            <div class="card" style="padding:20px">
                <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">📊 Gastos por Categoria (${monthName})</h3>
                <div class="chart-container"><canvas id="chartCategories"></canvas></div>
            </div>
            <div class="card" style="padding:20px">
                <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">📈 Evolução Anual (${year})</h3>
                <div class="chart-container"><canvas id="chartYearly"></canvas></div>
            </div>
        </div>
        <div class="card" style="padding:20px">
            <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">🕐 Últimos Lançamentos</h3>
            ${recent.length === 0 ? `<div class="empty-state"><p>Nenhum lançamento registrado ainda.</p></div>` : `
            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>Responsável</th><th>País</th><th>Valor</th><th style="text-align:right">Ações</th></tr></thead>
                    <tbody>${recent.map(t => renderTransactionRow(t)).join('')}</tbody>
                </table>
            </div>`}
        </div>`;
    };

    const renderTransactionRow = (t) => {
        const cat = state.categories.find(c => c.id === t.categoryId) || { name: 'Geral', icon: '📋' };
        const isBR = t.country === 'BR';
        return `<tr>
            <td style="white-space:nowrap">${fmtDate(t.date)}</td>
            <td><span class="category-tag" style="white-space:nowrap">${cat.icon} ${cat.name}</span></td>
            <td>${t.description || '-'}</td>
            <td><span class="badge badge-info" style="white-space:nowrap">👤 ${t.assignedTo || 'Casal'}</span></td>
            <td style="white-space:nowrap"><span class="badge ${isBR ? 'badge-info' : 'badge-warning'}">${isBR ? '🇧🇷 Brasil' : '🇪🇸 Espanha'}</span></td>
            <td style="font-weight:600;white-space:nowrap;color:${t.type === 'income' ? 'var(--emerald)' : 'var(--danger)'}">${fmtMoney(t.amount, isBR ? state.settings.currencyBR : state.settings.currencyES)}</td>
            <td style="text-align:right;white-space:nowrap">
                <button onclick="App.showEditTransactionModal('${t.id}')" style="background:#e0f2fe;color:#0369a1;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;font-weight:600;margin-right:6px" title="Editar">✏️ Editar</button>
                <button onclick="App.deleteTransaction('${t.id}')" style="background:#fee2e2;color:#b91c1c;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;font-weight:600" title="Excluir">🗑️ Excluir</button>
            </td>
        </tr>`;
    };

    const renderDashboardCharts = () => {
        const { year, month } = getCurrentMonth();
        const catTotals = getCategoryTotals(year, month);
        if (charts.categories) charts.categories.destroy();
        if (charts.yearly) charts.yearly.destroy();

        const ctx1 = el('chartCategories');
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
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
            });
        }

        const ctx2 = el('chartYearly');
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
                options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { position: 'bottom' } } }
            });
        }
    };

    const renderTransactions = () => {
        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px">
            <div>
                <h2 style="margin:0;font-size:22px;color:var(--navy)">Lançamentos</h2>
                <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Registro completo de movimentações</p>
            </div>
            <button class="btn-primary" onclick="App.showAddTransactionModal()">+ Novo Lançamento</button>
        </div>
        <div class="card" style="padding:20px">
            <div id="transactionsTable">${renderTransactionsTable()}</div>
        </div>`;
    };

    const renderTransactionsTable = () => {
        const txs = state.transactions.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
        if (txs.length === 0) {
            return `<div class="empty-state"><p>Nenhum lançamento cadastrado.</p></div>`;
        }
        return `<div class="table-container">
            <table class="data-table">
                <thead><tr><th>Data</th><th>Categoria</th><th>Descrição / Detalhe</th><th>Responsável</th><th>País</th><th>Valor</th><th style="text-align:right">Ações</th></tr></thead>
                <tbody>${txs.map(t => renderTransactionRow(t)).join('')}</tbody>
            </table>
        </div>`;
    };

    const renderReports = () => {
        const { year, month } = getCurrentMonth();
        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
            <div>
                <h2 style="margin:0;font-size:22px;color:var(--navy)">Relatório Mensal</h2>
                <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Detalhamento das despesas e receitas por categoria</p>
            </div>
        </div>
        <div id="reportContent">${renderReportContent(year, month)}</div>`;
    };

    const renderReportContent = (year, month) => {
        const catTotals = getCategoryTotals(year, month);
        const totals = getMonthTotals(year, month);

        return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-bottom:24px">
            <div class="card" style="padding:20px">
                <h4 style="margin:0 0 12px;color:var(--text-light)">Resumo Financeiro</h4>
                <div style="font-size:24px;font-weight:700;margin-bottom:8px" class="${totals.balance >= 0 ? 'emerald-text' : 'danger-text'}">
                    ${fmtMoney(totals.balance, state.settings.currencyES)}
                </div>
                <div style="font-size:13px;color:var(--text-light)">Entradas: <strong class="emerald-text">${fmtMoney(totals.income, state.settings.currencyES)}</strong> | Saídas: <strong class="danger-text">${fmtMoney(totals.expense, state.settings.currencyES)}</strong></div>
            </div>
        </div>
        <div class="card" style="padding:20px">
            <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">📊 Detalhamento de Despesas por Categoria</h3>
            ${catTotals.length === 0 ? '<p style="color:var(--text-light)">Sem registros para o mês atual.</p>' : `
            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>Categoria</th><th>Quantidade</th><th>Total Gasto</th></tr></thead>
                    <tbody>${catTotals.map(c => `<tr>
                        <td><span class="category-tag">${c.category.icon} ${c.category.name}</span></td>
                        <td>${c.count} lançamento(s)</td>
                        <td style="font-weight:600">${fmtMoney(c.amount, state.settings.currencyES)}</td>
                    </tr>`).join('')}</tbody>
                </table>
            </div>`}
        </div>`;
    };

    const renderSettings = () => {
        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px">
            <div>
                <h2 style="margin:0;font-size:22px;color:var(--navy)">Configurações</h2>
                <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Gerencie acessos e preferências</p>
            </div>
            <button class="btn-primary" onclick="App.showAddUserModal()">+ Adicionar Familiar</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:16px">
            <div class="card" style="padding:24px">
                <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">👥 Usuários Cadastrados</h3>
                <div>${state.users.map(u => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #eee">
                        <div>
                            <div style="font-weight:600;color:var(--navy)">${u.name}</div>
                            <div style="font-size:12px;color:var(--text-light)">${u.email}</div>
                        </div>
                        <span class="badge ${u.role === 'admin' ? 'badge-info' : 'badge-success'}">${u.role === 'admin' ? 'Administrador' : 'Usuário'}</span>
                    </div>`).join('')}</div>
            </div>
        </div>`;
    };

    // --- MODAIS E AÇÕES DE EDIÇÃO ---
    const closeModal = () => {
        const overlay = el('modalOverlay');
        if (overlay) overlay.classList.remove('active');
    };

    const filterCategoriesByType = (type) => {
        const select = el('txCategory');
        if (!select) return;
        const filtered = state.categories.filter(c => c.type === type);
        select.innerHTML = filtered.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
    };

    const showAddTransactionModal = () => {
        const overlay = el('modalOverlay');
        const content = el('modalContent');
        if (!overlay || !content) return;

        const defaultType = 'expense';
        const initialCats = state.categories.filter(c => c.type === defaultType);
        const userOptions = state.users.map(u => `<option value="${u.name}">${u.name}</option>`).join('');

        content.innerHTML = `
            <div class="modal-header">
                <h3 class="modal-title">Novo Lançamento</h3>
                <button class="close-btn" onclick="App.closeModal()">&times;</button>
            </div>
            <form onsubmit="event.preventDefault(); App.doSaveTransaction();">
                <div class="form-group">
                    <label class="form-label">Tipo de Operação</label>
                    <select id="txType" class="input-field" onchange="App.filterCategoriesByType(this.value)">
                        <option value="expense">Saída / Despesa</option>
                        <option value="income">Entrada / Receita</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Valor</label>
                    <input type="number" step="0.01" id="txAmount" class="input-field" placeholder="0.00" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Categoria</label>
                    <select id="txCategory" class="input-field" required>
                        ${initialCats.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Responsável / Quem Realizou</label>
                    <select id="txAssignedTo" class="input-field">
                        <option value="Casal / Ambos">👩‍❤️‍👨 Casal / Ambos</option>
                        ${userOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">País / Moeda</label>
                    <select id="txCountry" class="input-field">
                        <option value="ES">🇪🇸 Espanha (€ Euro)</option>
                        <option value="BR">🇧🇷 Brasil (R$ Real)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Data</label>
                    <input type="date" id="txDate" class="input-field" value="${new Date().toISOString().split('T')[0]}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Nome / Detalhe do Lançamento</label>
                    <input type="text" id="txDesc" class="input-field" placeholder="Ex: Mercado Mercadona, Aluguel...">
                </div>
                <button type="submit" class="btn-primary" style="width:100%;margin-top:10px">Salvar Lançamento</button>
            </form>
        `;
        overlay.classList.add('active');
    };

    const showEditTransactionModal = (id) => {
        const tx = state.transactions.find(t => t.id === id);
        if (!tx) {
            showToast('Lançamento não encontrado.', 'error');
            return;
        }

        const overlay = el('modalOverlay');
        const content = el('modalContent');
        if (!overlay || !content) return;

        const filteredCats = state.categories.filter(c => c.type === (tx.type || 'expense'));
        const userOptions = state.users.map(u => `<option value="${u.name}" ${tx.assignedTo === u.name ? 'selected' : ''}>${u.name}</option>`).join('');

        content.innerHTML = `
            <div class="modal-header">
                <h3 class="modal-title">Editar Lançamento</h3>
                <button class="close-btn" onclick="App.closeModal()">&times;</button>
            </div>
            <form onsubmit="event.preventDefault(); App.doUpdateTransaction('${tx.id}');">
                <div class="form-group">
                    <label class="form-label">Tipo de Operação</label>
                    <select id="txType" class="input-field" onchange="App.filterCategoriesByType(this.value)">
                        <option value="expense" ${tx.type === 'expense' ? 'selected' : ''}>Saída / Despesa</option>
                        <option value="income" ${tx.type === 'income' ? 'selected' : ''}>Entrada / Receita</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Valor</label>
                    <input type="number" step="0.01" id="txAmount" class="input-field" value="${tx.amount}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Categoria</label>
                    <select id="txCategory" class="input-field" required>
                        ${filteredCats.map(c => `<option value="${c.id}" ${tx.categoryId === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Responsável / Quem Realizou</label>
                    <select id="txAssignedTo" class="input-field">
                        <option value="Casal / Ambos" ${tx.assignedTo === 'Casal / Ambos' ? 'selected' : ''}>👩‍❤️‍👨 Casal / Ambos</option>
                        ${userOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">País / Moeda</label>
                    <select id="txCountry" class="input-field">
                        <option value="ES" ${tx.country === 'ES' ? 'selected' : ''}>🇪🇸 Espanha (€ Euro)</option>
                        <option value="BR" ${tx.country === 'BR' ? 'selected' : ''}>🇧🇷 Brasil (R$ Real)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Data</label>
                    <input type="date" id="txDate" class="input-field" value="${tx.date}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Nome / Detalhe do Lançamento</label>
                    <input type="text" id="txDesc" class="input-field" value="${tx.description || ''}" placeholder="Ex: Mercado Mercadona, Aluguel...">
                </div>
                <button type="submit" class="btn-primary" style="width:100%;margin-top:10px">Salvar Alterações</button>
            </form>
        `;
        overlay.classList.add('active');
    };

    const doSaveTransaction = () => {
        const amount = parseFloat(el('txAmount').value);
        const categoryId = el('txCategory').value;
        const type = el('txType').value;
        const country = el('txCountry').value;
        const date = el('txDate').value;
        const assignedTo = el('txAssignedTo').value;
        const description = el('txDesc').value.trim();

        if (!amount || amount <= 0) { showToast('Informe um valor válido.', 'error'); return; }

        state.transactions.push({
            id: generateId(),
            amount,
            categoryId,
            type,
            country,
            date,
            assignedTo,
            description,
            userId: state.currentUser.id,
            createdAt: now()
        });

        saveState();
        closeModal();
        renderApp();
        showToast('Lançamento cadastrado com sucesso!');
    };

    const doUpdateTransaction = (id) => {
        const index = state.transactions.findIndex(t => t.id === id);
        if (index === -1) return;

        const amount = parseFloat(el('txAmount').value);
        const categoryId = el('txCategory').value;
        const type = el('txType').value;
        const country = el('txCountry').value;
        const date = el('txDate').value;
        const assignedTo = el('txAssignedTo').value;
        const description = el('txDesc').value.trim();

        if (!amount || amount <= 0) { showToast('Informe um valor válido.', 'error'); return; }

        state.transactions[index] = {
            ...state.transactions[index],
            amount, categoryId, type, country, date, assignedTo, description, updatedAt: now()
        };

        saveState();
        closeModal();
        renderApp();
        showToast('Lançamento atualizado!');
    };

    const deleteTransaction = (id) => {
        if (confirm('Deseja realmente remover este lançamento?')) {
            state.transactions = state.transactions.filter(t => t.id !== id);
            saveState();
            renderApp();
            showToast('Lançamento removido.');
        }
    };

    const showAddUserModal = () => {
        const overlay = el('modalOverlay');
        const content = el('modalContent');
        if (!overlay || !content) return;

        content.innerHTML = `
            <div class="modal-header">
                <h3 class="modal-title">Adicionar Familiar</h3>
                <button class="close-btn" onclick="App.closeModal()">&times;</button>
            </div>
            <form onsubmit="event.preventDefault(); App.doAddUser();">
                <div class="form-group"><label class="form-label">Nome Completo</label><input type="text" id="newUserName" class="input-field" required></div>
                <div class="form-group"><label class="form-label">Email de Acesso</label><input type="email" id="newUserEmail" class="input-field" required></div>
                <div class="form-group"><label class="form-label">Senha Inicial</label><input type="password" id="newUserPwd" class="input-field" required minlength="6"></div>
                <button type="submit" class="btn-primary" style="width:100%;margin-top:10px">Cadastrar Usuário</button>
            </form>
        `;
        overlay.classList.add('active');
    };

    const doAddUser = async () => {
        const name = el('newUserName').value.trim();
        const email = el('newUserEmail').value.trim().toLowerCase();
        const pwd = el('newUserPwd').value;

        if (state.users.some(u => u.email === email)) { showToast('Este e-mail já está cadastrado.', 'error'); return; }

        const passwordHash = await hashPwd(pwd);
        state.users.push({ id: generateId(), name, email, passwordHash, role: 'user', createdAt: now() });
        saveState();
        closeModal();
        renderApp();
        showToast('Familiar cadastrado!');
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
            if (!isSetup()) renderSetup();
            else if (!isLoggedIn()) renderLogin();
            else renderApp();
        },
        doLogin, doSetup, logout, nav, resetAllData,
        showAddTransactionModal, showEditTransactionModal,
        doSaveTransaction, doUpdateTransaction, deleteTransaction,
        showAddUserModal, doAddUser, closeModal, filterCategoriesByType
    };
})();

window.App = App;

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
