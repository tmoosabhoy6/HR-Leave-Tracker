import { html, render, useState, useEffect, useMemo, useRef, useCallback } from '/vendor/preact-htm.js';
import {
  LEAVE_TYPES, GROUPS, MONTHS, MONTHS_SHORT, assess, snapshot, usage, leaveDates, countDays, groupOf,
  prettyDate, prettyRange, plural, daysInMonth, parse, fmt, addDays, annualAllowanceAt, iraqDateOf,
} from '/js/logic.js';

// ---------------------------------------------------------------- api
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Check your connection and try again.');
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------- small pieces
const ICONS = {
  inbox: 'M3 13h5l1.5 3h5L16 13h5M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z',
  users: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7',
  calendar: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 10h16M8 3v4M16 3v4',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4',
};
const Icon = ({ name, label }) =>
  html`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden=${label ? undefined : 'true'} role=${label ? 'img' : undefined} aria-label=${label}><path d=${ICONS[name]} /></svg>`;

const GroupChip = ({ group }) => html`<span class="chip ${group}">${GROUPS[group].label}</span>`;
const TypeLabel = ({ type, short }) =>
  html`<span class="type-label"><span class="dot t-${type}"></span>${short ? LEAVE_TYPES[type].short : LEAVE_TYPES[type].label}</span>`;
const STATUS_LABEL = { pending: 'Waiting', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled' };
const VERDICT_LABEL = { eligible: 'Eligible', partial: 'Partly eligible', over: 'Not eligible', open: 'No limit set' };
const StatusChip = ({ status }) => html`<span class="chip ${status}">${STATUS_LABEL[status]}</span>`;
const firstLast = (name) => {
  const p = name.trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0];
};
const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();

let toastTimer;
function useToast() {
  const [msg, setMsg] = useState(null);
  const show = useCallback((m) => {
    setMsg(m);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setMsg(null), 2600);
  }, []);
  return [msg, show];
}

function Meter({ label, used, ask = 0, cap, type, note }) {
  const total = Math.max(cap, used + ask, 1);
  const overAmt = Math.max(0, used + ask - cap);
  const usedPct = (Math.min(used, cap) / total) * 100;
  const askPct = (Math.max(0, Math.min(ask, cap - used)) / total) * 100;
  const overPct = (overAmt / total) * 100;
  return html`<div class="meter t-${type}">
    <div class="meter-row">
      <span class="label">${label}</span>
      <span class="val num">${used + ask}<small> of ${cap}</small></span>
    </div>
    <div class="bar" role="img" aria-label="${used} used${ask ? `, ${ask} requested` : ''}, ${cap} allowed">
      <i style="width:${usedPct}%"></i>${askPct > 0 && html`<i class="req" style="width:${askPct}%"></i>`}${overPct > 0 && html`<i class="over" style="width:${overPct}%"></i>`}
    </div>
    ${note && html`<span class="hint">${note}</span>`}
  </div>`;
}

