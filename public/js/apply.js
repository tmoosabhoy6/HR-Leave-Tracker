import { html, render, useState, useEffect, useMemo, useRef } from '/vendor/preact-htm.js';
import { todayIraq, countDays, isISODate, parse } from '/js/logic.js';

const T = {
  en: {
    title: 'Leave request',
    intro: 'Ask for time off. Your request goes to the HR office for approval.',
    tabNew: 'New request',
    tabCheck: 'Check a request',
    name: 'Your name',
    namePh: 'Start typing your name',
    nameHint: 'Not on the list? Ask the office to add you.',
    noMatch: 'No one with that name. Check the spelling, or ask the office to add you.',
    change: 'Change',
    type: 'Type of leave',
    types: {
      monthly: ['Monthly day off', 'Your regular days off this month'],
      annual: ['Annual leave', 'Longer leave, taken from your yearly allowance'],
      sick: ['Sick leave', 'If you are unwell'],
      other: ['Other / emergency', 'A family emergency or anything else'],
    },
    dates: 'Dates',
    from: 'First day off',
    to: 'Last day off',
    reason: 'Reason',
    optional: 'optional',
    reasonPh: 'A short note for the office',
    phone: 'Phone number',
    send: 'Send request',
    sending: 'Sending…',
    sentTitle: 'Request sent',
    sentBody: 'The office will review it. Keep this code to check whether your leave is approved.',
    yourRef: 'Your reference',
    checkNow: 'Check this request',
    another: 'Send another request',
    checkIntro: 'Enter the reference code you got after sending your request.',
    refLabel: 'Reference code',
    check: 'Check',
    checking: 'Checking…',
    status: { pending: 'Waiting for a decision', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled' },
    statusBody: {
      pending: 'The office has not decided yet. Check again later.',
      approved: 'Your leave is approved.',
      declined: 'This request was not approved. Speak to the office if you have questions.',
      cancelled: 'This leave was cancelled by the office.',
    },
    officeNote: 'Note from the office',
    errName: 'Choose your name from the list.',
    errType: 'Choose the type of leave.',
    errDates: 'Choose your first and last day off.',
    errOrder: 'The last day is before the first day.',
    errNone: 'These dates have no working days.',
    errNet: 'Couldn’t send. Check your internet connection and try again.',
    errRef: 'Enter the 6-character code.',
    fridays: 'Fridays are not counted.',
    days: (n) => (n === 1 ? '1 day' : `${n} days`),
    lang: 'العربية',
    loading: 'Loading names…',
    of: (name) => `Request for ${name}`,
  },
  ar: {
    title: 'طلب إجازة',
    intro: 'اطلب إجازة. يُرسَل طلبك إلى مكتب الموارد البشرية للموافقة عليه.',
    tabNew: 'طلب جديد',
    tabCheck: 'متابعة طلب',
    name: 'اسمك',
    namePh: 'ابدأ بكتابة اسمك بالإنجليزية',
    nameHint: 'اسمك غير موجود؟ اطلب من المكتب إضافتك.',
    noMatch: 'لا يوجد أحد بهذا الاسم. تحقّق من الكتابة أو اطلب من المكتب إضافتك.',
    change: 'تغيير',
    type: 'نوع الإجازة',
    types: {
      monthly: ['إجازة شهرية', 'أيام عطلتك المعتادة لهذا الشهر'],
      annual: ['إجازة سنوية', 'إجازة أطول تُحتسب من رصيدك السنوي'],
      sick: ['إجازة مرضية', 'في حال المرض'],
      other: ['أخرى / طارئة', 'ظرف عائلي طارئ أو غير ذلك'],
    },
    dates: 'التواريخ',
    from: 'أول يوم إجازة',
    to: 'آخر يوم إجازة',
    reason: 'السبب',
    optional: 'اختياري',
    reasonPh: 'ملاحظة قصيرة للمكتب',
    phone: 'رقم الهاتف',
    send: 'إرسال الطلب',
    sending: 'جارٍ الإرسال…',
    sentTitle: 'تم إرسال الطلب',
    sentBody: 'سيراجع المكتب طلبك. احتفظ بهذا الرمز لمعرفة ما إذا تمت الموافقة على إجازتك.',
    yourRef: 'رمز المرجع',
    checkNow: 'متابعة هذا الطلب',
    another: 'إرسال طلب آخر',
    checkIntro: 'أدخل رمز المرجع الذي حصلت عليه بعد إرسال طلبك.',
    refLabel: 'رمز المرجع',
    check: 'تحقّق',
    checking: 'جارٍ التحقّق…',
    status: { pending: 'قيد المراجعة', approved: 'تمت الموافقة', declined: 'مرفوض', cancelled: 'ملغى' },
    statusBody: {
      pending: 'لم يتخذ المكتب قرارًا بعد. تحقّق مرة أخرى لاحقًا.',
      approved: 'تمت الموافقة على إجازتك.',
      declined: 'لم تتم الموافقة على هذا الطلب. راجع المكتب إذا كانت لديك أسئلة.',
      cancelled: 'ألغى المكتب هذه الإجازة.',
    },
    officeNote: 'ملاحظة من المكتب',
    errName: 'اختر اسمك من القائمة.',
    errType: 'اختر نوع الإجازة.',
    errDates: 'اختر أول وآخر يوم إجازة.',
    errOrder: 'آخر يوم يسبق أول يوم.',
    errNone: 'لا توجد أيام عمل في هذه التواريخ.',
    errNet: 'تعذّر الإرسال. تحقّق من اتصال الإنترنت وحاول مرة أخرى.',
    errRef: 'أدخل الرمز المكوّن من 6 أحرف.',
    fridays: 'لا تُحتسب أيام الجمعة.',
    days: (n) => (n === 1 ? 'يوم واحد' : n === 2 ? 'يومان' : n <= 10 ? `${n} أيام` : `${n} يومًا`),
    lang: 'English',
    loading: 'جارٍ تحميل الأسماء…',
    of: (name) => `طلب باسم ${name}`,
  },
};

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function niceDate(s, lang) {
  const d = new Date(parse(s));
  const day = d.getUTCDate(), m = d.getUTCMonth(), y = d.getUTCFullYear();
  return lang === 'ar' ? `${day} ${MONTHS_AR[m]} ${y}` : `${day} ${MONTHS_EN[m]} ${y}`;
}
const niceRange = (a, b, lang) => (a === b ? niceDate(a, lang) : `${niceDate(a, lang)} – ${niceDate(b, lang)}`);

const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

function NamePicker({ t, staff, value, onChange, invalid }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef();
  const inputRef = useRef();
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return staff.slice(0, 60);
    const words = s.split(/\s+/);
    return staff.filter((p) => words.every((w) => p.name.toLowerCase().includes(w))).slice(0, 60);
  }, [q, staff]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (value) {
    const p = staff.find((x) => x.id === value);
    return html`<div class="picked">
      <span class="avatar-lg" aria-hidden="true">${p.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('')}</span>
      <span class="picked-text"><b>${p.name}</b><span class="muted">${p.department || ''}</span></span>
      <button type="button" class="btn small" onClick=${() => { onChange(null); setQ(''); setTimeout(() => inputRef.current?.focus(), 0); }}>${t.change}</button>
    </div>`;
  }
  const choose = (p) => {
    onChange(p.id);
    setOpen(false);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open && matches[active]) {
      e.preventDefault();
      choose(matches[active]);
    } else if (e.key === 'Escape') setOpen(false);
  };
  return html`<div class="combo">
    <input ref=${inputRef} id="name" class="input big" type="text" role="combobox" autocomplete="off" spellcheck="false" dir="ltr"
      aria-expanded=${open} aria-controls="name-list" aria-autocomplete="list" aria-invalid=${invalid ? 'true' : undefined}
      aria-activedescendant=${open && matches[active] ? `opt-${matches[active].id}` : undefined}
      placeholder=${t.namePh} value=${q}
      onInput=${(e) => { setQ(e.target.value); setOpen(true); }} onFocus=${() => setOpen(true)} onBlur=${() => setTimeout(() => setOpen(false), 150)} onKeyDown=${onKey} />
    ${open && html`<ul id="name-list" role="listbox" class="combo-list" ref=${listRef}>
      ${matches.length === 0
        ? html`<li class="combo-empty">${t.noMatch}</li>`
        : matches.map((p, i) => html`<li id="opt-${p.id}" role="option" aria-selected=${i === active} onMouseDown=${(e) => { e.preventDefault(); choose(p); }} onMouseEnter=${() => setActive(i)}>
            <b>${p.name}</b><span class="muted">${p.department || ''}</span>
          </li>`)}
    </ul>`}
  </div>`;
}

