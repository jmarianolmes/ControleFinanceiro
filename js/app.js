const App = (() => {
    const STORAGE_KEY = 'finfam_data_v1';
    const SESSION_KEY = 'finfam_session';
    const DEFAULT_TOKEN = 'FinFam_SecureToken_2026_@Key';
    const INACTIVITY_TIMEOUT = 15 * 60 * 1000;

    const getCurrentMonthStr = () => new Date().toISOString().slice(0, 7);

    let state = {
        users: [],
        transactions: [],
        categories: [],
        settings: { currencyBR: 'R$', currencyES: '€', monthStartDay: 1, googleScriptUrl: '', apiToken: DEFAULT_TOKEN },
        currentUser: null,
        sessionExpiry: null,
        privacyMode: false,
        selectedMonth: getCurrentMonthStr()
    };

    let inactivityTimer = null;
    const el = id => document.getElementById(id);

    const fmtDate = d => {
        if (!d) return '-';
        const parts = d.split('-');
        return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : new Date(d).toLocaleDateString('pt-BR');
    };

    const fmtMoney = (v, currency) => {
        if (state.privacyMode) return '***';
        const n = Number(v);
        const safe = Number.isFinite(n) ? n : 0;
        return `${currency || '€'} ${safe.toFixed(2).replace('.', ',')}`;
    };

    const hashPwd = async (value) => {
        try {
            if (window.crypto?.subtle) {
                const data = new TextEncoder().encode(value);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
            }
        } catch (e) {}
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
        return (hash >>> 0).toString(16);
    };

    const showToast = (msg, type = 'success') => {
        const t = el('toast');
        if (!t) return;
        t.textContent = String(msg);
        t.className = `toast ${type} show`;
        setTimeout(() => { t.classList.remove('show'); }, 3000);
    };

    const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    const now = () => new Date().toISOString();

    const resetInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        if (isLoggedIn()) {
            inactivityTimer = setTimeout(() => {
                showToast('Sessão encerrada por inatividade.', 'error');
                logout();
            }, INACTIVITY_TIMEOUT);
        }
    };

    const defaultCategories = [
        { id: 'cat_salario_es', name: 'Salário / Emprego', type: 'income', country: 'ES', icon: '💼' },
        { id: 'cat_freelance_es', name: 'Freelance / Extras', type: 'income', country: 'ES', icon: '💻' },
        { id: 'cat_aluguel_br', name: 'Receita Aluguel BR', type: 'income', country: 'BR', icon: '🏠' },
        { id: 'cat_invest_es', name: 'Aporte / Investimentos ES', type: 'investment', country: 'ES', icon: '📈' },
        { id: 'cat_invest_br', name: 'Aporte / Investimentos BR', type: 'investment', country: 'BR', icon: '🇧🇷' },
        { id: 'cat_aluguel_es', name: 'Aluguel Moradia', type: 'expense', country: 'ES', icon: '🔑' },
        { id: 'cat_hipoteca_es', name: 'Hipoteca / Financiamento', type: 'expense', country: 'ES', icon: '🏛️' },
        { id: 'cat_agua', name: 'Água / Luz / Gás', type: 'expense', country: 'ES', icon: '⚡' },
        { id: 'cat_mercado', name: 'Mercado / Alimentação', type: 'expense', country: 'ES', icon: '🛒' },
        { id: 'cat_escola', name: 'Escola / Crianças', type: 'expense', country: 'ES', icon: '🎒' },
        { id: 'cat_transporte', name: 'Transporte / Veículo', type: 'expense', country: 'ES', icon: '🚗' },
        { id: 'cat_lazer', name: 'Lazer & Família', type: 'expense', country: 'ES', icon: '🎬' },
        { id: 'cat_outros_es', name: 'Outras Despesas ES', type: 'expense', country: 'ES', icon: '📋' },
        { id: 'cat_cc_br', name: 'Cartão de Crédito BR', type: 'expense', country: 'BR', icon: '💳' }
    ];

    const syncToDrive = async () => {
        const url = state.settings.googleScriptUrl;
        if (!url) return;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'sync',
                    token: state.settings.apiToken || DEFAULT_TOKEN,
                    transactions: state.transactions,
                    categories: state.categories
                })
            });
            const data = await res.json();
            if (data.status === 'success') showToast('Dados sincronizados no Google Drive!');
            else showToast(data.message || 'Erro ao sincronizar.', 'error');
        } catch (e) {
            showToast('Erro de comunicação com o Drive.', 'error');
        }
    };

    const syncFromDrive = async (silent = false) => {
        const url = state.settings.googleScriptUrl;
        if (!url) { if (!silent) showToast('URL do Apps Script não configurada.', 'error'); return; }
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'fetch', token: state.settings.apiToken || DEFAULT_TOKEN })
            });
            const data = await res.json();
            if (data.status === 'success' && data.transactions) {
                state.transactions = data.transactions;
                if (data.categories && data.categories.length > 0) state.categories = data.categories;
                saveState();
                renderCurrentPage();
                if (!silent) showToast('Dados atualizados do Google Drive!');
            }
        } catch (e) {
            if (!silent) showToast('Erro ao buscar dados do Drive.', 'error');
        }
    };

    const checkConnection = async () => {
        const dot = el('connStatusDot');
        const text = el('connStatusText');
        const url = state.settings.googleScriptUrl;
        if (!dot || !text) return;
        if (!url) { dot.style.backgroundColor = '#ef4444'; text.textContent = 'URL não configurada'; return; }
        text.textContent = 'Verificando...'; dot.style.backgroundColor = '#f59e0b';
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'fetch', token: state.settings.apiToken || DEFAULT_TOKEN })
            });
            const data = await res.json();
            if (data.status === 'success') {
                dot.style.backgroundColor = '#10b981';
                text.textContent = 'Conectado ao Google Drive';
            } else {
                dot.style.backgroundColor = '#ef4444';
                text.textContent = 'Erro de Autenticação/Token';
            }
        } catch (e) {
            dot.style.backgroundColor = '#ef4444'; text.textContent = 'Desconectado / Erro de Rede';
        }
    };

    const initState = () => {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                state = { ...state, ...parsed };
                if (!state.categories || state.categories.length === 0) state.categories = [...defaultCategories];
                if (!state.settings) state.settings = { currencyBR: 'R$', currencyES: '€', monthStartDay: 1, googleScriptUrl: '', apiToken: DEFAULT_TOKEN };
                if (!state.selectedMonth) state.selectedMonth = getCurrentMonthStr();
            } catch (e) { resetState(); }
        } else { resetState(); }
    };

    const resetState = () => {
        state = {
            users: [], transactions: [], categories: [...defaultCategories],
            settings: { currencyBR: 'R$', currencyES: '€', monthStartDay: 1, googleScriptUrl: '', apiToken: DEFAULT_TOKEN },
            currentUser: null, sessionExpiry: null, privacyMode: false, selectedMonth: getCurrentMonthStr()
        };
        saveState();
    };

    const saveState = () => { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); };

    const getSession = () => {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        try {
            const s = JSON.parse(raw);
            if (new Date(s.expires) < new Date()) { sessionStorage.removeItem(SESSION_KEY); return null; }
            return s;
        } catch (e) { return null; }
    };

    const setSession = (userId, hours = 12) => {
        const expires = new Date(Date.now() + hours * 3600000).toISOString();
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId, expires }));
        state.currentUser = state.users.find(u => u.id === userId);
        state.sessionExpiry = expires;
        resetInactivityTimer();
    };

    const clearSession = () => {
        sessionStorage.removeItem(SESSION_KEY);
        state.currentUser = null;
        if (inactivityTimer) clearTimeout(inactivityTimer);
    };

    const isSetup = () => state.users.length > 0;
    const isLoggedIn = () => {
        const s = getSession();
        if (!s) return false;
        state.currentUser = state.users.find(u => u.id === s.userId);
        return true;
    };

    const togglePrivacy = () => { state.privacyMode = !state.privacyMode; renderApp(); };

    const getSelectedMonthData = () => {
        const ym = state.selectedMonth || getCurrentMonthStr();
        // Filtra transações cuja data comece com YYYY-MM
        const txs = state.transactions.filter(t => t.date && t.date.slice(0, 7) === ym).sort((a, b) => new Date(b.date) - new Date(a.date));
        
        const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const investment = txs.filter(t => t.type === 'investment').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        
        // Saldo disponível em caixa no mês (Receitas - Despesas Operacionais - Investimentos/Aportes)
        const balance = income - expense - investment;
        
        // Patrimônio acumulado histórico total em investimentos
        const totalPatrimony = state.transactions.filter(t => t.type === 'investment').reduce((s, t) => s + (Number(t.amount) || 0), 0);

        // Agrupamento de Despesas por Categoria para Eficiência Financeira
        const catMap = {};
        txs.filter(t => t.type === 'expense').forEach(t => {
            const cid = t.categoryId || 'cat_outros_es';
            catMap[cid] = (catMap[cid] || 0) + (Number(t.amount) || 0);
        });

        const catBreakdown = Object.keys(catMap).map(cid => {
            const cat = state.categories.find(c => c.id === cid) || { name: 'Outros', icon: '📋' };
            const amount = catMap[cid];
            const pct = expense > 0 ? ((amount / expense) * 100).toFixed(1) : 0;
            return { ...cat, amount, pct: Number(pct) };
        }).sort((a, b) => b.amount - a.amount);

        return { income, expense, investment, balance, totalPatrimony, catBreakdown, count: txs.length, txs };
    };

    const changeSelectedMonth = (ym) => {
        if (!ym) return;
        state.selectedMonth = ym;
        saveState();
        renderCurrentPage();
    };

    const renderCurrentPage = () => {
        const activePage = document.querySelector('.page.active')?.id || 'dashboard';
        if (activePage === 'dashboard') {
            const dash = el('dashboard'); if (dash) dash.innerHTML = renderDashboard();
        } else if (activePage === 'transactions') {
            const txTable = el('transactionsTable'); if (txTable) txTable.innerHTML = renderTransactionsTable();
        } else if (activePage === 'reports') {
            const rep = el('reports'); if (rep) rep.innerHTML = renderReports();
        } else if (activePage === 'settings') {
            const set = el('settings'); if (set) set.innerHTML = renderSettings();
        }
    };

    const doSetup = async () => {
        const name = el('setupName')?.value.trim();
        const email = el('setupEmail')?.value.trim().toLowerCase();
        const pwd = el('setupPwd')?.value;
        const pwd2 = el('setupPwd2')?.value;
        if (!name || !email || !pwd) { showToast('Preencha todos os campos.', 'error'); return; }
        if (pwd.length < 6) { showToast('Senha mínima de 6 caracteres.', 'error'); return; }
        if (pwd !== pwd2) { showToast('Senhas não coincidem.', 'error'); return; }
        const passwordHash = await hashPwd(pwd);
        const user = { id: generateId(), name, email, passwordHash, role: 'admin', createdAt: now() };
        state.users = [user]; saveState(); setSession(user.id); renderApp(); showToast('Conta criada com sucesso!');
    };

    const doLogin = async () => {
        const email = el('loginEmail')?.value.trim().toLowerCase();
        const pwd = el('loginPwd')?.value;
        if (!email || !pwd) { showToast('Preencha e-mail e senha.', 'error'); return; }
        const user = state.users.find(u => String(u.email).toLowerCase() === email);
        if (!user) { showToast('Credenciais inválidas.', 'error'); return; }
        const hash = await hashPwd(pwd);
        if (user.passwordHash !== hash) { showToast('Credenciais inválidas.', 'error'); return; }
        setSession(user.id); renderApp(); showToast(`Bem-vindo, ${user.name}!`);
    };

    const logout = () => { clearSession(); renderLogin(); };

    const nav = (element) => {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        element.classList.add('active');
        const targetPage = element.getAttribute('data-page');
        const p = el(targetPage);
        if (p) p.classList.add('active');
        if (targetPage === 'dashboard') syncFromDrive(true);
        else if (targetPage === 'settings') checkConnection();
    };

    const renderLogin = () => {
        el('app').innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a5f 0%,#2c5282 50%,#059669 100%)">
            <div style="background:#fff;border-radius:20px;padding:40px;max-width:420px;width:90%;box-shadow:0 25px 80px rgba(0,0,0,.3)">
                <div style="text-align:center;margin-bottom:28px">
                    <div style="width:64px;height:64px;background:var(--navy);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px">💶</div>
                    <h1 style="margin:0;font-size:24px;color:var(--navy)">FinFam Control</h1>
                    <p style="margin:8px 0 0;color:var(--text-light);font-size:14px">Gestão de Finanças Família ES 🇪🇸 & BR 🇧🇷</p>
                </div>
                <form id="loginForm" onsubmit="event.preventDefault(); App.doLogin();">
                    <div class="form-group"><label class="form-label">Email</label><input type="email" id="loginEmail" class="input-field" required></div>
                    <div class="form-group"><label class="form-label">Senha</label><input type="password" id="loginPwd" class="input-field" required></div>
                    <button type="submit" class="btn-primary" style="width:100%;padding:14px">Entrar com Segurança</button>
                </form>
            </div>
        </div>`;
    };

    const renderSetup = () => {
        el('app').innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a5f 0%,#2c5282 50%,#059669 100%)">
            <div style="background:#fff;border-radius:20px;padding:40px;max-width:480px;width:90%;box-shadow:0 25px 80px rgba(0,0,0,.3)">
                <div style="text-align:center;margin-bottom:28px">
                    <h1 style="margin:0;font-size:24px;color:var(--navy)">Configuração Inicial</h1>
                    <p style="margin:8px 0 0;color:var(--text-light);font-size:14px">Cadastre a conta principal do sistema</p>
                </div>
                <form onsubmit="event.preventDefault(); App.doSetup();">
                    <div class="form-group"><label class="form-label">Nome Completo</label><input type="text" id="setupName" class="input-field" required></div>
                    <div class="form-group"><label class="form-label">Email</label><input type="email" id="setupEmail" class="input-field" required></div>
                    <div class="form-group"><label class="form-label">Senha</label><input type="password" id="setupPwd" class="input-field" required minlength="6"></div>
                    <div class="form-group"><label class="form-label">Confirmar Senha</label><input type="password" id="setupPwd2" class="input-field" required minlength="6"></div>
                    <button type="submit" class="btn-primary" style="width:100%;padding:14px">Criar Conta</button>
                </form>
            </div>
        </div>`;
    };

    const renderApp = () => {
        el('app').innerHTML = `<div class="sidebar">
            <div class="logo">
                <div style="display:flex;align-items:center;gap:12px">
                    <div style="width:40px;height:40px;background:rgba(255,255,255,.15);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px">💶</div>
                    <div><div style="font-weight:700;font-size:16px">FinFam</div><div style="font-size:11px;opacity:.7">ES 🇪🇸 & BR 🇧🇷</div></div>
                </div>
            </div>
            <div style="flex:1;padding:12px 0">
                <div class="nav-item active" data-page="dashboard" onclick="App.nav(this)"><span>📊</span> Dashboard</div>
                <div class="nav-item" data-page="transactions" onclick="App.nav(this)"><span>📝</span> Lançamentos</div>
                <div class="nav-item" data-page="reports" onclick="App.nav(this)"><span>📈</span> Relatórios</div>
                <div class="nav-item" data-page="settings" onclick="App.nav(this)"><span>⚙️</span> Configurações</div>
            </div>
            <div style="padding:16px;border-top:1px solid rgba(255,255,255,.1)">
                <div style="display:flex;align-items:center;gap:10px">
                    <div class="user-avatar">${state.currentUser?.name?.charAt(0).toUpperCase() || 'U'}</div>
                    <div style="flex:1;min-width:0">
                        <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${state.currentUser?.name || ''}</div>
                        <button onclick="App.togglePrivacy()" style="background:none;border:none;color:rgba(255,255,255,.8);cursor:pointer;font-size:12px;padding:0;margin-top:2px">${state.privacyMode ? '👁️ Mostrar' : '🙈 Ocultar'}</button>
                    </div>
                    <button onclick="App.logout()" style="background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:18px;padding:4px">🚪</button>
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
    };

    const renderDashboard = () => {
        const m = getSelectedMonthData();
        const savingsRate = m.income > 0 ? ((m.investment / m.income) * 100).toFixed(1) : 0;
        const expenseRate = m.income > 0 ? Math.min(100, ((m.expense / m.income) * 100)).toFixed(1) : 0;
        const freeCashRate = (100 - expenseRate - savingsRate).toFixed(1);

        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px">
            <div>
                <h2 style="margin:0;font-size:22px;color:var(--navy)">Dashboard Estratégico</h2>
                <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Visão de caixa e construção de patrimônio</p>
            </div>
            <div style="display:flex;gap:10px;align-items:center">
                <input type="month" id="dashMonthPicker" class="input-field" style="padding:8px 12px;font-weight:600;color:var(--navy)" value="${state.selectedMonth}" onchange="App.changeSelectedMonth(this.value)">
                <button class="btn-primary" onclick="App.showAddTransactionModal()">+ Novo Lançamento</button>
            </div>
        </div>

        <!-- CARDS DE METRICAS PRINCIPAIS -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
            <div class="card stat-card"><div class="stat-label">Entradas (Receitas)</div><div class="stat-value emerald-text">${fmtMoney(m.income, state.settings.currencyES)}</div></div>
            <div class="card stat-card"><div class="stat-label">Despesas Operacionais</div><div class="stat-value danger-text">${fmtMoney(m.expense, state.settings.currencyES)}</div></div>
            <div class="card stat-card" style="border-left:4px solid #0284c7"><div class="stat-label">Aportes / Investidos (Mês)</div><div class="stat-value" style="color:#0284c7">${fmtMoney(m.investment, state.settings.currencyES)}</div><div style="font-size:11px;color:var(--text-light);margin-top:2px">Taxa de Aporte: ${savingsRate}%</div></div>
            <div class="card stat-card"><div class="stat-label">Caixa Livre Restante</div><div class="stat-value ${m.balance >= 0 ? 'emerald-text' : 'danger-text'}">${fmtMoney(m.balance, state.settings.currencyES)}</div></div>
            <div class="card stat-card" style="background:linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)"><div class="stat-label">🏛️ Patrimônio Acumulado Total</div><div class="stat-value" style="color:var(--navy)">${fmtMoney(m.totalPatrimony, state.settings.currencyES)}</div></div>
        </div>

        <!-- SEÇÃO DE GRÁFICOS E EFICIÊNCIA ESTRATÉGICA -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;margin-bottom:24px">
            
            <!-- GRÁFICO 1: DISTRIBUIÇÃO DO RENT/RECEITA -->
            <div class="card" style="padding:20px">
                <h3 style="margin:0 0 12px;font-size:15px;color:var(--navy)">📊 Eficiência de Alocação da Receita</h3>
                <p style="font-size:12px;color:var(--text-light);margin-bottom:16px">Distribuição percentual das entradas do mês selecionado:</p>
                
                <div style="height:24px;width:100%;background:#e2e8f0;border-radius:12px;overflow:hidden;display:flex;margin-bottom:16px">
                    <div style="width:${expenseRate}%;background:#ef4444" title="Despesas: ${expenseRate}%"></div>
                    <div style="width:${savingsRate}%;background:#0284c7" title="Investimentos: ${savingsRate}%"></div>
                </div>

                <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600">
                    <div style="color:#ef4444">🔴 Despesas: ${expenseRate}%</div>
                    <div style="color:#0284c7">🔵 Investimento: ${savingsRate}%</div>
                    <div style="color:#10b981">🟢 Saldo Livre: ${freeCashRate}%</div>
                </div>
            </div>

            <!-- GRÁFICO 2: IMPACTO POR CATEGORIA DE DESPESA (%) -->
            <div class="card" style="padding:20px">
                <h3 style="margin:0 0 12px;font-size:15px;color:var(--navy)">🏷️ Impacto por Categoria de Despesa (%)</h3>
                ${m.catBreakdown.length === 0 ? '<div style="font-size:13px;color:var(--text-light)">Sem despesas no mês selecionado.</div>' : `
                    <div style="display:flex;flex-direction:column;gap:12px">
                        ${m.catBreakdown.slice(0, 5).map(c => `
                            <div>
                                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
                                    <span style="font-weight:600">${c.icon} ${c.name}</span>
                                    <span><strong>${fmtMoney(c.amount, state.settings.currencyES)}</strong> (${c.pct}%)</span>
                                </div>
                                <div style="height:8px;width:100%;background:#f1f5f9;border-radius:4px;overflow:hidden">
                                    <div style="height:100%;width:${c.pct}%;background:var(--navy);border-radius:4px"></div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        </div>

        <!-- TABELA DE TRANSAÇÕES DO MÊS -->
        <div class="card" style="padding:20px">
            <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">📅 Extrato do Mês (${m.txs.length})</h3>
            ${m.txs.length === 0 ? `<div class="empty-state"><p>Nenhum lançamento encontrado para ${state.selectedMonth}.</p></div>` : `
            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th>Responsável</th><th>País</th><th>Valor</th><th style="text-align:right">Ações</th></tr></thead>
                    <tbody>${m.txs.map(t => renderTransactionRow(t)).join('')}</tbody>
                </table>
            </div>`}
        </div>`;
    };

    const renderTransactionRow = (t) => {
        const cat = state.categories.find(c => c.id === t.categoryId) || { name: 'Geral', icon: '📋' };
        const isBR = t.country === 'BR';
        let badgeColor = t.type === 'income' ? 'badge-success' : (t.type === 'investment' ? 'badge-info' : 'badge-danger');
        let typeLabel = t.type === 'income' ? 'Entrada' : (t.type === 'investment' ? 'Aporte/Invest' : 'Saída');

        return `<tr>
            <td style="white-space:nowrap">${fmtDate(t.date)}</td>
            <td><span class="badge ${badgeColor}">${typeLabel}</span></td>
            <td><span class="category-tag">${cat.icon} ${cat.name}</span></td>
            <td>${t.description || '-'}</td>
            <td><span class="badge badge-info">👤 ${t.assignedTo || 'Casal'}</span></td>
            <td><span class="badge ${isBR ? 'badge-info' : 'badge-warning'}">${isBR ? '🇧🇷 Brasil' : '🇪🇸 Espanha'}</span></td>
            <td style="font-weight:600;color:${t.type === 'income' ? 'var(--emerald)' : (t.type === 'investment' ? '#0284c7' : 'var(--danger)')}">${fmtMoney(t.amount, isBR ? state.settings.currencyBR : state.settings.currencyES)}</td>
            <td style="text-align:right;white-space:nowrap">
                <button onclick="App.showEditTransactionModal('${t.id}')" style="background:#e0f2fe;color:#0369a1;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;font-weight:600;margin-right:6px">✏️</button>
                <button onclick="App.deleteTransaction('${t.id}')" style="background:#fee2e2;color:#b91c1c;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;font-weight:600">🗑️</button>
            </td>
        </tr>`;
    };

    const renderTransactions = () => `<div style="margin-bottom:24px"><h2 style="margin:0;font-size:22px;color:var(--navy)">Todos os Lançamentos</h2></div><div class="card" style="padding:20px"><div id="transactionsTable">${renderTransactionsTable()}</div></div>`;

    const renderTransactionsTable = () => {
        const txs = state.transactions.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
        if (txs.length === 0) return `<div class="empty-state"><p>Nenhum lançamento cadastrado.</p></div>`;
        return `<div class="table-container"><table class="data-table"><thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th>Responsável</th><th>País</th><th>Valor</th><th style="text-align:right">Ações</th></tr></thead><tbody>${txs.map(t => renderTransactionRow(t)).join('')}</tbody></table></div>`;
    };

    // ==========================================
    // RELATÓRIOS COMPLETOS
    // ==========================================
    const renderReports = () => {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

        return `
        <div style="margin-bottom:24px">
            <h2 style="margin:0;font-size:22px;color:var(--navy)">📈 Relatórios & Análise Financeira</h2>
            <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Filtre seus gastos por período, país e categoria</p>
        </div>

        <div class="card" style="padding:20px;margin-bottom:24px">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;align-items:end">
                <div class="form-group" style="margin:0">
                    <label class="form-label">Data Início</label>
                    <input type="date" id="repStartDate" class="input-field" value="${firstDay}">
                </div>
                <div class="form-group" style="margin:0">
                    <label class="form-label">Data Fim</label>
                    <input type="date" id="repEndDate" class="input-field" value="${lastDay}">
                </div>
                <div class="form-group" style="margin:0">
                    <label class="form-label">País</label>
                    <select id="repCountry" class="input-field">
                        <option value="ALL">🇪🇸🇧🇷 Todos os Países</option>
                        <option value="ES">🇪🇸 Espanha (€)</option>
                        <option value="BR">🇧🇷 Brasil (R$)</option>
                    </select>
                </div>
                <div class="form-group" style="margin:0">
                    <label class="form-label">Tipo</label>
                    <select id="repType" class="input-field">
                        <option value="ALL">Todos os Tipos</option>
                        <option value="expense">🔴 Despesas</option>
                        <option value="income">🟢 Entradas</option>
                        <option value="investment">🔵 Investimentos</option>
                    </select>
                </div>
                <div>
                    <button class="btn-primary" style="width:100%" onclick="App.filterReports()">Filtrar</button>
                </div>
            </div>
        </div>

        <div id="reportResultContainer">
            ${generateReportData(firstDay, lastDay, 'ALL', 'ALL')}
        </div>`;
    };

    const filterReports = () => {
        const start = el('repStartDate')?.value;
        const end = el('repEndDate')?.value;
        const country = el('repCountry')?.value || 'ALL';
        const type = el('repType')?.value || 'ALL';
        const container = el('reportResultContainer');
        if (container) container.innerHTML = generateReportData(start, end, country, type);
    };

    const generateReportData = (start, end, country, type) => {
        let filtered = state.transactions.filter(t => {
            if (start && t.date < start) return false;
            if (end && t.date > end) return false;
            if (country !== 'ALL' && t.country !== country) return false;
            if (type !== 'ALL' && t.type !== type) return false;
            return true;
        });

        const totalIncome = filtered.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
        const totalExpense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);
        const totalInvest = filtered.filter(t => t.type === 'investment').reduce((s, t) => s + Number(t.amount || 0), 0);
        const net = totalIncome - totalExpense - totalInvest;

        // Distribuição por categoria
        const catMap = {};
        filtered.forEach(t => {
            const cid = t.categoryId || 'cat_outros_es';
            if (!catMap[cid]) catMap[cid] = { total: 0, count: 0, type: t.type };
            catMap[cid].total += Number(t.amount || 0);
            catMap[cid].count += 1;
        });

        const curr = country === 'BR' ? state.settings.currencyBR : state.settings.currencyES;

        return `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">
            <div class="card stat-card"><div class="stat-label">Total Entradas</div><div class="stat-value emerald-text">${fmtMoney(totalIncome, curr)}</div></div>
            <div class="card stat-card"><div class="stat-label">Total Saídas</div><div class="stat-value danger-text">${fmtMoney(totalExpense, curr)}</div></div>
            <div class="card stat-card"><div class="stat-label">Total Investido</div><div class="stat-value" style="color:#0284c7">${fmtMoney(totalInvest, curr)}</div></div>
            <div class="card stat-card"><div class="stat-label">Resultado Líquido</div><div class="stat-value ${net >= 0 ? 'emerald-text' : 'danger-text'}">${fmtMoney(net, curr)}</div></div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h3 style="margin:0;color:var(--navy)">📊 Detalhamento por Categorias</h3>
            <button class="btn-primary" style="padding:8px 16px;font-size:12px" onclick="App.exportCSV()">📥 Exportar CSV</button>
        </div>

        <div class="card" style="padding:20px;margin-bottom:24px">
            ${Object.keys(catMap).length === 0 ? '<div class="empty-state"><p>Nenhum lançamento no período selecionado.</p></div>' : `
            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>Categoria</th><th>Qtd. Lançamentos</th><th>Tipo</th><th>Total Acumulado</th></tr></thead>
                    <tbody>
                        ${Object.keys(catMap).map(cid => {
                            const c = state.categories.find(cat => cat.id === cid) || { name: 'Outros', icon: '📋' };
                            const item = catMap[cid];
                            return `<tr>
                                <td><span class="category-tag">${c.icon} ${c.name}</span></td>
                                <td>${item.count}</td>
                                <td><span class="badge ${item.type === 'income' ? 'badge-success' : (item.type === 'investment' ? 'badge-info' : 'badge-danger')}">${item.type}</span></td>
                                <td style="font-weight:600">${fmtMoney(item.total, curr)}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`}
        </div>`;
    };

    const exportCSV = () => {
        if (state.transactions.length === 0) { showToast('Nenhum dado para exportar.', 'error'); return; }
        let csv = 'Data,Tipo,Categoria,Descricao,Responsavel,Pais,Valor\n';
        state.transactions.forEach(t => {
            const cat = state.categories.find(c => c.id === t.categoryId)?.name || '';
            csv += `"${t.date}","${t.type}","${cat}","${t.description || ''}","${t.assignedTo || ''}","${t.country}","${t.amount}"\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `FinFam_Export_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('CSV exportado com sucesso!');
    };

    // ==========================================
    // CONFIGURAÇÕES COMPLETAS
    // ==========================================
    const renderSettings = () => `
    <div style="margin-bottom:24px">
        <h2 style="margin:0;font-size:22px;color:var(--navy)">⚙️ Configurações & Preferências</h2>
        <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Gerencie sincronização, categorias e dados do sistema</p>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;margin-bottom:24px">
        
        <!-- CARD INTEGRACAO GOOGLE DRIVE -->
        <div class="card" style="padding:20px">
            <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">☁️ Integração Google Drive API</h3>
            
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;padding:8px 12px;background:#f8fafc;border-radius:8px">
                <div id="connStatusDot" style="width:10px;height:10px;border-radius:50%;background:#f59e0b"></div>
                <span id="connStatusText" style="font-size:12px;font-weight:600;color:var(--text)">Aguardando verificação...</span>
            </div>

            <div class="form-group">
                <label class="form-label">Google Apps Script URL</label>
                <input type="text" id="settingScriptUrl" class="input-field" value="${state.settings.googleScriptUrl || ''}" placeholder="https://script.google.com/macros/s/.../exec">
            </div>

            <div class="form-group">
                <label class="form-label">Chave / Token de Segurança API</label>
                <input type="text" id="settingApiToken" class="input-field" value="${state.settings.apiToken || DEFAULT_TOKEN}">
            </div>

            <div style="display:flex;gap:10px">
                <button class="btn-primary" style="flex:1" onclick="App.saveSettings()">Salvar Configurações</button>
                <button class="btn-primary" style="background:#0284c7" onclick="App.syncFromDrive()">🔄 Forçar Sync Drive</button>
            </div>
        </div>

        <!-- CARD GERENCIAMENTO DE CATEGORIAS -->
        <div class="card" style="padding:20px">
            <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">🏷️ Gestão de Categorias (${state.categories.length})</h3>
            
            <form onsubmit="event.preventDefault(); App.addCategory();" style="margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <input type="text" id="newCatIcon" class="input-field" placeholder="Ícone (ex: 🛒)" required style="text-align:center">
                <input type="text" id="newCatName" class="input-field" placeholder="Nome da Categoria" required>
                <select id="newCatType" class="input-field">
                    <option value="expense">🔴 Despesa</option>
                    <option value="income">🟢 Entrada</option>
                    <option value="investment">🔵 Investimento</option>
                </select>
                <select id="newCatCountry" class="input-field">
                    <option value="ES">🇪🇸 Espanha</option>
                    <option value="BR">🇧🇷 Brasil</option>
                </select>
                <button type="submit" class="btn-primary" style="grid-column:span 2;padding:8px">+ Adicionar Categoria</button>
            </form>

            <div style="max-height:200px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;padding:8px">
                ${state.categories.map(c => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:12px">
                        <span>${c.icon} <strong>${c.name}</strong> (${c.country})</span>
                        <button onclick="App.deleteCategory('${c.id}')" style="background:none;border:none;color:#ef4444;cursor:pointer">🗑️</button>
                    </div>
                `).join('')}
            </div>
        </div>

    </div>

    <!-- CARD BACKUP E DADOS -->
    <div class="card" style="padding:20px">
        <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">💾 Backup e Dados Locais</h3>
        <p style="font-size:13px;color:var(--text-light);margin-bottom:16px">Baixe uma cópia de segurança em formato JSON ou restaure seus dados.</p>
        
        <div style="display:flex;gap:12px;flex-wrap:wrap">
            <button class="btn-primary" style="background:#059669" onclick="App.exportBackup()">📥 Exportar Backup JSON</button>
            <input type="file" id="importFileInput" style="display:none" onchange="App.importBackup(event)" accept=".json">
            <button class="btn-primary" style="background:#0284c7" onclick="document.getElementById('importFileInput').click()">📤 Importar Backup JSON</button>
            <button class="btn-primary" style="background:#dc2626" onclick="App.resetAllData()">⚠️ Zerar Todos os Dados</button>
        </div>
    </div>`;

    const saveSettings = () => {
        state.settings.googleScriptUrl = el('settingScriptUrl')?.value.trim();
        state.settings.apiToken = el('settingApiToken')?.value.trim() || DEFAULT_TOKEN;
        saveState();
        showToast('Configurações salvas!');
        checkConnection();
    };

    const addCategory = () => {
        const icon = el('newCatIcon')?.value.trim() || '📋';
        const name = el('newCatName')?.value.trim();
        const type = el('newCatType')?.value;
        const country = el('newCatCountry')?.value;

        if (!name) { showToast('Informe o nome da categoria.', 'error'); return; }

        state.categories.push({ id: 'cat_' + generateId(), name, icon, type, country });
        saveState();
        renderCurrentPage();
        showToast('Categoria adicionada!');
        syncToDrive();
    };

    const deleteCategory = (id) => {
        if (confirm('Deseja excluir esta categoria?')) {
            state.categories = state.categories.filter(c => c.id !== id);
            saveState();
            renderCurrentPage();
            showToast('Categoria excluída.');
            syncToDrive();
        }
    };

    const exportBackup = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `FinFam_Backup_${new Date().toISOString().slice(0, 10)}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast('Backup exportado com sucesso!');
    };

    const importBackup = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target.result);
                if (parsed.transactions && parsed.categories) {
                    state = parsed;
                    saveState();
                    renderApp();
                    showToast('Backup restaurado com sucesso!');
                } else {
                    showToast('Formato de arquivo inválido.', 'error');
                }
            } catch (err) {
                showToast('Erro ao ler arquivo de backup.', 'error');
            }
        };
        reader.readAsText(file);
    };

    const resetAllData = () => {
        if (confirm('ATENÇÃO: Deseja realmente zerar todos os dados? Esta ação é irreversível.')) {
            resetState();
            renderApp();
            showToast('Dados reiniciados com sucesso.', 'error');
        }
    };

    const showAddTransactionModal = () => showTransactionModal();
    const showEditTransactionModal = (id) => { const tx = state.transactions.find(t => t.id === id); if (tx) showTransactionModal(tx); };

    const showTransactionModal = (tx = null) => {
        const isEdit = !!tx;
        const today = new Date().toISOString().split('T')[0];
        const html = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h3 style="margin:0;color:var(--navy)">${isEdit ? 'Editar Lançamento' : 'Novo Lançamento'}</h3>
                <button onclick="App.closeModal()" style="background:none;border:none;font-size:20px;cursor:pointer">✕</button>
            </div>
            <form onsubmit="event.preventDefault(); App.saveTransaction('${tx ? tx.id : ''}');">
                <div class="form-group">
                    <label class="form-label">Tipo de Lançamento</label>
                    <select id="modalTxType" class="input-field">
                        <option value="expense" ${tx?.type === 'expense' ? 'selected' : ''}>🔴 Saída / Despesa</option>
                        <option value="income" ${tx?.type === 'income' ? 'selected' : ''}>🟢 Entrada / Receita</option>
                        <option value="investment" ${tx?.type === 'investment' ? 'selected' : ''}>🔵 Investimento / Patrimônio</option>
                    </select>
                </div>
                <div class="form-group"><label class="form-label">Data</label><input type="date" id="modalTxDate" class="input-field" value="${tx?.date || today}" required></div>
                <div class="form-group">
                    <label class="form-label">Categoria</label>
                    <select id="modalTxCategory" class="input-field">
                        ${state.categories.map(c => `<option value="${c.id}" ${tx?.categoryId === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group"><label class="form-label">Descrição</label><input type="text" id="modalTxDesc" class="input-field" value="${tx?.description || ''}"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div class="form-group"><label class="form-label">Responsável</label><input type="text" id="modalTxAssigned" class="input-field" value="${tx?.assignedTo || 'Casal'}"></div>
                    <div class="form-group">
                        <label class="form-label">País</label>
                        <select id="modalTxCountry" class="input-field">
                            <option value="ES" ${tx?.country === 'ES' ? 'selected' : ''}>🇪🇸 Espanha</option>
                            <option value="BR" ${tx?.country === 'BR' ? 'selected' : ''}>🇧🇷 Brasil</option>
                        </select>
                    </div>
                </div>
                <div class="form-group"><label class="form-label">Valor</label><input type="number" step="0.01" id="modalTxAmount" class="input-field" value="${tx?.amount || ''}" required></div>
                <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px">
                    <button type="button" class="btn-primary" style="background:#9ca3af" onclick="App.closeModal()">Cancelar</button>
                    <button type="submit" class="btn-primary">${isEdit ? 'Atualizar' : 'Salvar'}</button>
                </div>
            </form>`;
        const overlay = el('modalOverlay');
        const content = el('modalContent');
        if (overlay && content) { content.innerHTML = html; overlay.style.display = 'flex'; }
    };

    const saveTransaction = (id) => {
        const type = el('modalTxType')?.value;
        const date = el('modalTxDate')?.value;
        const categoryId = el('modalTxCategory')?.value;
        const description = el('modalTxDesc')?.value.trim();
        const assignedTo = el('modalTxAssigned')?.value.trim();
        const country = el('modalTxCountry')?.value;
        const amount = parseFloat(el('modalTxAmount')?.value) || 0;

        if (!date || amount <= 0) { showToast('Informe uma data e um valor válido.', 'error'); return; }

        if (id) {
            const index = state.transactions.findIndex(t => t.id === id);
            if (index !== -1) state.transactions[index] = { id, date, type, categoryId, description, assignedTo, country, amount };
        } else {
            state.transactions.push({ id: generateId(), date, type, categoryId, description, assignedTo, country, amount });
        }

        saveState();
        closeModal();
        renderApp();
        showToast(id ? 'Lançamento atualizado!' : 'Lançamento adicionado!');
        syncToDrive();
    };

    const deleteTransaction = (id) => {
        if (confirm('Deseja excluir este lançamento?')) {
            state.transactions = state.transactions.filter(t => t.id !== id);
            saveState();
            renderApp();
            showToast('Lançamento removido.');
            syncToDrive();
        }
    };

    const closeModal = () => { const overlay = el('modalOverlay'); if (overlay) overlay.style.display = 'none'; };

    const init = () => {
        initState();
        if (!isSetup()) renderSetup();
        else if (!isLoggedIn()) renderLogin();
        else { renderApp(); syncFromDrive(true); }
    };

    return {
        init, doSetup, doLogin, logout, nav, togglePrivacy, changeSelectedMonth, saveSettings,
        syncFromDrive, filterReports, exportCSV, addCategory, deleteCategory, exportBackup, importBackup, resetAllData,
        showAddTransactionModal, showEditTransactionModal, saveTransaction, deleteTransaction, closeModal
    };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
