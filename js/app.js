// ============================================================
// FinFam — Controle Financeiro Familiar
// Arquivo: js/app.js
// Versão: 6.0 — limpa, sem duplicações
// ============================================================

const App = (() => {
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

    // ============================================================
    // CATEGORIAS PADRÃO
    // ============================================================
    const defaultCategories = [
        { id: 'cat_salario_es',         name: 'Salário / Emprego',           type: 'income',     country: 'ES', icon: '💼' },
        { id: 'cat_freelance_es',       name: 'Trabalho Freelance / Extras', type: 'income',     country: 'ES', icon: '💻' },
        { id: 'cat_outras_entradas_es', name: 'Outras Receitas',             type: 'income',     country: 'ES', icon: '💶' },
        { id: 'cat_rendimentos',        name: 'Rendimentos & Dividendos',    type: 'income',     country: 'ES', icon: '💰' },
        { id: 'cat_aluguel_br_inc',     name: 'Receita Aluguel',             type: 'income',     country: 'BR', icon: '🏠' },
        { id: 'cat_invest',             name: 'Investimentos',               type: 'investment', country: 'ES', icon: '📈' },
        { id: 'cat_aluguel_es',         name: 'Aluguel de Moradia',          type: 'expense',    country: 'ES', icon: '🔑' },
        { id: 'cat_hipoteca_es',        name: 'Hipoteca / Financiamento',    type: 'expense',    country: 'ES', icon: '🏛️' },
        { id: 'cat_mercado',            name: 'Mercado / Alimentação',       type: 'expense',    country: 'ES', icon: '🛒' },
        { id: 'cat_agua',               name: 'Água',                        type: 'expense',    country: 'ES', icon: '💧' },
        { id: 'cat_luz',                name: 'Energia / Luz',               type: 'expense',    country: 'ES', icon: '⚡' },
        { id: 'cat_gas',                name: 'Gás',                         type: 'expense',    country: 'ES', icon: '🔥' },
        { id: 'cat_escola',             name: 'Escola / Crianças',           type: 'expense',    country: 'ES', icon: '🎒' },
        { id: 'cat_veiculo',            name: 'Veículo / Transporte',        type: 'expense',    country: 'ES', icon: '🚗' },
        { id: 'cat_lazer',              name: 'Lazer & Família',             type: 'expense',    country: 'ES', icon: '🎬' },
        { id: 'cat_outros_es',          name: 'Outras Despesas',             type: 'expense',    country: 'ES', icon: '📋' },
        { id: 'cat_cc_br',              name: 'Cartão de Crédito',           type: 'expense',    country: 'BR', icon: '💳' },
        { id: 'cat_outros_br',          name: 'Compromissos Diversos',       type: 'expense',    country: 'BR', icon: '🇧🇷' }
    ];

    // ============================================================
    // UTILITÁRIOS
    // ============================================================
    const parseDateToYMD = (val) => {
        if (!val) return '';
        const s = String(val).trim();
        if (!s) return '';

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
            if (window.crypto && window.crypto.subtle) {
                const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
                return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
            }
        } catch(e) {}
        let h = 2166136261;
        const s = String(value);
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        return (h >>> 0).toString(16);
    };

    const generateId = () => Date.now().toString(36) + Math.random().toString(36).slice(2,11);

    const showToast = (msg, type = 'success') => {
        try {
            const t = el('toast');
            if (!t) return;
            t.textContent = String(msg);
            t.className = 'toast ' + type + ' show';
            clearTimeout(t._timeout);
            t._timeout = setTimeout(() => t.classList.remove('show'), 3500);
        } catch(e) {}
    };

    // ============================================================
    // SANITIZAÇÕES
    // ============================================================
    const sanitizeCountry = (raw) => {
        if (raw === null || raw === undefined) return 'ES';
        const s = String(raw).toUpperCase();
        if (s.indexOf('BR') !== -1 || s.indexOf('BRA') !== -1) return 'BR';
        if (s.indexOf('ES') !== -1 || s.indexOf('ESP') !== -1) return 'ES';
        return 'ES';
    };

    const sanitizeType = (raw) => {
        const s = String(raw || '').toLowerCase();
        if (s.indexOf('income') !== -1 || s.indexOf('receita') !== -1) return 'income';
        if (s.indexOf('invest') !== -1) return 'investment';
        return 'expense';
    };

    const sanitizeAmount = (raw) => {
        if (raw === null || raw === undefined) return 0;
        if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
        let s = String(raw).trim();
        if (!s) return 0;
        s = s.replace(/[^0-9.,-]/g, '');
        if (s.indexOf(',') !== -1 && s.indexOf('.') !== -1) {
            if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
                s = s.replace(/\./g, '').replace(',', '.');
            } else {
                s = s.replace(/,/g, '');
            }
        } else if (s.indexOf(',') !== -1) {
            s = s.replace(',', '.');
        }
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : 0;
    };

    const sanitizeInvestAction = (raw) => {
        const s = String(raw || '').toLowerCase();
        if (s === 'resgate_interno' || s === 'interno' || s === 'silencioso') return 'resgate_interno';
        if (s === 'resgate') return 'resgate';
        return 'aporte';
    };

    // ============================================================
    // CATEGORIAS HELPERS
    // ============================================================
    const getCategoryDisplay = (categoryId) => {
        const c = (state.categories || []).find(x => x && x.id === categoryId);
        if (!c) return { name: 'Geral', icon: '📋' };
        const clean = String(c.name || '')
            .replace(/\s*\((espanha|es|brasil|br)\)\s*/gi, '')
            .replace(/\s*-\s*(espanha|es|brasil|br)\s*$/gi, '')
            .trim();
        return { name: clean || 'Geral', icon: c.icon || '📋' };
    };

    const getInvestmentCategory = () =>
        (state.categories || []).find(c => c && c.id === 'cat_invest') ||
        (state.categories || []).find(c => c && c.type === 'investment') ||
        (state.categories || [])[0] ||
        { id: 'cat_invest', name: 'Investimentos', icon: '📈' };

    const getResponsibleOptions = (selected) => {
        const names = new Set(['Casal / Ambos']);
        (state.users || []).forEach(u => { if (u && u.name) names.add(u.name); });
        if (selected && selected !== 'Casal' && selected !== 'Casal / Ambos') names.add(selected);
        return Array.from(names)
            .map(n => '<option value="' + n + '" ' + (selected === n ? 'selected' : '') + '>' + n + '</option>')
            .join('');
    };

    // ============================================================
    // NORMALIZAÇÃO
    // ============================================================
    const normalizeTx = (t) => {
        if (!t || typeof t !== 'object') return null;
        try {
            const rawDate = t.date || t.Data || '';
            const rawDesc = String(t.description || t['Descrição'] || '').trim();
            const rawType = t.type || t.Tipo;

            if (String(rawDate).toLowerCase() === 'data' ||
                String(rawType).toLowerCase() === 'tipo' ||
                String(t.id || t.ID || '').toLowerCase() === 'id') {
                return null;
            }

            const ymd = parseDateToYMD(rawDate);
            if (!ymd || ymd.length !== 10) return null;

            const type = sanitizeType(rawType);
            const isInv = type === 'investment';

            return {
                id:           String(t.id || t.ID || ('tx_' + generateId())),
                type:         type,
                date:         ymd,
                description:  rawDesc,
                categoryId:   String(t.categoryId || t.CategoriaID || (isInv ? 'cat_invest' : 'cat_outros_es')),
                country:      sanitizeCountry(t.country || t['País']),
                amount:       sanitizeAmount(t.amount !== undefined && t.amount !== null ? t.amount : t.Valor),
                assignedTo:   String(t.assignedTo || t['Responsável'] || 'Casal / Ambos').trim(),
                investAction: isInv ? sanitizeInvestAction(t.investAction || t.action) : undefined,
                createdAt:    t.createdAt || new Date().toISOString(),
                updatedAt:    t.updatedAt || t.createdAt || new Date().toISOString()
            };
        } catch(e) {
            console.warn('normalizeTx falhou:', t, e);
            return null;
        }
    };

    const sanitizeTxForDrive = (tx) => {
        if (!tx || typeof tx !== 'object') return null;
        try {
            if (!tx.date || tx.date.length !== 10) return null;
            const out = {
                id:          String(tx.id || ''),
                type:        String(tx.type || 'expense'),
                date:        String(tx.date),
                description: String(tx.description || ''),
                categoryId:  String(tx.categoryId || ''),
                country:     String(tx.country || 'ES'),
                amount:      Number(tx.amount) || 0,
                assignedTo:  String(tx.assignedTo || 'Casal / Ambos'),
                createdAt:   String(tx.createdAt || new Date().toISOString()),
                updatedAt:   String(tx.updatedAt || new Date().toISOString())
            };
            if (tx.type === 'investment') out.investAction = sanitizeInvestAction(tx.investAction);
            if (!out.id) return null;
            return out;
        } catch(e) {
            return null;
        }
    };

    // ============================================================
    // SESSÃO
    // ============================================================
    const getSession = () => {
        try {
            const raw = sessionStorage.getItem(SESSION_KEY);
            if (!raw) return null;
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

    const isSetup = () => Array.isArray(state.users) && state.users.length > 0;

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

    // ============================================================
    // ESTADO
    // ============================================================
    const initState = () => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) { resetState(); return; }

            let parsed;
            try { parsed = JSON.parse(raw); }
            catch(e) { resetState(); return; }

            if (!parsed || typeof parsed !== 'object') { resetState(); return; }

            state.users         = Array.isArray(parsed.users) ? parsed.users.filter(u => u && u.email) : [];
            state.privacyMode   = !!parsed.privacyMode;
            state.selectedMonth = parsed.selectedMonth || new Date().toISOString().slice(0,7);
            state.settings = Object.assign({
                currencyBR: 'R$', currencyES: '€', monthStartDay: 1,
                googleScriptUrl: '', apiToken: DEFAULT_TOKEN
            }, parsed.settings || {});
            if (!state.settings.apiToken) state.settings.apiToken = DEFAULT_TOKEN;

            const rawTxs = Array.isArray(parsed.transactions) ? parsed.transactions : [];
            state.transactions = rawTxs.map(normalizeTx).filter(Boolean);

            state.categories = defaultCategories.slice();
        } catch(e) {
            console.error('initState falhou:', e);
            resetState();
        }
    };

    const resetState = () => {
        state = {
            users: [],
            transactions: [],
            categories: defaultCategories.slice(),
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
        try {
            const cleanTx = (state.transactions || []).map(sanitizeTxForDrive).filter(Boolean);
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                users: Array.isArray(state.users) ? state.users : [],
                transactions: cleanTx,
                settings: state.settings || {},
                privacyMode: !!state.privacyMode,
                selectedMonth: state.selectedMonth || new Date().toISOString().slice(0,7)
            }));
        } catch(e) { console.error('saveState falhou:', e); }
    };

    // ============================================================
    // OVERLAY
    // ============================================================
    const showConnectionOverlay = () => {
        try {
            if (el('connOverlay')) return;
            const ov = document.createElement('div');
            ov.id = 'connOverlay';
            ov.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,.96);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;';
            ov.innerHTML =
                '<div style="font-size:38px;">💶</div>' +
                '<div style="font-weight:700;font-size:16px;color:#1e3a5f;">Conectando com o banco de dados...</div>' +
                '<div style="width:260px;height:10px;background:#e2e8f0;border-radius:6px;overflow:hidden;">' +
                  '<div id="connBar" style="width:15%;height:100%;background:#059669;border-radius:6px;transition:width .3s;"></div>' +
                '</div>' +
                '<div id="connPct" style="font-size:13px;color:#64748b;font-weight:600;">15%</div>';
            document.body.appendChild(ov);

            let p = 15;
            _connTimer = setInterval(() => {
                p = Math.min(90, p + 8);
                const bar = el('connBar'), pct = el('connPct');
                if (bar) bar.style.width = p + '%';
                if (pct) pct.textContent = p + '%';
            }, 300);
        } catch(e) {}
    };

    const hideConnectionOverlay = () => {
        try {
            if (_connTimer) { clearInterval(_connTimer); _connTimer = null; }
            const bar = el('connBar'), pct = el('connPct');
            if (bar) bar.style.width = '100%';
            if (pct) pct.textContent = '100%';
            setTimeout(() => { const o = el('connOverlay'); if (o) o.remove(); }, 350);
        } catch(e) {}
    };

    // ============================================================
    // GOOGLE DRIVE
    // ============================================================
    const driveCall = async (payload) => {
        const url = state.settings.googleScriptUrl;
        if (!url) throw new Error('URL do Google Apps Script não configurada.');
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(Object.assign({}, payload, {
                token: state.settings.apiToken || DEFAULT_TOKEN
            }))
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        try { return JSON.parse(text); }
        catch(e) { throw new Error('Resposta não-JSON do Drive: ' + text.slice(0, 120)); }
    };

    const checkConnection = async () => {
        const url = state.settings.googleScriptUrl;
        if (!url) { showToast('⚠️ URL do Apps Script não configurada.', 'error'); return; }
        showToast('🔄 Testando conexão...', 'info');
        try {
            const data = await driveCall({ action: 'ping' });
            if (data && (data.status === 'ok' || data.status === 'success')) {
                showToast('✅ Conexão com o Google Drive ativa!', 'success');
            } else {
                showToast('⚠️ ' + ((data && data.message) || 'Resposta inesperada.'), 'warning');
            }
        } catch (e) { showToast('❌ ' + (e.message || 'Falha ao conectar.'), 'error'); }
    };

    const syncToDrive = async () => {
        if (!state.settings.googleScriptUrl) {
            showToast('⚠️ URL do Google Drive não configurada.', 'error');
            return;
        }
        try {
            const cleanTx = (state.transactions || []).map(sanitizeTxForDrive).filter(Boolean);
            const cleanUsers = (state.users || []).filter(u => u && u.email).map(u => ({
                id: String(u.id || ''),
                name: String(u.name || ''),
                email: String(u.email || ''),
                passwordHash: String(u.passwordHash || ''),
                role: String(u.role || 'user'),
                createdAt: String(u.createdAt || new Date().toISOString())
            }));
            const cleanSettings = {
                currencyBR: String(state.settings.currencyBR || 'R$'),
                currencyES: String(state.settings.currencyES || '€'),
                monthStartDay: Number(state.settings.monthStartDay) || 1,
                googleScriptUrl: String(state.settings.googleScriptUrl || ''),
                apiToken: String(state.settings.apiToken || DEFAULT_TOKEN)
            };

            const url = state.settings.googleScriptUrl;
            const token = state.settings.apiToken || DEFAULT_TOKEN;

            const payload = {
                action: 'sync',
                token: token,
                transactions: cleanTx,
                data: {
                    transactions: cleanTx,
                    users: cleanUsers,
                    settings: cleanSettings,
                    lastSync: new Date().toISOString()
                }
            };

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error('HTTP ' + res.status);

            const text = await res.text();
            let data;
            try { data = JSON.parse(text); }
            catch (e) { throw new Error('Resposta não-JSON: ' + text.slice(0, 120)); }

            if (data && (data.status === 'ok' || data.status === 'success')) {
                showToast('✅ ' + cleanTx.length + ' registros salvos no Drive!');
            } else {
                showToast((data && data.message) || '❌ Erro ao salvar no Drive.', 'error');
            }
        } catch (e) {
            console.error('syncToDrive:', e);
            showToast('❌ ' + (e.message || 'Erro ao comunicar com o Drive.'), 'error');
        }
    };

    const mergeDriveData = (remote) => {
        if (!remote || typeof remote !== 'object') return { localOnlyCount: 0, remoteCount: 0 };
        const remoteRaw = Array.isArray(remote.transactions) ? remote.transactions
                        : Array.isArray(remote)               ? remote : [];
        const remoteTxs = remoteRaw.map(normalizeTx).filter(Boolean);
        const remoteIds = new Set(remoteTxs.map(t => t.id));
        const localOnly = state.transactions.filter(t => !remoteIds.has(t.id));

        state.transactions = remoteTxs.concat(localOnly);

        if (Array.isArray(remote.users) && remote.users.length > 0) {
            const map = new Map(state.users.map(u => [u.email, u]));
            remote.users.forEach(u => { if (u && u.email) map.set(u.email, u); });
            state.users = Array.from(map.values());
        }
        if (remote.settings && typeof remote.settings === 'object') {
            state.settings = Object.assign({}, state.settings, remote.settings, {
                apiToken: state.settings.apiToken
            });
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

            const payload = (data && typeof data === 'object' && data.data && typeof data.data === 'object')
                ? data.data : (data && typeof data === 'object' ? data : {});

            const ok = data && (data.status === 'ok' || data.status === 'success');

            if (ok && (Array.isArray(payload.transactions) || Array.isArray(data.transactions))) {
                const merged = Object.assign({}, payload, {
                    transactions: payload.transactions || data.transactions || []
                });
                const result = mergeDriveData(merged);
                saveState();
                refreshAllViews();
                if (!silent) showToast('✅ ' + state.transactions.length + ' registros sincronizados!');
                if (result.localOnlyCount > 0) syncToDrive();
            } else if (ok && !payload.transactions) {
                if (!silent) showToast('ℹ️ Drive sem dados ainda. Base local preservada.', 'info');
            } else if (!silent) {
                showToast((data && data.message) || '❌ Erro ao consultar o Drive.', 'error');
            }
        } catch (e) {
            console.error('syncFromDrive:', e);
            if (!silent) showToast('❌ ' + (e.message || 'Erro ao consultar o Drive.'), 'error');
        }
    };

    const syncFromDriveForce = async () => {
        if (!confirm('⚠️ Isso vai SUBSTITUIR TODOS os dados locais pelos dados do Drive. Continuar?')) return;
        await syncFromDrive(false);
    };

    // ============================================================
    // CÁLCULOS
    // ============================================================
    const isAporte          = (t) => t && t.type === 'investment' && (t.investAction || 'aporte') === 'aporte';
    const isResgate         = (t) => t && t.type === 'investment' && t.investAction === 'resgate';
    const isResgateInterno  = (t) => t && t.type === 'investment' && t.investAction === 'resgate_interno';

    const afetaMes = (t) => {
        if (!t) return false;
        if (t.type === 'investment') return isAporte(t) || isResgate(t);
        return t.type === 'income' || t.type === 'expense';
    };

    const calcMonth = (txs) => {
        const sum = (arr) => arr.reduce((s,t) => s + (Number(t.amount) || 0), 0);
        const income   = sum(txs.filter(t => t.type === 'income'));
        const expense  = sum(txs.filter(t => t.type === 'expense'));
        const aportes  = sum(txs.filter(isAporte));
        const resgates = sum(txs.filter(isResgate));
        const internos = sum(txs.filter(isResgateInterno));
        return {
            income, expense, aportes, resgates, internos,
            investment: aportes - resgates,
            balance: income - expense - aportes + resgates
        };
    };

    const calcTotals = () => {
        const sum = (arr) => arr.reduce((s,t) => s + (Number(t.amount) || 0), 0);
        const allAportes  = sum(state.transactions.filter(isAporte));
        const allResgates = sum(state.transactions.filter(isResgate));
        const allInternos = sum(state.transactions.filter(isResgateInterno));
        const totalInvestments = allAportes - allResgates - allInternos;
        const totalIncomeAll   = sum(state.transactions.filter(t => t.type === 'income'));
        const totalExpenseAll  = sum(state.transactions.filter(t => t.type === 'expense'));
        const netWorth = totalInvestments + (totalIncomeAll - totalExpenseAll - allAportes + allResgates);
        return { totalInvestments, totalIncomeAll, totalExpenseAll, allAportes, allResgates, allInternos, netWorth };
    };

    const getSelectedMonthData = () => {
        const ym = state.selectedMonth || new Date().toISOString().slice(0,7);
        const txs = state.transactions
            .filter(t => t && t.date && getYearMonth(t.date) === ym)
            .sort((a,b) => parseDateToYMD(b.date).localeCompare(parseDateToYMD(a.date)));

        const month  = calcMonth(txs);
        const totals = calcTotals();
        const esTxs = txs.filter(t => t.country === 'ES');
        const brTxs = txs.filter(t => t.country === 'BR');

        return Object.assign(
            { ym, txs, countES: esTxs.length, countBR: brTxs.length },
            month, totals,
            { monthES: calcMonth(esTxs), monthBR: calcMonth(brTxs) }
        );
    };

    const changeSelectedMonth = (m) => { state.selectedMonth = m; saveState(); refreshAllViews(); };
    const changeReportMonth = (m) => { state.selectedMonth = m; saveState(); refreshAllViews(); navByPage('reports'); };

    // ============================================================
    // NAVEGAÇÃO
    // ============================================================
    const navByPage = (pageId) => {
        document.querySelectorAll('.sidebar .nav-item').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-page') === pageId);
        });
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const target = el(pageId);
        if (target) target.classList.add('active');
        if (pageId === 'dashboard') setTimeout(renderChart, 50);
    };

    const nav = (btn) => navByPage(btn.getAttribute('data-page'));

    // ============================================================
    // RENDER
    // ============================================================
    const refreshAllViews = () => {
        try {
            const d = el('dashboard');    if (d) d.innerHTML = renderDashboard();
            const t = el('transactions'); if (t) t.innerHTML = renderTransactions();
            const r = el('reports');      if (r) r.innerHTML = renderMonthlyReport();
            const s = el('settings');     if (s) s.innerHTML = renderSettings();
            const activeBtn = document.querySelector('.sidebar .nav-item.active');
            navByPage(activeBtn ? activeBtn.getAttribute('data-page') : 'dashboard');
        } catch(e) { console.error('refreshAllViews:', e); }
    };

    // -------- SETUP --------
    const renderSetup = () => {
        el('app').innerHTML = `
            <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:#f1f5f9">
                <div class="card" style="width:100%;max-width:440px;padding:32px">
                    <div style="text-align:center;margin-bottom:28px">
                        <div style="font-size:36px;margin-bottom:8px">💰</div>
                        <h1 style="color:#1e3a5f;margin:0 0 6px;font-size:22px">FinFam</h1>
                        <p style="color:#475569;margin:0;font-size:14px">Configuração Inicial do Administrador</p>
                    </div>
                    <form onsubmit="App.doSetup(event)">
                        <div class="form-group"><label class="form-label">Nome Completo</label>
                            <input type="text" id="setupName" class="input-field" placeholder="Ex: João Silva" required></div>
                        <div class="form-group"><label class="form-label">E-mail</label>
                            <input type="email" id="setupEmail" class="input-field" placeholder="seu@email.com" required></div>
                        <div class="form-group"><label class="form-label">Senha</label>
                            <input type="password" id="setupPassword" class="input-field" placeholder="Mínimo 6 caracteres" minlength="6" required></div>
                        <div class="form-group"><label class="form-label">URL do Google Apps Script (opcional)</label>
                            <input type="url" id="setupScriptUrl" class="input-field" placeholder="https://script.google.com/macros/s/..."></div>
                        <button type="submit" class="btn-primary" style="width:100%;margin-top:8px">Criar Administrador e Iniciar</button>
                    </form>
                </div>
            </div>`;
    };

    const doSetup = async (e) => {
        e.preventDefault();
        try {
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
        } catch(err) {
            console.error('doSetup:', err);
            alert('Erro ao configurar: ' + err.message);
        }
    };

    const renderLogin = () => {
        el('app').innerHTML = `
            <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:#f1f5f9">
                <div class="card" style="width:100%;max-width:400px;padding:32px">
                    <div style="text-align:center;margin-bottom:28px">
                        <div style="font-size:36px;margin-bottom:8px">💰</div>
                        <h1 style="color:#1e3a5f;margin:0 0 6px;font-size:22px">FinFam</h1>
                        <p style="color:#475569;margin:0;font-size:14px">Controle Financeiro Familiar</p>
                    </div>
                    <form onsubmit="App.doLogin(event)">
                        <div class="form-group"><label class="form-label">E-mail</label>
                            <input type="email" id="loginEmail" class="input-field" required autocomplete="username"></div>
                        <div class="form-group"><label class="form-label">Senha</label>
                            <input type="password" id="loginPassword" class="input-field" required autocomplete="current-password"></div>
                        <button type="submit" class="btn-primary" style="width:100%;margin-top:8px">Entrar</button>
                    </form>
                </div>
            </div>`;
    };

    const doLogin = async (e) => {
        e.preventDefault();
        try {
            const email = el('loginEmail').value.trim().toLowerCase();
            const pwd   = el('loginPassword').value;
            const user  = state.users.find(u => u.email.toLowerCase() === email);
            if (!user) { showToast('E-mail ou senha incorretos.', 'error'); return; }

            const pwdHash = await hashPwd(pwd);
            if (user.passwordHash !== pwdHash) { showToast('E-mail ou senha incorretos.', 'error'); return; }

            setSession(user.id);
            renderApp();
            showConnectionOverlay();
            syncFromDrive(true).finally(hideConnectionOverlay);
        } catch(err) {
            console.error('doLogin:', err);
            showToast('Erro no login: ' + err.message, 'error');
        }
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

    // -------- BADGES --------
    const renderTypeBadge = (t) => {
        if (t.type === 'income')  return '<span class="badge badge-success">Receita</span>';
        if (t.type === 'expense') return '<span class="badge badge-danger">Despesa</span>';
        if (isResgate(t))         return '<span class="badge badge-warning">Resgate</span>';
        if (isResgateInterno(t))  return '<span class="badge badge-info">Resgate Interno</span>';
        return '<span class="badge badge-purple">Aporte</span>';
    };

    const renderTxValue = (t, cur) => {
        const color = t.type === 'income' ? 'var(--emerald)'
                    : t.type === 'expense' ? 'var(--danger)'
                    : isResgate(t) ? 'var(--warning)'
                    : isResgateInterno(t) ? 'var(--slate)'
                    : 'var(--purple)';
        const sign = t.type === 'income' ? '+'
                   : t.type === 'expense' ? '-'
                   : isResgate(t) ? '+' : '-';
        return '<span style="font-weight:600;color:' + color + '">' + sign + fmtMoney(t.amount, cur) + '</span>';
    };

    const renderCountryLabel = (country) => sanitizeCountry(country) === 'BR' ? '🇧🇷 BR' : '🇪🇸 ES';

    // -------- DASHBOARD --------
    const renderDashboard = () => {
        const m = getSelectedMonthData();
        const recent = m.txs.slice(0, 5);

        return `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:16px">
                <div>
                    <h1 style="color:#1e3a5f;margin:0 0 4px;font-size:24px">Visão Geral</h1>
                    <p style="color:#475569;margin:0;font-size:14px">Resumo consolidado das finanças familiares</p>
                </div>
                <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
                    <input type="month" class="input-field" value="${m.ym}" onchange="App.changeSelectedMonth(this.value)" style="width:auto">
                    <button class="btn-primary" onclick="App.showTransactionModal(null)">+ Novo Lançamento</button>
                </div>
            </div>

            <h3 style="color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:.8px;margin:0 0 10px">🇪🇸 Movimento em Euros (€)</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:20px">
                <div class="card stat-card">
                    <div class="stat-label">Saldo Livre</div>
                    <div class="stat-value ${m.monthES.balance >= 0 ? 'emerald-text' : 'danger-text'}">${fmtMoney(m.monthES.balance, '€')}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">Receitas</div>
                    <div class="stat-value emerald-text">${fmtMoney(m.monthES.income, '€')}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">Despesas</div>
                    <div class="stat-value danger-text">${fmtMoney(m.monthES.expense, '€')}</div>
                </div>
                <div class="card stat-card" style="border-left:4px solid #8b5cf6">
                    <div class="stat-label">Aportes</div>
                    <div class="stat-value" style="color:#8b5cf6">${fmtMoney(m.monthES.aportes, '€')}</div>
                    ${m.monthES.resgates > 0 ? '<div style="font-size:11px;color:#d97706;margin-top:4px">Resgates: ' + fmtMoney(m.monthES.resgates, '€') + '</div>' : ''}
                </div>
            </div>

            <h3 style="color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:.8px;margin:0 0 10px">🇧🇷 Movimento em Reais (R$)</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">
                <div class="card stat-card">
                    <div class="stat-label">Saldo Livre</div>
                    <div class="stat-value ${m.monthBR.balance >= 0 ? 'emerald-text' : 'danger-text'}">${fmtMoney(m.monthBR.balance, 'R$')}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">Receitas</div>
                    <div class="stat-value emerald-text">${fmtMoney(m.monthBR.income, 'R$')}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-label">Despesas</div>
                    <div class="stat-value danger-text">${fmtMoney(m.monthBR.expense, 'R$')}</div>
                </div>
                <div class="card stat-card" style="border-left:4px solid #8b5cf6">
                    <div class="stat-label">Aportes</div>
                    <div class="stat-value" style="color:#8b5cf6">${fmtMoney(m.monthBR.aportes, 'R$')}</div>
                    ${m.monthBR.resgates > 0 ? '<div style="font-size:11px;color:#d97706;margin-top:4px">Resgates: ' + fmtMoney(m.monthBR.resgates, 'R$') + '</div>' : ''}
                </div>
            </div>

            <div class="card stat-card net-worth-card" style="margin-bottom:24px">
                <div class="stat-label">🏦 Patrimônio Total (Investimentos Acumulados)</div>
                <div class="net-worth-value">${fmtMoney(m.totalInvestments, '€')}</div>
                <div style="font-size:12px;color:#475569;margin-top:6px">
                    Aportes totais: ${fmtMoney(m.allAportes, '€')} &nbsp;•&nbsp;
                    Resgates totais: ${fmtMoney(m.allResgates, '€')}
                </div>
            </div>

            <div class="card" style="padding:24px;margin-bottom:24px">
                <h3 style="color:#1e3a5f;margin-top:0">Fluxo Mensal (Euros)</h3>
                <div style="height:240px"><canvas id="monthlyChart"></canvas></div>
            </div>

            <div class="card" style="padding:24px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h3 style="color:#1e3a5f;margin:0">Últimos Lançamentos do Mês</h3>
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
                                ? '<tr><td colspan="7" style="text-align:center;color:#475569;padding:24px">Nenhum lançamento registrado neste mês.</td></tr>'
                                : recent.map(t => {
                                    const cat = getCategoryDisplay(t.categoryId);
                                    const cur = t.country === 'BR' ? state.settings.currencyBR : state.settings.currencyES;
                                    return `
                                        <tr>
                                            <td>${fmtDate(t.date)}</td>
                                            <td><strong>${t.description || '-'}</strong></td>
                                            <td>${cat.icon} ${cat.name}</td>
                                            <td>${t.assignedTo || 'Casal'}</td>
                                            <td>${renderCountryLabel(t.country)}</td>
                                            <td>${renderTypeBadge(t)}</td>
                                            <td style="text-align:right">${renderTxValue(t, cur)}</td>
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
                labels: ['Receitas', 'Despesas', 'Aportes', 'Resgates'],
                datasets: [{
                    label: 'Euros no Mês',
                    data: [m.monthES.income, m.monthES.expense, m.monthES.aportes, m.monthES.resgates],
                    backgroundColor: ['#059669', '#dc2626', '#8b5cf6', '#d97706'],
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { callback: v => fmtMoney(v, '€') } } }
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
                    <h1 style="color:#1e3a5f;margin:0 0 4px;font-size:24px">Lançamentos</h1>
                    <p style="color:#475569;margin:0;font-size:14px">Histórico completo de transações</p>
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
                                ? '<tr><td colspan="8" style="text-align:center;color:#475569;padding:32px">Nenhum lançamento encontrado para este mês.</td></tr>'
                                : txs.map(t => {
                                    const cat = getCategoryDisplay(t.categoryId);
                                    const cur = t.country === 'BR' ? state.settings.currencyBR : state.settings.currencyES;
                                    return `
                                        <tr>
                                            <td>${fmtDate(t.date)}</td>
                                            <td><strong>${t.description || '-'}</strong></td>
                                            <td>${cat.icon} ${cat.name}</td>
                                            <td>${t.assignedTo || 'Casal'}</td>
                                            <td>${renderCountryLabel(t.country)}</td>
                                            <td>${renderTypeBadge(t)}</td>
                                            <td style="text-align:right">${renderTxValue(t, cur)}</td>
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

    // -------- RELATÓRIO --------
    const renderMonthlyReport = () => {
        const selMonth = state.selectedMonth || new Date().toISOString().slice(0,7);
        const txs = state.transactions
            .filter(t => t && t.date && getYearMonth(t.date) === selMonth)
            .filter(afetaMes)
            .sort((a,b) => parseDateToYMD(b.date).localeCompare(parseDateToYMD(a.date)));

        const filterBy = (country, predicate) => txs.filter(t => t.country === country && predicate(t));
        const sum = (arr) => arr.reduce((s,t) => s + (Number(t.amount) || 0), 0);

        const expES = filterBy('ES', t => t.type === 'expense');
        const incES = filterBy('ES', t => t.type === 'income');
        const apoES = filterBy('ES', isAporte);
        const resES = filterBy('ES', isResgate);

        const expBR = filterBy('BR', t => t.type === 'expense');
        const incBR = filterBy('BR', t => t.type === 'income');
        const apoBR = filterBy('BR', isAporte);
        const resBR = filterBy('BR', isResgate);

        const section = (title, items, total, cur, badgeClass, prefix) => `
            <div class="card" style="padding:24px;margin-bottom:24px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h3 style="color:#1e3a5f;margin:0">${title} (${fmtMoney(total, cur)})</h3>
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
                                ? '<tr><td colspan="5" style="text-align:center;color:#475569;padding:16px">Nenhum registro no mês.</td></tr>'
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
            <div id="reportContainer" style="background:#fff">
                <div class="no-print" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:16px">
                    <div>
                        <h2 style="color:#1e3a5f;margin:0 0 4px 0">Relatório Mensal</h2>
                        <p style="color:#475569;margin:0;font-size:14px">Detalhamento financeiro consolidado (${txs.length} lançamentos)</p>
                    </div>
                    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
                        <input type="month" id="reportMonthPicker" class="input-field" value="${selMonth}" onchange="App.changeReportMonth(this.value)" style="width:auto">
                        <button class="btn-secondary" onclick="App.exportToPDF()">📄 PDF</button>
                        <button class="btn-secondary" onclick="App.exportToCSV()">📊 CSV (Excel)</button>
                    </div>
                </div>

                <h2 style="color:#1e3a5f;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin-bottom:16px">🇪🇸 Espanha</h2>
                ${section('Despesas em Espanha', expES, sum(expES), '€', 'badge-danger', '-')}
                ${section('Receitas em Espanha', incES, sum(incES), '€', 'badge-success', '+')}
                ${section('Aportes em Espanha', apoES, sum(apoES), '€', 'badge-purple', '-')}
                ${section('Resgates em Espanha', resES, sum(resES), '€', 'badge-warning', '+')}

                <h2 style="color:#1e3a5f;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin:28px 0 16px">🇧🇷 Brasil</h2>
                ${section('Despesas no Brasil', expBR, sum(expBR), 'R$', 'badge-danger', '-')}
                ${section('Receitas no Brasil', incBR, sum(incBR), 'R$', 'badge-success', '+')}
                ${section('Aportes no Brasil', apoBR, sum(apoBR), 'R$', 'badge-purple', '-')}
                ${section('Resgates no Brasil', resBR, sum(resBR), 'R$', 'badge-warning', '+')}
            </div>`;
    };

    // ============================================================
    // PDF — IFRAME ISOLADO
    // ============================================================
  const exportToPDF = () => {
    if (typeof html2pdf === 'undefined') {
        showToast('Biblioteca PDF não carregada.', 'error');
        return;
    }

    // Garante que estamos na aba Relatórios
    const reportEl = el('reportContainer');
    if (!reportEl) {
        showToast('Abra a aba Relatórios antes de gerar o PDF.', 'warning');
        navByPage('reports');
        setTimeout(exportToPDF, 400);
        return;
    }

    const selMonth = state.selectedMonth || new Date().toISOString().slice(0,7);

    // ---------- Overlay escuro (esconde a "piscada" durante a captura) ----------
    const overlay = document.createElement('div');
    overlay.id = 'pdfOverlay';
    overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(15,23,42,.9);z-index:999998;' +
        'display:flex;align-items:center;justify-content:center;' +
        'color:#fff;font-family:Inter,sans-serif;font-size:16px;font-weight:600;';
    overlay.innerHTML = '<div>📄 Gerando PDF, aguarde...</div>';
    document.body.appendChild(overlay);

    // ---------- Esconde botões/inputs do relatório temporariamente ----------
    const hidden = [];
    reportEl.querySelectorAll('.no-print, button, input').forEach(n => {
        hidden.push({ el: n, display: n.style.display });
        n.style.display = 'none';
    });

    // ---------- Clona o relatório para não afetar a tela original ----------
    // (o clone fica FORA da tela mas o navegador ainda pinta)
    const clone = reportEl.cloneNode(true);
    clone.id = 'reportForPdf';
    clone.style.cssText =
        'position:fixed;' +
        'top:0;' +
        'left:0;' +
        'width:1000px;' +          // largura fixa (A4 ~ 794px @ 96dpi, folga)
        'min-width:1000px;' +
        'max-width:1000px;' +
        'background:#ffffff;' +
        'padding:24px;' +
        'margin:0;' +
        'z-index:999999;' +
        'opacity:0.01;' +           // 99% invisível, mas PINTADO
        'pointer-events:none;' +
        'overflow:visible;' +       // <-- CRÍTICO: sem overflow hidden
        'box-sizing:border-box;' +
        'font-family:Arial,Helvetica,sans-serif;' +
        'color:#1e293b;';

    // Remove qualquer table-container com overflow no clone
    clone.querySelectorAll('.table-container').forEach(tc => {
        tc.style.overflow = 'visible';
        tc.style.width = '100%';
    });

    // Garante que as tabelas não cortem nada
    clone.querySelectorAll('table').forEach(tb => {
        tb.style.width = '100%';
        tb.style.tableLayout = 'auto';
        tb.style.borderCollapse = 'collapse';
    });

    document.body.appendChild(clone);

    // ---------- Restaura os botões/inputs no relatório original ----------
    hidden.forEach(({ el: node, display }) => { node.style.display = display; });

    // ---------- Espera pintura real ----------
    const afterPaint = (cb) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setTimeout(cb, 350);
                });
            });
        });
    };

    afterPaint(() => {
        // Mede dimensões REAIS do clone
        const fullWidth  = clone.scrollWidth;
        const fullHeight = clone.scrollHeight;

        const opt = {
            margin: [8, 8, 8, 8],
            filename: 'FinFam_Relatorio_' + selMonth + '.pdf',
            image: { type: 'jpeg', quality: 0.95 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff',
                width: fullWidth,
                height: fullHeight,
                windowWidth: fullWidth,
                windowHeight: fullHeight,
                x: 0,
                y: 0,
                scrollX: 0,
                scrollY: 0,
                allowTaint: true,
                foreignObjectRendering: false
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'] }
        };

        html2pdf().set(opt).from(clone).save()
            .then(() => {
                clone.remove();
                overlay.remove();
                showToast('✅ PDF gerado com sucesso!', 'success');
            })
            .catch(err => {
                console.error('exportToPDF:', err);
                clone.remove();
                overlay.remove();
                showToast('Erro ao exportar PDF: ' + (err && err.message ? err.message : ''), 'error');
            });
    });
};
    // -------- CSV --------
    const exportToCSV = () => {
        const ym = state.selectedMonth || new Date().toISOString().slice(0,7);
        const txs = state.transactions
            .filter(t => t && t.date && getYearMonth(t.date) === ym)
            .filter(afetaMes)
            .sort((a,b) => parseDateToYMD(b.date).localeCompare(parseDateToYMD(a.date)));

        if (txs.length === 0) { showToast('Nenhum dado para exportar neste mês.', 'info'); return; }

        const sum = (arr) => arr.reduce((s,t) => s + (Number(t.amount) || 0), 0);
        const fmt = (n) => n.toFixed(2).replace('.', ',');

        const by = (c, pred) => sum(txs.filter(t => t.country === c && pred(t)));
        const expES = by('ES', t => t.type === 'expense'), incES = by('ES', t => t.type === 'income');
        const apoES = by('ES', isAporte),                 resES = by('ES', isResgate);
        const expBR = by('BR', t => t.type === 'expense'), incBR = by('BR', t => t.type === 'income');
        const apoBR = by('BR', isAporte),                 resBR = by('BR', isResgate);

        let csv = 'sep=;\r\n';
        csv += 'RELATÓRIO MENSAL FINFAM;Mês: ' + ym + ';Data da Exportação: ' + new Date().toLocaleDateString('pt-BR') + '\r\n\r\n';
        csv += 'RESUMO CONSOLIDADO\r\n';
        csv += 'Espanha (EUR);Receitas: ' + fmt(incES) + ';Despesas: ' + fmt(expES) + ';Aportes: ' + fmt(apoES) + ';Resgates: ' + fmt(resES) + ';Saldo: ' + fmt(incES-expES-apoES+resES) + '\r\n';
        csv += 'Brasil (BRL);Receitas: ' + fmt(incBR) + ';Despesas: ' + fmt(expBR) + ';Aportes: ' + fmt(apoBR) + ';Resgates: ' + fmt(resBR) + ';Saldo: ' + fmt(incBR-expBR-apoBR+resBR) + '\r\n\r\n';
        csv += 'DETALHAMENTO DE LANÇAMENTOS\r\n';
        csv += 'Data;Descrição;Categoria;Responsável;País;Tipo;Movimento;Valor Formatado;Valor Numérico;Moeda\r\n';

        txs.forEach(t => {
            const cat = getCategoryDisplay(t.categoryId);
            const cur = t.country === 'BR' ? 'BRL' : 'EUR';
            const typeStr = t.type === 'expense' ? 'Despesa' : t.type === 'income' ? 'Receita' : 'Investimento';
            let movement = '';
            if (t.type === 'investment') {
                movement = t.investAction === 'resgate' ? 'Resgate'
                        : t.investAction === 'resgate_interno' ? 'Resgate Interno'
                        : 'Aporte';
            }
            const numVal = (Number(t.amount) || 0).toFixed(2).replace('.', ',');
            const sign = t.type === 'expense' ? '-' : t.type === 'income' ? '+' : (isResgate(t) ? '+' : '-');
            const desc = (t.description || '').replace(/;/g, ',');
            const resp = (t.assignedTo || 'Casal').replace(/;/g, ',');
            csv += fmtDate(t.date) + ';' + desc + ';' + cat.name + ';' + resp + ';' + (t.country || 'ES') + ';' + typeStr + ';' + movement + ';"' + sign + numVal + '";' + numVal + ';' + cur + '\r\n';
        });

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'FinFam_' + ym + '_Relatorio.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('📊 CSV gerado!', 'success');
    };

    // -------- CONFIGURAÇÕES --------
    const renderSettings = () => {
        const isAdmin = state.currentUser && state.currentUser.role === 'admin';
        return `
            <div style="max-width:900px">
                <h1 style="color:#1e3a5f;margin:0 0 4px;font-size:24px">Configurações</h1>
                <p style="color:#475569;margin:0 0 24px;font-size:14px">Gerencie integrações, moedas e acessos</p>

                <div class="card" style="padding:24px;margin-bottom:24px">
                    <h3 style="color:#1e3a5f;margin-top:0">Banco de Dados (Google Apps Script)</h3>
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
                    <h3 style="color:#1e3a5f;margin-top:0">Usuários do Sistema</h3>
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
                                            ${u.id !== (state.currentUser && state.currentUser.id) && isAdmin
                                                ? '<button onclick="App.deleteUser(\'' + u.id + '\')" style="background:none;border:none;cursor:pointer;color:#dc2626">Excluir</button>'
                                                : '-'}
                                        </td>
                                    </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                    ${isAdmin ? `
                        <h4 style="margin:16px 0 8px;color:#1e3a5f">Adicionar Novo Usuário</h4>
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
                            <input type="text" id="newUserName" class="input-field" placeholder="Nome">
                            <input type="email" id="newUserEmail" class="input-field" placeholder="E-mail">
                            <input type="password" id="newUserPassword" class="input-field" placeholder="Senha">
                            <button class="btn-primary" onclick="App.addUser()">Adicionar</button>
                        </div>` : ''}
                </div>

                ${isAdmin ? `
                    <div class="card" style="padding:24px;border:1px solid #fecaca;background:#fff5f5">
                        <h3 style="color:#dc2626;margin-top:0">Zona de Perigo</h3>
                        <p style="font-size:13px;color:#475569">Ações destrutivas sobre a base local e remota</p>
                        <div style="display:flex;gap:12px;flex-wrap:wrap">
                            <button class="btn-secondary" onclick="App.cleanGhostData()">🧹 Limpar Dados Inválidos</button>
                            <button class="btn-danger" onclick="App.resetDriveData()">🗑️ Limpar Banco no Drive</button>
                            <button class="btn-danger" onclick="App.resetAllData()">⚠️ Reset Fábrica</button>
                        </div>
                    </div>` : ''}
            </div>`;
    };

    const saveSettings = () => {
        const url = el('cfgScriptUrl') ? el('cfgScriptUrl').value.trim() : '';
        state.settings.googleScriptUrl = url;
        saveState();
        showToast('Configurações salvas!', 'success');
    };

    const addUser = async () => {
        const name  = el('newUserName') ? el('newUserName').value.trim() : '';
        const email = el('newUserEmail') ? el('newUserEmail').value.trim().toLowerCase() : '';
        const pwd   = el('newUserPassword') ? el('newUserPassword').value : '';

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
        showToast('Usuário ' + name + ' adicionado!', 'success');
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
        state.transactions = state.transactions
            .map(normalizeTx)
            .filter(t => t && t.date && t.description && Number(t.amount) > 0);
        saveState();
        syncToDrive();
        refreshAllViews();
        showToast('Limpeza concluída! ' + (before - state.transactions.length) + ' registros removidos.', 'success');
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

    // ============================================================
    // MODAL
    // ============================================================
    const showTransactionModal = (txId) => {
        const tx = txId ? state.transactions.find(t => t.id === txId) : null;
        const isInvestment = tx ? tx.type === 'investment' : false;
        const investAction = tx && tx.investAction ? tx.investAction : 'aporte';

        const overlay = el('modalOverlay');
        const content = el('modalContent');
        if (!overlay || !content) { showToast('Erro: modal não encontrado.', 'error'); return; }

        const defaultDate = tx ? parseDateToYMD(tx.date) : new Date().toISOString().slice(0,10);
        const currentCountry = tx ? sanitizeCountry(tx.country) : 'ES';

        content.innerHTML = `
            <div class="modal-header">
                <div class="modal-title">${tx ? 'Editar Lançamento' : 'Novo Lançamento'}</div>
                <button class="close-btn" onclick="App.closeModal()" type="button">&times;</button>
            </div>
            <form onsubmit="App.saveTransaction(event, '${tx ? tx.id : ''}')" autocomplete="off">
                <div class="form-group">
                    <label class="form-label">Tipo</label>
                    <select id="txType" class="input-field" onchange="App.onTxTypeChange(this.value)">
                        <option value="expense"    ${tx && tx.type === 'expense' ? 'selected' : ''}>Despesa</option>
                        <option value="income"     ${tx && tx.type === 'income'  ? 'selected' : ''}>Receita</option>
                        <option value="investment" ${isInvestment                 ? 'selected' : ''}>Investimento (Aporte / Resgate)</option>
                    </select>
                </div>

                <div class="form-group" id="investActionGroup" style="${isInvestment ? '' : 'display:none;'}">
                    <label class="form-label">Movimento de Investimento</label>
                    <select id="txInvestAction" class="input-field">
                        <option value="aporte"           ${investAction === 'aporte'           ? 'selected' : ''}>💰 Aporte — guardar na reserva</option>
                        <option value="resgate"          ${investAction === 'resgate'          ? 'selected' : ''}>💸 Resgate — voltar para o caixa</option>
                        <option value="resgate_interno"  ${investAction === 'resgate_interno'  ? 'selected' : ''}>🔒 Resgate Interno — só sai do patrimônio</option>
                    </select>
                    <div style="font-size:11px;color:#475569;margin-top:6px;line-height:1.5;background:#f8fafc;padding:8px;border-radius:6px;">
                        <strong>💰 Aporte:</strong> sai do caixa, entra no patrimônio.<br>
                        <strong>💸 Resgate:</strong> sai do patrimônio, volta ao caixa e conta no mês.<br>
                        <strong>🔒 Resgate Interno:</strong> sai do patrimônio mas <em>não</em> entra em relatórios nem no caixa do mês.
                    </div>
                </div>

                <div class="form-group">
                    <label class="form-label">Data</label>
                    <input type="date" id="txDate" class="input-field" value="${defaultDate}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Descrição</label>
                    <input type="text" id="txDescription" class="input-field" value="${tx ? String(tx.description || '').replace(/"/g,'&quot;') : ''}" placeholder="Ex: Mercado, Salário, Aporte mensal..." required>
                </div>
                <div class="form-group" id="categoryGroup" style="${isInvestment ? 'display:none;' : ''}">
                    <label class="form-label">Categoria</label>
                    <select id="txCategory" class="input-field">
                        ${(state.categories || []).map(c => {
                            const cat = getCategoryDisplay(c.id);
                            return '<option value="' + c.id + '" ' + (tx && tx.categoryId === c.id ? 'selected' : '') + '>' + cat.icon + ' ' + cat.name + '</option>';
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
                            <option value="ES" ${currentCountry === 'ES' ? 'selected' : ''}>🇪🇸 Espanha (€)</option>
                            <option value="BR" ${currentCountry === 'BR' ? 'selected' : ''}>🇧🇷 Brasil (R$)</option>
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
        const actionGroup = el('investActionGroup');
        const isInv = type === 'investment';
        if (catGroup)    catGroup.style.display    = isInv ? 'none' : 'block';
        if (actionGroup) actionGroup.style.display = isInv ? 'block' : 'none';
    };

    const saveTransaction = (e, txId) => {
        e.preventDefault();
        try {
            const type        = el('txType').value;
            const date        = el('txDate').value;
            const description = el('txDescription').value.trim();
            const country     = sanitizeCountry(el('txCountry').value);
            const amount      = sanitizeAmount(el('txAmount').value);
            const assignedTo  = el('txAssignedTo').value;

            let investAction;
            if (type === 'investment') {
                investAction = sanitizeInvestAction(el('txInvestAction') ? el('txInvestAction').value : 'aporte');
            }

            const categoryId = type === 'investment'
                ? getInvestmentCategory().id
                : (el('txCategory').value || 'cat_outros_es');

            if (!date || !description) { showToast('Informe data e descrição.', 'error'); return; }
            if (!Number.isFinite(amount) || amount <= 0) { showToast('Informe um valor numérico positivo.', 'error'); return; }

            const cleanYMD = parseDateToYMD(date);
            if (!cleanYMD || cleanYMD.length !== 10) { showToast('Data inválida.', 'error'); return; }

            const now = new Date().toISOString();

            if (txId) {
                const idx = state.transactions.findIndex(t => t.id === txId);
                if (idx === -1) { showToast('Lançamento não encontrado.', 'error'); return; }

                const updated = Object.assign({}, state.transactions[idx], {
                    type, date: cleanYMD, description, categoryId,
                    country, amount, assignedTo, updatedAt: now
                });
                if (type === 'investment') updated.investAction = investAction;
                else delete updated.investAction;

                state.transactions[idx] = normalizeTx(updated);
            } else {
                const newTx = {
                    id: 'tx_' + generateId(),
                    type, date: cleanYMD, description, categoryId,
                    country, amount, assignedTo,
                    createdAt: now, updatedAt: now
                };
                if (type === 'investment') newTx.investAction = investAction;
                state.transactions.unshift(normalizeTx(newTx));
            }

            saveState();
            closeModal();
            refreshAllViews();
            syncToDrive();

            const msg = txId ? '✅ Lançamento atualizado!'
                      : type === 'investment'
                        ? (investAction === 'resgate' ? '💸 Resgate registrado!'
                          : investAction === 'resgate_interno' ? '🔒 Resgate Interno registrado!'
                          : '💰 Aporte registrado!')
                        : '✅ Lançamento registrado!';
            showToast(msg, 'success');
        } catch (err) {
            console.error('saveTransaction:', err);
            showToast('Erro ao salvar: ' + (err.message || 'desconhecido'), 'error');
        }
    };

    const deleteTransaction = (txId) => {
        if (!confirm('Excluir este lançamento?')) return;
        state.transactions = state.transactions.filter(t => t.id !== txId);
        saveState();
        refreshAllViews();
        syncToDrive();
        showToast('Lançamento removido.', 'info');
    };

    // ============================================================
    // APP PRINCIPAL
    // ============================================================
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
                        <div class="user-avatar">${state.currentUser ? (state.currentUser.name || 'U').charAt(0).toUpperCase() : 'U'}</div>
                        <div style="flex:1;min-width:0">
                            <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${state.currentUser ? state.currentUser.name : ''}</div>
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

    // ============================================================
    // INIT
    // ============================================================
    const init = () => {
        try {
            initState();

            ['click','keydown','mousemove','touchstart'].forEach(evt =>
                document.addEventListener(evt, resetInactivityTimer, { passive: true })
            );

            if (!isSetup()) renderSetup();
            else if (!isLoggedIn()) renderLogin();
            else {
                renderApp();
                showConnectionOverlay();
                syncFromDrive(true).finally(hideConnectionOverlay);
            }
        } catch(e) {
            console.error('init:', e);
            document.getElementById('app').innerHTML =
                '<div style="padding:40px;font-family:sans-serif;text-align:center;">' +
                '<h2 style="color:#dc2626;">Erro ao iniciar</h2>' +
                '<p style="color:#475569;">' + (e.message || 'Erro desconhecido') + '</p>' +
                '<button onclick="localStorage.clear();location.reload()" style="padding:10px 20px;background:#1e3a5f;color:#fff;border:none;border-radius:6px;cursor:pointer;margin-top:16px;">Resetar e Recarregar</button>' +
                '</div>';
        }
    };

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
