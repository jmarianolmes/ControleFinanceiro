// ============================================================
// FinFam — Controle Financeiro Familiar
// Arquivo: js/app.js
// Versão: 3.0 (corrigida, alinhada ao contrato da API)
// ============================================================

const App = (() => {
    // ==================== CONSTANTES ====================
    const STORAGE_KEY   = 'finfam_data_v2';
    const SESSION_KEY   = 'finfam_session';
    const DEFAULT_TOKEN = 'FinFam_SecureToken_2026_@Key';
    const INACTIVITY_MS = 15 * 60 * 1000;

    let state = {
        users: [],
        transactions: [],
        categories: [],
        settings: {
            currencyBR: 'R$',
            currencyES: '€',
            monthStartDay: 1,
            googleScriptUrl: '',
            apiToken: DEFAULT_TOKEN
        },
        currentUser: null,
        sessionExpiry: null,
        privacyMode: false,
        selectedMonth: new Date().toISOString().slice(0, 7)
    };

    let inactivityTimer = null;
    let chartInstance   = null;
    let _connTimer      = null;

    const el = (id) => document.getElementById(id);

    // ==================== CATEGORIAS PADRÃO ====================
    const defaultCategories = [
        { id: 'cat_salario_es',        name: 'Salário / Emprego',              type: 'income',     country: 'ES', icon: '💼' },
        { id: 'cat_freelance_es',      name: 'Trabalho Freelance / Extras',    type: 'income',     country: 'ES', icon: '💻' },
        { id: 'cat_outras_entradas_es',name: 'Outras Receitas',                type: 'income',     country: 'ES', icon: '💶' },
        { id: 'cat_rendimentos',       name: 'Rendimentos & Dividendos',       type: 'income',     country: 'ES', icon: '💰' },
        { id: 'cat_aluguel_br_inc',    name: 'Receita Aluguel',                type: 'income',     country: 'BR', icon: '🏠' },
        { id: 'cat_invest',            name: 'Investimentos',                  type: 'investment', country: 'ES', icon: '📈' },
        { id: 'cat_aluguel_es',        name: 'Aluguel de Moradia',             type: 'expense',    country: 'ES', icon: '🔑' },
        { id: 'cat_hipoteca_es',       name: 'Hipoteca / Financiamento',       type: 'expense',    country: 'ES', icon: '🏛️' },
        { id: 'cat_mercado',           name: 'Mercado / Alimentação',          type: 'expense',    country: 'ES', icon: '🛒' },
        { id: 'cat_agua',              name: 'Água',                           type: 'expense',    country: 'ES', icon: '💧' },
        { id: 'cat_luz',               name: 'Energia / Luz',                  type: 'expense',    country: 'ES', icon: '⚡' },
        { id: 'cat_gas',               name: 'Gás',                            type: 'expense',    country: 'ES', icon: '🔥' },
        { id: 'cat_escola',            name: 'Escola / Crianças',              type: 'expense',    country: 'ES', icon: '🎒' },
        { id: 'cat_veiculo',           name: 'Veículo / Transporte',           type: 'expense',    country: 'ES', icon: '🚗' },
        { id: 'cat_lazer',             name: 'Lazer & Família',                type: 'expense',    country: 'ES', icon: '🎬' },
        { id: 'cat_outros_es',         name: 'Outras Despesas',                type: 'expense',    country: 'ES', icon: '📋' },
        { id: 'cat_cc_br',             name: 'Cartão de Crédito',              type: 'expense',    country: 'BR', icon: '💳' },
        { id: 'cat_outros_br',         name: 'Compromissos Diversos',          type: 'expense',    country: 'BR', icon: '🇧🇷' }
    ];

    // ==================== UTILITÁRIOS ====================
    const parseDateToYMD = (val) => {
        if (!val) return '';
        const s = String(val).trim();

        const brMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (brMatch) return `${brMatch[3]}-${brMatch[2].padStart(2,'0')}-${brMatch[1].padStart(2,'0')}`;

        const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

        const jsDate = s.match(/([A-Za-z]{3})\s+([A-Za-z]{3})\s+(\d{2})\s+(\d{4})/);
        if (jsDate) {
            const M = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
            return `${jsDate[4]}-${M[jsDate[2]]||'01'}-${jsDate[3].padStart(2,'0')}`;
        }

        try {
            const d = new Date(s);
            if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
        } catch(e) {}
        return s.slice(0,10);
    };

    const getYearMonth = (val) => {
        const ymd = parseDateToYMD(val);
        return ymd ? ymd.slice(0,7) : '';
    };

    const fmtDate = (d) => {
        if (!d) return '-';
        const ymd = parseDateToYMD(d);
        if (ymd && ymd.length >= 10) {
            const [y,m,dd] = ymd.split('-');
            return `${dd}/${m}/${y}`;
        }
        return String(d);
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
                const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
                return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
            }
        } catch(e) {}
        let h = 2166136261;
        for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
        return (h >>> 0).toString(16);
    };

    const generateId = () => Date.now().toString(36) + Math.random().toString(36).slice(2,11);

    const showToast = (msg, type = 'success') => {
        const t = el('toast');
        if (!t) return;
        t.textContent = String(msg);
        t.className = `toast ${type} show`;
        clearTimeout(t._timeout);
        t._timeout = setTimeout(() => t.classList.remove('show'), 3500);
    };

    const getCategoryDisplay = (categoryId) => {
        const c = state.categories.find(x => x.id === categoryId);
        if (!c) return { name: 'Geral', icon: '📋' };
        const clean = c.name
            .replace(/\s*\((espanha|es|brasil|br)\)\s*/gi, '')
            .replace(/\s*-\s*(espanha|es|brasil|br)\s*$/gi, '')
            .trim();
        return { name: clean, icon: c.icon || '📋' };
    };

    const getInvestmentCategory = () =>
        state.categories.find(c => c.id === 'cat_invest') ||
        state.categories.find(c => c.type === 'investment') ||
        state.categories[0];

    const getResponsibleOptions = (selected) => {
        const names = new Set(['Casal / Ambos']);
        (state.users || []).forEach(u => { if (u?.name) names.add(u.name); });
        if (selected && selected !== 'Casal' && selected !== 'Casal / Ambos') names.add(selected);
        return Array.from(names)
            .map(n => `<option value="${n}" ${selected === n ? 'selected' : ''}>${n}</option>`)
            .join('');
    };

    // ==================== SESSÃO ====================
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
        } catch(e) { return null; }
    };

    const setSession = (userId, hours = 12) => {
        const expires = new Date(Date.now() + hours * 3600000).toISOString();
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId, expires }));
        state.currentUser = state.users.find(u => u.id === userId) || null;
        state.sessionExpiry = expires;
        resetInactivityTimer();
    };

    const clearSession = () => {
        sessionStorage.removeItem(SESSION_KEY);
        state.currentUser = null;
        state.sessionExpiry = null;
    };

    const isSetup = () => state.users && state.users.length > 0;

    const isLoggedIn = () => {
        const s = getSession();
        if (!s) return false;
        state.currentUser = state.users.find(u => u.id === s.userId) || null;
        return !!state.currentUser;
    };

    const resetInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        if (isLoggedIn()) {
            inactivityTimer = setTimeout(() => {
                showToast('🕐 Sessão encerrada por inatividade.', 'error');
                logout();
            }, INACTIVITY_MS);
        }
    };

    // ==================== ESTADO ====================
    const initState = () => {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                state = { ...state, ...parsed };
                state.categories = [...defaultCategories];
                if (!state.selectedMonth) state.selectedMonth = new Date().toISOString().slice(0,7);
                if (!state.settings) {
                    state.settings = {
                        currencyBR: 'R$', currencyES: '€', monthStartDay: 1,
                        googleScriptUrl: '', apiToken: DEFAULT_TOKEN
                    };
                }
                if (!state.settings.apiToken) state.settings.apiToken = DEFAULT_TOKEN;
            } catch(e) { resetState(); }
        } else {
            resetState();
        }
    };

    const resetState = () => {
        state = {
            users: [],
            transactions: [],
            categories: [...defaultCategories],
            settings: {
                currencyBR: 'R$', currencyES: '€', monthStartDay: 1,
                googleScriptUrl: '', apiToken: DEFAULT_TOKEN
            },
            currentUser: null,
            sessionExpiry: null,
            privacyMode: false,
            selectedMonth: new Date().toISOString().slice(0,7)
        };
        saveState();
    };

    const saveState = () => {
        const toSave = {
            users: state.users,
            transactions: state.transactions,
            settings: state.settings,
            privacyMode: state.privacyMode,
            selectedMonth: state.selectedMonth
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    };

    // ==================== OVERLAY DE CONEXÃO ====================
    const showConnectionOverlay = () => {
        if (el('connOverlay')) return;
        const ov = document.createElement('div');
        ov.id = 'connOverlay';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,.96);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;';
        ov.innerHTML = `
            <div style="font-size:38px;">💶</div>
            <div style="font-weight:700;font-size:16px;color:#1e3a5f;">Conectando com o banco de dados...</div>
            <div style="width:260px;height:10px;background:#e2e8f0;border-radius:6px;overflow:hidden;">
                <div id="connBar" style="width:15%;height:100%;background:#059669;border-radius:6px;transition:width .3s;"></div>
            </div>
            <div id="connPct" style="font-size:13px;color:#64748b;font-weight:600;">15%</div>
        `;
        document.body.appendChild(ov);

        let p = 15;
        _connTimer = setInterval(() => {
            p = Math.min(90, p + 8);
            const bar = el('connBar'), pct = el('connPct');
            if (bar) bar.style.width = p + '%';
            if (pct) pct.textContent = p + '%';
        }, 300);
    };

    const hideConnectionOverlay = () => {
        if (_connTimer) { clearInterval(_connTimer); _connTimer = null; }
        const bar = el('connBar'), pct = el('connPct');
        if (bar) bar.style.width = '100%';
        if (pct) pct.textContent = '100%';
        setTimeout(() => el('connOverlay')?.remove(), 350);
    };

    // ==================== GOOGLE DRIVE (contrato oficial) ====================
    const driveCall = async (payload) => {
        const url = state.settings.googleScriptUrl;
        if (!url) throw new Error('URL do Google Apps Script não configurada.');
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ ...payload, token: state.settings.apiToken || DEFAULT_TOKEN })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    };

    const checkConnection = async () => {
        const url = state.settings.googleScriptUrl;
        if (!url) { showToast('⚠️ URL do Apps Script não configurada.', 'error'); return; }
        showToast('🔄 Testando conexão...', 'info');
        try {
            const data = await driveCall({ action: 'ping' });
            if (data.status === 'ok' || data.status === 'success') {
                showToast('✅ Conexão com o Google Drive ativa!', 'success');
            } else {
                showToast(`⚠️ ${data.message || 'Resposta inesperada.'}`, 'warning');
            }
        } catch (e) {
            showToast('❌ Falha ao conectar ao Google Drive.', 'error');
        }
    };

    const syncToDrive = async () => {
        if (!state.settings.googleScriptUrl) {
            showToast('⚠️ URL do Google Drive não configurada.', 'error');
            return;
        }
        try {
            const data = await driveCall({
                action: 'sync',
                data: {
                    transactions: state.transactions,
                    users: state.users,
                    settings: state.settings,
                    lastSync: new Date().toISOString()
                }
            });
            if (data.status === 'ok' || data.status === 'success') {
                showToast(`✅ ${state.transactions.length} registros salvos no Drive!`);
            } else {
                showToast(data.message || '❌ Erro ao salvar no Drive.', 'error');
            }
        } catch (e) {
            console.error('syncToDrive:', e);
            showToast('❌ Erro ao comunicar com o Google Drive.', 'error');
        }
    };

    const normalizeTx = (t) => ({
        id:           t.id || t.ID || ('tx_' + generateId()),
        type:         t.type || t.Tipo || 'expense',
        date:         parseDateToYMD(t.date || t.Data) || new Date().toISOString().slice(0,10),
        description:  t.description || t['Descrição'] || '',
        categoryId:   t.categoryId || t.CategoriaID || 'cat_outros_es',
        country:      (t.country || t['País'] || 'ES').toString().toUpperCase().slice(0,2),
        amount:       Number(t.amount ?? t.Valor ?? 0) || 0,
        assignedTo:   t.assignedTo || t['Responsável'] || 'Casal / Ambos',
        createdAt:    t.createdAt || new Date().toISOString(),
        updatedAt:    t.updatedAt || t.createdAt || new Date().toISOString()
    });

    const mergeDriveData = (remote) => {
        const remoteTxs = (remote.transactions || []).map(normalizeTx);
        const remoteIds = new Set(remoteTxs.map(t => t.id));
        const localOnly = state.transactions.filter(t => !remoteIds.has(t.id));

        state.transactions = [...remoteTxs, ...localOnly];

        if (Array.isArray(remote.users) && remote.users.length > 0) {
            // Mescla por email
            const map = new Map(state.users.map(u => [u.email, u]));
            remote.users.forEach(u => { if (u?.email) map.set(u.email, u); });
            state.users = Array.from(map.values());
        }
        if (remote.settings && typeof remote.settings === 'object') {
            state.settings = { ...state.settings, ...remote.settings, apiToken: state.settings.apiToken };
        }
        return { localOnlyCount: localOnly.length, remoteCount: remoteTxs.length };
    };

    const syncFromDrive = async (silent = false) => {
        if (!state.settings.googleScriptUrl) {
            if (!silent) showToast('⚠️ URL do Google Drive não configurada.', 'error');
            return;
        }
        try {
            if (!silent) showToast('🔄 Sincronizando com o Drive...', 'info');
            const data = await driveCall({ action: 'fetch' });
            const payload = data.data || data;

            if ((data.status === 'ok' || data.status === 'success') && Array.isArray(payload.transactions)) {
                const { localOnlyCount } = mergeDriveData(payload);
                saveState();
                refreshAllViews();
                if (!silent) showToast(`✅ ${state.transactions.length} registros sincronizados!`);
                if (localOnlyCount > 0) syncToDrive();
            } else if (!silent) {
                showToast(data.message || '❌ Erro ao consultar o Drive.', 'error');
            }
        } catch (e) {
            console.error('syncFromDrive:', e);
            if (!silent) showToast('❌ Erro ao consultar o Drive.', 'error');
        }
    };

    const syncFromDriveForce = async () => {
        if (!confirm('⚠️ Isso vai SUBSTITUIR TODOS os dados locais pelos dados do Drive. Continuar?')) return;
        await syncFromDrive(false);
    };

    // ==================== FILTROS E CÁLCULOS ====================
    const getSelectedMonthData = () => {
        const ym = state.selectedMonth || new Date().toISOString().slice(0,7);
        const txs = state.transactions
            .filter(t => t && t.date && getYearMonth(t.date) === ym)
            .sort((a,b) => parseDateToYMD(b.date).localeCompare(parseDateToYMD(a.date)));

        const sum = (arr) => arr.reduce((s,t) => s + (Number(t.amount) || 0), 0);
        const income     = sum(txs.filter(t => t.type === 'income'));
        const expense    = sum(txs.filter(t => t.type === 'expense'));
        const investment = sum(txs.filter(t => t.type === 'investment'));
        const balance    = income - expense - investment;

        const totalInvestments = sum(state.transactions.filter(t => t.type === 'investment'));
        const totalIncomeAll   = sum(state.transactions.filter(t => t.type === 'income'));
        const totalExpenseAll  = sum(state.transactions.filter(t => t.type === 'expense'));
        const netWorth = totalInvestments + (totalIncomeAll - totalExpenseAll - totalInvestments);

        return { ym, txs, income, expense, investment, balance, netWorth, totalInvestments };
    };

    const changeSelectedMonth = (m) => {
        state.selectedMonth = m;
        saveState();
        refreshAllViews();
    };

    const changeReportMonth = (m) => {
        state.selectedMonth = m;
        saveState();
        refreshAllViews();
        navByPage('reports');
    };

    // ==================== NAVEGAÇÃO ====================
    const navByPage = (pageId) => {
        document.querySelectorAll('.sidebar .nav-item').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-page') === pageId);
        });
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const target = el(pageId);
        if (target) target.classList.add('active');
        if (pageId === 'dashboard') setTimeout(renderChart, 50);
    };

    const nav = (btn) => {
        const pageId = btn.getAttribute('data-page');
        navByPage(pageId);
    };

    // ==================== RENDERIZAÇÃO ====================
    const refreshAllViews = () => {
        const d = el('dashboard');    if (d) d.innerHTML = renderDashboard();
        const t = el('transactions'); if (t) t.innerHTML = renderTransactions();
        const r = el('reports');      if (r) r.innerHTML = renderMonthlyReport();
        const s = el('settings');     if (s) s.innerHTML = renderSettings();

        const active = document.querySelector('.sidebar .nav-item.active')?.getAttribute('data-page') || 'dashboard';
        navByPage(active);
    };

    // -------- SETUP / LOGIN --------
    const renderSetup = () => {
        el('app').innerHTML = `
            <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--bg)">
                <div class="card" style="width:100%;max-width:440px;padding:32px">
                    <div style="text-align:center;margin-bottom:28px">
                        <div style="font-size:36px;margin-bottom:8px">💰</div>
                        <h1 style="color:var(--navy);margin:0 0 6px;font-size:22px">FinFam</h1>
                        <p style="color:var(--text-light);margin:0;font-size:14px">Configuração Inicial do Administrador</p>
                    </div>
                    <form onsubmit="App.doSetup(event)">
                        <div class="form-group">
                            <label class="form-label">Nome Completo</label>
                            <input type="text" id="setupName" class="input-field" placeholder="Ex: João Silva" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">E-mail</label>
                            <input type="email" id="setupEmail" class="input-field" placeholder="seu@email.com" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Senha</label>
                            <input type="password" id="setupPassword" class="input-field" placeholder="Mínimo 6 caracteres" minlength="6" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">URL do Google Apps Script (opcional agora)</label>
                            <input type="url" id="setupScriptUrl" class="input-field" placeholder="https://script.google.com/macros/s/...">
                        </div>
                        <button type="submit" class="btn-primary" style="width:100%;margin-top:8px">Criar Administrador e Iniciar</button>
                    </form>
                </div>
            </div>`;
    };

    const doSetup = async (e) => {
        e.preventDefault();
        const name  = el('setupName').value.trim();
        const email = el('setupEmail').value.trim().toLowerCase();
        const pwd   = el('setupPassword').value;
        const url   = el('setupScriptUrl').value.trim();

        if (!name || !email || !pwd) { alert('Preencha todos os campos obrigatórios.'); return; }

        const admin = {
            id: 'user_' + Date.now(),
            name, email,
            passwordHash: await hashPwd(pwd),
            role: 'admin',
            createdAt: new Date().toISOString()
        };
        state.users = [admin];
        if (url) state.settings.googleScriptUrl = url;
        saveState();
        setSession(admin.id);
        renderApp();
        showToast('🎉 Sistema configurado com sucesso!', 'success');
    };

    const renderLogin = () => {
        el('app').innerHTML = `
            <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--bg)">
                <div class="card" style="width:100%;max-width:400px;padding:32px">
                    <div style="text-align:center;margin-bottom:28px">
                        <div style="font-size:36px;margin-bottom:8px">💰</div>
                        <h1 style="color:var(--navy);margin:0 0 6px;font-size:22px">FinFam</h1>
                        <p style="color:var(--text-light);margin:0;font-size:14px">Controle Financeiro Familiar</p>
                    </div>
                    <form onsubmit="App.doLogin(event)">
                        <div class="form-group">
                            <label class="form-label">E-mail</label>
                            <input type="email" id="loginEmail" class="input-field" required autocomplete="username">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Senha</label>
                            <input type="password" id="loginPassword" class="input-field" required autocomplete="current-password">
                        </div>
                        <button type="submit" class="btn-primary" style="width:100%;margin-top:8px">Entrar</button>
                    </form>
                </div>
            </div>`;
    };

    const doLogin = async (e) => {
        e.preventDefault();
        const email = el('loginEmail').value.trim().toLowerCase();
        const pwd   = el('loginPassword').value;

        const user = state.users.find(u => u.email.toLowerCase() === email);
        if (!user) { showToast('E-mail ou senha incorretos.', 'error'); return; }

        const pwdHash = await hashPwd(pwd);
        if (user.passwordHash !== pwdHash) { showToast('E-mail ou senha incorretos.', 'error'); return; }

        setSession(user.id);
        renderApp();
        showConnectionOverlay();
        syncFromDrive(true).finally(hideConnectionOverlay);
    };

    const logout = () => {
        clearSession();
        if (inactivityTimer) clearTimeout(inactivityTimer);
        renderLogin();
    };

    const togglePrivacy = () => {
        state.privacyMode = !state.privacyMode;
        saveState();
        refreshAllViews();
    };

    // -------- DASHBOARD --------
    const renderDashboard = () => {
        const m = getSelectedMonthData();
        const recent = m.txs.slice(0, 5);

        return `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:16px">
                <div>
                    <h1 style="color:var(--navy);margin:0 0 4px;font-size:24px">Visão Geral</h1>
                    <p style="color:var(--text-light);margin:0;font-size:14px">Resumo consolidado das finanças familiares</p>
                </div>
                <div style="display:flex;gap:12px;align-items:center">
                    <input type="month" class="input-field" value="${m.ym}" onchange="App.changeSelectedMonth(this.value)" style="width:auto">
                    <button class="btn-primary" onclick="App.showTransactionModal(null)">+ Novo Lançamento</button>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
                <div class="card stat-card">
                    <div class="stat-label">Saldo Livre</div>
                    <div class="stat-value ${m.balance >= 0 ? 'emerald-text' : 'danger-text'}">${fmtMoney(m.balance, state.settings.currencyES)}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">Receitas</div>
                    <div class="stat-value emerald-text">${fmtMoney(m.income, state.settings.currencyES)}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">Despesas</div>
                    <div class="stat-value danger-text">${fmtMoney(m.expense, state.settings.currencyES)}</div>
                </div>
                <div class="card stat-card" style="border-left:4px solid #8b5cf6">
                    <div class="stat-label">Investimentos / Aportes</div>
                    <div class="stat-value" style="color:#8b5cf6">${fmtMoney(m.investment, state.settings.currencyES)}</div>
                </div>
                <div class="card stat-card net-worth-card">
                    <div class="stat-label">🏦 Patrimônio Total</div>
                    <div class="net-worth-value">${fmtMoney(m.netWorth, state.settings.currencyES)}</div>
                    <div style="font-size:11px;color:var(--text-light);margin-top:4px">
                        Investimentos Acumulados: ${fmtMoney(m.totalInvestments, state.settings.currencyES)}
                    </div>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:2fr 1fr;gap:24px;margin-bottom:24px">
                <div class="card" style="padding:24px">
                    <h3 style="color:var(--navy);margin-top:0">Fluxo Mensal</h3>
                    <div style="height:240px"><canvas id="monthlyChart"></canvas></div>
                </div>
                <div class="card" style="padding:24px">
                    <h3 style="color:var(--navy);margin-top:0">Ações Rápidas</h3>
                    <div style="display:flex;flex-direction:column;gap:12px;margin-top:16px">
                        <button class="btn-primary" onclick="App.showTransactionModal(null)">+ Registrar Lançamento</button>
                        <button class="btn-secondary" onclick="App.syncFromDriveForce()">🔄 Sincronizar Drive</button>
                    </div>
                </div>
            </div>

            <div class="card" style="padding:24px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h3 style="color:var(--navy);margin:0">Últimos Lançamentos do Mês</h3>
                    <button class="btn-secondary" onclick="App.nav(document.querySelector('.nav-item[data-page=\\'transactions\\']'))">Ver Todos</button>
                </div>
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Data</th><th>Descrição</th><th>Categoria</th>
                                <th>Responsável</th><th>País</th><th>Tipo</th>
                                <th style="text-align:right">Valor</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${recent.length === 0
                                ? `<tr><td colspan="7" style="text-align:center;color:var(--text-light);padding:24px">Nenhum lançamento registrado neste mês.</td></tr>`
                                : recent.map(t => {
                                    const cat = getCategoryDisplay(t.categoryId);
                                    const cur = t.country === 'BR' ? state.settings.currencyBR : state.settings.currencyES;
                                    const isExp = t.type === 'expense';
                                    const isInc = t.type === 'income';
                                    const badge = isExp ? '<span class="badge badge-danger">Despesa</span>'
                                                : isInc ? '<span class="badge badge-success">Receita</span>'
                                                : '<span class="badge badge-purple">Investimento</span>';
                                    const color = isExp ? 'var(--danger)' : isInc ? 'var(--emerald)' : 'var(--purple)';
                                    const sign  = isExp ? '-' : isInc ? '+' : '';
                                    return `
                                        <tr>
                                            <td>${fmtDate(t.date)}</td>
                                            <td><strong>${t.description || '-'}</strong></td>
                                            <td>${cat.icon} ${cat.name}</td>
                                            <td>${t.assignedTo || 'Casal'}</td>
                                            <td>${t.country === 'BR' ? '🇧🇷 BR' : '🇪🇸 ES'}</td>
                                            <td>${badge}</td>
                                            <td style="text-align:right;font-weight:600;color:${color}">${sign}${fmtMoney(t.amount, cur)}</td>
                                        </tr>`;
                                }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;
    };

    const renderChart = () => {
        const canvas = el('monthlyChart');
        if (!canvas || typeof Chart === 'undefined') return;
        if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

        const m = getSelectedMonthData();
        chartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Receitas', 'Despesas', 'Investimentos'],
                datasets: [{
                    label: 'Valores no Mês',
                    data: [m.income, m.expense, m.investment],
                    backgroundColor: ['#059669', '#dc2626', '#8b5cf6'],
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { callback: v => fmtMoney(v, state.settings.currencyES) } } }
            }
        });
    };

    // -------- LANÇAMENTOS --------
    const renderTransactions = () => {
        const ym = state.selectedMonth || new Date().toISOString().slice(0,7);
        const txs = state.transactions
            .filter(t => t && t.date && getYearMonth(t.date) === ym)
            .sort((a,b) => parseDateToYMD(b.date).localeCompare(parseDateToYMD(a.date)));

        return `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:16px">
                <div>
                    <h1 style="color:var(--navy);margin:0 0 4px;font-size:24px">Lançamentos</h1>
                    <p style="color:var(--text-light);margin:0;font-size:14px">Histórico completo de transações</p>
                </div>
                <div style="display:flex;gap:12px;align-items:center">
                    <input type="month" class="input-field" value="${ym}" onchange="App.changeSelectedMonth(this.value)" style="width:auto">
                    <button class="btn-primary" onclick="App.showTransactionModal(null)">+ Novo Lançamento</button>
                </div>
            </div>
            <div class="card" style="padding:24px">
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Data</th><th>Descrição</th><th>Categoria</th>
                                <th>Responsável</th><th>País</th><th>Tipo</th>
                                <th style="text-align:right">Valor</th><th style="text-align:center">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${txs.length === 0
                                ? `<tr><td colspan="8" style="text-align:center;color:var(--text-light);padding:32px">Nenhum lançamento encontrado para este mês.</td></tr>`
                                : txs.map(t => {
                                    const cat = getCategoryDisplay(t.categoryId);
                                    const cur = t.country === 'BR' ? state.settings.currencyBR : state.settings.currencyES;
                                    const isExp = t.type === 'expense';
                                    const isInc = t.type === 'income';
                                    const badge = isExp ? '<span class="badge badge-danger">Despesa</span>'
                                                : isInc ? '<span class="badge badge-success">Receita</span>'
                                                : '<span class="badge badge-purple">Investimento</span>';
                                    const color = isExp ? 'var(--danger)' : isInc ? 'var(--emerald)' : 'var(--purple)';
                                    const sign  = isExp ? '-' : isInc ? '+' : '';
                                    return `
                                        <tr>
                                            <td>${fmtDate(t.date)}</td>
                                            <td><strong>${t.description || '-'}</strong></td>
                                            <td>${cat.icon} ${cat.name}</td>
                                            <td>${t.assignedTo || 'Casal'}</td>
                                            <td>${t.country === 'BR' ? '🇧🇷 BR' : '🇪🇸 ES'}</td>
                                            <td>${badge}</td>
                                            <td style="text-align:right;font-weight:600;color:${color}">${sign}${fmtMoney(t.amount, cur)}</td>
                                            <td style="text-align:center;white-space:nowrap">
                                                <button onclick="App.showTransactionModal('${t.id}')" style="background:none;border:none;cursor:pointer;font-size:16px" title="Editar">✏️</button>
                                                <button onclick="App.deleteTransaction('${t.id}')" style="background:none;border:none;cursor:pointer;font-size:16px" title="Excluir">🗑️</button>
                                            </td>
                                        </tr>`;
                                }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;
    };

    // -------- RELATÓRIO MENSAL --------
    const renderMonthlyReport = () => {
        const selMonth = state.selectedMonth || new Date().toISOString().slice(0,7);
        const txs = state.transactions
            .filter(t => t && t.date && getYearMonth(t.date) === selMonth)
            .sort((a,b) => parseDateToYMD(b.date).localeCompare(parseDateToYMD(a.date)));

        const filterBy = (country, type) => txs.filter(t => t.country === country && t.type === type);
        const sum = (arr) => arr.reduce((s,t) => s + (Number(t.amount) || 0), 0);

        const expES = filterBy('ES','expense'), incES = filterBy('ES','income'), invES = filterBy('ES','investment');
        const expBR = filterBy('BR','expense'), incBR = filterBy('BR','income'), invBR = filterBy('BR','investment');

        const section = (title, items, total, cur, badgeClass, prefix) => `
            <div class="card" style="padding:24px;margin-bottom:24px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h3 style="color:var(--navy);margin:0">${title} (${fmtMoney(total, cur)})</h3>
                    <span class="badge ${badgeClass}">${items.length} lançamentos</span>
                </div>
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Data</th><th>Descrição</th><th>Categoria</th>
                                <th>Responsável</th><th style="text-align:right">Valor</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.length === 0
                                ? `<tr><td colspan="5" style="text-align:center;color:var(--text-light);padding:16px">Nenhum registro encontrado no mês.</td></tr>`
                                : items.map(t => {
                                    const cat = getCategoryDisplay(t.categoryId);
                                    return `
                                        <tr>
                                            <td>${fmtDate(t.date)}</td>
                                            <td><strong>${t.description || '-'}</strong></td>
                                            <td>${cat.icon} ${cat.name}</td>
                                            <td>${t.assignedTo || 'Casal'}</td>
                                            <td style="text-align:right;font-weight:600">${prefix}${fmtMoney(t.amount, cur)}</td>
                                        </tr>`;
                                }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;

        return `
            <div id="reportContainer">
                <div class="no-print" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:16px">
                    <div>
                        <h2 style="color:var(--navy);margin:0 0 4px 0">Relatório Mensal</h2>
                        <p style="color:var(--text-light);margin:0;font-size:14px">Detalhamento financeiro consolidado (${txs.length} lançamentos no mês)</p>
                    </div>
                    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
                        <input type="month" id="reportMonthPicker" class="input-field" value="${selMonth}" onchange="App.changeReportMonth(this.value)" style="width:auto">
                        <button class="btn-secondary" onclick="App.exportToPDF()">📄 PDF</button>
                        <button class="btn-secondary" onclick="App.exportToCSV()">📊 CSV (Excel)</button>
                    </div>
                </div>

                <h2 style="color:var(--navy);border-bottom:2px solid var(--border);padding-bottom:8px;margin-bottom:16px">🇪🇸 Espanha</h2>
                ${section('Despesas em Espanha',   expES, sum(expES), state.settings.currencyES, 'badge-danger',  '-')}
                ${section('Receitas em Espanha',   incES, sum(incES), state.settings.currencyES, 'badge-success', '+')}
                ${section('Investimentos em Espanha', invES, sum(invES), state.settings.currencyES, 'badge-purple', '')}

                <h2 style="color:var(--navy);border-bottom:2px solid var(--border);padding-bottom:8px;margin:28px 0 16px">🇧🇷 Brasil</h2>
                ${section('Despesas no Brasil',   expBR, sum(expBR), state.settings.currencyBR, 'badge-danger',  '-')}
                ${section('Receitas no Brasil',   incBR, sum(incBR), state.settings.currencyBR, 'badge-success', '+')}
                ${section('Investimentos no Brasil', invBR, sum(invBR), state.settings.currencyBR, 'badge-purple', '')}
            </div>`;
    };

    // -------- EXPORTAÇÕES --------
    const exportToPDF = () => {
        const container = el('reportContainer');
        if (!container) { showToast('Relatório não renderizado.', 'error'); return; }

        const clone = container.cloneNode(true);
        clone.querySelectorAll('.no-print').forEach(n => n.remove());
        clone.id = 'pdfTempExportContainer';
        clone.style.cssText = 'position:absolute;left:-9999px;top:0;width:1000px;background:#fff;padding:20px;';

        document.body.appendChild(clone);
        showToast('📄 Gerando PDF...', 'info');

        const opt = {
            margin: 10,
            filename: `FinFam_Relatorio_${state.selectedMonth || 'mensal'}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: 1000 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        html2pdf().set(opt).from(clone).save()
            .then(() => {
                clone.remove();
                showToast('✅ PDF gerado com sucesso!', 'success');
            })
            .catch(err => {
                console.error('exportToPDF:', err);
                clone.remove();
                showToast('Erro ao exportar PDF.', 'error');
            });
    };

    const exportToCSV = () => {
        const ym = state.selectedMonth || new Date().toISOString().slice(0,7);
        const txs = state.transactions
            .filter(t => t && t.date && getYearMonth(t.date) === ym)
            .sort((a,b) => parseDateToYMD(b.date).localeCompare(parseDateToYMD(a.date)));

        if (txs.length === 0) { showToast('Nenhum dado para exportar neste mês.', 'info'); return; }

        const sum = (arr) => arr.reduce((s,t) => s + (Number(t.amount) || 0), 0);
        const f = (c,t) => sum(txs.filter(x => x.country === c && x.type === t));
        const fmt = (n) => n.toFixed(2).replace('.', ',');

        const expES = f('ES','expense'), incES = f('ES','income'), invES = f('ES','investment');
        const expBR = f('BR','expense'), incBR = f('BR','income'), invBR = f('BR','investment');

        let csv = 'sep=;\r\n';
        csv += `RELATÓRIO MENSAL FINFAM;Mês: ${ym};Data da Exportação: ${new Date().toLocaleDateString('pt-BR')}\r\n\r\n`;
        csv += 'RESUMO CONSOLIDADO\r\n';
        csv += `Espanha (EUR);Receitas: ${fmt(incES)};Despesas: ${fmt(expES)};Investimentos: ${fmt(invES)};Saldo: ${fmt(incES-expES-invES)}\r\n`;
        csv += `Brasil (BRL);Receitas: ${fmt(incBR)};Despesas: ${fmt(expBR)};Investimentos: ${fmt(invBR)};Saldo: ${fmt(incBR-expBR-invBR)}\r\n\r\n`;
        csv += 'DETALHAMENTO DE LANÇAMENTOS\r\n';
        csv += 'Data;Descrição;Categoria;Responsável;País;Tipo;Valor Formatado;Valor Numérico;Moeda\r\n';

        txs.forEach(t => {
            const cat = getCategoryDisplay(t.categoryId);
            const cur = t.country === 'BR' ? 'BRL' : 'EUR';
            const typeStr = t.type === 'expense' ? 'Despesa' : t.type === 'income' ? 'Receita' : 'Investimento';
            const numVal = (Number(t.amount) || 0).toFixed(2).replace('.', ',');
            const sign   = t.type === 'expense' ? '-' : t.type === 'income' ? '+' : '';
            const desc = (t.description || '').replace(/;/g, ',');
            const resp = (t.assignedTo || 'Casal').replace(/;/g, ',');
            csv += `${fmtDate(t.date)};${desc};${cat.name};${resp};${t.country || 'ES'};${typeStr};"${sign}${numVal}";${numVal};${cur}\r\n`;
        });

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `FinFam_${ym}_Relatorio.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('📊 Arquivo CSV gerado com sucesso!', 'success');
    };

    // -------- CONFIGURAÇÕES --------
    const renderSettings = () => {
        const isAdmin = state.currentUser?.role === 'admin';
        return `
            <div style="max-width:900px">
                <h1 style="color:var(--navy);margin:0 0 4px;font-size:24px">Configurações</h1>
                <p style="color:var(--text-light);margin:0 0 24px;font-size:14px">Gerencie integrações, moedas e acessos</p>

                <div class="card" style="padding:24px;margin-bottom:24px">
                    <h3 style="color:var(--navy);margin-top:0">Banco de Dados (Google Apps Script)</h3>
                    <div class="form-group">
                        <label class="form-label">URL da Web App</label>
                        <input type="url" id="cfgScriptUrl" class="input-field" value="${state.settings.googleScriptUrl || ''}" placeholder="https://script.google.com/macros/s/...">
                    </div>
                    <div style="display:flex;gap:12px;flex-wrap:wrap">
                        <button class="btn-primary" onclick="App.saveSettings()">Salvar</button>
                        <button class="btn-secondary" onclick="App.checkConnection()">Testar Conexão</button>
                        <button class="btn-secondary" onclick="App.syncToDrive()">📤 Enviar para o Drive</button>
                        <button class="btn-secondary" onclick="App.syncFromDriveForce()">📥 Forçar Leitura do Drive</button>
                    </div>
                </div>

                <div class="card" style="padding:24px;margin-bottom:24px">
                    <h3 style="color:var(--navy);margin-top:0">Usuários do Sistema</h3>
                    <div class="table-container" style="margin-bottom:16px">
                        <table class="data-table">
                            <thead><tr><th>Nome</th><th>E-mail</th><th>Função</th><th>Ações</th></tr></thead>
                            <tbody>
                                ${(state.users || []).map(u => `
                                    <tr>
                                        <td><strong>${u.name}</strong></td>
                                        <td>${u.email}</td>
                                        <td><span class="badge ${u.role === 'admin' ? 'badge-warning' : 'badge-info'}">${u.role || 'user'}</span></td>
                                        <td>
                                            ${u.id !== state.currentUser?.id && isAdmin
                                                ? `<button onclick="App.deleteUser('${u.id}')" style="background:none;border:none;cursor:pointer;color:var(--danger)">Excluir</button>`
                                                : '-'}
                                        </td>
                                    </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                    ${isAdmin ? `
                        <h4 style="margin:16px 0 8px;color:var(--navy)">Adicionar Novo Usuário</h4>
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
                            <input type="text" id="newUserName" class="input-field" placeholder="Nome">
                            <input type="email" id="newUserEmail" class="input-field" placeholder="E-mail">
                            <input type="password" id="newUserPassword" class="input-field" placeholder="Senha">
                            <button class="btn-primary" onclick="App.addUser()">Adicionar</button>
                        </div>` : ''}
                </div>

                ${isAdmin ? `
                    <div class="card" style="padding:24px;border:1px solid #fecaca;background:#fff5f5">
                        <h3 style="color:var(--danger);margin-top:0">Zona de Perigo</h3>
                        <p style="font-size:13px;color:var(--text-light)">Ações destrutivas sobre a base local e remota</p>
                        <div style="display:flex;gap:12px;flex-wrap:wrap">
                            <button class="btn-secondary" onclick="App.cleanGhostData()">🧹 Limpar Dados Inválidos</button>
                            <button class="btn-danger" onclick="App.resetDriveData()">🗑️ Limpar Banco no Drive</button>
                            <button class="btn-danger" onclick="App.resetAllData()">⚠️ Reset Fábrica</button>
                        </div>
                    </div>` : ''}
            </div>`;
    };

    const saveSettings = () => {
        const url = el('cfgScriptUrl')?.value.trim() || '';
        state.settings.googleScriptUrl = url;
        saveState();
        showToast('Configurações salvas!', 'success');
    };

    const addUser = async () => {
        const name  = el('newUserName')?.value.trim();
        const email = el('newUserEmail')?.value.trim().toLowerCase();
        const pwd   = el('newUserPassword')?.value;

        if (!name || !email || !pwd) { showToast('Preencha todos os campos.', 'error'); return; }
        if (state.users.some(u => u.email.toLowerCase() === email)) {
            showToast('E-mail já cadastrado.', 'error'); return;
        }

        state.users.push({
            id: 'user_' + Date.now(),
            name, email,
            passwordHash: await hashPwd(pwd),
            role: 'user',
            createdAt: new Date().toISOString()
        });
        saveState();
        syncToDrive();
        refreshAllViews();
        showToast(`Usuário ${name} adicionado!`, 'success');
    };

    const deleteUser = (userId) => {
        if (!confirm('Remover este usuário?')) return;
        state.users = state.users.filter(u => u.id !== userId);
        saveState();
        syncToDrive();
        refreshAllViews();
        showToast('Usuário removido.', 'info');
    };

    const cleanGhostData = () => {
        if (!confirm('Limpar lançamentos sem data, descrição ou valor?')) return;
        const before = state.transactions.length;
        state.transactions = state.transactions.filter(t => t && t.date && t.description && Number(t.amount) > 0);
        saveState();
        syncToDrive();
        refreshAllViews();
        showToast(`Limpeza concluída! ${before - state.transactions.length} registros removidos.`, 'success');
    };

    const resetDriveData = async () => {
        if (!confirm('Apagar TODAS as transações do Drive e reenviar a base local?')) return;
        await syncToDrive();
        showToast('Drive atualizado com a base local.', 'success');
    };

    const resetAllData = () => {
        if (!confirm('ATENÇÃO: apaga TODOS os dados locais, usuários e configurações. Continuar?')) return;
        localStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(SESSION_KEY);
        location.reload();
    };

    // -------- MODAL DE LANÇAMENTO --------
    const showTransactionModal = (txId) => {
        const tx = txId ? state.transactions.find(t => t.id === txId) : null;
        const isInvestment = tx ? tx.type === 'investment' : false;

        const overlay = el('modalOverlay');
        const content = el('modalContent');
        if (!overlay || !content) { showToast('Erro: modal não encontrado.', 'error'); return; }

        const defaultDate = tx ? parseDateToYMD(tx.date) : new Date().toISOString().slice(0,10);

        content.innerHTML = `
            <div class="modal-header">
                <div class="modal-title">${tx ? 'Editar Lançamento' : 'Novo Lançamento'}</div>
                <button class="close-btn" onclick="App.closeModal()" type="button">&times;</button>
            </div>
            <form onsubmit="App.saveTransaction(event, '${tx ? tx.id : ''}')">
                <div class="form-group">
                    <label class="form-label">Tipo</label>
                    <select id="txType" class="input-field" onchange="App.onTxTypeChange(this.value)">
                        <option value="expense"    ${tx?.type === 'expense'    ? 'selected' : ''}>Despesa</option>
                        <option value="income"     ${tx?.type === 'income'     ? 'selected' : ''}>Receita</option>
                        <option value="investment" ${isInvestment              ? 'selected' : ''}>Investimento / Aporte</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Data</label>
                    <input type="date" id="txDate" class="input-field" value="${defaultDate}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Descrição</label>
                    <input type="text" id="txDescription" class="input-field" value="${tx ? (tx.description || '') : ''}" placeholder="Ex: Mercado, Salário, etc." required>
                </div>
                <div class="form-group" id="categoryGroup" style="${isInvestment ? 'display:none;' : ''}">
                    <label class="form-label">Categoria</label>
                    <select id="txCategory" class="input-field">
                        ${state.categories.map(c => {
                            const cat = getCategoryDisplay(c.id);
                            return `<option value="${c.id}" ${tx?.categoryId === c.id ? 'selected' : ''}>${cat.icon} ${cat.name}</option>`;
                        }).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Responsável</label>
                    <select id="txAssignedTo" class="input-field">
                        ${getResponsibleOptions(tx?.assignedTo || 'Casal / Ambos')}
                    </select>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div class="form-group">
                        <label class="form-label">País / Moeda</label>
                        <select id="txCountry" class="input-field">
                            <option value="ES" ${!tx || tx.country === 'ES' ? 'selected' : ''}>🇪🇸 Espanha (€)</option>
                            <option value="BR" ${tx?.country === 'BR' ? 'selected' : ''}>🇧🇷 Brasil (R$)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Valor</label>
                        <input type="number" step="0.01" min="0.01" id="txAmount" class="input-field" value="${tx ? tx.amount : ''}" placeholder="0,00" required>
                    </div>
                </div>
                <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:20px">
                    <button type="button" class="btn-secondary" onclick="App.closeModal()">Cancelar</button>
                    <button type="submit" class="btn-primary">Salvar</button>
                </div>
            </form>`;

        overlay.classList.add('active');
    };

    const closeModal = () => {
        const overlay = el('modalOverlay');
        if (overlay) overlay.classList.remove('active');
    };

    const onTxTypeChange = (type) => {
        const catGroup = el('categoryGroup');
        if (!catGroup) return;
        catGroup.style.display = type === 'investment' ? 'none' : 'block';
    };

    const saveTransaction = (e, txId) => {
        e.preventDefault();
        const type        = el('txType').value;
        const date        = el('txDate').value;
        const description = el('txDescription').value.trim();
        const country     = el('txCountry').value;
        const amount      = parseFloat(el('txAmount').value);
        const assignedTo  = el('txAssignedTo').value;

        const categoryId = type === 'investment'
            ? getInvestmentCategory().id
            : el('txCategory').value;

        if (!date || !description || isNaN(amount) || amount <= 0) {
            showToast('Informe data, descrição e valor positivo válido.', 'error');
            return;
        }

        const cleanYMD = parseDateToYMD(date);

        if (txId) {
            const idx = state.transactions.findIndex(t => t.id === txId);
            if (idx !== -1) {
                state.transactions[idx] = {
                    ...state.transactions[idx],
                    type, date: cleanYMD, description, categoryId,
                    country, amount, assignedTo,
                    updatedAt: new Date().toISOString()
                };
            }
        } else {
            state.transactions.unshift({
                id: 'tx_' + generateId(),
                type, date: cleanYMD, description, categoryId,
                country, amount, assignedTo,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
        }

        saveState();
        closeModal();
        refreshAllViews();
        syncToDrive();
        showToast(txId ? 'Lançamento atualizado!' : 'Lançamento registrado!', 'success');
    };

    const deleteTransaction = (txId) => {
        if (!confirm('Excluir este lançamento?')) return;
        state.transactions = state.transactions.filter(t => t.id !== txId);
        saveState();
        refreshAllViews();
        syncToDrive();
        showToast('Lançamento removido.', 'info');
    };

    // ==================== APP PRINCIPAL ====================
    const renderApp = () => {
        el('app').innerHTML = `
            <div class="sidebar">
                <div class="logo">
                    <h2 style="margin:0;font-size:20px;display:flex;align-items:center;gap:8px">
                        <span>💰</span> FinFam
                    </h2>
                </div>
                <div style="flex:1;padding:12px 0">
                    <button class="nav-item active" data-page="dashboard"    onclick="App.nav(this)"><span>📊</span> Dashboard</button>
                    <button class="nav-item"        data-page="transactions" onclick="App.nav(this)"><span>💳</span> Lançamentos</button>
                    <button class="nav-item"        data-page="reports"      onclick="App.nav(this)"><span>📈</span> Relatórios</button>
                    <button class="nav-item"        data-page="settings"     onclick="App.nav(this)"><span>⚙️</span> Configurações</button>
                </div>
                <div style="padding:16px;border-top:1px solid rgba(255,255,255,.1)">
                    <div style="display:flex;align-items:center;gap:10px">
                        <div class="user-avatar">${state.currentUser?.name?.charAt(0).toUpperCase() || 'U'}</div>
                        <div style="flex:1;min-width:0">
                            <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${state.currentUser?.name || ''}</div>
                            <button onclick="App.togglePrivacy()" style="background:none;border:none;color:rgba(255,255,255,.8);cursor:pointer;font-size:12px;padding:0">
                                ${state.privacyMode ? '👁️ Mostrar' : '🙈 Ocultar'}
                            </button>
                        </div>
                        <button onclick="App.logout()" style="background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:18px" title="Sair">🚪</button>
                    </div>
                </div>
            </div>
            <div class="main-content">
                <div id="dashboard"    class="page active">${renderDashboard()}</div>
                <div id="transactions" class="page">${renderTransactions()}</div>
                <div id="reports"      class="page">${renderMonthlyReport()}</div>
                <div id="settings"     class="page">${renderSettings()}</div>
            </div>`;

        setTimeout(renderChart, 60);
        resetInactivityTimer();
    };

    // ==================== INIT ====================
    const init = () => {
        initState();

        // Eventos de atividade para resetar o timeout
        ['click','keydown','mousemove','touchstart'].forEach(evt =>
            document.addEventListener(evt, resetInactivityTimer, { passive: true })
        );

        if (!isSetup())        renderSetup();
        else if (!isLoggedIn()) renderLogin();
        else {
            renderApp();
            showConnectionOverlay();
            syncFromDrive(true).finally(hideConnectionOverlay);
        }
    };

    // ==================== API PÚBLICA ====================
    return {
        init, doSetup, doLogin, logout, nav, togglePrivacy,
        changeSelectedMonth, changeReportMonth,
        checkConnection, saveSettings,
        syncFromDrive, syncFromDriveForce, syncToDrive,
        resetAllData, cleanGhostData, resetDriveData,
        showTransactionModal, closeModal, saveTransaction, deleteTransaction, onTxTypeChange,
        exportToPDF, exportToCSV,
        addUser, deleteUser
    };
})();

document.addEventListener('DOMContentLoaded', App.init);
