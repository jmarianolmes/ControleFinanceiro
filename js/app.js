const App = (() => {
    const STORAGE_KEY = 'finfam_data_v1';
    const SESSION_KEY = 'finfam_session';
    const DEFAULT_TOKEN = 'FinFam_SecureToken_2026_@Key';
    const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutos

    let state = {
        users: [],
        transactions: [],
        categories: [],
        settings: { currencyBR: 'R$', currencyES: '€', monthStartDay: 1, googleScriptUrl: '', apiToken: DEFAULT_TOKEN },
        currentUser: null,
        sessionExpiry: null,
        privacyMode: false
    };
    
    let charts = {};
    let inactivityTimer = null;

    const el = id => document.getElementById(id);
    
    const fmtDate = d => {
        if (!d) return '-';
        const parts = d.split('-');
        if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
        return new Date(d).toLocaleDateString('pt-BR');
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
        { id: 'cat_freelance_es', name: 'Trabalho Freelance / Extras', type: 'income', country: 'ES', icon: '💻' },
        { id: 'cat_outras_entradas_es', name: 'Outras Receitas', type: 'income', country: 'ES', icon: '💶' },
        { id: 'cat_aluguel_br', name: 'Receita Aluguel', type: 'income', country: 'BR', icon: '🏠' },
        { id: 'cat_outras_entradas_br', name: 'Outras Receitas', type: 'income', country: 'BR', icon: '🇧🇷' },
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
        { id: 'cat_cc_br', name: 'Cartão de Crédito', type: 'expense', country: 'BR', icon: '💳' },
        { id: 'cat_impostos_br', name: 'Impostos / Taxas', type: 'expense', country: 'BR', icon: '🧾' },
        { id: 'cat_outros_br', name: 'Compromissos Diversos', type: 'expense', country: 'BR', icon: '🇧🇷' }
    ];

    // --- COMUNICAÇÃO SEGURA COM GOOGLE DRIVE (POST ONLY) ---
    const syncToDrive = async () => {
        const url = state.settings.googleScriptUrl;
        if (!url) return;
        try {
            await fetch(url, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'sync',
                    token: state.settings.apiToken || DEFAULT_TOKEN,
                    transactions: state.transactions
                })
            });
            showToast('Dados protegidos e salvos no Drive!');
        } catch (e) {
            console.error('Erro de sincronização:', e);
        }
    };

    const syncFromDrive = async () => {
        const url = state.settings.googleScriptUrl;
        if (!url) { showToast('URL do Drive não configurada.', 'error'); return; }
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'fetch',
                    token: state.settings.apiToken || DEFAULT_TOKEN
                })
            });
            const data = await res.json();
            if (data.status === 'success' && data.transactions) {
                state.transactions = data.transactions;
                saveState();
                renderApp();
                showToast('Dados atualizados do Google Drive!');
            } else if (data.message) {
                showToast(data.message, 'error');
            }
        } catch (e) {
            showToast('Erro ao consultar o Google Drive.', 'error');
        }
    };

    const initState = () => {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            try {
                state = JSON.parse(raw);
                state.categories = [...defaultCategories];
                if (!state.settings) state.settings = { currencyBR: 'R$', currencyES: '€', monthStartDay: 1, googleScriptUrl: '', apiToken: DEFAULT_TOKEN };
            } catch (e) { resetState(); }
        } else { resetState(); }
    };

    const resetState = () => {
        state = {
            users: [], transactions: [], categories: [...defaultCategories],
            settings: { currencyBR: 'R$', currencyES: '€', monthStartDay: 1, googleScriptUrl: '', apiToken: DEFAULT_TOKEN },
            currentUser: null, sessionExpiry: null, privacyMode: false
        };
        saveState();
    };

    const saveState = () => { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); };

    const resetAllData = () => {
        if (confirm('Isso apagará todas as configurações locais. Deseja continuar?')) {
            localStorage.clear(); sessionStorage.clear(); location.reload();
        }
    };

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
        state.sessionExpiry = null;
        if (inactivityTimer) clearTimeout(inactivityTimer);
    };

    const isSetup = () => state.users.length > 0;
    const isLoggedIn = () => {
        const s = getSession();
        if (!s) return false;
        state.currentUser = state.users.find(u => u.id === s.userId);
        return true;
    };

    const togglePrivacy = () => {
        state.privacyMode = !state.privacyMode;
        renderApp();
    };

    const getCurrentMonth = () => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() + 1 }; };

    const filterTransactionsByRange = (startDate, endDate) => {
        return state.transactions.filter(t => {
            if (!t.date) return false;
            if (startDate && t.date < startDate) return false;
            if (endDate && t.date > endDate) return false;
            return true;
        }).sort((a, b) => new Date(b.date) - new Date(a.date));
    };

    const getMonthTotals = (year, month) => {
        const start = new Date(year, month - 1, 1).toISOString().split('T')[0];
        const end = new Date(year, month, 0).toISOString().split('T')[0];
        const txs = filterTransactionsByRange(start, end);
        const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        return { income, expense, balance: income - expense, count: txs.length };
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
        state.users = [user]; saveState(); setSession(user.id); renderApp(); showToast('Conta criada!');
    };

    const doLogin = async () => {
        const email = el('loginEmail')?.value.trim().toLowerCase();
        const pwd = el('loginPwd')?.value;
        if (!email || !pwd) { showToast('Preencha e-mail e senha.', 'error'); return; }
        const user = state.users.find(u => String(u.email).toLowerCase() === email);
        if (!user) { showToast('Usuário ou senha inválidos.', 'error'); return; }
        const hash = await hashPwd(pwd);
        if (user.passwordHash !== hash) { showToast('Usuário ou senha inválidos.', 'error'); return; }
        setSession(user.id); renderApp(); showToast(`Bem-vindo(a), ${user.name}!`);
    };

    const logout = () => { clearSession(); renderLogin(); };

    const renderLogin = () => {
        el('app').innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a5f 0%,#2c5282 50%,#059669 100%)">
            <div style="background:#fff;border-radius:20px;padding:40px;max-width:420px;width:90%;box-shadow:0 25px 80px rgba(0,0,0,.3)">
                <div style="text-align:center;margin-bottom:28px">
                    <div style="width:64px;height:64px;background:var(--navy);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px">💶</div>
                    <h1 style="margin:0;font-size:24px;color:var(--navy)">Controle Financeiro</h1>
                    <p style="margin:8px 0 0;color:var(--text-light);font-size:14px">València 🇪🇸 & Brasil 🇧🇷</p>
                </div>
                <form id="loginForm" onsubmit="event.preventDefault(); App.doLogin();">
                    <div class="form-group"><label class="form-label">Email</label><input type="email" id="loginEmail" autocomplete="username" class="input-field" required></div>
                    <div class="form-group"><label class="form-label">Senha</label><input type="password" id="loginPwd" autocomplete="current-password" class="input-field" required></div>
                    <button type="submit" class="btn-primary" style="width:100%;padding:14px">Entrar com Segurança</button>
                </form>
                <div style="text-align:center;margin-top:20px"><button onclick="App.resetAllData()" style="background:none;border:none;color:var(--danger);font-size:12px;cursor:pointer;text-decoration:underline">Redefinir Dados Locais</button></div>
            </div>
        </div>`;
    };

    const renderSetup = () => {
        el('app').innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a5f 0%,#2c5282 50%,#059669 100%)">
            <div style="background:#fff;border-radius:20px;padding:40px;max-width:480px;width:90%;box-shadow:0 25px 80px rgba(0,0,0,.3)">
                <div style="text-align:center;margin-bottom:28px">
                    <div style="width:64px;height:64px;background:var(--navy);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px">🔐</div>
                    <h1 style="margin:0;font-size:24px;color:var(--navy)">Primeiro Acesso</h1>
                    <p style="margin:8px 0 0;color:var(--text-light);font-size:14px">Cadastre o administrador do sistema</p>
                </div>
                <form onsubmit="event.preventDefault(); App.doSetup();">
                    <div class="form-group"><label class="form-label">Nome Completo</label><input type="text" id="setupName" class="input-field" required></div>
                    <div class="form-group"><label class="form-label">Email</label><input type="email" id="setupEmail" class="input-field" required></div>
                    <div class="form-group"><label class="form-label">Senha</label><input type="password" id="setupPwd" class="input-field" required minlength="6"></div>
                    <div class="form-group"><label class="form-label">Confirmar Senha</label><input type="password" id="setupPwd2" class="input-field" required minlength="6"></div>
                    <button type="submit" class="btn-primary" style="width:100%;padding:14px">Criar Conta Segura</button>
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
                <div class="nav-item" data-page="reports" onclick="App.nav(this)"><span>📈</span> Relatório & Exportação</div>
                <div class="nav-item" data-page="settings" onclick="App.nav(this)"><span>⚙️</span> Configurações</div>
            </div>
            <div style="padding:16px;border-top:1px solid rgba(255,255,255,.1)">
                <div style="display:flex;align-items:center;gap:10px">
                    <div class="user-avatar">${state.currentUser?.name?.charAt(0).toUpperCase() || 'U'}</div>
                    <div style="flex:1;min-width:0">
                        <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${state.currentUser?.name || ''}</div>
                        <button onclick="App.togglePrivacy()" style="background:none;border:none;color:rgba(255,255,255,.8);cursor:pointer;font-size:12px;padding:0;margin-top:2px">${state.privacyMode ? '👁️ Mostrar Valores' : '🙈 Ocultar Valores'}</button>
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
        const recent = state.transactions.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
        
        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px">
            <div>
                <h2 style="margin:0;font-size:22px;color:var(--navy)">Dashboard</h2>
                <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Resumo do mês atual</p>
            </div>
            <div style="display:flex;gap:10px">
                <button class="btn-primary" style="background:#0284c7" onclick="App.syncFromDrive()">🔄 Atualizar do Drive</button>
                <button class="btn-primary" onclick="App.showAddTransactionModal()">+ Novo Lançamento</button>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px">
            <div class="card stat-card"><div class="stat-label">Saldo do Mês</div><div class="stat-value ${totals.balance >= 0 ? 'emerald-text' : 'danger-text'}">${fmtMoney(totals.balance, state.settings.currencyES)}</div></div>
            <div class="card stat-card"><div class="stat-label">Entradas</div><div class="stat-value emerald-text">${fmtMoney(totals.income, state.settings.currencyES)}</div></div>
            <div class="card stat-card"><div class="stat-label">Saídas</div><div class="stat-value danger-text">${fmtMoney(totals.expense, state.settings.currencyES)}</div></div>
            <div class="card stat-card"><div class="stat-label">Total Registros</div><div class="stat-value" style="color:var(--navy)">${totals.count}</div></div>
        </div>
        <div class="card" style="padding:20px">
            <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">🕐 Últimas Movimentações</h3>
            ${recent.length === 0 ? `<div class="empty-state"><p>Nenhum lançamento cadastrado.</p></div>` : `
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
            <td><span class="category-tag">${cat.icon} ${cat.name}</span></td>
            <td>${t.description || '-'}</td>
            <td><span class="badge badge-info">👤 ${t.assignedTo || 'Casal'}</span></td>
            <td><span class="badge ${isBR ? 'badge-info' : 'badge-warning'}">${isBR ? '🇧🇷 Brasil' : '🇪🇸 Espanha'}</span></td>
            <td style="font-weight:600;color:${t.type === 'income' ? 'var(--emerald)' : 'var(--danger)'}">${fmtMoney(t.amount, isBR ? state.settings.currencyBR : state.settings.currencyES)}</td>
            <td style="text-align:right;white-space:nowrap">
                <button onclick="App.showEditTransactionModal('${t.id}')" style="background:#e0f2fe;color:#0369a1;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;font-weight:600;margin-right:6px">✏️</button>
                <button onclick="App.deleteTransaction('${t.id}')" style="background:#fee2e2;color:#b91c1c;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;font-weight:600">🗑️</button>
            </td>
        </tr>`;
    };

    const renderDashboardCharts = () => {};

    const renderTransactions = () => {
        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px">
            <div>
                <h2 style="margin:0;font-size:22px;color:var(--navy)">Lançamentos</h2>
                <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Histórico completo</p>
            </div>
            <button class="btn-primary" onclick="App.showAddTransactionModal()">+ Novo Lançamento</button>
        </div>
        <div class="card" style="padding:20px">
            <div id="transactionsTable">${renderTransactionsTable()}</div>
        </div>`;
    };

    const renderTransactionsTable = () => {
        const txs = state.transactions.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
        if (txs.length === 0) return `<div class="empty-state"><p>Nenhum lançamento cadastrado.</p></div>`;
        return `<div class="table-container">
            <table class="data-table">
                <thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>Responsável</th><th>País</th><th>Valor</th><th style="text-align:right">Ações</th></tr></thead>
                <tbody>${txs.map(t => renderTransactionRow(t)).join('')}</tbody>
            </table>
        </div>`;
    };

    // --- RELATÓRIOS, FILTRO POR PERÍODO, EXPORTAÇÃO EXCEL E IMPRESSÃO ---
    const renderReports = () => {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

        return `<div class="no-print" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px">
            <div>
                <h2 style="margin:0;font-size:22px;color:var(--navy)">Relatórios & Exportação</h2>
                <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Selecione o período para consulta, impressão ou download em Excel</p>
            </div>
            <div style="display:flex;gap:10px">
                <button class="btn-primary" style="background:#10b981" onclick="App.exportToExcel()">📊 Exportar para Excel (.csv)</button>
                <button class="btn-primary" style="background:#4b5563" onclick="window.print()">🖨️ Imprimir / PDF</button>
            </div>
        </div>
        <div class="card no-print" style="padding:20px;margin-bottom:24px">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;align-items:end">
                <div class="form-group" style="margin:0">
                    <label class="form-label">Data Inicial</label>
                    <input type="date" id="reportStartDate" class="input-field" value="${firstDay}" onchange="App.updateReportView()">
                </div>
                <div class="form-group" style="margin:0">
                    <label class="form-label">Data Final</label>
                    <input type="date" id="reportEndDate" class="input-field" value="${lastDay}" onchange="App.updateReportView()">
                </div>
                <div>
                    <button class="btn-primary" style="width:100%" onclick="App.updateReportView()">Filtrar Período</button>
                </div>
            </div>
        </div>
        <div id="reportContainer">${generateReportHTML(firstDay, lastDay)}</div>`;
    };

    const updateReportView = () => {
        const start = el('reportStartDate')?.value;
        const end = el('reportEndDate')?.value;
        const container = el('reportContainer');
        if (container) container.innerHTML = generateReportHTML(start, end);
    };

    const generateReportHTML = (start, end) => {
        const txs = filterTransactionsByRange(start, end);
        const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const balance = income - expense;

        return `<div class="card" style="padding:24px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;border-bottom:2px solid #eee;padding-bottom:12px">
                <div>
                    <h3 style="margin:0;color:var(--navy)">FinFam - Extrato Financeiro</h3>
                    <p style="margin:4px 0 0;font-size:13px;color:var(--text-light)">Período: <strong>${fmtDate(start)}</strong> até <strong>${fmtDate(end)}</strong></p>
                </div>
                <div style="text-align:right">
                    <div style="font-size:12px;color:var(--text-light)">Total de Lançamentos</div>
                    <div style="font-weight:700;font-size:18px;color:var(--navy)">${txs.length}</div>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">
                <div style="background:#f8fafc;padding:12px;border-radius:8px"><span style="font-size:12px;color:var(--text-light)">Total Receitas</span><div style="font-size:18px;font-weight:700" class="emerald-text">${fmtMoney(income, state.settings.currencyES)}</div></div>
                <div style="background:#f8fafc;padding:12px;border-radius:8px"><span style="font-size:12px;color:var(--text-light)">Total Despesas</span><div style="font-size:18px;font-weight:700" class="danger-text">${fmtMoney(expense, state.settings.currencyES)}</div></div>
                <div style="background:#f8fafc;padding:12px;border-radius:8px"><span style="font-size:12px;color:var(--text-light)">Resultado Líquido</span><div style="font-size:18px;font-weight:700" class="${balance >= 0 ? 'emerald-text' : 'danger-text'}">${fmtMoney(balance, state.settings.currencyES)}</div></div>
            </div>
            ${txs.length === 0 ? '<p style="color:var(--text-light)">Nenhum registro encontrado no período selecionado.</p>' : `
            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th>Responsável</th><th>País</th><th>Valor</th></tr></thead>
                    <tbody>${txs.map(t => {
                        const cat = state.categories.find(c => c.id === t.categoryId) || { name: 'Geral', icon: '📋' };
                        const isBR = t.country === 'BR';
                        return `<tr>
                            <td>${fmtDate(t.date)}</td>
                            <td><span class="badge ${t.type === 'income' ? 'badge-success' : 'badge-danger'}">${t.type === 'income' ? 'Entrada' : 'Saída'}</span></td>
                            <td>${cat.icon} ${cat.name}</td>
                            <td>${t.description || '-'}</td>
                            <td>${t.assignedTo || 'Casal'}</td>
                            <td>${isBR ? 'Brasil' : 'Espanha'}</td>
                            <td style="font-weight:600;color:${t.type === 'income' ? 'var(--emerald)' : 'var(--danger)'}">${fmtMoney(t.amount, isBR ? state.settings.currencyBR : state.settings.currencyES)}</td>
                        </tr>`;
                    }).join('')}</tbody>
                </table>
            </div>`}
        </div>`;
    };

    const exportToExcel = () => {
        const start = el('reportStartDate')?.value;
        const end = el('reportEndDate')?.value;
        const txs = filterTransactionsByRange(start, end);

        if (txs.length === 0) {
            showToast('Nenhum dado para exportar no período.', 'error');
            return;
        }

        let csvContent = "\uFEFF"; // UTF-8 BOM para garantir acentos e moedas no Excel
        csvContent += "ID;Data;Tipo;Categoria;Descricao;Responsavel;Pais;Valor\n";

        txs.forEach(t => {
            const cat = state.categories.find(c => c.id === t.categoryId) || { name: 'Geral' };
            const row = [
                t.id,
                fmtDate(t.date),
                t.type === 'income' ? 'Entrada' : 'Saida',
                `"${cat.name.replace(/"/g, '""')}"`,
                `"${(t.description || '').replace(/"/g, '""')}"`,
                `"${(t.assignedTo || 'Casal').replace(/"/g, '""')}"`,
                t.country === 'BR' ? 'Brasil' : 'Espanha',
                String(t.amount).replace('.', ',')
            ];
            csvContent += row.join(";") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `FinFam_Relatorio_${start}_a_${end}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('Planilha Excel baixada com sucesso!');
    };

    const renderSettings = () => {
        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px">
            <div>
                <h2 style="margin:0;font-size:22px;color:var(--navy)">Configurações & Segurança</h2>
                <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Conexão com Google Drive</p>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:16px">
            <div class="card" style="padding:24px">
                <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">🔗 Conexão Google Drive</h3>
                <div class="form-group">
                    <label class="form-label">URL do Web App (Google Apps Script)</label>
                    <input type="url" id="googleScriptUrl" class="input-field" value="${state.settings.googleScriptUrl || ''}" placeholder="https://script.google.com/macros/s/.../exec">
                </div>
                <div class="form-group">
                    <label class="form-label">Token de Autenticação (Chave de Segurança)</label>
                    <input type="text" id="apiToken" class="input-field" value="${state.settings.apiToken || DEFAULT_TOKEN}">
                </div>
                <button class="btn-primary" onclick="App.saveGoogleSettings()">Salvar Configurações</button>
            </div>
        </div>`;
    };

    const saveGoogleSettings = () => {
        state.settings.googleScriptUrl = el('googleScriptUrl').value.trim();
        state.settings.apiToken = el('apiToken').value.trim();
        saveState();
        showToast('Configurações salvas!');
        if (state.settings.googleScriptUrl) syncFromDrive();
    };

    const closeModal = () => { el('modalOverlay')?.classList.remove('active'); };

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
                    <label class="form-label">Tipo</label>
                    <select id="txType" class="input-field" onchange="App.filterCategoriesByType(this.value)">
                        <option value="expense">Saída / Despesa</option>
                        <option value="income">Entrada / Receita</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Valor</label>
                    <input type="number" step="0.01" id="txAmount" class="input-field" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Categoria</label>
                    <select id="txCategory" class="input-field" required>
                        ${initialCats.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Responsável</label>
                    <select id="txAssignedTo" class="input-field">
                        <option value="Casal / Ambos">👩‍❤️‍👨 Casal / Ambos</option>
                        ${userOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">País</label>
                    <select id="txCountry" class="input-field">
                        <option value="ES">🇪🇸 Espanha (€)</option>
                        <option value="BR">🇧🇷 Brasil (R$)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Data</label>
                    <input type="date" id="txDate" class="input-field" value="${new Date().toISOString().split('T')[0]}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Descrição</label>
                    <input type="text" id="txDesc" class="input-field">
                </div>
                <button type="submit" class="btn-primary" style="width:100%">Salvar Lançamento</button>
            </form>
        `;
        overlay.classList.add('active');
    };

    const showEditTransactionModal = (id) => {
        const tx = state.transactions.find(t => t.id === id);
        if (!tx) return;

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
                    <label class="form-label">Tipo</label>
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
                    <label class="form-label">Responsável</label>
                    <select id="txAssignedTo" class="input-field">
                        <option value="Casal / Ambos" ${tx.assignedTo === 'Casal / Ambos' ? 'selected' : ''}>👩‍❤️‍👨 Casal / Ambos</option>
                        ${userOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">País</label>
                    <select id="txCountry" class="input-field">
                        <option value="ES" ${tx.country === 'ES' ? 'selected' : ''}>🇪🇸 Espanha (€)</option>
                        <option value="BR" ${tx.country === 'BR' ? 'selected' : ''}>🇧🇷 Brasil (R$)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Data</label>
                    <input type="date" id="txDate" class="input-field" value="${tx.date}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Descrição</label>
                    <input type="text" id="txDesc" class="input-field" value="${tx.description || ''}">
                </div>
                <button type="submit" class="btn-primary" style="width:100%">Salvar Alterações</button>
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
            id: generateId(), amount, categoryId, type, country, date, assignedTo, description,
            userId: state.currentUser.id, createdAt: now()
        });

        saveState();
        syncToDrive();
        closeModal();
        renderApp();
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
        syncToDrive();
        closeModal();
        renderApp();
    };

    const deleteTransaction = (id) => {
        if (confirm('Remover este lançamento?')) {
            state.transactions = state.transactions.filter(t => t.id !== id);
            saveState();
            syncToDrive();
            renderApp();
        }
    };

    const nav = (elem) => {
        document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
        document.querySelectorAll('.page').forEach(e => e.classList.remove('active'));
        elem.classList.add('active');
        const targetPage = elem.getAttribute('data-page');
        const pageEl = el(targetPage);
        if (pageEl) pageEl.classList.add('active');
    };

    ['click', 'mousemove', 'keypress'].forEach(evt => {
        document.addEventListener(evt, resetInactivityTimer, true);
    });

    return {
        init: () => {
            initState();
            if (!isSetup()) renderSetup();
            else if (!isLoggedIn()) renderLogin();
            else renderApp();
        },
        doLogin, doSetup, logout, nav, resetAllData, togglePrivacy,
        showAddTransactionModal, showEditTransactionModal,
        doSaveTransaction, doUpdateTransaction, deleteTransaction,
        closeModal, filterCategoriesByType, saveGoogleSettings, syncFromDrive,
        updateReportView, exportToExcel
    };
})();

window.App = App;

document.addEventListener('DOMContentLoaded', () => { App.init(); });
