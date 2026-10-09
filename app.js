(() => {
  'use strict';

  const STORE_KEY = 'leclercq-data';
  const SESSION_KEY = 'leclercq-admin';
  const THEME_KEY = 'leclercq-theme';
  const published = window.JE_DATA;

  // ---------- Données ----------
  // La version publiée (data.js) est la référence. Les modifications faites dans
  // l'Espace liste sont gardées dans ce navigateur jusqu'à l'export de data.js.
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  };

  function loadData() {
    const raw = storage.get(STORE_KEY);
    if (raw) {
      try { return { ...clone(published), ...JSON.parse(raw) }; } catch { /* données corrompues */ }
    }
    return clone(published);
  }
  let data = loadData();
  let hasLocalChanges = !!storage.get(STORE_KEY);

  function save() {
    storage.set(STORE_KEY, JSON.stringify(data));
    hasLocalChanges = true;
    renderAll();
  }

  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euro = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
  const num = (n) => new Intl.NumberFormat('fr-FR').format(n || 0);

  // ---------- Dates ----------
  const parseDay = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayIso = isoDay(new Date());
  const fmtLong = (iso) => parseDay(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtShort = (iso) => parseDay(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const hours = (a, b) => (b ? `${a.replace(':', 'h')} – ${b.replace(':', 'h')}` : a.replace(':', 'h'));

  function campaignDays() {
    const start = parseDay(data.config.campaignStart);
    const n = Math.max(1, Number(data.config.campaignDays) || 14);
    return Array.from({ length: n }, (_, i) => isoDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
  }
  const byTime = (a, b) => (a.date + a.start).localeCompare(b.date + b.start);

  // ---------- Statuts ----------
  const STATUS = {
    dispo: { label: 'Disponible', cls: 'ok' },
    occupe: { label: 'Occupé·e', cls: 'warn' },
    pause: { label: 'En pause', cls: '' },
    absent: { label: 'Hors campus', cls: 'bad' },
  };
  function foodLevel(item) {
    const left = Math.max(0, (item.planned || 0) - (item.served || 0));
    const pct = item.planned ? left / item.planned : 0;
    const cls = left === 0 ? 'bad' : pct < 0.25 ? 'warn' : '';
    const label = left === 0 ? 'Épuisé' : pct < 0.25 ? 'Bientôt épuisé' : 'Disponible';
    return { left, pct, cls, label };
  }

  // ---------- Icônes ----------
  const ICON = {
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
  };

  // Couleur d'avatar stable par membre
  const AVATAR_COLORS = ['#E4402B', '#1F3A5F', '#2F6B4F', '#8A5A2B', '#5B3F8C', '#B23A6B', '#24617A', '#6B6B1F'];
  const avatarColor = (s) => AVATAR_COLORS[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR_COLORS.length];
  const initials = (name) => name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const wordmark = (name) => `${esc(name)}<i>.</i>`;

  // Horaires réels d'un créneau (gère les fins après minuit et l'absence d'heure de fin)
  function slot(item) {
    const [y, m, d] = item.date.split('-').map(Number);
    const [sh, sm] = (item.start || '00:00').split(':').map(Number);
    const start = new Date(y, m - 1, d, sh, sm);
    let end;
    if (item.end) {
      const [eh, em] = item.end.split(':').map(Number);
      end = new Date(y, m - 1, d, eh, em);
      if (end <= start) end.setDate(end.getDate() + 1);
    } else {
      end = new Date(start.getTime() + 2 * 3600e3);
    }
    return { startAt: start, endAt: end };
  }
  function allSlots() {
    return [
      ...data.events.map((e) => ({ ...e, kind: 'event', label: e.title })),
      ...data.food.map((f) => ({ ...f, kind: 'food', label: `Stand ${f.name}` })),
    ].map((x) => ({ ...x, ...slot(x) })).sort((a, b) => a.startAt - b.startAt);
  }
  function until(date) {
    const min = Math.round((date - new Date()) / 60000);
    if (min < 60) return `dans ${Math.max(1, min)} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `dans ${h} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`;
    const d = Math.round(h / 24);
    return `dans ${d} jour${d > 1 ? 's' : ''}`;
  }

  // ================= FACE ÉTUDIANTS =================
  let selectedDay = null;
  let selectedWeek = 0;

  function renderHeader() {
    const name = data.config.listName;
    const tagline = data.config.tagline || '';
    document.title = `${name} — Campagne${tagline ? ` · ${tagline}` : ''}`;
    $('#brand-name').innerHTML = wordmark(name);
    $('#brand-sub').textContent = tagline ? `Liste · ${tagline}` : 'Liste';
    $('#hero-wordmark').innerHTML = wordmark(name);
    $('#login-mark').innerHTML = wordmark(name);
    $('#foot-mark').textContent = `${name}.`;
    $('#footer-name').textContent = `Liste ${name}${tagline ? ` · ${tagline}` : ''} · Campagne ${new Date().getFullYear()}`;
    const mail = $('#footer-mail');
    mail.hidden = !data.config.contactEmail;
    mail.href = `mailto:${data.config.contactEmail || ''}`;
    const insta = $('#footer-insta');
    insta.hidden = !data.config.instagram;
    insta.href = `https://instagram.com/${encodeURIComponent((data.config.instagram || '').replace(/^@/, ''))}`;
    const days = campaignDays();
    $('#hero-kicker').textContent = `${tagline ? `${tagline} · ` : ''}Campagne du ${fmtShort(days[0])} au ${fmtShort(days[days.length - 1])}`;
  }

  function renderLive() {
    const now = new Date();
    const slots = allSlots();
    const current = slots.filter((s) => s.startAt <= now && now < s.endAt);
    const next = slots.find((s) => s.startAt > now);
    const days = campaignDays();
    const first = parseDay(days[0]);
    const dayIndex = Math.floor((parseDay(todayIso) - first) / 864e5);
    let progressLabel; let pct;
    if (dayIndex < 0) { progressLabel = `Lancement ${until(first)}`; pct = 0; }
    else if (dayIndex >= days.length) { progressLabel = 'Campagne terminée — merci à tous'; pct = 100; }
    else { progressLabel = `Jour ${dayIndex + 1} sur ${days.length}`; pct = ((dayIndex + 1) / days.length) * 100; }

    let main;
    if (current.length) {
      const c = current[0];
      main = `<div class="live-head"><span class="pulse">En ce moment</span><span>jusqu'à ${esc(c.endAt.toTimeString().slice(0, 5).replace(':', 'h'))}</span></div>
        <div class="live-title">${esc(c.label)}</div>
        <div class="live-meta">${esc(c.place)}${current.length > 1 ? ` · et ${current.length - 1} autre${current.length > 2 ? 's' : ''} en parallèle` : ''}</div>`;
    } else if (next) {
      main = `<div class="live-head"><span class="pulse idle">Prochain rendez-vous</span><span>${esc(until(next.startAt))}</span></div>
        <div class="live-title">${esc(next.label)}</div>
        <div class="live-meta">${esc(fmtLong(next.date))} · ${esc(next.start.replace(':', 'h'))} · ${esc(next.place)}</div>`;
    } else {
      main = `<div class="live-head"><span class="pulse idle">Programme</span></div>
        <div class="live-title">À très vite.</div><div class="live-meta">Le programme complet arrive bientôt.</div>`;
    }
    const after = current.length && next
      ? `<div class="live-next"><span>Ensuite</span><span><b>${esc(next.label)}</b> · ${esc(until(next.startAt))}</span></div>` : '';
    $('#live').innerHTML = `${main}${after}
      <div class="progress"><div class="progress-bar"><span style="width:${pct}%"></span></div>
      <div class="progress-label"><span>${esc(progressLabel)}</span><span>${days.length} jours</span></div></div>`;
  }

  function renderHeroStats() {
    const dispo = data.members.filter((m) => m.status === 'dispo').length;
    const portions = data.food.reduce((s, f) => s + foodLevel(f).left, 0);
    const stats = [
      [data.events.length, 'événements'],
      [data.food.length, 'stands food'],
      [num(portions), 'portions à venir'],
      [`${dispo}/${data.members.length}`, 'membres dispo maintenant'],
    ];
    $('#hero-stats').innerHTML = stats.map(([n, l]) => `<div class="stat"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`).join('');
  }

  function renderTicker() {
    const now = new Date();
    const up = allSlots().filter((s) => s.endAt > now).slice(0, 10);
    const list = up.length ? up : allSlots().slice(0, 10);
    const html = list.map((s) => `<span>${esc(fmtShort(s.date).replace('.', ''))} · ${esc(s.start.replace(':', 'h'))} <b>${esc(s.label)}</b> ${esc(s.place)}</span>`).join('');
    $('#ticker').innerHTML = html + html;
  }

  function renderDays() {
    const days = campaignDays();
    const weeks = Math.ceil(days.length / 7);
    if (selectedDay === null || !days.includes(selectedDay)) {
      selectedDay = days.includes(todayIso) ? todayIso : days[0];
      selectedWeek = Math.floor(days.indexOf(selectedDay) / 7);
    }
    $('#week-seg').innerHTML = weeks > 1 ? Array.from({ length: weeks }, (_, i) =>
      `<button type="button" data-week="${i}" class="${i === selectedWeek ? 'on' : ''}">Semaine ${i + 1}</button>`).join('') : '';
    $('#week-seg').hidden = weeks < 2;
    const count = {};
    [...data.events, ...data.food].forEach((x) => { count[x.date] = (count[x.date] || 0) + 1; });
    $('#days').innerHTML = days.slice(selectedWeek * 7, selectedWeek * 7 + 7).map((d) => {
      const dt = parseDay(d);
      return `<button type="button" class="day ${d === selectedDay ? 'on' : ''} ${d === todayIso ? 'today' : ''}" data-day="${d}" aria-pressed="${d === selectedDay}">
        <small>${esc(dt.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''))}</small>
        <b>${dt.getDate()}</b>${count[d] ? `<span class="count">${count[d]}</span>` : ''}</button>`;
    }).join('');
  }

  function renderAgenda() {
    const now = new Date();
    const items = allSlots().filter((s) => s.date === selectedDay);
    const label = `<div class="agenda-date">${esc(fmtLong(selectedDay))}</div>`;
    if (!items.length) { $('#day-agenda').innerHTML = label + '<div class="empty">Journée off. On se retrouve demain.</div>'; return; }
    $('#day-agenda').innerHTML = label + '<div class="agenda">' + items.map((it) => {
      const state = it.startAt <= now && now < it.endAt ? 'now' : it.endAt <= now ? 'past' : '';
      const time = `<div class="time">${esc(it.start.replace(':', 'h'))}${it.end ? `<small>→ ${esc(it.end.replace(':', 'h'))}</small>` : ''}</div>`;
      if (it.kind === 'event') {
        return `<article class="row ${state}">${time}
          <div><h3>${esc(it.title)}</h3>
            <div class="meta"><span>${ICON.pin}${esc(it.place)}</span></div>
            ${it.description ? `<p>${esc(it.description)}</p>` : ''}</div>
          <div>${state === 'now' ? '<span class="chip accent dot">En cours</span>' : it.category ? `<span class="chip">${esc(it.category)}</span>` : ''}</div>
        </article>`;
      }
      const lv = foodLevel(it);
      return `<article class="row ${state}">${time}
        <div><h3>Stand ${esc(it.name)}</h3>
          <div class="meta"><span>${ICON.pin}${esc(it.place)}</span>${it.price ? `<span>${ICON.tag}${esc(it.price)}</span>` : ''}<span>${num(lv.left)} / ${num(it.planned)} portions</span></div></div>
        <div>${state === 'now' ? '<span class="chip accent dot">En cours</span>' : `<span class="chip food">Food</span>`}</div>
      </article>`;
    }).join('') + '</div>';
  }

  function renderFoodGrid() {
    const now = new Date();
    // Stands à venir d'abord, stands terminés à la fin
    const list = [...data.food].sort((a, b) => ((slot(a).endAt <= now) - (slot(b).endAt <= now)) || byTime(a, b));
    $('#food-grid').innerHTML = list.length ? list.map((f) => {
      const lv = foodLevel(f);
      const { startAt, endAt } = slot(f);
      const past = endAt <= now;
      const live = startAt <= now && now < endAt;
      const chip = past ? '<span class="chip">Terminé</span>'
        : live ? `<span class="chip accent dot">${lv.left ? 'Ouvert' : 'Épuisé'}</span>`
          : `<span class="chip ${lv.cls || 'ok'} dot">${lv.label}</span>`;
      return `<article class="food-card ${past ? 'past' : ''}">
        <div class="food-top"><span>${esc(fmtShort(f.date).replace('.', ''))} · ${esc(hours(f.start, f.end))}</span>${chip}</div>
        <h3>${esc(f.name)}</h3>
        <div class="meta"><span>${ICON.pin}${esc(f.place)}</span>${f.price ? `<span>${ICON.tag}${esc(f.price)}</span>` : ''}</div>
        <div class="food-qty">
          <div class="big">${num(lv.left)}<small>/ ${num(f.planned)} portions</small></div>
          <div class="gauge ${lv.cls}"><span style="width:${Math.round(lv.pct * 100)}%"></span></div>
        </div>
      </article>`;
    }).join('') : '<div class="empty">Les stands seront bientôt annoncés.</div>';
  }

  function renderServices() {
    $('#services-grid').innerHTML = data.services.length ? data.services.map((s, i) =>
      `<div class="service-item"><div class="no">${String(i + 1).padStart(2, '0')}</div><h3>${esc(s.title)}</h3><p>${esc(s.description)}</p>
        ${s.where ? `<div class="meta"><span>${ICON.pin}${esc(s.where)}</span></div>` : ''}</div>`).join('')
      : '<div class="empty" style="grid-column:1/-1">Aucun service pour le moment.</div>';
  }

  function renderMembersPublic() {
    const order = { dispo: 0, occupe: 1, pause: 2, absent: 3 };
    const list = [...data.members].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
    const counts = {};
    data.members.forEach((m) => { counts[m.status] = (counts[m.status] || 0) + 1; });
    $('#team-bar').innerHTML = Object.entries(STATUS).filter(([k]) => counts[k])
      .map(([k, v]) => `<span class="chip ${v.cls} dot">${counts[k]} ${esc(v.label.toLowerCase())}</span>`).join('');
    $('#members-public').innerHTML = list.map((m) => {
      const st = STATUS[m.status] || STATUS.dispo;
      const tel = (m.phone || '').replace(/[^\d+]/g, '');
      const updated = m.updatedAt ? new Date(m.updatedAt).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      return `<article class="member ${m.status === 'absent' ? 'absent' : ''}">
        <div class="member-top">
          <div class="avatar ${esc(m.status)}" style="background:${avatarColor(m.name)}">${esc(initials(m.name))}</div>
          <div><h3>${esc(m.name)}</h3><div class="role">${esc(m.role)}</div></div>
        </div>
        <div class="where">${ICON.pin}<div>${esc(m.location || 'Position non renseignée')}${updated ? `<small>Mis à jour ${esc(updated)}</small>` : ''}</div></div>
        <div class="member-foot"><span class="chip ${st.cls} dot">${st.label}</span>
          ${tel && m.status !== 'absent' ? `<a class="btn btn-ghost btn-sm" href="tel:${esc(tel)}">${ICON.phone}Appeler</a>` : ''}</div>
      </article>`;
    }).join('');
  }

  // Inscription e-mail
  $('#signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const status = $('#signup-status');
    const entry = { email: form.email.value.trim().toLowerCase(), name: form.name.value.trim(), date: new Date().toISOString() };
    status.textContent = 'Inscription en cours…';
    const hook = data.config.signupWebhook;
    try {
      if (hook) {
        const res = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...entry, list: data.config.listName }) });
        if (!res.ok) throw new Error();
      }
      if (!data.subscribers.some((s) => s.email === entry.email)) {
        data.subscribers.push(entry);
        storage.set(STORE_KEY, JSON.stringify(data));
      }
      form.reset();
      status.textContent = 'Merci ! Vous recevrez le programme de la campagne par e-mail.';
    } catch {
      const mail = data.config.contactEmail;
      status.innerHTML = mail
        ? `L'inscription n'a pas pu être envoyée. Écrivez-nous à <a href="mailto:${esc(mail)}?subject=Inscription%20newsletter">${esc(mail)}</a>.`
        : "L'inscription n'a pas pu être envoyée. Réessayez dans quelques minutes.";
    }
  });

  $('#week-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-week]'); if (!b) return;
    selectedWeek = Number(b.dataset.week);
    selectedDay = campaignDays()[selectedWeek * 7];
    renderDays(); renderAgenda();
  });
  $('#days').addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]'); if (!b) return;
    selectedDay = b.dataset.day;
    renderDays(); renderAgenda();
  });

  // ================= FACE LISTE =================
  let isAdmin = false;
  try { isAdmin = sessionStorage.getItem(SESSION_KEY) === '1'; } catch { /* ignore */ }
  let view = location.hash === '#liste' ? 'admin' : 'public';
  let currentTab = 'budget';

  function setView(v) {
    view = v;
    $('#public-view').hidden = v !== 'public';
    $('#admin-view').hidden = v !== 'admin';
    $('#public-nav').style.visibility = v === 'public' ? 'visible' : 'hidden';
    $('#switch-btn').textContent = v === 'public' ? 'Espace liste' : 'Voir le site';
    $('#foot-mark').hidden = v !== 'public';
    $('#login-box').hidden = isAdmin;
    $('#admin-app').hidden = !isAdmin;
    if (v === 'admin' && history.replaceState) history.replaceState(null, '', '#liste');
    if (v === 'public' && location.hash === '#liste') history.replaceState(null, '', location.pathname);
    window.scrollTo(0, 0);
  }
  $('#switch-btn').addEventListener('click', () => setView(view === 'public' ? 'admin' : 'public'));

  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.code.value === data.config.adminCode) {
      isAdmin = true;
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
      e.target.reset();
      $('#login-status').textContent = '';
      setView('admin');
      renderAdmin();
    } else {
      $('#login-status').textContent = 'Code incorrect.';
    }
  });
  $('#logout-btn').addEventListener('click', () => {
    isAdmin = false;
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    setView('public');
  });

  $('#admin-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    currentTab = b.dataset.tab;
    $$('#admin-tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== currentTab; });
  });

  function budgetTotals() {
    const rec = data.budget.filter((b) => b.type === 'recette').reduce((s, b) => s + Number(b.amount), 0);
    const dep = data.budget.filter((b) => b.type === 'depense').reduce((s, b) => s + Number(b.amount), 0);
    return { rec, dep, solde: rec - dep };
  }
  const lowStock = () => data.stock.filter((s) => Number(s.quantity) <= Number(s.threshold));

  function renderKpis() {
    const t = budgetTotals();
    const low = lowStock().length;
    const cap = Number(data.budgetCap) || 0;
    const kpis = [
      ['Solde', euro(t.solde), t.solde < 0],
      ['Dépensé', `${euro(t.dep)}${cap ? ` / ${euro(cap)}` : ''}`, cap && t.dep > cap],
      ['Produits à racheter', low, low > 0],
      ['Abonnés e-mail', data.subscribers.length, false],
    ];
    $('#kpis').innerHTML = kpis.map(([l, n, bad]) => `<div class="card kpi"><div class="label">${l}</div><div class="num ${bad ? 'neg' : ''}">${esc(n)}</div></div>`).join('');
    const stockTab = $('#admin-tabs [data-tab="stock"]');
    stockTab.innerHTML = `Stocks${low ? `<span class="count">${low}</span>` : ''}`;
    $('#sync-banner').className = `banner ${hasLocalChanges ? 'warn' : ''}`;
    $('#sync-banner').innerHTML = hasLocalChanges
      ? '<b>Modifications locales.</b> Elles sont enregistrées dans ce navigateur. Pour que tous les étudiants les voient, cliquez sur « Exporter data.js » puis remplacez le fichier <code>data.js</code> du site.'
      : 'Vous voyez les données publiées. Toute modification sera enregistrée dans ce navigateur jusqu\'à l\'export.';
  }

  function delBtn(kind, id) { return `<button class="btn btn-danger btn-sm" data-del="${kind}" data-id="${esc(id)}" type="button">Suppr.</button>`; }

  function renderBudget() {
    const t = budgetTotals();
    const cats = {};
    data.budget.filter((b) => b.type === 'depense').forEach((b) => { cats[b.category] = (cats[b.category] || 0) + Number(b.amount); });
    const max = Math.max(1, ...Object.values(cats));
    $('#budget-bars').innerHTML = Object.keys(cats).length
      ? Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, v]) =>
        `<div class="bar-row"><span>${esc(c)}</span><div class="gauge"><span style="width:${(v / max) * 100}%"></span></div><span class="num">${euro(v)}</span></div>`).join('')
        + `<p class="faint" style="margin-top:10px">Recettes ${euro(t.rec)} · Dépenses ${euro(t.dep)} · Solde ${euro(t.solde)}</p>`
      : '<p class="muted">Aucune dépense pour le moment.</p>';
    $('#budget-cats').innerHTML = [...new Set(data.budget.map((b) => b.category))].map((c) => `<option>${esc(c)}</option>`).join('');
    const rows = [...data.budget].sort((a, b) => b.date.localeCompare(a.date));
    $('#budget-table').innerHTML = '<tr><th>Date</th><th>Libellé</th><th>Poste</th><th class="num">Montant</th><th></th></tr>' + rows.map((b) =>
      `<tr><td>${esc(fmtShort(b.date))}</td><td>${esc(b.label)}</td><td>${esc(b.category)}</td>
        <td class="num" style="color:var(${b.type === 'recette' ? '--ok' : '--ink'})">${b.type === 'recette' ? '+' : '−'} ${euro(b.amount)}</td><td class="num">${delBtn('budget', b.id)}</td></tr>`).join('');
  }

  function renderStock() {
    const rows = [...data.stock].sort((a, b) => (Number(a.quantity) <= Number(a.threshold) ? 0 : 1) - (Number(b.quantity) <= Number(b.threshold) ? 0 : 1) || a.name.localeCompare(b.name));
    $('#stock-table').innerHTML = '<tr><th>Produit</th><th>Quantité</th><th>Seuil</th><th>État</th><th></th></tr>' + rows.map((s) => {
      const q = Number(s.quantity); const th = Number(s.threshold);
      const tag = q === 0 ? '<span class="chip bad">Rupture</span>' : q <= th ? '<span class="chip warn">À racheter</span>' : '<span class="chip ok">OK</span>';
      return `<tr><td>${esc(s.name)}</td>
        <td><span class="qty-ctl"><button type="button" data-step="-1" data-id="${s.id}">−</button><input type="number" min="0" step="any" value="${esc(s.quantity)}" data-qty="${s.id}"><button type="button" data-step="1" data-id="${s.id}">+</button></span> <span class="faint">${esc(s.unit)}</span></td>
        <td>${esc(s.threshold)} ${esc(s.unit)}</td><td>${tag}</td><td class="num">${delBtn('stock', s.id)}</td></tr>`;
    }).join('');
    const low = lowStock();
    $('#shopping').textContent = low.length
      ? low.map((s) => `${s.name} : ${Math.max(0, Number(s.threshold) * 2 - Number(s.quantity))} ${s.unit}`).join(' · ')
      : 'Tous les stocks sont au-dessus du seuil.';
  }

  function audienceEmails(audience) {
    if (audience === 'membres') return [];
    return data.subscribers.map((s) => s.email);
  }
  function renderEmails() {
    $('#sub-count').textContent = data.subscribers.length;
    $('#sub-list').innerHTML = data.subscribers.length
      ? '<table>' + data.subscribers.map((s) => `<tr><td>${esc(s.email)}</td><td class="faint">${esc(s.name)}</td><td class="num">${delBtn('sub', s.email)}</td></tr>`).join('') + '</table>'
      : '<p class="faint">Aucun abonné pour le moment.</p>';
    $('#mail-table').innerHTML = '<tr><th>Objet</th><th>Destinataires</th><th>Statut</th><th></th></tr>' + data.campaigns.map((c) => {
      const n = c.audience === 'membres' ? data.members.length : data.subscribers.length;
      return `<tr><td>${esc(c.subject)}</td><td>${c.audience === 'membres' ? 'Membres' : 'Abonnés'} (${n})</td>
        <td>${c.status === 'envoye' ? `<span class="chip ok">Envoyé ${esc(fmtShort(c.sentAt.slice(0, 10)))}</span>` : '<span class="chip">Brouillon</span>'}</td>
        <td class="num"><span class="toolbar" style="justify-content:flex-end">
          <button class="btn btn-sm" type="button" data-mail="${c.id}">Ouvrir dans la messagerie</button>
          <button class="btn btn-ghost btn-sm" type="button" data-copymail="${c.id}">Copier</button>
          <button class="btn btn-ghost btn-sm" type="button" data-sent="${c.id}">Marquer envoyé</button>
          ${delBtn('campaign', c.id)}</span></td></tr>`;
    }).join('');
  }

  function renderFoodAdmin() {
    const rows = [...data.food].sort(byTime);
    $('#food-table').innerHTML = '<tr><th>Stand</th><th>Quand</th><th>Lieu</th><th>Prévu</th><th>Servi</th><th>Reste</th><th></th></tr>' + rows.map((f) => {
      const lv = foodLevel(f);
      return `<tr><td>${esc(f.name)}</td><td>${esc(fmtShort(f.date))} ${esc(hours(f.start, f.end))}</td><td>${esc(f.place)}</td>
        <td><input type="number" min="0" style="width:80px" value="${esc(f.planned)}" data-food="${f.id}" data-field="planned"></td>
        <td><span class="qty-ctl"><button type="button" data-serve="-10" data-id="${f.id}">−10</button><input type="number" min="0" value="${esc(f.served || 0)}" data-food="${f.id}" data-field="served"><button type="button" data-serve="10" data-id="${f.id}">+10</button></span></td>
        <td><span class="chip ${lv.cls || 'ok'}">${num(lv.left)}</span></td><td class="num">${delBtn('food', f.id)}</td></tr>`;
    }).join('');
  }

  function renderEventsAdmin() {
    const rows = [...data.events].sort(byTime);
    $('#events-table').innerHTML = '<tr><th>Événement</th><th>Quand</th><th>Lieu</th><th>Catégorie</th><th></th></tr>' + rows.map((e) =>
      `<tr><td>${esc(e.title)}</td><td>${esc(fmtShort(e.date))} ${esc(hours(e.start, e.end))}</td><td>${esc(e.place)}</td><td>${esc(e.category)}</td>
        <td class="num"><button class="btn btn-ghost btn-sm" type="button" data-edit-event="${e.id}">Modifier</button> ${delBtn('event', e.id)}</td></tr>`).join('');
    $('#services-table').innerHTML = '<tr><th>Service</th><th>Description</th><th>Où / qui</th><th></th></tr>' + data.services.map((s) =>
      `<tr><td>${esc(s.title)}</td><td>${esc(s.description)}</td><td>${esc(s.where)}</td><td class="num">${delBtn('service', s.id)}</td></tr>`).join('');
  }

  function renderMembersAdmin() {
    $('#members-table').innerHTML = '<tr><th>Membre</th><th>Position actuelle</th><th>Statut</th><th>Téléphone</th><th></th></tr>' + data.members.map((m) =>
      `<tr><td><b>${esc(m.name)}</b><div class="faint">${esc(m.role)}</div></td>
        <td><input value="${esc(m.location)}" data-member="${m.id}" data-field="location" placeholder="Où es-tu ?"></td>
        <td><select data-member="${m.id}" data-field="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${m.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></td>
        <td><input value="${esc(m.phone)}" data-member="${m.id}" data-field="phone" type="tel" style="width:140px"></td>
        <td class="num">${delBtn('member', m.id)}</td></tr>`).join('');
  }

  function renderSettings() {
    const f = $('#settings-form');
    ['listName', 'tagline', 'campaignStart', 'campaignDays', 'contactEmail', 'instagram', 'signupWebhook', 'adminCode'].forEach((k) => { f[k].value = data.config[k] ?? ''; });
    f.budgetCap.value = data.budgetCap ?? '';
  }

  function renderAdmin() {
    if (!isAdmin) return;
    // Ne pas écraser un champ en cours de saisie
    const active = document.activeElement;
    if (active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName) && active.closest('#admin-app table')) return;
    renderKpis(); renderBudget(); renderStock(); renderEmails(); renderFoodAdmin(); renderEventsAdmin(); renderMembersAdmin(); renderSettings();
  }

  function renderPublic() {
    renderHeader(); renderLive(); renderHeroStats(); renderTicker(); renderDays(); renderAgenda(); renderFoodGrid(); renderServices(); renderMembersPublic();
  }
  function renderAll() { renderPublic(); renderAdmin(); }

  // ---------- Actions de l'espace liste ----------
  const formData = (form) => Object.fromEntries(new FormData(form).entries());

  $('#budget-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(e.target);
    data.budget.push({ id: uid('b'), ...d, amount: Number(d.amount) });
    e.target.reset(); e.target.date.value = todayIso; save();
  });
  $('#budget-form').date.value = todayIso;

  $('#stock-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(e.target);
    data.stock.push({ id: uid('k'), ...d, quantity: Number(d.quantity), threshold: Number(d.threshold) });
    e.target.reset(); save();
  });

  $('#food-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(e.target);
    data.food.push({ id: uid('f'), ...d, planned: Number(d.planned), served: 0 });
    e.target.reset(); save();
  });

  $('#event-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(e.target);
    if (d.id) Object.assign(data.events.find((x) => x.id === d.id) || {}, d);
    else data.events.push({ ...d, id: uid('e') });
    e.target.reset(); $('#event-form-title').textContent = 'Ajouter un événement'; save();
  });
  $('#event-cancel').addEventListener('click', () => { $('#event-form-title').textContent = 'Ajouter un événement'; $('#event-form').id.value = ''; });

  $('#service-form').addEventListener('submit', (e) => {
    e.preventDefault();
    data.services.push({ id: uid('s'), ...formData(e.target) });
    e.target.reset(); save();
  });

  $('#member-form').addEventListener('submit', (e) => {
    e.preventDefault();
    data.members.push({ id: uid('m'), ...formData(e.target), status: 'dispo', updatedAt: new Date().toISOString() });
    e.target.reset(); save();
  });

  $('#mail-form').addEventListener('submit', (e) => {
    e.preventDefault();
    data.campaigns.unshift({ id: uid('c'), ...formData(e.target), status: 'brouillon', sentAt: '' });
    e.target.reset(); save();
  });
  $('#fill-programme').addEventListener('click', () => {
    const day = campaignDays().includes(todayIso) ? todayIso : campaignDays()[0];
    const lines = [
      ...data.events.filter((x) => x.date === day).map((x) => ({ ...x, line: `• ${hours(x.start, x.end)} — ${x.title} (${x.place})` })),
      ...data.food.filter((x) => x.date === day).map((x) => ({ ...x, line: `• ${hours(x.start, x.end)} — Stand ${x.name} (${x.place}) : ${x.planned} portions${x.price ? `, ${x.price}` : ''}` })),
    ].sort(byTime).map((x) => x.line);
    const f = $('#mail-form');
    if (!f.subject.value) f.subject.value = `Le programme du ${fmtLong(day)}`;
    f.body.value += `${f.body.value ? '\n\n' : ''}Programme du ${fmtLong(day)} :\n${lines.join('\n') || 'Rien de prévu.'}\n\n${data.config.listName}`;
  });

  $('#sub-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const emails = e.target.emails.value.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
    emails.forEach((email) => { if (!data.subscribers.some((s) => s.email === email)) data.subscribers.push({ email, name: '', date: new Date().toISOString() }); });
    e.target.reset(); save();
  });

  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    if (btn) { const old = btn.textContent; btn.textContent = 'Copié !'; setTimeout(() => { btn.textContent = old; }, 1400); }
  }
  function download(name, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $('#copy-subs').addEventListener('click', (e) => copy(data.subscribers.map((s) => s.email).join(', '), e.target));
  $('#csv-subs').addEventListener('click', () => download('abonnes.csv', 'email,prenom,date\n' + data.subscribers.map((s) => [s.email, s.name, s.date].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv'));
  $('#copy-shopping').addEventListener('click', (e) => copy($('#shopping').textContent, e.target));

  // Délégation pour les tableaux
  const findIn = (list, id) => data[list].find((x) => x.id === id);
  $('#admin-app').addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.del) {
      const map = { budget: 'budget', stock: 'stock', food: 'food', event: 'events', service: 'services', member: 'members', campaign: 'campaigns' };
      if (!confirm('Supprimer cet élément ?')) return;
      if (t.dataset.del === 'sub') data.subscribers = data.subscribers.filter((s) => s.email !== t.dataset.id);
      else data[map[t.dataset.del]] = data[map[t.dataset.del]].filter((x) => x.id !== t.dataset.id);
      save(); return;
    }
    if (t.dataset.step) {
      const s = findIn('stock', t.dataset.id); s.quantity = Math.max(0, Number(s.quantity) + Number(t.dataset.step)); save(); return;
    }
    if (t.dataset.serve) {
      const f = findIn('food', t.dataset.id); f.served = Math.max(0, Math.min(Number(f.planned), Number(f.served || 0) + Number(t.dataset.serve))); save(); return;
    }
    if (t.dataset.editEvent) {
      const ev = findIn('events', t.dataset.editEvent); const f = $('#event-form');
      ['id', 'title', 'date', 'start', 'end', 'place', 'category', 'description'].forEach((k) => { f[k].value = ev[k] || ''; });
      $('#event-form-title').textContent = `Modifier « ${ev.title} »`;
      f.scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
    }
    if (t.dataset.mail || t.dataset.copymail) {
      const c = findIn('campaigns', t.dataset.mail || t.dataset.copymail);
      const emails = c.audience === 'membres' ? [] : audienceEmails(c.audience);
      if (t.dataset.copymail) { copy(`Objet : ${c.subject}\nCci : ${emails.join(', ')}\n\n${c.body}`, t); return; }
      const to = c.audience === 'membres' ? data.config.contactEmail : '';
      location.href = `mailto:${encodeURIComponent(to)}?bcc=${encodeURIComponent(emails.join(','))}&subject=${encodeURIComponent(c.subject)}&body=${encodeURIComponent(c.body)}`;
      return;
    }
    if (t.dataset.sent) {
      const c = findIn('campaigns', t.dataset.sent); c.status = 'envoye'; c.sentAt = new Date().toISOString(); save();
    }
  });
  $('#admin-app').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.qty) { findIn('stock', t.dataset.qty).quantity = Math.max(0, Number(t.value) || 0); t.blur(); save(); }
    if (t.dataset.food) { findIn('food', t.dataset.food)[t.dataset.field] = Math.max(0, Number(t.value) || 0); t.blur(); save(); }
    if (t.dataset.member) {
      const m = findIn('members', t.dataset.member); m[t.dataset.field] = t.value; m.updatedAt = new Date().toISOString(); t.blur(); save();
    }
  });

  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(e.target);
    data.budgetCap = Number(d.budgetCap) || 0; delete d.budgetCap;
    data.config = { ...data.config, ...d, campaignDays: Number(d.campaignDays) };
    selectedDay = null; save();
    $('#settings-status').textContent = 'Réglages enregistrés.';
  });
  $('#reset-btn').addEventListener('click', () => {
    if (!confirm('Effacer les modifications de ce navigateur et revenir aux données publiées (data.js) ?')) return;
    storage.remove(STORE_KEY); data = clone(published); hasLocalChanges = false; selectedDay = null; renderAll();
  });

  // Export / import
  $('#export-btn').addEventListener('click', () => {
    const content = "// Données publiées de la campagne.\n// Pour mettre à jour le site public : dans l'Espace liste, cliquez sur\n// « Exporter data.js », puis remplacez ce fichier par celui téléchargé.\nwindow.JE_DATA = " + JSON.stringify(data, null, 2) + ';\n';
    download('data.js', content, 'text/javascript');
  });
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    try {
      const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
      const imported = JSON.parse(json);
      if (!imported.config || !Array.isArray(imported.events)) throw new Error();
      data = { ...clone(published), ...imported }; selectedDay = null; save();
      alert('Données importées.');
    } catch { alert("Fichier non reconnu : importez un data.js ou un .json exporté depuis l'Espace liste."); }
    e.target.value = '';
  });

  // Thème clair / sombre
  const savedTheme = storage.get(THEME_KEY);
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  $('#theme-btn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; storage.set(THEME_KEY, next);
  });

  // Synchronisation entre onglets ouverts sur le même appareil (ex. tablette du stand)
  window.addEventListener('storage', (e) => { if (e.key === STORE_KEY) { data = loadData(); hasLocalChanges = true; renderAll(); } });

  // Apparition douce des titres de section
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }), { threshold: 0.15 });
    $$('.reveal').forEach((el) => io.observe(el));
  } else {
    $$('.reveal').forEach((el) => el.classList.add('in'));
  }

  // Le bloc « En ce moment » et le programme du jour suivent l'heure
  setInterval(() => { if (view === 'public') { renderLive(); renderAgenda(); } }, 60000);

  renderAll();
  setView(view);
  if (isAdmin) renderAdmin();
})();
