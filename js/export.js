// Извоз на фактурата во PDF, Word (.docx) и Excel (.xlsx).
// Библиотеките се вчитуваат дури кога ќе се притисне копчето.
(function (global) {
    const { renderSheet, computeTotals, splitItems, customsRows, partyLines, money, qtyFmt, dmy, r2 } = Sheet;
    const BLUE = '1F4E79';

    const LIBS = {
        pdf: { url: 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js', ready: () => global.html2pdf },
        docx: { url: 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js', ready: () => global.docx },
        xlsx: { url: 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js', ready: () => global.ExcelJS }
    };
    const loading = {};

    function loadLib(kind) {
        const lib = LIBS[kind];
        if (lib.ready()) return Promise.resolve();
        if (!loading[kind]) {
            loading[kind] = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = lib.url;
                s.onload = () => lib.ready() ? resolve() : reject(new Error('Библиотеката не се вчита.'));
                s.onerror = () => { delete loading[kind]; reject(new Error('Нема интернет — не можам да ја вчитам библиотеката за извоз.')); };
                document.head.appendChild(s);
            });
        }
        return loading[kind];
    }

    // Латиница во името на датотеката — кирилицата некои прелистувачи ја губат при преземање
    const LAT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ѓ: 'gj', е: 'e', ж: 'zh', з: 'z', ѕ: 'dz', и: 'i', ј: 'j', к: 'k',
        л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r', с: 's', т: 't', ќ: 'kj', у: 'u', ф: 'f',
        х: 'h', ц: 'c', ч: 'ch', џ: 'dzh', ш: 'sh' };
    function latin(text) {
        return String(text || '').split('').map(ch => {
            const lo = ch.toLowerCase();
            if (!(lo in LAT)) return ch;
            return ch === lo ? LAT[lo] : LAT[lo].toUpperCase();
        }).join('');
    }

    function fileName(inv, ext) {
        const base = latin(['Faktura', inv.number, inv.to && inv.to.name].filter(Boolean).join(' '))
            .replace(/[^A-Za-z0-9._ -]+/g, '-').replace(/[\s-]+/g, '-').replace(/^-|-$/g, '');
        return (base || 'Faktura') + '.' + ext;
    }

    function download(blob, name) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }

    // ============================================================
    // PDF
    // ============================================================
    async function toPdf(inv) {
        await loadLib('pdf');
        const holder = document.createElement('div');
        holder.className = 'pdf-holder';
        holder.innerHTML = renderSheet(inv);
        document.body.appendChild(holder);
        // А4 = 1122.5px; малку пониско за да нема празна втора страна (html2pdf го клонира елементот)
        holder.firstElementChild.style.minHeight = '1100px';
        // html2canvas фотографира со поместување од скролот — ако страната е скролана надолу,
        // PDF-от излегува празен. Затоа привремено одиме на врвот, па го враќаме скролот.
        const scrollY = window.scrollY, scrollX = window.scrollX;
        window.scrollTo(0, 0);
        try {
            // html2pdf враќа „thenable“ worker — не се прави await на самиот worker
            const blob = await html2pdf().set({
                margin: 0,
                image: { type: 'jpeg', quality: 0.97 },
                html2canvas: { scale: 2, windowWidth: 794, scrollX: 0, scrollY: 0 },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.ps-bottom', '.ps-sign'] }
            }).from(holder.firstElementChild).outputPdf('blob');
            download(blob, fileName(inv, 'pdf'));
        } finally {
            holder.remove();
            window.scrollTo(scrollX, scrollY);
        }
    }

    // ============================================================
    // WORD (.docx)
    // ============================================================
    async function toDocx(inv) {
        await loadLib('docx');
        const D = global.docx;
        const t = computeTotals(inv);
        const { services, pass } = splitItems(inv);

        const NONE = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
        const LINE = { style: D.BorderStyle.SINGLE, size: 4, color: 'C3CCD7' };
        const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
        const boxBorders = { top: LINE, bottom: LINE, left: LINE, right: LINE };
        const PAGE_W = 11906 - 2 * 850; // ширина на текстот во twips (А4, маргини 1.5 cm)

        const run = (text, o = {}) => new D.TextRun({ text: String(text == null ? '' : text), font: 'Arial', size: o.size || 18, bold: o.bold, color: o.color, italics: o.italics });
        const para = (text, o = {}) => new D.Paragraph({
            alignment: o.align || D.AlignmentType.LEFT,
            spacing: { before: o.before || 0, after: o.after == null ? 40 : o.after },
            children: Array.isArray(text) ? text : [run(text, o)]
        });
        const cell = (children, o = {}) => new D.TableCell({
            children: Array.isArray(children) ? children : [children],
            width: o.w ? { size: o.w, type: D.WidthType.DXA } : undefined,
            columnSpan: o.span,
            shading: o.fill ? { fill: o.fill, type: D.ShadingType.CLEAR, color: 'auto' } : undefined,
            borders: o.borders || { top: NONE, bottom: o.bottom || NONE, left: NONE, right: NONE },
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            verticalAlign: o.valign || D.VerticalAlign.TOP
        });
        const table = (rows, widths, o = {}) => new D.Table({
            width: { size: widths.reduce((a, b) => a + b, 0), type: D.WidthType.DXA },
            columnWidths: widths,
            borders: o.borders || noBorders,
            alignment: o.align,
            rows
        });
        const label = text => para(text.toUpperCase(), { size: 14, bold: true, color: '777777', after: 40 });
        const R = D.AlignmentType.RIGHT, C = D.AlignmentType.CENTER;

        const half = PAGE_W / 2;
        const partyCell = (p, title) => cell([
            label(title),
            para(p ? p.name : '—', { bold: true, size: 21 }),
            ...partyLines(p).map(l => para(l, { size: 17, after: 10 }))
        ], { w: half - 100, borders: boxBorders });

        const children = [];

        // Заглавие
        children.push(table([new D.TableRow({ children: [
            cell([para(inv.from ? inv.from.name : '', { bold: true, size: 30, color: BLUE }),
                para('Царинско застапување и шпедиција', { size: 15, color: '666666' })], { w: half + 1500, bottom: { style: D.BorderStyle.SINGLE, size: 18, color: BLUE }, valign: D.VerticalAlign.BOTTOM }),
            cell([para('ФАКТУРА', { bold: true, size: 40, color: BLUE, align: R, after: 0 }),
                para('бр. ' + (inv.number || '—'), { bold: true, size: 24, align: R })], { w: half - 1500, bottom: { style: D.BorderStyle.SINGLE, size: 18, color: BLUE } })
        ] })], [half + 1500, half - 1500]));
        children.push(para('', { after: 160 }));

        // Издавач / примач
        children.push(table([new D.TableRow({ children: [
            partyCell(inv.from, 'Издавач'), cell(para(''), { w: 200 }), partyCell(inv.to, 'Примач (коминтент)')
        ] })], [half - 100, 200, half - 100]));
        children.push(para('', { after: 120 }));

        // Датуми
        const third = Math.floor(PAGE_W / 3);
        const meta = [['Датум на фактура', dmy(inv.date)], ['Валута (рок)', dmy(inv.due) || '—'], ['Место на издавање', inv.place || '—']];
        children.push(table([new D.TableRow({ children: meta.map(([k, v]) =>
            cell([label(k), para(v, { bold: true, size: 19 })], { w: third, fill: 'F1F4F8' })) })], [third, third, PAGE_W - 2 * third]));
        children.push(para('', { after: 120 }));

        // Царински податоци (2 пара по ред)
        const cr = customsRows(inv.customs);
        if (cr.length) {
            const q = Math.floor(PAGE_W / 4);
            const rows = [];
            for (let i = 0; i < cr.length; i += 2) {
                const pair = [cr[i], cr[i + 1] || ['', '']];
                rows.push(new D.TableRow({ children: pair.flatMap(([k, v]) => [
                    cell(para(k, { size: 16, color: '666666' }), { w: q }),
                    cell(para(v, { size: 18, bold: true }), { w: q })
                ]) }));
            }
            children.push(label('Податоци за царинската постапка'));
            children.push(table(rows, [q, q, q, PAGE_W - 3 * q], { borders: { ...boxBorders, insideHorizontal: NONE, insideVertical: NONE } }));
            children.push(para('', { after: 120 }));
        }

        // Ставки
        const cols = [600, 0, 800, 700, 1300, 700, 1500];
        cols[1] = PAGE_W - cols.reduce((a, b) => a + b, 0);
        const head = ['Р.бр.', 'Опис на услугата', 'Ед.м.', 'Кол.', 'Цена', 'ДДВ', 'Износ без ДДВ'];
        const aligns = [C, D.AlignmentType.LEFT, C, R, R, C, R];
        const rowLine = { style: D.BorderStyle.SINGLE, size: 4, color: 'E2E6EC' };
        const itemRows = [new D.TableRow({ tableHeader: true, children: head.map((h, i) =>
            cell(para(h, { bold: true, size: 16, color: 'FFFFFF', align: aligns[i] }), { w: cols[i], fill: BLUE })) })];
        services.forEach((it, idx) => {
            const rate = t.vatPayer ? Number(it.vat) || 0 : 0;
            const vals = [idx + 1, it.name, it.unit, qtyFmt(it.qty), money(it.price), rate + '%', money(r2((Number(it.qty) || 0) * (Number(it.price) || 0)))];
            itemRows.push(new D.TableRow({ cantSplit: true, children: vals.map((v, i) =>
                cell(para(v, { size: 17, align: aligns[i] }), { w: cols[i], bottom: rowLine })) }));
        });
        if (!services.length) itemRows.push(new D.TableRow({ children: [cell(para('—', { align: C }), { span: 7 })] }));
        children.push(table(itemRows, cols));

        // Трошоци за сметка на налогодавачот
        if (pass.length) {
            children.push(para('', { after: 80 }));
            const pc = [600, PAGE_W - 600 - 1500, 1500];
            const pr = [new D.TableRow({ children: [cell(para('Трошоци платени во име и за сметка на налогодавачот (не подлежат на ДДВ)', { bold: true, size: 16 }), { span: 3, fill: 'E8EDF3' })] })];
            pass.forEach((it, idx) => pr.push(new D.TableRow({ children: [
                cell(para(idx + 1, { size: 17, align: C }), { w: pc[0], bottom: rowLine }),
                cell(para(it.name, { size: 17 }), { w: pc[1], bottom: rowLine }),
                cell(para(money(r2((Number(it.qty) || 0) * (Number(it.price) || 0))), { size: 17, align: R }), { w: pc[2], bottom: rowLine })
            ] })));
            children.push(table(pr, pc));
        }
        children.push(para('', { after: 160 }));

        // Збирови
        const tw = [3200, 1700];
        const totRows = [];
        const totRow = (k, v, o = {}) => totRows.push(new D.TableRow({ children: [
            cell(para(k, { size: o.size || 17, bold: o.bold, color: o.color }), { w: tw[0], fill: o.fill, bottom: o.line }),
            cell(para(v, { size: o.size || 17, bold: o.bold, color: o.color, align: R }), { w: tw[1], fill: o.fill, bottom: o.line })
        ] }));
        Object.keys(t.byRate).map(Number).sort((a, b) => b - a).forEach(rate => {
            totRow(`Основица за ДДВ ${rate}%`, money(t.byRate[rate].base));
            if (rate) totRow(`ДДВ ${rate}%`, money(t.byRate[rate].vat));
        });
        totRow('Вкупно услуги со ДДВ', money(t.gross), { bold: true });
        if (t.pass) totRow('Трошоци за сметка на налогодавачот', money(t.pass));
        totRow('ВКУПНО ЗА НАПЛАТА (ден.)', money(t.total), { bold: true, color: 'FFFFFF', fill: BLUE, size: 20 });
        children.push(table(totRows, tw, { align: D.AlignmentType.RIGHT }));
        children.push(para('', { after: 120 }));

        children.push(label('Со зборови'));
        children.push(para(amountInWords(t.total), { bold: true, size: 18 }));
        if (!t.vatPayer) children.push(para('Издавачот не е регистриран за ДДВ.', { size: 16, color: '666666' }));
        if (inv.note) children.push(para(inv.note, { size: 16, color: '444444', before: 160 }));

        // Потписи
        children.push(para('', { after: 900 }));
        const sw = [Math.floor((PAGE_W - 1400) / 2), 1400];
        sw.push(PAGE_W - sw[0] - sw[1]);
        const sigTop = { style: D.BorderStyle.SINGLE, size: 6, color: '333333' };
        children.push(table([new D.TableRow({ children: [
            cell(para('Примил', { size: 16, align: C }), { w: sw[0], borders: { top: sigTop, bottom: NONE, left: NONE, right: NONE } }),
            cell(para('М.П.', { size: 16, align: C, color: '999999' }), { w: sw[1] }),
            cell(para('Овластено лице за потпишување фактури', { size: 16, align: C }), { w: sw[2], borders: { top: sigTop, bottom: NONE, left: NONE, right: NONE } })
        ] })], sw));

        const doc = new D.Document({
            creator: inv.from ? inv.from.name : '',
            title: 'Фактура ' + (inv.number || ''),
            sections: [{
                properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 850, bottom: 850, left: 850, right: 850 } } },
                children
            }]
        });
        download(await D.Packer.toBlob(doc), fileName(inv, 'docx'));
    }

    // ============================================================
    // EXCEL (.xlsx) — со формули, за да може да се менува
    // ============================================================
    async function toXlsx(inv) {
        await loadLib('xlsx');
        const t = computeTotals(inv);
        const { services, pass } = splitItems(inv);
        const wb = new ExcelJS.Workbook();
        wb.creator = inv.from ? inv.from.name : '';
        const ws = wb.addWorksheet('Фактура', {
            pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
                margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
            views: [{ showGridLines: false }]
        });
        ws.columns = [{ width: 6 }, { width: 44 }, { width: 9 }, { width: 8 }, { width: 13 }, { width: 7 }, { width: 16 }];

        const NUM = '#,##0.00';
        const thin = { style: 'thin', color: { argb: 'FFC3CCD7' } };
        const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
        const white = { color: { argb: 'FFFFFFFF' }, bold: true };
        let r = 1;

        const put = (addr, value, style = {}) => {
            const c = ws.getCell(addr);
            c.value = value;
            if (style.font) c.font = style.font;
            if (style.fill) c.fill = style.fill;
            if (style.align) c.alignment = style.align;
            if (style.fmt) c.numFmt = style.fmt;
            if (style.border) c.border = style.border;
            return c;
        };

        // Заглавие
        ws.mergeCells(`A${r}:D${r}`);
        put(`A${r}`, inv.from ? inv.from.name : '', { font: { bold: true, size: 15, color: { argb: 'FF' + BLUE } } });
        ws.mergeCells(`E${r}:G${r}`);
        put(`E${r}`, 'ФАКТУРА', { font: { bold: true, size: 18, color: { argb: 'FF' + BLUE } }, align: { horizontal: 'right' } });
        r++;
        ws.mergeCells(`A${r}:D${r}`);
        put(`A${r}`, 'Царинско застапување и шпедиција', { font: { size: 9, color: { argb: 'FF666666' } } });
        ws.mergeCells(`E${r}:G${r}`);
        put(`E${r}`, 'бр. ' + (inv.number || '—'), { font: { bold: true, size: 12 }, align: { horizontal: 'right' } });
        ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach(col => { ws.getCell(`${col}${r}`).border = { bottom: { style: 'medium', color: { argb: 'FF' + BLUE } } }; });
        r += 2;

        // Издавач (A:C) / Примач (E:G)
        const fromL = [inv.from ? inv.from.name : '', ...partyLines(inv.from)];
        const toL = [inv.to ? inv.to.name : '', ...partyLines(inv.to)];
        const labelFont = { bold: true, size: 8, color: { argb: 'FF777777' } };
        ws.mergeCells(`A${r}:C${r}`); put(`A${r}`, 'ИЗДАВАЧ', { font: labelFont });
        ws.mergeCells(`E${r}:G${r}`); put(`E${r}`, 'ПРИМАЧ (КОМИНТЕНТ)', { font: labelFont });
        r++;
        for (let i = 0; i < Math.max(fromL.length, toL.length); i++, r++) {
            ws.mergeCells(`A${r}:C${r}`); ws.mergeCells(`E${r}:G${r}`);
            put(`A${r}`, fromL[i] || '', { font: { bold: i === 0, size: i === 0 ? 11 : 9 } });
            put(`E${r}`, toL[i] || '', { font: { bold: i === 0, size: i === 0 ? 11 : 9 } });
        }
        r++;

        // Датуми
        const metaFill = fill('FFF1F4F8');
        [['A', 'B', 'Датум на фактура', dmy(inv.date)], ['C', 'E', 'Валута (рок)', dmy(inv.due) || '—'], ['F', 'G', 'Место на издавање', inv.place || '—']]
            .forEach(([a, b, k, v]) => {
                ws.mergeCells(`${a}${r}:${b}${r}`); ws.mergeCells(`${a}${r + 1}:${b}${r + 1}`);
                put(`${a}${r}`, k.toUpperCase(), { font: labelFont, fill: metaFill });
                put(`${a}${r + 1}`, v, { font: { bold: true }, fill: metaFill });
            });
        r += 3;

        // Царински податоци
        const cr = customsRows(inv.customs);
        if (cr.length) {
            ws.mergeCells(`A${r}:G${r}`);
            put(`A${r}`, 'ПОДАТОЦИ ЗА ЦАРИНСКАТА ПОСТАПКА', { font: labelFont });
            r++;
            for (let i = 0; i < cr.length; i += 2, r++) {
                ws.mergeCells(`A${r}:B${r}`);
                put(`A${r}`, cr[i][0] + ': ', { font: { size: 9, color: { argb: 'FF666666' } } });
                ws.getCell(`A${r}`).value = { richText: [{ text: cr[i][0] + ': ', font: { size: 9, color: { argb: 'FF666666' } } }, { text: String(cr[i][1]), font: { size: 10, bold: true } }] };
                if (cr[i + 1]) {
                    ws.mergeCells(`C${r}:G${r}`);
                    ws.getCell(`C${r}`).value = { richText: [{ text: cr[i + 1][0] + ': ', font: { size: 9, color: { argb: 'FF666666' } } }, { text: String(cr[i + 1][1]), font: { size: 10, bold: true } }] };
                }
            }
            r++;
        }

        // Ставки
        const head = ['Р.бр.', 'Опис на услугата', 'Ед.м.', 'Кол.', 'Цена', 'ДДВ %', 'Износ без ДДВ'];
        head.forEach((h, i) => put(`${'ABCDEFG'[i]}${r}`, h, {
            font: white, fill: fill('FF' + BLUE),
            align: { horizontal: i === 1 ? 'left' : i >= 3 && i !== 5 ? 'right' : 'center', vertical: 'middle', wrapText: true }
        }));
        r++;
        const firstItem = r;
        services.forEach((it, idx) => {
            const rate = t.vatPayer ? Number(it.vat) || 0 : 0;
            const amount = r2((Number(it.qty) || 0) * (Number(it.price) || 0));
            put(`A${r}`, idx + 1, { align: { horizontal: 'center' } });
            put(`B${r}`, it.name, { align: { wrapText: true, vertical: 'top' } });
            put(`C${r}`, it.unit || '', { align: { horizontal: 'center' } });
            put(`D${r}`, Number(it.qty) || 0);
            put(`E${r}`, Number(it.price) || 0, { fmt: NUM });
            put(`F${r}`, rate, { align: { horizontal: 'center' } });
            put(`G${r}`, { formula: `ROUND(D${r}*E${r},2)`, result: amount }, { fmt: NUM });
            'ABCDEFG'.split('').forEach(col => {
                const c = ws.getCell(`${col}${r}`);
                c.border = { bottom: thin };
                c.alignment = { ...(c.alignment || {}), vertical: 'top' };
            });
            r++;
        });
        const lastItem = Math.max(firstItem, r - 1);
        if (!services.length) r++;
        r++;

        let passFirst = 0, passLast = 0;
        if (pass.length) {
            ws.mergeCells(`A${r}:G${r}`);
            put(`A${r}`, 'Трошоци платени во име и за сметка на налогодавачот (не подлежат на ДДВ)', { font: { bold: true, size: 9 }, fill: fill('FFE8EDF3') });
            r++;
            passFirst = r;
            pass.forEach((it, idx) => {
                put(`A${r}`, idx + 1, { align: { horizontal: 'center' } });
                ws.mergeCells(`B${r}:F${r}`);
                put(`B${r}`, it.name);
                put(`G${r}`, r2((Number(it.qty) || 0) * (Number(it.price) || 0)), { fmt: NUM });
                'ABCDEFG'.split('').forEach(col => { ws.getCell(`${col}${r}`).border = { bottom: thin }; });
                r++;
            });
            passLast = r - 1;
            r++;
        }

        // Збирови (со формули)
        const items = `F${firstItem}:F${lastItem}`, amounts = `G${firstItem}:G${lastItem}`;
        const grossParts = [];
        Object.keys(t.byRate).map(Number).sort((a, b) => b - a).forEach(rate => {
            ws.mergeCells(`C${r}:F${r}`);
            put(`C${r}`, `Основица за ДДВ ${rate}%`);
            put(`G${r}`, { formula: `SUMIF(${items},${rate},${amounts})`, result: t.byRate[rate].base }, { fmt: NUM });
            grossParts.push(`G${r}`);
            const baseRow = r;
            r++;
            if (rate) {
                ws.mergeCells(`C${r}:F${r}`);
                put(`C${r}`, `ДДВ ${rate}%`);
                put(`G${r}`, { formula: `ROUND(G${baseRow}*${rate}/100,2)`, result: t.byRate[rate].vat }, { fmt: NUM });
                grossParts.push(`G${r}`);
                r++;
            }
        });
        ws.mergeCells(`C${r}:F${r}`);
        put(`C${r}`, 'Вкупно услуги со ДДВ', { font: { bold: true }, border: { top: thin } });
        put(`G${r}`, { formula: grossParts.length ? grossParts.join('+') : '0', result: t.gross }, { fmt: NUM, font: { bold: true }, border: { top: thin } });
        const grossRow = r;
        r++;
        let passRow = 0;
        if (pass.length) {
            ws.mergeCells(`C${r}:F${r}`);
            put(`C${r}`, 'Трошоци за сметка на налогодавачот');
            put(`G${r}`, { formula: `SUM(G${passFirst}:G${passLast})`, result: t.pass }, { fmt: NUM });
            passRow = r;
            r++;
        }
        ws.mergeCells(`C${r}:F${r}`);
        put(`C${r}`, 'ВКУПНО ЗА НАПЛАТА (ден.)', { font: white, fill: fill('FF' + BLUE) });
        put(`G${r}`, { formula: passRow ? `G${grossRow}+G${passRow}` : `G${grossRow}`, result: t.total }, { fmt: NUM, font: white, fill: fill('FF' + BLUE) });
        r += 2;

        ws.mergeCells(`A${r}:G${r}`);
        put(`A${r}`, 'Со зборови: ' + amountInWords(t.total), { font: { bold: true } });
        r++;
        if (!t.vatPayer) { ws.mergeCells(`A${r}:G${r}`); put(`A${r}`, 'Издавачот не е регистриран за ДДВ.', { font: { size: 9, color: { argb: 'FF666666' } } }); r++; }
        if (inv.note) {
            r++;
            ws.mergeCells(`A${r}:G${r}`);
            put(`A${r}`, inv.note, { font: { size: 9 }, align: { wrapText: true, vertical: 'top' } });
            ws.getRow(r).height = Math.max(15, Math.ceil(inv.note.length / 95) * 13);
            r++;
        }

        // Потписи
        r += 3;
        ws.mergeCells(`A${r}:B${r}`); ws.mergeCells(`E${r}:G${r}`);
        put(`A${r}`, 'Примил', { align: { horizontal: 'center' }, border: { top: { style: 'thin' } } });
        put(`D${r}`, 'М.П.', { align: { horizontal: 'center' }, font: { color: { argb: 'FF999999' } } });
        put(`E${r}`, 'Овластено лице за потпишување фактури', { align: { horizontal: 'center' }, border: { top: { style: 'thin' } } });

        const buf = await wb.xlsx.writeBuffer();
        download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName(inv, 'xlsx'));
    }

    global.Exporter = { toPdf, toDocx, toXlsx };
})(window);
