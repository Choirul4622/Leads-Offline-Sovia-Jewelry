/**
 * db.js
 * Handles IndexedDB operations for offline capability.
 */

const DB_NAME = 'StoreVisitDB';
const DB_VERSION = 2; // Upgraded to v2: added PRODUCTS store

const STORES = {
    USERS: 'users',           // Caches users for offline login
    STORE_TARGETS: 'store_targets', // Caches store targets
    VISITS: 'visits',         // Caches visit history for dashboard
    SYNC_QUEUE: 'sync_queue', // Queue for offline data to be sent
    SESSION: 'session',       // Stores active session
    PRODUCTS: 'products'      // Stores product catalog (nama + harga per unit)
};

let db;

const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.error);
            reject(event.target.error);
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Create object stores if they don't exist
            if (!db.objectStoreNames.contains(STORES.USERS)) {
                db.createObjectStore(STORES.USERS, { keyPath: 'username' });
            }
            if (!db.objectStoreNames.contains(STORES.STORE_TARGETS)) {
                db.createObjectStore(STORES.STORE_TARGETS, { keyPath: 'storeName' });
            }
            if (!db.objectStoreNames.contains(STORES.VISITS)) {
                db.createObjectStore(STORES.VISITS, { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
                db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORES.SESSION)) {
                db.createObjectStore(STORES.SESSION, { keyPath: 'id' });
            }
            // New in v2: Products store
            if (!db.objectStoreNames.contains(STORES.PRODUCTS)) {
                db.createObjectStore(STORES.PRODUCTS, { keyPath: 'productName' });
            }
        };
    });
};

// Generic DB Operations
const putData = (storeName, data) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(data);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const getData = (storeName, key) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const getAllData = (storeName) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const deleteData = (storeName, key) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
};

const clearStore = (storeName) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
};

// Specific Helpers
const saveSession = (user) => putData(STORES.SESSION, { id: 'active', ...user });
const getSession = () => getData(STORES.SESSION, 'active');
const clearSession = () => deleteData(STORES.SESSION, 'active');

const addToSyncQueue = (action, payload) => {
    const id = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
    return putData(STORES.SYNC_QUEUE, {
        id,
        action,
        payload,
        timestamp: new Date().toISOString(),
        status: 'pending'
    });
};

const getSyncQueue = () => getAllData(STORES.SYNC_QUEUE);
const removeFromSyncQueue = (id) => deleteData(STORES.SYNC_QUEUE, id);

const updateSyncQueuePayload = (action, keyVal, newPayload) => {
    return new Promise(async (resolve, reject) => {
        try {
            const queue = await getSyncQueue();
            for (const item of queue) {
                if (item.action === action && item.payload) {
                    const payload = item.payload;
                    const match = (payload.id && payload.id.toString() === keyVal.toString()) || 
                                  (payload.storeName && payload.storeName.toString() === keyVal.toString()) || 
                                  (payload.productName && payload.productName.toString() === keyVal.toString()) || 
                                  (payload.username && payload.username.toString() === keyVal.toString());
                    if (match) {
                        item.payload = newPayload;
                        await putData(STORES.SYNC_QUEUE, item);
                        resolve(true);
                        return;
                    }
                }
            }
            resolve(false);
        } catch (e) {
            reject(e);
        }
    });
};

const cleanupOrphanData = async () => {
    try {
        const queue = await getSyncQueue();
        const visits = await getAllData(STORES.VISITS);
        const products = await getAllData(STORES.PRODUCTS);
        const storeTargets = await getAllData(STORES.STORE_TARGETS);
        const users = await getAllData(STORES.USERS);

        const visitIds = new Set(visits.map(v => v.id.toString()));
        const productNames = new Set(products.map(p => p.productName));
        const storeNames = new Set(storeTargets.map(s => s.storeName));
        const usernames = new Set(users.map(u => u.username));

        let removedCount = 0;

        for (const item of queue) {
            let isOrphan = false;
            // Jika ada antrean edit tapi data aslinya sudah tidak ada di lokal (yatim/mandul)
            if (item.action === 'editVisit' && item.payload && item.payload.id) {
                if (!visitIds.has(item.payload.id.toString())) isOrphan = true;
            } else if (item.action === 'saveProduct' && item.payload && item.payload.productName) {
                if (!productNames.has(item.payload.productName)) isOrphan = true;
            } else if (item.action === 'saveStoreTarget' && item.payload && item.payload.storeName) {
                if (!storeNames.has(item.payload.storeName)) isOrphan = true;
            } else if (item.action === 'saveUser' && item.payload && item.payload.username) {
                if (!usernames.has(item.payload.username)) isOrphan = true;
            }

            // Hapus juga antrean yang tidak punya payload (corrupted/mandul)
            if (!item.payload || typeof item.payload !== 'object') {
                isOrphan = true;
            }

            if (isOrphan) {
                console.warn(`[Auto-Repair] Membuang antrean yatim/rusak: ${item.action}`, item);
                await removeFromSyncQueue(item.id);
                removedCount++;
            }
        }
        
        if (removedCount > 0) {
            console.log(`[Auto-Repair] Selesai membersihkan ${removedCount} data yatim/mandul.`);
        }
    } catch (e) {
        console.error('[Auto-Repair] Gagal membersihkan data yatim:', e);
    }
};

// Expose to global scope for use in other files
window.AppDB = {
    init: initDB,
    put: putData,
    get: getData,
    getAll: getAllData,
    delete: deleteData,
    clear: clearStore,
    saveSession,
    getSession,
    clearSession,
    addToSyncQueue,
    getSyncQueue,
    removeFromSyncQueue,
    updateSyncQueuePayload,
    cleanupOrphanData,
    STORES
};
