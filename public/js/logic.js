// Shared leave rules. Imported by the Worker (validation) and the admin app (analysis).
// Dates are plain 'YYYY-MM-DD' strings and all math is done in UTC to avoid DST drift.

export const LEAVE_TYPES = {
  monthly: { label: 'Monthly day off', short: 'Day off' },
  annual: { label: 'Annual leave', short: 'Annual' },
  sick: { label: 'Sick leave', short: 'Sick' },
  other: { label: 'Other / emergency', short: 'Other' },
};

export const GROUPS = {
  iraqi: { label: 'Iraqi' },
  foreign: { label: 'Foreign' },
};

export const DEFAULT_POLICY = {
  iraqi: { monthly: 4, annual: 14, sick: null },
  foreign: { monthly: 2, annual: 30, sick: null },
  annualMode: 'upfront', // 'upfront' = full allowance from 1 Jan, 'accrual' = earned 1/12 each month
  countFridays: true, // false = Fridays inside a leave range are not counted
  confirmed: false, // flips to true the first time the admin saves settings
};

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

const DAY = 86400000;
export const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export const fmt = (t) => new Date(t).toISOString().slice(0, 10);
export const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(parse(s)) === s;
export const addDays = (s, n) => fmt(parse(s) + n * DAY);
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // m: 0-11
export const monthKey = (s) => s.slice(0, 7);

// Today's date in Iraq (UTC+3, no DST).
export const todayIraq = () => fmt(Date.now() + 3 * 3600000).slice(0, 10);
// Iraq calendar date of a stored UTC timestamp ('YYYY-MM-DD HH:MM:SS' from SQLite, or ISO).
export const iraqDateOf = (ts) => {
  if (!ts) return todayIraq();
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? ts.slice(0, 10) : fmt(t + 3 * 3600000);
};

export function groupOf(emp) {
  if (emp.group_override === 'iraqi' || emp.group_override === 'foreign') return emp.group_override;
  return String(emp.currency || '').trim().toUpperCase() === 'IQD' ? 'iraqi' : 'foreign';
}

export function mergePolicy(p) {
  const base = structuredClone(DEFAULT_POLICY);
  if (!p) return base;
  for (const g of ['iraqi', 'foreign']) base[g] = { ...base[g], ...(p[g] || {}) };
  for (const k of ['annualMode', 'countFridays', 'confirmed']) if (k in p) base[k] = p[k];
  return base;
}

// Every date a request covers that counts as a leave day.
export function leaveDates(start, end, policy) {
  const out = [];
  if (!isISODate(start) || !isISODate(end) || end < start) return out;
  for (let t = parse(start), e = parse(end); t <= e; t += DAY) {
    if (!policy.countFridays && new Date(t).getUTCDay() === 5) continue;
    out.push(fmt(t));
  }
  return out;
}
export const countDays = (start, end, policy) => leaveDates(start, end, policy).length;

// { 'YYYY-MM': n } and { 'YYYY': n }
function bucket(dates) {
  const byMonth = {}, byYear = {};
  for (const d of dates) {
    byMonth[d.slice(0, 7)] = (byMonth[d.slice(0, 7)] || 0) + 1;
    byYear[d.slice(0, 4)] = (byYear[d.slice(0, 4)] || 0) + 1;
  }
  return { byMonth, byYear };
}

// Usage for one employee, from their approved requests (optionally excluding one request).
export function usage(requests, policy, { excludeId, statuses = ['approved'] } = {}) {
  const u = { month: {}, year: {}, dates: {} }; // month[type][YYYY-MM], year[type][YYYY], dates[YYYY-MM-DD] = type
  for (const r of requests) {
    if (r.id === excludeId || !statuses.includes(r.status)) continue;
    const ds = leaveDates(r.start_date, r.end_date, policy);
    const { byMonth, byYear } = bucket(ds);
    u.month[r.type] ||= {};
    u.year[r.type] ||= {};
    for (const k in byMonth) u.month[r.type][k] = (u.month[r.type][k] || 0) + byMonth[k];
    for (const k in byYear) u.year[r.type][k] = (u.year[r.type][k] || 0) + byYear[k];
    for (const d of ds) u.dates[d] = r.type;
  }
  return u;
}

const nextMonthStart = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};