// The year as 12 rows of up to 31 day cells.
function Ribbon({ year, dates, ask, askType, today }) {
  const cells = [];
  const nowMonth = today.slice(0, 4) == year ? Number(today.slice(5, 7)) - 1 : -1;
  for (let m = 0; m < 12; m++) {
    cells.push(html`<span class="m ${m === nowMonth ? 'now' : ''}">${MONTHS_SHORT[m]}</span>`);
    const dim = daysInMonth(year, m);
    for (let d = 1; d <= 31; d++) {
      if (d > dim) {
        cells.push(html`<span class="c none"></span>`);
        continue;
      }
      const iso = `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const type = dates[iso];
      const isAsk = ask && ask.has(iso);
      const fri = new Date(parse(iso)).getUTCDay() === 5;
      const cls = ['c', fri && 'fri', type && `on t-${type}`, isAsk && 'ask', isAsk && !type && askType && `on t-${askType}`, iso === today && 'today'].filter(Boolean).join(' ');
      const title = `${prettyDate(iso)}${type ? ': ' + LEAVE_TYPES[type].label : ''}${isAsk ? ' (this request)' : ''}`;
      cells.push(html`<span class=${cls} title=${title}></span>`);
    }
  }
  return html`<div class="ribbon" role="img" aria-label="Leave taken in ${year}">${cells}</div>`;
}
const RibbonLegend = ({ withAsk }) => html`<div class="legend">
  ${Object.keys(LEAVE_TYPES).map((t) => html`<span><i class="sw t-${t}"></i>${LEAVE_TYPES[t].short}</span>`)}
  ${withAsk && html`<span><i class="sw ask"></i>This request</span>`}
</div>`;

function Dialog({ title, onClose, children, wide }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    const onCancel = (e) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener('cancel', onCancel);
    return () => d.removeEventListener('cancel', onCancel);
  }, []);
  return html`<dialog ref=${ref} class="dialog ${wide ? 'wide' : ''}" onClick=${(e) => e.target === ref.current && onClose()}>
    <div class="dialog-inner">
      <header class="dialog-head">
        <h2 class="serif">${title}</h2>
        <button class="btn ghost small icon-only" onClick=${onClose} aria-label="Close"><${Icon} name="x" /></button>
      </header>
      ${children}
    </div>
  </dialog>`;
}

// ---------------------------------------------------------------- routing
function useRoute() {
  const get = () => (location.hash.replace(/^#\/?/, '') || 'requests').split('/');
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => setRoute(get());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}
const go = (path) => (location.hash = '#/' + path);

// ---------------------------------------------------------------- login
function Login({ onDone }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api('/api/login', { method: 'POST', body: { password: pw } });
      onDone();
    } catch (x) {
      setErr(x.message);
      setBusy(false);
    }
  };
  return html`<main class="login">
    <form class="login-card panel" onSubmit=${submit}>
      <img src="/icon.svg" alt="" width="40" height="40" />
      <h1 class="serif">Leave desk</h1>
      <p class="muted">Review and approve leave for HR staff.</p>
      <div class="field">
        <label for="pw">Admin password</label>
        <input id="pw" class="input" type="password" autocomplete="current-password" value=${pw} onInput=${(e) => setPw(e.target.value)} autofocus required />
      </div>
      ${err && html`<p class="form-error" role="alert">${err}</p>`}
      <button class="btn primary block" disabled=${busy}>${busy ? 'Signing in…' : 'Sign in'}</button>
      <a class="small-link" href="/apply">Looking for the leave form?</a>
    </form>
  </main>`;
}

// ---------------------------------------------------------------- app shell
function App() {
  const [authed, setAuthed] = useState(null);
  const [data, setData] = useState(null);
  const [toast, showToast] = useToast();
  const [dialog, setDialog] = useState(null);
  const route = useRoute();

  const load = useCallback(async () => {
    try {
      const d = await api('/api/data');
      setData(d);
      setAuthed(true);
    } catch (e) {
      if (e.status === 401) setAuthed(false);
      else showToast(e.message);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 60000);
    addEventListener('focus', load);
    return () => {
      clearInterval(t);
      removeEventListener('focus', load);
    };
  }, []);

  if (authed === false) return html`<${Login} onDone=${load} />`;
  if (!data) return html`<p class="boot">Loading…</p>`;

  const ctx = {
    ...data,
    byId: Object.fromEntries(data.employees.map((e) => [e.id, e])),
    toast: showToast,
    reload: load,
    openDialog: setDialog,
    updateRequest: (row) => setData((d) => ({ ...d, requests: d.requests.some((r) => r.id === row.id) ? d.requests.map((r) => (r.id === row.id ? row : r)) : [row, ...d.requests] })),
    removeRequest: (id) => setData((d) => ({ ...d, requests: d.requests.filter((r) => r.id !== id) })),
    updateEmployee: (row) => setData((d) => ({ ...d, employees: d.employees.some((e) => e.id === row.id) ? d.employees.map((e) => (e.id === row.id ? row : e)) : [...d.employees, row].sort((a, b) => a.name.localeCompare(b.name)) })),
    setPolicy: (policy) => setData((d) => ({ ...d, policy })),
  };
  const pending = data.requests.filter((r) => r.status === 'pending').length;
  const section = route[0];
  const nav = [
    ['requests', 'Requests', 'inbox', pending],
    ['people', 'People', 'users'],
    ['calendar', 'Calendar', 'calendar'],
    ['settings', 'Settings', 'settings'],
  ];

  return html`<div class="shell">
    <header class="topbar">
      <a class="brand" href="#/requests"><img src="/icon.svg" alt="" width="26" height="26" /><span class="serif">Leave desk</span></a>
      <nav class="tabs" aria-label="Sections">
        ${nav.map(([k, label, icon, badge]) => html`<a href="#/${k}" class="tab" aria-current=${section === k ? 'page' : undefined}><${Icon} name=${icon} /><span>${label}</span>${badge ? html`<b class="badge" aria-label="${badge} waiting">${badge}</b>` : ''}</a>`)}
      </nav>
      <button class="btn small primary record-btn" onClick=${() => setDialog({ kind: 'record' })}><${Icon} name="plus" /><span>Record leave</span></button>
    </header>
    ${!data.policy.confirmed && section !== 'settings' && html`<div class="notice">
      <p>Leave allowances are placeholders until you confirm them. Eligibility checks use whatever is set in Settings.</p>
      <a class="btn small" href="#/settings">Set allowances</a>
    </div>`}
    <main class="main">
      ${section === 'requests' && html`<${RequestsView} ctx=${ctx} selectedId=${route[1] ? Number(route[1]) : null} />`}
      ${section === 'people' && !route[1] && html`<${PeopleView} ctx=${ctx} />`}
      ${section === 'people' && route[1] && html`<${PersonView} ctx=${ctx} id=${Number(route[1])} />`}
      ${section === 'calendar' && html`<${CalendarView} ctx=${ctx} />`}
      ${section === 'settings' && html`<${SettingsView} ctx=${ctx} />`}
    </main>
    ${dialog?.kind === 'record' && html`<${RecordDialog} ctx=${ctx} employeeId=${dialog.employeeId} onClose=${() => setDialog(null)} />`}
    ${dialog?.kind === 'person' && html`<${PersonDialog} ctx=${ctx} employee=${dialog.employee} onClose=${() => setDialog(null)} />`}
    ${toast && html`<div class="toast" role="status">${toast}</div>`}
  </div>`;
}

// ---------------------------------------------------------------- requests
const REQ_FILTERS = [
  ['pending', 'Waiting'],
  ['approved', 'Approved'],
  ['declined', 'Declined'],
  ['all', 'All'],
];
function RequestsView({ ctx, selectedId }) {
  const [filter, setFilter] = useState('pending');
  const [q, setQ] = useState('');
  const { requests, byId, policy, today } = ctx;
  const counts = useMemo(() => {
    const c = { all: requests.length };
    for (const r of requests) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [requests]);
  const list = useMemo(() => {
    let l = requests.filter((r) => filter === 'all' || r.status === filter);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      l = l.filter((r) => (byId[r.employee_id]?.name || '').toLowerCase().includes(s) || (byId[r.employee_id]?.department || '').toLowerCase().includes(s) || r.ref.toLowerCase() === s);
    }
    if (filter === 'pending') l = [...l].sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
    return l;
  }, [requests, filter, q, byId]);
  const selected = selectedId ? requests.find((r) => r.id === selectedId) : null;

  return html`<div class="requests ${selected ? 'has-selection' : ''}">
    <section class="req-list" aria-label="Requests">
      <div class="list-head">
        <h1 class="serif page-title">Requests</h1>
        <div class="seg" role="group" aria-label="Filter requests">
          ${REQ_FILTERS.map(([k, l]) => html`<button aria-pressed=${filter === k} onClick=${() => setFilter(k)}>${l}${counts[k] ? html` <span class="muted num">${counts[k]}</span>` : ''}</button>`)}
        </div>
        <label class="search"><${Icon} name="search" /><span class="visually-hidden">Search requests</span><input class="input" type="search" placeholder="Search by name, department or reference" value=${q} onInput=${(e) => setQ(e.target.value)} /></label>
      </div>
      ${list.length === 0
        ? html`<div class="empty">
            ${filter === 'pending'
              ? html`<p class="serif">Nothing waiting for a decision.</p><p class="muted">New requests from the leave form appear here.</p><${CopyFormLink} ctx=${ctx} />`
              : html`<p class="muted">No requests match.</p>`}
          </div>`
        : html`<ul class="rows" role="list">
            ${list.map((r) => {
              const emp = byId[r.employee_id];
              if (!emp) return null;
              const a = r.status === 'pending' ? assess(r, emp, requests, policy, today) : null;
              return html`<li>
                <a class="row ${r.id === selectedId ? 'selected' : ''}" href="#/requests/${r.id}" aria-current=${r.id === selectedId ? 'true' : undefined}>
                  <span class="avatar" aria-hidden="true">${initials(emp.name)}</span>
                  <span class="row-main">
                    <span class="row-name">${emp.name}</span>
                    <span class="row-sub"><${TypeLabel} type=${r.type} short /> <span class="num">${prettyRange(r.start_date, r.end_date)}</span></span>
                  </span>
                  <span class="row-end">
                    <span class="row-days num">${plural(countDays(r.start_date, r.end_date, policy), 'day')}</span>
                    ${a ? html`<span class="chip ${a.verdict}">${VERDICT_LABEL[a.verdict]}</span>` : html`<${StatusChip} status=${r.status} />`}
                  </span>
                </a>
              </li>`;
            })}
          </ul>`}
    </section>
    <section class="review-pane" aria-label="Request details">
      ${selected && byId[selected.employee_id]
        ? html`<${Review} ctx=${ctx} request=${selected} key=${selected.id} />`
        : html`<div class="review-empty"><${Icon} name="inbox" /><p>Choose a request to see whether they’re eligible.</p></div>`}
    </section>
  </div>`;
}

function Review({ ctx, request: r }) {
  const { byId, requests, policy, today, employees } = ctx;
  const emp = byId[r.employee_id];
  const [note, setNote] = useState(r.decision_note || '');
  const [busy, setBusy] = useState(false);
  const a = assess(r, emp, requests, policy, today);
  const mine = requests.filter((x) => x.employee_id === emp.id);
  const used = usage(mine, policy, { excludeId: r.id });
  const askDates = leaveDates(r.start_date, r.end_date, policy);
  const year = Number(r.start_date.slice(0, 4));
  const ym = r.start_date.slice(0, 7);
  const gp = policy[a.group];
  const askInMonth = askDates.filter((d) => d.startsWith(ym)).length;
  const askInYear = askDates.filter((d) => d.startsWith(String(year))).length;
  const last = mine.filter((x) => x.id !== r.id && x.status === 'approved' && x.start_date <= today).sort((p, q) => (p.start_date < q.start_date ? 1 : -1))[0];
  const history = mine.filter((x) => x.id !== r.id).sort((p, q) => (p.start_date < q.start_date ? 1 : -1)).slice(0, 6);
  const teamOff = requests.filter((x) => x.id !== r.id && x.employee_id !== emp.id && ['approved', 'pending'].includes(x.status) && x.start_date <= r.end_date && x.end_date >= r.start_date && byId[x.employee_id]?.department === emp.department);
  const deptSize = employees.filter((e) => e.active && e.department === emp.department).length;

  const decide = async (status) => {
    setBusy(true);
    try {
      const { request } = await api(`/api/requests/${r.id}`, { method: 'PATCH', body: { status, decision_note: note } });
      ctx.updateRequest(request);
      ctx.toast(status === 'approved' ? `Approved ${firstLast(emp.name)}’s leave` : status === 'declined' ? 'Request declined' : status === 'cancelled' ? 'Leave cancelled' : 'Moved back to waiting');
      if (status !== 'pending' && r.status === 'pending') {
        const nextPending = requests.filter((x) => x.status === 'pending' && x.id !== r.id).sort((p, q) => (p.start_date < q.start_date ? -1 : 1))[0];
        if (nextPending && matchMedia('(min-width: 1000px)').matches) go(`requests/${nextPending.id}`);
      }
    } catch (e) {
      ctx.toast(e.message);
    }
    setBusy(false);
  };
  const remove = async () => {
    if (!confirm('Delete this request permanently? This can’t be undone.')) return;
    await api(`/api/requests/${r.id}`, { method: 'DELETE' });
    ctx.removeRequest(r.id);
    ctx.toast('Request deleted');
    go('requests');
  };

  return html`<article class="review">
    <a class="back-link" href="#/requests"><${Icon} name="back" />All requests</a>
    <header class="review-head">
      <div>
        <h2 class="serif person-name"><a href="#/people/${emp.id}">${emp.name}</a></h2>
        <p class="meta">${emp.department || 'No department'} <${GroupChip} group=${a.group} /> ${emp.its_id && html`<span class="muted num">ITS ${emp.its_id}</span>`}</p>
      </div>
      <${StatusChip} status=${r.status} />
    </header>

    <div class="ask">
      <p class="ask-type"><${TypeLabel} type=${r.type} /></p>
      <p class="ask-dates serif num">${prettyRange(r.start_date, r.end_date)}</p>
      <p class="ask-meta">${plural(a.days, 'day')}${!policy.countFridays ? ', Fridays not counted' : ''}. ${r.source === 'admin' ? 'Recorded by admin' : 'Sent from the leave form'} on ${prettyDate(iraqDateOf(r.submitted_at))}. Ref ${r.ref}</p>
      ${r.reason && html`<blockquote class="reason">${r.reason}</blockquote>`}
      ${r.contact && html`<p class="hint">Phone: <a href="tel:${r.contact}">${r.contact}</a></p>`}
    </div>

    <section class="verdict ${a.verdict}" aria-live="polite">
      <p class="verdict-label">${VERDICT_LABEL[a.verdict]}</p>
      <p class="verdict-head">${a.headline}</p>
      <ul>${a.lines.map((l) => html`<li>${l}</li>`)}</ul>
      ${a.checks.length > 0 && html`<ul class="checks">${a.checks.map((c) => html`<li class=${c.tone}>${c.text}</li>`)}</ul>`}
    </section>

    <section class="balances">
      <${Meter} type="monthly" label="Days off in ${MONTHS[Number(ym.slice(5)) - 1]}" used=${used.month.monthly?.[ym] || 0} ask=${r.type === 'monthly' ? askInMonth : 0} cap=${Number(gp.monthly) || 0} />
      <${Meter} type="annual" label="Annual leave in ${year}" used=${used.year.annual?.[year] || 0} ask=${r.type === 'annual' ? askInYear : 0} cap=${Number(gp.annual) || 0}
        note=${policy.annualMode === 'accrual' ? `${annualAllowanceAt(gp, policy, Number(r.start_date.slice(5, 7)))} earned by ${MONTHS[Number(r.start_date.slice(5, 7)) - 1]}` : null} />
      <div class="facts">
        <div><span class="hint">Last leave</span><span>${last ? prettyRange(last.start_date, last.end_date) : 'None this year'}</span></div>
        <div><span class="hint">All leave in ${year}</span><span class="num">${plural(Object.values(used.year).reduce((s, t) => s + (t[year] || 0), 0), 'day')}</span></div>
      </div>
    </section>

    <section class="block">
      <h3 class="block-title">${year} at a glance</h3>
      <${Ribbon} year=${year} dates=${used.dates} ask=${new Set(askDates)} askType=${r.type} today=${today} />
      <${RibbonLegend} withAsk />
    </section>

    <section class="block">
      <h3 class="block-title">Also off in ${emp.department || 'their department'}</h3>
      ${teamOff.length === 0
        ? html`<p class="muted">Nobody else in ${emp.department || 'the department'} is off on these dates.</p>`
        : html`<p class="hint">${teamOff.length} of ${deptSize} people overlap with these dates.</p>
          <ul class="mini-list">${teamOff.map((x) => html`<li><a href="#/people/${x.employee_id}">${byId[x.employee_id].name}</a><span class="muted num">${prettyRange(x.start_date, x.end_date)}</span>${x.status === 'pending' ? html`<span class="chip pending">Waiting</span>` : ''}</li>`)}</ul>`}
    </section>

    ${history.length > 0 && html`<section class="block">
      <h3 class="block-title">Their other requests</h3>
      <ul class="mini-list">${history.map((x) => html`<li><a href="#/requests/${x.id}"><${TypeLabel} type=${x.type} short /></a><span class="num">${prettyRange(x.start_date, x.end_date)}</span><span class="muted num">${plural(countDays(x.start_date, x.end_date, policy), 'day')}</span><${StatusChip} status=${x.status} /></li>`)}</ul>
    </section>`}

    <footer class="decide">
      ${r.status === 'pending'
        ? html`<label class="field"><span class="visually-hidden">Note to staff member</span><input class="input" placeholder="Note for them (optional)" value=${note} onInput=${(e) => setNote(e.target.value)} /></label>
          <div class="decide-actions">
            <button class="btn decline" disabled=${busy} onClick=${() => decide('declined')}><${Icon} name="x" />Decline</button>
            <button class="btn approve" disabled=${busy} onClick=${() => decide('approved')}><${Icon} name="check" />Approve</button>
          </div>`
        : html`<p class="decided">${STATUS_LABEL[r.status]}${r.decided_at ? ` on ${prettyDate(iraqDateOf(r.decided_at))}` : ''}${r.decision_note ? html`. Note: “${r.decision_note}”` : ''}</p>
          <div class="decide-actions">
            <button class="btn ghost small" onClick=${remove}>Delete</button>
            ${r.status === 'approved' && html`<button class="btn small decline" disabled=${busy} onClick=${() => decide('cancelled')}>Cancel leave</button>`}
            <button class="btn small" disabled=${busy} onClick=${() => decide('pending')}>Move back to waiting</button>
          </div>`}
    </footer>
  </article>`;
}

function CopyFormLink({ ctx }) {
  const url = `${location.origin}/apply`;
  return html`<div class="form-link">
    <code>${url}</code>
    <button class="btn small" onClick=${async () => {
      try {
        await navigator.clipboard.writeText(url);
        ctx.toast('Form link copied');
      } catch {
        ctx.toast(url);
      }
    }}><${Icon} name="copy" />Copy link</button>
  </div>`;
}

// ---------------------------------------------------------------- people
function PeopleView({ ctx }) {
  const { employees, requests, policy, today } = ctx;
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [dept, setDept] = useState('');
  const [sort, setSort] = useState('name');
  const [showInactive, setShowInactive] = useState(false);
  const depts = useMemo(() => [...new Set(employees.map((e) => e.department).filter(Boolean))].sort(), [employees]);
  const rows = useMemo(() => {
    let l = employees.filter((e) => (showInactive || e.active) && (group === 'all' || groupOf(e) === group) && (!dept || e.department === dept));
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      l = l.filter((e) => e.name.toLowerCase().includes(s) || String(e.its_id || '').includes(s));
    }
    const withSnap = l.map((e) => ({ e, s: snapshot(e, requests, policy, today) }));
    if (sort === 'most') withSnap.sort((a, b) => b.s.totalYear - a.s.totalYear);
    if (sort === 'dept') withSnap.sort((a, b) => (a.e.department || '').localeCompare(b.e.department || '') || a.e.name.localeCompare(b.e.name));
    return withSnap;
  }, [employees, requests, policy, q, group, dept, sort, showInactive]);
  const counts = useMemo(() => {
    const act = employees.filter((e) => e.active);
    return { all: act.length, iraqi: act.filter((e) => groupOf(e) === 'iraqi').length, foreign: act.filter((e) => groupOf(e) === 'foreign').length };
  }, [employees]);
  const offToday = rows.filter((x) => x.s.onLeave).length;
  const monthName = MONTHS[Number(today.slice(5, 7)) - 1];

  return html`<div class="page">
    <div class="page-head">
      <div>
        <h1 class="serif page-title">People</h1>
        <p class="muted">${counts.all} active staff. ${offToday ? `${offToday} on leave today.` : 'Nobody on leave today.'}</p>
      </div>
      <button class="btn" onClick=${() => ctx.openDialog({ kind: 'person' })}><${Icon} name="plus" />Add person</button>
    </div>
    <div class="filters">
      <label class="search"><${Icon} name="search" /><span class="visually-hidden">Search people</span><input class="input" type="search" placeholder="Search by name or ITS ID" value=${q} onInput=${(e) => setQ(e.target.value)} /></label>
      <div class="seg" role="group" aria-label="Staff group">
        ${['all', 'iraqi', 'foreign'].map((g) => html`<button aria-pressed=${group === g} onClick=${() => setGroup(g)}>${g === 'all' ? 'Everyone' : GROUPS[g].label} <span class="muted num">${counts[g]}</span></button>`)}
      </div>
      <select class="input auto" aria-label="Department" value=${dept} onChange=${(e) => setDept(e.target.value)}>
        <option value="">All departments</option>
        ${depts.map((d) => html`<option value=${d}>${d}</option>`)}
      </select>
      <select class="input auto" aria-label="Sort" value=${sort} onChange=${(e) => setSort(e.target.value)}>
        <option value="name">Sort by name</option>
        <option value="dept">Sort by department</option>
        <option value="most">Most leave this year</option>
      </select>
      <label class="toggle compact"><input type="checkbox" checked=${showInactive} onChange=${(e) => setShowInactive(e.target.checked)} /><span>Show inactive</span></label>
    </div>
    <div class="table-wrap panel">
      <table class="people">
        <thead><tr>
          <th scope="col">Name</th>
          <th scope="col">Group</th>
          <th scope="col">Days off in ${monthName}</th>
          <th scope="col">Annual leave ${today.slice(0, 4)}</th>
          <th scope="col">Last leave</th>
          <th scope="col">Now</th>
        </tr></thead>
        <tbody>
          ${rows.map(({ e, s }) => html`<tr class=${e.active ? '' : 'inactive'} onClick=${() => go(`people/${e.id}`)}>
            <td><a href="#/people/${e.id}" class="p-name">${e.name}</a><span class="p-dept">${e.department || ''}</span></td>
            <td><${GroupChip} group=${s.group} /></td>
            <td><${MiniMeter} used=${s.monthUsed} cap=${s.monthCap} type="monthly" /></td>
            <td><${MiniMeter} used=${s.yearUsed} cap=${s.yearCap} type="annual" /></td>
            <td class="num">${s.last ? prettyDate(s.last.end_date) : html`<span class="muted">None yet</span>`}</td>
            <td>${s.onLeave
              ? html`<span class="chip approved">Off until ${prettyDate(s.onLeave.end_date, false)}</span>`
              : s.pending
                ? html`<span class="chip pending">${s.pending} waiting</span>`
                : s.next
                  ? html`<span class="muted num">Next off ${prettyDate(s.next.start_date, false)}</span>`
                  : html`<span class="muted">At work</span>`}</td>
          </tr>`)}
        </tbody>
      </table>
      ${rows.length === 0 && html`<p class="empty muted">Nobody matches these filters.</p>`}
    </div>
  </div>`;
}
const MiniMeter = ({ used, cap, type }) => html`<span class="mini-meter t-${type}">
  <span class="num">${used}<span class="muted">/${cap}</span></span>
  <span class="bar"><i class=${used > cap ? 'over' : ''} style="width:${cap ? Math.min(100, (used / cap) * 100) : used ? 100 : 0}%"></i></span>
</span>`;

function PersonView({ ctx, id }) {
  const { byId, requests, policy, today } = ctx;
  const emp = byId[id];
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  if (!emp) return html`<div class="page"><p>That person isn’t in the list. <a href="#/people">Back to people</a></p></div>`;
  const s = snapshot(emp, requests, policy, today);
  const mine = requests.filter((r) => r.employee_id === id).sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
  const yearReqs = mine.filter((r) => r.start_date.slice(0, 4) <= String(year) && r.end_date.slice(0, 4) >= String(year));
  const u = usage(mine, policy);
  const pendingDates = new Set(mine.filter((r) => r.status === 'pending').flatMap((r) => leaveDates(r.start_date, r.end_date, policy)));
  const byType = Object.keys(LEAVE_TYPES).map((t) => [t, u.year[t]?.[year] || 0]);
  const gp = policy[s.group];

  return html`<div class="page person">
    <a class="back-link" href="#/people"><${Icon} name="back" />People</a>
    <div class="page-head">
      <div>
        <h1 class="serif person-title">${emp.name}</h1>
        <p class="meta">${emp.department || 'No department'} <${GroupChip} group=${s.group} />
          ${emp.its_id && html`<span class="muted num">ITS ${emp.its_id}</span>`}
          ${emp.currency && html`<span class="muted">Paid in ${emp.currency}${emp.group_override ? ', group set by hand' : ''}</span>`}
          ${!emp.active && html`<span class="chip cancelled">Inactive</span>`}</p>
      </div>
      <div class="head-actions">
        <button class="btn" onClick=${() => ctx.openDialog({ kind: 'person', employee: emp })}><${Icon} name="edit" />Edit details</button>
        <button class="btn primary" onClick=${() => ctx.openDialog({ kind: 'record', employeeId: emp.id })}><${Icon} name="plus" />Record leave</button>
      </div>
    </div>

    <div class="stat-row panel">
      <${Meter} type="monthly" label="Days off in ${MONTHS[Number(today.slice(5, 7)) - 1]}" used=${s.monthUsed} cap=${s.monthCap}
        note=${s.monthUsed >= s.monthCap ? `Resets ${prettyDate(addDays(`${today.slice(0, 7)}-01`, daysInMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1)))}` : `${s.monthCap - s.monthUsed} left this month`} />
      <${Meter} type="annual" label="Annual leave ${today.slice(0, 4)}" used=${s.yearUsed} cap=${s.yearCap}
        note=${policy.annualMode === 'accrual' ? `${s.yearEarned} earned so far` : `${Math.max(0, s.yearCap - s.yearUsed)} left this year`} />
      ${s.sickCap != null
        ? html`<${Meter} type="sick" label="Sick leave ${today.slice(0, 4)}" used=${s.sickUsed} cap=${s.sickCap} />`
        : html`<div class="meter"><div class="meter-row"><span class="label">Sick leave ${today.slice(0, 4)}</span><span class="val num">${s.sickUsed}</span></div><span class="hint">No limit set</span></div>`}
      <div class="facts">
        <div><span class="hint">Last leave</span><span>${s.last ? prettyRange(s.last.start_date, s.last.end_date) : 'None yet'}</span></div>
        <div><span class="hint">Next leave</span><span>${s.onLeave ? `On leave until ${prettyDate(s.onLeave.end_date)}` : s.next ? prettyRange(s.next.start_date, s.next.end_date) : 'Nothing booked'}</span></div>
      </div>
    </div>

    <section class="panel block-pad">
      <div class="block-head">
        <h2 class="block-title">Leave in ${year}</h2>
        <div class="year-nav">
          <button class="btn ghost small" aria-label="Previous year" onClick=${() => setYear(year - 1)}><${Icon} name="back" /></button>
          <span class="num">${year}</span>
          <button class="btn ghost small" aria-label="Next year" onClick=${() => setYear(year + 1)}><${Icon} name="next" /></button>
        </div>
      </div>
      <${Ribbon} year=${year} dates=${u.dates} ask=${pendingDates} today=${today} />
      <div class="legend">
        ${byType.map(([t, n]) => html`<span><i class="sw t-${t}"></i>${LEAVE_TYPES[t].short} <b class="num">${n}</b></span>`)}
        ${pendingDates.size > 0 && html`<span><i class="sw ask"></i>Waiting for a decision</span>`}
      </div>
    </section>

    <section class="panel block-pad">
      <h2 class="block-title">Requests in ${year}</h2>
      ${yearReqs.length === 0
        ? html`<p class="muted">No leave recorded in ${year}.</p>`
        : html`<ul class="mini-list big">${yearReqs.map((x) => html`<li>
            <a href="#/requests/${x.id}"><${TypeLabel} type=${x.type} /></a>
            <span class="num">${prettyRange(x.start_date, x.end_date)}</span>
            <span class="muted num">${plural(countDays(x.start_date, x.end_date, policy), 'day')}</span>
            <${StatusChip} status=${x.status} />
          </li>`)}</ul>`}
    </section>
  </div>`;
}

function PersonDialog({ ctx, employee, onClose }) {
  const isNew = !employee;
  const [f, setF] = useState(employee ? { ...employee, its_id: employee.its_id || '', department: employee.department || '', currency: employee.currency || '', group_override: employee.group_override || '' } : { name: '', its_id: '', department: '', currency: 'IQD', group_override: '', active: 1 });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const depts = [...new Set(ctx.employees.map((e) => e.department).filter(Boolean))].sort();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value });
  const autoGroup = groupOf({ currency: f.currency });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: f.name, its_id: f.its_id, department: f.department, currency: f.currency, group_override: f.group_override || null, active: !!f.active };
      const { employee: row } = await api(isNew ? '/api/employees' : `/api/employees/${employee.id}`, { method: isNew ? 'POST' : 'PATCH', body });
      ctx.updateEmployee(row);
      ctx.toast(isNew ? `Added ${row.name}` : 'Details saved');
      onClose();
      if (isNew) go(`people/${row.id}`);
    } catch (x) {
      setErr(x.message);
      setBusy(false);
    }
  };
  return html`<${Dialog} title=${isNew ? 'Add a person' : 'Edit details'} onClose=${onClose}>
    <form class="form-grid" onSubmit=${save}>
      <div class="field"><label for="pn">Full name</label><input id="pn" class="input" value=${f.name} onInput=${set('name')} required /></div>
      <div class="two">
        <div class="field"><label for="pi">ITS ID</label><input id="pi" class="input" inputmode="numeric" value=${f.its_id} onInput=${set('its_id')} /></div>
        <div class="field"><label for="pc">Paid in</label>
          <select id="pc" class="input" value=${f.currency} onChange=${set('currency')}>
            ${['IQD', 'INR', 'USD', 'PKR', 'BDT', 'Other'].map((c) => html`<option value=${c}>${c}</option>`)}
          </select></div>
      </div>
      <div class="field"><label for="pd">Department</label><input id="pd" class="input" list="dept-list" value=${f.department} onInput=${set('department')} />
        <datalist id="dept-list">${depts.map((d) => html`<option value=${d} />`)}</datalist></div>
      <div class="field"><label for="pg">Leave rules</label>
        <select id="pg" class="input" value=${f.group_override} onChange=${set('group_override')}>
          <option value="">Automatic from pay currency (${GROUPS[autoGroup].label})</option>
          <option value="iraqi">Always Iraqi</option>
          <option value="foreign">Always foreign</option>
        </select>
        <span class="hint">Pay in IQD means Iraqi rules. Any other currency means foreign rules.</span></div>
      ${!isNew && html`<label class="toggle"><input type="checkbox" checked=${!!f.active} onChange=${set('active')} /><span><b>Active</b><br /><span class="hint">Inactive people are hidden from the leave form. Their history is kept.</span></span></label>`}
      ${err && html`<p class="form-error" role="alert">${err}</p>`}
      <div class="dialog-actions"><button type="button" class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy}>${isNew ? 'Add person' : 'Save details'}</button></div>
    </form>
  </${Dialog}>`;
}

// ---------------------------------------------------------------- record leave (admin entry)
function RecordDialog({ ctx, employeeId, onClose }) {
  const { employees, requests, policy, today, byId } = ctx;
  const [f, setF] = useState({ employeeId: employeeId || '', type: 'monthly', start: today, end: today, reason: '', status: 'approved' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => {
    const v = e.target.value;
    setF((p) => {
      const n = { ...p, [k]: v };
      if (k === 'start' && (!p.end || p.end < v)) n.end = v;
      return n;
    });
  };
  const grouped = useMemo(() => {
    const g = {};
    for (const e of employees.filter((e) => e.active)) (g[e.department || 'Other'] ||= []).push(e);
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
  }, [employees]);
  const emp = byId[Number(f.employeeId)];
  const preview = emp && f.start && f.end && f.end >= f.start ? assess({ id: -1, employee_id: emp.id, type: f.type, start_date: f.start, end_date: f.end, status: 'pending', source: 'admin' }, emp, requests, policy, today) : null;
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { request } = await api('/api/requests', { method: 'POST', body: { ...f, employeeId: Number(f.employeeId) } });
      ctx.updateRequest(request);
      ctx.toast(f.status === 'approved' ? `Recorded leave for ${firstLast(emp.name)}` : 'Added to waiting requests');
      onClose();
    } catch (x) {
      setErr(x.message);
      setBusy(false);
    }
  };
  return html`<${Dialog} title="Record leave" onClose=${onClose} wide>
    <form class="form-grid" onSubmit=${save}>
      <p class="muted">For leave agreed in person or by phone. It counts towards their allowance straight away.</p>
      <div class="field"><label for="re">Person</label>
        <select id="re" class="input" value=${f.employeeId} onChange=${set('employeeId')} required>
          <option value="" disabled>Choose a person</option>
          ${grouped.map(([d, list]) => html`<optgroup label=${d}>${list.map((e) => html`<option value=${e.id}>${e.name}</option>`)}</optgroup>`)}
        </select></div>
      <div class="field"><span class="label">Leave type</span>
        <div class="type-pick">${Object.keys(LEAVE_TYPES).map((t) => html`<label class="type-opt t-${t}"><input type="radio" name="rt" value=${t} checked=${f.type === t} onChange=${set('type')} /><span class="dot t-${t}"></span>${LEAVE_TYPES[t].label}</label>`)}</div></div>
      <div class="two">
        <div class="field"><label for="rs">From</label><input id="rs" type="date" class="input" value=${f.start} onInput=${set('start')} required /></div>
        <div class="field"><label for="rd">To</label><input id="rd" type="date" class="input" min=${f.start} value=${f.end} onInput=${set('end')} required /></div>
      </div>
      <div class="field"><label for="rr">Reason (optional)</label><input id="rr" class="input" value=${f.reason} onInput=${set('reason')} /></div>
      <div class="field"><span class="label">Status</span>
        <div class="seg" role="group">
          <button type="button" aria-pressed=${f.status === 'approved'} onClick=${() => setF({ ...f, status: 'approved' })}>Approved</button>
          <button type="button" aria-pressed=${f.status === 'pending'} onClick=${() => setF({ ...f, status: 'pending' })}>Waiting for a decision</button>
        </div></div>
      ${preview && html`<div class="verdict compact ${preview.verdict}"><p class="verdict-label">${VERDICT_LABEL[preview.verdict]}, ${plural(preview.days, 'day')}</p><p>${preview.headline}</p>${preview.checks.filter((c) => c.tone === 'warn').map((c) => html`<p class="hint">${c.text}</p>`)}</div>`}
      ${err && html`<p class="form-error" role="alert">${err}</p>`}
      <div class="dialog-actions"><button type="button" class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy || !emp}>Record leave</button></div>
    </form>
  </${Dialog}>`;
}

// ---------------------------------------------------------------- calendar
function CalendarView({ ctx }) {
  const { requests, byId, policy, today, employees } = ctx;
  const [ym, setYm] = useState(today.slice(0, 7));
  const [dept, setDept] = useState('');
  const [showPending, setShowPending] = useState(true);
  const [sel, setSel] = useState(today);
  const [y, m] = ym.split('-').map(Number);
  const depts = useMemo(() => [...new Set(employees.map((e) => e.department).filter(Boolean))].sort(), [employees]);
  const days = useMemo(() => {
    const map = {};
    const first = `${ym}-01`, last = `${ym}-${String(daysInMonth(y, m - 1)).padStart(2, '0')}`;
    for (const r of requests) {
      if (!(r.status === 'approved' || (showPending && r.status === 'pending'))) continue;
      if (r.end_date < first || r.start_date > last) continue;
      const e = byId[r.employee_id];
      if (!e || (dept && e.department !== dept)) continue;
      for (const d of leaveDates(r.start_date, r.end_date, policy)) if (d >= first && d <= last) (map[d] ||= []).push({ r, e });
    }
    return map;
  }, [requests, ym, dept, showPending, policy]);
  const shift = (n) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setYm(fmt(d.getTime()).slice(0, 7));
  };
  // Week starts on Saturday.
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 1) % 7;
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth(y, m - 1); d++) cells.push(`${ym}-${String(d).padStart(2, '0')}`);
  const selList = days[sel] || [];

  return html`<div class="page">
    <div class="page-head">
      <div>
        <h1 class="serif page-title">${MONTHS[m - 1]} ${y}</h1>
        <p class="muted">Who is off each day.</p>
      </div>
      <div class="head-actions">
        <button class="btn" aria-label="Previous month" onClick=${() => shift(-1)}><${Icon} name="back" /></button>
        <button class="btn" onClick=${() => { setYm(today.slice(0, 7)); setSel(today); }}>Today</button>
        <button class="btn" aria-label="Next month" onClick=${() => shift(1)}><${Icon} name="next" /></button>
      </div>
    </div>
    <div class="filters">
      <select class="input auto" aria-label="Department" value=${dept} onChange=${(e) => setDept(e.target.value)}>
        <option value="">All departments</option>
        ${depts.map((d) => html`<option value=${d}>${d}</option>`)}
      </select>
      <label class="toggle compact"><input type="checkbox" checked=${showPending} onChange=${(e) => setShowPending(e.target.checked)} /><span>Include waiting requests</span></label>
    </div>
    <div class="cal-wrap">
      <div class="cal panel" role="grid" aria-label="${MONTHS[m - 1]} ${y}">
        ${['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => html`<div class="cal-dow" role="columnheader">${d}</div>`)}
        ${cells.map((d) => {
          if (!d) return html`<div class="cal-cell blank"></div>`;
          const list = days[d] || [];
          return html`<button class="cal-cell ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''} ${d < today ? 'past' : ''}" onClick=${() => setSel(d)} aria-label="${prettyDate(d)}: ${list.length} off">
            <span class="cal-num">${Number(d.slice(8))}</span>
            ${list.length > 0 && html`<span class="cal-count num">${list.length} off</span>`}
            <span class="cal-names">${list.slice(0, 3).map(({ r, e }) => html`<span class="cal-name t-${r.type} ${r.status}" title=${e.name}>${firstLast(e.name)}</span>`)}${list.length > 3 && html`<span class="cal-more">${list.length - 3} more</span>`}</span>
          </button>`;
        })}
      </div>
      <aside class="panel block-pad cal-side">
        <h2 class="block-title">${prettyDate(sel)}</h2>
        ${selList.length === 0
          ? html`<p class="muted">Nobody is off.</p>`
          : html`<ul class="mini-list">${selList.map(({ r, e }) => html`<li><a href="#/requests/${r.id}">${e.name}</a><span class="muted">${e.department}</span><${TypeLabel} type=${r.type} short />${r.status === 'pending' && html`<span class="chip pending">Waiting</span>`}</li>`)}</ul>`}
      </aside>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- settings
function NumberField({ id, label, value, onChange, optional }) {
  return html`<div class="field num-field">
    <label for=${id}>${label}</label>
    <div class="stepper">
      <button type="button" class="btn small" aria-label="Fewer" onClick=${() => onChange(Math.max(0, (Number(value) || 0) - 1))}>−</button>
      <input id=${id} class="input num" type="number" min="0" max="366" inputmode="numeric" placeholder=${optional ? 'No limit' : ''} value=${value ?? ''}
        onInput=${(e) => onChange(e.target.value === '' ? (optional ? null : 0) : Number(e.target.value))} />
      <button type="button" class="btn small" aria-label="More" onClick=${() => onChange((Number(value) || 0) + 1)}>+</button>
    </div>
  </div>`;
}

function SettingsView({ ctx }) {
  const [p, setP] = useState(() => structuredClone(ctx.policy));
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwMsg, setPwMsg] = useState('');
  const dirty = JSON.stringify(p) !== JSON.stringify(ctx.policy);
  const counts = { iraqi: ctx.employees.filter((e) => e.active && groupOf(e) === 'iraqi').length, foreign: ctx.employees.filter((e) => e.active && groupOf(e) === 'foreign').length };
  const setG = (g, k) => (v) => setP({ ...p, [g]: { ...p[g], [k]: v } });
  const save = async () => {
    setBusy(true);
    try {
      const { policy } = await api('/api/settings', { method: 'PUT', body: { policy: p } });
      ctx.setPolicy(policy);
      setP(structuredClone(policy));
      ctx.toast('Allowances saved');
    } catch (e) {
      ctx.toast(e.message);
    }
    setBusy(false);
  };
  const changePw = async (e) => {
    e.preventDefault();
    try {
      await api('/api/password', { method: 'POST', body: pw });
      setPw({ current: '', next: '' });
      setPwMsg('Password changed. Other devices have been signed out.');
    } catch (x) {
      setPwMsg(x.message);
    }
  };

  return html`<div class="page settings">
    <div class="page-head"><h1 class="serif page-title">Settings</h1></div>

    <section class="panel block-pad">
      <div class="block-head">
        <div>
          <h2 class="block-title">Leave allowances</h2>
          <p class="muted">Used to work out whether each request is within allowance. You can still approve anything.</p>
        </div>
      </div>
      <div class="policy-grid">
        ${['iraqi', 'foreign'].map((g) => html`<div class="policy-card ${g}">
          <h3 class="serif">${GROUPS[g].label} staff</h3>
          <p class="hint">${counts[g]} people. ${g === 'iraqi' ? 'Paid in IQD.' : 'Paid in any other currency.'}</p>
          <${NumberField} id="${g}-m" label="Days off per month" value=${p[g].monthly} onChange=${setG(g, 'monthly')} />
          <${NumberField} id="${g}-a" label="Annual leave days per year" value=${p[g].annual} onChange=${setG(g, 'annual')} />
          <${NumberField} id="${g}-s" label="Sick leave days per year" value=${p[g].sick} onChange=${setG(g, 'sick')} optional />
          <p class="hint">Leave sick days empty if there’s no fixed limit.</p>
        </div>`)}
      </div>
      <div class="policy-rules">
        <div class="field">
          <span class="label">How annual leave becomes available</span>
          <div class="seg" role="group">
            <button aria-pressed=${p.annualMode === 'upfront'} onClick=${() => setP({ ...p, annualMode: 'upfront' })}>All of it from 1 January</button>
            <button aria-pressed=${p.annualMode === 'accrual'} onClick=${() => setP({ ...p, annualMode: 'accrual' })}>Earned month by month</button>
          </div>
          <span class="hint">${p.annualMode === 'accrual' ? 'One twelfth of the yearly allowance is earned each month. 30 days a year means 2.5 days by the end of January.' : 'The full yearly allowance can be used at any point in the year.'}</span>
        </div>
        <label class="toggle"><input type="checkbox" checked=${p.countFridays} onChange=${(e) => setP({ ...p, countFridays: e.target.checked })} />
          <span><b>Count Fridays as leave days</b><br /><span class="hint">Turn this off if Friday is already everyone’s day off. A Thursday to Saturday request would then count as 2 days.</span></span></label>
      </div>
      <div class="save-bar">
        ${!ctx.policy.confirmed && html`<span class="hint">These are placeholder numbers. Save to confirm them.</span>`}
        <button class="btn primary" disabled=${busy || (!dirty && ctx.policy.confirmed)} onClick=${save}>${busy ? 'Saving…' : 'Save allowances'}</button>
      </div>
    </section>

    <section class="panel block-pad">
      <h2 class="block-title">Leave form</h2>
      <p class="muted">Share this link with staff. It works on any phone, in English or Arabic.</p>
      <${CopyFormLink} ctx=${ctx} />
      <p><a href="/apply" target="_blank" rel="noopener">Open the form in a new tab</a></p>
    </section>

    <section class="panel block-pad">
      <h2 class="block-title">Records</h2>
      <p class="muted">Every request with its dates, day count and decision, as a spreadsheet.</p>
      <p><a class="btn" href="/api/export.csv"><${Icon} name="download" />Download CSV</a></p>
    </section>

    <section class="panel block-pad">
      <h2 class="block-title">Admin password</h2>
      <form class="pw-form" onSubmit=${changePw}>
        <div class="field"><label for="pw-c">Current password</label><input id="pw-c" class="input" type="password" autocomplete="current-password" value=${pw.current} onInput=${(e) => setPw({ ...pw, current: e.target.value })} required /></div>
        <div class="field"><label for="pw-n">New password</label><input id="pw-n" class="input" type="password" autocomplete="new-password" minlength="8" value=${pw.next} onInput=${(e) => setPw({ ...pw, next: e.target.value })} required /></div>
        <button class="btn">Change password</button>
      </form>
      ${pwMsg && html`<p class="hint" role="status">${pwMsg}</p>`}
      <p><button class="btn ghost small" onClick=${async () => { await api('/api/logout', { method: 'POST' }); location.reload(); }}><${Icon} name="logout" />Sign out</button></p>
    </section>
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
