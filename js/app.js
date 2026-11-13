// Царинска фактура — пополни и извези (PDF / Word / Excel). Ништо не се чува.
(function () {
    const { renderSheet, computeTotals, money, esc } = Sheet;
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const SHEET_PX = 794; // ширина на А4 на 96 dpi

    const PARTY_FIELDS = [
        ['name', 'Назив *', 'full'], ['address', 'Адреса', 'full'], ['city', 'Град'], ['country', 'Држава'],
        ['edb', 'ЕДБ'], ['embs', 'ЕМБС'], ['bank', 'Банка'], ['account', 'Жиро сметка'],
        ['phone', 'Телефон'], ['email', 'Е-пошта']
    ];

    // ============================================================
    // ПОМОШНИ
    // ============================================================
    function isoDate(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    function addDays(iso, days) {
        const [y, m, d] = iso.split('-').map(Number);
        return isoDate(new Date(y, m - 1, d + Number(days || 0)));
    }

    let toastTimer;
    function toast(msg) {
        const el = $('#toast');
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
    }

    const companyByKey = key => COMPANIES.find(c => c.key === key) || null;
    const copyCompany = c => c ? JSON.parse(JSON.stringify(c)) : { vatPayer: true };
    const blankItem = () => ({ name: '', unit: '', qty: 1, price: '', vat: 18, passthrough: false });

    // ============================================================
    // СОСТОЈБА (само во меморија)
    // ============================================================
    let draft, dirty = false;

    function newDraft() {
        const today = isoDate(new Date());
        const first = COMPANIES[0], second = COMPANIES[1];
        draft = {
            type: 'out',
            fromKey: first ? first.key : 'custom',
            toKey: second ? second.key : 'custom',
            from: copyCompany(first),
            to: copyCompany(second),
            number: '',
            date: today,
            due: addDays(today, DEFAULTS.dueDays),
            place: DEFAULTS.place,
            customs: { regime: 'Увоз', currency: 'EUR' },
            items: [blankItem()],
            note: DEFAULTS.note
        };
        dirty = false;
    }

    function markDirty() { dirty = true; }
    window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

    // ============================================================
    // СТРАНИ (од / до)
    // ============================================================
    function companyOptions(selected) {
        const own = COMPANIES.filter(c => c.own), other = COMPANIES.filter(c => !c.own);
        const opt = c => `<option value="${esc(c.key)}" ${c.key === selected ? 'selected' : ''}>${esc(c.name)}</option>`;
        return (own.length ? `<optgroup label="Мои фирми">${own.map(opt).join('')}</optgroup>` : '') +
            (other.length ? `<optgroup label="Други фирми">${other.map(opt).join('')}</optgroup>` : '') +
            `<option value="custom" ${selected === 'custom' ? 'selected' : ''}>✎ Друга фирма (внеси рачно)</option>`;
    }

    function renderParty(side) {
        const card = $(`.party[data-side="${side}"]`);
        const p = draft[side];
        const key = draft[side + 'Key'];
        $('.party-select', card).innerHTML = companyOptions(key);
        $('.party-fields', card).innerHTML = `
            <div class="grid2">
                ${PARTY_FIELDS.map(([f, label, cls]) => `
                    <label class="field ${cls || ''}"><span>${label}</span>
                        <input data-f="${f}" value="${esc(p[f] || '')}" autocomplete="off" ${f === 'email' ? 'type="email"' : ''} ${f === 'phone' ? 'type="tel"' : ''}>
                    </label>`).join('')}
            </div>
            <label class="check"><input type="checkbox" data-f="vatPayer" ${p.vatPayer !== false ? 'checked' : ''}> ДДВ обврзник</label>`;
        renderPartySummary(side);
        $('.party-details', card).open = key === 'custom' && !p.name;
    }

    function renderPartySummary(side) {
        const p = draft[side];
        const bits = [p.edb && 'ЕДБ ' + p.edb, p.city, p.vatPayer === false && 'не е ДДВ обврзник'].filter(Boolean);
        $(`.party[data-side="${side}"] .party-summary`).innerHTML = p.name
            ? `<span>${esc(bits.join(' · ') || 'без дополнителни податоци')}</span><em>измени</em>`
            : `<span class="warn">Внеси податоци за фирмата</span><em>отвори</em>`;
    }

    $$('.party').forEach(card => {
        const side = card.dataset.side;
        $('.party-select', card).addEventListener('change', e => {
            const key = e.target.value;
            draft[side + 'Key'] = key;
            draft[side] = key === 'custom' ? { vatPayer: true } : copyCompany(companyByKey(key));
            markDirty();
            renderParty(side);
            if (side === 'from') renderItems();
        });
        $('.party-fields', card).addEventListener('input', e => {
            const f = e.target.dataset.f;
            if (!f) return;
            draft[side][f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
            markDirty();
            renderPartySummary(side);
            if (side === 'from' && f === 'vatPayer') renderItems();
        });
    });

    function swapParties() {
        [draft.from, draft.to] = [draft.to, draft.from];
        [draft.fromKey, draft.toKey] = [draft.toKey, draft.fromKey];
        renderParty('from');
        renderParty('to');
        renderItems();
    }

    $('#swap-parties').addEventListener('click', () => { swapParties(); markDirty(); });

    // ============================================================
    // ТИП: излезна / влезна
    // ============================================================
    function renderType() {
        $$('#type-seg button').forEach(b => b.classList.toggle('active', b.dataset.type === draft.type));
        $('#type-hint').textContent = draft.type === 'out'
            ? 'Излезна — твојата фирма ја издава фактурата (Од) кон друга фирма (До).'
            : 'Влезна — фактура што ја добиваш: друга фирма е издавач (Од), твојата фирма е примач (До). Внеси го нивниот број.';
    }

    $('#type-seg').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b || b.dataset.type === draft.type) return;
        draft.type = b.dataset.type;
        // Мојата фирма оди „Од“ кај излезна, „До“ кај влезна
        const fromOwn = (companyByKey(draft.fromKey) || {}).own;
        const toOwn = (companyByKey(draft.toKey) || {}).own;
        if ((draft.type === 'in' && fromOwn && !toOwn) || (draft.type === 'out' && toOwn && !fromOwn)) swapParties();
        renderType();
        markDirty();
    });

    // ============================================================
    // ПОЛИЊА НА ФАКТУРАТА
    // ============================================================
    const FIELD_MAP = {
        'f-number': 'number', 'f-place': 'place', 'f-date': 'date', 'f-due': 'due', 'f-note': 'note',
        'c-regime': 'customs.regime', 'c-office': 'customs.office', 'c-decl': 'customs.decl',
        'c-decl-date': 'customs.declDate', 'c-vehicle': 'customs.vehicle', 'c-goods-inv': 'customs.goodsInv',
        'c-goods': 'customs.goods', 'c-tariff': 'customs.tariff', 'c-packages': 'customs.packages',
        'c-gross': 'customs.gross', 'c-net': 'customs.net', 'c-value': 'customs.value', 'c-currency': 'customs.currency'
    };
    const getPath = (o, p) => p.split('.').reduce((x, k) => (x ? x[k] : undefined), o);
    function setPath(o, p, v) {
        const keys = p.split('.');
        keys.slice(0, -1).forEach(k => { o[k] = o[k] || {}; o = o[k]; });
        o[keys[keys.length - 1]] = v;
    }

    function renderFields() {
        Object.entries(FIELD_MAP).forEach(([id, path]) => {
            const v = getPath(draft, path);
            $('#' + id).value = v == null ? '' : v;
        });
    }

    Object.entries(FIELD_MAP).forEach(([id, path]) => {
        $('#' + id).addEventListener('input', e => {
            setPath(draft, path, e.target.value);
            if (id === 'f-date' && e.target.value) {
                draft.due = addDays(e.target.value, DEFAULTS.dueDays);
                $('#f-due').value = draft.due;
            }
            markDirty();
        });
    });

    // ============================================================
    // СТАВКИ
    // ============================================================
    function renderItems() {
        const noVat = draft.from && draft.from.vatPayer === false;
        $('#items').innerHTML = draft.items.map((it, i) => `
            <div class="item ${it.passthrough ? 'is-pass' : ''}" data-i="${i}">
                <div class="item-top">
                    <span class="item-no">${i + 1}</span>
                    <input class="item-name" data-k="name" list="service-names" placeholder="Опис на услуга" value="${esc(it.name)}" autocomplete="off">
                    <button class="icon-btn" data-act="del" type="button" aria-label="Избриши ставка">✕</button>
                </div>
                <div class="item-grid">
                    <label><span>Кол.</span><input data-k="qty" type="number" inputmode="decimal" step="any" value="${esc(it.qty)}"></label>
                    <label><span>Ед.м.</span><input data-k="unit" value="${esc(it.unit)}" autocomplete="off"></label>
                    <label><span>Цена (без ДДВ)</span><input data-k="price" type="number" inputmode="decimal" step="0.01" value="${esc(it.price)}"></label>
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
        renderTotals();
    }

    function renderTotals() {
        const t = computeTotals(draft);
        $('#totals-preview').innerHTML = `
            <div><span>Основица</span><b>${money(t.net)}</b></div>
            <div><span>ДДВ</span><b>${money(t.vat)}</b></div>
            ${t.pass ? `<div><span>Трошоци</span><b>${money(t.pass)}</b></div>` : ''}
            <div class="grand"><span>Вкупно</span><b>${money(t.total)} ден.</b></div>`;
    }

    function applyService(item, svc) {
        Object.assign(item, { name: svc.name, unit: svc.unit || '', vat: Number(svc.vat) || 0, passthrough: !!svc.passthrough });
        if (Number(svc.price)) item.price = Number(svc.price);
    }

    $('#items').addEventListener('input', e => {
        const row = e.target.closest('.item');
        const k = e.target.dataset.k;
        if (!row || !k) return;
        const it = draft.items[row.dataset.i];
        markDirty();
        if (k === 'passthrough') { it.passthrough = e.target.checked; return renderItems(); }
        it[k] = (k === 'qty' || k === 'price' || k === 'vat') ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
        if (k === 'name') {
            const svc = SERVICES.find(s => s.name === it.name);
            if (svc) { applyService(it, svc); return renderItems(); }
        }
        row.querySelector('.item-sum').textContent = money((Number(it.qty) || 0) * (Number(it.price) || 0));
        renderTotals();
    });
    $('#items').addEventListener('change', e => {
        if (e.target.dataset.k !== 'vat') return;
        draft.items[e.target.closest('.item').dataset.i].vat = Number(e.target.value);
        renderTotals();
    });
    $('#items').addEventListener('click', e => {
        if (!e.target.closest('[data-act="del"]')) return;
        draft.items.splice(Number(e.target.closest('.item').dataset.i), 1);
        if (!draft.items.length) draft.items.push(blankItem());
        renderItems();
    });
    $('#add-item').addEventListener('click', () => {
        draft.items.push(blankItem());
        renderItems();
        const names = $$('#items .item-name');
        names[names.length - 1].focus();
    });

    // Ценовник
    $('#service-names').innerHTML = SERVICES.map(s => `<option value="${esc(s.name)}">`).join('');
    $('#from-catalog').addEventListener('click', () => {
        $('#catalog-body').innerHTML = SERVICES.map((s, i) => `
            <button class="list-card" data-i="${i}" type="button">
                <span><b>${esc(s.name)}</b>
                <small>${s.passthrough ? 'трошок за сметка на коминтент' : `${Number(s.price) ? money(s.price) + ' ден.' : 'по договор'}${s.unit ? ' / ' + esc(s.unit) : ''} · ДДВ ${s.vat}%`}</small></span>
                <span class="plus">+</span>
            </button>`).join('');
        $('#catalog-dialog').showModal();
    });
    $('#catalog-close').addEventListener('click', () => $('#catalog-dialog').close());
    $('#catalog-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
    $('#catalog-body').addEventListener('click', e => {
        const card = e.target.closest('.list-card');
        if (!card) return;
        const svc = SERVICES[card.dataset.i];
        let target = draft.items[draft.items.length - 1];
        if (!target || String(target.name).trim() || Number(target.price)) { target = blankItem(); draft.items.push(target); }
        applyService(target, svc);
        markDirty();
        renderItems();
        card.classList.add('added');
        toast('Додадено: ' + svc.name);
    });

    // ============================================================
    // ПРЕГЛЕД / ПЕЧАТ
    // ============================================================
    function setMode(mode) {
        $$('#mode-seg button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        $('#view-edit').hidden = mode !== 'edit';
        $('#view-preview').hidden = mode !== 'preview';
        if (mode === 'preview') {
            $('#sheet-host').innerHTML = renderSheet(draft);
            fitSheet();
        }
        window.scrollTo(0, 0);
    }
    $('#mode-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });

    function fitSheet() {
        const scaler = $('#sheet-scaler'), host = $('#sheet-host');
        if (!scaler.offsetParent) return;
        const scale = Math.min(1, scaler.clientWidth / SHEET_PX);
        host.style.transform = `scale(${scale})`;
        scaler.style.height = (host.offsetHeight * scale) + 'px';
    }
    window.addEventListener('resize', fitSheet);

    $('#print').addEventListener('click', () => {
        let root = $('#print-root');
        if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
        root.innerHTML = renderSheet(draft);
        document.body.classList.add('printing');
        const done = () => { document.body.classList.remove('printing'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
        window.addEventListener('afterprint', done);
        setTimeout(() => window.print(), 50);
    });

    // ============================================================
    // ИЗВОЗ
    // ============================================================
    function validate() {
        if (!draft.from.name || !draft.to.name) return 'Внеси ги двете фирми (Од и До).';
        if (draft.fromKey !== 'custom' && draft.fromKey === draft.toKey) return 'Издавачот и примачот мора да се различни фирми.';
        if (!draft.items.some(i => String(i.name).trim() || Number(i.price))) return 'Додади барем една ставка.';
        if (!String(draft.number).trim()) return 'Внеси број на фактура.';
        return '';
    }

    const EXPORTERS = { pdf: Exporter.toPdf, docx: Exporter.toDocx, xlsx: Exporter.toXlsx };
    $$('.export-bar [data-export]').forEach(btn => btn.addEventListener('click', async () => {
        const err = validate();
        if (err) return toast(err);
        const label = btn.textContent;
        btn.disabled = true; btn.textContent = '…';
        try {
            await EXPORTERS[btn.dataset.export](JSON.parse(JSON.stringify(draft)));
            dirty = false;
        } catch (e) {
            console.error(e);
            toast(e.message || 'Грешка при извоз.');
        } finally {
            btn.disabled = false; btn.textContent = label;
        }
    }));

    $('#reset').addEventListener('click', () => {
        if (dirty && !confirm('Да ја исчистам формата?')) return;
        newDraft();
        renderAll();
        setMode('edit');
    });

    function renderAll() {
        renderType();
        renderParty('from');
        renderParty('to');
        renderFields();
        renderItems();
    }

    newDraft();
    renderAll();
})();
