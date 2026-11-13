(function () {
    const { renderSheet, computeTotals, money, dmy, esc } = Sheet;
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const DRAFT_KEY = 'carina-fakturi-draft';
    const SHEET_PX = 794; // ширина на А4 на 96 dpi

    Store.load();

    // ============================================================
    // ПОМОШНИ
    // ============================================================
    function todayISO(offsetDays = 0) {
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function addDays(iso, days) {
        const [y, m, d] = iso.split('-').map(Number);
        const dt = new Date(y, m - 1, d + Number(days || 0));
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    }

    let toastTimer;
    function toast(msg) {
        const el = $('#toast');
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
    }

    const companies = () => Store.all('companies').sort((a, b) => (b.mine - a.mine) || a.name.localeCompare(b.name, 'mk'));
    const mineCompanies = () => companies().filter(c => c.mine);
    const services = () => Store.all('services').sort((a, b) => String(a.code).localeCompare(String(b.code), 'mk', { numeric: true }));
    const invoices = () => Store.all('invoices').sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt - a.createdAt));

    function snapshotCompany(c) {
        if (!c) return null;
        const { id, name, address, city, country, edb, embs, bank, account, phone, email, vatPayer, mine } = c;
        return { id, name, address, city, country, edb, embs, bank, account, phone, email, vatPayer: vatPayer !== false, mine: !!mine };
    }

    // Следен број за излезна фактура: по издавач и година, пр. „ДП-007/2026“
    function nextNumber(fromId, dateISO) {
        const year = (dateISO || todayISO()).slice(0, 4);
        const from = Store.get('companies', fromId);
        const prefix = (from && from.prefix) || '';
        let max = 0;
        Store.all('invoices').forEach(inv => {
            if (inv.type !== 'out' || inv.fromId !== fromId || (inv.date || '').slice(0, 4) !== year) return;
            const m = String(inv.number || '').slice(prefix.length).match(/\d+/);
            if (m) max = Math.max(max, parseInt(m[0], 10));
        });
        return `${prefix}${String(max + 1).padStart(3, '0')}/${year}`;
    }

    function blankItem() { return { name: '', unit: '', qty: 1, price: 0, vat: 18, passthrough: false }; }

    // ============================================================
    // РУТИРАЊЕ (hash) — копчето „назад“ на телефонот работи
    // ============================================================
    const TITLES = { editor: 'Нова фактура', list: 'Фактури', companies: 'Фирми', services: 'Ценовник', preview: 'Преглед' };

    function route() {
        const [view, id] = (location.hash.slice(1) || 'editor').split('/');
        let name = view;
        if (view === 'edit') {
            const inv = Store.get('invoices', id);
            if (inv) loadDraft(JSON.parse(JSON.stringify(inv)));
            name = 'editor';
        }
        if (view === 'preview' && !Store.get('invoices', id)) return go('list');
        if (!TITLES[name]) name = 'editor';

        $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
        $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === (name === 'preview' ? 'list' : name)));
        $('#view-title').textContent = name === 'editor' && draft.id ? 'Уреди фактура' : TITLES[name];
        window.scrollTo(0, 0);

        if (name === 'editor') renderEditor();
        if (name === 'list') renderList();
        if (name === 'companies') renderCompanies();
        if (name === 'services') renderServices();
        if (name === 'preview') renderPreview(id);
    }

    function go(hash) {
        if (location.hash === '#' + hash) route(); else location.hash = hash;
    }

    $$('.tabbar button').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.view === 'editor' && location.hash.startsWith('#edit/')) newDraft();
        go(b.dataset.view);
    }));
    window.addEventListener('hashchange', route);

    // ============================================================
    // УРЕДУВАЧ
    // ============================================================
    let draft;

    function newDraft(type = 'out') {
        const s = Store.settings();
        const mine = mineCompanies();
        const others = companies().filter(c => !c.mine);
        const myId = mine[0] ? mine[0].id : '';
        const otherId = (others[0] || mine[1] || {}).id || '';
        const date = todayISO();
        draft = {
            type,
            fromId: type === 'out' ? myId : otherId,
            toId: type === 'out' ? otherId : myId,
            number: '', autoNumber: true,
            date, due: addDays(date, s.dueDays), place: s.place,
            customs: { regime: 'Увоз', currency: 'EUR' },
            items: [blankItem()],
            note: s.note,
            status: 'unpaid'
        };
        if (type === 'out' && draft.fromId) draft.number = nextNumber(draft.fromId, date);
        saveDraftLocal();
    }

    function loadDraft(inv) {
        draft = inv;
        draft.autoNumber = false;
        draft.customs = draft.customs || {};
        draft.items = draft.items && draft.items.length ? draft.items : [blankItem()];
        saveDraftLocal();
    }

    function saveDraftLocal() {
        try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
    }

    (function restoreDraft() {
        try {
            const raw = localStorage.getItem(DRAFT_KEY);
            if (raw) { draft = JSON.parse(raw); return; }
        } catch (e) {}
        newDraft();
    })();

    const FIELD_MAP = {
        'f-number': 'number', 'f-place': 'place', 'f-date': 'date', 'f-due': 'due', 'f-note': 'note',
        'c-regime': 'customs.regime', 'c-office': 'customs.office', 'c-decl': 'customs.decl',
        'c-decl-date': 'customs.declDate', 'c-vehicle': 'customs.vehicle', 'c-goods-inv': 'customs.goodsInv',
        'c-goods': 'customs.goods', 'c-tariff': 'customs.tariff', 'c-packages': 'customs.packages',
        'c-gross': 'customs.gross', 'c-net': 'customs.net', 'c-value': 'customs.value', 'c-currency': 'customs.currency'
    };

    function getPath(obj, path) { return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj); }
    function setPath(obj, path, val) {
        const keys = path.split('.');
        let o = obj;
        keys.slice(0, -1).forEach(k => { o[k] = o[k] || {}; o = o[k]; });
        o[keys[keys.length - 1]] = val;
    }

    function companyOptions(selectedId) {
        const mine = companies().filter(c => c.mine);
        const others = companies().filter(c => !c.mine);
        const opt = c => `<option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)}</option>`;
        return `<option value="">— избери фирма —</option>` +
            (mine.length ? `<optgroup label="Мои фирми">${mine.map(opt).join('')}</optgroup>` : '') +
            (others.length ? `<optgroup label="Коминтенти">${others.map(opt).join('')}</optgroup>` : '');
    }

    function partyMini(id) {
        const c = Store.get('companies', id);
        if (!c) return '';
        return [c.address, c.city, c.edb ? 'ЕДБ ' + c.edb : '', c.vatPayer === false ? 'не е ДДВ обврзник' : '']
            .filter(Boolean).map(esc).join(' · ');
    }

    function renderEditor() {
        $$('#type-seg button').forEach(b => b.classList.toggle('active', b.dataset.type === draft.type));
        $('#type-hint').textContent = draft.type === 'out'
            ? 'Излезна — фактура што твоја фирма ја издава кон друга фирма.'
            : 'Влезна — фактура што твоја фирма ја добила од друга фирма. Внеси го бројот од нивната фактура.';
        $('#f-from').innerHTML = companyOptions(draft.fromId);
        $('#f-to').innerHTML = companyOptions(draft.toId);
        $('#from-mini').innerHTML = partyMini(draft.fromId);
        $('#to-mini').innerHTML = partyMini(draft.toId);
        Object.entries(FIELD_MAP).forEach(([id, path]) => {
            const v = getPath(draft, path);
            $('#' + id).value = v == null ? '' : v;
        });
        $('#f-number').placeholder = draft.type === 'in' ? 'бр. од добавувачот' : '';
        $('#save-invoice').textContent = draft.id ? 'Зачувај промени' : 'Зачувај и прегледај';
        renderServiceDatalist();
        renderItems();
    }

    function renderServiceDatalist() {
        $('#service-names').innerHTML = services().map(s => `<option value="${esc(s.name)}">`).join('');
    }

    function renderItems() {
        const issuer = Store.get('companies', draft.fromId);
        const noVat = issuer && issuer.vatPayer === false;
        $('#items').innerHTML = draft.items.map((it, i) => `
            <div class="item ${it.passthrough ? 'is-pass' : ''}" data-i="${i}">
                <div class="item-top">
                    <span class="item-no">${i + 1}</span>
                    <input class="item-name" data-k="name" list="service-names" placeholder="Опис на услуга" value="${esc(it.name)}" autocomplete="off">
                    <button class="icon-btn item-del" data-act="del" aria-label="Избриши ставка">✕</button>
                </div>
                <div class="item-grid">
                    <label><span>Кол.</span><input data-k="qty" type="number" inputmode="decimal" step="any" value="${esc(it.qty)}"></label>
                    <label><span>Ед.м.</span><input data-k="unit" value="${esc(it.unit)}" autocomplete="off"></label>
                    <label><span>Цена</span><input data-k="price" type="number" inputmode="decimal" step="0.01" value="${esc(it.price)}"></label>
                    <label><span>ДДВ</span>
                        <select data-k="vat" ${it.passthrough || noVat ? 'disabled' : ''}>
                            ${[18, 10, 5, 0].map(r => `<option value="${r}" ${Number(it.vat) === r ? 'selected' : ''}>${r}%</option>`).join('')}
                        </select>
                    </label>
                </div>
                <div class="item-foot">
                    <label class="check small"><input type="checkbox" data-k="passthrough" ${it.passthrough ? 'checked' : ''}> Трошок за сметка на коминтент</label>
                    <b class="item-sum">${money((Number(it.qty) || 0) * (Number(it.price) || 0))}</b>
                </div>
            </div>`).join('');
        renderTotalsPreview();
    }

    function renderTotalsPreview() {
        const inv = { ...draft, from: snapshotCompany(Store.get('companies', draft.fromId)) };
        const t = computeTotals(inv);
        $('#totals-preview').innerHTML = `
            <div><span>Основица</span><b>${money(t.net)}</b></div>
            <div><span>ДДВ</span><b>${money(t.vat)}</b></div>
            ${t.pass ? `<div><span>Трошоци</span><b>${money(t.pass)}</b></div>` : ''}
            <div class="grand"><span>Вкупно</span><b>${money(t.total)} ден.</b></div>`;
    }

    // --- настани во уредувачот ---
    $('#type-seg').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b || b.dataset.type === draft.type) return;
        const fromMine = (Store.get('companies', draft.fromId) || {}).mine;
        const toMine = (Store.get('companies', draft.toId) || {}).mine;
        draft.type = b.dataset.type;
        // Мојата фирма е издавач кај излезни, примач кај влезни
        if ((draft.type === 'in' && fromMine && !toMine) || (draft.type === 'out' && toMine && !fromMine)) {
            [draft.fromId, draft.toId] = [draft.toId, draft.fromId];
        }
        if (draft.type === 'in' && draft.autoNumber) draft.number = '';
        if (draft.type === 'out' && (draft.autoNumber || !draft.number)) {
            draft.autoNumber = true;
            draft.number = draft.fromId ? nextNumber(draft.fromId, draft.date) : '';
        }
        saveDraftLocal();
        renderEditor();
    });

    function onPartyChange() {
        draft.fromId = $('#f-from').value;
        draft.toId = $('#f-to').value;
        if (draft.type === 'out' && draft.autoNumber && !draft.id) draft.number = draft.fromId ? nextNumber(draft.fromId, draft.date) : '';
        saveDraftLocal();
        renderEditor();
    }
    $('#f-from').addEventListener('change', onPartyChange);
    $('#f-to').addEventListener('change', onPartyChange);

    $('#swap-parties').addEventListener('click', () => {
        [draft.fromId, draft.toId] = [draft.toId, draft.fromId];
        if (draft.type === 'out' && draft.autoNumber && !draft.id) draft.number = draft.fromId ? nextNumber(draft.fromId, draft.date) : '';
        saveDraftLocal();
        renderEditor();
    });

    Object.entries(FIELD_MAP).forEach(([id, path]) => {
        $('#' + id).addEventListener('input', e => {
            setPath(draft, path, e.target.value);
            if (id === 'f-number') draft.autoNumber = false;
            if (id === 'f-date' && e.target.value) {
                draft.due = addDays(e.target.value, Store.settings().dueDays);
                $('#f-due').value = draft.due;
                if (draft.type === 'out' && draft.autoNumber && !draft.id && draft.fromId) {
                    draft.number = nextNumber(draft.fromId, draft.date);
                    $('#f-number').value = draft.number;
                }
            }
            saveDraftLocal();
        });
    });

    function applyService(item, svc) {
        Object.assign(item, { name: svc.name, unit: svc.unit || '', vat: Number(svc.vat) || 0, passthrough: !!svc.passthrough });
        if (Number(svc.price)) item.price = Number(svc.price);
    }

    $('#items').addEventListener('input', e => {
        const row = e.target.closest('.item');
        const k = e.target.dataset.k;
        if (!row || !k) return;
        const it = draft.items[row.dataset.i];
        if (k === 'passthrough') it.passthrough = e.target.checked;
        else if (k === 'qty' || k === 'price' || k === 'vat') it[k] = e.target.value === '' ? '' : Number(e.target.value);
        else it[k] = e.target.value;

        if (k === 'name') {
            const svc = services().find(s => s.name === it.name);
            if (svc) { applyService(it, svc); saveDraftLocal(); return renderItems(); }
        }
        if (k === 'passthrough') { saveDraftLocal(); return renderItems(); }
        row.querySelector('.item-sum').textContent = money((Number(it.qty) || 0) * (Number(it.price) || 0));
        saveDraftLocal();
        renderTotalsPreview();
    });
    $('#items').addEventListener('change', e => {
        if (e.target.dataset.k === 'vat') { draft.items[e.target.closest('.item').dataset.i].vat = Number(e.target.value); saveDraftLocal(); renderTotalsPreview(); }
    });
    $('#items').addEventListener('click', e => {
        const b = e.target.closest('[data-act="del"]');
        if (!b) return;
        draft.items.splice(Number(b.closest('.item').dataset.i), 1);
        if (!draft.items.length) draft.items.push(blankItem());
        saveDraftLocal();
        renderItems();
    });

    $('#add-item').addEventListener('click', () => {
        draft.items.push(blankItem());
        saveDraftLocal();
        renderItems();
        const names = $$('#items .item-name');
        names[names.length - 1].focus();
    });

    $('#reset-editor').addEventListener('click', () => {
        if (!confirm('Да започнам нова празна фактура? Незачуваните промени ќе се изгубат.')) return;
        newDraft(draft.type);
        go('editor');
    });

    $('#save-invoice').addEventListener('click', () => {
        const from = Store.get('companies', draft.fromId);
        const to = Store.get('companies', draft.toId);
        if (!from || !to) return toast('Избери издавач и примач.');
        if (from.id === to.id) return toast('Издавачот и примачот мора да се различни.');
        const items = draft.items.filter(i => String(i.name).trim() || Number(i.price));
        if (!items.length) return toast('Додади барем една ставка.');
        if (!String(draft.number).trim()) return toast('Внеси број на фактура.');
        const dup = Store.all('invoices').find(x => x.id !== draft.id && x.type === draft.type
            && x.fromId === draft.fromId && String(x.number).trim() === String(draft.number).trim());
        if (dup && !confirm(`Веќе постои фактура бр. ${draft.number} од ${from.name}. Сепак да зачувам?`)) return;

        const { autoNumber, ...rest } = draft;
        const rec = Store.upsert('invoices', {
            ...rest,
            number: String(draft.number).trim(),
            items: items.map(i => ({ ...i, qty: Number(i.qty) || 0, price: Number(i.price) || 0, vat: Number(i.vat) || 0 })),
            from: snapshotCompany(from),
            to: snapshotCompany(to),
            total: computeTotals({ ...draft, items, from: snapshotCompany(from) }).total
        });
        newDraft(rec.type);
        toast('Фактурата е зачувана.');
        go('preview/' + rec.id);
    });

    // ============================================================
    // ПРЕГЛЕД / ПЕЧАТ / PDF
    // ============================================================
    let previewId = null;

    function renderPreview(id) {
        previewId = id;
        const inv = Store.get('invoices', id);
        $('#view-title').textContent = `${inv.type === 'out' ? 'Излезна' : 'Влезна'} ${inv.number}`;
        $('#sheet-host').innerHTML = renderSheet(inv);
        $('#pv-paid').textContent = inv.status === 'paid' ? '↺ Неплатена' : '✓ Платена';
        fitSheet();
    }

    function fitSheet() {
        const scaler = $('#sheet-scaler'), host = $('#sheet-host');
        if (!scaler.offsetParent) return;
        const scale = Math.min(1, scaler.clientWidth / SHEET_PX);
        host.style.transform = `scale(${scale})`;
        scaler.style.height = (host.offsetHeight * scale) + 'px';
    }
    window.addEventListener('resize', fitSheet);

    $('#pv-edit').addEventListener('click', () => go('edit/' + previewId));
    $('#pv-dup').addEventListener('click', () => {
        const inv = Store.get('invoices', previewId);
        const copy = JSON.parse(JSON.stringify(inv));
        ['id', 'createdAt', 'updatedAt', 'from', 'to', 'total'].forEach(k => delete copy[k]);
        copy.date = todayISO();
        copy.due = addDays(copy.date, Store.settings().dueDays);
        copy.status = 'unpaid';
        copy.number = copy.type === 'out' ? nextNumber(copy.fromId, copy.date) : '';
        draft = { ...copy, autoNumber: copy.type === 'out' };
        saveDraftLocal();
        toast('Копија — провери и зачувај.');
        go('editor');
    });
    $('#pv-paid').addEventListener('click', () => {
        const inv = Store.get('invoices', previewId);
        Store.upsert('invoices', { ...inv, status: inv.status === 'paid' ? 'unpaid' : 'paid' });
        renderPreview(previewId);
    });
    $('#pv-del').addEventListener('click', () => {
        const inv = Store.get('invoices', previewId);
        if (!confirm(`Да ја избришам фактурата бр. ${inv.number}?`)) return;
        Store.remove('invoices', previewId);
        toast('Избришана.');
        go('list');
    });

    $('#pv-print').addEventListener('click', () => {
        const inv = Store.get('invoices', previewId);
        let root = $('#print-root');
        if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
        root.innerHTML = renderSheet(inv);
        document.body.classList.add('printing');
        const done = () => { document.body.classList.remove('printing'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
        window.addEventListener('afterprint', done);
        setTimeout(() => window.print(), 50);
    });

    let html2pdfPromise = null;
    function loadHtml2pdf() {
        if (window.html2pdf) return Promise.resolve();
        if (!html2pdfPromise) {
            html2pdfPromise = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
                s.onload = resolve;
                s.onerror = () => { html2pdfPromise = null; reject(new Error('Не можам да ја вчитам PDF библиотеката (интернет?).')); };
                document.head.appendChild(s);
            });
        }
        return html2pdfPromise;
    }

    function pdfName(inv) {
        const base = `${inv.type === 'out' ? 'Излезна' : 'Влезна'} ${inv.number} ${(inv.to || {}).name || ''}`;
        return base.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() + '.pdf';
    }

    // html2pdf враќа „thenable“ worker — затоа акцијата (save / outputPdf) се извршува тука, не со await на worker-от.
    async function makePdf(inv, action) {
        await loadHtml2pdf();
        const holder = document.createElement('div');
        holder.className = 'pdf-holder';
        holder.innerHTML = renderSheet(inv);
        document.body.appendChild(holder);
        // А4 = 1122.5px; малку пониско за да нема празна втора страна (html2pdf го клонира елементот)
        holder.firstElementChild.style.minHeight = '1100px';
        try {
            const worker = html2pdf().set({
                margin: 0,
                filename: pdfName(inv),
                image: { type: 'jpeg', quality: 0.97 },
                html2canvas: { scale: 2, useCORS: true, windowWidth: SHEET_PX },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.ps-bottom', '.ps-sign'] }
            }).from(holder.firstElementChild);
            return await action(worker);
        } finally {
            holder.remove();
        }
    }

    async function withBusy(btn, fn) {
        const label = btn.textContent;
        btn.disabled = true; btn.textContent = '…';
        try { await fn(); } catch (e) { console.error(e); toast(e.message || 'Грешка'); }
        finally { btn.disabled = false; btn.textContent = label; }
    }

    $('#pv-pdf').addEventListener('click', e => withBusy(e.currentTarget, async () => {
        const inv = Store.get('invoices', previewId);
        await makePdf(inv, w => w.save());
    }));

    $('#pv-share').addEventListener('click', e => withBusy(e.currentTarget, async () => {
        const inv = Store.get('invoices', previewId);
        const blob = await makePdf(inv, w => w.outputPdf('blob'));
        const file = new File([blob], pdfName(inv), { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try { await navigator.share({ files: [file], title: pdfName(inv) }); }
            catch (err) { if (err.name !== 'AbortError') throw err; }
        } else {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = file.name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            toast('Споделувањето не е поддржано — PDF е преземен.');
        }
    }));

    // ============================================================
    // СПИСОК
    // ============================================================
    let listFilter = 'all';

    $('#list-seg').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        listFilter = b.dataset.filter;
        $$('#list-seg button').forEach(x => x.classList.toggle('active', x === b));
        renderList();
    });
    ['#list-search', '#list-company', '#list-month'].forEach(s => $(s).addEventListener('input', renderList));

    function renderList() {
        const sel = $('#list-company');
        const cur = sel.value;
        sel.innerHTML = `<option value="">Сите фирми</option>` + companies().map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
        sel.value = cur;

        const q = $('#list-search').value.trim().toLowerCase();
        const month = $('#list-month').value;
        const comp = sel.value;
        const rows = invoices().filter(inv => {
            if (listFilter !== 'all' && inv.type !== listFilter) return false;
            if (month && !(inv.date || '').startsWith(month)) return false;
            if (comp && inv.fromId !== comp && inv.toId !== comp) return false;
            if (q) {
                const hay = [inv.number, inv.from && inv.from.name, inv.to && inv.to.name,
                    inv.customs && inv.customs.decl, inv.customs && inv.customs.goods, inv.customs && inv.customs.vehicle]
                    .join(' ').toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });

        const sum = (type) => rows.filter(r => r.type === type).reduce((a, r) => a + (Number(r.total) || 0), 0);
        const unpaid = rows.filter(r => r.status !== 'paid').reduce((a, r) => a + (Number(r.total) || 0), 0);
        $('#list-stats').innerHTML = `
            <div><span>Излезни</span><b>${money(sum('out'))}</b></div>
            <div><span>Влезни</span><b>${money(sum('in'))}</b></div>
            <div><span>Неплатени</span><b>${money(unpaid)}</b></div>`;

        $('#invoice-list').innerHTML = rows.length ? rows.map(inv => {
            const other = inv.type === 'out' ? inv.to : inv.from;
            const mine = inv.type === 'out' ? inv.from : inv.to;
            const overdue = inv.status !== 'paid' && inv.due && inv.due < todayISO();
            return `
            <button class="inv-row" data-id="${esc(inv.id)}">
                <span class="inv-type ${inv.type}">${inv.type === 'out' ? '↗' : '↙'}</span>
                <span class="inv-main">
                    <b>${esc((other || {}).name || '—')}</b>
                    <small>бр. ${esc(inv.number)} · ${dmy(inv.date)}${inv.customs && inv.customs.decl ? ' · ЕЦД ' + esc(inv.customs.decl) : ''}</small>
                    <small class="muted">${inv.type === 'out' ? 'од' : 'за'} ${esc((mine || {}).name || '')}</small>
                </span>
                <span class="inv-amt">
                    <b>${money(inv.total)}</b>
                    <span class="badge ${inv.status === 'paid' ? 'paid' : overdue ? 'late' : ''}">${inv.status === 'paid' ? 'платена' : overdue ? 'доспеана' : 'неплатена'}</span>
                </span>
            </button>`;
        }).join('') : `<div class="empty">Нема фактури${q || month || comp || listFilter !== 'all' ? ' за овој филтер' : ' — направи прва во „Нова“'}.</div>`;
    }

    $('#invoice-list').addEventListener('click', e => {
        const row = e.target.closest('.inv-row');
        if (row) go('preview/' + row.dataset.id);
    });

    // ============================================================
    // ФИРМИ
    // ============================================================
    let companyEditId = null;
    let companyFromEditor = false;

    function renderCompanies() {
        const list = companies();
        $('#company-list').innerHTML = list.length ? list.map(c => `
            <button class="list-card" data-id="${esc(c.id)}">
                <span>
                    <b>${esc(c.name)}</b>
                    <small>${esc([c.city, c.edb ? 'ЕДБ ' + c.edb : ''].filter(Boolean).join(' · '))}</small>
                </span>
                ${c.mine ? '<span class="badge mine">моја</span>' : ''}
            </button>`).join('') : '<div class="empty">Нема фирми.</div>';
    }

    function openCompany(id, fromEditor = false) {
        companyEditId = id || null;
        companyFromEditor = fromEditor;
        const c = id ? Store.get('companies', id) : { vatPayer: true, mine: false };
        const form = $('#company-form');
        form.reset();
        $$('input', form).forEach(inp => {
            if (inp.type === 'checkbox') inp.checked = inp.name === 'vatPayer' ? c.vatPayer !== false : !!c[inp.name];
            else inp.value = c[inp.name] || '';
        });
        $('#company-dialog-title').textContent = id ? 'Уреди фирма' : 'Нова фирма';
        $('#company-delete').hidden = !id;
        $('#company-dialog').showModal();
    }

    $('#company-list').addEventListener('click', e => {
        const card = e.target.closest('.list-card');
        if (card) openCompany(card.dataset.id);
    });
    $('#add-company').addEventListener('click', () => openCompany(null));
    $('#quick-company').addEventListener('click', () => openCompany(null, true));

    $('#company-form').addEventListener('submit', e => {
        if (!e.submitter || e.submitter.value !== 'save') return;
        const form = e.target;
        const base = companyEditId ? Store.get('companies', companyEditId) : {};
        const rec = { ...base };
        $$('input', form).forEach(inp => { rec[inp.name] = inp.type === 'checkbox' ? inp.checked : inp.value.trim(); });
        const saved = Store.upsert('companies', rec);
        toast('Фирмата е зачувана.');
        if (companyFromEditor) {
            if (!draft.toId || draft.toId === draft.fromId) draft.toId = saved.id;
            else if (!draft.fromId) draft.fromId = saved.id;
            else if (draft.type === 'out') draft.toId = saved.id;
            else draft.fromId = saved.id;
            if (draft.type === 'out' && draft.autoNumber && !draft.id && draft.fromId) draft.number = nextNumber(draft.fromId, draft.date);
            saveDraftLocal();
            renderEditor();
        } else renderCompanies();
    });

    $('#company-delete').addEventListener('click', () => {
        const c = Store.get('companies', companyEditId);
        if (!c || !confirm(`Да ја избришам фирмата „${c.name}“? Постоечките фактури остануваат.`)) return;
        Store.remove('companies', c.id);
        $('#company-dialog').close();
        renderCompanies();
    });

    // ============================================================
    // ЦЕНОВНИК
    // ============================================================
    let serviceEditId = null;

    function serviceLine(s) {
        return `<span>
                <b>${s.code ? esc(s.code) + ' · ' : ''}${esc(s.name)}</b>
                <small>${s.passthrough ? 'трошок за сметка на коминтент' : `${Number(s.price) ? money(s.price) + ' ден.' : 'цена по договор'}${s.unit ? ' / ' + esc(s.unit) : ''} · ДДВ ${s.vat}%`}</small>
            </span>`;
    }

    function renderServices() {
        const list = services();
        $('#service-list').innerHTML = list.length
            ? list.map(s => `<button class="list-card" data-id="${esc(s.id)}">${serviceLine(s)}</button>`).join('')
            : '<div class="empty">Ценовникот е празен.</div>';
    }

    function openService(id) {
        serviceEditId = id || null;
        const s = id ? Store.get('services', id) : { vat: 18 };
        const form = $('#service-form');
        form.reset();
        $$('input, select', form).forEach(inp => {
            if (inp.type === 'checkbox') inp.checked = !!s[inp.name];
            else inp.value = s[inp.name] == null ? '' : s[inp.name];
        });
        if (!id) form.vat.value = '18';
        $('#service-delete').hidden = !id;
        $('#service-dialog').showModal();
    }

    $('#service-list').addEventListener('click', e => {
        const card = e.target.closest('.list-card');
        if (card) openService(card.dataset.id);
    });
    $('#add-service').addEventListener('click', () => openService(null));

    $('#service-form').addEventListener('submit', e => {
        if (!e.submitter || e.submitter.value !== 'save') return;
        const form = e.target;
        const rec = { ...(serviceEditId ? Store.get('services', serviceEditId) : {}) };
        $$('input, select', form).forEach(inp => {
            if (inp.type === 'checkbox') rec[inp.name] = inp.checked;
            else if (inp.name === 'price' || inp.name === 'vat') rec[inp.name] = Number(inp.value) || 0;
            else rec[inp.name] = inp.value.trim();
        });
        if (rec.passthrough) rec.vat = 0;
        Store.upsert('services', rec);
        toast('Услугата е зачувана.');
        renderServices();
    });

    $('#service-delete').addEventListener('click', () => {
        const s = Store.get('services', serviceEditId);
        if (!s || !confirm(`Да ја избришам „${s.name}“ од ценовникот?`)) return;
        Store.remove('services', s.id);
        $('#service-dialog').close();
        renderServices();
    });

    // Избор од ценовник во уредувачот
    $('#from-catalog').addEventListener('click', () => {
        $('#catalog-body').innerHTML = services().map(s =>
            `<button class="list-card" data-id="${esc(s.id)}">${serviceLine(s)}<span class="plus">+</span></button>`).join('')
            || '<div class="empty">Ценовникот е празен.</div>';
        $('#catalog-dialog').showModal();
    });
    $('#catalog-close').addEventListener('click', () => $('#catalog-dialog').close());
    $('#catalog-body').addEventListener('click', e => {
        const card = e.target.closest('.list-card');
        if (!card) return;
        const svc = Store.get('services', card.dataset.id);
        const last = draft.items[draft.items.length - 1];
        const target = last && !String(last.name).trim() && !Number(last.price) ? last : (draft.items.push(blankItem()), draft.items[draft.items.length - 1]);
        applyService(target, svc);
        saveDraftLocal();
        renderItems();
        card.classList.add('added');
        toast('Додадено: ' + svc.name);
    });

    // Затвори дијалог со допир надвор
    $$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

    // ============================================================
    // ПОДЕСУВАЊА / СИНХРОНИЗАЦИЈА
    // ============================================================
    $('#open-settings').addEventListener('click', () => {
        const s = Store.settings();
        $('#set-sync').checked = !!s.sync;
        $('#set-note').value = s.note || '';
        $('#set-due').value = s.dueDays;
        $('#set-place').value = s.place || '';
        $('#settings-dialog').showModal();
    });
    $('#settings-close').addEventListener('click', () => $('#settings-dialog').close());
    $('#set-sync').addEventListener('change', e => Store.saveSettings({ sync: e.target.checked }));
    $('#set-note').addEventListener('change', e => Store.saveSettings({ note: e.target.value }));
    $('#set-due').addEventListener('change', e => Store.saveSettings({ dueDays: Math.max(0, Number(e.target.value) || 0) }));
    $('#set-place').addEventListener('change', e => Store.saveSettings({ place: e.target.value.trim() }));

    $('#export-data').addEventListener('click', () => {
        const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `carinski-fakturi-${todayISO()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    $('#import-data').addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const n = Store.importJSON(await file.text());
            toast(`Вратени ${n} записи.`);
            route();
        } catch (err) { toast('Неважечка датотека.'); }
        e.target.value = '';
    });

    const SYNC_TEXT = { off: 'Синхронизацијата е исклучена — податоците се само на овој уред.', connecting: 'Се поврзувам…', ok: 'Синхронизирано.', error: 'Грешка при синхронизација: ' };
    window.addEventListener('syncstate', e => {
        const { state, message } = e.detail;
        $('#sync-dot').className = 'sync-dot ' + state;
        $('#sync-dot').title = SYNC_TEXT[state] + (message || '');
        $('#sync-status').textContent = SYNC_TEXT[state] + (message || '');
    });

    // Кога ќе стигнат податоци од друг уред — освежи го тековниот приказ (не и уредувачот додека се пишува)
    Store.onChange(() => {
        const view = (location.hash.slice(1) || 'editor').split('/')[0];
        if (view === 'list') renderList();
        else if (view === 'companies') renderCompanies();
        else if (view === 'services') renderServices();
        else if (view === 'editor' || view === 'edit') {
            if (!document.activeElement || !document.activeElement.closest('#view-editor')) {
                $('#f-from').innerHTML = companyOptions(draft.fromId);
                $('#f-to').innerHTML = companyOptions(draft.toId);
                renderServiceDatalist();
            }
        }
    });

    route();
    Store.startSync();

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
})();
