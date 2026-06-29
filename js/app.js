/**
 * app.js
 * Main application logic handling UI, DOM events, and calculations.
 */

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(reg => console.log('Service Worker registered', reg))
            .catch(err => console.error('Service Worker registration failed', err));
    });
}


document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize IndexedDB
    try {
        await window.AppDB.init();
        console.log('IndexedDB initialized');
    } catch (e) {
        console.error('Failed to initialize DB', e);
        showToast('Gagal memuat database lokal', 'error');
    }

    // 2. Initialize SyncManager
    window.SyncManager.init();

    // 3. App State & DOM Elements
    const appState = {
        session: await window.AppDB.getSession(),
        storeTargets: [],
        users: []
    };

    const elements = {
        screens: {
            login: document.getElementById('login-screen'),
            app: document.getElementById('app-screen')
        },
        sidebar: {
            el: document.getElementById('sidebar'),
            openBtn: document.getElementById('open-sidebar'),
            closeBtn: document.getElementById('close-sidebar'),
            navItems: document.querySelectorAll('.nav-item'),
            userName: document.getElementById('active-user-name'),
            storeBadge: document.getElementById('active-store-badge'),
            logoutBtn: document.getElementById('btn-logout')
        },
        panels: document.querySelectorAll('.panel'),
        pageTitle: document.getElementById('current-page-title'),
        forms: {
            login: document.getElementById('login-form'),
            visit: document.getElementById('visit-form'),
            storeTarget: document.getElementById('store-target-form'),
            user: document.getElementById('user-form')
        },
        overlay: document.getElementById('loading-overlay')
    };

    // --- UTILITIES ---
    const showToast = (message, type = 'info') => {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let icon = 'info';
        if(type === 'success') icon = 'check-circle';
        if(type === 'error') icon = 'alert-circle';

        toast.innerHTML = `
            <i data-lucide="${icon}"></i>
            <span>${message}</span>
        `;
        container.appendChild(toast);
        if (window.lucide) lucide.createIcons();
        
        // Trigger reflow for animation
        setTimeout(() => toast.classList.add('show'), 10);
        
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    };
    window.app = { showToast, loadDashboardData, refreshSyncQueueUI }; // Expose globally for sync.js

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
    };

    const showLoading = () => elements.overlay.classList.remove('hidden');
    const hideLoading = () => elements.overlay.classList.add('hidden');

    // --- AUTH & INITIALIZATION ---
    const checkAuth = async () => {
        if (appState.session) {
            // Logged in
            elements.screens.login.classList.remove('active');
            elements.screens.app.classList.remove('hidden');
            setTimeout(() => elements.screens.app.classList.add('active'), 10);
            
            // Setup UI based on role
            elements.sidebar.userName.textContent = appState.session.username;
            elements.sidebar.storeBadge.textContent = appState.session.storeName;
            
            if (appState.session.role !== 'Admin') {
                document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
            } else {
                document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
            }

            // Fetch latest data if online
            if (window.SyncManager.isOnline) {
                await window.SyncManager.fetchInitialData();
            }
            
            await loadStoreTargets();
            await loadDashboardData();
        } else {
            // Not logged in
            elements.screens.app.classList.remove('active');
            setTimeout(() => elements.screens.app.classList.add('hidden'), 300);
            elements.screens.login.classList.add('active');
        }
    };

    // Fetch initial data in background immediately if online, so users cache is ready
    if (window.SyncManager.isOnline) {
        window.SyncManager.fetchInitialData().catch(e => console.error("Background fetch failed", e));
    }

    // Login Submission
    elements.forms.login.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();
        
        showLoading();
        
        // Mock Login (In real app, fetch from GAS or local 'users' store)
        try {
            // Simple mock for testing without backend setup
            let user = null;
            
            // Try fetching from local cache first
            let cachedUser = await window.AppDB.get(window.AppDB.STORES.USERS, username);
            
            // Jika tidak ada di lokal tapi sedang online, coba tarik data terbaru dari server
            if (!cachedUser && window.SyncManager.isOnline) {
                await window.SyncManager.fetchInitialData();
                cachedUser = await window.AppDB.get(window.AppDB.STORES.USERS, username);
            }

            if (cachedUser && cachedUser.password === password) {
                user = cachedUser;
            } else if (username === 'admin' && password === 'admin123') {
                user = { username: 'admin', role: 'Admin', storeName: 'Semua Store' };
            } else if (username === 'store1' && password === 'store1') {
                user = { username: 'store1', role: 'Store', storeName: 'Store Jakarta' };
            } else {
                throw new Error('Username atau password salah');
            }

            appState.session = user;
            await window.AppDB.saveSession(user);
            showToast('Login berhasil', 'success');
            checkAuth();
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            hideLoading();
        }
    });

    // Logout
    elements.sidebar.logoutBtn.addEventListener('click', async () => {
        await window.AppDB.clearSession();
        appState.session = null;
        checkAuth();
    });

    // --- NAVIGATION ---
    elements.sidebar.navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = item.getAttribute('data-target');
            
            // Update active nav
            elements.sidebar.navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Update panels
            elements.panels.forEach(panel => {
                panel.classList.remove('active');
                if (panel.id === `panel-${targetId}`) {
                    panel.classList.add('active');
                }
            });

            // Update title
            elements.pageTitle.textContent = item.textContent.trim();

            // Mobile sidebar close
            if (window.innerWidth <= 1024) {
                elements.sidebar.el.classList.remove('open');
            }

            // Refresh specific panel data
            if (targetId === 'dashboard') loadDashboardData();
            if (targetId === 'sinkronisasi') refreshSyncQueueUI();
            if (targetId === 'validasi') loadStoreTargetsUI();
            if (targetId === 'form-kunjungan') updateFormTargetLabel();
        });
    });

    // Mobile Sidebar Toggle
    elements.sidebar.openBtn.addEventListener('click', () => {
        elements.sidebar.el.classList.add('open');
    });
    elements.sidebar.closeBtn.addEventListener('click', () => {
        elements.sidebar.el.classList.remove('open');
    });

    // --- DATA LOADING & UI ---
    async function loadStoreTargets() {
        const targets = await window.AppDB.getAll(window.AppDB.STORES.STORE_TARGETS);
        appState.storeTargets = targets || [];
        updateFormTargetLabel();
    }

    function updateFormTargetLabel() {
        if (!appState.session) return;
        const myStoreTarget = appState.storeTargets.find(t => t.storeName === appState.session.storeName);
        const targetValue = myStoreTarget ? myStoreTarget.target : 0;
        
        document.getElementById('label-store-name').textContent = appState.session.storeName;
        document.getElementById('calc-target-omset').textContent = formatCurrency(targetValue);
        // Save target in a data attribute for calculation
        document.getElementById('calc-target-omset').dataset.value = targetValue;
        calculateFormValues(); // Recalculate if it was open
    }

    async function loadDashboardData() {
        if (!appState.session) return;
        const visits = await window.AppDB.getAll(window.AppDB.STORES.VISITS);
        
        // Filter by store if not admin
        const myVisits = appState.session.role === 'Admin' 
            ? visits 
            : visits.filter(v => v.storeName === appState.session.storeName);

        // Calculate KPIs
        let tVisit = 0, tDeals = 0, tOmset = 0;
        myVisits.forEach(v => {
            tVisit += (parseInt(v.visitBaru) || 0);
            tDeals += (parseInt(v.totalDeals) || 0);
            tOmset += (parseInt(v.omset) || 0);
        });

        const konversiDeals = tVisit > 0 ? ((tDeals / tVisit) * 100).toFixed(1) : 0;
        
        // Calculate Target Omset for Konversi
        let myTarget = 0;
        if (appState.session.role === 'Admin') {
            // Sum all targets for admin? Or just show N/A
            appState.storeTargets.forEach(t => myTarget += (parseInt(t.target) || 0));
        } else {
            const myTargetObj = appState.storeTargets.find(t => t.storeName === appState.session.storeName);
            myTarget = myTargetObj ? parseInt(myTargetObj.target) : 0;
        }
        
        const konversiOmset = myTarget > 0 ? ((tOmset / myTarget) * 100).toFixed(1) : 0;

        // Update DOM
        document.getElementById('kpi-visit-baru').textContent = tVisit;
        document.getElementById('kpi-total-deals').textContent = tDeals;
        document.getElementById('kpi-konversi-deals').textContent = `${konversiDeals}%`;
        document.getElementById('kpi-omset').textContent = formatCurrency(tOmset);
        document.getElementById('kpi-konversi-omset').textContent = `${konversiOmset}%`;

        // Update Table
        const tbody = document.getElementById('recent-visits-body');
        tbody.innerHTML = '';
        if (myVisits.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Belum ada data kunjungan</td></tr>';
        } else {
            // Sort by timestamp desc (assuming id or timestamp exists)
            const sorted = myVisits.sort((a,b) => new Date(b.timestamp || b.id) - new Date(a.timestamp || a.id)).slice(0, 5);
            sorted.forEach(v => {
                const tr = document.createElement('tr');
                const date = new Date(v.timestamp || parseInt(v.id)).toLocaleDateString('id-ID');
                tr.innerHTML = `
                    <td>${date}</td>
                    <td>${v.storeName}</td>
                    <td>${v.visitBaru}</td>
                    <td>${v.totalDeals}</td>
                    <td>${formatCurrency(v.omset)}</td>
                `;
                tbody.appendChild(tr);
            });
        }
    }

    document.getElementById('btn-refresh-dashboard').addEventListener('click', () => {
        loadDashboardData();
        showToast('Dashboard diperbarui', 'info');
    });

    // --- FORM CALCULATIONS ---
    const calcInputs = ['visit-baru', 'deals-offline', 'deals-referal', 'deals-box', 'omset'];
    calcInputs.forEach(id => {
        document.getElementById(id).addEventListener('input', calculateFormValues);
    });

    function calculateFormValues() {
        const visitBaru = parseInt(document.getElementById('visit-baru').value) || 0;
        const dOffline = parseInt(document.getElementById('deals-offline').value) || 0;
        const dReferal = parseInt(document.getElementById('deals-referal').value) || 0;
        const dBox = parseInt(document.getElementById('deals-box').value) || 0;
        const omset = parseInt(document.getElementById('omset').value) || 0;
        
        const targetOmset = parseInt(document.getElementById('calc-target-omset').dataset.value) || 0;

        const totalDeals = dOffline + dReferal + dBox;
        const konversiDeals = visitBaru > 0 ? ((totalDeals / visitBaru) * 100).toFixed(1) : 0;
        const konversiOmset = targetOmset > 0 ? ((omset / targetOmset) * 100).toFixed(1) : 0;

        document.getElementById('calc-total-deals').textContent = totalDeals;
        document.getElementById('calc-konversi-deals').textContent = `${konversiDeals}%`;
        document.getElementById('calc-konversi-omset').textContent = `${konversiOmset}%`;
    }

    // --- FORM SUBMISSION ---
    elements.forms.visit.addEventListener('submit', async (e) => {
        e.preventDefault();
        showLoading();

        const data = {
            timestamp: new Date().toISOString(),
            user: appState.session.username,
            storeName: appState.session.storeName,
            visitBaru: document.getElementById('visit-baru').value,
            dealsOffline: document.getElementById('deals-offline').value,
            dealsReferal: document.getElementById('deals-referal').value,
            dealsBox: document.getElementById('deals-box').value,
            totalDeals: document.getElementById('calc-total-deals').textContent,
            konversiDeals: document.getElementById('calc-konversi-deals').textContent,
            visitRepair: document.getElementById('visit-repair').value,
            visitBuyback: document.getElementById('visit-buyback').value,
            pengambilanBaru: document.getElementById('pengambilan-baru').value,
            pengambilanRepair: document.getElementById('pengambilan-repair').value,
            qtyCincin: document.getElementById('qty-cincin').value,
            omset: document.getElementById('omset').value,
            konversiOmset: document.getElementById('calc-konversi-omset').textContent
        };

        try {
            // Add to Sync Queue
            await window.AppDB.addToSyncQueue('addVisit', data);
            
            // Try to sync immediately if online
            if (window.SyncManager.isOnline) {
                await window.SyncManager.syncNow();
                showToast('Data kunjungan berhasil disimpan & disinkronisasi', 'success');
            } else {
                showToast('Offline: Data disimpan lokal. Akan dikirim otomatis saat online.', 'info');
                // Also update local visits cache immediately so dashboard reflects it
                await window.AppDB.put(window.AppDB.STORES.VISITS, { ...data, id: Date.now() });
                loadDashboardData();
            }
            
            // Reset form
            elements.forms.visit.reset();
            calculateFormValues();
            
        } catch (err) {
            showToast('Gagal menyimpan data kunjungan', 'error');
            console.error(err);
        } finally {
            hideLoading();
        }
    });

    // --- SYNC QUEUE UI ---
    async function refreshSyncQueueUI() {
        const queue = await window.AppDB.getSyncQueue();
        const tbody = document.getElementById('sync-queue-body');
        tbody.innerHTML = '';
        
        if (queue.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Antrean sinkronisasi kosong</td></tr>';
            return;
        }

        queue.forEach(item => {
            const tr = document.createElement('tr');
            const date = new Date(item.timestamp).toLocaleString('id-ID');
            const store = item.payload.storeName || 'Sistem';
            tr.innerHTML = `
                <td>${date}</td>
                <td><span class="badge">${item.action}</span></td>
                <td>${store}</td>
                <td><span class="status-text ${item.status === 'pending' ? 'text-orange' : ''}">${item.status}</span></td>
            `;
            tbody.appendChild(tr);
        });
    }

    document.getElementById('btn-force-sync').addEventListener('click', () => {
        window.SyncManager.syncNow();
    });

    // --- ADMIN CONFIG FORMS (Store Target & User) ---
    elements.forms.storeTarget.addEventListener('submit', async (e) => {
        e.preventDefault();
        const storeName = document.getElementById('store-name-config').value.trim();
        const target = document.getElementById('store-target-config').value;

        const payload = { storeName, target };
        await window.AppDB.addToSyncQueue('saveStoreTarget', payload);
        
        // Optimistic UI update
        await window.AppDB.put(window.AppDB.STORES.STORE_TARGETS, payload);
        await loadStoreTargets();
        loadStoreTargetsUI();
        showToast('Target ditambahkan ke antrean simpan', 'success');
        
        if (window.SyncManager.isOnline) window.SyncManager.syncNow();
        elements.forms.storeTarget.reset();
    });

    async function loadStoreTargetsUI() {
        const tbody = document.getElementById('stores-list-body');
        tbody.innerHTML = '';
        if (appState.storeTargets.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Belum ada target store</td></tr>';
            return;
        }

        appState.storeTargets.forEach(t => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${t.storeName}</td>
                <td>${formatCurrency(t.target)}</td>
                <td><button class="btn-icon text-muted" title="Fitur hapus belum tersedia di UI"><i data-lucide="trash-2"></i></button></td>
            `;
            tbody.appendChild(tr);
        });
        if (window.lucide) lucide.createIcons();
        
        // Also populate user management dropdown
        const select = document.getElementById('new-store-assign');
        select.innerHTML = '<option value="">-- Pilih Store --</option>';
        appState.storeTargets.forEach(t => {
            select.innerHTML += `<option value="${t.storeName}">${t.storeName}</option>`;
        });
    }
    document.getElementById('btn-refresh-stores').addEventListener('click', loadStoreTargetsUI);

    // Initial load
    checkAuth();
});
