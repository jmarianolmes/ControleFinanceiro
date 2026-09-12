/**
 * FinFam - Controle Financeiro Familiar
 * Versão Consolidada: Categorias Unificadas, Investimento Fixo e Multi-moeda (ES/BR)
 */

const App = (() => {
    const STORAGE_KEY = 'finfam_app_state_v1';
    const SESSION_KEY = 'finfam_session_v1';
    const DEFAULT_TOKEN = 'finfam_secret_token_2026';

    let isDriveConnected = false;

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

    const fmtDate = d => {
        if (!d) return '-';
        const s = String(d).trim();
        const brMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (brMatch) return `${brMatch[1].padStart(2, '0')}/${brMatch[2].padStart(2, '0')}/${brMatch[3]}`;
        const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
        try {
            const dt = new Date(s);
            if (!isNaN(dt.getTime())) return dt.toLocaleDateString('pt-BR');
        } catch (e) {}
        return s;
    };

    const fmtMoney = (val, currency = '€') => {
        if (state.privacyMode) return '••••••';
        const n = Number(val) || 0;
        return `${currency} ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const generateId = () => 'tx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    const showToast = (msg, type = 'success') => {
        const t = el('toast');
        if (!t) return;
        t.textContent = msg;
        t.className = `toast ${type} show`;
        setTimeout(() => { t.className = 'toast'; }, 3500);
    };

    // ==================== CATEGORIAS PADRÃO UNIFICADAS ====================
    const defaultCategories = [
        // RECEITAS
        { id: 'cat_salario', aliases: ['cat_salario_es'], name: 'Salário', type: 'income', icon: '💼' },
        { id: 'cat_freelance', aliases: ['cat_freelance_es'], name: 'Freelance / Extras', type: 'income', icon: '💻' },
        { id: 'cat_aluguel_rec', aliases: ['cat_aluguel_br'], name: 'Aluguel Recebido', type: 'income', icon: '🏠' },
        { id: 'cat_rendimentos', aliases: [], name: 'Rendimentos & Dividendos', type: 'income', icon: '💰' },
        { id: 'cat_outras_receitas', aliases: ['cat_outras_entradas_es'], name: 'Outras Receitas', type: 'income', icon: '💶' },

        // INVESTIMENTOS (Categoria única fixa)
        { id: 'cat_investimentos', aliases: ['cat_invest_es', 'cat_invest_br'], name: 'Investimentos & Aplicações', type: 'investment', icon: '📈' },

        // DESPESAS
        { id: 'cat_moradia', aliases: ['cat_aluguel_es'], name: 'Aluguel / Moradia', type: 'expense', icon: '🔑' },
        { id: 'cat_hipoteca', aliases: ['cat_hipoteca_es'], name: 'Financiamento / Hipoteca', type: 'expense', icon: '🏛️' },
        { id: 'cat_mercado', aliases: [], name: 'Supermercado / Alimentação', type: 'expense', icon: '🛒' },
        { id: 'cat_contas', aliases: ['cat_agua', 'cat_luz', 'cat_gas'], name: 'Contas (Água / Luz / Gás)', type: 'expense', icon: '⚡' },
        { id: 'cat_educacao', aliases: ['cat_escola'], name: 'Educação / Filhos', type: 'expense', icon: '🎒' },
        { id: 'cat_transporte', aliases: ['cat_veiculo'], name: 'Transporte / Veículo', type: 'expense', icon: '🚗' },
        { id: 'cat_lazer', aliases: [], name: 'Lazer & Família', type: 'expense', icon: '🎬' },
        { id: 'cat_cartao', aliases: ['cat_cc_br'], name: 'Cartão de Crédito', type: 'expense', icon: '💳' },
        { id: 'cat_outras_despesas', aliases: ['cat_outros_es', 'cat_outros_br'], name: 'Outras Despesas', type: 'expense', icon: '📋' }
    ];

    const getCategoryById = (catId) => {
        if (!catId) return { name: 'Geral', icon: '📋' };
        const found = (state.categories || defaultCategories).find(c => 
            c.id === catId || (c.aliases && c.aliases.includes(catId))
        );
        return found || { name: 'Geral', icon: '📋' };
    };

    // ==================== OVERLAY DE CONEXÃO ====================
    const showConnectionProgress = (msg = 'Conectando ao banco de dados no Google Drive...') => {
        let overlay = el('finfam-conn-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'finfam-conn-overlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.85);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;backdrop-filter:blur(4px);';
            overlay.innerHTML = `
                <div style="background:#1e293b;padding:32px;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,0.5);text-align:center;max-width:420px;width:90%;">
                    <div style="font-size:36px;margin-bottom:12px;">🔄</div>
                    <h3 id="finfam-conn-title" style="margin:0 0 8px 0;font-size:18px;color:#fff;">Sincronizando com o Drive</h3>
                    <p id="finfam-conn-msg" style="margin:0 0 20px 0;font-size:13px;color:#94a3b8;">${msg}</p>
                    <div style="width:100%;height:6px;background:#334155;border-radius:3px;overflow:hidden;position:relative;">
                        <div id="finfam-conn-bar" style="width:30%;height:100%;background:#10b981;border-radius:3px;transition:width 0.3s;animation:finfam-pulse 1.5s infinite linear;"></div>
                    </div>
                </div>
                <style>
                    @keyframes finfam-pulse {
                        0% { margin-left: 0%; width: 25%; }
                        50% { margin-left: 50%; width: 45%; }
                        100% { margin-left: 100%; width: 10%; }
                    }
                </style>
            `;
            document.body.appendChild(overlay);
        } else {
            const m = el('finfam-conn-msg');
            if (m) m.textContent = msg;
            overlay.style.display = 'flex';
        }
    };

    const hideConnectionProgress = () => {
        const overlay = el('finfam-conn-overlay');
        if (overlay) overlay.style.display = 'none';
    };

    // ==================== SINCRONIZAÇÃO GOOGLE DRIVE ====================
    const syncToDrive = async () => {
        const url = state.settings.googleScriptUrl;
        if (!url) return;
        try {
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'sync',
                    token: state.settings.apiToken || DEFAULT_TOKEN,
                    transactions: state.transactions
                })
            });
            console.log('☁️ Backup salvo no Drive.');
        } catch (e) {
            console.error('Falha ao gravar no Drive:', e);
        }
    };

    const syncFromDrive = async (silent = false) => {
        const url = state.settings.googleScriptUrl;
        if (!url) {
            isDriveConnected = true;
            hideConnectionProgress();
            return;
        }

        if (!silent) showConnectionProgress('Carregando dados da planilha do Google Drive...');

        try {
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
                    let d = t.date || t.Data || '';
                    let normDate = '';
                    if (d) {
                        d = String(d).trim();
                        if (/^\d{4}-\d{2}-\d{2}/.test(d)) {
                            normDate = d.slice(0, 10);
                        } else {
                            const br = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                            if (br) normDate = `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
                            else {
                                try {
                                    const dt = new Date(d);
                                    if (!isNaN(dt.getTime())) normDate = dt.toISOString().slice(0, 10);
                                } catch (e) {}
                            }
                        }
                    }
                    if (!normDate) normDate = new Date().toISOString().slice(0, 10);

                    return {
                        id: String(t.id || t.ID || generateId()),
                        date: normDate,
                        type: String(t.type || t.Tipo || 'expense').toLowerCase(),
                        categoryId: t.categoryId || t.Categoria || 'cat_outras_despesas',
                        description: t.description || t.Descrição || '',
                        assignedTo: t.assignedTo || t.Responsável || 'Casal',
                        country: String(t.country || t.País || 'ES').toUpperCase(),
                        amount: Number(t.amount || t.Valor || 0)
                    };
                });

                // Merge seguro mantendo pendências locais
                const driveIds = new Set(normalized.map(t => t.id));
                const localPendentes = state.transactions.filter(t => !driveIds.has(t.id));
                state.transactions = [...normalized, ...localPendentes];
                saveState();
                isDriveConnected = true;
                hideConnectionProgress();
                refreshAllViews();

                if (localPendentes.length > 0) syncToDrive();
                if (!silent) showToast(`✅ ${state.transactions.length} registros atualizados!`);
            } else {
                throw new Error('Resposta inválida do Apps Script');
            }
        } catch (e) {
            console.warn('Google Drive offline ou inacessível no momento:', e);
            isDriveConnected = true;
            hideConnectionProgress();
            if (!silent) showToast('⚠️ Sem resposta do Drive. Usando dados locais.', 'error');
        }
    };

    // ==================== ESTADO E SESSÃO ====================
    const initState = () => {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                state = parsed;
                state.categories = [...defaultCategories];
                if (!state.selectedMonth) state.selectedMonth = new Date().toISOString().slice(0, 7);
            } catch (e) { resetState(); }
        } else { resetState(); }
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

    const isSetup = () => state.users && state.users.length > 0;

    const isLoggedIn = () => {
        const sess = getSession();
        return !!sess && !!state.currentUser;
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

    const resetInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
            clearSession();
            renderLogin();
            showToast('Sessão expirada por inatividade', 'info');
        }, 15 * 60 * 1000);
    };

    const togglePrivacy = () => {
        state.privacyMode = !state.privacyMode;
        saveState();
        refreshAllViews();
    };

    // ==================== NAVEGAÇÃO ====================
    const nav = (element) => {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        element.classList.add('active');
        const targetPage = element.getAttribute('data-page');
        const p = el(targetPage);
        if (p) p.classList.add('active');

        if (targetPage === 'reports') {
            const rc = el('reportContainer');
            if (rc) rc.innerHTML = renderMonthlyReport();
        } else if (targetPage === 'transactions') {
            const tb = el('transactionsTable');
            if (tb) tb.innerHTML = renderTransactionsTable();
        } else if (targetPage === 'dashboard') {
            const d = el('dashboard');
            if (d) d.innerHTML = renderDashboard();
        }
    };

    const refreshAllViews = () => {
        const activePage = document.querySelector('.page.active')?.id || 'dashboard';
        if (activePage === 'dashboard') {
            const dash = el('dashboard');
            if (dash) dash.innerHTML = renderDashboard();
        }
        if (activePage === 'transactions') {
            const txTable = el('transactionsTable');
            if (txTable) txTable.innerHTML = renderTransactionsTable();
        }
        if (activePage === 'reports') {
            const rc = el('reportContainer');
            if (rc) rc.innerHTML = renderMonthlyReport();
        }
        const monthPicker = el('dashMonthPicker');
        if (monthPicker) monthPicker.value = state.selectedMonth;
    };
    // ==================== CÁLCULOS DO DASHBOARD ====================
    const getSelectedMonthData = () => {
        const ym = state.selectedMonth;
        const txs = (state.transactions || []).filter(t => {
            if (!t || !t.date) return false;
            return getYearMonth(t.date) === ym;
        }).sort((a, b) => (b.date > a.date ? 1 : -1));

        const income = txs.filter(t => (t.type || '').toLowerCase() === 'income')
                          .reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const expense = txs.filter(t => (t.type || '').toLowerCase() === 'expense')
                           .reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const investment = txs.filter(t => (t.type || '').toLowerCase() === 'investment')
                              .reduce((s, t) => s + (Number(t.amount) || 0), 0);

        const balance = income - expense - investment;
        const totalInvestments = (state.transactions || [])
            .filter(t => (t.type || '').toLowerCase() === 'investment')
            .reduce((s, t) => s + (Number(t.amount) || 0), 0);

        const totalIncomeAll = (state.transactions || [])
            .filter(t => (t.type || '').toLowerCase() === 'income')
            .reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const totalExpenseAll = (state.transactions || [])
            .filter(t => (t.type || '').toLowerCase() === 'expense')
            .reduce((s, t) => s + (Number(t.amount) || 0), 0);

        const netWorth = (totalIncomeAll - totalExpenseAll);

        return { ym, txs, income, expense, investment, balance, netWorth, totalInvestments };
    };

    const changeSelectedMonth = (ym) => {
        if (!ym) return;
        state.selectedMonth = ym;
        saveState();
        refreshAllViews();
    };

    // ==================== RENDERIZAÇÃO DASHBOARD ====================
    const renderDashboard = () => {
        const m = getSelectedMonthData();
        const expByCategory = {};
        m.txs.filter(t => (t.type || '').toLowerCase() === 'expense').forEach(t => {
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
            <div class="card stat-card net-worth-card">
                <div class="stat-label">🏦 Patrimônio Total</div>
                <div class="net-worth-value">${fmtMoney(m.netWorth, state.settings.currencyES)}</div>
                <div style="font-size:11px;color:var(--text-light);margin-top:4px;">
                    Investimentos Acumulados: ${fmtMoney(m.totalInvestments, state.settings.currencyES)}
                </div>
            </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;margin-bottom:24px">
            <div class="card" style="padding:24px">
                <h3 style="margin:0 0 20px;font-size:16px;color:var(--navy);display:flex;align-items:center;gap:8px">📊 Gastos por Categoria</h3>
                ${sortedCats.length === 0 ? '<p style="color:var(--text-light);font-size:14px">Sem despesas registradas no período.</p>' : 
                    sortedCats.slice(0, 5).map(([cat, val]) => {
                        const pct = m.expense > 0 ? ((val / m.expense) * 100).toFixed(1) : 0;
                        return `<div style="margin-bottom:16px">
                            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;font-weight:600;color:var(--navy)">
                                <span>${cat}</span>
                                <span>${fmtMoney(val, state.settings.currencyES)} (${pct}%)</span>
                            </div>
                            <div style="width:100%;background:#f1f5f9;height:8px;border-radius:4px;overflow:hidden">
                                <div style="width:${pct}%;background:var(--navy);height:100%"></div>
                            </div>
                        </div>`;
                    }).join('')
                }
            </div>
            <div class="card" style="padding:24px">
                <h3 style="margin:0 0 20px;font-size:16px;color:var(--navy)">⚡ Lançamentos Recentes do Mês</h3>
                ${m.txs.length === 0 ? '<p style="color:var(--text-light);font-size:14px">Nenhuma transação registrada neste mês.</p>' : `
                    <div class="table-container">
                        <table class="data-table">
                            <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th style="text-align:right">Valor</th></tr></thead>
                            <tbody>${m.txs.slice(0, 5).map(t => {
                                const isInc = (t.type || '').toLowerCase() === 'income';
                                const isInv = (t.type || '').toLowerCase() === 'investment';
                                const moeda = (t.country === 'BR') ? state.settings.currencyBR : state.settings.currencyES;
                                return `<tr>
                                    <td>${fmtDate(t.date)}</td>
                                    <td><span class="badge ${isInc ? 'badge-success' : isInv ? 'badge-purple' : 'badge-danger'}">${isInc ? 'Receita' : isInv ? 'Investimento' : 'Despesa'}</span></td>
                                    <td>${t.description || '-'}</td>
                                    <td style="text-align:right;font-weight:600;" class="${isInc ? 'emerald-text' : isInv ? '' : 'danger-text'}">
                                        ${isInc ? '+' : isInv ? '' : '-'}${fmtMoney(t.amount, moeda)}
                                    </td>
                                </tr>`;
                            }).join('')}</tbody>
                        </table>
                    </div>
                `}
            </div>
        </div>`;
    };

    // ==================== LISTA DE TRANSAÇÕES ====================
    const renderTransactionRow = (t) => {
        const cat = getCategoryById(t.categoryId);
        const isBR = (t.country === 'BR');
        const moeda = isBR ? (state.settings.currencyBR || 'R$') : (state.settings.currencyES || '€');
        const typeStr = (t.type || '').toLowerCase();

        let typeBadge = '<span class="badge badge-danger">Despesa</span>';
        let valClass = 'danger-text';
        let sinal = '-';

        if (typeStr === 'income') {
            typeBadge = '<span class="badge badge-success">Receita</span>';
            valClass = 'emerald-text';
            sinal = '+';
        } else if (typeStr === 'investment') {
            typeBadge = '<span class="badge badge-purple" style="background:#ede9fe;color:#8b5cf6;">Investimento</span>';
            valClass = '';
            sinal = '';
        }

        return `<tr>
            <td style="white-space:nowrap">${fmtDate(t.date)}</td>
            <td>${typeBadge}</td>
            <td><span class="category-tag">${cat.icon} ${cat.name}</span></td>
            <td><strong>${t.description || '-'}</strong></td>
            <td>${t.assignedTo || 'Casal'}</td>
            <td>${isBR ? '🇧🇷 BR' : '🇪🇸 ES'}</td>
            <td style="text-align:right;font-weight:700" class="${valClass}">
                ${sinal}${fmtMoney(t.amount, moeda)}
            </td>
            <td style="text-align:right;white-space:nowrap">
                <button onclick="App.showTransactionModal('${t.id}')" style="background:none;border:none;cursor:pointer;font-size:16px;margin-right:6px;" title="Editar">✏️</button>
                <button onclick="App.deleteTransaction('${t.id}')" style="background:none;border:none;cursor:pointer;font-size:16px;" title="Excluir">🗑️</button>
            </td>
        </tr>`;
    };

    const renderTransactionsTable = () => {
        const txs = (state.transactions || []).slice().sort((a, b) => (b.date > a.date ? 1 : -1));
        if (txs.length === 0) return `<div class="empty-state"><p>Nenhum lançamento cadastrado no banco de dados.</p></div>`;
        return `
        <div class="table-container">
            <table class="data-table">
                <thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th>Responsável</th><th>País</th><th style="text-align:right">Valor</th><th style="text-align:right">Ações</th></tr></thead>
                <tbody>${txs.map(t => renderTransactionRow(t)).join('')}</tbody>
            </table>
        </div>`;
    };

    const renderTransactions = () => `
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

    // ==================== RELATÓRIOS MENSAIS ====================
    const renderMonthlyReport = () => {
        const selMonth = state.selectedMonth || new Date().toISOString().slice(0, 7);
        const txs = (state.transactions || []).filter(t => t && t.date && getYearMonth(t.date) === selMonth)
                                              .sort((a, b) => (b.date > a.date ? 1 : -1));

        const currES = state.settings.currencyES || '€';
        const currBR = state.settings.currencyBR || 'R$';

        // Espanha
        const recES = txs.filter(t => (t.country || 'ES').toUpperCase() === 'ES' && (t.type || '').toLowerCase() === 'income');
        const expES = txs.filter(t => (t.country || 'ES').toUpperCase() === 'ES' && (t.type || '').toLowerCase() === 'expense');
        const invES = txs.filter(t => (t.country || 'ES').toUpperCase() === 'ES' && (t.type || '').toLowerCase() === 'investment');
        const totRecES = recES.reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const totExpES = expES.reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const totInvES = invES.reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const saldoES = totRecES - totExpES - totInvES;

        // Brasil
        const recBR = txs.filter(t => (t.country || '').toUpperCase() === 'BR' && (t.type || '').toLowerCase() === 'income');
        const expBR = txs.filter(t => (t.country || '').toUpperCase() === 'BR' && (t.type || '').toLowerCase() === 'expense');
        const invBR = txs.filter(t => (t.country || '').toUpperCase() === 'BR' && (t.type || '').toLowerCase() === 'investment');
        const totRecBR = recBR.reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const totExpBR = expBR.reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const totInvBR = invBR.reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const saldoBR = totRecBR - totExpBR - totInvBR;

        const renderSubTable = (lista, moeda, cor = '') => {
            if (!lista.length) return `<tr><td colspan="5" style="text-align:center;color:var(--text-light);padding:14px;">Nenhum registro.</td></tr>`;
            return lista.map(t => {
                const cat = getCategoryById(t.categoryId);
                return `<tr>
                    <td>${fmtDate(t.date)}</td>
                    <td><strong>${t.description || '-'}</strong></td>
                    <td>${cat.icon} ${cat.name}</td>
                    <td>${t.assignedTo || 'Casal'}</td>
                    <td style="text-align:right;font-weight:600;" class="${cor}">${fmtMoney(t.amount, moeda)}</td>
                </tr>`;
            }).join('');
        };

        return `
        <div id="reportContainer">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:16px;">
                <div>
                    <h2 style="color:var(--navy);margin:0 0 4px 0;">Relatório Mensal Consolidado</h2>
                    <p style="color:var(--text-light);margin:0;font-size:14px;">Total de ${txs.length} movimentação(ões) no período selecionado</p>
                </div>
                <div style="display:flex;gap:12px;align-items:center;">
                    <input type="month" id="reportMonthPicker" class="input-field" value="${selMonth}" onchange="App.changeReportMonth(this.value)" style="width:auto;">
                    <button class="btn-secondary" onclick="App.exportToPDF()">📄 PDF</button>
                    <button class="btn-secondary" onclick="App.exportToCSV()">📊 Excel / CSV</button>
                </div>
            </div>

            <!-- SEÇÃO ESPANHA 🇪🇸 -->
            <div class="card" style="padding:24px;margin-bottom:24px;">
                <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid var(--border);padding-bottom:12px;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
                    <h3 style="color:var(--navy);margin:0;">🇪🇸 Espanha</h3>
                    <div style="font-size:14px;font-weight:600;">
                        <span class="emerald-text">Rec: +${fmtMoney(totRecES, currES)}</span> | 
                        <span class="danger-text">Desp: -${fmtMoney(totExpES, currES)}</span> | 
                        <span style="color:#8b5cf6">Inv: ${fmtMoney(totInvES, currES)}</span> | 
                        <span>Saldo: <strong>${fmtMoney(saldoES, currES)}</strong></span>
                    </div>
                </div>

                <h4 style="color:var(--emerald);margin:12px 0 8px 0;">🟢 Receitas (+${fmtMoney(totRecES, currES)})</h4>
                <div class="table-container" style="margin-bottom:20px;">
                    <table class="data-table">
                        <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Responsável</th><th style="text-align:right">Valor</th></tr></thead>
                        <tbody>${renderSubTable(recES, currES, 'emerald-text')}</tbody>
                    </table>
                </div>

                <h4 style="color:var(--danger);margin:12px 0 8px 0;">🔴 Despesas (-${fmtMoney(totExpES, currES)})</h4>
                <div class="table-container" style="margin-bottom:20px;">
                    <table class="data-table">
                        <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Responsável</th><th style="text-align:right">Valor</th></tr></thead>
                        <tbody>${renderSubTable(expES, currES, 'danger-text')}</tbody>
                    </table>
                </div>

                ${invES.length > 0 ? `
                    <h4 style="color:#8b5cf6;margin:12px 0 8px 0;">🟣 Investimentos (${fmtMoney(totInvES, currES)})</h4>
                    <div class="table-container">
                        <table class="data-table">
                            <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Responsável</th><th style="text-align:right">Valor</th></tr></thead>
                            <tbody>${renderSubTable(invES, currES, '')}</tbody>
                        </table>
                    </div>
                ` : ''}
            </div>

            <!-- SEÇÃO BRASIL 🇧🇷 -->
            <div class="card" style="padding:24px;">
                <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid var(--border);padding-bottom:12px;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
                    <h3 style="color:var(--navy);margin:0;">🇧🇷 Brasil</h3>
                    <div style="font-size:14px;font-weight:600;">
                        <span class="emerald-text">Rec: +${fmtMoney(totRecBR, currBR)}</span> | 
                        <span class="danger-text">Desp: -${fmtMoney(totExpBR, currBR)}</span> | 
                        <span style="color:#8b5cf6">Inv: ${fmtMoney(totInvBR, currBR)}</span> | 
                        <span>Saldo: <strong>${fmtMoney(saldoBR, currBR)}</strong></span>
                    </div>
                </div>

                <h4 style="color:var(--emerald);margin:12px 0 8px 0;">🟢 Receitas (+${fmtMoney(totRecBR, currBR)})</h4>
                <div class="table-container" style="margin-bottom:20px;">
                    <table class="data-table">
                        <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Responsável</th><th style="text-align:right">Valor</th></tr></thead>
                        <tbody>${renderSubTable(recBR, currBR, 'emerald-text')}</tbody>
                    </table>
                </div>

                <h4 style="color:var(--danger);margin:12px 0 8px 0;">🔴 Despesas (-${fmtMoney(totExpBR, currBR)})</h4>
                <div class="table-container" style="margin-bottom:20px;">
                    <table class="data-table">
                        <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Responsável</th><th style="text-align:right">Valor</th></tr></thead>
                        <tbody>${renderSubTable(expBR, currBR, 'danger-text')}</tbody>
                    </table>
                </div>

                ${invBR.length > 0 ? `
                    <h4 style="color:#8b5cf6;margin:12px 0 8px 0;">🟣 Investimentos (${fmtMoney(totInvBR, currBR)})</h4>
                    <div class="table-container">
                        <table class="data-table">
                            <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Responsável</th><th style="text-align:right">Valor</th></tr></thead>
                            <tbody>${renderSubTable(invBR, currBR, '')}</tbody>
                        </table>
                    </div>
                ` : ''}
            </div>
        </div>`;
    };

    const changeReportMonth = (ym) => {
        if (!ym) return;
        state.selectedMonth = ym;
        saveState();
        const rc = el('reportContainer');
        if (rc) rc.innerHTML = renderMonthlyReport();
        const dp = el('dashMonthPicker');
        if (dp) dp.value = ym;
    };

    // ==================== EXPORTAÇÃO EXCEL / CSV ====================
    const exportToCSV = () => {
        const ym = state.selectedMonth || new Date().toISOString().slice(0, 7);
        const txs = (state.transactions || []).filter(t => t && t.date && getYearMonth(t.date) === ym)
                                              .sort((a, b) => (b.date > a.date ? 1 : -1));

        if (!txs.length) {
            showToast('⚠️ Nenhum lançamento para exportar neste mês.', 'error');
            return;
        }

        const [ano, mes] = ym.split('-');
        const nomeMes = new Date(parseInt(ano), parseInt(mes) - 1, 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

        const recES = txs.filter(t => (t.country || 'ES').toUpperCase() === 'ES' && (t.type || '').toLowerCase() === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
        const expES = txs.filter(t => (t.country || 'ES').toUpperCase() === 'ES' && (t.type || '').toLowerCase() === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);
        const invES = txs.filter(t => (t.country || 'ES').toUpperCase() === 'ES' && (t.type || '').toLowerCase() === 'investment').reduce((s, t) => s + Number(t.amount || 0), 0);
        const recBR = txs.filter(t => (t.country || '').toUpperCase() === 'BR' && (t.type || '').toLowerCase() === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
        const expBR = txs.filter(t => (t.country || '').toUpperCase() === 'BR' && (t.type || '').toLowerCase() === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);
        const invBR = txs.filter(t => (t.country || '').toUpperCase() === 'BR' && (t.type || '').toLowerCase() === 'investment').reduce((s, t) => s + Number(t.amount || 0), 0);

        let csv = 'sep=;\n';
        csv += `RELATÓRIO FINANCEIRO FAMILIAR - FINFAM;;;;;\n`;
        csv += `Período:;${nomeMes.toUpperCase()};;;;\n`;
        csv += `Total de Lançamentos:;${txs.length};;;;\n\n`;

        csv += `--- RESUMO FINANCEIRO ---;;;;;\n`;
        csv += `Espanha (EUR);Receitas:;€ ${recES.toFixed(2).replace('.', ',')};Despesas:;€ ${expES.toFixed(2).replace('.', ',')};Investimentos:;€ ${invES.toFixed(2).replace('.', ',')};Saldo:;€ ${(recES - expES - invES).toFixed(2).replace('.', ',')}\n`;
        csv += `Brasil (BRL);Receitas:;R$ ${recBR.toFixed(2).replace('.', ',')};Despesas:;R$ ${expBR.toFixed(2).replace('.', ',')};Investimentos:;R$ ${invBR.toFixed(2).replace('.', ',')};Saldo:;R$ ${(recBR - expBR - invBR).toFixed(2).replace('.', ',')}\n\n`;

        csv += `--- DETALHAMENTO DAS MOVIMENTAÇÕES ---;;;;;\n`;
        csv += `Data;Tipo;País;Categoria;Descrição;Responsável;Moeda;Valor Numérico\n`;

        txs.forEach(t => {
            const cat = getCategoryById(t.categoryId).name;
            const typeStr = (t.type || '').toLowerCase();
            const tipo = typeStr === 'income' ? 'Receita' : typeStr === 'investment' ? 'Investimento' : 'Despesa';
            const pais = (t.country || 'ES').toUpperCase();
            const moeda = pais === 'BR' ? 'BRL' : 'EUR';
            const numVal = Number(t.amount || 0);
            const valForm = (typeStr === 'expense' ? -numVal : numVal).toFixed(2).replace('.', ',');
            const desc = (t.description || '-').replace(/;/g, ',');
            const resp = (t.assignedTo || 'Casal').replace(/;/g, ',');

            csv += `${fmtDate(t.date)};${tipo};${pais};${cat};${desc};${resp};${moeda};${valForm}\n`;
        });

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `FinFam_${ym}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        showToast(`✅ Excel/CSV gerado com sucesso! (${txs.length} registros)`);
    };

    const exportToPDF = () => {
        const rc = document.getElementById('reportContainer');
        if (!rc) { showToast('❌ Relatório não disponível para impressão.', 'error'); return; }
        showToast('🔄 Abrindo impressão do relatório...', 'info');
        window.print();
    };

    // ==================== MODAL DE LANÇAMENTOS COM INVESTIMENTO FIXO ====================
    const buildCategoryOptions = (type, selectedCatId) => {
        if (type === 'investment') {
            return `<option value="cat_investimentos" selected>📈 Investimentos & Aplicações</option>`;
        }
        const filtered = state.categories.filter(c => !c.type || c.type === type);
        return filtered.map(c => {
            const isSelected = selectedCatId && (c.id === selectedCatId || (c.aliases && c.aliases.includes(selectedCatId)));
            return `<option value="${c.id}" ${isSelected ? 'selected' : ''}>${c.icon} ${c.name}</option>`;
        }).join('');
    };

    const onTxTypeChange = (type) => {
        const catSelect = el('txCategory');
        if (!catSelect) return;
        catSelect.innerHTML = buildCategoryOptions(type, null);
    };

    const showTransactionModal = (txId = null) => {
        let tx = null;
        if (txId && typeof txId === 'string') {
            tx = state.transactions.find(t => t.id === txId);
        }

        const isEdit = !!tx;
        const today = new Date().toISOString().slice(0, 10);
        const overlay = el('modalOverlay');
        if (!overlay) return;

        const currentType = tx ? tx.type : 'expense';

        const userNames = [...new Set((state.users || []).map(u => u.name).filter(Boolean))];
        const assignedValue = tx ? (tx.assignedTo || 'Casal') : 'Casal';
        const assignedOptions = [
            `<option value="Casal" ${assignedValue === 'Casal' ? 'selected' : ''}>💑 Casal / Ambos</option>`,
            ...userNames.map(name => `<option value="${name}" ${assignedValue === name ? 'selected' : ''}>👤 ${name}</option>`)
        ].join('');

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
                    <select id="txCategory" class="input-field">
                        ${buildCategoryOptions(currentType, tx ? tx.categoryId : null)}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Descrição</label>
                    <input type="text" id="txDesc" class="input-field" placeholder="Ex: Supermercado, Aporte, etc." value="${tx ? (tx.description || '') : ''}">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div class="form-group">
                        <label class="form-label">Responsável</label>
                        <select id="txAssigned" class="input-field">
                            ${assignedOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">País / Moeda</label>
                        <select id="txCountry" class="input-field">
                            <option value="ES" ${(!tx || tx.country === 'ES') ? 'selected' : ''}>🇪🇸 Espanha (€)</option>
                            <option value="BR" ${(tx && tx.country === 'BR') ? 'selected' : ''}>🇧🇷 Brasil (R$)</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Valor</label>
                    <input type="number" step="0.01" min="0.01" id="txAmount" class="input-field" placeholder="0.00" value="${tx ? tx.amount : ''}" required>
                </div>
                <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:24px;">
                    <button type="button" class="btn-secondary" onclick="App.closeModal()">Cancelar</button>
                    <button type="submit" class="btn-primary">${isEdit ? 'Salvar Alterações' : 'Confirmar Lançamento'}</button>
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
        if (!isDriveConnected && state.settings.googleScriptUrl) {
            showToast('⚠️ Aguarde a conexão com o Google Drive antes de salvar.', 'error');
            return;
        }

        const type = el('txType').value;
        const date = el('txDate').value;
        const categoryId = (type === 'investment') ? 'cat_investimentos' : el('txCategory').value;
        const description = el('txDesc').value.trim();
        const assignedTo = el('txAssigned').value.trim() || 'Casal';
        const country = el('txCountry').value;
        const amount = parseFloat(el('txAmount').value) || 0;

        if (!date || !categoryId || amount <= 0) {
            showToast('⚠️ Preencha os campos obrigatórios corretamente.', 'error');
            return;
        }

        if (id) {
            const idx = state.transactions.findIndex(t => t.id === id);
            if (idx !== -1) {
                state.transactions[idx] = { id, date, type, categoryId, description, assignedTo, country, amount };
            }
        } else {
            state.transactions.push({ id: generateId(), date, type, categoryId, description, assignedTo, country, amount });
        }

        saveState();
        closeModal();
        refreshAllViews();
        showToast('✅ Lançamento gravado com sucesso!');
        syncToDrive();
    };

    const deleteTransaction = (id) => {
        if (!isDriveConnected && state.settings.googleScriptUrl) {
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

    // ==================== CONFIGURAÇÕES E USUÁRIOS ====================
    const renderSettings = () => `
        <div style="margin-bottom:24px">
            <h2 style="margin:0;font-size:22px;color:var(--navy)">Configurações do Sistema</h2>
            <p style="margin:4px 0 0;color:var(--text-light);font-size:14px">Conexão com Google Drive, moedas e perfis</p>
        </div>
        <div class="card" style="padding:24px;margin-bottom:24px">
            <h3 style="margin:0 0 16px;color:var(--navy);font-size:16px">☁️ Conexão com Google Drive / Planilhas</h3>
            <div class="form-group">
                <label class="form-label">URL do Google Apps Script</label>
                <input type="text" id="setGoogleUrl" class="input-field" value="${state.settings.googleScriptUrl || ''}" placeholder="https://script.google.com/macros/s/.../exec">
            </div>
            <div class="form-group">
                <label class="form-label">Token de Segurança</label>
                <input type="text" id="setApiToken" class="input-field" value="${state.settings.apiToken || DEFAULT_TOKEN}">
            </div>
            <div style="display:flex;gap:10px;margin-top:16px;">
                <button class="btn-primary" onclick="App.saveSettings()">Salvar Configurações</button>
                <button class="btn-secondary" onclick="App.syncFromDrive(false)">🔄 Forçar Sincronização</button>
            </div>
        </div>
        <div class="card" style="padding:24px">
            <h3 style="margin:0 0 16px;color:var(--navy);font-size:16px">👥 Usuários Cadastrados</h3>
            <ul style="list-style:none;padding:0;margin:0 0 20px 0">
                ${(state.users || []).map(u => `
                    <li style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
                        <span><strong>${u.name}</strong> (${u.role || 'Membro'})</span>
                        ${state.users.length > 1 ? `<button onclick="App.deleteUser('${u.id}')" style="color:var(--danger);background:none;border:none;cursor:pointer;">Remover</button>` : ''}
                    </li>
                `).join('')}
            </ul>
            <div style="display:flex;gap:10px">
                <input type="text" id="newUserName" class="input-field" placeholder="Nome do novo membro">
                <button class="btn-primary" onclick="App.addUser()">Adicionar Membro</button>
            </div>
        </div>`;

    const saveSettings = () => {
        const url = el('setGoogleUrl').value.trim();
        const token = el('setApiToken').value.trim();
        state.settings.googleScriptUrl = url;
        state.settings.apiToken = token || DEFAULT_TOKEN;
        saveState();
        showToast('Configurações salvas!');
        syncFromDrive(false);
    };

    const addUser = () => {
        const inp = el('newUserName');
        if (!inp || !inp.value.trim()) return;
        const name = inp.value.trim();
        state.users.push({ id: 'u_' + Date.now(), name, pin: '1234', role: 'Membro' });
        inp.value = '';
        saveState();
        const setPage = el('settings');
        if (setPage) setPage.innerHTML = renderSettings();
        showToast(`Membro ${name} adicionado!`);
    };

    const deleteUser = (id) => {
        if (confirm('Deseja remover este usuário?')) {
            state.users = state.users.filter(u => u.id !== id);
            saveState();
            const setPage = el('settings');
            if (setPage) setPage.innerHTML = renderSettings();
            showToast('Usuário removido.');
        }
    };

    // ==================== TELAS DE ACESSO ====================
    const renderSetup = () => {
        el('app').innerHTML = `
            <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:20px;">
                <div class="card" style="padding:32px;max-width:440px;width:100%;">
                    <h2 style="color:var(--navy);margin-top:0">Bem-vindo ao FinFam</h2>
                    <p style="color:var(--text-light);font-size:14px">Cadastre o primeiro usuário para iniciar.</p>
                    <div class="form-group">
                        <label class="form-label">Nome Completo</label>
                        <input type="text" id="setupName" class="input-field" placeholder="Ex: João Silva">
                    </div>
                    <div class="form-group">
                        <label class="form-label">PIN de Acesso (4 dígitos)</label>
                        <input type="password" maxlength="4" id="setupPin" class="input-field" placeholder="••••">
                    </div>
                    <button class="btn-primary" style="width:100%;margin-top:10px;" onclick="App.doSetup()">Começar a Usar</button>
                </div>
            </div>`;
    };

    const doSetup = () => {
        const name = el('setupName').value.trim();
        const pin = el('setupPin').value.trim();
        if (!name || pin.length < 4) {
            showToast('Informe seu nome e um PIN de 4 dígitos', 'error');
            return;
        }
        const newUser = { id: 'u_' + Date.now(), name, pin, role: 'Administrador' };
        state.users = [newUser];
        saveState();
        setSession(newUser.id);
        renderApp();
    };

    const renderLogin = () => {
        el('app').innerHTML = `
            <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:20px;">
                <div class="card" style="padding:32px;max-width:400px;width:100%;text-align:center;">
                    <div style="font-size:40px;margin-bottom:10px;">💶</div>
                    <h2 style="color:var(--navy);margin:0 0 8px 0;">FinFam</h2>
                    <p style="color:var(--text-light);font-size:13px;margin:0 0 20px 0;">Controle Financeiro Familiar</p>
                    <div class="form-group" style="text-align:left;">
                        <label class="form-label">Selecione o Usuário</label>
                        <select id="loginUser" class="input-field">
                            ${state.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group" style="text-align:left;">
                        <label class="form-label">PIN de Acesso</label>
                        <input type="password" maxlength="4" id="loginPin" class="input-field" placeholder="••••">
                    </div>
                    <button class="btn-primary" style="width:100%;margin-top:10px;" onclick="App.doLogin()">Entrar</button>
                </div>
            </div>`;
    };

    const doLogin = () => {
        const uid = el('loginUser').value;
        const pin = el('loginPin').value.trim();
        const u = state.users.find(user => user.id === uid);
        if (u && u.pin === pin) {
            setSession(u.id);
            renderApp();
            syncFromDrive(false);
        } else {
            showToast('PIN incorreto.', 'error');
        }
    };

    const logout = () => {
        clearSession();
        renderLogin();
    };

    // ==================== APLICAÇÃO PRINCIPAL ====================
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
                    <button class="nav-item active" data-page="dashboard" onclick="App.nav(this)"><span>📊</span> Visão Geral</button>
                    <button class="nav-item" data-page="transactions" onclick="App.nav(this)"><span>📋</span> Lançamentos</button>
                    <button class="nav-item" data-page="reports" onclick="App.nav(this)"><span>📈</span> Relatórios</button>
                    <button class="nav-item" data-page="settings" onclick="App.nav(this)"><span>⚙️</span> Configurações</button>
                </div>
                <div style="padding:16px;border-top:1px solid rgba(255,255,255,.1)">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
                        <div class="user-avatar">${(state.currentUser?.name || 'U').charAt(0)}</div>
                        <div style="flex:1;min-width:0">
                            <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${state.currentUser?.name || 'Usuário'}</div>
                            <div style="font-size:11px;opacity:.7">${state.currentUser?.role || 'Membro'}</div>
                        </div>
                    </div>
                    <div style="display:flex;gap:6px">
                        <button class="btn-secondary" onclick="App.togglePrivacy()" style="flex:1;padding:6px;font-size:12px;" title="Modo Privacidade">👁️</button>
                        <button class="btn-secondary" onclick="App.logout()" style="flex:1;padding:6px;font-size:12px;color:var(--danger)">Sair</button>
                    </div>
                </div>
            </div>

            <div class="main-content">
                <div id="dashboard" class="page active">${renderDashboard()}</div>
                <div id="transactions" class="page">${renderTransactions()}</div>
                <div id="reports" class="page">${renderMonthlyReport()}</div>
                <div id="settings" class="page">${renderSettings()}</div>
            </div>

            <div id="modalOverlay" class="modal-overlay" style="display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.6);z-index:9999;align-items:center;justify-content:center;backdrop-filter:blur(4px);">
                <div id="modalContent" class="modal" style="background:#fff;padding:24px;border-radius:12px;width:90%;max-width:550px;max-height:90vh;overflow-y:auto;box-shadow:0 10px 25px rgba(0,0,0,0.2);"></div>
            </div>
            <div id="toast" class="toast"></div>`;
    };

    // ==================== INICIALIZAÇÃO ====================
    const init = () => {
        initState();
        if (!isSetup()) renderSetup();
        else if (!isLoggedIn()) renderLogin();
        else {
            renderApp();
            syncFromDrive(false);
        }
    };

    return {
        init,
        nav,
        doSetup,
        doLogin,
        logout,
        togglePrivacy,
        changeSelectedMonth,
        saveSettings,
        syncFromDrive,
        showTransactionModal,
        onTxTypeChange,
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
