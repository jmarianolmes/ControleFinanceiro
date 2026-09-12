// ============================================================
// FinFam - Controle Financeiro Familiar
// Arquivo: js/app.js (VERSÃO UNIFICADA E COMPLETA)
// ============================================================

const App = (() => {
    const STORAGE_KEY = 'finfam_data_v2';
    const SESSION_KEY = 'finfam_session';
    const DEFAULT_TOKEN = 'FinFam_SecureToken_2026_@Key';
    const INACTIVITY_TIMEOUT = 15 * 60 * 1000;

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
    const el = id => document.getElementById(id);

    // ==================== UTILITÁRIOS ====================
    const parseDateToYMD = (val) => {
        if (!val) return '';
        const s = String(val).trim();
        const brMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (brMatch) return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`;
        const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
        const jsDateMatch = s.match(/([A-Za-z]{3})\s+([A-Za-z]{3})\s+(\d{2})\s+(\d{4})/);
        if (jsDateMatch) {
            const monthMap = { 'Jan':'01','Feb':'02','Mar':'03','Apr':'04','May':'05','Jun':'06','Jul':'07','Aug':'08','Sep':'09','Oct':'10','Nov':'11','Dec':'12' };
            const m = monthMap[jsDateMatch[2]] || '01';
            return `${jsDateMatch[4]}-${m}-${jsDateMatch[3].padStart(2, '0')}`;
        }
        try {
            const dt = new Date(s);
            if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
        } catch (e) {}
        return s.slice(0, 10);
    };

    const getYearMonth = (val) => {
        const ymd = parseDateToYMD(val);
        return ymd ? ymd.slice(0, 7) : '';
    };

    const fmtDate = d => {
        if (!d) return '-';
        const ymd = parseDateToYMD(d);
        if (ymd && ymd.length >= 10) {
            const parts = ymd.split('-');
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
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
                const data = new TextEncoder().encode(value);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
            }
        } catch (e) {}
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) { 
            hash ^= value.charCodeAt(i); 
            hash = Math.imul(hash, 16777619); 
        }
        return (hash >>> 0).toString(16);
    };

    const showToast = (msg, type = 'success') => {
        const t = el('toast');
        if (!t) return;
        t.textContent = String(msg);
        t.className = `toast ${type} show`;
        setTimeout(() => { t.classList.remove('show'); }, 3500);
    };

    const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    const now = () => new Date().toISOString();

    const resetInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        if (isLoggedIn()) {
            inactivityTimer = setTimeout(() => {
                showToast('🕐 Sessão encerrada por inatividade.', 'error');
                logout();
            }, INACTIVITY_TIMEOUT);
        }
    };

    // ==================== OVERLAY DE CONEXÃO ====================
    let _connTimer = null;
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
            p = Math.min(90, p + 10);
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
        setTimeout(() => { const ov = el('connOverlay'); if (ov) ov.remove(); }, 350);
    };

    // ==================== CATEGORIAS (19 originais) ====================
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

    const getDisplayCategories = () => {
        const seen = new Map();
        (state.categories || []).forEach(c => {
            const cleanName = c.name.replace(/\s*\((espanha|es|brasil|br)\)\s*/gi, '').replace(/\s*-\s*(espanha|es|brasil|br)\s*$/gi, '').trim();
            if (!seen.has(cleanName)) seen.set(cleanName, { id: c.id, name: cleanName, icon: c.icon, type: c.type });
        });
        return Array.from(seen.values());
    };

    const getCategoryDisplay = (categoryId) => {
        const c = state.categories.find(x => x.id === categoryId);
        if (!c) return { name: 'Geral', icon: '📋' };
        const cleanName = c.name.replace(/\s*\((espanha|es|brasil|br)\)\s*/gi, '').replace(/\s*-\s*(espanha|es|brasil|br)\s*$/gi, '').trim();
        return { name: cleanName, icon: c.icon };
    };

    const getInvestmentCategory = () => state.categories.find(c => c.type === 'investment' || /investiment/i.test(c.name)) || state.categories[0];

        const getResponsibleOptions = (selected) => {
        const names = new Set(['Casal / Ambos']);
        (state.users || []).forEach(u => { if (u && u.name) names.add(u.name); });
        if (selected && selected !== 'Casal' && selected !== 'Casal / Ambos') names.add(selected);
        return Array.from(names).map(n => `<option value="${n}" ${selected === n ? 'selected' : ''}>${n}</option>`).join('');
    };


    // ==================== GOOGLE DRIVE ====================
    const syncToDrive = async () => {
        const url = state.settings.googleScriptUrl;
        if (!url) {
            showToast('⚠️ URL do Google Drive não configurada.', 'error');
            return;
        }
        try {
            showToast('🔄 Enviando dados para o Drive...', 'info');
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ 
                    action: 'sync', 
                    token: state.settings.apiToken || DEFAULT_TOKEN, 
                    transactions: state.transactions 
                })
            });
            const data = await res.json();
            if (data.status === 'success') {
                showToast(`✅ ${state.transactions.length} registros salvos no Google Drive!`);
            } else {
                showToast(data.message || '❌ Erro ao salvar no Drive.', 'error');
            }
        } catch (e) {
            showToast('❌ Erro ao comunicar com o Google Drive.', 'error');
            console.error('Sync error:', e);
        }
    };

    const syncFromDrive = async (silent = false) => {
        const url = state.settings.googleScriptUrl;
        if (!url) {
            if (!silent) showToast('⚠️ URL do Google Drive não configurada.', 'error');
            return;
        }
        
        try {
            if (!silent) showToast('🔄 Sincronizando com o Drive...', 'info');
            
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ 
                    action: 'fetch', 
                    token: state.settings.apiToken || DEFAULT_TOKEN 
                })
            });
            
            const data = await res.json();
            if (data.status === 'success' && Array.isArray(data.transactions)) {
                const normalized = data.transactions.map(t => {
                    const rawDate = t.date || t.Data || '';
                    return {
                        id: t.id || t.ID || generateId(),
                        date: parseDateToYMD(rawDate) || new Date().toISOString().slice(0, 10),
                        type: t.type || t.Tipo || 'expense',
                        categoryId: t.categoryId || t.CategoriaID || 'cat_outros_es',
                        description: t.description || t.Descrição || '',
                        assignedTo: t.assignedTo || t.Responsável || 'Casal / Ambos',
                        country: t.country || t.País || 'ES',
                        amount: Number(t.amount || t.Valor) || 0
                    };
                });
                
                const seenIds = new Set(normalized.map(t => t.id));
                const localOnly = state.transactions.filter(t => !seenIds.has(t.id));
                state.transactions = [...normalized, ...localOnly];
                saveState();
                refreshAllViews();
                
                const monthPicker = el('dashMonthPicker');
                if (monthPicker) monthPicker.value = state.selectedMonth;
                
                if (!silent) showToast(`✅ ${state.transactions.length} registros sincronizados!`);
                if (localOnly.length > 0) syncToDrive();
            } else {
                if (!silent) showToast(data.message || '❌ Erro ao consultar o Drive.', 'error');
            }
        } catch (e) {
            if (!silent) showToast('❌ Erro ao consultar o Drive.', 'error');
            console.error('❌ Sync error:', e);
        }
    };

    const syncFromDriveForce = async () => {
        if (!confirm('⚠️ Isso vai SUBSTITUIR TODOS os dados locais pelos dados do Drive. Continuar?')) return;
        await syncFromDrive(false);
    };

    const checkConnection = async () => {
        const dot = el('connStatusDot');
        const text = el('connStatusText');
        const url = state.settings.googleScriptUrl;
        if (!dot || !text) return;
        if (!url) {
            dot.style.backgroundColor = '#ef4444';
            text.textContent = '❌ URL não configurada';
            return;
        }
        text.textContent = '🔄 Verificando...';
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
                text.textContent = '✅ Conectado com Sucesso';
                showToast('✅ Conexão com Google Drive estabelecida!', 'success');
            } else {
                dot.style.backgroundColor = '#ef4444';
                text.textContent = '❌ Erro de Autenticação';
                showToast('❌ Falha na autenticação.', 'error');
            }
        } catch (e) {
            dot.style.backgroundColor = '#ef4444';
            text.textContent = '❌ Falha na Conexão';
            showToast('❌ Não foi possível conectar.', 'error');
        }
    };

    // ==================== GESTÃO DE ESTADO ====================
    const initState = () => {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                state = parsed;
                state.categories = [...defaultCategories];
                if (!state.selectedMonth) state.selectedMonth = new Date().toISOString().slice(0, 7);
                if (!state.settings) {
                    state.settings = { 
                        currencyBR: 'R$', 
                        currencyES: '€', 
                        monthStartDay: 1, 
                        googleScriptUrl: '', 
                        apiToken: DEFAULT_TOKEN
                    };
                }
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
        saveState();
    };

    const saveState = () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    };

    const refreshAllViews = () => {
        const activePage = document.querySelector('.page.active')?.id || 'dashboard';
        if (activePage === 'dashboard' || !activePage) {
            const dash = el('dashboard'); if (dash) dash.innerHTML = renderDashboard();
        }
        if (activePage === 'transactions') {
            const txTable = el('transactionsTable'); if (txTable) txTable.innerHTML = renderTransactionsTable();
        }
        if (activePage === 'reports') {
            const r = el('reports'); if (r) r.innerHTML = renderMonthlyReport();
        }
        const monthPicker = el('dashMonthPicker');
        if (monthPicker) monthPicker.value = state.selectedMonth;
    };

    // ==================== AUTENTICAÇÃO ====================
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

    const isSetup = () => state.users && state.users.length > 0;
    
    const isLoggedIn = () => {
        const s = getSession();
        if (!s) return false;
        state.currentUser = state.users.find(u => u.id === s.userId);
        return !!state.currentUser;
    };

    const togglePrivacy = () => {
        state.privacyMode = !state.privacyMode;
        saveState();
        refreshAllViews();
    };

        // ==================== FILTROS E CÁLCULOS ====================
    const getSelectedMonthData = () => {
        const ym = state.selectedMonth || new Date().toISOString().slice(0, 7);
        const txs = state.transactions.filter(t => t && t.date && getYearMonth(t.date) === ym)
            .sort((a, b) => new Date(parseDateToYMD(b.date)) - new Date(parseDateToYMD(a.date)));

        const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const investment = txs.filter(t => t.type === 'investment').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const balance = income - expense - investment;

        // Patrimônio Total Acumulado (todos os investimentos da história)
        const totalInvestments = state.transactions
            .filter(t => t.type === 'investment')
            .reduce((s, t) => s + (Number(t.amount) || 0), 0);

        const totalIncomeAll = state.transactions
            .filter(t => t.type === 'income')
            .reduce((s, t) => s + (Number(t.amount) || 0), 0);

        const totalExpenseAll = state.transactions
            .filter(t => t.type === 'expense')
            .reduce((s, t) => s + (Number(t.amount) || 0), 0);

        const netWorth = totalInvestments + (totalIncomeAll - totalExpenseAll - totalInvestments);

        return { ym, txs, income, expense, investment, balance, netWorth };
    };

    const changeSelectedMonth = (m) => {
        state.selectedMonth = m;
        saveState();
        refreshAllViews();
    };

    const refreshAllViews = () => {
        const activeNav = document.querySelector('.sidebar .nav-item.active');
        const pageId = activeNav ? activeNav.getAttribute('data-page') : 'dashboard';

        const d = el('dashboard'); if (d) d.innerHTML = renderDashboard();
        const t = el('transactions'); if (t) t.innerHTML = renderTransactions();
        const r = el('reports'); if (r) r.innerHTML = renderMonthlyReport();
        const s = el('settings'); if (s) s.innerHTML = renderSettings();

        // Reativar página atual
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const activePage = el(pageId);
        if (activePage) activePage.classList.add('active');

        // Renderizar gráfico se estiver no dashboard
        if (pageId === 'dashboard') {
            setTimeout(renderChart, 50);
        }
    };

    // ==================== TELAS E RENDERIZAÇÃO ====================
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
        const name = el('setupName').value.trim();
        const email = el('setupEmail').value.trim().toLowerCase();
        const pwd = el('setupPassword').value;
        const url = el('setupScriptUrl').value.trim();

        if (!name || !email || !pwd) {
            alert('Preencha todos os campos obrigatórios.');
            return;
        }

        const pwdHash = await hashPwd(pwd);
        const adminUser = {
            id: 'user_' + Date.now(),
            name,
            email,
            passwordHash: pwdHash,
            role: 'admin',
            createdAt: new Date().toISOString()
        };

        state.users = [adminUser];
        if (url) state.settings.googleScriptUrl = url;
        saveState();

        setSession(adminUser.id);
        state.currentUser = adminUser;
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
                            <input type="email" id="loginEmail" class="input-field" placeholder="seu@email.com" required autocomplete="username">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Senha</label>
                            <input type="password" id="loginPassword" class="input-field" placeholder="Sua senha" required autocomplete="current-password">
                        </div>
                        <button type="submit" class="btn-primary" style="width:100%;margin-top:8px">Entrar</button>
                    </form>
                </div>
            </div>`;
    };

    const doLogin = async (e) => {
        e.preventDefault();
        const email = el('loginEmail').value.trim().toLowerCase();
        const pwd = el('loginPassword').value;

        const user = state.users.find(u => u.email.toLowerCase() === email);
        if (!user) {
            showToast('E-mail ou senha incorretos.', 'error');
            return;
        }

        const pwdHash = await hashPwd(pwd);
        if (user.passwordHash !== pwdHash) {
            showToast('E-mail ou senha incorretos.', 'error');
            return;
        }

        setSession(user.id);
        state.currentUser = user;
        renderApp();
        resetInactivityTimer();

        showConnectionOverlay();
        syncFromDrive(true).finally(() => hideConnectionOverlay());
    };

    const logout = () => {
        localStorage.removeItem(SESSION_KEY);
        state.currentUser = null;
        if (inactivityTimer) clearTimeout(inactivityTimer);
        renderLogin();
    };

    const nav = (btn) => {
        document.querySelectorAll('.sidebar .nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const pageId = btn.getAttribute('data-page');

        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const target = el(pageId);
        if (target) {
            target.classList.add('active');
            if (pageId === 'dashboard') {
                setTimeout(renderChart, 50);
            }
        }
    };

    // ==================== DASHBOARD ====================
    const renderDashboard = () => {
        const m = getSelectedMonthData();
        const recentTxs = m.txs.slice(0, 5);

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
                    <div class="stat-value ${m.balance >= 0 ? 'emerald-text' : 'danger-text'}">
                        ${fmtMoney(m.balance, state.settings.currencyES)}
                    </div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">Receitas</div>
                    <div class="stat-value emerald-text">
                        ${fmtMoney(m.income, state.settings.currencyES)}
                    </div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">Despesas</div>
                    <div class="stat-value danger-text">
                        ${fmtMoney(m.expense, state.settings.currencyES)}
                    </div>
                </div>
                <div class="card stat-card" style="border-left:4px solid #8b5cf6">
                    <div class="stat-label">Investimentos / Aportes</div>
                    <div class="stat-value" style="color:#8b5cf6">
                        ${fmtMoney(m.investment, state.settings.currencyES)}
                    </div>
                </div>
                <div class="card stat-card net-worth-card" style="grid-column: span 1;">
                    <div class="stat-label">🏦 Patrimônio Total</div>
                    <div class="net-worth-value">
                        ${fmtMoney(m.netWorth, state.settings.currencyES)}
                    </div>
                    <div style="font-size:11px; color: var(--text-light); margin-top:4px;">
                        Investimentos Acumulados: ${fmtMoney(state.transactions.filter(t => t.type === 'investment').reduce((s, t) => s + (Number(t.amount) || 0), 0), state.settings.currencyES)}
                    </div>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:2fr 1fr;gap:24px;margin-bottom:24px">
                <div class="card" style="padding:24px">
                    <h3 style="color:var(--navy);margin-top:0">Fluxo Mensal (Receitas vs Despesas)</h3>
                    <canvas id="monthlyChart" height="240"></canvas>
                </div>
                <div class="card" style="padding:24px">
                    <h3 style="color:var(--navy);margin-top:0">Ações Rápidas</h3>
                    <div style="display:flex;flex-direction:column;gap:12px;margin-top:16px">
                        <button class="btn-primary" onclick="App.showTransactionModal(null)">+ Registrar Despesa/Receita</button>
                        <button class="btn-secondary" onclick="App.syncFromDriveForce()">🔄 Sincronizar Google Drive</button>
                    </div>
                </div>
            </div>

            <div class="card" style="padding:24px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h3 style="color:var(--navy);margin:0">Últimos Lançamentos do Mês</h3>
                    <button class="btn-secondary" onclick="document.querySelector('.sidebar .nav-item[data-page=\\'transactions\\']').click()">Ver Todos</button>
                </div>
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Data</th>
                                <th>Descrição</th>
                                <th>Categoria</th>
                                <th>Responsável</th>
                                <th>País</th>
                                <th>Tipo</th>
                                <th style="text-align:right">Valor</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${recentTxs.length === 0 ? `
                                <tr><td colspan="7" style="text-align:center;color:var(--text-light);padding:24px">Nenhum lançamento registrado neste mês.</td></tr>
                            ` : recentTxs.map(t => {
                                const cat = getCategoryDisplay(t.categoryId);
                                const cur = t.country === 'BR' ? state.settings.currencyBR : state.settings.currencyES;
                                const isExp = t.type === 'expense';
                                const isInc = t.type === 'income';
                                const typeBadge = isExp ? '<span class="badge badge-danger">Despesa</span>' :
                                                  isInc ? '<span class="badge badge-success">Receita</span>' :
                                                  '<span class="badge badge-purple">Investimento</span>';
                                return `
                                    <tr>
                                        <td>${fmtDate(t.date)}</td>
                                        <td><strong>${t.description}</strong></td>
                                        <td>${cat.icon} ${cat.name}</td>
                                        <td>${t.assignedTo || 'Casal'}</td>
                                        <td>${t.country === 'BR' ? '🇧🇷 BR' : '🇪🇸 ES'}</td>
                                        <td>${typeBadge}</td>
                                        <td style="text-align:right;font-weight:600;color:${isExp ? 'var(--danger)' : isInc ? 'var(--emerald)' : 'var(--purple)'}">
                                            ${isExp ? '-' : isInc ? '+' : ''}${fmtMoney(t.amount, cur)}
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    };

    let chartInstance = null;
    const renderChart = () => {
        const canvas = el('monthlyChart');
        if (!canvas) return;
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }

        const m = getSelectedMonthData();
        const ctx = canvas.getContext('2d');
        chartInstance = new Chart(ctx, {
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
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (v) => fmtMoney(v, state.settings.currencyES)
                        }
                    }
                }
            }
        });
    };

    // ==================== LANÇAMENTOS ====================
    const renderTransactions = () => {
        const ym = state.selectedMonth || new Date().toISOString().slice(0, 7);
        const txs = state.transactions.filter(t => t && t.date && getYearMonth(t.date) === ym)
            .sort((a, b) => new Date(parseDateToYMD(b.date)) - new Date(parseDateToYMD(a.date)));

        return `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:16px">
                <div>
                    <h1 style="color:var(--navy);margin:0 0 4px;font-size:24px">Lançamentos</h1>
                    <p style="color:var(--text-light);margin:0;font-size:14px">Histórico completo de transações registradas</p>
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
                                <th>Data</th>
                                <th>Descrição</th>
                                <th>Categoria</th>
                                <th>Responsável</th>
                                <th>País</th>
                                <th>Tipo</th>
                                <th style="text-align:right">Valor</th>
                                <th style="text-align:center">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${txs.length === 0 ? `
                                <tr><td colspan="8" style="text-align:center;color:var(--text-light);padding:32px">Nenhum lançamento encontrado para este mês.</td></tr>
                            ` : txs.map(t => {
                                const cat = getCategoryDisplay(t.categoryId);
                                const cur = t.country === 'BR' ? state.settings.currencyBR : state.settings.currencyES;
                                const isExp = t.type === 'expense';
                                const isInc = t.type === 'income';
                                const typeBadge = isExp ? '<span class="badge badge-danger">Despesa</span>' :
                                                  isInc ? '<span class="badge badge-success">Receita</span>' :
                                                  '<span class="badge badge-purple">Investimento</span>';
                                return `
                                    <tr>
                                        <td>${fmtDate(t.date)}</td>
                                        <td><strong>${t.description}</strong></td>
                                        <td>${cat.icon} ${cat.name}</td>
                                        <td>${t.assignedTo || 'Casal'}</td>
                                        <td>${t.country === 'BR' ? '🇧🇷 BR' : '🇪🇸 ES'}</td>
                                        <td>${typeBadge}</td>
                                        <td style="text-align:right;font-weight:600;color:${isExp ? 'var(--danger)' : isInc ? 'var(--emerald)' : 'var(--purple)'}">
                                            ${isExp ? '-' : isInc ? '+' : ''}${fmtMoney(t.amount, cur)}
                                        </td>
                                        <td style="text-align:center">
                                            <button onclick="App.showTransactionModal('${t.id}')" style="background:none;border:none;cursor:pointer;font-size:16px" title="Editar">✏️</button>
                                            <button onclick="App.deleteTransaction('${t.id}')" style="background:none;border:none;cursor:pointer;font-size:16px" title="Excluir">🗑️</button>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    };

    // ==================== RELATÓRIO MENSAL ====================
    const changeReportMonth = (m) => {
        state.selectedMonth = m;
        saveState();
        refreshAllViews();
    };

    const renderMonthlyReport = () => {
        const selMonth = state.selectedMonth || new Date().toISOString().slice(0, 7);
        const txs = state.transactions.filter(t => t && t.date && getYearMonth(t.date) === selMonth)
            .sort((a, b) => new Date(parseDateToYMD(b.date)) - new Date(parseDateToYMD(a.date)));

        const expES = txs.filter(t => t.country === 'ES' && t.type === 'expense');
        const incES = txs.filter(t => t.country === 'ES' && t.type === 'income');
        const invES = txs.filter(t => t.country === 'ES' && t.type === 'investment');

        const expBR = txs.filter(t => t.country === 'BR' && t.type === 'expense');
        const incBR = txs.filter(t => t.country === 'BR' && t.type === 'income');
        const invBR = txs.filter(t => t.country === 'BR' && t.type === 'investment');

        const totalExpES = expES.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
        const totalIncES = incES.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
        const totalInvES = invES.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

        const totalExpBR = expBR.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
        const totalIncBR = incBR.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
        const totalInvBR = invBR.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

        const renderTableSection = (title, items, total, cur, badgeClass, prefix) => `
            <div class="card" style="padding: 24px; margin-bottom: 24px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h3 style="color: var(--navy); margin: 0;">${title} (${fmtMoney(total, cur)})</h3>
                    <span class="badge ${badgeClass}">${items.length} lançamentos</span>
                </div>
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Data</th>
                                <th>Descrição</th>
                                <th>Categoria</th>
                                <th>Responsável</th>
                                <th style="text-align: right;">Valor</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.length === 0 ? `
                                <tr><td colspan="5" style="text-align:center;color:var(--text-light);padding:16px;">Nenhum registro encontrado no mês.</td></tr>
                            ` : items.map(t => {
                                const cat = getCategoryDisplay(t.categoryId);
                                return `
                                    <tr>
                                        <td>${fmtDate(t.date)}</td>
                                        <td><strong>${t.description}</strong></td>
                                        <td>${cat.icon} ${cat.name}</td>
                                        <td>${t.assignedTo || 'Casal'}</td>
                                        <td style="text-align: right; font-weight: 600;">${prefix}${fmtMoney(t.amount, cur)}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        return `
            <div id="reportContainer">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
                    <div>
                        <h2 style="color: var(--navy); margin: 0 0 4px 0;">Relatório Mensal</h2>
                        <p style="color: var(--text-light); margin: 0; font-size: 14px;">Detalhamento financeiro consolidado (${txs.length} lançamentos no mês)</p>
                    </div>
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <input type="month" id="reportMonthPicker" class="input-field" value="${selMonth}" onchange="App.changeReportMonth(this.value)" style="width: auto;">
                        <button class="btn-secondary" onclick="App.exportToPDF()">📄 PDF</button>
                        <button class="btn-secondary" onclick="App.exportToCSV()">📊 CSV (Excel)</button>
                    </div>
                </div>

                <div style="margin-bottom: 28px;">
                    <h2 style="color: var(--navy); border-bottom: 2px solid var(--border); padding-bottom: 8px; margin-bottom: 16px;">🇪🇸 Espanha</h2>
                    ${renderTableSection('Despesas em Espanha', expES, totalExpES, state.settings.currencyES, 'badge-danger', '-')}
                    ${renderTableSection('Receitas em Espanha', incES, totalIncES, state.settings.currencyES, 'badge-success', '+')}
                    ${renderTableSection('Investimentos em Espanha', invES, totalInvES, state.settings.currencyES, 'badge-purple', '')}
                </div>

                <div>
                    <h2 style="color: var(--navy); border-bottom: 2px solid var(--border); padding-bottom: 8px; margin-bottom: 16px;">🇧🇷 Brasil</h2>
                    ${renderTableSection('Despesas no Brasil', expBR, totalExpBR, state.settings.currencyBR, 'badge-danger', '-')}
                    ${renderTableSection('Receitas no Brasil', incBR, totalIncBR, state.settings.currencyBR, 'badge-success', '+')}
                    ${renderTableSection('Investimentos no Brasil', invBR, totalInvBR, state.settings.currencyBR, 'badge-purple', '')}
                </div>
            </div>
        `;
    };

    // ==================== EXPORTAÇÕES (PDF E CSV) ====================
    const exportToPDF = () => {
        const container = el('reportContainer');
        if (!container) {
            showToast('Erro ao exportar PDF: relatório não renderizado.', 'error');
            return;
        }

        const clone = container.cloneNode(true);
        // Ocultar controles na impressão
        const controls = clone.querySelector('#reportMonthPicker')?.parentElement;
        if (controls) controls.style.display = 'none';

        clone.id = 'pdfTempExportContainer';
        clone.style.width = '100%';
        clone.style.maxWidth = '1000px';
        clone.style.background = '#ffffff';
        clone.style.padding = '20px';
        clone.style.position = 'absolute';
        clone.style.left = '0';
        clone.style.top = '0';
        clone.style.zIndex = '999999';

        document.body.appendChild(clone);
        showToast('📄 Gerando PDF...', 'info');

        const opt = {
            margin: 10,
            filename: `FinFam_Relatorio_${state.selectedMonth || 'mensal'}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, logging: false },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        html2pdf().set(opt).from(clone).save().then(() => {
            document.body.removeChild(clone);
            showToast('✅ PDF gerado com sucesso!', 'success');
        }).catch(err => {
            console.error('Erro ao gerar PDF:', err);
            if (document.body.contains(clone)) document.body.removeChild(clone);
            showToast('Erro ao exportar PDF.', 'error');
        });
    };

    const exportToCSV = () => {
        const ym = state.selectedMonth || new Date().toISOString().slice(0, 7);
        const txs = state.transactions.filter(t => t && t.date && getYearMonth(t.date) === ym)
            .sort((a, b) => new Date(parseDateToYMD(b.date)) - new Date(parseDateToYMD(a.date)));

        if (txs.length === 0) {
            showToast('Nenhum dado para exportar neste mês.', 'info');
            return;
        }

        const expES = txs.filter(t => t.country === 'ES' && t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const incES = txs.filter(t => t.country === 'ES' && t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const invES = txs.filter(t => t.country === 'ES' && t.type === 'investment').reduce((s, t) => s + (Number(t.amount) || 0), 0);

        const expBR = txs.filter(t => t.country === 'BR' && t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const incBR = txs.filter(t => t.country === 'BR' && t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const invBR = txs.filter(t => t.country === 'BR' && t.type === 'investment').reduce((s, t) => s + (Number(t.amount) || 0), 0);

        let csv = 'sep=;\r\n';
        csv += `RELATÓRIO MENSAL FINFAM;Mês: ${ym};Data da Exportação: ${new Date().toLocaleDateString('pt-BR')}\r\n\r\n`;

        csv += 'RESUMO CONSOLIDADO\r\n';
        csv += `Espanha (EUR);Receitas: ${incES.toFixed(2).replace('.', ',')};Despesas: ${expES.toFixed(2).replace('.', ',')};Investimentos: ${invES.toFixed(2).replace('.', ',')};Saldo: ${(incES - expES - invES).toFixed(2).replace('.', ',')}\r\n`;
        csv += `Brasil (BRL);Receitas: ${incBR.toFixed(2).replace('.', ',')};Despesas: ${expBR.toFixed(2).replace('.', ',')};Investimentos: ${invBR.toFixed(2).replace('.', ',')};Saldo: ${(incBR - expBR - invBR).toFixed(2).replace('.', ',')}\r\n\r\n`;

        csv += 'DETALHAMENTO DE LANÇAMENTOS\r\n';
        csv += 'Data;Descrição;Categoria;Responsável;País;Tipo;Valor Formatado;Valor Numérico;Moeda\r\n';

        txs.forEach(t => {
            const cat = getCategoryDisplay(t.categoryId);
            const cur = t.country === 'BR' ? 'BRL' : 'EUR';
            const typeStr = t.type === 'expense' ? 'Despesa' : t.type === 'income' ? 'Receita' : 'Investimento';
            const numVal = (Number(t.amount) || 0).toFixed(2).replace('.', ',');
            const sign = t.type === 'expense' ? '-' : t.type === 'income' ? '+' : '';
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
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast('📊 Arquivo Excel/CSV gerado com sucesso!', 'success');
    };

    // ==================== CONFIGURAÇÕES ====================
    const renderSettings = () => {
        const isAdmin = state.currentUser?.role === 'admin';
        return `
            <div style="max-width:800px">
                <h1 style="color:var(--navy);margin:0 0 4px;font-size:24px">Configurações</h1>
                <p style="color:var(--text-light);margin:0 0 24px;font-size:14px">Gerencie integrações, moedas e acessos</p>

                <div class="card" style="padding:24px;margin-bottom:24px">
                    <h3 style="color:var(--navy);margin-top:0">Banco de Dados (Google Drive / Apps Script)</h3>
                    <div class="form-group">
                        <label class="form-label">URL da Web App (Google Apps Script)</label>
                        <input type="url" id="cfgScriptUrl" class="input-field" value="${state.settings.googleScriptUrl || ''}" placeholder="https://script.google.com/macros/s/...">
                    </div>
                    <div style="display:flex;gap:12px;margin-top:16px;flex-wrap:wrap">
                        <button class="btn-primary" onclick="App.saveSettings()">Salvar Configurações</button>
                        <button class="btn-secondary" onclick="App.checkConnection()">Testar Conexão</button>
                        <button class="btn-secondary" onclick="App.syncFromDriveForce()">Forçar Leitura do Drive</button>
                    </div>
                </div>

                <div class="card" style="padding:24px;margin-bottom:24px">
                    <h3 style="color:var(--navy);margin-top:0">Usuários do Sistema</h3>
                    <div class="table-container" style="margin-bottom:16px">
                        <table class="data-table">
                            <thead>
                                <tr><th>Nome</th><th>E-mail</th><th>Função</th><th>Ações</th></tr>
                            </thead>
                            <tbody>
                                ${(state.users || []).map(u => `
                                    <tr>
                                        <td><strong>${u.name}</strong></td>
                                        <td>${u.email}</td>
                                        <td><span class="badge ${u.role === 'admin' ? 'badge-warning' : 'badge-info'}">${u.role || 'user'}</span></td>
                                        <td>
                                            ${u.id !== state.currentUser?.id && isAdmin ? `<button onclick="App.deleteUser('${u.id}')" style="background:none;border:none;cursor:pointer;color:var(--danger)">Excluir</button>` : '-'}
                                        </td>
                                    </tr>
                                `).join('')}
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
                        </div>
                    ` : ''}
                </div>

                ${isAdmin ? `
                    <div class="card" style="padding:24px;border:1px solid #fecaca;background:#fff5f5">
                        <h3 style="color:var(--danger);margin-top:0">Zona de Perigo</h3>
                        <p style="font-size:13px;color:var(--text-light)">Ações destrutivas sobre a base local e remota</p>
                        <div style="display:flex;gap:12px;flex-wrap:wrap">
                            <button class="btn-secondary" onclick="App.cleanGhostData()">🧹 Limpar Lançamentos Fantasmas</button>
                            <button class="btn-danger" onclick="App.resetDriveData()">🗑️ Limpar Banco no Google Drive</button>
                            <button class="btn-danger" onclick="App.resetAllData()">⚠️ Redefinir Tudo (Reset Fábrica)</button>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    };

    const saveSettings = () => {
        const url = el('cfgScriptUrl')?.value.trim() || '';
        state.settings.googleScriptUrl = url;
        saveState();
        showToast('Configurações salvas com sucesso!', 'success');
    };

    const checkConnection = async () => {
        const url = state.settings.googleScriptUrl;
        if (!url) {
            showToast('Informe a URL do Apps Script primeiro.', 'error');
            return;
        }
        showToast('Testando conexão com o Google Drive...', 'info');
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'ping', token: state.settings.apiToken })
            });
            const data = await res.json();
            if (data.status === 'ok') {
                showToast('✅ Conexão com o Google Drive ativa e funcionando!', 'success');
            } else {
                showToast(`⚠️ Resposta do Drive: ${data.message || 'Erro desconhecido'}`, 'warning');
            }
        } catch (e) {
            showToast('❌ Falha ao conectar ao Google Drive.', 'error');
        }
    };

    const addUser = async () => {
        const name = el('newUserName')?.value.trim();
        const email = el('newUserEmail')?.value.trim().toLowerCase();
        const pwd = el('newUserPassword')?.value;

        if (!name || !email || !pwd) {
            showToast('Preencha todos os campos do usuário.', 'error');
            return;
        }

        if (state.users.some(u => u.email.toLowerCase() === email)) {
            showToast('Este e-mail já está cadastrado.', 'error');
            return;
        }

        const pwdHash = await hashPwd(pwd);
        const newUser = {
            id: 'user_' + Date.now(),
            name,
            email,
            passwordHash: pwdHash,
            role: 'user',
            createdAt: new Date().toISOString()
        };

        state.users.push(newUser);
        saveState();
        syncToDrive();
        refreshAllViews();
        showToast(`Usuário ${name} adicionado com sucesso!`, 'success');
    };

    const deleteUser = (userId) => {
        if (!confirm('Deseja realmente remover este usuário?')) return;
        state.users = state.users.filter(u => u.id !== userId);
        saveState();
        syncToDrive();
        refreshAllViews();
        showToast('Usuário removido.', 'info');
    };

    const cleanGhostData = () => {
        if (!confirm('Deseja limpar lançamentos sem data ou inválidos?')) return;
        const initialCount = state.transactions.length;
        state.transactions = state.transactions.filter(t => t && t.date && t.description && t.amount);
        saveState();
        syncToDrive();
        refreshAllViews();
        showToast(`Limpeza concluída! ${initialCount - state.transactions.length} registros inválidos removidos.`, 'success');
    };

    const resetDriveData = async () => {
        if (!confirm('ATENÇÃO: Deseja apagar todas as transações da planilha no Google Drive e reenviar a base local atual?')) return;
        await syncToDrive();
        showToast('Banco no Drive atualizado com a base local atual.', 'success');
    };

    const resetAllData = () => {
        if (!confirm('ATENÇÃO: Isso apagará TODOS os dados locais, usuários e configurações. Tem certeza?')) return;
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(SESSION_KEY);
        location.reload();
    };

    // ==================== MODAL DE LANÇAMENTO ====================
    const showTransactionModal = (txId) => {
        const tx = txId ? state.transactions.find(t => t.id === txId) : null;
        const isInvestment = tx ? tx.type === 'investment' : false;

        // Se for investimento, seleciona automaticamente a categoria fixa de investimento
        const invCat = getInvestmentCategory();
        const activeCategories = state.categories.filter(c => !c.type || c.type === 'expense');

        const overlay = el('modalOverlay');
        const content = el('modalContent');
        if (!overlay || !content) return;

        const defaultDate = tx ? parseDateToYMD(tx.date) : new Date().toISOString().slice(0, 10);

        content.innerHTML = `
            <div class="modal-header">
                <div class="modal-title">${tx ? 'Editar Lançamento' : 'Novo Lançamento'}</div>
                <button class="close-btn" onclick="App.closeModal()">&times;</button>
            </div>
            <form onsubmit="App.saveTransaction(event, '${tx ? tx.id : ''}')">
                <div class="form-group">
                    <label class="form-label">Tipo de Lançamento</label>
                    <select id="txType" class="input-field" onchange="App.onTxTypeChange(this.value)">
                        <option value="expense" ${tx && tx.type === 'expense' ? 'selected' : ''}>Despesa</option>
                        <option value="income" ${tx && tx.type === 'income' ? 'selected' : ''}>Receita</option>
                        <option value="investment" ${isInvestment ? 'selected' : ''}>Investimento / Aporte</option>
                    </select>
                </div>

                <div class="form-group">
                    <label class="form-label">Data</label>
                    <input type="date" id="txDate" class="input-field" value="${defaultDate}" required>
                </div>

                <div class="form-group">
                    <label class="form-label">Descrição</label>
                    <input type="text" id="txDescription" class="input-field" value="${tx ? tx.description : ''}" placeholder="Ex: Mercado, Salário, etc." required>
                </div>

                <div class="form-group" id="categoryGroup" style="${isInvestment ? 'display:none;' : ''}">
                    <label class="form-label">Categoria</label>
                    <select id="txCategory" class="input-field">
                        ${state.categories.map(c => {
                            const cat = getCategoryDisplay(c.id);
                            const isSelected = tx && tx.categoryId === c.id;
                            return `<option value="${c.id}" ${isSelected ? 'selected' : ''}>${cat.icon} ${cat.name}</option>`;
                        }).join('')}
                    </select>
                </div>

                <div class="form-group">
                    <label class="form-label">Responsável</label>
                    <select id="txAssignedTo" class="input-field">
                        ${getResponsibleOptions(tx ? tx.assignedTo : 'Casal / Ambos')}
                    </select>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div class="form-group">
                        <label class="form-label">País / Moeda</label>
                        <select id="txCountry" class="input-field">
                            <option value="ES" ${!tx || tx.country === 'ES' ? 'selected' : ''}>🇪🇸 Espanha (€)</option>
                            <option value="BR" ${tx && tx.country === 'BR' ? 'selected' : ''}>🇧🇷 Brasil (R$)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Valor</label>
                        <input type="number" step="0.01" id="txAmount" class="input-field" value="${tx ? tx.amount : ''}" placeholder="0,00" required>
                    </div>
                </div>

                <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:20px">
                    <button type="button" class="btn-secondary" onclick="App.closeModal()">Cancelar</button>
                    <button type="submit" class="btn-primary">Salvar</button>
                </div>
            </form>
        `;

        overlay.style.display = 'flex';
        overlay.classList.add('active');
    };

    const closeModal = () => {
        const overlay = el('modalOverlay');
        if (overlay) {
            overlay.style.display = 'none';
            overlay.classList.remove('active');
        }
    };

    const onTxTypeChange = (type) => {
        const catGroup = el('categoryGroup');
        if (!catGroup) return;
        if (type === 'investment') {
            catGroup.style.display = 'none';
        } else {
            catGroup.style.display = 'block';
        }
    };

    const saveTransaction = (e, txId) => {
        e.preventDefault();
        const type = el('txType').value;
        const date = el('txDate').value;
        const description = el('txDescription').value.trim();
        const country = el('txCountry').value;
        const amount = parseFloat(el('txAmount').value);
        const assignedTo = el('txAssignedTo').value;

        let categoryId;
        if (type === 'investment') {
            const invCat = getInvestmentCategory();
            categoryId = invCat.id;
        } else {
            categoryId = el('txCategory').value;
        }

        if (!date || !description || isNaN(amount) || amount <= 0) {
            showToast('Por favor, informe data, descrição e um valor positivo válido.', 'error');
            return;
        }

        const cleanYMD = parseDateToYMD(date);

        if (txId) {
            // Edição
            const idx = state.transactions.findIndex(t => t.id === txId);
            if (idx !== -1) {
                state.transactions[idx] = {
                    ...state.transactions[idx],
                    type,
                    date: cleanYMD,
                    description,
                    categoryId,
                    country,
                    amount,
                    assignedTo,
                    updatedAt: new Date().toISOString()
                };
            }
        } else {
            // Novo
            const newTx = {
                id: 'tx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                type,
                date: cleanYMD,
                description,
                categoryId,
                country,
                amount,
                assignedTo,
                createdAt: new Date().toISOString()
            };
            state.transactions.unshift(newTx);
        }

        saveState();
        closeModal();
        refreshAllViews();
        syncToDrive();
        showToast(txId ? 'Lançamento atualizado!' : 'Lançamento registrado com sucesso!', 'success');
    };

    const deleteTransaction = (txId) => {
        if (!confirm('Deseja excluir este lançamento?')) return;
        state.transactions = state.transactions.filter(t => t.id !== txId);
        saveState();
        refreshAllViews();
        syncToDrive();
        showToast('Lançamento removido com sucesso.', 'info');
    };

    // ==================== APLICAÇÃO PRINCIPAL ====================
    const renderApp = () => {
        el('app').innerHTML = `
            <div class="sidebar">
                <div class="logo">
                    <h2 style="margin:0;font-size:20px;display:flex;align-items:center;gap:8px">
                        <span>💰</span> FinFam
                    </h2>
                </div>
                <div style="flex:1;padding:12px 0">
                    <button class="nav-item active" data-page="dashboard" onclick="App.nav(this)"><span>📊</span> Dashboard</button>
                    <button class="nav-item" data-page="transactions" onclick="App.nav(this)"><span>💳</span> Lançamentos</button>
                    <button class="nav-item" data-page="reports" onclick="App.nav(this)"><span>📈</span> Relatórios</button>
                    <button class="nav-item" data-page="settings" onclick="App.nav(this)"><span>⚙️</span> Configurações</button>
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
                <div id="reports" class="page">${renderMonthlyReport()}</div>
                <div id="settings" class="page">${renderSettings()}</div>
            </div>
            <div id="modalOverlay" class="modal-overlay" style="display:none;">
                <div id="modalContent" class="modal"></div>
            </div>
            <div id="toast" class="toast"></div>`;

        setTimeout(renderChart, 50);
    };

    // ==================== INIT ====================
    const init = () => {
        initState();
        if (!isSetup()) renderSetup();
        else if (!isLoggedIn()) renderLogin();
        else {
            renderApp();
            showConnectionOverlay();
            syncFromDrive(true).finally(() => hideConnectionOverlay());
        }
    };

    // EXPORTAR API PÚBLICA
    return {
        init, doSetup, doLogin, logout, nav, togglePrivacy,
        changeSelectedMonth, checkConnection, saveSettings,
        syncFromDrive, syncFromDriveForce, syncToDrive,
        resetAllData, cleanGhostData, resetDriveData,
        showTransactionModal, closeModal, saveTransaction, deleteTransaction, onTxTypeChange,
        changeReportMonth, exportToPDF, exportToCSV,
        addUser, deleteUser
    };
})();

document.addEventListener('DOMContentLoaded', App.init);