function NewRequest({ t, lang, staff, countFridays, onSent }) {
  const today = todayIraq();
  const [f, setF] = useState({ employeeId: null, type: '', start: '', end: '', reason: '', contact: '', website: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [serverErr, setServerErr] = useState('');
  const set = (k, v) =>
    setF((p) => {
      const n = { ...p, [k]: v };
      if (k === 'start' && v && (!p.end || p.end < v)) n.end = v;
      return n;
    });
  const policy = { countFridays };
  const days = isISODate(f.start) && isISODate(f.end) && f.end >= f.start ? countDays(f.start, f.end, policy) : 0;

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (!f.employeeId) er.name = t.errName;
    if (!f.type) er.type = t.errType;
    if (!f.start || !f.end) er.dates = t.errDates;
    else if (f.end < f.start) er.dates = t.errOrder;
    else if (days === 0) er.dates = t.errNone;
    setErrors(er);
    setServerErr('');
    if (Object.keys(er).length) {
      document.querySelector('[data-err="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/public/requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t.errNet);
      const p = staff.find((x) => x.id === f.employeeId);
      onSent({ ref: data.ref, name: p?.name, type: f.type, start: f.start, end: f.end, days: data.days ?? days });
    } catch (x) {
      setServerErr(x.message === 'Failed to fetch' ? t.errNet : x.message);
      setBusy(false);
    }
  };

  return html`<form class="card form" onSubmit=${submit} novalidate>
    <div class="q" data-err=${!!errors.name}>
      <label class="q-label" for="name">${t.name}</label>
      ${staff.length === 0 ? html`<p class="muted">${t.loading}</p>` : html`<${NamePicker} t=${t} staff=${staff} value=${f.employeeId} onChange=${(v) => set('employeeId', v)} invalid=${!!errors.name} />`}
      ${errors.name ? html`<p class="err" role="alert">${errors.name}</p>` : !f.employeeId && html`<p class="hint">${t.nameHint}</p>`}
    </div>

    <fieldset class="q" data-err=${!!errors.type}>
      <legend class="q-label">${t.type}</legend>
      <div class="types">
        ${Object.entries(t.types).map(([k, [label, desc]]) => html`<label class="type t-${k}">
          <input type="radio" name="type" value=${k} checked=${f.type === k} onChange=${() => set('type', k)} />
          <span class="type-mark" aria-hidden="true"></span>
          <span class="type-text"><b>${label}</b><span>${desc}</span></span>
        </label>`)}
      </div>
      ${errors.type && html`<p class="err" role="alert">${errors.type}</p>`}
    </fieldset>

    <fieldset class="q" data-err=${!!errors.dates}>
      <legend class="q-label">${t.dates}</legend>
      <div class="dates">
        <div class="field"><label for="start">${t.from}</label><input id="start" type="date" class="input big" value=${f.start} onInput=${(e) => set('start', e.target.value)} /></div>
        <div class="field"><label for="end">${t.to}</label><input id="end" type="date" class="input big" min=${f.start || undefined} value=${f.end} onInput=${(e) => set('end', e.target.value)} /></div>
      </div>
      ${days > 0 && html`<p class="day-count"><b class="num">${t.days(days)}</b>${!countFridays ? ` ${t.fridays}` : ''} <span class="muted">${niceRange(f.start, f.end, lang)}</span></p>`}
      ${errors.dates && html`<p class="err" role="alert">${errors.dates}</p>`}
    </fieldset>

    <div class="q">
      <label class="q-label" for="reason">${t.reason} <span class="opt">(${t.optional})</span></label>
      <textarea id="reason" class="input" rows="3" maxlength="1000" placeholder=${t.reasonPh} value=${f.reason} onInput=${(e) => set('reason', e.target.value)}></textarea>
    </div>
    <div class="q">
      <label class="q-label" for="contact">${t.phone} <span class="opt">(${t.optional})</span></label>
      <input id="contact" class="input big" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" maxlength="30" value=${f.contact} onInput=${(e) => set('contact', e.target.value)} />
    </div>
    <div class="hp" aria-hidden="true"><label>Website <input tabindex="-1" autocomplete="off" value=${f.website} onInput=${(e) => set('website', e.target.value)} /></label></div>

    ${serverErr && html`<p class="err big" role="alert">${serverErr}</p>`}
    <button class="btn primary submit" disabled=${busy}>${busy ? t.sending : t.send}</button>
  </form>`;
}

function Sent({ t, lang, sent, onAnother, onCheck }) {
  const [copied, setCopied] = useState(false);
  return html`<div class="card sent">
    <div class="sent-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></div>
    <h2 class="serif">${t.sentTitle}</h2>
    <p>${t.sentBody}</p>
    <div class="ref-box">
      <span class="muted">${t.yourRef}</span>
      <button class="ref" dir="ltr" onClick=${async () => { try { await navigator.clipboard.writeText(sent.ref); setCopied(true); } catch {} }} aria-label="${t.yourRef}: ${sent.ref.split('').join(' ')}">${sent.ref}</button>
      ${copied && html`<span class="hint">✓</span>`}
    </div>
    <dl class="summary">
      <div><dt>${t.name}</dt><dd>${sent.name}</dd></div>
      <div><dt>${t.type}</dt><dd>${t.types[sent.type][0]}</dd></div>
      <div><dt>${t.dates}</dt><dd>${niceRange(sent.start, sent.end, lang)}${lang === 'ar' ? '، ' : ', '}${t.days(sent.days)}</dd></div>
    </dl>
    <div class="sent-actions">
      <button class="btn" onClick=${onCheck}>${t.checkNow}</button>
      <button class="btn ghost" onClick=${onAnother}>${t.another}</button>
    </div>
  </div>`;
}

function Check({ t, lang, initialRef }) {
  const [ref, setRef] = useState(initialRef || '');
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (code) => {
    const c = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(c)) {
      setErr(t.errRef);
      return;
    }
    setBusy(true);
    setErr('');
    setRes(null);
    try {
      const r = await fetch(`/api/public/requests/${c}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || t.errNet);
      setRes(data.request);
    } catch (x) {
      setErr(x.message === 'Failed to fetch' ? t.errNet : x.message);
    }
    setBusy(false);
  };
  useEffect(() => {
    if (initialRef) run(initialRef);
  }, []);
  return html`<div class="card form">
    <p>${t.checkIntro}</p>
    <form class="check-row" onSubmit=${(e) => { e.preventDefault(); run(ref); }}>
      <div class="field"><label for="ref">${t.refLabel}</label>
        <input id="ref" class="input big ref-input" dir="ltr" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" value=${ref} onInput=${(e) => setRef(e.target.value.toUpperCase())} /></div>
      <button class="btn primary" disabled=${busy}>${busy ? t.checking : t.check}</button>
    </form>
    ${err && html`<p class="err" role="alert">${err}</p>`}
    ${res && html`<div class="status-card ${res.status}" role="status">
      <p class="status-label">${t.status[res.status]}</p>
      <p>${t.statusBody[res.status]}</p>
      <dl class="summary">
        <div><dt>${t.type}</dt><dd>${t.types[res.type][0]}</dd></div>
        <div><dt>${t.dates}</dt><dd>${niceRange(res.start_date, res.end_date, lang)}</dd></div>
      </dl>
      ${res.decision_note && html`<p class="note"><b>${t.officeNote}:</b> ${res.decision_note}</p>`}
    </div>`}
  </div>`;
}

function App() {
  const params = new URLSearchParams(location.search);
  const [lang, setLang] = useState(() => store.get('leave-lang') || (navigator.language?.startsWith('ar') ? 'ar' : 'en'));
  const [tab, setTab] = useState(params.get('ref') ? 'check' : 'new');
  const [checkRef, setCheckRef] = useState(params.get('ref') || '');
  const [staff, setStaff] = useState([]);
  const [countFridays, setCountFridays] = useState(true);
  const [sent, setSent] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const t = T[lang];

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = t.title;
    store.set('leave-lang', lang);
  }, [lang]);
  useEffect(() => {
    fetch('/api/public/staff')
      .then((r) => r.json())
      .then((d) => {
        setStaff(d.staff || []);
        setCountFridays(d.countFridays !== false);
      })
      .catch(() => {});
  }, []);

  return html`<div class="wrap">
    <header class="hero">
      <div class="hero-top">
        <img src="/icon.svg" alt="" width="32" height="32" />
        <button class="lang" onClick=${() => setLang(lang === 'en' ? 'ar' : 'en')} lang=${lang === 'en' ? 'ar' : 'en'}>${t.lang}</button>
      </div>
      <h1 class="serif">${t.title}</h1>
      <p>${t.intro}</p>
      <div class="hero-tabs" role="tablist">
        <button role="tab" aria-selected=${tab === 'new'} onClick=${() => setTab('new')}>${t.tabNew}</button>
        <button role="tab" aria-selected=${tab === 'check'} onClick=${() => setTab('check')}>${t.tabCheck}</button>
      </div>
    </header>
    <main class="body">
      ${tab === 'new' &&
      (sent
        ? html`<${Sent} t=${t} lang=${lang} sent=${sent}
            onAnother=${() => { setSent(null); setFormKey((k) => k + 1); scrollTo(0, 0); }}
            onCheck=${() => { setCheckRef(sent.ref); setTab('check'); }} />`
        : html`<${NewRequest} key=${formKey} t=${t} lang=${lang} staff=${staff} countFridays=${countFridays} onSent=${(s) => { setSent(s); scrollTo(0, 0); }} />`)}
      ${tab === 'check' && html`<${Check} key=${checkRef} t=${t} lang=${lang} initialRef=${checkRef} />`}
    </main>
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
