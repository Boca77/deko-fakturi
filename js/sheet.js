// Пресметки и изглед на фактурата (А4 лист) — се користи за преглед, печатење и PDF.
(function (global) {
    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

    // 1234.5 -> "1.234,50"
    function money(n) {
        const v = r2(n);
        const [i, d] = Math.abs(v).toFixed(2).split('.');
        return (v < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
    }

    function qtyFmt(n) {
        const v = Number(n) || 0;
        return Number.isInteger(v) ? String(v) : String(r2(v)).replace('.', ',');
    }

    // ISO -> dd.mm.yyyy
    function dmy(iso) {
        if (!iso) return '';
        const [y, m, d] = iso.split('-');
        return d && m && y ? `${d}.${m}.${y}` : iso;
    }

    // ДДВ се пресметува на основицата по стапка (како на фактура), не по ставка.
    function computeTotals(inv) {
        const vatPayer = !inv.from || inv.from.vatPayer !== false;
        const byRate = {};
        let pass = 0;
        (inv.items || []).forEach(it => {
            const amount = r2((Number(it.qty) || 0) * (Number(it.price) || 0));
            if (it.passthrough) { pass += amount; return; }
            const rate = vatPayer ? Number(it.vat) || 0 : 0;
            byRate[rate] = byRate[rate] || { base: 0, vat: 0 };
            byRate[rate].base = r2(byRate[rate].base + amount);
        });
        let net = 0, vat = 0;
        Object.keys(byRate).forEach(rate => {
            byRate[rate].vat = r2(byRate[rate].base * rate / 100);
            net += byRate[rate].base; vat += byRate[rate].vat;
        });
        net = r2(net); vat = r2(vat); pass = r2(pass);
        return { byRate, net, vat, gross: r2(net + vat), pass, total: r2(net + vat + pass), vatPayer };
    }

    // Пополнети ставки, поделени на услуги и трошоци
    function splitItems(inv) {
        const filled = (inv.items || []).filter(i => String(i.name || '').trim() || Number(i.price));
        return { services: filled.filter(i => !i.passthrough), pass: filled.filter(i => i.passthrough) };
    }

    // Царински податоци како листа [наслов, вредност] — за лист, Word и Excel
    function customsRows(c) {
        if (!c) return [];
        const any = ['office', 'decl', 'declDate', 'vehicle', 'goodsInv', 'goods', 'tariff', 'packages', 'gross', 'net', 'value'].some(k => c[k]);
        if (!any) return [];
        return [
            ['Постапка', c.regime], ['Царинарница', c.office],
            ['ЕЦД / MRN', c.decl], ['Датум на ЕЦД', dmy(c.declDate)],
            ['Возило', c.vehicle], ['Фактура за стока', c.goodsInv],
            ['Опис на стока', c.goods], ['Тарифен број', c.tariff],
            ['Колети', c.packages], ['Бруто / Нето (кг)', (c.gross || c.net) ? `${c.gross || '—'} / ${c.net || '—'}` : ''],
            ['Вредност на стока', c.value ? `${money(c.value)} ${c.currency || ''}` : '']
        ].filter(r => r[1] !== '' && r[1] != null);
    }

    function partyLines(p) {
        if (!p) return [];
        return [
            p.address, [p.city, p.country].filter(Boolean).join(', '),
            p.edb && 'ЕДБ: ' + p.edb, p.embs && 'ЕМБС: ' + p.embs,
            p.account && 'Ж-сметка: ' + p.account, p.bank && 'Банка: ' + p.bank,
            p.phone && 'Тел: ' + p.phone, p.email && 'Е-пошта: ' + p.email
        ].filter(Boolean);
    }

    function partyBlock(p, label) {
        if (!p) return `<div class="ps-party"><div class="ps-label">${label}</div><em>—</em></div>`;
        const line = (k, v) => v ? `<div><span>${k}</span> ${esc(v)}</div>` : '';
        return `
            <div class="ps-party">
                <div class="ps-label">${label}</div>
                <div class="ps-name">${esc(p.name)}</div>
                ${p.address ? `<div>${esc(p.address)}</div>` : ''}
                ${p.city || p.country ? `<div>${esc([p.city, p.country].filter(Boolean).join(', '))}</div>` : ''}
                ${line('ЕДБ:', p.edb)}
                ${line('ЕМБС:', p.embs)}
                ${line('Ж-сметка:', p.account)}
                ${line('Банка:', p.bank)}
                ${line('Тел:', p.phone)}
                ${line('Е-пошта:', p.email)}
            </div>`;
    }

    function customsBlock(c) {
        const rows = customsRows(c);
        if (!rows.length) return '';
        return `
            <div class="ps-customs">
                <div class="ps-label">Податоци за царинската постапка</div>
                <div class="ps-customs-grid">
                    ${rows.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}
                </div>
            </div>`;
    }

    function renderSheet(inv) {
        const t = computeTotals(inv);
        const { services, pass: passItems } = splitItems(inv);
        const rates = Object.keys(t.byRate).map(Number).sort((a, b) => b - a);

        const serviceRows = services.map((it, i) => {
            const amount = r2((Number(it.qty) || 0) * (Number(it.price) || 0));
            const rate = t.vatPayer ? Number(it.vat) || 0 : 0;
            return `<tr>
                <td class="c">${i + 1}</td>
                <td>${esc(it.name)}</td>
                <td class="c">${esc(it.unit)}</td>
                <td class="r">${qtyFmt(it.qty)}</td>
                <td class="r">${money(it.price)}</td>
                <td class="c">${rate}%</td>
                <td class="r">${money(amount)}</td>
            </tr>`;
        }).join('');

        const passRows = passItems.map((it, i) => `<tr>
                <td class="c">${i + 1}</td>
                <td colspan="5">${esc(it.name)}</td>
                <td class="r">${money(r2((Number(it.qty) || 0) * (Number(it.price) || 0)))}</td>
            </tr>`).join('');

        const vatLines = rates.map(rate => `
            <tr><td>Основица за ДДВ ${rate}%</td><td class="r">${money(t.byRate[rate].base)}</td></tr>
            ${rate ? `<tr><td>ДДВ ${rate}%</td><td class="r">${money(t.byRate[rate].vat)}</td></tr>` : ''}`).join('');

        return `
        <div class="print-sheet">
            <div class="ps-head">
                <div>
                    <div class="ps-issuer">${esc(inv.from ? inv.from.name : '')}</div>
                    <div class="ps-sub">Царинско застапување и шпедиција</div>
                </div>
                <div class="ps-title">
                    <div class="ps-doc">ФАКТУРА</div>
                    <div class="ps-no">бр. ${esc(inv.number || '—')}</div>
                </div>
            </div>

            <div class="ps-parties">
                ${partyBlock(inv.from, 'Издавач')}
                ${partyBlock(inv.to, 'Примач (коминтент)')}
            </div>

            <div class="ps-meta">
                <div><span>Датум на фактура</span><b>${dmy(inv.date)}</b></div>
                <div><span>Валута (рок)</span><b>${dmy(inv.due) || '—'}</b></div>
                <div><span>Место на издавање</span><b>${esc(inv.place || '—')}</b></div>
            </div>

            ${customsBlock(inv.customs)}

            <table class="ps-table">
                <thead><tr>
                    <th class="c" style="width:7%">Р.бр.</th>
                    <th>Опис на услугата</th>
                    <th class="c" style="width:9%">Ед.м.</th>
                    <th class="r" style="width:8%">Кол.</th>
                    <th class="r" style="width:14%">Цена</th>
                    <th class="c" style="width:8%">ДДВ</th>
                    <th class="r" style="width:16%">Износ без ДДВ</th>
                </tr></thead>
                <tbody>${serviceRows || '<tr><td colspan="7" class="c muted">—</td></tr>'}</tbody>
            </table>

            ${passRows ? `
            <table class="ps-table ps-pass">
                <thead><tr><th colspan="7">Трошоци платени во име и за сметка на налогодавачот (не подлежат на ДДВ)</th></tr></thead>
                <tbody>${passRows}</tbody>
            </table>` : ''}

            <div class="ps-bottom">
                <div class="ps-words">
                    <div class="ps-label">Со зборови</div>
                    <div>${esc(amountInWords(t.total))}</div>
                    ${!t.vatPayer ? '<div class="ps-novat">Издавачот не е регистриран за ДДВ.</div>' : ''}
                </div>
                <table class="ps-totals">
                    ${vatLines}
                    <tr class="sep"><td>Вкупно услуги со ДДВ</td><td class="r">${money(t.gross)}</td></tr>
                    ${t.pass ? `<tr><td>Трошоци за сметка на налогодавачот</td><td class="r">${money(t.pass)}</td></tr>` : ''}
                    <tr class="grand"><td>ВКУПНО ЗА НАПЛАТА (ден.)</td><td class="r">${money(t.total)}</td></tr>
                </table>
            </div>

            ${inv.note ? `<div class="ps-note">${esc(inv.note).replace(/\n/g, '<br>')}</div>` : ''}

            <div class="ps-sign">
                <div><div class="line"></div>Примил</div>
                <div class="mp">М.П.</div>
                <div><div class="line"></div>Овластено лице за потпишување фактури</div>
            </div>
        </div>`;
    }

    global.Sheet = { renderSheet, computeTotals, splitItems, customsRows, partyLines, money, qtyFmt, dmy, esc, r2 };
})(window);
