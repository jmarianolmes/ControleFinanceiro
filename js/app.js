// ============================================================
// FinFam - Controle Financeiro Familiar
// Arquivo: js/app.js (VERSÃO COMPLETA ATUALIZADA)
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
    let isDriveConnected = false;
    const el = id => document.getElementById(id);

    const showLoading = (msg = "Conectando ao Google Drive...") => {
        let overlay = el("finfamLoadingOverlay");
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "finfamLoadingOverlay";
            overlay.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(15,23,42,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);";
            overlay.innerHTML = `
                <div style="background:#fff;padding:32px 40px;border-radius:16px;text-align:center;max-width:380px;box-shadow:0 20px 40px rgba(0,0,0,0.3);">
                    <div style="font-size:36px;margin-bottom:12px;animation:spin 1.2s linear infinite;display:inline-block;">🔄</div>
                    <h3 style="margin:0 0 8px 0;font-size:18px;color:#1e3a5f;font-weight:700;">Conectando ao Banco de Dados</h3>
                    <p style="margin:0 0 16px 0;font-size:13px;color:#64748b;">${msg}</p>
                    <div style="width:100%;background:#e2e8f0;height:6px;border-radius:3px;overflow:hidden;position:relative;">
                        <div style="width:50%;height:100%;background:#1e3a5f;border-radius:3px;animation:progress 1.5s ease-in-out infinite;"></div>
                    </div>
                </div>
                <style>
                    @keyframes spin { 100% { transform: rotate(360deg); } }
                    @keyframes progress { 0% { margin-left: -50%; width: 50%; } 50% { margin-left: 25%; width: 60%; } 100% { margin-left: 100%; width: 50%; } }
                </style>
            `;
            document.body.appendChild(overlay);
        } else {
            overlay.style.display = "flex";
        }
    };

    const hideLoading = () => {
        const overlay = el("finfamLoadingOverlay");
        if (overlay) overlay.style.display = "none";
    };

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

    const generateId = () => {
        return 'tx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    };

    const now = () => new Date().toISOString();

    // ==================== CATEGORIAS PADRÃO ====================
    const defaultCategories = [
        { id: 'cat_salario_es', name: 'Salário (Espanha)', type: 'income', country: 'ES', icon: '💼' },
        { id: 'cat_salario_br', name: 'Salário / Renda (Brasil)', type: 'income', country: 'BR', icon: '💵' },
        { id: 'cat_rendimentos', name: 'Rendimentos / Investimentos', type: 'income', country: 'ES', icon: '📈' },
        { id: 'cat_outros_ganhos', name: 'Outras Receitas', type: 'income', country: 'ES', icon: '✨' },
        { id: 'cat_renda_fixa', name: 'Renda Fixa / Tesouro', type: 'investment', country: 'BR', icon: '🏦' },
        { id: 'cat_acoes', name: 'Ações / Fundos', type: 'investment', country: 'BR', icon: '📊' },
        { id: 'cat_cripto', name: 'Criptoativos', type: 'investment', country: 'ES', icon: '🪙' },
        { id: 'cat_reserva', name: 'Reserva de Emergência', type: 'investment', country: 'ES', icon: '🛡️' },
        { id: 'cat_aluguel', name: 'Aluguel / Hipoteca', type: 'expense', country: 'ES', icon: '🏠' },
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
    // syncFromDrive - COM SUPORTE A RECARGA SEM PERDA LOCAL
    // ============================================================
    const syncFromDrive = async (silent = false) => {
        const url = state.settings.googleScriptUrl;
        if (!url) {
            isDriveConnected = true;
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
            console.log('📥 Dados do Drive:', data);
            
            if (data.status === 'success' && Array.isArray(data.transactions)) {
                console.log(`📊 Recebidos ${data.transactions.length} registros do Drive`);
                
                // NORMALIZAÇÃO COMPLETA
                const normalized = data.transactions.map(t => {
                    let dateStr = t.date || t.Data || '';
                    let normalizedDate = '';
                    
                    if (dateStr) {
                        dateStr = String(dateStr).trim();
                        
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
                            normalizedDate = `${year}-${month}-${day}`;
                        }
                        else if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
                            normalizedDate = dateStr.slice(0, 10);
                        }
                        else {
                            try {
                                const d = new Date(dateStr);
                                if (!isNaN(d.getTime())) {
                                    normalizedDate = d.toISOString().slice(0, 10);
                                }
                            } catch (e) {}
                        }
                    }
                    
                    if (!normalizedDate) {
                        normalizedDate = new Date().toISOString().slice(0, 10);
                    }
                    
                    return {
                        id: t.id || t.ID || generateId(),
                        date: normalizedDate,
                        type: t.type || t.Tipo || 'expense',
                        categoryId: t.categoryId || t.CategoriaID || 'cat_outros_es',
                        description: t.description || t.Descrição || '',
                        assignedTo: t.assignedTo || t.Responsável || 'Casal',
                        country: t.country || t.País || 'ES',
                        amount: Number(t.amount || t.Valor) || 0
                    };
                });
                
                const seenIds = new Set();
                const unique = normalized.filter(t => {
                    if (seenIds.has(t.id)) return false;
                    seenIds.add(t.id);
                    return true;
                });
                
                const driveIds = new Set(unique.map(t => t.id));
                const localPending = (state.transactions || []).filter(t => !driveIds.has(t.id));
                
                state.transactions = [...unique, ...localPending];
                isDriveConnected = true;
                saveState();
                refreshAllViews();
                
                const monthPicker = el('dashMonthPicker');
                if (monthPicker) monthPicker.value = state.selectedMonth;
                
                if (localPending.length > 0) {
                    syncToDrive();
                }
                
                if (!silent) {
                    showToast(`✅ ${unique.length} registros sincronizados do Drive!`);
                }
                
                console.log(`📊 ${unique.length} registros normalizados`);
                
            } else {
                if (!silent) showToast(data.message || '❌ Erro ao consultar o Banco de Dados.', 'error');
            }
        } catch (e) {
            if (!silent) showToast('❌ Erro ao consultar o Banco de Dados.', 'error');
            console.error('❌ Sync error:', e);
        } finally {
            hideLoading();
        }
    };

    // ============================================================
    // syncFromDriveForce - FORÇA SUBSTITUIÇÃO
    // ============================================================
    const syncFromDriveForce = async () => {
        if (!confirm('⚠️ Isso vai SUBSTITUIR TODOS os dados locais pelos dados do Drive. Continuar?')) {
            return;
        }
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
                body: JSON.stringify({ 
                    action: 'ping', 
                    token: state.settings.apiToken || DEFAULT_TOKEN 
                })
            });
            const data = await res.json();
            if (data.status === 'success') {
                dot.style.backgroundColor = '#10b981';
                text.textContent = '✅ Conectado com Sucesso';
                isDriveConnected = true;
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

        const sess = localStorage.getItem(SESSION_KEY);
        if (sess) {
            try {
                const s = JSON.parse(sess);
                if (s.expiry && new Date(s.expiry) > new Date()) {
                    state.currentUser = state.users.find(u => u.id === s.userId) || null;
                    state.sessionExpiry = s.expiry;
                } else {
                    clearSession();
                }
            } catch (e) {
                clearSession();
            }
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

    const setSession = (userId) => {
        const expiry = new Date(Date.now() + INACTIVITY_TIMEOUT).toISOString();
        state.currentUser = state.users.find(u => u.id === userId) || null;
        state.sessionExpiry = expiry;
        localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, expiry }));
        resetInactivityTimer();
    };

    const clearSession = () => {
        state.currentUser = null;
        state.sessionExpiry = null;
        isDriveConnected = false;
        localStorage.removeItem(SESSION_KEY);
        if (inactivityTimer) clearTimeout(inactivityTimer);
    };

    const resetInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
            if (isLoggedIn()) {
                clearSession();
                init();
                showToast('⏱️ Sessão expirada por inatividade.', 'error');
            }
        }, INACTIVITY_TIMEOUT);
    };

    const isSetup = () => state.users.length > 0;
    const isLoggedIn = () => !!state.currentUser && !!state.sessionExpiry && new Date(state.sessionExpiry) > new Date();

    const changeSelectedMonth = (m) => {
        if (!m) return;
        state.selectedMonth = m;
        saveState();
        refreshAllViews();
    };

    const refreshAllViews = () => {
        const dash = el('dashboard');
        const txs = el('transactions');
        const rep = el('reports');
        if (dash && dash.classList.contains('active')) dash.innerHTML = renderDashboard();
        if (txs && txs.classList.contains('active')) txs.innerHTML = renderTransactions();
        if (rep && rep.classList.contains('active')) rep.innerHTML = renderMonthlyReport();
        initCharts();
    };

    const saveSettings = () => {
        const url = el('setScriptUrl')?.value.trim();
        const token = el('setToken')?.value.trim();
        const day = parseInt(el('setStartDay')?.value) || 1;
        const curBR = el('setCurBR')?.value.trim() || 'R$';
        const curES = el('setCurES')?.value.trim() || '€';

        state.settings.googleScriptUrl = url;
        state.settings.apiToken = token || DEFAULT_TOKEN;
        state.settings.monthStartDay = day;
        state.settings.currencyBR = curBR;
        state.settings.currencyES = curES;

        saveState();
        showToast('⚙️ Configurações salvas!');
        checkConnection();
    };

    const resetAllData = () => {
        if (confirm('⚠️ ATENÇÃO: Isso apagará TODOS os dados locais deste navegador! Deseja continuar?')) {
            localStorage.clear();
            location.reload();
        }
    };

    const cleanGhostData = () => {
        if (!confirm('⚠️ Limpar dados fantasmas locais?')) return;
        state.transactions = [];
        saveState();
        refreshAllViews();
        showToast('🧹 Dados locais limpos.');
    };

    const resetDriveData = async () => {
        if (!confirm('🚨 ATENÇÃO: Isso apagará TODOS os lançamentos do Google Drive!')) return;
        const url = state.settings.googleScriptUrl;
        if (!url) {
            showToast('⚠️ URL do Google Drive não configurada.', 'error');
            return;
        }
        try {
            showToast('🔄 Resetando dados do Drive...', 'info');
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'sync',
                    token: state.settings.apiToken || DEFAULT_TOKEN,
                    transactions: []
                })
            });
            const data = await res.json();
            if (data.status === 'success') {
                state.transactions = [];
                saveState();
                refreshAllViews();
                showToast('✅ Dados do Drive resetados!');
            } else {
                showToast('❌ Falha ao resetar no Drive.', 'error');
            }
        } catch (e) {
            showToast('❌ Erro ao resetar dados do Drive.', 'error');
            console.error(e);
        }
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
        
        el('newUserName').value = '';
        el('newUserEmail').value = '';
        el('newUserPwd').value = '';
        
        showToast(`✅ Usuário ${name} adicionado com sucesso!`);
        
        const settingsPage = el('settings');
        if (settingsPage) settingsPage.innerHTML = renderSettings();
    };

    // REMOVER USUÁRIO
    const deleteUser = (userId) => {
        if (userId === state.currentUser?.id) {
            showToast('⚠️ Você não pode remover seu próprio usuário!', 'error');
            return;
        }
        
        const user = state.users.find(u => u.id === userId);
        if (!user) return;
        
        if (!confirm(`⚠️ Deseja realmente remover o usuário "${user.name}"?`)) {
            return;
        }
        
        state.users = state.users.filter(u => u.id !== userId);
        saveState();
        showToast(`🗑️ Usuário ${user.name} removido.`);
        
        const settingsPage = el('settings');
        if (settingsPage) settingsPage.innerHTML = renderSettings();
    };

    // ==================== AUTH & SETUP ====================
    const doSetup = async () => {
        const name = el('setupName')?.value.trim();
        const email = el('setupEmail')?.value.trim().toLowerCase();
        const pwd = el('setupPwd')?.value;
        const curBR = el('setupCurBR')?.value.trim() || 'R$';
        const curES = el('setupCurES')?.value.trim() || '€';

        if (!name || !email || !pwd) {
            showToast('⚠️ Preencha todos os campos.', 'error');
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
        state.settings.currencyBR = curBR;
        state.settings.currencyES = curES;
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
        showLoading("Conectando ao Google Drive...");
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
        
        if (targetPage === 'settings') {
            const settingsPage = el('settings');
            if (settingsPage) settingsPage.innerHTML = renderSettings();
        } else if (targetPage === 'reports') {
            const reportContainer = el('reportContainer');
            if (reportContainer) {
                reportContainer.innerHTML = renderMonthlyReport();
                const monthPicker = el('reportMonthPicker');
                if (monthPicker) monthPicker.value = state.selectedMonth;
            }
        }
    };


    const togglePrivacy = () => {
        state.privacyMode = !state.privacyMode;
        refreshAllViews();
    };
    // ==================== RENDERIZAÇÃO ====================
    const renderLogin = () => {
        el('app').innerHTML = `
            <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; background: var(--bg);">
                <div class="card" style="max-width: 420px; width: 100%; padding: 40px; text-align: center;">
                    <div style="font-size: 48px; margin-bottom: 12px;">💶</div>
                    <h2 style="color: var(--navy); margin-bottom: 8px;">FinFam</h2>
                    <p style="color: var(--text-light); margin-bottom: 24px; font-size: 14px;">Controle Financeiro Familiar (ES 🇪🇸 & BR 🇧🇷)</p>
                    <form onsubmit="event.preventDefault(); App.doLogin();">
                        <div class="form-group" style="text-align: left;">
                            <label class="form-label">Email</label>
                            <input type="email" id="loginEmail" class="input-field" placeholder="seu@email.com" required>
                        </div>
                        <div class="form-group" style="text-align: left;">
                            <label class="form-label">Senha</label>
                            <input type="password" id="loginPwd" class="input-field" placeholder="••••••••" required>
                        </div>
                        <button type="submit" class="btn-primary" style="width: 100%; margin-top: 10px; padding: 12px;">Entrar</button>
                    </form>
                </div>
            </div>
            <div id="toast" class="toast"></div>
        `;
    };

    const renderSetup = () => {
        el('app').innerHTML = `
            <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; background: var(--bg);">
                <div class="card" style="max-width: 480px; width: 100%; padding: 40px;">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <div style="font-size: 48px; margin-bottom: 12px;">👋</div>
                        <h2 style="color: var(--navy); margin-bottom: 8px;">Bem-vindo ao FinFam!</h2>
                        <p style="color: var(--text-light); font-size: 14px;">Configure o seu usuário administrador para começar.</p>
                    </div>
                    <form onsubmit="event.preventDefault(); App.doSetup();">
                        <div class="form-group">
                            <label class="form-label">Seu Nome</label>
                            <input type="text" id="setupName" class="input-field" placeholder="Ex: João Silva" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Email</label>
                            <input type="email" id="setupEmail" class="input-field" placeholder="seu@email.com" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Senha (mínimo 6 caracteres)</label>
                            <input type="password" id="setupPwd" class="input-field" placeholder="••••••••" minlength="6" required>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                            <div class="form-group">
                                <label class="form-label">Moeda BR</label>
                                <input type="text" id="setupCurBR" class="input-field" value="R$">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Moeda ES</label>
                                <input type="text" id="setupCurES" class="input-field" value="€">
                            </div>
                        </div>
                        <button type="submit" class="btn-primary" style="width: 100%; margin-top: 10px; padding: 12px;">Criar Conta e Iniciar</button>
                    </form>
                </div>
            </div>
            <div id="toast" class="toast"></div>
        `;
    };

    const renderDashboard = () => {
        const selMonth = state.selectedMonth || new Date().toISOString().slice(0, 7);
        const txs = state.transactions.filter(t => t.date && t.date.startsWith(selMonth));

        const incES = txs.filter(t => t.country === 'ES' && t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
        const expES = txs.filter(t => t.country === 'ES' && t.type === 'expense').reduce((acc, t) => acc + t.amount, 0);
        const invES = txs.filter(t => t.country === 'ES' && t.type === 'investment').reduce((acc, t) => acc + t.amount, 0);
        const balES = incES - expES - invES;

        const incBR = txs.filter(t => t.country === 'BR' && t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
        const expBR = txs.filter(t => t.country === 'BR' && t.type === 'expense').reduce((acc, t) => acc + t.amount, 0);
        const invBR = txs.filter(t => t.country === 'BR' && t.type === 'investment').reduce((acc, t) => acc + t.amount, 0);
        const balBR = incBR - expBR - invBR;

        return `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
                <div>
                    <h2 style="color: var(--navy); margin: 0 0 4px 0;">Painel Financeiro</h2>
                    <p style="color: var(--text-light); margin: 0; font-size: 14px;">Resumo consolidado das finanças em Espanha e Brasil</p>
                </div>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <input type="month" id="dashMonthPicker" class="input-field" value="${selMonth}" onchange="App.changeSelectedMonth(this.value)" style="width: auto;">
                    <button class="btn-primary" onclick="App.showTransactionModal(null)">+ Novo Lançamento</button>
                </div>
            </div>

            <!-- ESPANHA -->
            <h3 style="color: var(--navy); margin-bottom: 12px; font-size: 16px;">🇪🇸 Espanha (${state.settings.currencyES})</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px;">
                <div class="card stat-card">
                    <div class="stat-label">Receitas</div>
                    <div class="stat-value emerald-text">${fmtMoney(incES, state.settings.currencyES)}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">Despesas</div>
                    <div class="stat-value danger-text">${fmtMoney(expES, state.settings.currencyES)}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">Investimentos</div>
                    <div class="stat-value" style="color: var(--purple);">${fmtMoney(invES, state.settings.currencyES)}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">Saldo</div>
                    <div class="stat-value ${balES >= 0 ? 'emerald-text' : 'danger-text'}">${fmtMoney(balES, state.settings.currencyES)}</div>
                </div>
            </div>

            <!-- BRASIL -->
            <h3 style="color: var(--navy); margin-bottom: 12px; font-size: 16px;">🇧🇷 Brasil (${state.settings.currencyBR})</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 32px;">
                <div class="card stat-card">
                    <div class="stat-label">Receitas</div>
                    <div class="stat-value emerald-text">${fmtMoney(incBR, state.settings.currencyBR)}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">Despesas</div>
                    <div class="stat-value danger-text">${fmtMoney(expBR, state.settings.currencyBR)}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">Investimentos</div>
                    <div class="stat-value" style="color: var(--purple);">${fmtMoney(invBR, state.settings.currencyBR)}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">Saldo</div>
                    <div class="stat-value ${balBR >= 0 ? 'emerald-text' : 'danger-text'}">${fmtMoney(balBR, state.settings.currencyBR)}</div>
                </div>
            </div>

            <!-- GRÁFICOS -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 20px; margin-bottom: 32px;">
                <div class="card" style="padding: 20px;">
                    <h4 style="margin: 0 0 16px 0; color: var(--navy);">Despesas por Categoria (Espanha)</h4>
                    <div style="position: relative; height: 260px;">
                        <canvas id="chartExpensesES"></canvas>
                    </div>
                </div>
                <div class="card" style="padding: 20px;">
                    <h4 style="margin: 0 0 16px 0; color: var(--navy);">Comparativo Mensal</h4>
                    <div style="position: relative; height: 260px;">
                        <canvas id="chartComparison"></canvas>
                    </div>
                </div>
            </div>
        `;
    };

    const renderTransactions = () => {
        const txs = [...state.transactions].sort((a, b) => new Date(b.date) - new Date(a.date));

        return `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
                <div>
                    <h2 style="color: var(--navy); margin: 0 0 4px 0;">Lançamentos</h2>
                    <p style="color: var(--text-light); margin: 0; font-size: 14px;">Histórico completo de transações registradas</p>
                </div>
                <div style="display: flex; gap: 12px;">
                    <button class="btn-primary" onclick="App.showTransactionModal(null)">+ Novo Lançamento</button>
                </div>
            </div>

            <div class="card" style="padding: 20px;">
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
                                <th style="text-align: right;">Valor</th>
                                <th style="text-align: center;">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${txs.length === 0 ? `
                                <tr><td colspan="8" style="text-align: center; color: var(--text-light); padding: 40px;">Nenhum lançamento encontrado.</td></tr>
                            ` : txs.map(t => {
                                const cat = state.categories.find(c => c.id === t.categoryId);
                                const isExpense = t.type === 'expense';
                                const isIncome = t.type === 'income';
                                const cur = t.country === 'BR' ? state.settings.currencyBR : state.settings.currencyES;
                                return `
                                    <tr>
                                        <td>${fmtDate(t.date)}</td>
                                        <td><strong>${t.description || '-'}</strong></td>
                                        <td><span class="category-tag">${cat ? cat.icon + ' ' + cat.name : '-'}</span></td>
                                        <td><span class="badge badge-info">${t.assignedTo || 'Casal'}</span></td>
                                        <td>${t.country === 'BR' ? '🇧🇷 BR' : '🇪🇸 ES'}</td>
                                        <td>
                                            <span class="badge ${isIncome ? 'badge-success' : isExpense ? 'badge-danger' : 'badge-purple'}">
                                                ${isIncome ? 'Receita' : isExpense ? 'Despesa' : 'Investimento'}
                                            </span>
                                        </td>
                                        <td style="text-align: right; font-weight: 600;" class="${isIncome ? 'emerald-text' : isExpense ? 'danger-text' : ''}">
                                            ${isExpense ? '-' : isIncome ? '+' : ''}${fmtMoney(t.amount, cur)}
                                        </td>
                                        <td style="text-align: center;">
                                            <button onclick="App.showTransactionModal('${t.id}')" style="background:#e0f2fe;color:#0369a1;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;margin-right:6px;">✏️</button>
                                            <button onclick="App.deleteTransaction('${t.id}')" style="background:#fee2e2;color:#b91c1c;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;">🗑️</button>
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

 const renderMonthlyReport = () => {
    const selMonth = state.selectedMonth || new Date().toISOString().slice(0, 7);

    const getYearMonth = (dateStr) => {
        if (!dateStr) return '';
        const s = String(dateStr).trim();
        if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
        const brMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (brMatch) return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}`;
        try {
            const d = new Date(s);
            if (!isNaN(d.getTime())) return d.toISOString().slice(0, 7);
        } catch (e) {}
        return '';
    };

    // Todos os lançamentos do mês
    const txs = (state.transactions || []).filter(t => {
        if (!t || !t.date) return false;
        return getYearMonth(t.date) === selMonth;
    }).sort((a, b) => (b.date > a.date ? 1 : -1));

    // Filtros Espanha
    const recES = txs.filter(t => (t.country || 'ES').toUpperCase() === 'ES' && (t.type || '').toLowerCase() === 'income');
    const expES = txs.filter(t => (t.country || 'ES').toUpperCase() === 'ES' && (t.type || '').toLowerCase() === 'expense');
    const invES = txs.filter(t => (t.country || 'ES').toUpperCase() === 'ES' && (t.type || '').toLowerCase() === 'investment');

    // Filtros Brasil
    const recBR = txs.filter(t => (t.country || '').toUpperCase() === 'BR' && (t.type || '').toLowerCase() === 'income');
    const expBR = txs.filter(t => (t.country || '').toUpperCase() === 'BR' && (t.type || '').toLowerCase() === 'expense');
    const invBR = txs.filter(t => (t.country || '').toUpperCase() === 'BR' && (t.type || '').toLowerCase() === 'investment');

    // Totais Espanha
    const totalRecES = recES.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    const totalExpES = expES.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    const totalInvES = invES.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    const saldoES = totalRecES - totalExpES - totalInvES;

    // Totais Brasil
    const totalRecBR = recBR.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    const totalExpBR = expBR.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    const totalInvBR = invBR.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    const saldoBR = totalRecBR - totalExpBR - totalInvBR;

    const currES = state.settings?.currencyES || '€';
    const currBR = state.settings?.currencyBR || 'R$';

    // Gerador de tabela para evitar repetição de código
    const renderTable = (lista, moeda, corValor = '') => {
        if (!lista.length) {
            return `<tr><td colspan="5" style="text-align:center;color:var(--text-light);padding:14px;">Nenhum registro.</td></tr>`;
        }
        return lista.map(t => {
            const cat = (state.categories || []).find(c => c.id === t.categoryId);
            return `
                <tr>
                    <td>${fmtDate(t.date)}</td>
                    <td><strong>${t.description || '-'}</strong></td>
                    <td>${cat ? cat.icon + ' ' + cat.name : '-'}</td>
                    <td>${t.assignedTo || 'Casal'}</td>
                    <td style="text-align: right; font-weight: 600;" class="${corValor}">
                        ${fmtMoney(t.amount, moeda)}
                    </td>
                </tr>
            `;
        }).join('');
    };

    return `
        <div id="reportContainer">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
                <div>
                    <h2 style="color: var(--navy); margin: 0 0 4px 0;">Relatório Mensal</h2>
                    <p style="color: var(--text-light); margin: 0; font-size: 14px;">Detalhamento financeiro (${txs.length} lançamentos no mês)</p>
                </div>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <input type="month" id="reportMonthPicker" class="input-field" value="${selMonth}" onchange="App.changeReportMonth(this.value)" style="width: auto;">
                    <button class="btn-secondary" onclick="App.exportToPDF()">📄 PDF</button>
                    <button class="btn-secondary" onclick="App.exportToCSV()">📊 CSV</button>
                </div>
            </div>

            <!-- SEÇÃO ESPANHA 🇪🇸 -->
            <div class="card" style="padding: 24px; margin-bottom: 24px;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid var(--border); padding-bottom: 12px; margin-bottom: 16px; flex-wrap:wrap; gap:8px;">
                    <h3 style="color: var(--navy); margin: 0;">🇪🇸 Espanha</h3>
                    <div style="font-size: 14px; font-weight: 600;">
                        <span class="emerald-text">Rec: +${fmtMoney(totalRecES, currES)}</span> | 
                        <span class="danger-text">Desp: -${fmtMoney(totalExpES, currES)}</span> | 
                        <span style="color:#8b5cf6">Inv: ${fmtMoney(totalInvES, currES)}</span> | 
                        <span>Saldo: <strong>${fmtMoney(saldoES, currES)}</strong></span>
                    </div>
                </div>

                <!-- Receitas ES -->
                <h4 style="color: var(--emerald); margin: 12px 0 8px 0;">🟢 Receitas (+${fmtMoney(totalRecES, currES)})</h4>
                <div class="table-container" style="margin-bottom: 20px;">
                    <table class="data-table">
                        <thead>
                            <tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Responsável</th><th style="text-align: right;">Valor</th></tr>
                        </thead>
                        <tbody>${renderTable(recES, currES, 'emerald-text')}</tbody>
                    </table>
                </div>

                <!-- Despesas ES -->
                <h4 style="color: var(--danger); margin: 12px 0 8px 0;">🔴 Despesas (-${fmtMoney(totalExpES, currES)})</h4>
                <div class="table-container" style="margin-bottom: 20px;">
                    <table class="data-table">
                        <thead>
                            <tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Responsável</th><th style="text-align: right;">Valor</th></tr>
                        </thead>
                        <tbody>${renderTable(expES, currES, 'danger-text')}</tbody>
                    </table>
                </div>

                <!-- Investimentos ES -->
                ${invES.length > 0 ? `
                    <h4 style="color: #8b5cf6; margin: 12px 0 8px 0;">🟣 Investimentos (${fmtMoney(totalInvES, currES)})</h4>
                    <div class="table-container">
                        <table class="data-table">
                            <thead>
                                <tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Responsável</th><th style="text-align: right;">Valor</th></tr>
                            </thead>
                            <tbody>${renderTable(invES, currES, '')}</tbody>
                        </table>
                    </div>
                ` : ''}
            </div>

            <!-- SEÇÃO BRASIL 🇧🇷 -->
            <div class="card" style="padding: 24px;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid var(--border); padding-bottom: 12px; margin-bottom: 16px; flex-wrap:wrap; gap:8px;">
                    <h3 style="color: var(--navy); margin: 0;">🇧🇷 Brasil</h3>
                    <div style="font-size: 14px; font-weight: 600;">
                        <span class="emerald-text">Rec: +${fmtMoney(totalRecBR, currBR)}</span> | 
                        <span class="danger-text">Desp: -${fmtMoney(totalExpBR, currBR)}</span> | 
                        <span>Saldo: <strong>${fmtMoney(saldoBR, currBR)}</strong></span>
                    </div>
                </div>

                <!-- Receitas BR -->
                <h4 style="color: var(--emerald); margin: 12px 0 8px 0;">🟢 Receitas (+${fmtMoney(totalRecBR, currBR)})</h4>
                <div class="table-container" style="margin-bottom: 20px;">
                    <table class="data-table">
                        <thead>
                            <tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Responsável</th><th style="text-align: right;">Valor</th></tr>
                        </thead>
                        <tbody>${renderTable(recBR, currBR, 'emerald-text')}</tbody>
                    </table>
                </div>

                <!-- Despesas BR -->
                <h4 style="color: var(--danger); margin: 12px 0 8px 0;">🔴 Despesas (-${fmtMoney(totalExpBR, currBR)})</h4>
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Responsável</th><th style="text-align: right;">Valor</th></tr>
                        </thead>
                        <tbody>${renderTable(expBR, currBR, 'danger-text')}</tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
};

    const renderSettings = () => {
        return `
            <div style="margin-bottom: 24px;">
                <h2 style="color: var(--navy); margin: 0 0 4px 0;">Configurações</h2>
                <p style="color: var(--text-light); margin: 0; font-size: 14px;">Integração com Google Drive e preferências do sistema</p>
            </div>

            <div class="card" style="padding: 28px; max-width: 700px;">
                <h3 style="color: var(--navy); margin-top: 0; margin-bottom: 16px;">🌐 Google Apps Script (Drive / Excel)</h3>
                <div class="form-group">
                    <label class="form-label">URL do Web App (Google Apps Script)</label>
                    <input type="url" id="setScriptUrl" class="input-field" value="${state.settings.googleScriptUrl || ''}" placeholder="https://script.google.com/macros/s/.../exec">
                </div>
                <div class="form-group">
                    <label class="form-label">Token de Segurança da API</label>
                    <input type="text" id="setToken" class="input-field" value="${state.settings.apiToken || DEFAULT_TOKEN}">
                </div>

                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px; background: #f8fafc; padding: 12px 16px; border-radius: 8px;">
                    <div id="connStatusDot" style="width: 12px; height: 12px; border-radius: 50%; background: #94a3b8;"></div>
                    <span id="connStatusText" style="font-size: 13px; font-weight: 500;">Status da Conexão: Não testado</span>
                    <button class="btn-secondary" style="padding: 6px 12px; font-size: 12px; margin-left: auto;" onclick="App.checkConnection()">Testar Conexão</button>
                </div>

                <h3 style="color: var(--navy); margin-top: 24px; margin-bottom: 16px;">⚙️ Preferências</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 24px;">
                    <div class="form-group">
                        <label class="form-label">Moeda BR</label>
                        <input type="text" id="setCurBR" class="input-field" value="${state.settings.currencyBR || 'R$'}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Moeda ES</label>
                        <input type="text" id="setCurES" class="input-field" value="${state.settings.currencyES || '€'}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Dia Início Mês</label>
                        <input type="number" id="setStartDay" class="input-field" value="${state.settings.monthStartDay || 1}" min="1" max="28">
                    </div>
                </div>

                <div style="display: flex; gap: 12px; margin-bottom: 24px;">
                    <button class="btn-primary" onclick="App.saveSettings()">Salvar Configurações</button>
                    <button class="btn-secondary" onclick="App.syncFromDrive(false)">Sincronizar Agora</button>
                </div>

                ${renderUserManagement()}

                <div style="margin-top: 30px; border-top: 2px solid var(--border); padding-top: 20px;">
                    <h4 style="color: var(--danger); margin-bottom: 12px;">⚠️ Zona de Perigo</h4>
                    <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                        <button class="btn-secondary" style="border-color: #cbd5e1;" onclick="App.cleanGhostData()">🧹 Limpar Fantasmas Locais</button>
                        <button class="btn-secondary" style="border-color: #f59e0b; color: #d97706;" onclick="App.syncFromDriveForce()">📥 Forçar Cópia do Drive</button>
                        <button class="btn-danger" onclick="App.resetDriveData()">🚨 Resetar Dados do Drive</button>
                        <button class="btn-danger" style="background: #991b1b;" onclick="App.resetAllData()">💥 Reset Total</button>
                    </div>
                </div>
            </div>
        `;
    };

    // ==================== GRÁFICOS (CHART.JS) ====================
    let chartExpInstance = null;
    let chartCompInstance = null;

    const initCharts = () => {
        const cExp = el('chartExpensesES');
        const cComp = el('chartComparison');
        if (!cExp || !cComp) return;

        const selMonth = state.selectedMonth || new Date().toISOString().slice(0, 7);
        const txs = state.transactions.filter(t => t.date && t.date.startsWith(selMonth));

        const expES = txs.filter(t => t.country === 'ES' && t.type === 'expense');
        const catMap = {};
        expES.forEach(t => {
            const cat = state.categories.find(c => c.id === t.categoryId);
            const name = cat ? cat.name : 'Outros';
            catMap[name] = (catMap[name] || 0) + t.amount;
        });

        if (chartExpInstance) chartExpInstance.destroy();
        chartExpInstance = new Chart(cExp, {
            type: 'doughnut',
            data: {
                labels: Object.keys(catMap),
                datasets: [{
                    data: Object.values(catMap),
                    backgroundColor: ['#1e3a5f', '#059669', '#d97706', '#dc2626', '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#64748b']
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
        });

        const incES = txs.filter(t => t.country === 'ES' && t.type === 'income').reduce((a, b) => a + b.amount, 0);
        const totExpES = expES.reduce((a, b) => a + b.amount, 0);

        if (chartCompInstance) chartCompInstance.destroy();
        chartCompInstance = new Chart(cComp, {
            type: 'bar',
            data: {
                labels: ['Receitas (€)', 'Despesas (€)'],
                datasets: [{
                    label: selMonth,
                    data: [incES, totExpES],
                    backgroundColor: ['#059669', '#dc2626'],
                    borderRadius: 6
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
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

        const assignedCurrent = tx ? tx.assignedTo : 'Casal';
        const userNames = (state.users || []).map(u => u.name);
        const optionsList = ['Casal', ...userNames.filter(n => n !== 'Casal')];
        if (assignedCurrent && !optionsList.includes(assignedCurrent)) {
            optionsList.push(assignedCurrent);
        }
        const usersOptions = optionsList.map(name => 
            `<option value="${name}" ${assignedCurrent === name ? 'selected' : ''}>${name === 'Casal' ? '💑 Casal' : '👤 ' + name}</option>`
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
                        <select id="txAssigned" class="input-field">
                            ${usersOptions}
                        </select>
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
        if (state.settings.googleScriptUrl && !isDriveConnected) {
            showToast('⚠️ Aguarde a conexão com o Google Drive antes de salvar.', 'error');
            return;
        }
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
        if (state.settings.googleScriptUrl && !isDriveConnected) {
            showToast('⚠️ Aguarde a conexão com o Google Drive antes de excluir.', 'error');
            return;
        }
        if (confirm('⚠️ Deseja realmente excluir este lançamento?')) {
            state.transactions = state.transactions.filter(t => t.id !== id);
            saveState();
            refreshAllViews();
            showToast('🗑️ Lançamento removido.');
            syncToDrive();
        }
    };

    // ==================== EXPORTAÇÕES ====================
   const changeReportMonth = (ym) => {
    if (!ym) return;
    state.selectedMonth = ym;
    saveState();
    const reportContainer = el('reportContainer');
    if (reportContainer) {
        reportContainer.innerHTML = renderMonthlyReport();
    }
    const dashPicker = el('dashMonthPicker');
    if (dashPicker) dashPicker.value = ym;
};


    const exportToPDF = () => {
        const element = el('reportContainer');
        if (!element) return;
        const opt = {
            margin: 10,
            filename: `FinFam_Relatorio_${state.selectedMonth}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        html2pdf().set(opt).from(element).save();
    };

    // ==================== EXPORTAÇÃO EXCEL / CSV ORGANIZADO ====================
const exportToCSV = () => {
    const ym = state.selectedMonth || new Date().toISOString().slice(0, 7);

    // Normalização segura da data para o mês selecionado
    const getYearMonth = (dateStr) => {
        if (!dateStr) return '';
        const s = String(dateStr).trim();
        if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
        const brMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (brMatch) return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}`;
        try {
            const d = new Date(s);
            if (!isNaN(d.getTime())) return d.toISOString().slice(0, 7);
        } catch (e) {}
        return '';
    };

    const txs = (state.transactions || []).filter(t => {
        if (!t || !t.date) return false;
        return getYearMonth(t.date) === ym;
    }).sort((a, b) => (b.date > a.date ? 1 : -1));

    if (!txs.length) { 
        showToast('⚠️ Nenhum lançamento encontrado para exportar neste mês.', 'error'); 
        return; 
    }

    const [ano, mes] = ym.split('-');
    const nomeMes = new Date(parseInt(ano), parseInt(mes) - 1, 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

    // Cálculos de Totais
    const recES = txs.filter(t => (t.country || 'ES').toUpperCase() === 'ES' && (t.type || '').toLowerCase() === 'income')
                     .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const expES = txs.filter(t => (t.country || 'ES').toUpperCase() === 'ES' && (t.type || '').toLowerCase() === 'expense')
                     .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const invES = txs.filter(t => (t.country || 'ES').toUpperCase() === 'ES' && (t.type || '').toLowerCase() === 'investment')
                     .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const saldoES = recES - expES - invES;

    const recBR = txs.filter(t => (t.country || '').toUpperCase() === 'BR' && (t.type || '').toLowerCase() === 'income')
                     .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const expBR = txs.filter(t => (t.country || '').toUpperCase() === 'BR' && (t.type || '').toLowerCase() === 'expense')
                     .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const saldoBR = recBR - expBR;

    // Início da montagem do conteúdo (com instrução sep=; para o Excel)
    let csv = 'sep=;\n';

    // 1. CABEÇALHO DO RELATÓRIO
    csv += `RELATÓRIO FINANCEIRO FAMILIAR - FINFAM;;;;;\n`;
    csv += `Período:;${nomeMes.toUpperCase()};;;;\n`;
    csv += `Total de Lançamentos:;${txs.length};;;;\n\n`;

    // 2. RESUMO EXECUTIVO (CONSOLIDADO)
    csv += `--- RESUMO FINANCEIRO ---;;;;;\n`;
    csv += `Espanha (EUR);Receitas:;€ ${recES.toFixed(2).replace('.', ',')};Despesas:;€ ${expES.toFixed(2).replace('.', ',')};Saldo:;€ ${saldoES.toFixed(2).replace('.', ',')}\n`;
    csv += `Brasil (BRL);Receitas:;R$ ${recBR.toFixed(2).replace('.', ',')};Despesas:;R$ ${expBR.toFixed(2).replace('.', ',')};Saldo:;R$ ${saldoBR.toFixed(2).replace('.', ',')}\n\n`;

    // 3. TABELA DE DETALHAMENTO
    csv += `--- DETALHAMENTO DAS MOVIMENTAÇÕES ---;;;;;\n`;
    csv += `Data;Tipo;País;Categoria;Descrição;Responsável;Moeda;Valor Numérico\n`;

    txs.forEach(t => {
        const cat = (state.categories || []).find(c => c.id === t.categoryId)?.name || 'Geral';
        const typeStr = (t.type || '').toLowerCase();
        const tipo = typeStr === 'income' ? 'Receita' : typeStr === 'investment' ? 'Investimento' : 'Despesa';
        const pais = (t.country || 'ES').toUpperCase();
        const moeda = pais === 'BR' ? 'BRL' : 'EUR';
        
        // Número com sinal correto e formatado com vírgula para fórmulas do Excel
        const numValor = Number(t.amount || 0);
        const valorFormatado = (typeStr === 'expense' ? -numValor : numValor).toFixed(2).replace('.', ',');
        
        // Tratamento de aspas e textos limpos
        const desc = (t.description || '-').replace(/;/g, ',');
        const resp = (t.assignedTo || 'Casal').replace(/;/g, ',');

        csv += `${fmtDate(t.date)};${tipo};${pais};${cat};${desc};${resp};${moeda};${valorFormatado}\n`;
    });

    // Gera arquivo com BOM UTF-8 (mantém acentos como 'Salário', 'Mês', 'Espanha' intactos)
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `FinFam_Relatorio_${ym}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    showToast(`✅ Arquivo Excel gerado com sucesso! (${txs.length} registros)`);
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
            showLoading("Conectando ao Google Drive...");
            syncFromDrive(true).then(() => {
                console.log('✅ Sincronização automática concluída');
                console.log('📊 Total de transações:', state.transactions.length);
            }).catch(err => {
                console.warn('⚠️ Sincronização automática falhou:', err);
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
        syncFromDriveForce,
        syncToDrive,
        resetAllData,
        cleanGhostData,
        resetDriveData,
        showTransactionModal,
        closeModal,
        saveTransaction,
        deleteTransaction,
        changeReportMonth,
        exportToPDF,
        exportToCSV,
        addUser,
        deleteUser
    };
})();

document.addEventListener('DOMContentLoaded', App.init);
