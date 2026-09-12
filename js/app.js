// ============================================================
// FinFam - Controle Financeiro Familiar
// Arquivo: js/app.js (VERSÃO COMPLETA CORRIGIDA - BASE ORIGINAL)
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
    let isSyncing = false;
    const el = id => document.getElementById(id);

    // ==================== UTILITÁRIOS ====================
    // Normalizador seguro de datas (suporta DD/MM/AAAA, AAAA-MM-DD e objetos Date)
    const parseDateToYMD = (val) => {
        if (!val) return '';
        const s = String(val).trim();
        const brMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (brMatch) {
            return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`;
        }
        const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) {
            return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
        }
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
        if (ymd && ymd.length === 10) {
            const [y, m, day] = ymd.split('-');
            return `${day}/${m}/${y}`;
        }
        return String(d);
    };

    const fmtMoney = (v, currency) => {
        if (state.privacyMode) return '***';
        const n = Number(v);
        const safe = Number.isFinite(n) ? n : 0;
        return `${currency || '€'} ${safe.toFixed(2).replace('.', ',')}`;
    };

    const generateId = () => {
        return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    };

    const showToast = (message, type = 'success') => {
        const toast = el('toast');
        if (!toast) return;
        toast.className = `toast ${type} show`;
        toast.textContent = message;
        setTimeout(() => toast.className = 'toast', 3500);
    };

    const hashPassword = async (pwd) => {
        const enc = new TextEncoder().encode(pwd);
        const hash = await crypto.subtle.digest('SHA-256', enc);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    };

    // Overlay e barra de progresso da conexão com o Banco de Dados
    const showConnectionOverlay = (text = 'Conectando ao banco de dados...') => {
        let ov = el('finfamConnectionOverlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'finfamConnectionOverlay';
            ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(15,23,42,0.85);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;backdrop-filter:blur(4px);';
            ov.innerHTML = `
                <div style="background:#1e293b;padding:32px 36px;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,0.5);text-align:center;max-width:380px;width:90%;border:1px solid rgba(255,255,255,0.1)">
                    <div style="width:40px;height:40px;border:3px solid #38bdf8;border-top-color:transparent;border-radius:50%;animation:finfamSpin 1s linear infinite;margin:0 auto 16px;"></div>
                    <div id="finfamOverlayText" style="font-size:16px;font-weight:600;margin-bottom:12px;color:#f8fafc">Conectando ao banco de dados...</div>
                    <div style="background:#334155;border-radius:10px;height:8px;width:100%;overflow:hidden;margin-top:14px;">
                        <div id="finfamOverlayBar" style="background:linear-gradient(90deg,#0ea5e9,#10b981);height:100%;width:70%;border-radius:10px;animation:finfamPulse 1.5s ease-in-out infinite;"></div>
                    </div>
                    <div style="font-size:12px;color:#94a3b8;margin-top:14px;">Por favor, aguarde o carregamento seguro.</div>
                </div>
                <style>
                    @keyframes finfamSpin { to { transform: rotate(360deg); } }
                    @keyframes finfamPulse { 0%,100% { opacity:0.6; transform:translateX(-10%); } 50% { opacity:1; transform:translateX(10%); } }
                </style>
            `;
            document.body.appendChild(ov);
        }
        const txt = el('finfamOverlayText');
        if (txt) txt.textContent = text;
        ov.style.display = 'flex';
    };

    const hideConnectionOverlay = () => {
        const ov = el('finfamConnectionOverlay');
        if (ov) ov.style.display = 'none';
    };

    // ==================== CATEGORIAS ====================
    const defaultCategories = [
        { id: 'cat_salario', name: 'Salário / Emprego', type: 'income', icon: '💼' },
        { id: 'cat_freelance', name: 'Freelance / Extras', type: 'income', icon: '💻' },
        { id: 'cat_rendimentos', name: 'Rendimentos & Dividendos', type: 'income', icon: '💰' },
        { id: 'cat_receita_aluguel', name: 'Receita de Aluguel', type: 'income', icon: '🏠' },
        { id: 'cat_outras_receitas', name: 'Outras Receitas', type: 'income', icon: '💶' },
        
        { id: 'cat_investimento', name: 'Investimentos & Aplicações', type: 'investment', icon: '📈' },
        
        { id: 'cat_aluguel', name: 'Aluguel / Moradia', type: 'expense', icon: '🔑' },
        { id: 'cat_hipoteca', name: 'Hipoteca / Financiamento', type: 'expense', icon: '🏛️' },
        { id: 'cat_mercado', name: 'Mercado / Alimentação', type: 'expense', icon: '🛒' },
        { id: 'cat_agua', name: 'Água', type: 'expense', icon: '💧' },
        { id: 'cat_luz', name: 'Energia / Luz', type: 'expense', icon: '⚡' },
        { id: 'cat_gas', name: 'Gás', type: 'expense', icon: '🔥' },
        { id: 'cat_escola', name: 'Educação / Escola', type: 'expense', icon: '🎒' },
        { id: 'cat_veiculo', name: 'Transporte / Veículo', type: 'expense', icon: '🚗' },
        { id: 'cat_lazer', name: 'Lazer & Família', type: 'expense', icon: '🎬' },
        { id: 'cat_cartao', name: 'Cartão de Crédito', type: 'expense', icon: '💳' },
        { id: 'cat_outros', name: 'Outras Despesas', type: 'expense', icon: '📋' }
    ];

    const categoryAliasMap = {
        'cat_salario_es': 'cat_salario',
        'cat_freelance_es': 'cat_freelance',
        'cat_outras_entradas_es': 'cat_outras_receitas',
        'cat_aluguel_br': 'cat_receita_aluguel',
        'cat_invest_es': 'cat_investimento',
        'cat_invest_br': 'cat_investimento',
        'cat_aluguel_es': 'cat_aluguel',
        'cat_hipoteca_es': 'cat_hipoteca',
        'cat_outros_es': 'cat_outros',
        'cat_cc_br': 'cat_cartao',
        'cat_outros_br': 'cat_outros'
    };

    const getCategoryById = (catId) => {
        if (!catId) return { name: 'Geral', icon: '📋', type: 'expense' };
        const mapped = categoryAliasMap[catId] || catId;
        return state.categories.find(c => c.id === mapped || c.id === catId) || { name: 'Geral', icon: '📋', type: 'expense' };
    };

    // ==================== GOOGLE DRIVE ====================
    const syncToDrive = async () => {
        const url = state.settings.googleScriptUrl;
        if (!url) return;
        
        try {
            console.log('📤 Enviando dados para o Drive...');
            
            const payload = {
                action: 'save',
                token: state.settings.apiToken || DEFAULT_TOKEN,
                data: {
                    transactions: state.transactions,
                    users: state.users,
                    categories: state.categories,
                    settings: state.settings,
                    lastSync: new Date().toISOString()
                }
            };
            
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });
            
            const data = await res.json();
            console.log('📤 Resposta do Drive:', data);
            
            if (data.status === 'success') {
                isDriveConnected = true;
                showToast('☁️ Banco de Dados atualizado com sucesso!');
            } else {
                showToast(data.message || '⚠️ Erro ao salvar no Banco de Dados.', 'error');
            }
        } catch (e) {
            console.error('❌ Erro no syncToDrive:', e);
            showToast('⚠️ Erro de rede ao conectar com o Banco de Dados.', 'error');
        }
    };

    // ============================================================
    // syncFromDrive - VERSÃO COMPLETA CORRIGIDA
    // ============================================================
    const syncFromDrive = async (silent = false) => {
        const url = state.settings.googleScriptUrl;
        if (!url) {
            if (!silent) showToast('⚠️ URL do Google Drive não configurada.', 'error');
            return;
        }
        
        try {
            isSyncing = true;
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
                
                // NORMALIZAÇÃO COMPLETA COM SUPORTE A DD/MM/AAAA
                const normalized = data.transactions.map(t => {
                    const rawDate = t.date || t.Data || '';
                    const normalizedDate = parseDateToYMD(rawDate) || new Date().toISOString().slice(0, 10);
                    const rawCat = t.categoryId || t.CategoriaID || 'cat_outros';
                    const categoryId = categoryAliasMap[rawCat] || rawCat;
                    
                    return {
                        id: String(t.id || t.ID || generateId()),
                        date: normalizedDate,
                        type: t.type || t.Tipo || 'expense',
                        categoryId: categoryId,
                        description: t.description || t.Descrição || '',
                        assignedTo: t.assignedTo || t.Responsável || 'Casal',
                        country: t.country || t.País || 'ES',
                        amount: Number(t.amount || t.Valor) || 0
                    };
                });
                
                // Merge seguro: preserva lançamentos locais recém-adicionados que ainda não subiram ao Drive
                const driveMap = new Map(normalized.map(t => [String(t.id), t]));
                const localPending = (state.transactions || []).filter(lt => !driveMap.has(String(lt.id)));
                
                state.transactions = [...normalized, ...localPending];
                isDriveConnected = true;
                hideConnectionOverlay();
                saveState();
                refreshAllViews();
                
                const monthPicker = el('dashMonthPicker');
                if (monthPicker) monthPicker.value = state.selectedMonth;
                
                if (!silent) {
                    showToast(`✅ ${normalized.length} registros sincronizados do Drive!`);
                }
                
                console.log(`📊 ${state.transactions.length} registros totais após sincronização`);
                
            } else {
                hideConnectionOverlay();
                if (!silent) showToast(data.message || '❌ Erro ao consultar o Banco de Dados.', 'error');
            }
        } catch (e) {
            hideConnectionOverlay();
            if (!silent) showToast('❌ Erro ao consultar o Banco de Dados.', 'error');
            console.error('❌ Sync error:', e);
        } finally {
            isSyncing = false;
        }
    };

    // ============================================================
    // syncFromDriveForce - FORÇA SUBSTITUIÇÃO
    // ============================================================
    const syncFromDriveForce = async () => {
        const url = state.settings.googleScriptUrl;
        if (!url) {
            showToast('⚠️ Configure a URL do Google Apps Script nas Configurações.', 'error');
            return;
        }
        
        if (!confirm('⚠️ ATENÇÃO: Isso vai APAGAR todos os dados locais e carregar EXATAMENTE o que está na planilha do Google Drive. Deseja continuar?')) {
            return;
        }
        
        try {
            showToast('🔄 Baixando dados da planilha...', 'info');
            
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
                state.transactions = data.transactions.map(t => ({
                    id: String(t.id || t.ID || generateId()),
                    date: parseDateToYMD(t.date || t.Data) || new Date().toISOString().slice(0, 10),
                    type: t.type || t.Tipo || 'expense',
                    categoryId: categoryAliasMap[t.categoryId || t.CategoriaID] || (t.categoryId || t.CategoriaID || 'cat_outros'),
                    description: t.description || t.Descrição || '',
                    assignedTo: t.assignedTo || t.Responsável || 'Casal',
                    country: t.country || t.País || 'ES',
                    amount: Number(t.amount || t.Valor) || 0
                }));
                
                isDriveConnected = true;
                saveState();
                refreshAllViews();
                
                showToast(`✅ ${state.transactions.length} registros carregados da planilha!`);
            } else {
                showToast(data.message || '❌ Erro ao carregar dados.', 'error');
            }
        } catch (e) {
            showToast('❌ Erro de conexão com o Drive.', 'error');
            console.error(e);
        }
    };

    // ============================================================
    // checkConnection - TESTE DE CONEXÃO
    // ============================================================
    const checkConnection = async () => {
        const statusEl = el('connectionStatus');
        const url = state.settings.googleScriptUrl;
        
        if (!statusEl) return;
        
        if (!url) {
            statusEl.innerHTML = '<span class="badge badge-warning">⚠️ Não configurado</span>';
            return;
        }
        
        statusEl.innerHTML = '<span class="badge badge-info">🔄 Testando...</span>';
        
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ 
                    action: 'test', 
                    token: state.settings.apiToken || DEFAULT_TOKEN 
                })
            });
            
            const data = await res.json();
            
            if (data.status === 'success') {
                isDriveConnected = true;
                statusEl.innerHTML = '<span class="badge badge-success">✅ Conectado ao Google Drive</span>';
            } else {
                statusEl.innerHTML = `<span class="badge badge-danger">❌ ${data.message || 'Erro de autenticação'}</span>`;
            }
        } catch (e) {
            statusEl.innerHTML = '<span class="badge badge-danger">❌ Erro de rede</span>';
        }
    };

    // ==================== GESTÃO DE ESTADO ====================
    const loadState = () => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                state.users = parsed.users || [];
                state.transactions = parsed.transactions || [];
                state.categories = parsed.categories || defaultCategories;
                state.settings = { ...state.settings, ...(parsed.settings || {}) };
            } else {
                state.categories = defaultCategories;
            }
        } catch (e) {
            console.error('Erro ao carregar dados:', e);
            state.categories = defaultCategories;
        }
    };

    const saveState = () => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                users: state.users,
                transactions: state.transactions,
                categories: state.categories,
                settings: state.settings
            }));
        } catch (e) {
            console.error('Erro ao salvar localmente:', e);
        }
    };

    const refreshAllViews = () => {
        const dash = el('dashboard');
        const txs = el('transactions');
        const rep = el('reports');
        const dashPicker = el('dashMonthPicker');
        const repPicker = el('reportMonthPicker');

        if (dash && dash.classList.contains('active')) {
            dash.innerHTML = renderDashboard();
            setTimeout(initDashboardCharts, 50);
        }
        
        if (txs && txs.classList.contains('active')) {
            const txTable = el('transactionsTable');
            if (txTable) txTable.innerHTML = renderTransactionsTable();
        }
        
        if (rep && rep.classList.contains('active')) {
            const reportContainer = el('reportContainer');
            if (reportContainer) {
                reportContainer.innerHTML = renderMonthlyReport();
            }
        }

        if (dashPicker) dashPicker.value = state.selectedMonth;
        if (repPicker) repPicker.value = state.selectedMonth;
    };

    // ==================== AUTENTICAÇÃO ====================
    const checkSession = () => {
        try {
            const sess = sessionStorage.getItem(SESSION_KEY);
            if (sess) {
                const parsed = JSON.parse(sess);
                if (parsed.expiry > Date.now()) {
                    state.currentUser = parsed.user;
                    state.sessionExpiry = parsed.expiry;
                    resetInactivityTimer();
                    return true;
                }
            }
        } catch (e) {}
        return false;
    };

    const startSession = (user) => {
        state.currentUser = user;
        state.sessionExpiry = Date.now() + INACTIVITY_TIMEOUT;
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            user: { id: user.id, name: user.name, email: user.email, role: user.role },
            expiry: state.sessionExpiry
        }));
        resetInactivityTimer();
    };

    const resetInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
            showToast('⚠️ Sessão expirada por inatividade.', 'error');
            logout();
        }, INACTIVITY_TIMEOUT);
    };

    const logout = () => {
        state.currentUser = null;
        state.sessionExpiry = null;
        sessionStorage.removeItem(SESSION_KEY);
        if (inactivityTimer) clearTimeout(inactivityTimer);
        renderLogin();
    };

    // ==================== FILTROS ====================
    const getSelectedMonthData = () => {
        const ym = state.selectedMonth;
        
        const txs = state.transactions.filter(t => {
            if (!t || !t.date) return false;
            return getYearMonth(t.date) === ym;
        }).sort((a, b) => {
            const da = parseDateToYMD(a.date);
            const db = parseDateToYMD(b.date);
            return db.localeCompare(da);
        });

        const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const investment = txs.filter(t => t.type === 'investment').reduce((s, t) => s + (Number(t.amount) || 0), 0);
        
        const balance = income - expense - investment;
        const savingsRate = income > 0 ? (((income - expense) / income) * 100) : 0;

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

    const togglePrivacy = () => {
        state.privacyMode = !state.privacyMode;
        refreshAllViews();
    };

    // ==================== LIMPEZA DE DADOS FANTASMAS ====================
    const cleanGhostData = async () => {
        if (!confirm('⚠️ ATENÇÃO: Esta ação vai remover todos os registros com valores inválidos (NaN, null, undefined) ou categorias inexistentes.\n\nDeseja continuar?')) {
            return;
        }

        const initialCount = state.transactions.length;
        
        const validCategories = new Set(state.categories.map(c => c.id));
        validCategories.add('cat_outros_es');
        validCategories.add('cat_outros_br');
        validCategories.add('cat_outros');

        state.transactions = state.transactions.filter(t => {
            if (!t) return false;
            if (!t.date || t.date === 'NaN' || t.date === 'undefined') return false;
            
            const amt = Number(t.amount);
            if (isNaN(amt) || amt <= 0) return false;
            
            if (!t.categoryId) return false;
            
            return true;
        });

        const removedCount = initialCount - state.transactions.length;

        saveState();
        refreshAllViews();

        if (state.settings.googleScriptUrl) {
            showToast('☁️ Atualizando banco de dados no Drive...', 'info');
            await syncToDrive();
        }

        showToast(`✅ Limpeza concluída! ${removedCount} registros inválidos removidos.`);
        
        setTimeout(() => {
            const settingsPage = el('settings');
            if (settingsPage) settingsPage.innerHTML = renderSettings();
        }, 500);
    };

    // ==================== RESETAR DADOS DO DRIVE ====================
    const resetDriveData = async () => {
        if (!confirm('🚨 ATENÇÃO MÁXIMA!\n\nIsso vai APAGAR COMPLETAMENTE a planilha do Google Drive e substituir pelos dados locais atuais.\n\nTem certeza absoluta?')) {
            return;
        }

        const pwd = prompt('Digite a senha de administrador para confirmar:');
        if (pwd !== 'FinFam2026') {
            showToast('❌ Senha incorreta.', 'error');
            return;
        }

        showToast('🔄 Limpando e recriando banco no Drive...', 'info');
        await syncToDrive();
        showToast('✅ Banco de dados resetado com sucesso!');
    };

    // ==================== GERENCIAMENTO DE USUÁRIOS ====================
    const renderUserManagementModal = () => {
        const overlay = el('modalOverlay');
        if (!overlay) return;

        const usersList = state.users.map(u => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;border-bottom:1px solid var(--border)">
                <div>
                    <strong>${u.name}</strong> (${u.email})
                    <br><small style="color:var(--text-light)">Perfil: ${u.role === 'admin' ? 'Administrador' : 'Membro'}</small>
                </div>
                ${u.id !== state.currentUser?.id ? `
                    <button class="btn-danger" style="padding:4px 8px;font-size:12px" onclick="App.deleteUser('${u.id}')">Excluir</button>
                ` : '<span class="badge badge-info">Você</span>'}
            </div>
        `).join('');

        el('modalContent').innerHTML = `
            <div class="modal-header">
                <h3 class="modal-title">👥 Gerenciar Usuários</h3>
                <button class="close-btn" onclick="App.closeModal()">&times;</button>
            </div>
            <div style="margin-bottom:20px;max-height:200px;overflow-y:auto">
                ${usersList || '<p style="color:var(--text-light)">Nenhum outro usuário cadastrado.</p>'}
            </div>
            <hr style="border:none;border-top:1px solid var(--border);margin:20px 0">
            <h4 style="margin:0 0 12px;color:var(--navy)">Cadastrar Novo Usuário</h4>
            <form onsubmit="event.preventDefault(); App.addUser();">
                <div class="form-group">
                    <label class="form-label">Nome Completo</label>
                    <input type="text" id="newUserName" class="input-field" required>
                </div>
                <div class="form-group">
                    <label class="form-label">E-mail</label>
                    <input type="email" id="newUserEmail" class="input-field" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Perfil</label>
                    <select id="newUserRole" class="input-field">
                        <option value="member">Membro da Família</option>
                        <option value="admin">Administrador</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Senha Provisória</label>
                    <input type="password" id="newUserPassword" class="input-field" required minlength="6">
                </div>
                <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:20px">
                    <button type="button" class="btn-secondary" onclick="App.closeModal()">Fechar</button>
                    <button type="submit" class="btn-primary">Adicionar Usuário</button>
                </div>
            </form>
        `;

        overlay.classList.add('active');
        overlay.style.display = 'flex';
    };

    const addUser = async () => {
        const name = el('newUserName').value.trim();
        const email = el('newUserEmail').value.trim().toLowerCase();
        const role = el('newUserRole').value;
        const pwd = el('newUserPassword').value;

        if (!name || !email || !pwd) {
            showToast('⚠️ Preencha todos os campos.', 'error');
            return;
        }

        if (state.users.some(u => u.email === email)) {
            showToast('⚠️ Este e-mail já está cadastrado.', 'error');
            return;
        }

        const passwordHash = await hashPassword(pwd);
        state.users.push({
            id: generateId(),
            name,
            email,
            role,
            passwordHash,
            createdAt: new Date().toISOString()
        });

        saveState();
        showToast(`✅ Usuário ${name} cadastrado com sucesso!`);
        renderUserManagementModal();
        syncToDrive();
    };

    const deleteUser = (userId) => {
        if (!confirm('Deseja realmente remover este usuário?')) return;
        state.users = state.users.filter(u => u.id !== userId);
        saveState();
        showToast('🗑️ Usuário removido.');
        renderUserManagementModal();
        syncToDrive();
    };

    // ==================== TELAS DE AUTENTICAÇÃO ====================
    const renderLogin = () => {
        el('app').innerHTML = `
            <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a5f 0%,#2c5282 50%,#059669 100%)">
                <div style="background:#fff;border-radius:20px;padding:40px;width:90%;max-width:400px;box-shadow:0 25px 80px rgba(0,0,0,.3)">
                    <div style="text-align:center;margin-bottom:30px">
                        <div style="width:60px;height:60px;background:var(--navy);border-radius:16px;display:inline-flex;align-items:center;justify-content:center;font-size:30px;color:#fff;margin-bottom:12px">💶</div>
                        <h2 style="margin:0;color:var(--navy);font-size:24px">FinFam</h2>
                        <p style="margin:6px 0 0;color:var(--text-light);font-size:14px">Controle Financeiro Familiar</p>
                    </div>
                    <form onsubmit="event.preventDefault(); App.handleLogin();">
                        <div class="form-group">
                            <label class="form-label">E-mail</label>
                            <input type="email" id="loginEmail" class="input-field" placeholder="seu@email.com" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Senha</label>
                            <input type="password" id="loginPassword" class="input-field" placeholder="••••••••" required>
                        </div>
                        <button type="submit" class="btn-primary" style="width:100%;padding:14px;font-size:15px;margin-top:10px">Entrar</button>
                    </form>
                    <div style="text-align:center;margin-top:20px;display:flex;flex-direction:column;gap:8px">
                        <a href="javascript:void(0)" onclick="App.renderForgotPassword()" style="color:var(--navy-light);font-size:13px;text-decoration:none">Esqueceu a senha?</a>
                        ${state.users.length === 0 ? `<a href="javascript:void(0)" onclick="App.renderRegisterFirstUser()" style="color:var(--emerald);font-size:13px;font-weight:600;text-decoration:none">Cadastrar Primeiro Administrador</a>` : ''}
                    </div>
                </div>
            </div>
        `;
    };

    const renderRegisterFirstUser = () => {
        el('app').innerHTML = `
            <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a5f 0%,#2c5282 50%,#059669 100%)">
                <div style="background:#fff;border-radius:20px;padding:40px;width:90%;max-width:400px;box-shadow:0 25px 80px rgba(0,0,0,.3)">
                    <div style="text-align:center;margin-bottom:24px">
                        <h2 style="margin:0;color:var(--navy);font-size:22px">Criar Conta Mestre</h2>
                        <p style="margin:6px 0 0;color:var(--text-light);font-size:13px">Primeiro acesso da família</p>
                    </div>
                    <form onsubmit="event.preventDefault(); App.handleRegisterFirstUser();">
                        <div class="form-group">
                            <label class="form-label">Nome Completo</label>
                            <input type="text" id="regName" class="input-field" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">E-mail</label>
                            <input type="email" id="regEmail" class="input-field" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Senha Mestre</label>
                            <input type="password" id="regPassword" class="input-field" required minlength="6">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Pergunta de Segurança</label>
                            <select id="regQuestion" class="input-field">
                                <option value="pet">Nome do primeiro animal de estimação</option>
                                <option value="city">Cidade onde os pais se conheceram</option>
                                <option value="car">Marca do seu primeiro carro</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Resposta da Segurança</label>
                            <input type="text" id="regAnswer" class="input-field" required>
                        </div>
                        <button type="submit" class="btn-primary" style="width:100%;padding:14px;margin-top:10px">Finalizar Cadastro</button>
                    </form>
                    <div style="text-align:center;margin-top:16px">
                        <a href="javascript:void(0)" onclick="App.renderLogin()" style="color:var(--slate);font-size:13px">Voltar para o Login</a>
                    </div>
                </div>
            </div>
        `;
    };

    const renderForgotPassword = () => {
        el('app').innerHTML = `
            <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a5f 0%,#2c5282 50%,#059669 100%)">
                <div style="background:#fff;border-radius:20px;padding:40px;width:90%;max-width:400px;box-shadow:0 25px 80px rgba(0,0,0,.3)">
                    <div style="text-align:center;margin-bottom:24px">
                        <h2 style="margin:0;color:var(--navy);font-size:22px">Recuperar Senha</h2>
                        <p style="margin:6px 0 0;color:var(--text-light);font-size:13px">Confirme os dados cadastrados</p>
                    </div>
                    <form onsubmit="event.preventDefault(); App.handleForgotPassword();">
                        <div class="form-group">
                            <label class="form-label">Seu E-mail Cadastrado</label>
                            <input type="email" id="recEmail" class="input-field" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Resposta da Pergunta Secreta</label>
                            <input type="text" id="recAnswer" class="input-field" placeholder="Resposta cadastrada" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Nova Senha</label>
                            <input type="password" id="recNewPassword" class="input-field" required minlength="6">
                        </div>
                        <button type="submit" class="btn-primary" style="width:100%;padding:14px;margin-top:10px">Redefinir Senha</button>
                    </form>
                    <div style="text-align:center;margin-top:16px">
                        <a href="javascript:void(0)" onclick="App.renderLogin()" style="color:var(--slate);font-size:13px">Voltar para o Login</a>
                    </div>
                </div>
            </div>
        `;
    };

    const handleLogin = async () => {
        const email = el('loginEmail').value.trim().toLowerCase();
        const pwd = el('loginPassword').value;
        const hash = await hashPassword(pwd);

        const user = state.users.find(u => u.email === email && u.passwordHash === hash);
        if (user) {
            startSession(user);
            renderApp();
            showToast(`👋 Bem-vindo(a), ${user.name}!`);
            
            if (state.settings.googleScriptUrl) {
                showConnectionOverlay('Conectando ao banco de dados...');
                syncFromDrive(true).then(() => {
                    hideConnectionOverlay();
                    refreshAllViews();
                }).catch(() => {
                    hideConnectionOverlay();
                });
            } else {
                isDriveConnected = true;
            }
        } else {
            showToast('❌ E-mail ou senha inválidos.', 'error');
        }
    };

    const handleRegisterFirstUser = async () => {
        const name = el('regName').value.trim();
        const email = el('regEmail').value.trim().toLowerCase();
        const pwd = el('regPassword').value;
        const question = el('regQuestion').value;
        const answer = el('regAnswer').value.trim().toLowerCase();

        const passwordHash = await hashPassword(pwd);
        const user = {
            id: generateId(),
            name,
            email,
            role: 'admin',
            passwordHash,
            securityQuestion: question,
            securityAnswer: answer,
            createdAt: new Date().toISOString()
        };

        state.users.push(user);
        saveState();
        startSession(user);
        renderApp();
        showToast('🎉 Administrador configurado com sucesso!');
        syncToDrive();
    };

    const handleForgotPassword = async () => {
        const email = el('recEmail').value.trim().toLowerCase();
        const answer = el('recAnswer').value.trim().toLowerCase();
        const newPwd = el('recNewPassword').value;

        const user = state.users.find(u => u.email === email);
        if (user && user.securityAnswer === answer) {
            user.passwordHash = await hashPassword(newPwd);
            saveState();
            showToast('✅ Senha redefinida com sucesso! Faça login.');
            renderLogin();
            syncToDrive();
        } else {
            showToast('❌ Dados incorretos. Não foi possível redefinir.', 'error');
        }
    };

    const nav = (element) => {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        element.classList.add('active');
        const targetPage = element.getAttribute('data-page');
        const p = el(targetPage);
        if (p) p.classList.add('active');
        
        if (targetPage === 'dashboard') {
            // Mantém os dados da sessão sem reconectar repetidamente
        } else if (targetPage === 'settings') {
            checkConnection();
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
    // ==================== RENDER DASHBOARD ====================
    const renderDashboard = () => {
        const m = getSelectedMonthData();

        const expByCategory = {};
        m.txs.filter(t => t.type === 'expense').forEach(t => {
            const catName = getCategoryById(t.categoryId).name;
            expByCategory[catName] = (expByCategory[catName] || 0) + (Number(t.amount) || 0);
        });
        const sortedCats = Object.entries(expByCategory).sort((a, b) => b[1] - a[1]);

        return `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px">
            <div>
                <h2 style="margin:0;font-size:22px;color:var(--navy)">Visão Geral do Mês</h2>
                <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Acompanhamento consolidado da família</p>
            </div>
            <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
                <input type="month" id="dashMonthPicker" class="input-field" style="width:auto;font-weight:600" value="${state.selectedMonth}" onchange="App.changeSelectedMonth(this.value)">
                <button class="btn-primary" onclick="App.showTransactionModal(null)">+ Novo Lançamento</button>
            </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px">
            <div class="card stat-card" style="border-left:4px solid var(--emerald)">
                <div class="stat-label">Receitas</div>
                <div class="stat-value emerald-text">${fmtMoney(m.income, state.settings.currencyES)}</div>
            </div>
            <div class="card stat-card" style="border-left:4px solid var(--danger)">
                <div class="stat-label">Despesas</div>
                <div class="stat-value danger-text">${fmtMoney(m.expense, state.settings.currencyES)}</div>
            </div>
            <div class="card stat-card" style="border-left:4px solid #8b5cf6">
                <div class="stat-label">Investimentos</div>
                <div class="stat-value" style="color:#8b5cf6">${fmtMoney(m.investment, state.settings.currencyES)}</div>
            </div>
            <div class="card stat-card" style="border-left:4px solid ${m.balance >= 0 ? 'var(--emerald)' : 'var(--danger)'}">
                <div class="stat-label">Saldo do Mês</div>
                <div class="stat-value" style="color:${m.balance >= 0 ? 'var(--emerald)' : 'var(--danger)'}">${fmtMoney(m.balance, state.settings.currencyES)}</div>
            </div>
        </div>

        <div class="card net-worth-card" style="padding:24px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px">
            <div>
                <div style="font-size:14px;font-weight:600;color:#b45309;text-transform:uppercase;letter-spacing:1px">Patrimônio Líquido Acumulado</div>
                <div class="net-worth-value">${fmtMoney(m.netWorth, state.settings.currencyES)}</div>
                <small style="color:#92400e">Taxa de Poupança do Mês: <strong>${m.savingsRate.toFixed(1)}%</strong></small>
            </div>
            <div style="text-align:right">
                <span class="badge" style="background:#fef3c7;color:#92400e;padding:8px 14px;font-size:13px">Consolidado Geral</span>
            </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
            <div class="card" style="padding:20px">
                <h4 style="margin:0 0 16px;color:var(--navy)">Despesas por Categoria</h4>
                ${sortedCats.length === 0 ? '<div class="empty-state" style="padding:30px"><p>Sem despesas registradas.</p></div>' : `
                    <div style="display:flex;flex-direction:column;gap:12px">
                        ${sortedCats.slice(0, 5).map(([c, val]) => {
                            const pct = m.expense > 0 ? ((val / m.expense) * 100).toFixed(0) : 0;
                            return `
                                <div>
                                    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
                                        <span style="font-weight:600">${c}</span>
                                        <span style="color:var(--text-light)">${fmtMoney(val, state.settings.currencyES)} (${pct}%)</span>
                                    </div>
                                    <div style="background:#e2e8f0;border-radius:10px;height:8px;overflow:hidden">
                                        <div style="background:var(--navy);height:100%;width:${pct}%;border-radius:10px"></div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `}
            </div>
            <div class="card" style="padding:20px">
                <h4 style="margin:0 0 16px;color:var(--navy)">Distribuição Gráfica</h4>
                <div style="position:relative;height:200px">
                    <canvas id="categoryChart"></canvas>
                </div>
            </div>
        </div>

        <div class="card" style="padding:20px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h4 style="margin:0;color:var(--navy)">Últimos Lançamentos</h4>
                <a href="javascript:void(0)" onclick="App.nav(document.querySelector('[data-page=transactions]'))" style="font-size:13px;color:var(--navy-light);font-weight:600;text-decoration:none">Ver todos &rarr;</a>
            </div>
            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th>Responsável</th><th>País</th><th>Valor</th></tr></thead>
                    <tbody>
                        ${m.txs.slice(0, 5).map(t => {
                            const cat = getCategoryById(t.categoryId);
                            const isBR = t.country === 'BR';
                            return `<tr>
                                <td>${fmtDate(t.date)}</td>
                                <td><span class="badge ${t.type === 'income' ? 'badge-success' : t.type === 'investment' ? 'badge-purple' : 'badge-danger'}">${t.type === 'income' ? 'Receita' : t.type === 'investment' ? 'Investimento' : 'Despesa'}</span></td>
                                <td>${cat.icon} ${cat.name}</td>
                                <td>${t.description || '-'}</td>
                                <td>${t.assignedTo || 'Casal'}</td>
                                <td>${isBR ? '🇧🇷 BR' : '🇪🇸 ES'}</td>
                                <td style="font-weight:600">${fmtMoney(t.amount, isBR ? state.settings.currencyBR : state.settings.currencyES)}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    };

    const initDashboardCharts = () => {
        const m = getSelectedMonthData();
        const ctx = el('categoryChart');
        if (!ctx) return;

        const expByCategory = {};
        m.txs.filter(t => t.type === 'expense').forEach(t => {
            const catName = getCategoryById(t.categoryId).name;
            expByCategory[catName] = (expByCategory[catName] || 0) + (Number(t.amount) || 0);
        });

        const labels = Object.keys(expByCategory);
        const data = Object.values(expByCategory);

        if (window.finfamChart) window.finfamChart.destroy();

        if (labels.length === 0) {
            ctx.style.display = 'none';
            return;
        }
        ctx.style.display = 'block';

        window.finfamChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: ['#1e3a5f', '#059669', '#d97706', '#dc2626', '#8b5cf6', '#64748b', '#0284c7']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } }
            }
        });
    };

    // ==================== RENDER TRANSAÇÕES ====================
    const renderTransactionRow = (t) => {
        const cat = getCategoryById(t.categoryId);
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
            <button class="btn-primary" onclick="App.showTransactionModal(null)">+ Novo Lançamento</button>
        </div>
        <div class="card" style="padding:20px">
            <div id="transactionsTable">${renderTransactionsTable()}</div>
        </div>`;
    };

    const renderTransactionsTable = () => {
        const txs = state.transactions.slice().sort((a, b) => {
            const da = parseDateToYMD(a.date);
            const db = parseDateToYMD(b.date);
            return db.localeCompare(da);
        });
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
        
        const monthOptions = [];
        for (let i = 0; i < 12; i++) {
            const d = new Date(parseInt(year), parseInt(month) - 1 - i, 1);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const label = d.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
            monthOptions.push({ value: `${y}-${m}`, label: label });
        }
        
        // Dados do mês selecionado com normalização segura
        const monthTxs = state.transactions.filter(t => {
            if (!t || !t.date) return false;
            return getYearMonth(t.date) === ym;
        }).sort((a, b) => {
            const da = parseDateToYMD(a.date);
            const db = parseDateToYMD(b.date);
            return db.localeCompare(da);
        });
        
        const monthIncome = monthTxs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
        const monthExpense = monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
        const monthInvestment = monthTxs.filter(t => t.type === 'investment').reduce((s, t) => s + Number(t.amount), 0);
        const monthBalance = monthIncome - monthExpense - monthInvestment;
        
        // Dados acumulados do ano com normalização segura
        const yearTxs = state.transactions.filter(t => {
            if (!t || !t.date) return false;
            const ymd = parseDateToYMD(t.date);
            return ymd && ymd.startsWith(`${year}-`);
        });
        
        const yearIncome = yearTxs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
        const yearExpense = yearTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
        const yearInvestment = yearTxs.filter(t => t.type === 'investment').reduce((s, t) => s + Number(t.amount), 0);
        const yearBalance = yearIncome - yearExpense - yearInvestment;

        const totalInvestments = state.transactions
            .filter(t => t.type === 'investment')
            .reduce((s, t) => s + Number(t.amount), 0);
        const totalBalance = state.transactions
            .filter(t => t.type === 'income')
            .reduce((s, t) => s + Number(t.amount), 0) -
            state.transactions.filter(t => t.type === 'expense')
            .reduce((s, t) => s + Number(t.amount), 0);
        const netWorth = totalBalance + totalInvestments;

        const monthSelectOptions = monthOptions.map(m => 
            `<option value="${m.value}" ${m.value === ym ? 'selected' : ''}>${m.label}</option>`
        ).join('');

        return `
        <div class="card no-print" style="padding:20px;margin-bottom:24px">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
                <div>
                    <h3 style="margin:0;color:var(--navy)">📊 Relatório Mensal</h3>
                    <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">${monthTxs.length} lançamentos no período</p>
                </div>
                <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
                    <select id="reportMonthPicker" class="input-field" style="padding:8px 12px;font-weight:600;width:auto;min-width:150px;" onchange="App.changeReportMonth(this.value)">
                        ${monthSelectOptions}
                    </select>
                    <button class="btn-primary" style="background:#dc2626" onclick="App.exportToPDF()">📄 PDF</button>
                    <button class="btn-primary" style="background:#10b981" onclick="App.exportToCSV()">📊 CSV</button>
                </div>
            </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;margin-bottom:24px">
            <div class="card" style="padding:20px">
                <h4 style="margin:0 0 16px;color:var(--navy);border-bottom:2px solid var(--border);padding-bottom:8px">📆 Mês: ${monthName} ${year}</h4>
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

        <div class="card" style="padding:20px">
            <h4 style="margin:0 0 16px;color:var(--navy)">📋 Lançamentos do Mês</h4>
            ${monthTxs.length === 0 ? '<div class="empty-state"><p>Nenhum lançamento neste mês.</p></div>' : `
            <div class="table-container">
                <table class="data-table">
                    <thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th>Responsável</th><th>País</th><th>Valor</th></tr></thead>
                    <tbody>${monthTxs.map(t => {
                        const cat = getCategoryById(t.categoryId);
                        const isBR = t.country === 'BR';
                        return `<tr>
                            <td>${fmtDate(t.date)}</td>
                            <td><span class="badge ${t.type === 'income' ? 'badge-success' : t.type === 'investment' ? 'badge-purple' : 'badge-danger'}">${t.type === 'income' ? 'Receita' : t.type === 'investment' ? 'Investimento' : 'Despesa'}</span></td>
                            <td>${cat.icon} ${cat.name}</td>
                            <td>${t.description || '-'}</td>
                            <td>${t.assignedTo || 'Casal'}</td>
                            <td>${isBR ? '🇧🇷 BR' : '🇪🇸 ES'}</td>
                            <td style="font-weight:600">${fmtMoney(t.amount, isBR ? state.settings.currencyBR : state.settings.currencyES)}</td>
                        </tr>`;
                    }).join('')}</tbody>
                </table>
            </div>`}
        </div>`;
    };

    // ==================== MUDAR MÊS DO RELATÓRIO ====================
    const changeReportMonth = (ym) => {
        if (!ym) return;
        state.selectedMonth = ym;
        saveState();
        const reportContainer = el('reportContainer');
        if (reportContainer) {
            reportContainer.innerHTML = renderMonthlyReport();
        }
    };

    // ==================== EXPORTAÇÃO CSV ====================
    const exportToCSV = () => {
        const ym = state.selectedMonth;
        const txs = state.transactions.filter(t => {
            if (!t || !t.date) return false;
            return getYearMonth(t.date) === ym;
        }).sort((a, b) => parseDateToYMD(b.date).localeCompare(parseDateToYMD(a.date)));
        
        if (!txs.length) { 
            showToast('⚠️ Nenhum dado para exportar neste mês.', 'error'); 
            return; 
        }
        
        let csv = 'Data;Tipo;Categoria;Descrição;Responsável;País;Valor\n';
        
        txs.forEach(t => {
            const cat = getCategoryById(t.categoryId).name;
            const tipo = t.type === 'income' ? 'Receita' : t.type === 'investment' ? 'Investimento' : 'Despesa';
            const valor = Number(t.amount).toFixed(2).replace('.', ',');
            csv += `${fmtDate(t.date)};${tipo};${cat};${t.description || ''};${t.assignedTo || 'Casal'};${t.country || 'ES'};${valor}\n`;
        });
        
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Relatorio_FinFam_${ym}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        
        showToast(`✅ CSV exportado com sucesso! (${txs.length} registros)`);
    };
        
    // ==================== EXPORTAÇÃO PDF ====================
    const exportToPDF = () => {
        const reportsPage = document.getElementById('reports');
        if (!reportsPage) {
            showToast('❌ Página de relatórios não encontrada.', 'error');
            return;
        }
        
        showToast('🔄 Gerando PDF...', 'info');
        
        const originalParent = reportsPage.parentNode;
        const originalNextSibling = reportsPage.nextSibling;
        const printContainer = document.createElement('div');
        printContainer.id = 'print-container';
        printContainer.style.position = 'absolute';
        printContainer.style.left = '0';
        printContainer.style.top = '0';
        printContainer.style.width = '100%';
        printContainer.style.background = '#ffffff';
        printContainer.style.zIndex = '99999';
        printContainer.style.padding = '20px';
        printContainer.style.boxSizing = 'border-box';
        
        const clone = reportsPage.cloneNode(true);
        clone.classList.add('active');
        clone.style.display = 'block';
        clone.style.width = '100%';
        clone.style.margin = '0';
        clone.style.padding = '0';
        
        const elementsToRemove = clone.querySelectorAll('.no-print, button, select');
        elementsToRemove.forEach(el => el.remove());
        
        const header = document.createElement('div');
        header.style.textAlign = 'center';
        header.style.marginBottom = '20px';
        header.style.paddingBottom = '10px';
        header.style.borderBottom = '2px solid #1e3a5f';
        header.innerHTML = `
            <h1 style="color: #1e3a5f; margin: 0; font-size: 24px;">FinFam - Relatório Financeiro Familiar</h1>
            <p style="color: #64748b; margin: 5px 0 0 0; font-size: 14px;">Mês de Referência: ${state.selectedMonth}</p>
        `;
        clone.insertBefore(header, clone.firstChild);
        
        printContainer.appendChild(clone);
        document.body.appendChild(printContainer);
        
        const opt = {
            margin: [10, 10, 10, 10],
            filename: `Relatorio_FinFam_${state.selectedMonth}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { 
                scale: 2, 
                useCORS: true, 
                logging: false,
                scrollY: 0
            },
            jsPDF: { 
                unit: 'mm', 
                format: 'a4', 
                orientation: 'portrait' 
            }
        };
        
        html2pdf().set(opt).from(printContainer).save().then(() => {
            document.body.removeChild(printContainer);
            showToast('✅ PDF exportado com sucesso!');
        }).catch(err => {
            console.error('Erro ao gerar PDF:', err);
            document.body.removeChild(printContainer);
            showToast('❌ Erro ao exportar PDF.', 'error');
        });
    };

    // ==================== CONFIGURAÇÕES ====================
    const renderSettings = () => {
        return `
        <div style="max-width:800px">
            <h2 style="margin:0 0 4px;font-size:22px;color:var(--navy)">Configurações do Sistema</h2>
            <p style="margin:0 0 24px;color:var(--text-light);font-size:14px">Preferências, banco de dados e usuários</p>
            
            <div class="card" style="padding:24px;margin-bottom:24px">
                <h3 style="margin:0 0 16px;color:var(--navy);font-size:16px">☁️ Banco de Dados (Google Drive)</h3>
                
                <div style="margin-bottom:16px">
                    <label class="form-label">Status da Conexão</label>
                    <div id="connectionStatus"><span class="badge badge-info">Verificando...</span></div>
                </div>

                <div class="form-group">
                    <label class="form-label">URL do Google Apps Script (Web App)</label>
                    <input type="url" id="settingScriptUrl" class="input-field" placeholder="https://script.google.com/macros/s/.../exec" value="${state.settings.googleScriptUrl || ''}">
                </div>

                <div class="form-group">
                    <label class="form-label">Token de Segurança (API Token)</label>
                    <input type="text" id="settingToken" class="input-field" value="${state.settings.apiToken || DEFAULT_TOKEN}">
                </div>

                <div style="display:flex;gap:12px;margin-top:20px;flex-wrap:wrap">
                    <button type="button" class="btn-primary" onclick="App.saveSettings()">💾 Salvar Configurações</button>
                    <button type="button" class="btn-primary" style="background:#0284c7" onclick="App.syncFromDrive()">📥 Sincronizar do Drive</button>
                    <button type="button" class="btn-primary" style="background:#dc2626" onclick="App.syncFromDriveForce()">🔄 Forçar Substituição</button>
                </div>
            </div>

            <div class="card" style="padding:24px;margin-bottom:24px">
                <h3 style="margin:0 0 16px;color:var(--navy);font-size:16px">🧹 Manutenção de Dados</h3>
                <p style="color:var(--text-light);font-size:14px;margin-bottom:16px">
                    Remova registros com valores corrompidos (NaN, null, sem data) gerados por falhas de preenchimento.
                </p>
                <button type="button" class="btn-primary" style="background:#d97706" onclick="App.cleanGhostData()">
                    🧹 Limpar Dados Fantasmas / Inválidos
                </button>
            </div>

            <div class="card" style="padding:24px;margin-bottom:24px">
                <h3 style="margin:0 0 16px;color:var(--navy);font-size:16px">👥 Gerenciamento de Membros</h3>
                <p style="color:var(--text-light);font-size:14px;margin-bottom:16px">Gerencie quem tem acesso ao FinFam da sua família.</p>
                <button type="button" class="btn-secondary" onclick="App.renderUserManagementModal()">Gerenciar Usuários</button>
            </div>

            <div class="card" style="padding:24px;border:1px solid #fee2e2">
                <h3 style="margin:0 0 8px;color:var(--danger);font-size:16px">🚨 Zona de Perigo</h3>
                <p style="color:var(--text-light);font-size:13px;margin-bottom:16px">Ações destrutivas com o banco de dados.</p>
                <button type="button" class="btn-danger" onclick="App.resetDriveData()">Resetar e Sobrescrever Planilha do Drive</button>
            </div>
        </div>`;
    };

    const saveSettings = () => {
        const url = el('settingScriptUrl').value.trim();
        const token = el('settingToken').value.trim();

        state.settings.googleScriptUrl = url;
        state.settings.apiToken = token || DEFAULT_TOKEN;

        saveState();
        showToast('✅ Configurações salvas!');
        checkConnection();
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

        // Lista de responsáveis cadastrados + Casal
        const userNames = Array.isArray(state.users) ? state.users.map(u => u.name).filter(Boolean) : [];
        const uniqueUsers = ['Casal', ...new Set(userNames)];
        const assignedValue = tx ? tx.assignedTo : 'Casal';
        if (assignedValue && !uniqueUsers.includes(assignedValue)) {
            uniqueUsers.push(assignedValue);
        }
        const assignedOptions = uniqueUsers.map(u => 
            `<option value="${u}" ${assignedValue === u ? 'selected' : ''}>${u === 'Casal' ? '👫 Casal / Ambos' : '👤 ' + u}</option>`
        ).join('');

        // Categorias filtradas pelo tipo
        const currentType = tx ? tx.type : 'expense';
        const renderCategorySelectOptions = (type, selectedId) => {
            const filtered = state.categories.filter(c => c.type === type);
            if (type === 'investment') {
                return `<option value="cat_investimento" selected>📈 Investimentos & Aplicações</option>`;
            }
            if (filtered.length === 0) return `<option value="cat_outros">📋 Geral</option>`;
            return filtered.map(c => 
                `<option value="${c.id}" ${selectedId === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`
            ).join('');
        };

        el('modalContent').innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;border-bottom:1px solid #e2e8f0;padding-bottom:10px;">
                <h3 style="margin:0;color:var(--navy);font-size:18px;">${isEdit ? '✏️ Editar Lançamento' : '➕ Novo Lançamento'}</h3>
                <button onclick="App.closeModal()" style="background:none;border:none;font-size:26px;cursor:pointer;color:#64748b;padding:0;">&times;</button>
            </div>
            <form onsubmit="event.preventDefault(); App.saveTransaction('${tx ? tx.id : ''}');">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div class="form-group">
                        <label class="form-label">Tipo</label>
                        <select id="txType" class="input-field" onchange="App.onTxTypeChange(this.value)">
                            <option value="expense" ${currentType === 'expense' ? 'selected' : ''}>Despesa</option>
                            <option value="income" ${currentType === 'income' ? 'selected' : ''}>Receita</option>
                            <option value="investment" ${currentType === 'investment' ? 'selected' : ''}>Investimento 📈</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Data</label>
                        <input type="date" id="txDate" class="input-field" value="${tx ? tx.date : today}" required>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Categoria</label>
                    <select id="txCategory" class="input-field">${renderCategorySelectOptions(currentType, tx ? (categoryAliasMap[tx.categoryId] || tx.categoryId) : '')}</select>
                </div>
                <div class="form-group">
                    <label class="form-label">Descrição</label>
                    <input type="text" id="txDesc" class="input-field" placeholder="Ex: Supermercado / Salário" value="${tx ? tx.description : ''}">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div class="form-group">
                        <label class="form-label">Responsável</label>
                        <select id="txAssigned" class="input-field">${assignedOptions}</select>
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
        if (overlay) {
            overlay.classList.remove('active');
            overlay.style.display = 'none';
        }
    };

    const onTxTypeChange = (newType) => {
        const catSelect = el('txCategory');
        if (!catSelect) return;
        if (newType === 'investment') {
            catSelect.innerHTML = `<option value="cat_investimento" selected>📈 Investimentos & Aplicações</option>`;
            return;
        }
        const filtered = state.categories.filter(c => c.type === newType);
        if (filtered.length === 0) {
            catSelect.innerHTML = `<option value="cat_outros">📋 Geral</option>`;
            return;
        }
        catSelect.innerHTML = filtered.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
    };

    const saveTransaction = (id) => {
        if (state.settings.googleScriptUrl && !isDriveConnected && isSyncing) {
            showToast('⏳ Conectando ao banco de dados... Aguarde a sincronização.', 'error');
            return;
        }
        const type = el('txType').value;
        const date = parseDateToYMD(el('txDate').value) || el('txDate').value;
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
        if (state.settings.googleScriptUrl && !isDriveConnected && isSyncing) {
            showToast('⏳ Conectando ao banco de dados... Aguarde a sincronização.', 'error');
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
                <div class="modal" id="modalContent" style="background:#fff; border-radius:12px; padding:24px; width:90%; max-width:500px; box-shadow:0 10px 25px rgba(0,0,0,0.2);"></div>
            </div>
            <div id="toast" class="toast"></div>
        `;

        setTimeout(initDashboardCharts, 50);
    };

    // ==================== INIT ====================
    const init = () => {
        loadState();

        if (checkSession()) {
            renderApp();
            if (state.settings.googleScriptUrl) {
                showConnectionOverlay('Conectando ao banco de dados...');
                syncFromDrive(true).then(() => {
                    hideConnectionOverlay();
                    refreshAllViews();
                }).catch(() => {
                    hideConnectionOverlay();
                });
            } else {
                isDriveConnected = true;
            }
        } else {
            renderLogin();
        }
    };

    return {
        init,
        nav,
        renderLogin,
        renderRegisterFirstUser,
        renderForgotPassword,
        handleLogin,
        handleRegisterFirstUser,
        handleForgotPassword,
        logout,
        showTransactionModal,
        onTxTypeChange,
        closeModal,
        saveTransaction,
        deleteTransaction,
        changeSelectedMonth,
        changeReportMonth,
        togglePrivacy,
        saveSettings,
        cleanGhostData,
        resetDriveData,
        syncFromDrive,
        syncFromDriveForce,
        exportToCSV,
        exportToPDF,
        renderUserManagementModal,
        addUser,
        deleteUser
    };
})();

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
