(() => {
  'use strict';

  const STORE_KEY = 'je-data';
  const SESSION_KEY = 'je-admin';
  const THEME_KEY = 'je-theme';
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
    absent: { label: 'Absent·e du campus', cls: 'bad' },
  };
  function foodLevel(item) {
    const left = Math.max(0, (item.planned || 0) - (item.served || 0));
    const pct = item.planned ? left / item.planned : 0;
    const cls = left === 0 ? 'bad' : pct < 0.25 ? 'warn' : '';
    const label = left === 0 ? 'Épuisé' : pct < 0.25 ? 'Bientôt épuisé' : 'Disponible';
    return { left, pct, cls, label };
  }

  // ================= FACE ÉTUDIANTS =================
  let selectedDay = null;
  let selectedWeek = 0;

  function renderHeader() {
    const name = data.config.listName;
    document.title = `${name} — Campagne`;
    $('#brand-name').textContent = name;
    $('#footer-name').textContent = `${name} · Campagne Junior Entreprise`;
    const mail = $('#footer-mail');
    mail.href = data.config.contactEmail ? `mailto:${data.config.contactEmail}` : '#';
    const days = campaignDays();
    $('#hero-kicker').textContent = `${name} · du ${fmtShort(days[0])} au ${fmtShort(days[days.length - 1])}`;
  }

  function renderHeroStats() {
    const dispo = data.members.filter((m) => m.status === 'dispo').length;
    const portions = data.food.reduce((s, f) => s + foodLevel(f).left, 0);
    const todayEvents = data.events.filter((e) => e.date === todayIso).length;
    const stats = [
      [data.events.length, 'événements pendant la campagne'],
      [todayEvents, "événements aujourd'hui"],
      [num(portions), 'portions food encore prévues'],
      [`${dispo}/${data.members.length}`, 'membres disponibles maintenant'],
    ];
    $('#hero-stats').innerHTML = stats.map(([n, l]) => `<div class="stat"><div class="num">${esc(n)}</div><div class="label">${esc(l)}</div></div>`).join('');
  }

  function renderDays() {
    const days = campaignDays();
    const weeks = Math.ceil(days.length / 7);
    if (selectedDay === null) {
      selectedDay = days.includes(todayIso) ? todayIso : days[0];
      selectedWeek = Math.floor(days.indexOf(selectedDay) / 7);
    }
    $('#week-seg').innerHTML = Array.from({ length: weeks }, (_, i) =>
      `<button type="button" data-week="${i}" class="${i === selectedWeek ? 'on' : ''}">Semaine ${i + 1}</button>`).join('');
    const busy = new Set([...data.events, ...data.food].map((x) => x.date));
    $('#days').innerHTML = days.slice(selectedWeek * 7, selectedWeek * 7 + 7).map((d) => {
      const dt = parseDay(d);
      return `<button type="button" class="day ${d === selectedDay ? 'on' : ''} ${d === todayIso ? 'today' : ''}" data-day="${d}">
        <small>${d === todayIso ? "Aujourd'hui" : dt.toLocaleDateString('fr-FR', { weekday: 'short' })}</small>
        <b>${dt.getDate()}</b>${busy.has(d) ? '<span class="dot"></span>' : ''}</button>`;
    }).join('');
  }

  function renderAgenda() {
    const items = [
      ...data.events.filter((e) => e.date === selectedDay).map((e) => ({ ...e, kind: 'event' })),
      ...data.food.filter((f) => f.date === selectedDay).map((f) => ({ ...f, kind: 'food' })),
    ].sort(byTime);
    const label = `<div class="timeline-label">${esc(fmtLong(selectedDay))}${selectedDay === todayIso ? " · aujourd'hui" : ''}</div>`;
    if (!items.length) { $('#day-agenda').innerHTML = label + '<div class="empty">Rien de prévu ce jour-là. Revenez demain !</div>'; return; }
    $('#day-agenda').innerHTML = label + '<div class="timeline">' + items.map((it) => {
      if (it.kind === 'event') {
        return `<div class="tl-item"><div class="tl-head"><h3>${esc(it.title)}</h3><span class="tl-duration">${esc(hours(it.start, it.end))}</span></div>
          <div class="tl-role">${esc(it.place)} ${it.category ? `· <span class="tag">${esc(it.category)}</span>` : ''}</div>
          ${it.description ? `<p class="desc">${esc(it.description)}</p>` : ''}</div>`;
      }
      const lv = foodLevel(it);
      return `<div class="tl-item food"><div class="tl-head"><h3>Stand ${esc(it.name)}</h3><span class="tl-duration">${esc(hours(it.start, it.end))}</span></div>
        <div class="tl-role">${esc(it.place)} · <span class="tag ${lv.cls || 'ok'}">${lv.label}</span></div>
        <p class="desc">${num(lv.left)} portions restantes sur ${num(it.planned)}${it.price ? ` · ${esc(it.price)}` : ''}</p></div>`;
    }).join('') + '</div>';
  }

  function renderFoodGrid() {
    const list = [...data.food].sort(byTime);
    $('#food-grid').innerHTML = list.length ? list.map((f) => {
      const lv = foodLevel(f);
      const past = f.date < todayIso;
      return `<div class="card service food-card" style="${past ? 'opacity:.55' : ''}">
        <div class="when">${esc(fmtShort(f.date))} · ${esc(hours(f.start, f.end))}</div>
        <h3>${esc(f.name)}</h3>
        <p>${esc(f.place)}${f.price ? ` · ${esc(f.price)}` : ''}</p>
        <div class="meter ${lv.cls}"><span style="width:${Math.round(lv.pct * 100)}%"></span></div>
        <div class="food-qty"><span>${num(lv.left)} restantes / ${num(f.planned)}</span><span class="tag ${lv.cls || 'ok'}">${past ? 'Terminé' : lv.label}</span></div>
      </div>`;
    }).join('') : '<div class="empty">Les stands seront bientôt annoncés.</div>';
  }

  function renderServices() {
    $('#services-grid').innerHTML = data.services.length ? data.services.map((s) =>
      `<div class="card service"><h3>${esc(s.title)}</h3><p>${esc(s.description)}</p>${s.where ? `<p class="faint" style="margin-top:8px">📍 ${esc(s.where)}</p>` : ''}</div>`).join('')
      : '<div class="empty">Aucun service pour le moment.</div>';
  }

  function renderMembersPublic() {
    const order = { dispo: 0, occupe: 1, pause: 2, absent: 3 };
    const list = [...data.members].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
    $('#members-public').innerHTML = list.map((m) => {
      const st = STATUS[m.status] || STATUS.dispo;
      const tel = (m.phone || '').replace(/[^\d+]/g, '');
      return `<div class="list-item">
        <div class="avatar">${esc(m.name.trim().charAt(0).toUpperCase())}</div>
        <div><h3>${esc(m.name)} <span class="faint">· ${esc(m.role)}</span></h3>
          <div class="loc">${esc(m.location || 'Position non renseignée')}</div>
          ${m.updatedAt ? `<div class="faint">mis à jour ${esc(new Date(m.updatedAt).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }))}</div>` : ''}</div>
        <div class="list-actions"><span class="tag ${st.cls}">${st.label}</span>${tel && m.status !== 'absent' ? `<a class="btn btn-ghost btn-sm" href="tel:${esc(tel)}">Appeler</a>` : ''}</div>
      </div>`;
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
      status.innerHTML = `L'inscription n'a pas pu être envoyée. Vous pouvez aussi écrire à <a href="mailto:${esc(data.config.contactEmail)}?subject=Inscription%20newsletter">${esc(data.config.contactEmail)}</a>.`;
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
    $('#switch-btn').textContent = v === 'public' ? 'Espace liste' : 'Voir le site étudiants';
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
        `<div class="bar-row"><span>${esc(c)}</span><div class="meter"><span style="width:${(v / max) * 100}%"></span></div><span class="num">${euro(v)}</span></div>`).join('')
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
      const tag = q === 0 ? '<span class="tag bad">Rupture</span>' : q <= th ? '<span class="tag warn">À racheter</span>' : '<span class="tag ok">OK</span>';
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
        <td>${c.status === 'envoye' ? `<span class="tag ok">Envoyé ${esc(fmtShort(c.sentAt.slice(0, 10)))}</span>` : '<span class="tag">Brouillon</span>'}</td>
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
        <td><span class="tag ${lv.cls || 'ok'}">${num(lv.left)}</span></td><td class="num">${delBtn('food', f.id)}</td></tr>`;
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
    ['listName', 'campaignStart', 'campaignDays', 'contactEmail', 'signupWebhook', 'adminCode'].forEach((k) => { f[k].value = data.config[k] ?? ''; });
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
    renderHeader(); renderHeroStats(); renderDays(); renderAgenda(); renderFoodGrid(); renderServices(); renderMembersPublic();
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

  renderAll();
  setView(view);
  if (isAdmin) renderAdmin();
})();
