// ============================================================
// FinFam - Controle Financeiro Familiar
// Arquivo: js/app.js (VERSÃO COMPLETA CORRIGIDA)
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
    const fmtDate = d => {
        if (!d) return '-';
        try {
            const dt = new Date(d);
            if (!isNaN(dt.getTime())) {
                return dt.toLocaleDateString('pt-BR');
            }
        } catch (e) {}
        const parts = String(d).split('-');
        if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
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

    // ==================== CATEGORIAS ====================
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

    // ============================================================
    // syncFromDrive - VERSÃO CORRIGIDA COM NORMALIZAÇÃO DE DATAS
    // ============================================================
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
                console.log('📥 Dados brutos do Drive:', data.transactions.length, 'registros');
                
                // NORMALIZAÇÃO COMPLETA DOS DADOS
                state.transactions = data.transactions.map(t => {
                    // Garante que todos os campos existam
                    const normalized = {
                        id: t.id || generateId(),
                        date: '',
                        type: t.type || 'expense',
                        categoryId: t.categoryId || 'cat_outros_es',
                        description: t.description || '',
                        assignedTo: t.assignedTo || 'Casal',
                        country: t.country || 'ES',
                        amount: Number(t.amount) || 0
                    };
                    
                    // ============================================================
                    // NORMALIZAÇÃO DE DATA - SUPORTA TODOS OS FORMATOS
                    // ============================================================
                    try {
                        if (t.date) {
                            let dateStr = String(t.date).trim();
                            
                            // CASO 1: "Mon Sep 07 2026 00:00:00 GM" (formato JavaScript)
                            const jsDateMatch = dateStr.match(/([A-Za-z]{3})\s+([A-Za-z]{3})\s+(\d{2})\s+(\d{4})/);
                            if (jsDateMatch) {
                                const monthMap = {
                                    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
                                    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
                                    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
                                };
                                const month = monthMap[jsDateMatch[2]] || '01';
                                const day = jsDateMatch[3].padStart(2, '0');
                                const year = jsDateMatch[4];
                                normalized.date = `${year}-${month}-${day}`;
                            }
                            // CASO 2: DD/MM/YYYY
                            else if (dateStr.includes('/')) {
                                const parts = dateStr.split('/');
                                if (parts.length === 3) {
                                    const day = parts[0].padStart(2, '0');
                                    const month = parts[1].padStart(2, '0');
                                    const year = parts[2];
                                    normalized.date = `${year}-${month}-${day}`;
                                }
                            }
                            // CASO 3: YYYY-MM-DD (já está correto)
                            else if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
                                normalized.date = dateStr.slice(0, 10);
                            }
                            // CASO 4: Tenta usar new Date() como fallback
                            else {
                                const d = new Date(dateStr);
                                if (!isNaN(d.getTime())) {
                                    normalized.date = d.toISOString().slice(0, 10);
                                } else {
                                    normalized.date = new Date().toISOString().slice(0, 10);
                                }
                            }
                        } else {
                            normalized.date = new Date().toISOString().slice(0, 10);
                        }
                    } catch (e) {
                        console.error('Erro ao normalizar data:', e);
                        normalized.date = new Date().toISOString().slice(0, 10);
                    }
                    
                    return normalized;
                });
                
                // REMOVE DUPLICATAS (se houver)
                const seenIds = new Set();
                state.transactions = state.transactions.filter(t => {
                    if (seenIds.has(t.id)) return false;
                    seenIds.add(t.id);
                    return true;
                });
                
                saveState();
                
                // FORÇA ATUALIZAÇÃO COMPLETA DA INTERFACE
                refreshAllViews();
                
                // ATUALIZA O SELETOR DE MÊS
                const monthPicker = el('dashMonthPicker');
                if (monthPicker) monthPicker.value = state.selectedMonth;
                
                console.log('📊 Dados normalizados:', state.transactions.length, 'registros');
                
                if (!silent) {
                    showToast(`✅ ${data.transactions.length} registros sincronizados do Drive!`);
                }
            } else {
                if (!silent) showToast(data.message || '❌ Erro ao consultar o Banco de Dados.', 'error');
            }
        } catch (e) {
            if (!silent) showToast('❌ Erro ao consultar o Banco de Dados.', 'error');
            console.error('Sync error:', e);
        }
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
                body: JSON.stringify({ 
                    action: 'ping', 
                    token: state.settings.apiToken || DEFAULT_TOKEN 
                })
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
                // Verifica se há dados fantasmas
                console.log('📦 Dados carregados do localStorage:', state.transactions.length, 'transações');
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
            const dash = el('dashboard');
            if (dash) dash.innerHTML = renderDashboard();
        }
        if (activePage === 'transactions') {
            const txTable = el('transactionsTable');
            if (txTable) txTable.innerHTML = renderTransactionsTable();
        }
        if (activePage === 'reports') {
            const reportContainer = el('reportContainer');
            if (reportContainer) {
                reportContainer.innerHTML = renderMonthlyReport();
            }
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

    const isSetup = () => state.users.length > 0;
    
    const isLoggedIn = () => {
        const s = getSession();
        if (!s) return false;
        state.currentUser = state.users.find(u => u.id === s.userId);
        return true;
    };

    const togglePrivacy = () => {
        state.privacyMode = !state.privacyMode;
        refreshAllViews();
    };

    // ==================== FILTROS ====================
    const getSelectedMonthData = () => {
        const ym = state.selectedMonth;
        
        const txs = state.transactions.filter(t => {
            if (!t || !t.date) return false;
            try {
                const d = new Date(t.date);
                if (!isNaN(d.getTime())) {
                    return d.toISOString().slice(0, 7) === ym;
                }
            } catch (e) {}
            return false;
        }).sort((a, b) => new Date(b.date) - new Date(a.date));

        const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const investment = txs.filter(t => t.type === 'investment').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        
        const balance = income - expense - investment;
        const savingsRate = income > 0 ? (((income - expense) / income) * 100) : 0;

        // PATRIMÔNIO TOTAL ACUMULADO
        const totalInvestments = state.transactions
            .filter(t => t.type === 'investment')
            .reduce((s, t) => s + (Number(t.amount) || 0), 0);
        
        const totalBalance = state.transactions
            .filter(t => t.type === 'income')
            .reduce((s, t) => s + (Number(t.amount) || 0), 0) -
            state.transactions.filter(t => t.type === 'expense')
            .reduce((s, t) => s + (Number(t.amount) || 0), 0);

        const netWorth = totalBalance + totalInvestments;

        return {
            income, expense, investment, balance, savingsRate,
            netWorth,
            txs
        };
    };

    const changeSelectedMonth = (ym) => {
        if (!ym) return;
        state.selectedMonth = ym;
        saveState();
        refreshAllViews();
    };

    // ==================== GERENCIAMENTO DE USUÁRIOS ====================
    const renderUserManagement = () => {
        const users = state.users || [];
        
        return `
        <div style="margin-top: 30px; border-top: 2px solid var(--border); padding-top: 20px;">
            <h4 style="color: var(--navy); margin-bottom: 16px;">👥 Gerenciar Usuários</h4>
            <p style="font-size:13px;color:var(--text-light);margin-bottom:16px;">
                Adicione outros membros da família para compartilhar o controle financeiro.
            </p>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                <input type="text" id="newUserName" class="input-field" placeholder="Nome do usuário" style="width: 100%;">
                <input type="email" id="newUserEmail" class="input-field" placeholder="Email" style="width: 100%;">
            </div>
            <div style="display: flex; gap: 12px; margin-bottom: 20px;">
                <input type="password" id="newUserPwd" class="input-field" placeholder="Senha (mínimo 6 caracteres)" style="flex: 1;">
                <button onclick="App.addUser()" class="btn-primary" style="white-space: nowrap;">➕ Adicionar</button>
            </div>
            
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Nome</th>
                            <th>Email</th>
                            <th>Função</th>
                            <th style="text-align: center;">Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${users.length === 0 ? `
                            <tr><td colspan="4" style="text-align: center; color: var(--text-light); padding: 30px;">
                                Nenhum usuário cadastrado.
                            </td></tr>
                        ` : users.map(u => `
                            <tr>
                                <td><strong>${u.name}</strong></td>
                                <td>${u.email}</td>
                                <td><span class="badge ${u.role === 'admin' ? 'badge-warning' : 'badge-info'}">${u.role || 'user'}</span></td>
                                <td style="text-align: center;">
                                    ${u.id !== state.currentUser?.id ? `
                                        <button onclick="App.deleteUser('${u.id}')" style="background:#fee2e2;color:#b91c1c;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;">
                                            🗑️ Remover
                                        </button>
                                    ` : `
                                        <span style="font-size:12px;color:var(--text-light);">👤 Você</span>
                                    `}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <p style="font-size:12px;color:var(--text-light);margin-top:8px;">
                💡 O usuário atual não pode ser removido.
            </p>
        </div>
        `;
    };

    // ADICIONAR USUÁRIO
    const addUser = async () => {
        const name = el('newUserName')?.value.trim();
        const email = el('newUserEmail')?.value.trim().toLowerCase();
        const pwd = el('newUserPwd')?.value;
        
        if (!name || !email || !pwd) {
            showToast('⚠️ Preencha todos os campos.', 'error');
            return;
        }
        if (pwd.length < 6) {
            showToast('⚠️ A senha deve ter no mínimo 6 caracteres.', 'error');
            return;
        }
        if (state.users.find(u => u.email === email)) {
            showToast('⚠️ Este email já está cadastrado.', 'error');
            return;
        }
        
        const passwordHash = await hashPwd(pwd);
        const user = {
            id: generateId(),
            name,
            email,
            passwordHash,
            role: 'user',
            createdAt: now()
        };
        
        state.users.push(user);
        saveState();
        
        // Limpa os campos
        el('newUserName').value = '';
        el('newUserEmail').value = '';
        el('newUserPwd').value = '';
        
        // Recarrega a página de configurações
        const settingsPage = el('settings');
        if (settingsPage) settingsPage.innerHTML = renderSettings();
        
        showToast(`✅ Usuário ${name} adicionado com sucesso!`);
    };

    // DELETAR USUÁRIO
    const deleteUser = (id) => {
        const user = state.users.find(u => u.id === id);
        if (!user) return;
        
        if (confirm(`⚠️ Tem certeza que deseja remover o usuário "${user.name}"?`)) {
            state.users = state.users.filter(u => u.id !== id);
            saveState();
            
            const settingsPage = el('settings');
            if (settingsPage) settingsPage.innerHTML = renderSettings();
            
            showToast(`🗑️ Usuário ${user.name} removido.`);
        }
    };

    // ==================== TELAS DE AUTENTICAÇÃO ====================
    const doSetup = async () => {
        const name = el('setupName')?.value.trim();
        const email = el('setupEmail')?.value.trim().toLowerCase();
        const pwd = el('setupPwd')?.value;
        const pwd2 = el('setupPwd2')?.value;
        if (!name || !email || !pwd) { 
            showToast('⚠️ Preencha todos os campos.', 'error'); 
            return; 
        }
        if (pwd !== pwd2) { 
            showToast('⚠️ As senhas não coincidem.', 'error'); 
            return; 
        }
        if (pwd.length < 6) {
            showToast('⚠️ A senha deve ter no mínimo 6 caracteres.', 'error');
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
        showToast('✅ Conta criada com sucesso!');
    };

    const doLogin = async () => {
        const email = el('loginEmail')?.value.trim().toLowerCase();
        const pwd = el('loginPwd')?.value;
        if (!email || !pwd) {
            showToast('⚠️ Preencha email e senha.', 'error');
            return;
        }
        const user = state.users.find(u => String(u.email).toLowerCase() === email);
        if (!user) { 
            showToast('❌ Usuário não encontrado.', 'error'); 
            return; 
        }
        const hash = await hashPwd(pwd);
        if (user.passwordHash !== hash) { 
            showToast('❌ Senha incorreta.', 'error'); 
            return; 
        }
        setSession(user.id);
        renderApp();
        syncFromDrive(true);
        showToast('✅ Sessão iniciada!');
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
        if (targetPage === 'dashboard') {
            syncFromDrive(true);
        } else if (targetPage === 'settings') {
            checkConnection();
            // Recarrega configurações com gerenciamento de usuários
            const settingsPage = el('settings');
            if (settingsPage) settingsPage.innerHTML = renderSettings();
        } else if (targetPage === 'reports') {
            const reportContainer = el('reportContainer');
            if (reportContainer) reportContainer.innerHTML = renderMonthlyReport();
        }
    };

    // ==================== RENDERIZAÇÃO ====================
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

    // ==================== RENDER DASHBOARD ====================
    const renderDashboard = () => {
        const m = getSelectedMonthData();

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

        <!-- CARDS -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
            <div class="card stat-card"><div class="stat-label">Saldo Livre</div><div class="stat-value ${m.balance >= 0 ? 'emerald-text' : 'danger-text'}">${fmtMoney(m.balance, state.settings.currencyES)}</div></div>
            <div class="card stat-card"><div class="stat-label">Receitas</div><div class="stat-value emerald-text">${fmtMoney(m.income, state.settings.currencyES)}</div></div>
            <div class="card stat-card"><div class="stat-label">Despesas</div><div class="stat-value danger-text">${fmtMoney(m.expense, state.settings.currencyES)}</div></div>
            <div class="card stat-card" style="border-left:4px solid #8b5cf6"><div class="stat-label">Investimentos / Aportes</div><div class="stat-value" style="color:#8b5cf6">${fmtMoney(m.investment, state.settings.currencyES)}</div></div>
            <!-- PATRIMÔNIO TOTAL -->
            <div class="card stat-card net-worth-card" style="grid-column: span 1;">
                <div class="stat-label">🏦 Patrimônio Total</div>
                <div class="net-worth-value">${fmtMoney(m.netWorth, state.settings.currencyES)}</div>
                <div style="font-size:11px; color: var(--text-light); margin-top:4px;">
                    Investimentos Acumulados: ${fmtMoney(state.transactions.filter(t => t.type === 'investment').reduce((s, t) => s + (Number(t.amount) || 0), 0), state.settings.currencyES)}
                </div>
            </div>
        </div>

        <!-- GRÁFICOS -->
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
                        <span>Taxa de Aportes (${m.income > 0 ? ((m.investment / m.income) * 100).toFixed(1) : 0}%)</span>
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

        <!-- EXTRATO -->
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

    // ==================== RENDER TRANSAÇÕES ====================
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

    // ==================== RELATÓRIOS MENSAIS ====================
    const renderMonthlyReport = () => {
        const ym = state.selectedMonth;
        const [year, month] = ym.split('-');
        const monthName = new Date(parseInt(year), parseInt(month) - 1).toLocaleString('pt-BR', { month: 'long' });
        
        // Dados do mês
        const monthTxs = state.transactions.filter(t => {
            if (!t || !t.date) return false;
            try {
                const d = new Date(t.date);
                return !isNaN(d.getTime()) && d.toISOString().slice(0, 7) === ym;
            } catch (e) { return false; }
        });
        
        const monthIncome = monthTxs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
        const monthExpense = monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
        const monthInvestment = monthTxs.filter(t => t.type === 'investment').reduce((s, t) => s + Number(t.amount), 0);
        const monthBalance = monthIncome - monthExpense - monthInvestment;
        
        // Dados acumulados do ano
        const yearTxs = state.transactions.filter(t => {
            if (!t || !t.date) return false;
            try {
                const d = new Date(t.date);
                return !isNaN(d.getTime()) && d.getFullYear() === parseInt(year);
            } catch (e) { return false; }
        });
        
        const yearIncome = yearTxs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
        const yearExpense = yearTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
        const yearInvestment = yearTxs.filter(t => t.type === 'investment').reduce((s, t) => s + Number(t.amount), 0);
        const yearBalance = yearIncome - yearExpense - yearInvestment;

        // Patrimônio total
        const totalInvestments = state.transactions
            .filter(t => t.type === 'investment')
            .reduce((s, t) => s + Number(t.amount), 0);
        const totalBalance = state.transactions
            .filter(t => t.type === 'income')
            .reduce((s, t) => s + Number(t.amount), 0) -
            state.transactions.filter(t => t.type === 'expense')
            .reduce((s, t) => s + Number(t.amount), 0);
        const netWorth = totalBalance + totalInvestments;

        return `
        <div class="card no-print" style="padding:20px;margin-bottom:24px">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
                <div>
                    <h3 style="margin:0;color:var(--navy)">📊 Relatório Mensal - ${monthName} ${year}</h3>
                    <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">${monthTxs.length} lançamentos no período</p>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <button class="btn-primary" style="background:#dc2626" onclick="App.exportToPDF()">📄 PDF</button>
                    <button class="btn-primary" style="background:#10b981" onclick="App.exportToCSV()">📊 CSV</button>
                </div>
            </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;margin-bottom:24px">
            <div class="card" style="padding:20px">
                <h4 style="margin:0 0 16px;color:var(--navy);border-bottom:2px solid var(--border);padding-bottom:8px">📆 Mês: ${ym}</h4>
                <div style="display:grid;gap:10px">
                    <div><span class="badge badge-success">Receitas:</span> <strong>${fmtMoney(monthIncome, state.settings.currencyES)}</strong></div>
                    <div><span class="badge badge-danger">Despesas:</span> <strong>${fmtMoney(monthExpense, state.settings.currencyES)}</strong></div>
                    <div><span class="badge badge-purple">Investimentos:</span> <strong>${fmtMoney(monthInvestment, state.settings.currencyES)}</strong></div>
                    <div style="border-top:2px solid var(--border);padding-top:10px;font-size:18px;font-weight:bold;color:${monthBalance >= 0 ? 'var(--emerald)' : 'var(--danger)'}">
                        Saldo: ${fmtMoney(monthBalance, state.settings.currencyES)}
                    </div>
                </div>
            </div>

            <div class="card" style="padding:20px">
                <h4 style="margin:0 0 16px;color:var(--navy);border-bottom:2px solid var(--border);padding-bottom:8px">📈 Acumulado ${year}</h4>
                <div style="display:grid;gap:10px">
                    <div><span class="badge badge-success">Receitas:</span> <strong>${fmtMoney(yearIncome, state.settings.currencyES)}</strong></div>
                    <div><span class="badge badge-danger">Despesas:</span> <strong>${fmtMoney(yearExpense, state.settings.currencyES)}</strong></div>
                    <div><span class="badge badge-purple">Investimentos:</span> <strong>${fmtMoney(yearInvestment, state.settings.currencyES)}</strong></div>
                    <div style="border-top:2px solid var(--border);padding-top:10px;font-size:18px;font-weight:bold;color:${yearBalance >= 0 ? 'var(--emerald)' : 'var(--danger)'}">
                        Saldo: ${fmtMoney(yearBalance, state.settings.currencyES)}
                    </div>
                </div>
            </div>

            <div class="card" style="padding:20px;background:linear-gradient(135deg,#fffbeb 0%,#fff 100%);border-left:4px solid #f59e0b">
                <h4 style="margin:0 0 16px;color:#92400e;border-bottom:2px solid #fde68a;padding-bottom:8px">🏦 Patrimônio Total</h4>
                <div style="display:grid;gap:10px">
                    <div style="font-size:28px;font-weight:800;color:#d97706">
                        ${fmtMoney(netWorth, state.settings.currencyES)}
                    </div>
                    <div style="font-size:13px;color:var(--text-light)">
                        Investimentos acumulados: ${fmtMoney(totalInvestments, state.settings.currencyES)}
                    </div>
                </div>
            </div>
        </div>

        <!-- LISTA DE LANÇAMENTOS DO MÊS -->
        <div class="card" style="padding:20px">
            <h4 style="margin:0 0 16px;color:var(--navy)">📋 Lançamentos do Mês</h4>
            ${monthTxs.length === 0 ? '<div class="empty-state"><p>Nenhum lançamento neste mês.</p></div>' : `
            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th>Valor</th></tr></thead>
                    <tbody>${monthTxs.map(t => {
                        const cat = state.categories.find(c => c.id === t.categoryId) || {name:'Geral'};
                        return `<tr>
                            <td>${fmtDate(t.date)}</td>
                            <td><span class="badge ${t.type === 'income' ? 'badge-success' : t.type === 'investment' ? 'badge-purple' : 'badge-danger'}">${t.type === 'income' ? 'Receita' : t.type === 'investment' ? 'Investimento' : 'Despesa'}</span></td>
                            <td>${cat.icon} ${cat.name}</td>
                            <td>${t.description || '-'}</td>
                            <td style="font-weight:600">${fmtMoney(t.amount, state.settings.currencyES)}</td>
                        </tr>`;
                    }).join('')}</tbody>
                </table>
            </div>`}
        </div>`;
    };

    // ==================== EXPORTAÇÕES ====================
    const exportToPDF = () => {
        const content = document.getElementById('reportContainer');
        if (!content) return;
        
        showToast('🔄 Gerando PDF...', 'info');
        
        const opt = {
            margin: 1,
            filename: `Relatorio_FinFam_${state.selectedMonth}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
        };
        
        const header = document.createElement('div');
        const monthName = new Date(parseInt(state.selectedMonth.split('-')[0]), parseInt(state.selectedMonth.split('-')[1]) - 1)
            .toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
        header.innerHTML = `
            <div style="text-align:center;margin-bottom:20px;color:#1e3a5f;padding:20px;border-bottom:3px solid #1e3a5f;">
                <h1 style="font-size:24px;margin:0;">📊 Relatório Financeiro</h1>
                <h2 style="font-size:18px;margin:5px 0;color:#2c5282;">${monthName}</h2>
                <p style="color:#64748b;margin:5px 0 0;">Controle Familiar FinFam</p>
            </div>
        `;
        
        const clone = content.cloneNode(true);
        const wrapper = document.createElement('div');
        wrapper.appendChild(header);
        wrapper.appendChild(clone);
        
        // Remove botões do clone
        wrapper.querySelectorAll('.no-print, button').forEach(el => el.remove());
        
        html2pdf().set(opt).from(wrapper).save().then(() => {
            showToast('✅ PDF gerado com sucesso!');
        }).catch(() => {
            showToast('❌ Erro ao gerar PDF.', 'error');
        });
    };

    const exportToCSV = () => {
        const ym = state.selectedMonth;
        const txs = state.transactions.filter(t => {
            if (!t || !t.date) return false;
            try {
                const d = new Date(t.date);
                return !isNaN(d.getTime()) && d.toISOString().slice(0, 7) === ym;
            } catch (e) { return false; }
        });
        
        if (!txs.length) { 
            showToast('⚠️ Nenhum dado para exportar.', 'error'); 
            return; 
        }
        
        let csv = 'Data;Tipo;Categoria;Descricao;Responsavel;Pais;Valor\n';
        txs.forEach(t => {
            const cat = state.categories.find(c => c.id === t.categoryId)?.name || '';
            csv += `${t.date};${t.type};${cat};${t.description || ''};${t.assignedTo || ''};${t.country || ''};${t.amount}\n`;
        });
        
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Relatorio_FinFam_${ym}.csv`;
        link.click();
        showToast('✅ CSV exportado com sucesso!');
    };

    // ==================== CONFIGURAÇÕES ====================
    const renderSettings = () => {
        return `
        <div class="card" style="padding:24px;max-width:700px;margin:0 auto">
            <h3 style="margin:0 0 16px;color:var(--navy)">⚙️ Configurações</h3>
            
            <!-- Status Conexão -->
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;padding:12px;background:#f8fafc;border-radius:8px">
                <span id="connStatusDot" style="width:12px;height:12px;border-radius:50%;background:#f59e0b"></span>
                <span id="connStatusText" style="font-weight:600">Verificando conexão...</span>
                <button onclick="App.checkConnection()" style="margin-left:auto;padding:6px 12px;background:#e2e8f0;border:none;border-radius:6px;cursor:pointer;font-weight:600">🔍 Testar</button>
            </div>
            
            <!-- URL do Drive -->
            <form onsubmit="event.preventDefault(); App.saveSettings();">
                <div style="margin-bottom:16px">
                    <label class="form-label">URL do Google Apps Script (Web App)</label>
                    <input type="url" id="cfgUrl" class="input-field" placeholder="https://script.google.com/macros/s/.../exec" value="${state.settings.googleScriptUrl || ''}" required>
                </div>
                <div style="display:flex;gap:12px;flex-wrap:wrap">
                    <button type="submit" class="btn-primary">💾 Salvar Configurações</button>
                    <button type="button" class="btn-primary" style="background:#0284c7" onclick="App.syncFromDrive()">📥 Sincronizar do Drive</button>
                    <button type="button" class="btn-primary" style="background:#059669" onclick="App.syncToDrive()">📤 Enviar para o Drive</button>
                </div>
            </form>
            
            <!-- GERENCIAMENTO DE USUÁRIOS -->
            ${renderUserManagement()}
            
            <hr style="margin:30px 0;border:none;border-top:1px solid #e2e8f0">
            
            <!-- Zona de Perigo -->
            <div>
                <h4 style="color:var(--danger);margin-top:0">⚠️ Zona de Perigo</h4>
                <p style="color:var(--text-light);font-size:13px">
                    <strong>O que isso faz?</strong> Apaga <strong>TODOS</strong> os dados locais deste navegador (PC/celular). 
                    Os dados no Google Drive <strong>NÃO</strong> são afetados.
                </p>
                <button onclick="App.resetAllData()" style="background:#fee2e2;color:#b91c1c;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:600">
                    🗑️ Redefinir Dados Locais
                </button>
            </div>
        </div>`;
    };

    const saveSettings = () => {
        const url = el('cfgUrl')?.value.trim() || '';
        state.settings.googleScriptUrl = url;
        saveState();
        showToast('✅ Configurações salvas!');
        checkConnection();
    };

    const resetAllData = () => {
        if (confirm('⚠️ Tem certeza absoluta que deseja apagar tudo? Esta ação é irreversível!')) {
            localStorage.clear();
            sessionStorage.clear();
            location.reload();
        }
    };

    // ==================== MODAL DE LANÇAMENTOS ====================
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
                        <label class="form-label">Tipo</label>
                        <select id="txType" class="input-field">
                            <option value="expense" ${tx && tx.type === 'expense' ? 'selected' : ''}>Despesa</option>
                            <option value="income" ${tx && tx.type === 'income' ? 'selected' : ''}>Receita</option>
                            <option value="investment" ${tx && tx.type === 'investment' ? 'selected' : ''}>Investimento 📈</option>
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
                        <label class="form-label">País</label>
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
                    <button type="submit" class="btn-primary" style="padding:12px 24px;">${isEdit ? 'Salvar' : 'Adicionar'}</button>
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

        if (!date || !categoryId || amount <= 0) {
            showToast('⚠️ Preencha todos os campos corretamente.', 'error');
            return;
        }

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
        refreshAllViews();
        showToast('✅ Lançamento salvo!');
        syncToDrive();
    };

    const deleteTransaction = (id) => {
        if (confirm('⚠️ Deseja realmente excluir este lançamento?')) {
            state.transactions = state.transactions.filter(t => t.id !== id);
            saveState();
            refreshAllViews();
            showToast('🗑️ Lançamento removido.');
            syncToDrive();
        }
    };

    // ==================== RENDER APP ====================
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
                    <button class="nav-item active" data-page="dashboard" onclick="App.nav(this)"><span>📊</span> Dashboard</button>
                    <button class="nav-item" data-page="transactions" onclick="App.nav(this)"><span>📝</span> Lançamentos</button>
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
            
            <div id="modalOverlay" class="modal-overlay" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.6); z-index:9999; align-items:center; justify-content:center; backdrop-filter:blur(4px);">
                <div id="modalContent" class="modal" style="background:#fff; padding:24px; border-radius:12px; width:90%; max-width:550px; max-height:90vh; overflow-y:auto; box-shadow:0 10px 25px rgba(0,0,0,0.2);"></div>
            </div>
            <div id="toast" class="toast"></div>`;
    };

    // ==================== INIT ====================
    const init = () => {
        initState();
        if (!isSetup()) renderSetup();
        else if (!isLoggedIn()) renderLogin();
        else {
            renderApp();
            // Sincroniza automaticamente ao abrir
            syncFromDrive(true).then(() => {
                console.log('✅ Sincronização automática concluída');
                console.log('📊 Total de transações:', state.transactions.length);
            });
        }
    };

    // EXPORTAR API PÚBLICA
    return {
        init,
        doSetup,
        doLogin,
        logout,
        nav,
        togglePrivacy,
        changeSelectedMonth,
        checkConnection,
        saveSettings,
        syncFromDrive,
        syncToDrive,
        resetAllData,
        showTransactionModal,
        closeModal,
        saveTransaction,
        deleteTransaction,
        exportToPDF,
        exportToCSV,
        // NOVAS FUNÇÕES
        addUser,
        deleteUser
    };
})();

// Inicialização automática
document.addEventListener('DOMContentLoaded', App.init);
