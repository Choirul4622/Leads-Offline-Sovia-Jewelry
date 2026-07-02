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
    STORES
};
