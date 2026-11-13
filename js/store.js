// Податоци: секогаш во localStorage, по избор синхронизирани со Firebase Firestore.
// Бришењето е „меко“ (deleted: true) за синхронизацијата да не враќа избришани записи.
(function (global) {
    const LS_KEY = 'carina-fakturi-v1';
    const KINDS = ['companies', 'services', 'invoices'];
    const COLLECTION = { companies: 'carina_companies', services: 'carina_services', invoices: 'carina_invoices' };

    // Firebase клучот е јавен по дизајн — заштитата е во Firestore security rules.
    const FIREBASE_CONFIG = {
        apiKey: 'AIzaSyCZsBN_5xfngXVdisYk12xUr-gDebeHSfs',
        authDomain: 'brainster-labs-ef731.firebaseapp.com',
        projectId: 'brainster-labs-ef731',
        storageBucket: 'brainster-labs-ef731.firebasestorage.app',
        messagingSenderId: '765476472631',
        appId: '1:765476472631:web:57c231cd5fd8705f58fcb2'
    };

    const SEED = {
        companies: [
            {
                id: 'seed-danipa', mine: true, vatPayer: true, prefix: '',
                name: 'ДТУ ДАНИ–ПА ПЛАНТЕЛА ДООЕЛ', address: 'Ул. Шишман Ангеловски бр. 5', city: '1000 Скопје-Аеродром',
                country: 'Македонија', edb: '4032023558550', embs: '', bank: 'Комерцијална Банка',
                account: '300 0000050150 33', phone: '+389 (0)71 338 227', email: ''
            },
            {
                id: 'seed-ampela', mine: true, vatPayer: true, prefix: '',
                name: 'ДТУ АМПЕЛА-АЛПА ДООЕЛ', address: 'Ул. Шишман Ангеловски бр. 5', city: '1000 Скопје-Аеродром',
                country: 'Македонија', edb: '4032026572987', embs: '', bank: 'Комерцијална Банка',
                account: '300 0000055248 65', phone: '+389 (0)71 338 227', email: ''
            }
        ],
        services: [
            { id: 'seed-s01', code: '01', name: 'Изготвување увозна царинска декларација (ЕЦД)', unit: 'декл.', price: 1500, vat: 18, passthrough: false },
            { id: 'seed-s02', code: '02', name: 'Изготвување извозна царинска декларација (ЕЦД)', unit: 'декл.', price: 1200, vat: 18, passthrough: false },
            { id: 'seed-s03', code: '03', name: 'Транзитна декларација (NCTS / Т1)', unit: 'декл.', price: 1000, vat: 18, passthrough: false },
            { id: 'seed-s04', code: '04', name: 'Дополнителен наименок во декларација', unit: 'наим.', price: 150, vat: 18, passthrough: false },
            { id: 'seed-s05', code: '05', name: 'Шпедитерска услуга', unit: 'услуга', price: 1500, vat: 18, passthrough: false },
            { id: 'seed-s06', code: '06', name: 'Изготвување уверение за потекло EUR.1', unit: 'парче', price: 600, vat: 18, passthrough: false },
            { id: 'seed-s07', code: '07', name: 'Царинска гаранција (обезбедување на долг)', unit: 'услуга', price: 800, vat: 18, passthrough: false },
            { id: 'seed-s08', code: '08', name: 'Царина (платена во име на налогодавачот)', unit: '', price: 0, vat: 0, passthrough: true },
            { id: 'seed-s09', code: '09', name: 'ДДВ при увоз (платен во име на налогодавачот)', unit: '', price: 0, vat: 0, passthrough: true },
            { id: 'seed-s10', code: '10', name: 'Терминални и манипулативни трошоци', unit: '', price: 0, vat: 0, passthrough: true },
            { id: 'seed-s11', code: '11', name: 'Фитосанитарна / ветеринарна контрола', unit: '', price: 0, vat: 0, passthrough: true }
        ]
    };

    const DEFAULT_SETTINGS = {
        sync: true,
        note: 'Плаќање во рок од 8 дена од датумот на фактурата. По истекот на рокот се пресметува законска казнена камата.',
        dueDays: 8,
        place: 'Скопје'
    };

    const listeners = new Set();
    let data = { companies: [], services: [], invoices: [], settings: { ...DEFAULT_SETTINGS } };
    let db = null;
    let syncState = 'off'; // off | connecting | ok | error

    function uid() {
        if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    function persist() {
        try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) { console.warn('localStorage:', e); }
    }

    function emit() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

    function load() {
        let raw = null;
        try { raw = localStorage.getItem(LS_KEY); } catch (e) {}
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                KINDS.forEach(k => { data[k] = Array.isArray(parsed[k]) ? parsed[k] : []; });
                data.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
            } catch (e) { console.warn('Неважечки локални податоци', e); }
        }
        // Почетни записи со фиксни ID — updatedAt 0, па секоја подоцнежна измена има предност.
        ['companies', 'services'].forEach(k => {
            if (!data[k].length) data[k] = SEED[k].map(x => ({ ...x, createdAt: 0, updatedAt: 0 }));
        });
        persist();
    }

    function all(kind) {
        return data[kind].filter(x => !x.deleted);
    }

    function get(kind, id) {
        return data[kind].find(x => x.id === id && !x.deleted) || null;
    }

    function upsert(kind, obj) {
        const now = Date.now();
        const rec = { ...obj, id: obj.id || uid(), updatedAt: now, createdAt: obj.createdAt || now };
        const i = data[kind].findIndex(x => x.id === rec.id);
        if (i >= 0) data[kind][i] = rec; else data[kind].push(rec);
        persist();
        pushRemote(kind, rec);
        emit();
        return rec;
    }

    function remove(kind, id) {
        const rec = data[kind].find(x => x.id === id);
        if (!rec) return;
        upsert(kind, { ...rec, deleted: true });
    }

    function settings() { return data.settings; }

    function saveSettings(patch) {
        const wasSync = data.settings.sync;
        data.settings = { ...data.settings, ...patch };
        persist();
        if (data.settings.sync && !wasSync) startSync();
        if (!data.settings.sync) setSyncState('off');
        emit();
    }

    // ---------------- Firebase ----------------
    function setSyncState(s, msg) {
        syncState = s;
        global.dispatchEvent(new CustomEvent('syncstate', { detail: { state: s, message: msg || '' } }));
    }

    function stripUndefined(o) { return JSON.parse(JSON.stringify(o)); }

    function pushRemote(kind, rec) {
        if (!db || !data.settings.sync) return;
        db.collection(COLLECTION[kind]).doc(rec.id).set(stripUndefined(rec))
            .catch(err => { console.error('Firestore запис:', err); setSyncState('error', err.message); });
    }

    async function startSync() {
        if (!data.settings.sync) return setSyncState('off');
        if (!global.firebase || !firebase.firestore) return setSyncState('error', 'Firebase не е вчитан (нема интернет?)');
        try {
            setSyncState('connecting');
            if (!db) {
                if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
                db = firebase.firestore();
            }
            let changed = false;
            for (const kind of KINDS) {
                const snap = await db.collection(COLLECTION[kind]).get();
                const remote = new Map();
                snap.forEach(doc => remote.set(doc.id, doc.data()));
                const local = new Map(data[kind].map(x => [x.id, x]));

                remote.forEach((r, id) => {
                    const l = local.get(id);
                    if (!l || (r.updatedAt || 0) > (l.updatedAt || 0)) { local.set(id, r); changed = true; }
                });
                local.forEach((l, id) => {
                    const r = remote.get(id);
                    if (!r || (l.updatedAt || 0) > (r.updatedAt || 0)) pushRemote(kind, l);
                });
                data[kind] = Array.from(local.values());
            }
            persist();
            if (changed) emit();
            setSyncState('ok');
        } catch (err) {
            console.error('Синхронизација:', err);
            setSyncState('error', err.message);
        }
    }

    function exportJSON() {
        return JSON.stringify({ app: 'carinski-fakturi', version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2);
    }

    function importJSON(text) {
        const parsed = JSON.parse(text);
        let count = 0;
        KINDS.forEach(kind => {
            (parsed[kind] || []).forEach(rec => {
                if (!rec || !rec.id) return;
                const cur = data[kind].find(x => x.id === rec.id);
                if (!cur || (rec.updatedAt || 0) >= (cur.updatedAt || 0)) {
                    const i = data[kind].indexOf(cur);
                    if (i >= 0) data[kind][i] = rec; else data[kind].push(rec);
                    pushRemote(kind, rec);
                    count++;
                }
            });
        });
        if (parsed.settings) data.settings = { ...data.settings, ...parsed.settings };
        persist();
        emit();
        return count;
    }

    global.Store = {
        load, all, get, upsert, remove, settings, saveSettings, startSync, exportJSON, importJSON,
        onChange: fn => listeners.add(fn),
        syncState: () => syncState
    };
})(window);
