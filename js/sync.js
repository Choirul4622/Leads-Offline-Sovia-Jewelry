/**
 * sync.js
 * Handles synchronization between IndexedDB and Google Apps Script backend.
 */

// IMPORTANT: Replace this with the actual GAS Web App URL after deployment
const GAS_URL = 'https://script.google.com/macros/s/AKfycby62gS7Cqx6yI-L-BwVB-3u9OsQyzwvz9SgbBOdZV-ZHMHR-TWJGXW5fBDp_EgJcVYR/exec';

const SyncManager = {
    isOnline: navigator.onLine,
    isSyncing: false,
    syncInterval: null,
    syncTimeoutMs: 15000,

    init() {
        window.addEventListener('online', this.handleOnline.bind(this));
        window.addEventListener('offline', this.handleOffline.bind(this));
        
        // Check initial state
        this.updateSyncStatusUI();

        // Start background sync interval (every 60 seconds)
        this.startBackgroundSync();
    },

    startBackgroundSync() {
        if (this.syncInterval) clearInterval(this.syncInterval);
        this.syncInterval = setInterval(() => {
            if (this.isOnline && !this.isSyncing) {
                this.processQueue();
            }
        }, 60000); // 60 seconds
    },

    handleOnline() {
        this.isOnline = true;
        this.updateSyncStatusUI();
        if (window.app && window.app.showToast) {
            window.app.showToast('Koneksi kembali. Memulai sinkronisasi...', 'info');
        }
        this.processQueue();
    },

    handleOffline() {
        this.isOnline = false;
        this.updateSyncStatusUI();
        if (window.app && window.app.showToast) {
            window.app.showToast('Koneksi terputus. Mode offline aktif.', 'error');
        }
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
                            // If it has a temporary local ID, remove it
                            if (item.payload.id && item.payload.id.toString().startsWith('L-')) {
                                await window.AppDB.delete(window.AppDB.STORES.VISITS, item.payload.id);
                            }
                            await window.AppDB.put(window.AppDB.STORES.VISITS, {
                                ...item.payload,
                                id: response.id || item.payload.id
                            });
                        } else if (item.action === 'editVisit') {
                            await window.AppDB.put(window.AppDB.STORES.VISITS, item.payload);
                        } else if (item.action === 'deleteVisit') {
                            await window.AppDB.delete(window.AppDB.STORES.VISITS, item.payload.id);
                        } else if (item.action === 'saveProduct') {
                            await window.AppDB.put(window.AppDB.STORES.PRODUCTS, item.payload);
                        } else if (item.action === 'deleteProduct') {
                            await window.AppDB.delete(window.AppDB.STORES.PRODUCTS, item.payload.productName);
                        } else if (item.action === 'saveStoreTarget') {
                            await window.AppDB.put(window.AppDB.STORES.STORE_TARGETS, item.payload);
                        } else if (item.action === 'deleteStoreTarget') {
                            await window.AppDB.delete(window.AppDB.STORES.STORE_TARGETS, item.payload.storeName);
                        } else if (item.action === 'saveUser') {
                            await window.AppDB.put(window.AppDB.STORES.USERS, item.payload);
                        } else if (item.action === 'deleteUser') {
                            await window.AppDB.delete(window.AppDB.STORES.USERS, item.payload.username);
                        }
                    } else {
                        const errMsg = response ? (response.message || response.error || JSON.stringify(response)) : 'Unknown';
                        console.error(`Backend error for action '${item.action}':`, errMsg, 'Item:', item);
                        
                        // Jika error dari backend adalah 'Unknown action' atau data tidak ditemukan ('not found'),
                        // Hapus dari antrean agar tidak menyumbat queue selamanya.
                        if (response && (response.message === 'Unknown action' || (response.message && response.message.toLowerCase().includes('not found')))) {
                            console.warn(`Aksi '${item.action}' dilewati karena: ${response.message}. Menghapus dari antrean...`);
                            await window.AppDB.removeFromSyncQueue(item.id);
                        } else {
                            break; // Berhenti memproses antrean jika error bersifat sistem/network
                        }
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

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.syncTimeoutMs);

        try {
            const response = await fetch(GAS_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: item.action,
                    data: item.payload
                }),
                headers: {
                    'Content-Type': 'text/plain;charset=utf-8', 
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
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
