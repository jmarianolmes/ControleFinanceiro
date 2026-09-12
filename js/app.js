/**
 * FinFam - Controle Financeiro Familiar
 * Aplicação Completa com Sincronização Google Drive
 */

const FinFam = (() => {
    // ==================== CONFIGURAÇÃO PADRÃO ====================
    const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz_9eWl83n8j11Z-d3t7N8j9k0l1m2n3o4p5/exec';
    const DEFAULT_TOKEN = 'finfam_secret_token_2024';

    // ==================== ESTADO DA APLICAÇÃO ====================
    let state = {
        currentUser: null,
        users: [],
        transactions: [],
        categories: [],
        investments: [],
        goals: [],
        fixedExpenses: [],
        settings: {
            googleScriptUrl: '',
            apiToken: DEFAULT_TOKEN,
            currencyES: 'EUR',
            currencyBR: 'BRL',
            exchangeRate: 6.10,
            sessionTimeout: 30,
            theme: 'light'
        },
        selectedMonth: new Date().toISOString().slice(0, 7),
        filterCountry: 'ALL',
        filterType: 'ALL'
    };

    let charts = {};
    let sessionTimer = null;
    let inactivityTimer = null;
    let isDriveConnected = false;
    let isSyncing = false;

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

    const generateId = () => '_' + Math.random().toString(36).substr(2, 9);
    
    const fmtMoney = (val, currency = 'EUR') => {
        const symbol = currency === 'BRL' ? 'R$' : '€';
        const num = Number(val) || 0;
        return `${symbol} ${num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const fmtDate = d => {
        if (!d) return '-';
        const ymd = parseDateToYMD(d);
        if (ymd && ymd.length === 10) {
            const parts = ymd.split('-');
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
        return String(d);
    };

    const el = id => document.getElementById(id);

    const showToast = (msg, type = 'success') => {
        const toast = el('toast');
        if (!toast) return;
        toast.textContent = msg;
        toast.className = `toast ${type} show`;
        setTimeout(() => toast.classList.remove('show'), 3500);
    };

    // Overlay com barra de progresso real (0% a 100%)
    const setConnectionProgress = (pct, text) => {
        let ov = el('finfamConnectionOverlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'finfamConnectionOverlay';
            ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(15,23,42,0.85);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;backdrop-filter:blur(4px);';
            ov.innerHTML = `
                <div style="background:#1e293b;padding:32px 36px;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,0.5);text-align:center;max-width:380px;width:90%;border:1px solid rgba(255,255,255,0.1)">
                    <div style="width:40px;height:40px;border:3px solid #38bdf8;border-top-color:transparent;border-radius:50%;animation:finfamSpin 1s linear infinite;margin:0 auto 16px;"></div>
                    <div id="finfamOverlayText" style="font-size:16px;font-weight:600;margin-bottom:12px;color:#f8fafc">Conectando ao banco de dados...</div>
                    <div style="background:#334155;border-radius:10px;height:10px;width:100%;overflow:hidden;margin-top:14px;box-shadow:inset 0 1px 3px rgba(0,0,0,0.3)">
                        <div id="finfamOverlayBar" style="background:linear-gradient(90deg,#0ea5e9,#10b981);height:100%;width:0%;border-radius:10px;transition:width 0.4s ease;"></div>
                    </div>
                    <div id="finfamOverlayPct" style="font-size:12px;color:#94a3b8;margin-top:10px;">0%</div>
                </div>
                <style>
                    @keyframes finfamSpin { to { transform: rotate(360deg); } }
                </style>
            `;
            document.body.appendChild(ov);
        }
        if (text) {
            const txt = el('finfamOverlayText');
            if (txt) txt.textContent = text;
        }
        const bar = el('finfamOverlayBar');
        if (bar) bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
        const pctEl = el('finfamOverlayPct');
        if (pctEl) pctEl.textContent = Math.round(pct) + '%';
        ov.style.display = 'flex';
    };

    const hideConnectionOverlay = () => {
        const ov = el('finfamConnectionOverlay');
        if (ov) {
            setConnectionProgress(100, 'Pronto!');
            setTimeout(() => { ov.style.display = 'none'; }, 300);
        }
    };

    // ==================== CATEGORIAS ====================
    const defaultCategories = [
        { id: 'cat_salario_es', name: 'Salário / Emprego', type: 'income', country: 'ES', icon: '💼' },
        { id: 'cat_freelance_es', name: 'Trabalho Freelance / Extras', type: 'income', country: 'ES', icon: '💻' },
        { id: 'cat_outras_entradas_es', name: 'Outras Receitas', type: 'income', country: 'ES', icon: '💶' },
        { id: 'cat_rendimentos', name: 'Rendimentos & Dividendos', type: 'income', country: 'ES', icon: '💰' },
        { id: 'cat_aluguel_br', name: 'Receita Aluguel', type: 'income', country: 'BR', icon: '🏠' },
        { id: 'cat_invest_es', name: 'Investimentos & Aplicações', type: 'investment', country: 'ES', icon: '📈' },
        { id: 'cat_invest_br', name: 'Investimentos & Tesouro', type: 'investment', country: 'BR', icon: '📈' },
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
        { id: 'cat_outros_br', name: 'Compromissos Diversos', type: 'expense', country: 'BR', icon: '📋' }
    ];

    const getCategoryById = (catId) => {
        if (!catId) return { name: 'Geral', icon: '📋', type: 'expense' };
        return state.categories.find(c => c.id === catId) || { name: 'Geral', icon: '📋', type: 'expense' };
    };

    // ==================== SINCRONIZAÇÃO GOOGLE DRIVE ====================
    const syncToDrive = async () => {
        const url = state.settings.googleScriptUrl;
        if (!url) return;
        
        try {
            console.log('📤 Enviando para o Drive:', state.transactions.length, 'registros');
            
            const payload = {
                action: 'sync',
                token: state.settings.apiToken || DEFAULT_TOKEN,
                transactions: state.transactions
            };
            
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });
            
            const data = await res.json();
            console.log('📥 Resposta do Drive (sync):', data);
            
            if (data.status === 'success') {
                isDriveConnected = true;
                showToast(`✅ Sincronizado com o Drive! (${state.transactions.length} registros)`);
            } else {
                showToast(data.message || '⚠️ Erro ao sincronizar.', 'error');
            }
        } catch (e) {
            console.error('❌ Sync error:', e);
            showToast('⚠️ Erro de conexão com o Drive.', 'error');
        }
    };

    const syncFromDrive = async (silent = false) => {
        const url = state.settings.googleScriptUrl;
        if (!url) {
            hideConnectionOverlay();
            if (!silent) showToast('⚠️ URL do Google Drive não configurada.', 'error');
            return;
        }
        
        try {
            isSyncing = true;
            setConnectionProgress(35, 'Conectando ao banco de dados...');
            if (!silent) showToast('🔄 Sincronizando com o Drive...', 'info');
            
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ 
                    action: 'fetch', 
                    token: state.settings.apiToken || DEFAULT_TOKEN 
                })
            });
            
            setConnectionProgress(70, 'Processando dados da planilha...');
            const data = await res.json();
            console.log('📥 Dados do Drive:', data);
            
            if (data.status === 'success' && Array.isArray(data.transactions)) {
                console.log(`📊 Recebidos ${data.transactions.length} registros do Drive`);
                
                const normalized = data.transactions.map(t => {
                    const rawDate = t.date || t.Data || '';
                    const normalizedDate = parseDateToYMD(rawDate) || new Date().toISOString().slice(0, 10);
                    
                    return {
                        id: String(t.id || t.ID || generateId()),
                        date: normalizedDate,
                        type: t.type || t.Tipo || 'expense',
                        categoryId: t.categoryId || t.CategoriaID || 'cat_outros_es',
                        description: t.description || t.Descrição || '',
                        assignedTo: t.assignedTo || t.Responsável || 'Casal',
                        country: t.country || t.País || 'ES',
                        amount: Number(t.amount || t.Valor) || 0
                    };
                });
                
                const driveMap = new Map(normalized.map(t => [String(t.id), t]));
                const localPending = (state.transactions || []).filter(lt => !driveMap.has(String(lt.id)));
                
                state.transactions = [...normalized, ...localPending];
                isDriveConnected = true;
                setConnectionProgress(100, 'Sincronização concluída!');
                hideConnectionOverlay();
                saveState();
                refreshAllViews();
                
                const monthPicker = el('dashMonthPicker');
                if (monthPicker) monthPicker.value = state.selectedMonth;
                
                if (!silent) {
                    showToast(`✅ ${normalized.length} registros sincronizados do Drive!`);
                }
                
                console.log(`📊 ${state.transactions.length} registros normalizados`);
                
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
        if (!confirm('⚠️ Isso vai SUBSTITUIR TODOS os dados locais pelos dados do Drive. Continuar?')) {
            return;
        }
        
        const url = state.settings.googleScriptUrl;
        if (!url) {
            showToast('⚠️ Configure a URL do Google Script primeiro.', 'error');
            return;
        }
        
        try {
            showToast('🔄 Baixando dados do Drive...', 'info');
            
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
                // SUBSTITUIÇÃO DIRETA (sem mesclagem)
                state.transactions = data.transactions.map(t => {
                    const rawDate = t.date || t.Data || '';
                    const normalizedDate = parseDateToYMD(rawDate) || new Date().toISOString().slice(0, 10);
                    return {
                        id: String(t.id || t.ID || generateId()),
                        date: normalizedDate,
                        type: t.type || t.Tipo || 'expense',
                        categoryId: t.categoryId || t.CategoriaID || 'cat_outros_es',
                        description: t.description || t.Descrição || '',
                        assignedTo: t.assignedTo || t.Responsável || 'Casal',
                        country: t.country || t.País || 'ES',
                        amount: Number(t.amount || t.Valor) || 0
                    };
                });
                
                isDriveConnected = true;
                saveState();
                refreshAllViews();
                showToast(`✅ ${state.transactions.length} registros restaurados do Drive!`);
            } else {
                showToast('❌ Nenhum dado retornado do Drive.', 'error');
            }
        } catch (e) {
            showToast('❌ Erro ao forçar sincronização.', 'error');
            console.error('❌ Force sync error:', e);
        }
    };

    const checkConnection = async () => {
        const statusEl = el('connectionStatus');
        if (!statusEl) return;
        
        const url = state.settings.googleScriptUrl;
        if (!url) {
            statusEl.innerHTML = '<span class="badge badge-warning">⚠️ URL não configurada</span>';
            return;
        }
        
        statusEl.innerHTML = '<span class="badge badge-info">🔄 Testando conexão...</span>';
        
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
            
            if (data.status === 'connected') {
                isDriveConnected = true;
                statusEl.innerHTML = `<span class="badge badge-success">🟢 Conectado ao Google Drive (${data.totalRows || 0} registros)</span>`;
            } else {
                statusEl.innerHTML = `<span class="badge badge-danger">🔴 Erro: ${data.message || 'Desconhecido'}</span>`;
            }
        } catch (e) {
            statusEl.innerHTML = '<span class="badge badge-danger">🔴 Falha na conexão</span>';
        }
    };

    // ==================== PERSISTÊNCIA LOCAL ====================
    const saveState = () => {
        try {
            localStorage.setItem('finfam_state', JSON.stringify({
                currentUser: state.currentUser,
                users: state.users,
                transactions: state.transactions,
                categories: state.categories,
                investments: state.investments,
                goals: state.goals,
                fixedExpenses: state.fixedExpenses,
                settings: state.settings,
                selectedMonth: state.selectedMonth
            }));
        } catch (e) {
            console.error('Error saving state:', e);
        }
    };

    const loadState = () => {
        try {
            const saved = localStorage.getItem('finfam_state');
            if (saved) {
                const parsed = JSON.parse(saved);
                state = {
                    ...state,
                    ...parsed,
                    settings: { ...state.settings, ...(parsed.settings || {}) },
                    categories: (parsed.categories && parsed.categories.length) ? parsed.categories : defaultCategories
                };
            } else {
                state.categories = defaultCategories;
                state.settings.googleScriptUrl = DEFAULT_SCRIPT_URL;
                state.users = [
                    { id: 'usr_1', name: 'Administrador', email: 'admin@finfam.com', role: 'admin', pin: '1234' }
                ];
            }
        } catch (e) {
            console.error('Error loading state:', e);
            state.categories = defaultCategories;
        }
    };

    // ==================== CONTROLE DE SESSÃO ====================
    const resetInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        const timeoutMinutes = state.settings.sessionTimeout || 30;
        inactivityTimer = setTimeout(() => {
            showToast('⚠️ Sessão expirada por inatividade.', 'warning');
            logout();
        }, timeoutMinutes * 60 * 1000);
    };

    const setupInactivityListeners = () => {
        ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(evt => {
            document.addEventListener(evt, resetInactivityTimer, true);
        });
        resetInactivityTimer();
    };

    const startSessionCountdown = () => {
        if (sessionTimer) clearInterval(sessionTimer);
        const updateCountdown = () => {
            const timerEl = el('sessionCountdown');
            if (!timerEl) return;
            const remaining = Math.max(0, 30);
            timerEl.textContent = `${remaining}m`;
        };
        updateCountdown();
        sessionTimer = setInterval(updateCountdown, 60000);
    };

    // ==================== AUTENTICAÇÃO ====================
    const login = (email, pin) => {
        const user = state.users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.pin === pin);
        if (user) {
            state.currentUser = user;
            saveState();
            renderApp();
            showToast(`👋 Bem-vindo(a), ${user.name}!`);
            setupInactivityListeners();
            startSessionCountdown();
            if (state.settings.googleScriptUrl) {
                setConnectionProgress(15, 'Conectando ao banco de dados...');
                syncFromDrive(true);
            }
            return true;
        }
        showToast('❌ E-mail ou PIN incorretos.', 'error');
        return false;
    };

    const logout = () => {
        state.currentUser = null;
        if (sessionTimer) clearInterval(sessionTimer);
        if (inactivityTimer) clearTimeout(inactivityTimer);
        saveState();
        renderApp();
        showToast('🔒 Você saiu do sistema.');
    };

    // ==================== CÁLCULOS FINANCEIROS ====================
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

        const incomeES = txs.filter(t => t.country === 'ES' && t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
        const expenseES = txs.filter(t => t.country === 'ES' && t.type === 'expense').reduce((acc, t) => acc + t.amount, 0);
        const investES = txs.filter(t => t.country === 'ES' && t.type === 'investment').reduce((acc, t) => acc + t.amount, 0);

        const incomeBR = txs.filter(t => t.country === 'BR' && t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
        const expenseBR = txs.filter(t => t.country === 'BR' && t.type === 'expense').reduce((acc, t) => acc + t.amount, 0);
        const investBR = txs.filter(t => t.country === 'BR' && t.type === 'investment').reduce((acc, t) => acc + t.amount, 0);

        const balanceES = incomeES - expenseES - investES;
        const balanceBR = incomeBR - expenseBR - investBR;

        const rate = state.settings.exchangeRate || 6.10;
        const netWorthEUR = balanceES + (balanceBR / rate);

        return {
            transactions: txs,
            incomeES, expenseES, investES, balanceES,
            incomeBR, expenseBR, investBR, balanceBR,
            netWorthEUR,
            totalIncomeEUR: incomeES + (incomeBR / rate),
            totalExpenseEUR: expenseES + (expenseBR / rate),
            totalInvestEUR: investES + (investBR / rate)
        };
    };

    // ==================== RENDERIZADORES DE TELA ====================
    const renderLogin = () => `
        <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--navy) 0%, #0f172a 100%); padding: 20px;">
            <div class="card" style="width: 100%; max-width: 420px; padding: 40px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);">
                <div style="text-align: center; margin-bottom: 32px;">
                    <div style="width: 64px; height: 64px; background: var(--navy); border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
                        <span style="font-size: 32px;">🏰</span>
                    </div>
                    <h1 style="color: var(--navy); margin: 0 0 8px 0; font-size: 24px; font-weight: 700;">FinFam</h1>
                    <p style="color: var(--text-light); margin: 0; font-size: 14px;">Controle Financeiro Familiar Multimoeda</p>
                </div>
                <form id="loginForm" onsubmit="event.preventDefault(); FinFam.handleLogin();">
                    <div class="form-group">
                        <label class="form-label">E-mail</label>
                        <input type="email" id="loginEmail" class="input-field" placeholder="seu@email.com" required value="admin@finfam.com">
                    </div>
                    <div class="form-group">
                        <label class="form-label">PIN de Acesso</label>
                        <input type="password" id="loginPin" class="input-field" placeholder="••••" maxlength="8" required value="1234">
                    </div>
                    <button type="submit" class="btn-primary" style="width: 100%; padding: 12px; margin-top: 8px;">Entrar no Sistema</button>
                </form>
                <div style="margin-top: 24px; text-align: center; font-size: 12px; color: var(--text-light);">
                    🇪🇸 Espanha (€) &bull; 🇧🇷 Brasil (R$) &bull; Google Drive Sync
                </div>
            </div>
        </div>
    `;

    const renderSidebar = () => `
        <aside class="sidebar">
            <div class="logo">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 28px;">🏰</span>
                    <div>
                        <div style="font-weight: 700; font-size: 18px; letter-spacing: -0.5px;">FinFam</div>
                        <div style="font-size: 11px; opacity: 0.7;">Finanças Familiares</div>
                    </div>
                </div>
            </div>
            <nav style="flex: 1; padding: 16px 0;">
                <button class="nav-item active" data-page="dashboard" onclick="FinFam.nav(this)">
                    <span>📊</span> Dashboard
                </button>
                <button class="nav-item" data-page="transactions" onclick="FinFam.nav(this)">
                    <span>💳</span> Lançamentos
                </button>
                <button class="nav-item" data-page="investments" onclick="FinFam.nav(this)">
                    <span>📈</span> Patrimônio
                </button>
                <button class="nav-item" data-page="reports" onclick="FinFam.nav(this)">
                    <span>📑</span> Relatórios
                </button>
                ${state.currentUser && state.currentUser.role === 'admin' ? `
                    <button class="nav-item" data-page="settings" onclick="FinFam.nav(this)">
                        <span>⚙️</span> Configurações
                    </button>
                ` : ''}
            </nav>
            <div style="padding: 20px; border-top: 1px solid rgba(255, 255, 255, 0.1);">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                    <div class="user-avatar">${(state.currentUser?.name || 'U').charAt(0)}</div>
                    <div style="flex: 1; overflow: hidden;">
                        <div style="font-weight: 600; font-size: 14px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden;">
                            ${state.currentUser?.name}
                        </div>
                        <div style="font-size: 11px; opacity: 0.7;">
                            ${state.currentUser?.role === 'admin' ? 'Administrador' : 'Membro'}
                        </div>
                    </div>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 11px; opacity: 0.6;">Sessão: <span id="sessionCountdown">30m</span></span>
                    <button onclick="FinFam.logout()" style="background: none; border: none; color: #f87171; cursor: pointer; font-size: 12px; font-weight: 500;">
                        Sair 🚪
                    </button>
                </div>
            </div>
        </aside>
    `;

    const renderDashboard = () => {
        const data = getSelectedMonthData();
        return `
            <div id="dashboard" class="page active">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
                    <div>
                        <h1 style="color: var(--navy); margin: 0 0 4px 0; font-size: 24px; font-weight: 700;">Painel Financeiro</h1>
                        <p style="color: var(--text-light); margin: 0; font-size: 14px;">Visão consolidada das finanças familiares</p>
                    </div>
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <input type="month" id="dashMonthPicker" class="input-field" value="${state.selectedMonth}" onchange="FinFam.changeMonth(this.value)" style="width: auto;">
                        <button class="btn-primary" onclick="FinFam.showTransactionModal()">+ Novo Lançamento</button>
                        <button class="btn-secondary" onclick="FinFam.syncFromDrive()" title="Atualizar do Drive">🔄 Sincronizar</button>
                    </div>
                </div>

                <!-- CARDS DE PATRIMÔNIO TOTAL -->
                <div class="card net-worth-card" style="padding: 24px; margin-bottom: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
                        <div>
                            <div class="stat-label">Saldo Líquido Estimado do Mês (Total em Euros)</div>
                            <div class="net-worth-value">${fmtMoney(data.netWorthEUR, 'EUR')}</div>
                            <div style="font-size: 12px; color: var(--text-light); margin-top: 4px;">
                                Câmbio ref.: 1 EUR = R$ ${(state.settings.exchangeRate || 6.10).toFixed(2)}
                            </div>
                        </div>
                        <div style="display: flex; gap: 24px;">
                            <div style="text-align: right;">
                                <div class="stat-label">Total Entradas (€)</div>
                                <div style="font-size: 20px; font-weight: 700; color: var(--emerald);">${fmtMoney(data.totalIncomeEUR, 'EUR')}</div>
                            </div>
                            <div style="text-align: right;">
                                <div class="stat-label">Total Saídas (€)</div>
                                <div style="font-size: 20px; font-weight: 700; color: var(--danger);">${fmtMoney(data.totalExpenseEUR, 'EUR')}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- BLOCO ESPANHA -->
                <h3 style="color: var(--navy); margin: 24px 0 12px 0; display: flex; align-items: center; gap: 8px;">
                    <span>🇪🇸</span> Finanças na Espanha (EUR)
                </h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px;">
                    <div class="card stat-card">
                        <div class="stat-label">Receitas (ES)</div>
                        <div class="stat-value emerald-text">${fmtMoney(data.incomeES, 'EUR')}</div>
                    </div>
                    <div class="card stat-card">
                        <div class="stat-label">Despesas (ES)</div>
                        <div class="stat-value danger-text">${fmtMoney(data.expenseES, 'EUR')}</div>
                    </div>
                    <div class="card stat-card">
                        <div class="stat-label">Investimentos (ES)</div>
                        <div class="stat-value" style="color: var(--purple);">${fmtMoney(data.investES, 'EUR')}</div>
                    </div>
                    <div class="card stat-card">
                        <div class="stat-label">Saldo do Mês (ES)</div>
                        <div class="stat-value ${data.balanceES >= 0 ? 'emerald-text' : 'danger-text'}">
                            ${fmtMoney(data.balanceES, 'EUR')}
                        </div>
                    </div>
                </div>

                <!-- BLOCO BRASIL -->
                <h3 style="color: var(--navy); margin: 24px 0 12px 0; display: flex; align-items: center; gap: 8px;">
                    <span>🇧🇷</span> Finanças no Brasil (BRL)
                </h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px;">
                    <div class="card stat-card">
                        <div class="stat-label">Receitas (BR)</div>
                        <div class="stat-value emerald-text">${fmtMoney(data.incomeBR, 'BRL')}</div>
                    </div>
                    <div class="card stat-card">
                        <div class="stat-label">Despesas (BR)</div>
                        <div class="stat-value danger-text">${fmtMoney(data.expenseBR, 'BRL')}</div>
                    </div>
                    <div class="card stat-card">
                        <div class="stat-label">Investimentos (BR)</div>
                        <div class="stat-value" style="color: var(--purple);">${fmtMoney(data.investBR, 'BRL')}</div>
                    </div>
                    <div class="card stat-card">
                        <div class="stat-label">Saldo do Mês (BR)</div>
                        <div class="stat-value ${data.balanceBR >= 0 ? 'emerald-text' : 'danger-text'}">
                            ${fmtMoney(data.balanceBR, 'BRL')}
                        </div>
                    </div>
                </div>

                <!-- GRÁFICOS -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 24px; margin-bottom: 24px;">
                    <div class="card" style="padding: 20px;">
                        <h4 style="margin: 0 0 16px 0; color: var(--navy);">Despesas por Categoria (Espanha)</h4>
                        <div style="height: 260px; position: relative;">
                            <canvas id="chartExpensesES"></canvas>
                        </div>
                    </div>
                    <div class="card" style="padding: 20px;">
                        <h4 style="margin: 0 0 16px 0; color: var(--navy);">Comparativo Receitas vs Despesas</h4>
                        <div style="height: 260px; position: relative;">
                            <canvas id="chartComparison"></canvas>
                        </div>
                    </div>
                </div>

                <!-- ÚLTIMOS LANÇAMENTOS -->
                <div class="card" style="padding: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <h4 style="margin: 0; color: var(--navy);">Últimas Movimentações do Mês</h4>
                        <button class="btn-secondary" onclick="FinFam.nav(document.querySelector('[data-page=transactions]'))">Ver Todas</button>
                    </div>
                    ${renderTransactionsTable(data.transactions.slice(0, 5))}
                </div>
            </div>
        `;
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

    const renderTransactionsTable = (txs) => {
        if (!txs || txs.length === 0) {
            return `
                <div class="empty-state">
                    <p style="font-size: 24px; margin-bottom: 8px;">📭</p>
                    <p>Nenhuma transação encontrada para este período ou filtro.</p>
                </div>
            `;
        }

        return `
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Data</th>
                            <th>Tipo</th>
                            <th>Categoria</th>
                            <th>Descrição</th>
                            <th>Responsável</th>
                            <th>País</th>
                            <th>Valor</th>
                            <th style="text-align: right;">Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${txs.map(renderTransactionRow).join('')}
                    </tbody>
                </table>
            </div>
        `;
    };

    const renderTransactions = () => {
        let txs = state.transactions.slice().sort((a, b) => parseDateToYMD(b.date).localeCompare(parseDateToYMD(a.date)));

        if (state.selectedMonth) {
            txs = txs.filter(t => getYearMonth(t.date) === state.selectedMonth);
        }

        if (state.filterCountry !== 'ALL') {
            txs = txs.filter(t => t.country === state.filterCountry);
        }

        if (state.filterType !== 'ALL') {
            txs = txs.filter(t => t.type === state.filterType);
        }

        return `
            <div id="transactions" class="page">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
                    <div>
                        <h1 style="color: var(--navy); margin: 0 0 4px 0; font-size: 24px; font-weight: 700;">Lançamentos</h1>
                        <p style="color: var(--text-light); margin: 0; font-size: 14px;">Histórico completo de transações registradas</p>
                    </div>
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <button class="btn-primary" onclick="App.showTransactionModal()">+ Novo Lançamento</button>
                    </div>
                </div>

                <div class="card" style="padding: 16px; margin-bottom: 24px;">
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                        <div>
                            <label class="form-label">Filtrar por Mês</label>
                            <input type="month" class="input-field" value="${state.selectedMonth}" onchange="App.changeSelectedMonth(this.value)">
                        </div>
                        <div>
                            <label class="form-label">Filtrar por País</label>
                            <select class="input-field" onchange="App.filterByCountry(this.value)">
                                <option value="ALL" ${state.filterCountry === 'ALL' ? 'selected' : ''}>Todos os Países</option>
                                <option value="ES" ${state.filterCountry === 'ES' ? 'selected' : ''}>🇪🇸 Espanha</option>
                                <option value="BR" ${state.filterCountry === 'BR' ? 'selected' : ''}>🇧🇷 Brasil</option>
                            </select>
                        </div>
                        <div>
                            <label class="form-label">Filtrar por Tipo</label>
                            <select class="input-field" onchange="App.filterByType(this.value)">
                                <option value="ALL" ${state.filterType === 'ALL' ? 'selected' : ''}>Todos os Tipos</option>
                                <option value="expense" ${state.filterType === 'expense' ? 'selected' : ''}>Despesas</option>
                                <option value="income" ${state.filterType === 'income' ? 'selected' : ''}>Receitas</option>
                                <option value="investment" ${state.filterType === 'investment' ? 'selected' : ''}>Investimentos</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div class="card" style="padding: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <span style="font-size: 14px; color: var(--text-light); font-weight: 500;">
                            Exibindo <strong>${txs.length}</strong> registro(s)
                        </span>
                    </div>
                    ${renderTransactionsTable(txs)}
                </div>
            </div>
        `;
    };

    // ==================== RENDER PATRIMÔNIO ====================
    const renderInvestments = () => {
        const esInvest = state.transactions.filter(t => t.type === 'investment' && t.country === 'ES').reduce((acc, t) => acc + t.amount, 0);
        const brInvest = state.transactions.filter(t => t.type === 'investment' && t.country === 'BR').reduce((acc, t) => acc + t.amount, 0);

        return `
            <div id="investments" class="page">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
                    <div>
                        <h1 style="color: var(--navy); margin: 0 0 4px 0; font-size: 24px; font-weight: 700;">Patrimônio & Investimentos</h1>
                        <p style="color: var(--text-light); margin: 0; font-size: 14px;">Acompanhamento acumulado dos investimentos familiares</p>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 24px;">
                    <div class="card stat-card" style="border-left: 4px solid var(--purple);">
                        <div class="stat-label">Aportes Acumulados (Espanha)</div>
                        <div class="stat-value" style="color: var(--purple);">${fmtMoney(esInvest, 'EUR')}</div>
                    </div>
                    <div class="card stat-card" style="border-left: 4px solid var(--navy-light);">
                        <div class="stat-label">Aportes Acumulados (Brasil)</div>
                        <div class="stat-value" style="color: var(--navy-light);">${fmtMoney(brInvest, 'BRL')}</div>
                    </div>
                </div>

                <div class="card" style="padding: 20px;">
                    <h3 style="color: var(--navy); margin-top: 0;">Histórico de Aportes em Investimentos</h3>
                    ${renderTransactionsTable(state.transactions.filter(t => t.type === 'investment'))}
                </div>
            </div>
        `;
    };

    // ==================== RENDER RELATÓRIOS ====================
    const renderMonthlyReport = () => {
        const ym = state.selectedMonth;
        const [year, month] = ym.split('-');
        const monthName = new Date(parseInt(year), parseInt(month) - 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

        const monthTxs = state.transactions.filter(t => {
            if (!t || !t.date) return false;
            return getYearMonth(t.date) === ym;
        }).sort((a, b) => parseDateToYMD(b.date).localeCompare(parseDateToYMD(a.date)));

        const yearTxs = state.transactions.filter(t => {
            if (!t || !t.date) return false;
            const ymd = parseDateToYMD(t.date);
            return ymd && ymd.startsWith(`${year}-`);
        });

        const mIncome = monthTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const mExpense = monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        const mInvest = monthTxs.filter(t => t.type === 'investment').reduce((s, t) => s + t.amount, 0);

        return `
            <div id="reports" class="page">
                <div id="reportContainer">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
                        <div>
                            <h1 style="color: var(--navy); margin: 0 0 4px 0; font-size: 24px; font-weight: 700;">Relatórios & Exportação</h1>
                            <p style="color: var(--text-light); margin: 0; font-size: 14px;">Consolidação mensal e anual para declarações e controle (${monthName})</p>
                        </div>
                        <div style="display: flex; gap: 12px; align-items: center;">
                            <input type="month" id="reportMonthPicker" class="input-field" value="${ym}" onchange="App.changeReportMonth(this.value)" style="width: auto;">
                            <button class="btn-secondary" onclick="App.exportToPDF()">📄 Exportar PDF</button>
                            <button class="btn-secondary" onclick="App.exportToCSV()">📊 Exportar CSV</button>
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px;">
                        <div class="card stat-card">
                            <div class="stat-label">Total Entradas (${monthName})</div>
                            <div class="stat-value emerald-text">${fmtMoney(mIncome, 'EUR')}</div>
                        </div>
                        <div class="card stat-card">
                            <div class="stat-label">Total Despesas (${monthName})</div>
                            <div class="stat-value danger-text">${fmtMoney(mExpense, 'EUR')}</div>
                        </div>
                        <div class="card stat-card">
                            <div class="stat-label">Total Investido (${monthName})</div>
                            <div class="stat-value" style="color: var(--purple);">${fmtMoney(mInvest, 'EUR')}</div>
                        </div>
                    </div>

                    <div class="card" style="padding: 24px;">
                        <h3 style="color: var(--navy); margin-top: 0; margin-bottom: 16px;">Movimentações do Mês (${monthTxs.length})</h3>
                        ${renderTransactionsTable(monthTxs)}
                    </div>
                </div>
            </div>
        `;
    };

    // ==================== EXPORTAÇÕES ====================
    const exportToCSV = () => {
        const ym = state.selectedMonth;
        const txs = state.transactions.filter(t => {
            if (!t || !t.date) return false;
            return getYearMonth(t.date) === ym;
        }).sort((a, b) => parseDateToYMD(b.date).localeCompare(parseDateToYMD(a.date)));

        if (txs.length === 0) {
            showToast('⚠️ Nenhum lançamento no mês para exportar.', 'warning');
            return;
        }

        let csv = 'sep=;\r\nData;Tipo;Categoria;Descricao;Responsavel;Pais;Valor\r\n';
        txs.forEach(t => {
            const cat = getCategoryById(t.categoryId);
            const tipo = t.type === 'income' ? 'Receita' : t.type === 'investment' ? 'Investimento' : 'Despesa';
            const val = Number(t.amount).toFixed(2).replace('.', ',');
            const desc = (t.description || '').replace(/;/g, ',');
            csv += `${fmtDate(t.date)};${tipo};${cat.name};${desc};${t.assignedTo || 'Casal'};${t.country};${val}\r\n`;
        });

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `FinFam_Relatorio_${ym}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('✅ Arquivo CSV exportado com sucesso!');
    };

    const exportToPDF = () => {
        const ym = state.selectedMonth;
        const [year, month] = ym.split('-');
        const monthName = new Date(parseInt(year), parseInt(month) - 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
        
        const monthTxs = state.transactions.filter(t => getYearMonth(t.date) === ym)
            .sort((a, b) => parseDateToYMD(b.date).localeCompare(parseDateToYMD(a.date)));
        
        const monthIncome = monthTxs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
        const monthExpense = monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
        const monthInvestment = monthTxs.filter(t => t.type === 'investment').reduce((s, t) => s + Number(t.amount), 0);
        const monthBalance = monthIncome - monthExpense - monthInvestment;

        showToast('🔄 Gerando PDF...', 'info');

        const container = document.createElement('div');
        container.id = 'finfamPdfExportContainer';
        container.style.cssText = 'position:fixed;left:0;top:0;width:780px;background:#ffffff;color:#1e293b;padding:30px;z-index:99999;box-sizing:border-box;font-family:Inter,Arial,sans-serif;';

        const rowsHtml = monthTxs.length === 0 
            ? '<tr><td colspan="5" style="text-align:center;padding:20px;color:#64748b;">Nenhum lançamento no mês selecionado.</td></tr>'
            : monthTxs.map(t => {
                const cat = getCategoryById(t.categoryId);
                const isBR = t.country === 'BR';
                const tipo = t.type === 'income' ? 'Receita' : t.type === 'investment' ? 'Investimento' : 'Despesa';
                const cor = t.type === 'income' ? '#059669' : t.type === 'investment' ? '#8b5cf6' : '#dc2626';
                return `
                    <tr style="border-bottom:1px solid #e2e8f0;">
                        <td style="padding:8px 10px;font-size:12px;">${fmtDate(t.date)}</td>
                        <td style="padding:8px 10px;font-size:12px;font-weight:bold;color:${cor};">${tipo}</td>
                        <td style="padding:8px 10px;font-size:12px;">${cat.icon} ${cat.name}</td>
                        <td style="padding:8px 10px;font-size:12px;">${t.description || '-'} (${t.assignedTo || 'Casal'})</td>
                        <td style="padding:8px 10px;font-size:12px;text-align:right;font-weight:bold;color:${cor};">${fmtMoney(t.amount, isBR ? state.settings.currencyBR : state.settings.currencyES)}</td>
                    </tr>
                `;
            }).join('');

        container.innerHTML = `
            <div style="text-align:center;border-bottom:2px solid #1e3a5f;padding-bottom:14px;margin-bottom:20px;">
                <h1 style="color:#1e3a5f;font-size:22px;margin:0;">FinFam - Relatório Financeiro Familiar</h1>
                <h3 style="color:#64748b;font-size:15px;margin:6px 0 0;">Mês de Referência: ${monthName} (${ym})</h3>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:20px;gap:12px;">
                <div style="flex:1;background:#f0fdf4;border:1px solid #bbf7d0;padding:12px;border-radius:8px;text-align:center;">
                    <div style="font-size:11px;color:#166534;font-weight:bold;text-transform:uppercase;">Receitas</div>
                    <div style="font-size:18px;font-weight:bold;color:#166534;margin-top:4px;">${fmtMoney(monthIncome, state.settings.currencyES)}</div>
                </div>
                <div style="flex:1;background:#fef2f2;border:1px solid #fecaca;padding:12px;border-radius:8px;text-align:center;">
                    <div style="font-size:11px;color:#991b1b;font-weight:bold;text-transform:uppercase;">Despesas</div>
                    <div style="font-size:18px;font-weight:bold;color:#991b1b;margin-top:4px;">${fmtMoney(monthExpense, state.settings.currencyES)}</div>
                </div>
                <div style="flex:1;background:#f5f3ff;border:1px solid #ddd6fe;padding:12px;border-radius:8px;text-align:center;">
                    <div style="font-size:11px;color:#5b21b6;font-weight:bold;text-transform:uppercase;">Investimentos</div>
                    <div style="font-size:18px;font-weight:bold;color:#5b21b6;margin-top:4px;">${fmtMoney(monthInvestment, state.settings.currencyES)}</div>
                </div>
                <div style="flex:1;background:#f8fafc;border:1px solid #cbd5e1;padding:12px;border-radius:8px;text-align:center;">
                    <div style="font-size:11px;color:#334155;font-weight:bold;text-transform:uppercase;">Saldo Líquido</div>
                    <div style="font-size:18px;font-weight:bold;color:${monthBalance >= 0 ? '#059669' : '#dc2626'};margin-top:4px;">${fmtMoney(monthBalance, state.settings.currencyES)}</div>
                </div>
            </div>
            <h4 style="color:#1e3a5f;font-size:14px;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.5px;">Detalhamento das Movimentações (${monthTxs.length})</h4>
            <table style="width:100%;border-collapse:collapse;margin-top:8px;">
                <thead>
                    <tr style="background:#f1f5f9;border-bottom:2px solid #cbd5e1;text-align:left;">
                        <th style="padding:8px 10px;font-size:11px;color:#475569;">Data</th>
                        <th style="padding:8px 10px;font-size:11px;color:#475569;">Tipo</th>
                        <th style="padding:8px 10px;font-size:11px;color:#475569;">Categoria</th>
                        <th style="padding:8px 10px;font-size:11px;color:#475569;">Descrição</th>
                        <th style="padding:8px 10px;font-size:11px;color:#475569;text-align:right;">Valor</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
            <div style="margin-top:20px;text-align:right;font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:10px;">
                Emitido via FinFam em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}
            </div>
        `;

        document.body.appendChild(container);

        const opt = {
            margin: [8, 8, 8, 8],
            filename: `Relatorio_FinFam_${ym}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, logging: false },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        html2pdf().set(opt).from(container).save().then(() => {
            document.body.removeChild(container);
            showToast(`✅ PDF exportado com sucesso! (${monthTxs.length} registros)`);
        }).catch(err => {
            console.error('Erro ao gerar PDF:', err);
            if (document.body.contains(container)) document.body.removeChild(container);
            showToast('❌ Erro ao exportar PDF.', 'error');
        });
    };

    // ==================== CONFIGURAÇÕES ====================
    const renderSettings = () => `
        <div id="settings" class="page">
            <div style="margin-bottom: 24px;">
                <h1 style="color: var(--navy); margin: 0 0 4px 0; font-size: 24px; font-weight: 700;">Configurações</h1>
                <p style="color: var(--text-light); margin: 0; font-size: 14px;">Gerenciamento de conexões, usuários e preferências do FinFam</p>
            </div>

            <!-- CONEXÃO GOOGLE DRIVE -->
            <div class="card" style="padding: 24px; margin-bottom: 24px;">
                <h3 style="color: var(--navy); margin-top: 0; display: flex; align-items: center; gap: 8px;">
                    <span>☁️</span> Conexão Google Drive / Apps Script
                </h3>
                <div id="connectionStatus" style="margin-bottom: 16px;">
                    <span class="badge badge-info">Status: Não verificado</span>
                </div>
                <div class="form-group">
                    <label class="form-label">URL do Google Apps Script (Web App)</label>
                    <input type="url" id="settingScriptUrl" class="input-field" value="${state.settings.googleScriptUrl || ''}" placeholder="https://script.google.com/macros/s/.../exec">
                </div>
                <div class="form-group">
                    <label class="form-label">Token de Segurança da API</label>
                    <input type="text" id="settingApiToken" class="input-field" value="${state.settings.apiToken || DEFAULT_TOKEN}">
                </div>
                <div style="display: flex; gap: 12px; margin-top: 20px;">
                    <button class="btn-primary" onclick="App.saveSettings()">Salvar Conexão</button>
                    <button class="btn-secondary" onclick="App.checkConnection()">Testar Conexão</button>
                    <button class="btn-danger" onclick="App.syncFromDriveForce()">Forçar Download Completo</button>
                </div>
            </div>

            <!-- GERENCIAMENTO DE USUÁRIOS -->
            <div class="card" style="padding: 24px; margin-bottom: 24px;">
                <h3 style="color: var(--navy); margin-top: 0; display: flex; align-items: center; gap: 8px;">
                    <span>👥</span> Usuários da Família
                </h3>
                <div class="table-container" style="margin-bottom: 16px;">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Nome</th>
                                <th>E-mail</th>
                                <th>Papel</th>
                                <th style="text-align: right;">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${state.users.map(u => `
                                <tr>
                                    <td><strong>${u.name}</strong></td>
                                    <td>${u.email}</td>
                                    <td><span class="badge ${u.role === 'admin' ? 'badge-info' : 'badge-warning'}">${u.role}</span></td>
                                    <td style="text-align: right;">
                                        ${u.id !== state.currentUser?.id ? `
                                            <button onclick="App.deleteUser('${u.id}')" style="background:#fee2e2;color:#b91c1c;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;">Excluir</button>
                                        ` : '<span style="font-size:12px;color:var(--text-light)">Você</span>'}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div style="background:#f8fafc;padding:16px;border-radius:8px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
                    <div style="flex:1;min-width:140px;">
                        <label class="form-label">Nome</label>
                        <input type="text" id="newUserName" class="input-field" placeholder="Ex: Joyce">
                    </div>
                    <div style="flex:1;min-width:180px;">
                        <label class="form-label">E-mail</label>
                        <input type="email" id="newUserEmail" class="input-field" placeholder="email@exemplo.com">
                    </div>
                    <div style="width:100px;">
                        <label class="form-label">PIN</label>
                        <input type="password" id="newUserPin" class="input-field" placeholder="1234" maxlength="6">
                    </div>
                    <div style="width:120px;">
                        <label class="form-label">Perfil</label>
                        <select id="newUserRole" class="input-field">
                            <option value="member">Membro</option>
                            <option value="admin">Admin</option>
                        </select>
                    </div>
                    <button class="btn-primary" onclick="App.addUser()">Adicionar</button>
                </div>
            </div>
        </div>
    `;

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

        const userNames = Array.isArray(state.users) ? state.users.map(u => u.name).filter(Boolean) : [];
        const uniqueUsers = ['Casal', ...new Set(userNames)];
        const assignedValue = tx ? tx.assignedTo : 'Casal';
        if (assignedValue && !uniqueUsers.includes(assignedValue)) {
            uniqueUsers.push(assignedValue);
        }
        const assignedOptions = uniqueUsers.map(u => 
            `<option value="${u}" ${assignedValue === u ? 'selected' : ''}>${u === 'Casal' ? '👫 Casal / Ambos' : '👤 ' + u}</option>`
        ).join('');

        const currentType = tx ? tx.type : 'expense';
        const renderCategorySelectOptions = (type, selectedId) => {
            if (type === 'investment') {
                return `<option value="cat_invest_es" selected>📈 Investimentos & Aplicações</option>`;
            }
            const filtered = state.categories.filter(c => c.type === type);
            if (filtered.length === 0) return `<option value="cat_outros_es">📋 Geral</option>`;
            return filtered.map(c => 
                `<option value="${c.id}" ${selectedId === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`
            ).join('');
        };

        overlay.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h3 class="modal-title">${isEdit ? 'Editar Lançamento' : 'Novo Lançamento'}</h3>
                    <button class="close-btn" onclick="App.closeModal()">&times;</button>
                </div>
                <div class="form-group">
                    <label class="form-label">Data</label>
                    <input type="date" id="txDate" class="input-field" value="${tx ? tx.date : today}">
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div class="form-group">
                        <label class="form-label">Tipo</label>
                        <select id="txType" class="input-field" onchange="App.onTxTypeChange(this.value)">
                            <option value="expense" ${currentType === 'expense' ? 'selected' : ''}>Despesa</option>
                            <option value="income" ${currentType === 'income' ? 'selected' : ''}>Receita</option>
                            <option value="investment" ${currentType === 'investment' ? 'selected' : ''}>Investimento 📈</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">País / Moeda</label>
                        <select id="txCountry" class="input-field">
                            <option value="ES" ${tx && tx.country === 'ES' ? 'selected' : ''}>🇪🇸 Espanha (€)</option>
                            <option value="BR" ${tx && tx.country === 'BR' ? 'selected' : ''}>🇧🇷 Brasil (R$)</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Categoria</label>
                    <select id="txCategory" class="input-field">${renderCategorySelectOptions(currentType, tx ? tx.categoryId : '')}</select>
                </div>
                <div class="form-group">
                    <label class="form-label">Descrição</label>
                    <input type="text" id="txDescription" class="input-field" placeholder="Ex: Mercado semanal, Salário, Aporte..." value="${tx ? tx.description : ''}">
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div class="form-group">
                        <label class="form-label">Valor</label>
                        <input type="number" step="0.01" id="txAmount" class="input-field" placeholder="0,00" value="${tx ? tx.amount : ''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Responsável</label>
                        <select id="txAssigned" class="input-field">${assignedOptions}</select>
                    </div>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
                    <button class="btn-secondary" onclick="App.closeModal()">Cancelar</button>
                    <button class="btn-primary" onclick="App.saveTransaction('${tx ? tx.id : ''}')">${isEdit ? 'Atualizar' : 'Salvar'}</button>
                </div>
            </div>
        `;
        overlay.classList.add('active');
    };

    const closeModal = () => {
        const overlay = el('modalOverlay');
        if (overlay) overlay.classList.remove('active');
    };

    const onTxTypeChange = (newType) => {
        const catSelect = el('txCategory');
        if (!catSelect) return;
        if (newType === 'investment') {
            catSelect.innerHTML = `<option value="cat_invest_es" selected>📈 Investimentos & Aplicações</option>`;
            return;
        }
        const filtered = state.categories.filter(c => c.type === newType);
        if (filtered.length === 0) {
            catSelect.innerHTML = `<option value="cat_outros_es">📋 Geral</option>`;
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
        const categoryId = el('txCategory').value;
        const amount = parseFloat(el('txAmount').value);
        const date = el('txDate').value;
        const description = el('txDescription').value.trim();
        const country = el('txCountry').value;
        const assignedTo = el('txAssigned').value.trim() || 'Casal';

        if (!date || isNaN(amount) || amount <= 0) {
            showToast('⚠️ Preencha a data e um valor válido.', 'error');
            return;
        }

        const normalizedDate = parseDateToYMD(date);

        if (id) {
            const idx = state.transactions.findIndex(t => t.id === id);
            if (idx !== -1) {
                state.transactions[idx] = {
                    ...state.transactions[idx],
                    date: normalizedDate,
                    type,
                    categoryId,
                    amount,
                    description,
                    country,
                    assignedTo
                };
                showToast('✅ Lançamento atualizado!');
            }
        } else {
            const newTx = {
                id: generateId(),
                date: normalizedDate,
                type,
                categoryId,
                amount,
                description,
                country,
                assignedTo
            };
            state.transactions.unshift(newTx);
            showToast('✅ Lançamento adicionado!');
        }

        closeModal();
        saveState();
        refreshAllViews();
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
            syncToDrive();
            showToast('🗑️ Lançamento excluído com sucesso!');
        }
    };

    // ==================== GRÁFICOS DO DASHBOARD ====================
    const initDashboardCharts = () => {
        const data = getSelectedMonthData();
        const ctxExpenses = el('chartExpensesES');
        const ctxComp = el('chartComparison');

        if (charts.expenses) charts.expenses.destroy();
        if (charts.comp) charts.comp.destroy();

        if (ctxExpenses) {
            const expensesByCat = {};
            data.transactions.filter(t => t.country === 'ES' && t.type === 'expense').forEach(t => {
                const cat = getCategoryById(t.categoryId);
                expensesByCat[cat.name] = (expensesByCat[cat.name] || 0) + t.amount;
            });

            const labels = Object.keys(expensesByCat);
            const values = Object.values(expensesByCat);

            charts.expenses = new Chart(ctxExpenses, {
                type: 'doughnut',
                data: {
                    labels: labels.length ? labels : ['Sem dados'],
                    datasets: [{
                        data: values.length ? values : [1],
                        backgroundColor: values.length ? [
                            '#1e3a5f', '#059669', '#dc2626', '#d97706', '#8b5cf6', '#3b82f6', '#ec4899', '#14b8a6'
                        ] : ['#cbd5e1']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom' } }
                }
            });
        }

        if (ctxComp) {
            charts.comp = new Chart(ctxComp, {
                type: 'bar',
                data: {
                    labels: ['Espanha (€)', 'Brasil (R$)'],
                    datasets: [
                        {
                            label: 'Receitas',
                            data: [data.incomeES, data.incomeBR],
                            backgroundColor: '#059669'
                        },
                        {
                            label: 'Despesas',
                            data: [data.expenseES, data.expenseBR],
                            backgroundColor: '#dc2626'
                        },
                        {
                            label: 'Investimentos',
                            data: [data.investES, data.investBR],
                            backgroundColor: '#8b5cf6'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true } }
                }
            });
        }
    };

    // ==================== CONTROLE DE NAVEGAÇÃO E TELAS ====================
    const nav = (element) => {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        element.classList.add('active');
        const targetPage = element.getAttribute('data-page');
        const p = el(targetPage);
        if (p) p.classList.add('active');
        
        if (targetPage === 'dashboard') {
            const dash = el('dashboard');
            if (dash) {
                dash.innerHTML = renderDashboard();
                setTimeout(initDashboardCharts, 50);
            }
        } else if (targetPage === 'transactions') {
            const txs = el('transactions');
            if (txs) txs.innerHTML = renderTransactions();
        } else if (targetPage === 'reports') {
            const reports = el('reports');
            if (reports) reports.innerHTML = renderMonthlyReport();
        } else if (targetPage === 'settings') {
            checkConnection();
            const settingsPage = el('settings');
            if (settingsPage) settingsPage.innerHTML = renderSettings();
        }
    };

    const changeMonth = (m) => {
        state.selectedMonth = m;
        saveState();
        refreshAllViews();
    };

    const changeSelectedMonth = (m) => {
        state.selectedMonth = m;
        saveState();
        refreshAllViews();
    };

    const changeReportMonth = (m) => {
        state.selectedMonth = m;
        saveState();
        const rPage = el('reports');
        if (rPage) rPage.innerHTML = renderMonthlyReport();
    };

    const filterByCountry = (c) => {
        state.filterCountry = c;
        const txPage = el('transactions');
        if (txPage) txPage.innerHTML = renderTransactions();
    };

    const filterByType = (t) => {
        state.filterType = t;
        const txPage = el('transactions');
        if (txPage) txPage.innerHTML = renderTransactions();
    };

    const refreshAllViews = () => {
        const app = el('app');
        if (!app || !state.currentUser) return;

        const activeItem = document.querySelector('.nav-item.active');
        const activePageId = activeItem ? activeItem.getAttribute('data-page') : 'dashboard';

        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            mainContent.innerHTML = `
                ${renderDashboard()}
                ${renderTransactions()}
                ${renderInvestments()}
                ${renderMonthlyReport()}
                ${state.currentUser.role === 'admin' ? renderSettings() : ''}
            `;
            
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            const curPage = el(activePageId);
            if (curPage) curPage.classList.add('active');
            
            if (activePageId === 'dashboard') {
                setTimeout(initDashboardCharts, 50);
            }
        }
    };

    const renderApp = () => {
        const app = el('app');
        if (!app) return;

        if (!state.currentUser) {
            app.innerHTML = renderLogin();
            return;
        }

        app.innerHTML = `
            ${renderSidebar()}
            <main class="main-content">
                ${renderDashboard()}
                ${renderTransactions()}
                ${renderInvestments()}
                ${renderMonthlyReport()}
                ${state.currentUser.role === 'admin' ? renderSettings() : ''}
            </main>
            <div id="modalOverlay" class="modal-overlay"></div>
            <div id="toast" class="toast"></div>
        `;

        setTimeout(initDashboardCharts, 100);
    };

    const handleLogin = () => {
        const email = el('loginEmail').value;
        const pin = el('loginPin').value;
        login(email, pin);
    };

    const saveSettings = () => {
        const url = el('settingScriptUrl').value.trim();
        const token = el('settingApiToken').value.trim();
        state.settings.googleScriptUrl = url;
        state.settings.apiToken = token || DEFAULT_TOKEN;
        saveState();
        showToast('✅ Configurações salvas!');
        checkConnection();
    };

    const addUser = () => {
        const name = el('newUserName').value.trim();
        const email = el('newUserEmail').value.trim();
        const pin = el('newUserPin').value.trim();
        const role = el('newUserRole').value;

        if (!name || !email || !pin) {
            showToast('⚠️ Preencha todos os campos do usuário.', 'error');
            return;
        }

        state.users.push({ id: generateId(), name, email, pin, role });
        saveState();
        showToast('✅ Novo usuário adicionado com sucesso!');
        const sPage = el('settings');
        if (sPage) sPage.innerHTML = renderSettings();
    };

    const deleteUser = (id) => {
        if (confirm('Deseja excluir este usuário?')) {
            state.users = state.users.filter(u => u.id !== id);
            saveState();
            showToast('🗑️ Usuário removido!');
            const sPage = el('settings');
            if (sPage) sPage.innerHTML = renderSettings();
        }
    };

    // ==================== INICIALIZAÇÃO ====================
    const init = () => {
        loadState();
        renderApp();

        if (state.currentUser) {
            setupInactivityListeners();
            startSessionCountdown();
            if (state.settings.googleScriptUrl) {
                setConnectionProgress(15, 'Iniciando conexão com o Drive...');
                syncFromDrive(true).then(() => {
                    hideConnectionOverlay();
                    refreshAllViews();
                }).catch(() => {
                    hideConnectionOverlay();
                });
            } else {
                isDriveConnected = true;
            }
        }
    };

    // Interface pública do FinFam
    return {
        init,
        nav,
        changeMonth,
        changeSelectedMonth,
        changeReportMonth,
        filterByCountry,
        filterByType,
        showTransactionModal,
        onTxTypeChange,
        closeModal,
        saveTransaction,
        deleteTransaction,
        exportToPDF,
        exportToCSV,
        saveSettings,
        checkConnection,
        syncFromDrive,
        syncFromDriveForce,
        syncToDrive,
        handleLogin,
        logout,
        addUser,
        deleteUser
    };
})();

// Alias para compatibilidade total com o index.html
const App = FinFam;

document.addEventListener('DOMContentLoaded', FinFam.init);
