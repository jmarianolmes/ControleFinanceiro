const App = (() => {
    const STORAGE_KEY = 'finfam_data_v1';
    const SESSION_KEY = 'finfam_session';
    const DEFAULT_TOKEN = 'FinFam_SecureToken_2026_@Key';
    const INACTIVITY_TIMEOUT = 15 * 60 * 1000;

    let state = {
        users: [],
        transactions: [],
        categories: [],
        settings: { currencyBR: 'R$', currencyES: '€', monthStartDay: 1, googleScriptUrl: '', apiToken: DEFAULT_TOKEN },
        currentUser: null,
        sessionExpiry: null,
        privacyMode: false,
        selectedMonth: new Date().toISOString().slice(0, 7)
    };

    let inactivityTimer = null;
    const el = id => document.getElementById(id);

    const fmtDate = d => {
        if (!d) return '-';
        const parts = String(d).split('-');
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

    // RESTAURADO: Lista completa de categorias incluindo Investimentos
    const defaultCategories = [
        { id: 'cat_salario_es', name: 'Salário / Emprego', type: 'income', country: 'ES', icon: '💼' },
        { id: 'cat_freelance_es', name: 'Trabalho Freelance / Extras', type: 'income', country: 'ES', icon: '💻' },
        { id: 'cat_outras_entradas_es', name: 'Outras Receitas', type: 'income', country: 'ES', icon: '💶' },
        { id: 'cat_rendimentos', name: 'Rendimentos & Dividendos', type: 'income', country: 'ES', icon: '💰' },
        { id: 'cat_aluguel_br', name: 'Receita Aluguel', type: 'income', country: 'BR', icon: '🏠' },
        { id: 'cat_invest_es', name: 'Investimentos & Ações (ES)', type: 'investment', country: 'ES', icon: '📈' },
        { id: 'cat_invest_br', name: 'Investimentos & Tesouro (BR)', type: 'investment', country: 'BR', icon: '🇧🇷' },
        { id: 'cat_aluguel_es', name: 'Aluguel de Moradia', type: 'expense', country: 'ES', icon: '🔑' },
        { id: 'cat_hipoteca_es', name: 'Hipoteca / Financiamento', type: 'expense', country: 'ES', icon: '🏛️' },
        { id: 'cat_mercado', name: 'Mercado / Alimentação', type: 'expense', country: 'ES', icon: '🛒' },
        { id: 'cat_agua', name: 'Água', type: 'expense', country: 'ES', icon: '💧' },
        { id: 'cat_luz', name: 'Energia / Luz', type: 'expense', country: 'ES', icon: '⚡' },
        { id: 'cat_gas', name: 'Gás', type: 'expense', country: 'ES', icon: '🔥' },
        { id: 'cat_escola', name: 'Escola / Crianças', type: 'expense', country: 'ES', icon: '🎒' },
        { id: 'cat_veiculo', name: 'Veículo / Transporte', type: 'expense', country: 'ES', icon: '🚗' },
        { id: 'cat_lazer', name: 'Lazer & Família', type: 'expense', country: 'ES', icon: '🎬' },
        { id: 'cat_outros_es', name: 'Outras Despesas', type: 'expense', country: 'ES', icon: '📋' },
        { id: 'cat_cc_br', name: 'Cartão de Crédito', type: 'expense', country: 'BR', icon: '💳' },
        { id: 'cat_outros_br', name: 'Compromissos Diversos', type: 'expense', country: 'BR', icon: '🇧🇷' }
    ];

    // --- COMUNICAÇÃO GOOGLE DRIVE ---
    const syncToDrive = async () => {
        const url = state.settings.googleScriptUrl;
        if (!url) return;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'sync', token: state.settings.apiToken || DEFAULT_TOKEN, transactions: state.transactions })
            });
            const data = await res.json();
            if (data.status === 'success') {
                showToast('Dados salvos no Google Drive com sucesso!');
            } else {
                showToast(data.message || 'Erro ao salvar no Drive.', 'error');
            }
        } catch (e) {
            showToast('Erro ao comunicar com o Google Drive.', 'error');
        }
    };

    const syncFromDrive = async (silent = false) => {
        const url = state.settings.googleScriptUrl;
        if (!url) {
            if (!silent) showToast('URL do Google Drive não configurada nas Configurações.', 'error');
            return;
        }
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'fetch', token: state.settings.apiToken || DEFAULT_TOKEN })
            });
            const data = await res.json();
            if (data.status === 'success' && Array.isArray(data.transactions)) {
                state.transactions = data.transactions;
                saveState();
                
                // Atualiza a tela ativa imediatamente após baixar do banco
                const activePage = document.querySelector('.page.active')?.id;
                if (activePage === 'dashboard' || !activePage) {
                    const dash = el('dashboard');
                    if (dash) dash.innerHTML = renderDashboard();
                } else if (activePage === 'transactions') {
                    const txTable = el('transactionsTable');
                    if (txTable) txTable.innerHTML = renderTransactionsTable();
                }
                if (!silent) showToast('Dados sincronizados do Banco de Dados!');
            }
        } catch (e) {
            if (!silent) showToast('Erro ao consultar o Banco de Dados.', 'error');
        }
    };

    const checkConnection = async () => {
        const dot = el('connStatusDot');
        const text = el('connStatusText');
        const url = state.settings.googleScriptUrl;
        if (!dot || !text) return;
        if (!url) {
            dot.style.backgroundColor = '#ef4444';
            text.textContent = 'URL não configurada';
            return;
        }
        text.textContent = 'Verificando...';
        dot.style.backgroundColor = '#f59e0b';
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'ping', token: state.settings.apiToken || DEFAULT_TOKEN })
            });
            const data = await res.json();
            if (data.status === 'success') {
                dot.style.backgroundColor = '#10b981';
                text.textContent = 'Conectado com Sucesso';
            } else {
                dot.style.backgroundColor = '#ef4444';
                text.textContent = 'Erro de Autenticação / Token';
            }
        } catch (e) {
            dot.style.backgroundColor = '#ef4444';
            text.textContent = 'Falha na Conexão';
        }
    };

    const initState = () => {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            try {
                state = JSON.parse(raw);
                state.categories = [...defaultCategories];
                if (!state.selectedMonth) state.selectedMonth = new Date().toISOString().slice(0, 7);
                if (!state.settings) state.settings = { currencyBR: 'R$', currencyES: '€', monthStartDay: 1, googleScriptUrl: '', apiToken: DEFAULT_TOKEN };
            } catch (e) {
                resetState();
            }
        } else {
            resetState();
        }
    };

    const resetState = () => {
        state = {
            users: [],
            transactions: [],
            categories: [...defaultCategories],
            settings: { currencyBR: 'R$', currencyES: '€', monthStartDay: 1, googleScriptUrl: '', apiToken: DEFAULT_TOKEN },
            currentUser: null,
            sessionExpiry: null,
            privacyMode: false,
            selectedMonth: new Date().toISOString().slice(0, 7)
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
        } catch (e) {
            return null;
        }
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

    const filterTransactionsByRange = (startDate, endDate) => {
        return state.transactions.filter(t => {
            if (!t || !t.date) return false;
            const d = String(t.date).trim().substring(0, 10);
            if (startDate && d < startDate) return false;
            if (endDate && d > endDate) return false;
            return true;
        }).sort((a, b) => new Date(b.date) - new Date(a.date));
    };

    // FILTRO DE MÊS ROBUSTO: Lê perfeitamente do banco de dados (Google Drive)
    const getSelectedMonthData = () => {
        const ym = state.selectedMonth; // Formato 'YYYY-MM'
        const txs = state.transactions.filter(t => {
            if (!t || !t.date) return false;
            const rawDate = String(t.date).trim();
            if (rawDate.startsWith(ym)) return true;
            try {
                const d = new Date(rawDate);
                if (!isNaN(d.getTime())) {
                    return d.toISOString().slice(0, 7) === ym;
                }
            } catch (e) {}
            return false;
        }).sort((a, b) => new Date(b.date) - new Date(a.date));

        const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const investment = txs.filter(t => t.type === 'investment').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        
        // Saldo desconta despesas e investimentos aportados
        const balance = income - expense - investment;
        const savingsRate = income > 0 ? (((income - expense) / income) * 100) : 0;

        return { income, expense, investment, balance, savingsRate, txs };
    };

    const changeSelectedMonth = (ym) => {
        if (!ym) return;
        state.selectedMonth = ym;
        saveState();
        const dash = el('dashboard');
        if (dash) dash.innerHTML = renderDashboard();
    };

    // --- AUTENTICAÇÃO E TELAS INICIAIS ---
    const doSetup = async () => {
        const name = el('setupName')?.value.trim();
        const email = el('setupEmail')?.value.trim().toLowerCase();
        const pwd = el('setupPwd')?.value;
        const pwd2 = el('setupPwd2')?.value;
        if (!name || !email || !pwd) { showToast('Preencha todos os campos.', 'error'); return; }
        if (pwd !== pwd2) { showToast('As senhas não coincidem.', 'error'); return; }
        const passwordHash = await hashPwd(pwd);
        const user = { id: generateId(), name, email, passwordHash, role: 'admin', createdAt: now() };
        state.users = [user];
        saveState();
        setSession(user.id);
        renderApp();
        showToast('Conta criada com sucesso!');
    };

    const doLogin = async () => {
        const email = el('loginEmail')?.value.trim().toLowerCase();
        const pwd = el('loginPwd')?.value;
        const user = state.users.find(u => String(u.email).toLowerCase() === email);
        if (!user) { showToast('Usuário não encontrado.', 'error'); return; }
        const hash = await hashPwd(pwd);
        if (user.passwordHash !== hash) { showToast('Senha incorreta.', 'error'); return; }
        setSession(user.id);
        renderApp();
        syncFromDrive(true);
        showToast('Sessão iniciada!');
    };

    const logout = () => {
        clearSession();
        init();
    };

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
        el('app').innerHTML = `
            <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a5f 0%,#2c5282 50%,#059669 100%)">
                <div style="background:#fff;border-radius:20px;padding:40px;width:90%;max-width:400px;box-shadow:0 25px 80px rgba(0,0,0,.3)">
                    <div style="text-align:center;margin-bottom:24px">
                        <div style="font-size:40px;margin-bottom:8px">💶</div>
                        <h1 style="color:var(--navy);margin:0;font-size:24px">FinFam Login</h1>
                        <p style="color:var(--text-light);font-size:13px;margin:4px 0 0">Controle Financeiro Familiar</p>
                    </div>
                    <form onsubmit="event.preventDefault(); App.doLogin();">
                        <div style="margin-bottom:16px">
                            <label class="form-label">Email</label>
                            <input type="email" id="loginEmail" placeholder="seu@email.com" class="input-field" required>
                        </div>
                        <div style="margin-bottom:24px">
                            <label class="form-label">Senha</label>
                            <input type="password" id="loginPwd" placeholder="••••••••" class="input-field" required>
                        </div>
                        <button type="submit" class="btn-primary" style="width:100%;padding:12px">Entrar no Sistema</button>
                    </form>
                </div>
            </div>`;
    };

    const renderSetup = () => {
        el('app').innerHTML = `
            <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a5f 0%,#2c5282 50%,#059669 100%)">
                <div style="background:#fff;border-radius:20px;padding:40px;width:90%;max-width:420px;box-shadow:0 25px 80px rgba(0,0,0,.3)">
                    <div style="text-align:center;margin-bottom:24px">
                        <div style="font-size:40px;margin-bottom:8px">🚀</div>
                        <h1 style="color:var(--navy);margin:0;font-size:24px">Configuração Inicial</h1>
                        <p style="color:var(--text-light);font-size:13px;margin:4px 0 0">Crie sua conta administrativa principal</p>
                    </div>
                    <form onsubmit="event.preventDefault(); App.doSetup();">
                        <div style="margin-bottom:14px">
                            <label class="form-label">Nome Completo</label>
                            <input type="text" id="setupName" placeholder="Seu Nome" class="input-field" required>
                        </div>
                        <div style="margin-bottom:14px">
                            <label class="form-label">Email</label>
                            <input type="email" id="setupEmail" placeholder="seu@email.com" class="input-field" required>
                        </div>
                        <div style="margin-bottom:14px">
                            <label class="form-label">Senha</label>
                            <input type="password" id="setupPwd" placeholder="Mínimo 6 caracteres" class="input-field" required>
                        </div>
                        <div style="margin-bottom:24px">
                            <label class="form-label">Confirmar Senha</label>
                            <input type="password" id="setupPwd2" placeholder="Repita a senha" class="input-field" required>
                        </div>
                        <button type="submit" class="btn-primary" style="width:100%;padding:12px">Criar Conta e Iniciar</button>
                    </form>
                </div>
            </div>`;
    };

    const renderApp = () => {
        el('app').innerHTML = `
            <div class="sidebar">
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
                            <button onclick="App.togglePrivacy()" style="background:none;border:none;color:rgba(255,255,255,.8);cursor:pointer;font-size:12px;padding:0">${state.privacyMode ? '👁️ Mostrar' : '🙈 Ocultar'}</button>
                        </div>
                        <button onclick="App.logout()" style="background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:18px" title="Sair">🚪</button>
                    </div>
                </div>
            </div>
            <div class="main-content">
                <div id="dashboard" class="page active">${renderDashboard()}</div>
                <div id="transactions" class="page">${renderTransactions()}</div>
                <div id="reports" class="page">${renderReports()}</div>
                <div id="settings" class="page">${renderSettings()}</div>
            </div>
            
            <!-- MODAL COM ESTILOS SEGUROS (Z-INDEX 9999) -->
            <div id="modalOverlay" class="modal-overlay" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.6); z-index:9999; align-items:center; justify-content:center; backdrop-filter:blur(4px);">
                <div id="modalContent" class="modal" style="background:#fff; padding:24px; border-radius:12px; width:90%; max-width:550px; max-height:90vh; overflow-y:auto; box-shadow:0 10px 25px rgba(0,0,0,0.2);"></div>
            </div>
            <div id="toast" class="toast"></div>`;
    };

    const renderDashboard = () => {
        const m = getSelectedMonthData();

        // Dados para Gráficos Avançados de Inteligência Financeira
        const expByCategory = {};
        m.txs.filter(t => t.type === 'expense').forEach(t => {
            const catName = state.categories.find(c => c.id === t.categoryId)?.name || 'Outros';
            expByCategory[catName] = (expByCategory[catName] || 0) + (Number(t.amount) || 0);
        });
        const sortedCats = Object.entries(expByCategory).sort((a, b) => b[1] - a[1]);

        return `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px">
            <div>
                <h2 style="margin:0;font-size:22px;color:var(--navy)">Visão Geral do Mês</h2>
                <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Acompanhamento consolidado da família</p>
            </div>
            <div style="display:flex;gap:10px;align-items:center">
                <input type="month" id="dashMonthPicker" class="input-field" style="padding:8px 12px;font-weight:600" value="${state.selectedMonth}" onchange="App.changeSelectedMonth(this.value)">
                <button class="btn-primary" onclick="App.showTransactionModal(null)">+ Novo Lançamento</button>
            </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
            <div class="card stat-card"><div class="stat-label">Saldo Livre</div><div class="stat-value ${m.balance >= 0 ? 'emerald-text' : 'danger-text'}">${fmtMoney(m.balance, state.settings.currencyES)}</div></div>
            <div class="card stat-card"><div class="stat-label">Receitas</div><div class="stat-value emerald-text">${fmtMoney(m.income, state.settings.currencyES)}</div></div>
            <div class="card stat-card"><div class="stat-label">Despesas</div><div class="stat-value danger-text">${fmtMoney(m.expense, state.settings.currencyES)}</div></div>
            <div class="card stat-card" style="border-left:4px solid #8b5cf6"><div class="stat-label">Investimentos / Aportes</div><div class="stat-value" style="color:#8b5cf6">${fmtMoney(m.investment, state.settings.currencyES)}</div></div>
        </div>

        <!-- GRÁFICOS AVANÇADOS DE INTELIGÊNCIA FINANCEIRA -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;margin-bottom:24px">
            <div class="card" style="padding:24px">
                <h3 style="margin:0 0 20px;font-size:16px;color:var(--navy);display:flex;align-items:center;gap:8px">📊 Distribuição de Gastos por Categoria</h3>
                ${sortedCats.length === 0 ? '<p style="color:var(--text-light);font-size:14px">Sem despesas registradas no período.</p>' : 
                    sortedCats.slice(0, 5).map(([cat, val]) => {
                        const pct = m.expense > 0 ? ((val / m.expense) * 100).toFixed(1) : 0;
                        return `<div style="margin-bottom:16px">
                            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;font-weight:600;color:var(--navy)">
                                <span>${cat}</span>
                                <span>${fmtMoney(val, state.settings.currencyES)} (${pct}%)</span>
                            </div>
                            <div style="width:100%;background:#f1f5f9;height:8px;border-radius:4px;overflow:hidden">
                                <div style="width:${pct}%;background:#ef4444;height:100%;border-radius:4px"></div>
                            </div>
                        </div>`;
                    }).join('')
                }
            </div>

            <div class="card" style="padding:24px">
                <h3 style="margin:0 0 20px;font-size:16px;color:var(--navy);display:flex;align-items:center;gap:8px">🎯 Eficiência Financeira</h3>
                
                <div style="margin-bottom:20px">
                    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;font-weight:600;color:var(--navy)">
                        <span>Taxa de Gastos (${m.income > 0 ? ((m.expense / m.income) * 100).toFixed(1) : 0}%)</span>
                    </div>
                    <div style="width:100%;background:#f1f5f9;height:12px;border-radius:6px;overflow:hidden">
                        <div style="width:${Math.min(100, m.income > 0 ? (m.expense / m.income) * 100 : 0)}%;background:#ef4444;height:100%"></div>
                    </div>
                </div>

                <div style="margin-bottom:20px">
                    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;font-weight:600;color:var(--navy)">
                        <span>Taxa de Aportes/Investimentos (${m.income > 0 ? ((m.investment / m.income) * 100).toFixed(1) : 0}%)</span>
                    </div>
                    <div style="width:100%;background:#f1f5f9;height:12px;border-radius:6px;overflow:hidden">
                        <div style="width:${Math.min(100, m.income > 0 ? (m.investment / m.income) * 100 : 0)}%;background:#8b5cf6;height:100%"></div>
                    </div>
                </div>

                <div>
                    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;font-weight:600;color:var(--navy)">
                        <span>Poupança Líquida (${Math.max(0, m.savingsRate).toFixed(1)}%)</span>
                    </div>
                    <div style="width:100%;background:#f1f5f9;height:12px;border-radius:6px;overflow:hidden">
                        <div style="width:${Math.max(0, Math.min(100, m.savingsRate))}%;background:#10b981;height:100%"></div>
                    </div>
                </div>
            </div>
        </div>

        <div class="card" style="padding:20px">
            <h3 style="margin:0 0 16px;font-size:16px;color:var(--navy)">📅 Extrato do Mês Selecionado</h3>
            ${m.txs.length === 0 ? `<div class="empty-state"><p>Nenhum lançamento encontrado para este mês.</p></div>` : `
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
        
        let typeColor = 'var(--danger)';
        let typeLabel = 'Despesa';
        if (t.type === 'income') { typeColor = 'var(--emerald)'; typeLabel = 'Receita'; } 
        else if (t.type === 'investment') { typeColor = '#8b5cf6'; typeLabel = 'Investimento'; }

        return `<tr>
            <td style="white-space:nowrap">${fmtDate(t.date)}</td>
            <td><span class="badge" style="background:${typeColor}22;color:${typeColor};font-weight:700">${typeLabel}</span></td>
            <td><span class="category-tag">${cat.icon} ${cat.name}</span></td>
            <td>${t.description || '-'}</td>
            <td><span class="badge badge-info">👤 ${t.assignedTo || 'Casal'}</span></td>
            <td><span class="badge ${isBR ? 'badge-info' : 'badge-warning'}">${isBR ? '🇧🇷 Brasil' : '🇪🇸 Espanha'}</span></td>
            <td style="font-weight:600;color:${typeColor}">${fmtMoney(t.amount, isBR ? state.settings.currencyBR : state.settings.currencyES)}</td>
            <td style="text-align:right;white-space:nowrap">
                <button onclick="App.showTransactionModal('${t.id}')" style="background:#e0f2fe;color:#0369a1;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;font-weight:600;margin-right:6px">✏️</button>
                <button onclick="App.deleteTransaction('${t.id}')" style="background:#fee2e2;color:#b91c1c;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;font-weight:600">🗑️</button>
            </td>
        </tr>`;
    };

    // BOTÃO REMOVIDO DA PÁGINA DE LANÇAMENTOS CONFORME PEDIDO
    const renderTransactions = () => {
        return `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
            <div>
                <h2 style="margin:0;font-size:22px;color:var(--navy)">Histórico Completo de Lançamentos</h2>
                <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Visualização geral de todas as movimentações</p>
            </div>
        </div>
        <div class="card" style="padding:20px">
            <div id="transactionsTable">${renderTransactionsTable()}</div>
        </div>`;
    };

    const renderTransactionsTable = () => {
        const txs = state.transactions.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
        if (txs.length === 0) return `<div class="empty-state"><p>Nenhum lançamento cadastrado no banco de dados.</p></div>`;
        return `
        <div class="table-container">
            <table class="data-table">
                <thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th>Responsável</th><th>País</th><th>Valor</th><th style="text-align:right">Ações</th></tr></thead>
                <tbody>${txs.map(t => renderTransactionRow(t)).join('')}</tbody>
            </table>
        </div>`;
    };

    // --- RELATÓRIOS ---
    const renderReports = () => {
        const ym = state.selectedMonth;
        const firstDay = `${ym}-01`;
        const lastDayNum = new Date(ym.split('-')[0], ym.split('-')[1], 0).getDate();
        const lastDay = `${ym}-${String(lastDayNum).padStart(2, '0')}`;
        
        return `
        <div class="no-print" style="margin-bottom:24px">
            <h2 style="margin:0;font-size:22px;color:var(--navy)">Relatórios Analíticos</h2>
            <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Filtre por período personalizado</p>
        </div>
        <div class="card no-print" style="padding:20px;margin-bottom:24px">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;align-items:end">
                <div>
                    <label class="form-label">Data Inicial</label>
                    <input type="date" id="reportStartDate" class="input-field" value="${firstDay}">
                </div>
                <div>
                    <label class="form-label">Data Final</label>
                    <input type="date" id="reportEndDate" class="input-field" value="${lastDay}">
                </div>
                <button class="btn-primary" onclick="App.updateReportView()">Filtrar Período</button>
                <button class="btn-primary" style="background:#10b981" onclick="App.exportToExcel()">Exportar .CSV</button>
            </div>
        </div>
        <div id="reportContainer">${generateReportHTML(firstDay, lastDay)}</div>`;
    };

    const updateReportView = () => {
        const s = el('reportStartDate')?.value;
        const e = el('reportEndDate')?.value;
        const container = el('reportContainer');
        if (container) container.innerHTML = generateReportHTML(s, e);
    };

    const generateReportHTML = (start, end) => {
        const txs = filterTransactionsByRange(start, end);
        const inc = txs.filter(t => t.type === 'income').reduce((acc, t) => acc + Number(t.amount || 0), 0);
        const exp = txs.filter(t => t.type === 'expense').reduce((acc, t) => acc + Number(t.amount || 0), 0);
        const inv = txs.filter(t => t.type === 'investment').reduce((acc, t) => acc + Number(t.amount || 0), 0);
        const bal = inc - exp - inv;

        return `
        <div class="card" style="padding:24px">
            <h3 style="margin:0 0 16px;color:var(--navy)">Balanço do Período (${fmtDate(start)} até ${fmtDate(end)})</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px">
                <div style="background:#f8fafc;padding:12px;border-radius:8px">
                    <div style="font-size:12px;color:var(--text-light)">Total Receitas</div>
                    <div style="font-size:18px;font-weight:bold;color:var(--emerald)">${fmtMoney(inc, state.settings.currencyES)}</div>
                </div>
                <div style="background:#f8fafc;padding:12px;border-radius:8px">
                    <div style="font-size:12px;color:var(--text-light)">Total Despesas</div>
                    <div style="font-size:18px;font-weight:bold;color:var(--danger)">${fmtMoney(exp, state.settings.currencyES)}</div>
                </div>
                <div style="background:#f8fafc;padding:12px;border-radius:8px">
                    <div style="font-size:12px;color:var(--text-light)">Total Investimentos</div>
                    <div style="font-size:18px;font-weight:bold;color:#8b5cf6">${fmtMoney(inv, state.settings.currencyES)}</div>
                </div>
                <div style="background:#f8fafc;padding:12px;border-radius:8px">
                    <div style="font-size:12px;color:var(--text-light)">Resultado Líquido</div>
                    <div style="font-size:18px;font-weight:bold;color:${bal >= 0 ? 'var(--emerald)' : 'var(--danger)'}">${fmtMoney(bal, state.settings.currencyES)}</div>
                </div>
            </div>
            <h4 style="margin:20px 0 10px;color:var(--navy)">Lançamentos no Período (${txs.length})</h4>
            ${txs.length === 0 ? '<p style="color:var(--text-light)">Nenhum registro encontrado.</p>' : `
            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th>Valor</th></tr></thead>
                    <tbody>${txs.map(t => {
                        const cat = state.categories.find(c => c.id === t.categoryId) || {name:'Geral'};
                        return `<tr><td>${fmtDate(t.date)}</td><td>${t.type}</td><td>${cat.name}</td><td>${t.description||'-'}</td><td>${fmtMoney(t.amount, state.settings.currencyES)}</td></tr>`;
                    }).join('')}</tbody>
                </table>
            </div>`}
        </div>`;
    };

    const exportToExcel = () => {
        const s = el('reportStartDate')?.value;
        const e = el('reportEndDate')?.value;
        const txs = filterTransactionsByRange(s, e);
        if (!txs.length) { showToast('Nenhum dado para exportar.', 'error'); return; }
        
        let csv = 'Data;Tipo;Categoria;Descricao;Responsavel;Pais;Valor\n';
        txs.forEach(t => {
            const cat = state.categories.find(c => c.id === t.categoryId)?.name || '';
            csv += `${t.date};${t.type};${cat};${t.description || ''};${t.assignedTo || ''};${t.country || ''};${t.amount}\n`;
        });
        
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Relatorio_FinFam_${s}_a_${e}.csv`;
        link.click();
        showToast('Relatório exportado com sucesso!');
    };

    // --- CONFIGURAÇÕES ---
    const renderSettings = () => {
        return `
        <div class="card" style="padding:24px;max-width:700px;margin:0 auto">
            <h3 style="margin:0 0 16px;color:var(--navy)">Configuração de Conexão com Google Drive</h3>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;padding:12px;background:#f8fafc;border-radius:8px">
                <span id="connStatusDot" style="width:12px;height:12px;border-radius:50%;background:#f59e0b"></span>
                <span id="connStatusText" style="font-weight:600">Verificando conexão...</span>
                <button onclick="App.checkConnection()" style="margin-left:auto;padding:6px 12px;background:#e2e8f0;border:none;border-radius:6px;cursor:pointer;font-weight:600">Testar Conexão</button>
            </div>
            <form onsubmit="event.preventDefault(); App.saveSettings();">
                <div style="margin-bottom:16px">
                    <label class="form-label">URL do Google Apps Script (Web App)</label>
                    <input type="url" id="cfgUrl" class="input-field" placeholder="https://script.google.com/macros/s/.../exec" value="${state.settings.googleScriptUrl || ''}" required>
                </div>
                <div style="display:flex;gap:12px">
                    <button type="submit" class="btn-primary">Salvar Configurações</button>
                    <button type="button" class="btn-primary" style="background:#0284c7" onclick="App.syncFromDrive()">Forçar Sincronização com o Banco</button>
                </div>
            </form>
            <hr style="margin:30px 0;border:none;border-top:1px solid #e2e8f0">
            <div>
                <h4 style="color:var(--danger);margin-top:0">Zona de Perigo</h4>
                <p style="color:var(--text-light);font-size:13px">Apaga todos os dados locais salvos neste navegador.</p>
                <button onclick="App.resetAllData()" style="background:#fee2e2;color:#b91c1c;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:600">⚠️ Redefinir Sistema Inteiro</button>
            </div>
        </div>`;
    };

    const saveSettings = () => {
        const url = el('cfgUrl')?.value.trim() || '';
        state.settings.googleScriptUrl = url;
        saveState();
        showToast('Configurações salvas!');
        checkConnection();
    };

    const resetAllData = () => {
        if (confirm('Tem certeza absoluta que deseja apagar tudo? Esta ação é irreversível.')) {
            localStorage.clear();
            sessionStorage.clear();
            location.reload();
        }
    };

    // --- MODAL DE LANÇAMENTO (CORRIGIDO E SEGURO) ---
    const showTransactionModal = (txId = null) => {
        let tx = null;
        if (txId && typeof txId === 'string') {
            tx = state.transactions.find(t => t.id === txId);
        }
        
        const isEdit = !!tx;
        const today = new Date().toISOString().slice(0, 10);
        const overlay = el('modalOverlay');
        if (!overlay) return;

        const categoriesOptions = state.categories.map(c => 
            `<option value="${c.id}" ${tx && tx.categoryId === c.id ? 'selected' : ''}>${c.icon} ${c.name} (${c.country})</option>`
        ).join('');

        el('modalContent').innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;border-bottom:1px solid #e2e8f0;padding-bottom:10px;">
                <h3 style="margin:0;color:var(--navy);font-size:18px;">${isEdit ? '✏️ Editar Lançamento' : '➕ Novo Lançamento'}</h3>
                <button onclick="App.closeModal()" style="background:none;border:none;font-size:26px;cursor:pointer;color:#64748b;padding:0;">&times;</button>
            </div>
            <form onsubmit="event.preventDefault(); App.saveTransaction('${tx ? tx.id : ''}');">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div class="form-group">
                        <label class="form-label">Tipo de Movimento</label>
                        <select id="txType" class="input-field">
                            <option value="expense" ${tx && tx.type === 'expense' ? 'selected' : ''}>Despesa (Saída)</option>
                            <option value="income" ${tx && tx.type === 'income' ? 'selected' : ''}>Receita (Entrada)</option>
                            <option value="investment" ${tx && tx.type === 'investment' ? 'selected' : ''}>Investimento / Aporte 📈</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Data</label>
                        <input type="date" id="txDate" class="input-field" value="${tx ? tx.date : today}" required>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Categoria</label>
                    <select id="txCategory" class="input-field">${categoriesOptions}</select>
                </div>
                <div class="form-group">
                    <label class="form-label">Descrição</label>
                    <input type="text" id="txDesc" class="input-field" placeholder="Ex: Supermercado / Salário" value="${tx ? tx.description : ''}">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div class="form-group">
                        <label class="form-label">Responsável</label>
                        <input type="text" id="txAssigned" class="input-field" value="${tx ? tx.assignedTo : 'Casal'}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">País de Origem</label>
                        <select id="txCountry" class="input-field">
                            <option value="ES" ${tx && tx.country === 'ES' ? 'selected' : ''}>🇪🇸 Espanha</option>
                            <option value="BR" ${tx && tx.country === 'BR' ? 'selected' : ''}>🇧🇷 Brasil</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Valor</label>
                    <input type="number" step="0.01" id="txAmount" class="input-field" placeholder="0.00" value="${tx ? tx.amount : ''}" style="font-size:18px;font-weight:bold;color:var(--navy);" required>
                </div>
                <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:24px">
                    <button type="button" class="btn-primary" style="background:#94a3b8;padding:12px 20px;" onclick="App.closeModal()">Cancelar</button>
                    <button type="submit" class="btn-primary" style="padding:12px 24px;">${isEdit ? 'Salvar Alteração' : 'Adicionar Registro'}</button>
                </div>
            </form>
        `;
        overlay.style.display = 'flex';
    };

    const closeModal = () => {
        const overlay = el('modalOverlay');
        if (overlay) overlay.style.display = 'none';
    };

    const saveTransaction = (id) => {
        const type = el('txType').value;
        const date = el('txDate').value;
        const categoryId = el('txCategory').value;
        const description = el('txDesc').value.trim();
        const assignedTo = el('txAssigned').value.trim() || 'Casal';
        const country = el('txCountry').value;
        const amount = parseFloat(el('txAmount').value) || 0;

        if (id) {
            const index = state.transactions.findIndex(t => t.id === id);
            if (index !== -1) {
                state.transactions[index] = { id, date, type, categoryId, description, assignedTo, country, amount };
            }
        } else {
            state.transactions.push({ id: generateId(), date, type, categoryId, description, assignedTo, country, amount });
        }

        saveState();
        closeModal();
        
        const activePage = document.querySelector('.page.active')?.id;
        if (activePage === 'dashboard' || !activePage) el('dashboard').innerHTML = renderDashboard();
        else if (activePage === 'transactions') el('transactionsTable').innerHTML = renderTransactionsTable();
        
        showToast('Lançamento salvo com sucesso!');
        syncToDrive();
    };

    const deleteTransaction = (id) => {
        if (confirm('Deseja realmente excluir este lançamento?')) {
            state.transactions = state.transactions.filter(t => t.id !== id);
            saveState();
            
            const activePage = document.querySelector('.page.active')?.id;
            if (activePage === 'dashboard' || !activePage) el('dashboard').innerHTML = renderDashboard();
            else if (activePage === 'transactions') el('transactionsTable').innerHTML = renderTransactionsTable();
            
            showToast('Lançamento removido.');
            syncToDrive();
        }
    };

    const init = () => {
        initState();
        if (!isSetup()) renderSetup();
        else if (!isLoggedIn()) renderLogin();
        else {
            renderApp();
            syncFromDrive(true);
        }
    };

    return {
        init, doSetup, doLogin, logout, nav, togglePrivacy,
        changeSelectedMonth, updateReportView, exportToExcel,
        checkConnection, saveSettings, syncFromDrive, syncToDrive,
        showTransactionModal, closeModal, saveTransaction, deleteTransaction, resetAllData
    };
})();

document.addEventListener('DOMContentLoaded', App.init);