// Annual allowance available by a given month (1-12) under the policy's mode.
export function annualAllowanceAt(groupPolicy, policy, month) {
  const total = Number(groupPolicy.annual) || 0;
  if (policy.annualMode !== 'accrual') return total;
  return Math.floor(((total * month) / 12) * 2) / 2; // round down to half days
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const prettyDate = (s, withYear = true) => {
  if (!s) return '';
  const t = new Date(parse(s));
  return `${t.getUTCDate()} ${MONTHS_SHORT[t.getUTCMonth()]}${withYear ? ' ' + t.getUTCFullYear() : ''}`;
};
export const prettyRange = (a, b) => {
  if (a === b) return prettyDate(a);
  if (a.slice(0, 4) === b.slice(0, 4)) return `${prettyDate(a, false)} – ${prettyDate(b)}`;
  return `${prettyDate(a)} – ${prettyDate(b)}`;
};

/**
 * The eligibility verdict for one request.
 * Returns { verdict: 'eligible' | 'partial' | 'over' | 'open', headline, lines[], eligibleFrom?, days, checks[] }
 */
export function assess(request, employee, allRequests, policy, today = todayIraq()) {
  const group = groupOf(employee);
  const gp = policy[group];
  const mine = allRequests.filter((r) => r.employee_id === employee.id);
  const used = usage(mine, policy, { excludeId: request.id });
  const pendingOthers = mine.filter((r) => r.id !== request.id && r.status === 'pending');
  const dates = leaveDates(request.start_date, request.end_date, policy);
  const { byMonth, byYear } = bucket(dates);
  const days = dates.length;
  const lines = [];
  const checks = [];
  let verdict = 'eligible';
  let eligibleFrom = null;
  let headline = '';

  if (request.type === 'monthly') {
    const cap = Number(gp.monthly) || 0;
    let over = 0;
    for (const ym of Object.keys(byMonth).sort()) {
      const taken = used.month.monthly?.[ym] || 0;
      const left = Math.max(0, cap - taken);
      const want = byMonth[ym];
      const [y, m] = ym.split('-').map(Number);
      const name = `${MONTHS[m - 1]}${y !== Number(today.slice(0, 4)) ? ' ' + y : ''}`;
      if (want <= left) {
        lines.push(`${name}: ${taken} of ${cap} used, ${plural(left, 'day')} left. This needs ${want}.`);
      } else {
        over += want - left;
        lines.push(`${name}: ${taken} of ${cap} used, ${plural(left, 'day')} left. This needs ${want}, ${want - left} over.`);
        if (!eligibleFrom) eligibleFrom = nextMonthStart(ym);
      }
    }
    if (over === 0) headline = `Within the ${plural(cap, 'day')} a month allowed for ${GROUPS[group].label} staff.`;
    else {
      verdict = over >= days ? 'over' : 'partial';
      headline = `${plural(over, 'day')} over the monthly allowance.`;
      lines.push(`The allowance resets on ${prettyDate(eligibleFrom)}.`);
    }
  } else if (request.type === 'annual' || (request.type === 'sick' && gp.sick != null && gp.sick !== '')) {
    const isAnnual = request.type === 'annual';
    const total = Number(isAnnual ? gp.annual : gp.sick) || 0;
    let over = 0;
    for (const y of Object.keys(byYear).sort()) {
      const taken = used.year[request.type]?.[y] || 0;
      const want = byYear[y];
      const startMonth = y === request.start_date.slice(0, 4) ? Number(request.start_date.slice(5, 7)) : 1;
      const avail = isAnnual ? annualAllowanceAt(gp, policy, startMonth) : total;
      const left = Math.max(0, avail - taken);
      const accrualNote = isAnnual && policy.annualMode === 'accrual' ? ` (earned by ${MONTHS[startMonth - 1]}: ${avail} of ${total})` : '';
      lines.push(`${y}: ${taken} of ${total} used${accrualNote}, ${plural(left, 'day')} available. This needs ${want}.`);
      if (want > left) {
        over += want - left;
        // When could it be covered?
        if (!eligibleFrom) {
          if (isAnnual && policy.annualMode === 'accrual' && taken + want <= total) {
            for (let m = startMonth + 1; m <= 12; m++) {
              if (annualAllowanceAt(gp, policy, m) - taken >= want) {
                eligibleFrom = `${y}-${String(m).padStart(2, '0')}-01`;
                break;
              }
            }
          }
          eligibleFrom ||= `${Number(y) + 1}-01-01`;
        }
      }
    }
    const label = isAnnual ? 'annual leave' : 'sick leave';
    if (over === 0) headline = `Enough ${label} left under the ${GROUPS[group].label} staff allowance.`;
    else {
      verdict = over >= days ? 'over' : 'partial';
      headline = `${plural(over, 'day')} more than the ${label} available.`;
      lines.push(
        eligibleFrom.endsWith('-01-01')
          ? `The full allowance resets on ${prettyDate(eligibleFrom)}.`
          : `Enough will have been earned by ${prettyDate(eligibleFrom)}.`
      );
    }
  } else {
    verdict = 'open';
    headline = 'No allowance is set for this leave type. It’s your call.';
    const y = request.start_date.slice(0, 4);
    const taken = used.year[request.type]?.[y] || 0;
    lines.push(`${plural(taken, 'day')} of ${LEAVE_TYPES[request.type].label.toLowerCase()} approved so far in ${y}.`);
  }

  // Extra checks worth flagging.
  const clash = dates.filter((d) => used.dates[d]);
  if (clash.length) checks.push({ tone: 'warn', text: `Overlaps ${plural(clash.length, 'day')} of leave already approved.` });
  const pendClash = pendingOthers.filter((r) => r.start_date <= request.end_date && r.end_date >= request.start_date);
  if (pendClash.length) checks.push({ tone: 'warn', text: `Overlaps another pending request from them.` });
  if (request.status === 'pending' && request.start_date < today)
    checks.push({ tone: 'note', text: `Start date has already passed.` });
  const lead = Math.round((parse(request.start_date) - parse(iraqDateOf(request.submitted_at))) / DAY);
  if (request.source !== 'admin' && lead >= 0 && lead < 2) checks.push({ tone: 'note', text: lead === 0 ? 'Asked for the same day.' : 'Asked one day ahead.' });
  if (days === 0) checks.push({ tone: 'warn', text: 'No countable days in this range.' });

  return { verdict, headline, lines, eligibleFrom, days, group, checks };
}

// Snapshot numbers for an employee card.
export function snapshot(employee, allRequests, policy, today = todayIraq()) {
  const group = groupOf(employee);
  const gp = policy[group];
  const mine = allRequests.filter((r) => r.employee_id === employee.id);
  const u = usage(mine, policy);
  const ym = today.slice(0, 7), y = today.slice(0, 4);
  const approved = mine.filter((r) => r.status === 'approved').sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
  const past = approved.filter((r) => r.start_date <= today);
  const upcoming = approved.filter((r) => r.start_date > today).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const onLeave = approved.find((r) => r.start_date <= today && r.end_date >= today);
  const totalYear = Object.values(u.year).reduce((s, t) => s + (t[y] || 0), 0);
  return {
    group,
    monthUsed: u.month.monthly?.[ym] || 0,
    monthCap: Number(gp.monthly) || 0,
    yearUsed: u.year.annual?.[y] || 0,
    yearCap: Number(gp.annual) || 0,
    yearEarned: annualAllowanceAt(gp, policy, Number(today.slice(5, 7))),
    sickUsed: u.year.sick?.[y] || 0,
    sickCap: gp.sick == null || gp.sick === '' ? null : Number(gp.sick),
    totalYear,
    last: past[0] || null,
    next: upcoming[0] || null,
    onLeave: onLeave || null,
    pending: mine.filter((r) => r.status === 'pending').length,
    dates: u.dates,
  };
}

export function validateSubmission(body, policy) {
  const errors = [];
  if (!Number.isInteger(body.employeeId)) errors.push('Choose your name.');
  if (!LEAVE_TYPES[body.type]) errors.push('Choose a leave type.');
  if (!isISODate(body.start)) errors.push('Choose a start date.');
  if (!isISODate(body.end)) errors.push('Choose an end date.');
  if (isISODate(body.start) && isISODate(body.end)) {
    if (body.end < body.start) errors.push('The end date is before the start date.');
    else if (parse(body.end) - parse(body.start) > 120 * DAY) errors.push('Requests can cover at most 120 days.');
    else if (countDays(body.start, body.end, policy) === 0) errors.push('These dates contain no working days.');
  }
  if (body.reason && String(body.reason).length > 1000) errors.push('The reason is too long.');
  return errors;
}
