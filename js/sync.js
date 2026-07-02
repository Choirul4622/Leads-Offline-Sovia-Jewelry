/**
 * sync.js
 * Handles synchronization between IndexedDB and Google Apps Script backend.
 */

// IMPORTANT: Replace this with the actual GAS Web App URL after deployment
const GAS_URL = 'https://script.google.com/macros/s/AKfycby62gS7Cqx6yI-L-BwVB-3u9OsQyzwvz9SgbBOdZV-ZHMHR-TWJGXW5fBDp_EgJcVYR/exec';

const SyncManager = {
    isOnline: navigator.onLine,
    isSyncing: false,

    init() {
        window.addEventListener('online', this.handleOnline.bind(this));
        window.addEventListener('offline', this.handleOffline.bind(this));
        
        // Check initial state
        this.updateSyncStatusUI();
    },

    handleOnline() {
        this.isOnline = true;
        this.updateSyncStatusUI();
        window.app.showToast('Koneksi kembali. Memulai sinkronisasi...', 'info');
        this.processQueue();
    },

    handleOffline() {
        this.isOnline = false;
        this.updateSyncStatusUI();
        window.app.showToast('Koneksi terputus. Mode offline aktif.', 'error');
    },

    updateSyncStatusUI() {
        const badge = document.getElementById('offline-badge');
        const syncStatus = document.getElementById('sync-status');
        
        if (this.isOnline) {
            badge.classList.add('hidden');
            if (this.isSyncing) {
                syncStatus.className = 'sync-status syncing';
                syncStatus.innerHTML = '<i data-lucide="refresh-cw" class="status-icon"></i><span class="status-text">Sinkronisasi...</span>';
            } else {
                syncStatus.className = 'sync-status online';
                syncStatus.innerHTML = '<i data-lucide="check-circle-2" class="status-icon"></i><span class="status-text">Tersinkronisasi</span>';
            }
        } else {
            badge.classList.remove('hidden');
            syncStatus.className = 'sync-status offline';
            syncStatus.innerHTML = '<i data-lucide="wifi-off" class="status-icon"></i><span class="status-text">Offline</span>';
        }
        
        // Re-initialize icons in case DOM changed
        if (window.lucide) window.lucide.createIcons();
    },

    async processQueue() {
        if (!this.isOnline || this.isSyncing) return;

        try {
            const queue = await window.AppDB.getSyncQueue();
            if (queue.length === 0) return;

            this.isSyncing = true;
            this.updateSyncStatusUI();

            for (const item of queue) {
                try {
                    // Send to GAS Backend
                    const response = await this.sendToBackend(item);
                    
                    if (response && response.status === 'success') {
                        // Success, remove from queue
                        await window.AppDB.removeFromSyncQueue(item.id);
                        
                        // Update local cache based on action type
                        if (item.action === 'addVisit') {
                            await window.AppDB.put(window.AppDB.STORES.VISITS, {
                                ...item.payload,
                                id: Date.now() // temporary local ID
                            });
                        } else if (item.action === 'saveProduct') {
                            await window.AppDB.put(window.AppDB.STORES.PRODUCTS, item.payload);
                        } else if (item.action === 'deleteProduct') {
                            await window.AppDB.delete(window.AppDB.STORES.PRODUCTS, item.payload.productName);
                        }
                    } else {
                        console.error('Backend returned error for item:', item, response);
                        // Stop processing queue on backend logic error to prevent cascading issues,
                        // unless it's a specific error we can ignore.
                        break; 
                    }
                } catch (error) {
                    console.error('Network/Fetch error syncing item:', item, error);
                    break; // Stop on network error
                }
            }
        } catch (error) {
            console.error('Error reading sync queue:', error);
        } finally {
            this.isSyncing = false;
            this.updateSyncStatusUI();
            
            // Refresh dashboard and sync panel if they are open
            if (window.app && window.app.refreshSyncQueueUI) {
                window.app.refreshSyncQueueUI();
            }
            if (window.app && window.app.loadDashboardData) {
                window.app.loadDashboardData();
            }
        }
    },

    async sendToBackend(item) {
        if (GAS_URL === 'YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE') {
            console.warn('GAS_URL is not set. Simulating success for testing purposes.');
            return new Promise(resolve => setTimeout(() => resolve({ status: 'success' }), 1000));
        }

        // We use POST with URLSearchParams or JSON if the backend supports it.
        // Google Apps Script doPost receives e.parameter or e.postData.contents
        const response = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: item.action,
                data: item.payload
            }),
            headers: {
                'Content-Type': 'text/plain;charset=utf-8', // Bypass CORS preflight for GAS
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    },

    // Functions to trigger sync immediately
    async syncNow() {
        if (!this.isOnline) {
            window.app.showToast('Tidak dapat sinkronisasi. Koneksi offline.', 'error');
            return;
        }
        await this.processQueue();
    },
    
    // Fetch initial data (stores, users, recent visits)
    async fetchInitialData() {
        if (!this.isOnline || GAS_URL === 'YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE') return;
        
        try {
            const response = await fetch(`${GAS_URL}?action=getInitialData`);
            const data = await response.json();
            
            if (data.status === 'success') {
                // Update local caches
                if (data.users) {
                    await window.AppDB.clear(window.AppDB.STORES.USERS);
                    for (const user of data.users) {
                        await window.AppDB.put(window.AppDB.STORES.USERS, user);
                    }
                }
                if (data.stores) {
                    await window.AppDB.clear(window.AppDB.STORES.STORE_TARGETS);
                    for (const store of data.stores) {
                        await window.AppDB.put(window.AppDB.STORES.STORE_TARGETS, store);
                    }
                }
                // Sinkronisasi katalog produk (BARU)
                if (data.products) {
                    await window.AppDB.clear(window.AppDB.STORES.PRODUCTS);
                    for (const product of data.products) {
                        await window.AppDB.put(window.AppDB.STORES.PRODUCTS, product);
                    }
                }
                if (data.recentVisits) {
                    await window.AppDB.clear(window.AppDB.STORES.VISITS);
                    for (const visit of data.recentVisits) {
                        await window.AppDB.put(window.AppDB.STORES.VISITS, visit);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to fetch initial data:', error);
        }
    }
};

window.SyncManager = SyncManager;
