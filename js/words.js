// Износ со зборови на македонски: 1525.50 -> "илјада петстотини дваесет и пет денари и 50/100"
(function (global) {
    const ONES_M = ['', 'еден', 'два', 'три', 'четири', 'пет', 'шест', 'седум', 'осум', 'девет'];
    const ONES_F = ['', 'една', 'две', 'три', 'четири', 'пет', 'шест', 'седум', 'осум', 'девет'];
    const TEENS = ['десет', 'единаесет', 'дванаесет', 'тринаесет', 'четиринаесет', 'петнаесет',
        'шеснаесет', 'седумнаесет', 'осумнаесет', 'деветнаесет'];
    const TENS = ['', '', 'дваесет', 'триесет', 'четириесет', 'педесет', 'шеесет', 'седумдесет', 'осумдесет', 'деведесет'];
    const HUNDREDS = ['', 'сто', 'двесте', 'триста', 'четиристотини', 'петстотини', 'шестотини',
        'седумстотини', 'осумстотини', 'деветстотини'];

    // 0..999 -> листа зборови (без „и“)
    function groupWords(n, feminine) {
        const ones = feminine ? ONES_F : ONES_M;
        const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10;
        const out = [];
        if (h) out.push(HUNDREDS[h]);
        if (t === 1) out.push(TEENS[o]);
        else {
            if (t) out.push(TENS[t]);
            if (o) out.push(ones[o]);
        }
        return out;
    }

    // „и“ пред последниот збор во групата: сто дваесет и пет, сто и пет
    function joinGroup(words) {
        if (words.length > 1) words.splice(words.length - 1, 0, 'и');
        return words.join(' ');
    }

    function integerWords(n) {
        if (n === 0) return 'нула';
        const millions = Math.floor(n / 1e6);
        const thousands = Math.floor((n % 1e6) / 1000);
        const rest = n % 1000;
        const parts = [];

        if (millions) {
            // 1, 21, 101… -> „милион“ / „илјада“ (еднина), освен 11
            const one = n => n % 10 === 1 && n % 100 !== 11;
            parts.push(millions === 1 ? 'еден милион' : joinGroup(groupWords(millions, false)) + (one(millions) ? ' милион' : ' милиони'));
        }
        if (thousands) {
            const one = n => n % 10 === 1 && n % 100 !== 11;
            parts.push(thousands === 1 ? 'илјада' : joinGroup(groupWords(thousands, true)) + (one(thousands) ? ' илјада' : ' илјади'));
        }
        if (rest) {
            const w = groupWords(rest, false);
            // илјада и петстотини / илјада и пет, но: илјада петстотини дваесет и пет
            if (parts.length && w.length === 1) parts.push('и ' + w[0]);
            else parts.push(joinGroup(w));
        }
        return parts.join(' ');
    }

    function amountInWords(amount) {
        const cents = Math.round(Math.abs(amount) * 100);
        const whole = Math.floor(cents / 100);
        const dec = cents % 100;
        const singular = whole % 10 === 1 && whole % 100 !== 11;
        let text = integerWords(whole) + (singular ? ' денар' : ' денари');
        if (dec) text += ' и ' + String(dec).padStart(2, '0') + '/100';
        return (amount < 0 ? 'минус ' : '') + text;
    }

    global.amountInWords = amountInWords;
})(window);
