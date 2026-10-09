(() => {
  'use strict';

  const STORE_KEY = 'leclercq-data';
  const SESSION_KEY = 'leclercq-admin';
  let published = window.JE_DATA;

  // ---------- Données ----------
  // data.js (publié sur le site) est la référence. Depuis l'Espace liste, chaque
  // modification est republiée automatiquement si une clé GitHub est réglée ;
  // sinon elle reste dans ce navigateur jusqu'à l'export de data.js.
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  };

  // ---------- Données publiques / privées ----------
  // data.js contient la partie publique en clair (programme, food, équipe…) et la
  // partie privée (budget, stocks, abonnés, campagnes) chiffrée avec le code
  // d'accès de la liste : seuls les membres qui ont le code peuvent la lire.
  const PRIVATE_KEYS = ['budget', 'budgetCap', 'stock', 'subscribers', 'campaigns'];
  const PRIVATE_DEFAULTS = { budget: [], budgetCap: 0, stock: [], subscribers: [], campaigns: [] };
  const splitData = (full) => {
    const pub = {}; const priv = {};
    Object.keys(full).forEach((k) => { (PRIVATE_KEYS.includes(k) ? priv : pub)[k] = full[k]; });
    if (pub.config) { pub.config = { ...pub.config }; delete pub.config.adminCode; }
    return { pub, priv };
  };

  // ---------- Chiffrement (AES-GCM, clé dérivée du code par PBKDF2) ----------
  const b64 = {
    fromBytes: (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))),
    toBytes: (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0)),
    fromText: (txt) => { const bytes = new TextEncoder().encode(txt); let s = ''; bytes.forEach((x) => { s += String.fromCharCode(x); }); return btoa(s); },
    toText: (str) => new TextDecoder().decode(Uint8Array.from(atob(str.replace(/\s/g, '')), (c) => c.charCodeAt(0))),
  };
  async function deriveKey(code, saltB64) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64.toBytes(saltB64), iterations: 210000 },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptPrivate(obj, crypt) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, crypt.key, new TextEncoder().encode(JSON.stringify(obj)));
    return { v: 1, salt: crypt.salt, iv: b64.fromBytes(iv), data: b64.fromBytes(buf) };
  }
  async function decryptPrivate(blob, key) {
    const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.toBytes(blob.iv) }, key, b64.toBytes(blob.data));
    return JSON.parse(new TextDecoder().decode(buf));
  }
  let crypt = null; // { key, salt, code } une fois connecté

  // ---------- Fichier data.js ----------
  const FILE_HEADER = "// Données du site, publiées depuis l'Espace liste.\n// La partie JE_PRIVATE est chiffrée avec le code d'accès de la liste : ne la modifiez pas à la main.\n";
  async function buildFile(full) {
    const { pub, priv } = splitData(full);
    pub.publishedAt = new Date().toISOString();
    let text = `${FILE_HEADER}window.JE_DATA = ${JSON.stringify(pub, null, 2)};\n`;
    if (crypt) text += `window.JE_PRIVATE = ${JSON.stringify(await encryptPrivate(priv, crypt))};\n`;
    return { text, publishedAt: pub.publishedAt };
  }
  function parseFile(text) {
    const win = {};
    new Function('window', text)(win); // fichier du dépôt de la liste, le même que celui chargé par la page
    if (!win.JE_DATA || !win.JE_DATA.config) throw new Error('data.js illisible');
    return { pub: win.JE_DATA, priv: win.JE_PRIVATE || null };
  }

  // ---------- Fusion à trois voies (deux membres qui modifient en même temps) ----------
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function mergeObj(base = {}, mine = {}, theirs = {}) {
    const out = {};
    new Set([...Object.keys(theirs), ...Object.keys(mine)]).forEach((k) => {
      out[k] = !same(mine[k], base[k]) ? mine[k] : theirs[k];
    });
    return out;
  }
  function mergeList(base = [], mine = [], theirs = [], key = 'id') {
    const m = (list) => new Map(list.map((x) => [x[key], x]));
    const B = m(base); const L = m(mine); const R = m(theirs);
    const ids = [...new Set([...theirs.map((x) => x[key]), ...mine.map((x) => x[key])])];
    const out = [];
    ids.forEach((id) => {
      const b = B.get(id); const l = L.get(id); const r = R.get(id);
      const lChanged = !b || !same(b, l); const rChanged = !b || !same(b, r);
      if (l && r) out.push(lChanged && rChanged ? mergeObj(b, l, r) : lChanged ? l : r);
      else if (l && !r) { if (!b || lChanged) out.push(l); } // supprimé ailleurs, sauf si modifié ici
      else if (r && !l) { if (!b || rChanged) out.push(r); } // supprimé ici, sauf si modifié ailleurs
    });
    return out;
  }
  function merge3(base, mine, theirs) {
    const out = { ...theirs };
    Object.keys(mine).forEach((k) => {
      if (Array.isArray(mine[k]) || Array.isArray(theirs[k])) {
        const keyName = k === 'subscribers' ? 'email' : 'id';
        out[k] = mergeList(base[k] || [], mine[k] || [], theirs[k] || [], keyName);
      } else if (mine[k] && typeof mine[k] === 'object') out[k] = mergeObj(base[k], mine[k], theirs[k]);
      else out[k] = same(mine[k], base[k]) ? theirs[k] : mine[k];
    });
    return out;
  }

  // ---------- Publication automatique via l'API GitHub ----------
  const TOKEN_KEY = 'leclercq-github-token';
  const ghRepo = () => {
    const c = (published.config && published.config.github) || {};
    const m = location.hostname.match(/^([^.]+)\.github\.io$/);
    const pathRepo = location.pathname.split('/').filter(Boolean)[0];
    return {
      owner: c.owner || (m && m[1]) || 'margauxbouriez-a11y',
      repo: c.repo || (m && pathRepo) || 'junior-entreprise-manager',
      branch: c.branch || 'main',
      path: c.path || 'data.js',
    };
  };
  const token = () => storage.get(TOKEN_KEY) || '';
  const sync = { sha: null, base: null, timer: null, busy: false, dirty: false, status: 'idle', at: null, error: '' };

  async function gh(method, body) {
    const r = ghRepo();
    const url = `https://api.github.com/repos/${r.owner}/${r.repo}/contents/${r.path}` + (method === 'GET' ? `?ref=${encodeURIComponent(r.branch)}&t=${Date.now()}` : '');
    const res = await fetch(url, {
      method, cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token()}`, 'X-GitHub-Api-Version': '2022-11-28' },
      body: body ? JSON.stringify({ ...body, branch: r.branch }) : undefined,
    });
    if (!res.ok) {
      const err = new Error(res.status === 401 ? 'Clé GitHub invalide ou expirée.'
        : res.status === 403 || res.status === 404 ? "La clé GitHub n'a pas le droit d'écrire dans le dépôt."
          : `GitHub a répondu ${res.status}.`);
      err.status = res.status; throw err;
    }
    return res.json();
  }
  async function fetchRemote() {
    const file = await gh('GET');
    const { pub, priv } = parseFile(b64.toText(file.content));
    let privData = { ...PRIVATE_DEFAULTS };
    if (priv && crypt) privData = { ...privData, ...(await decryptPrivate(priv, crypt.key)) };
    return { sha: file.sha, full: { ...pub, ...privData } };
  }
  function setSync(status, error = '') {
    sync.status = status; sync.error = error;
    if (status === 'ok') sync.at = new Date();
    if (isAdmin) renderSyncBanner();
  }
  async function pullRemote() {
    if (!token() || !crypt) return;
    try {
      setSync('loading');
      const remote = await fetchRemote();
      sync.sha = remote.sha; sync.base = clone(remote.full);
      // Brouillon local non publié (ex. publication interrompue) : on le fusionne
      const draft = readDraft();
      data = draft ? merge3(draft.base || remote.full, draft.data, remote.full) : remote.full;
      if (draft) schedulePublish(0); else setSync('ok');
      selectedDay = null; renderAll();
    } catch (err) { setSync('error', err.message); }
  }
  function schedulePublish(delay = 2500) {
    if (!token() || !crypt) return;
    clearTimeout(sync.timer);
    sync.timer = setTimeout(publishNow, delay);
    setSync('pending');
  }
  async function publishNow() {
    if (sync.busy) { sync.dirty = true; return; }
    sync.busy = true; sync.dirty = false;
    setSync('publishing');
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!sync.sha || attempt > 0) {
          const remote = await fetchRemote();
          if (remote.sha !== sync.sha) { data = merge3(sync.base || remote.full, data, remote.full); sync.sha = remote.sha; sync.base = clone(remote.full); }
        }
        const snapshot = clone(data);
        const { text } = await buildFile(snapshot);
        try {
          const res = await gh('PUT', { message: "Mise à jour du site depuis l'Espace liste", content: b64.fromText(text), sha: sync.sha });
          sync.sha = res.content.sha; sync.base = snapshot;
          if (same(snapshot, data)) clearDraft();
          setSync('ok'); renderAll();
          break;
        } catch (err) {
          if ((err.status === 409 || err.status === 422) && attempt < 2) continue; // quelqu'un a publié entre-temps : on fusionne et on recommence
          throw err;
        }
      }
    } catch (err) {
      setSync('error', err.message);
    } finally {
      sync.busy = false;
      if (sync.dirty) schedulePublish(500);
    }
  }

  // Brouillon local : filet de sécurité si la publication échoue, ou mode sans clé GitHub
  function readDraft() {
    try { const d = JSON.parse(storage.get(STORE_KEY)); return d && d.data && d.v === 2 ? d : null; } catch { return null; }
  }
  function writeDraft() { storage.set(STORE_KEY, JSON.stringify({ v: 2, base: sync.base, publishedAt: published.publishedAt || '', data })); }
  function clearDraft() { storage.remove(STORE_KEY); }

  // Visiteurs : seulement la partie publique
  const loadData = () => ({ ...clone(published), ...PRIVATE_DEFAULTS });
  let data = loadData();
  let publishedPrivate = { ...PRIVATE_DEFAULTS };

  function save() {
    writeDraft();
    if (token() && crypt) schedulePublish();
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

  const STEP_ICON = {
    programme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h3M8 17h6"/></svg>',
    food: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11h16a8 8 0 0 1-16 0z"/><path d="M8 7c0-1.5 1-2 1-3M12 7c0-1.5 1-2 1-3M16 7c0-1.5 1-2 1-3"/></svg>',
    demandes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h3l2.4 11.2a1.6 1.6 0 0 0 1.6 1.3h8.3a1.6 1.6 0 0 0 1.6-1.2L21.5 8H6.3"/></svg>',
    equipe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/></svg>',
  };

  // Couleur d'avatar stable par membre
  const AVATAR_COLORS = ['#E4402B', '#1F3A5F', '#2F6B4F', '#8A5A2B', '#5B3F8C', '#B23A6B', '#24617A', '#6B6B1F'];
  const avatarColor = (s) => AVATAR_COLORS[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR_COLORS.length];
  const initials = (name) => name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

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


  // ================= FACE ÉTUDIANTS =================
  let selectedDay = null;
  let selectedWeek = 0;

  function renderHeader() {
    const name = data.config.listName;
    const tagline = data.config.tagline || '';
    document.title = `${name} — Campagne${tagline ? ` · ${tagline}` : ''}`;
    $('#brand-name').textContent = name;
    $('#brand-sub').textContent = tagline;
    $('#hero-name').textContent = name;
    $('#login-mark').textContent = name;
    $('#footer-name').textContent = name;
    $('#footer-tagline').textContent = tagline ? `Liste · ${tagline}` : 'Liste';
    $('#footer-copy').textContent = `© ${new Date().getFullYear()} ${name}`;
    const mail = $('#footer-mail');
    mail.hidden = !data.config.contactEmail;
    mail.href = `mailto:${data.config.contactEmail || ''}`;
    const insta = $('#footer-insta');
    insta.hidden = !data.config.instagram;
    insta.href = `https://instagram.com/${encodeURIComponent((data.config.instagram || '').replace(/^@/, ''))}`;
    const days = campaignDays();
    const range = `du ${parseDay(days[0]).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} au ${parseDay(days[days.length - 1]).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
    const short = `${parseDay(days[0]).getDate()} — ${parseDay(days[days.length - 1]).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
    $('#hero-kicker').textContent = `${tagline ? `${tagline} · ` : ''}${short}`;
    $('#footer-dates').textContent = `Campagne ${range}`;
  }



  // « Comment ça marche » : les 4 usages du site, avec une info en direct pour chacun
  function renderQuick() {
    const steps = [
      { href: '#programme', icon: 'programme', title: 'Consulter le programme', text: 'Les événements et les stands de chaque jour de la campagne, heure par heure.', cta: 'Voir le programme' },
      { href: '#food', icon: 'food', title: 'Trouver un stand food', text: 'Horaires, lieux et portions restantes, mis à jour pendant les stands.', cta: 'Voir les stands' },
      { href: '#commander', icon: 'demandes', title: 'Commander', text: 'Boissons, crêpes, ménage : tout est offert et livré sur le campus.', cta: 'Passer commande' },
      { href: '#equipe', icon: 'equipe', title: 'Joindre un membre', text: 'Où est chaque membre de la liste, qui est disponible, et son numéro.', cta: "Voir l'équipe" },
    ];
    $('#quick').innerHTML = steps.map((st) => `
      <a class="step" href="${st.href}">
        <span class="step-ico">${STEP_ICON[st.icon]}</span>
        <h3>${st.title}</h3>
        <p>${st.text}</p>
        <span class="step-cta">${st.cta} →</span>
      </a>`).join('');
  }

  // Compte à rebours de l'affiche : avant la campagne → jusqu'au lancement ;
  // pendant → jusqu'à la fin ; après → masqué.
  function campaignBounds() {
    const days = campaignDays();
    const start = parseDay(days[0]);
    const last = parseDay(days[days.length - 1]);
    return { start, end: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1) };
  }
  function renderCountdown() {
    const { start, end } = campaignBounds();
    const now = new Date();
    let target; let label; let title;
    if (now < start) { target = start; label = 'Lancement dans'; title = 'La campagne commence'; }
    else if (now < end) { target = end; label = 'Fin de la campagne dans'; title = 'La campagne est lancée'; }
    else { title = 'Merci pour cette campagne'; }
    $('#hero-title').textContent = title;
    $('#countdown').hidden = !target;
    if (!target) return;
    $('#countdown-label').textContent = label;
    let sec = Math.max(0, Math.floor((target - now) / 1000));
    const d = Math.floor(sec / 86400); sec -= d * 86400;
    const h = Math.floor(sec / 3600); sec -= h * 3600;
    const m = Math.floor(sec / 60); sec -= m * 60;
    const pad = (n) => String(n).padStart(2, '0');
    $('#cd-d').textContent = pad(d); $('#cd-h').textContent = pad(h); $('#cd-m').textContent = pad(m); $('#cd-s').textContent = pad(sec);
  }

  // Chiffres clés (bande dorée)
  function renderHeroFacts() {
    renderCountdown();
    const facts = [
      [campaignDays().length, 'jours de campagne'],
      [data.events.length, 'événements'],
      [data.food.length, 'stands food'],
      ['100 %', 'offert par la liste'],
    ];
    $('#hero-facts').innerHTML = facts.map(([n, l]) => `<div><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('');
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
    const roman = (n) => [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']].reduce((acc, [v, r]) => { while (n >= v) { acc += r; n -= v; } return acc; }, '');
    const label = `<div class="agenda-date">Épisode ${roman(campaignDays().indexOf(selectedDay) + 1)} · ${esc(fmtLong(selectedDay))}</div>`;
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
      return `<div class="person ${m.status === 'absent' ? 'absent' : ''}">
        <div class="avatar ${esc(m.status)}" style="background:${avatarColor(m.name)}">${esc(initials(m.name))}</div>
        <div><h3>${esc(m.name)}</h3><div class="role">${esc(m.role)}</div></div>
        <div class="where">${ICON.pin}<div>${esc(m.location || 'Position non renseignée')}${updated ? `<small>Mis à jour ${esc(updated)}</small>` : ''}</div></div>
        <div class="status"><span class="chip ${st.cls} dot">${st.label}</span></div>
        <div class="act">${tel && m.status !== 'absent' ? `<a class="btn btn-ghost btn-sm" href="tel:${esc(tel)}">${ICON.phone}Appeler</a>` : ''}</div>
      </div>`;
    }).join('');
  }

  // Envoi vers un webhook (n8n…). Le format « formulaire » évite les blocages
  // CORS du navigateur ; n8n le lit comme un objet dans $json.body.
  async function postToWebhook(url, payload) {
    const res = await fetch(url, { method: 'POST', body: new URLSearchParams(payload) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  // ---------- Boutique (tout est offert) ----------
  const CART_KEY = 'leclercq-cart';
  const products = () => (Array.isArray(data.products) ? data.products : []);
  const productCats = () => [...new Set(products().map((x) => x.category || 'Autres'))];
  const maxOf = (prod) => Math.max(1, Number(prod.max) || 1);
  let shopCat = 'Tout';
  let cart = (() => { try { return JSON.parse(storage.get(CART_KEY)) || {}; } catch { return {}; } })();
  const saveCart = () => storage.set(CART_KEY, JSON.stringify(cart));
  const cartLines = () => Object.entries(cart)
    .map(([id, qty]) => ({ prod: products().find((x) => x.id === id), qty }))
    .filter((l) => l.prod && l.prod.available !== false && l.qty > 0);
  const cartCount = () => cartLines().reduce((n, l) => n + l.qty, 0);
  const shopOpen = () => data.config.ordersOpen !== false;

  function setQty(id, qty) {
    const prod = products().find((x) => x.id === id);
    if (!prod) return;
    const q = Math.max(0, Math.min(maxOf(prod), qty));
    if (q) cart[id] = q; else delete cart[id];
    saveCart();
    renderShop(); renderCart();
  }

  function renderShop() {
    const cats = productCats();
    if (shopCat !== 'Tout' && !cats.includes(shopCat)) shopCat = 'Tout';
    $('#commander').hidden = !products().length;
    $('#shop-closed').hidden = shopOpen();
    $('#shop-pay').textContent = data.config.deliveryNote || '';
    $('#shop-cats').innerHTML = (cats.length > 1 ? ['Tout', ...cats] : []).map((c) =>
      `<button type="button" data-shopcat="${esc(c)}" class="${c === shopCat ? 'on' : ''}">${esc(c)}</button>`).join('');
    const shown = shopCat === 'Tout' ? cats : [shopCat];
    const itemHtml = (prod) => {
      const qty = cart[prod.id] || 0;
      const off = prod.available === false || !shopOpen();
      const action = off
        ? `<span class="chip">${prod.available === false ? 'Épuisé' : 'Fermé'}</span>`
        : qty
          ? `<span class="stepper"><button type="button" data-cart="${esc(prod.id)}" data-delta="-1" aria-label="Retirer">−</button><b>${qty}</b><button type="button" data-cart="${esc(prod.id)}" data-delta="1" aria-label="Ajouter" ${qty >= maxOf(prod) ? 'disabled' : ''}>+</button></span>`
          : `<button class="btn btn-sm" type="button" data-cart="${esc(prod.id)}" data-delta="1">Ajouter</button>`;
      return `<div class="item ${qty ? 'in-cart' : ''} ${off ? 'off' : ''}">
        <div><h4>${esc(prod.name)}</h4>${prod.desc ? `<p>${esc(prod.desc)}</p>` : ''}</div>
        <span class="limit">Offert<small>${maxOf(prod)} max. par commande</small></span>
        <div class="act">${action}</div>
      </div>`;
    };
    $('#products').innerHTML = shown.map((c) => {
      const items = products().filter((x) => (x.category || 'Autres') === c);
      return items.length ? `<div class="menu-cat"><h3>${esc(c)}</h3><div class="menu">${items.map(itemHtml).join('')}</div></div>` : '';
    }).join('') || '<div class="empty">Le catalogue arrive bientôt.</div>';
    const n = cartCount();
    $('#cart-count').textContent = n;
    if ($('#hero-facts').childElementCount) renderHeroFacts();
    $('#cart-fab').hidden = !n || !shopOpen() || view !== 'public';
  }

  function renderCart() {
    const lines = cartLines();
    $('#cart-items').innerHTML = lines.length ? lines.map((l) => `
      <div class="cart-line">
        <div><b>${esc(l.prod.name)}</b><small>${esc(l.prod.category || '')} · ${maxOf(l.prod)} max.</small></div>
        <span class="stepper"><button type="button" data-cart="${esc(l.prod.id)}" data-delta="-1" aria-label="Retirer">−</button><b>${l.qty}</b><button type="button" data-cart="${esc(l.prod.id)}" data-delta="1" aria-label="Ajouter" ${l.qty >= maxOf(l.prod) ? 'disabled' : ''}>+</button></span>
        <span class="line-total">Offert</span>
      </div>`).join('') + `<div class="cart-total"><span>${cartCount()} article${cartCount() > 1 ? 's' : ''}</span><span>Tout est offert</span></div>`
      : '<p class="cart-empty">Votre commande est vide. Ajoutez des articles depuis la boutique.</p>';
    $('#order-form').hidden = !lines.length;
  }

  function openCart() {
    $('#cart-step').hidden = false; $('#order-done').hidden = true;
    $('#order-status').textContent = '';
    renderCart();
    $('#cart').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('.drawer-x').focus(), 0);
  }
  function closeCart() {
    $('#cart').hidden = true;
    document.body.style.overflow = '';
  }
  $('#cart-fab').addEventListener('click', openCart);
  $('#cart').addEventListener('click', (e) => { if (e.target.closest('[data-close-cart]')) closeCart(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#cart').hidden) closeCart(); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cart]');
    if (b) { setQty(b.dataset.cart, (cart[b.dataset.cart] || 0) + Number(b.dataset.delta)); return; }
    const c = e.target.closest('[data-shopcat]');
    if (c) { shopCat = c.dataset.shopcat; renderShop(); }
  });

  const orderNumber = () => {
    const d = new Date();
    return `LQ-${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
  };

  $('#order-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const status = $('#order-status');
    status.className = 'note';
    const lines = cartLines();
    if (!lines.length) return;
    if (!form.reportValidity()) return;
    const id = orderNumber();
    const itemsText = lines.map((l) => `${l.qty} × ${l.prod.name}`).join('\n');
    const payload = {
      orderId: id,
      items: itemsText,
      itemsJson: JSON.stringify(lines.map((l) => ({ id: l.prod.id, name: l.prod.name, qty: l.qty }))),
      count: String(cartCount()),
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      where: form.where.value.trim(),
      when: form.when.value.trim() || 'Dès que possible',
      notes: form.notes.value.trim(),
      website: form.website.value,
      list: data.config.listName,
      sentAt: new Date().toISOString(),
    };
    const done = () => {
      cart = {}; saveCart(); form.reset();
      $('#cart-step').hidden = true;
      $('#order-done').hidden = false;
      $('#order-done').innerHTML = `<div class="done">
        <div class="done-badge">✓</div>
        <h4>Commande envoyée !</h4>
        <div class="order-no">${esc(id)}</div>
        <p class="muted">Un membre de la liste vous livre ${esc(payload.where)} (${esc(payload.when.toLowerCase())}).${payload.email ? ' Un récapitulatif part par e-mail.' : ''}</p>
        <div class="done-recap">${lines.map((l) => `<div class="cart-line" style="grid-template-columns:1fr auto"><b>${esc(l.prod.name)}</b><span>× ${l.qty}</span></div>`).join('')}</div>
        <button class="btn btn-ghost" type="button" data-close-cart>Fermer</button>
      </div>`;
      renderShop();
    };
    if (payload.website) { done(); return; } // robot : on fait semblant

    const hook = data.config.orderWebhook;
    if (!hook) {
      const mail = data.config.contactEmail;
      if (!mail) { status.className = 'note err'; status.textContent = "Les commandes ne sont pas encore ouvertes. Revenez très vite !"; return; }
      const body = [`Commande ${id}`, '', itemsText, '', `Nom : ${payload.name}`, `E-mail : ${payload.email}`, `Téléphone : ${payload.phone}`,
        `Où : ${payload.where}`, `Quand : ${payload.when}`, payload.notes ? `Précisions : ${payload.notes}` : ''].join('\n');
      location.href = `mailto:${encodeURIComponent(mail)}?subject=${encodeURIComponent(`[Commande ${id}] ${payload.name}`)}&body=${encodeURIComponent(body)}`;
      done();
      return;
    }
    const btn = $('#order-submit');
    btn.disabled = true;
    status.textContent = 'Envoi de la commande…';
    try {
      await postToWebhook(hook, payload);
      done();
    } catch {
      status.className = 'note err';
      status.innerHTML = data.config.contactEmail
        ? `La commande n'est pas partie. Réessayez, ou écrivez-nous à <a href="mailto:${esc(data.config.contactEmail)}">${esc(data.config.contactEmail)}</a>.`
        : "La commande n'est pas partie. Réessayez dans un instant.";
    } finally {
      btn.disabled = false;
    }
  });

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
        await postToWebhook(hook, { ...entry, list: data.config.listName });
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
  let savedCode = null;
  try { savedCode = sessionStorage.getItem(SESSION_KEY); } catch { /* ignore */ }
  let view = location.hash === '#liste' ? 'admin' : 'public';
  let currentTab = 'overview';
  let stockFilter = 'Tout';

  function setView(v) {
    view = v;
    $('#public-view').hidden = v !== 'public';
    $('#admin-view').hidden = v !== 'admin';
    $('#public-nav').style.visibility = v === 'public' ? 'visible' : 'hidden';
    $('#switch-btn').textContent = v === 'public' ? 'Espace liste' : 'Voir le site';
    renderShop();
    $('#login-box').hidden = isAdmin;
    $('#admin-app').hidden = !isAdmin;
    if (v === 'admin' && history.replaceState) history.replaceState(null, '', '#liste');
    if (v === 'public' && location.hash === '#liste') history.replaceState(null, '', location.pathname);
    window.scrollTo(0, 0);
  }
  $('#switch-btn').addEventListener('click', () => setView(view === 'public' ? 'admin' : 'public'));
  $('#footer-admin').addEventListener('click', () => setView('admin'));

  // Le code d'accès déchiffre la partie privée : un mauvais code ne donne rien.
  async function unlock(code) {
    const priv = window.JE_PRIVATE;
    if (priv) {
      const key = await deriveKey(code, priv.salt);
      const privData = await decryptPrivate(priv, key); // échoue si le code est faux
      crypt = { key, salt: priv.salt, code };
      return { ...PRIVATE_DEFAULTS, ...privData };
    }
    // Ancien format (code et données privées en clair dans data.js)
    if (!published.config.adminCode || code !== published.config.adminCode) throw new Error('Code incorrect');
    const salt = b64.fromBytes(crypto.getRandomValues(new Uint8Array(16)));
    crypt = { key: await deriveKey(code, salt), salt, code };
    const legacy = {};
    PRIVATE_KEYS.forEach((k) => { if (published[k] !== undefined) legacy[k] = published[k]; });
    return { ...PRIVATE_DEFAULTS, ...legacy };
  }
  async function login(code) {
    publishedPrivate = await unlock(code);
    const publishedFull = { ...clone(published), ...clone(publishedPrivate) };
    sync.base = clone(publishedFull);
    const draft = readDraft();
    data = draft ? merge3(draft.base || publishedFull, draft.data, publishedFull) : publishedFull;
    isAdmin = true;
    try { sessionStorage.setItem(SESSION_KEY, code); } catch { /* ignore */ }
    selectedDay = null;
    renderAll();
    if (token()) pullRemote();
  }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    $('#login-status').textContent = 'Vérification…';
    try {
      await login(form.code.value);
      form.reset();
      $('#login-status').textContent = '';
      setView('admin');
    } catch {
      $('#login-status').textContent = 'Code incorrect.';
    }
  });
  $('#logout-btn').addEventListener('click', () => {
    isAdmin = false; crypt = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    data = loadData();
    renderAll();
    setView('public');
  });

  function goTab(tab) {
    currentTab = tab;
    $$('#admin-tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  }
  $('#admin-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (b) goTab(b.dataset.tab);
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
    stockTab.innerHTML = `Stocks food${low ? `<span class="count">${low}</span>` : ''}`;
    renderSyncBanner();
  }

  function renderSyncBanner() {
    const el = $('#sync-banner');
    if (!token()) {
      const draft = readDraft();
      el.className = `banner ${draft ? 'warn' : ''}`;
      el.innerHTML = `<b>Mode local.</b> ${draft ? 'Vous avez des modifications enregistrées sur cet appareil seulement.' : 'Les modifications restent sur cet appareil.'}
        Pour qu'elles soient en ligne automatiquement pour tout le monde, <button class="link-btn" type="button" data-goto="settings">activez la publication automatique</button> (2 minutes).`;
      return;
    }
    const at = sync.at ? sync.at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
    const msg = {
      idle: ['ok', '<b>Publication automatique activée.</b> Chaque modification est mise en ligne pour tout le monde.'],
      loading: ['', 'Chargement de la dernière version publiée…'],
      pending: ['', 'Modification enregistrée, publication dans un instant…'],
      publishing: ['', 'Publication en cours…'],
      ok: ['ok', `<b>✓ Publié${at ? ` à ${at}` : ''}.</b> Le site est à jour pour tout le monde (visible en ligne d'ici une minute).`],
      error: ['warn', `<b>La publication a échoué :</b> ${esc(sync.error)} Vos modifications sont gardées sur cet appareil. <button class="link-btn" type="button" data-retry="1">Réessayer</button>`],
    }[sync.status] || ['', ''];
    el.className = `banner ${msg[0]}`;
    el.innerHTML = msg[1];
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

  // ---------- Stocks food ----------
  function stockState(st) {
    const q = Number(st.quantity); const th = Number(st.threshold);
    if (q <= 0) return { cls: 'out', chip: '<span class="chip bad dot">Rupture</span>', gauge: 'bad' };
    if (q <= th) return { cls: 'low', chip: '<span class="chip warn dot">À racheter</span>', gauge: 'warn' };
    return { cls: '', chip: '<span class="chip ok dot">OK</span>', gauge: '' };
  }
  const stockCats = () => [...new Set(data.stock.map((st) => st.category || 'Autre'))];
  function stockCard(st) {
    const q = Number(st.quantity); const th = Number(st.threshold);
    const state = stockState(st);
    const pct = Math.min(100, (q / Math.max(th * 3, q, 1)) * 100);
    const big = Math.max(1, Math.round(th / 2));
    return `<div class="stock-card ${state.cls}">
      <div class="top"><h4>${esc(st.name)}</h4>${state.chip}</div>
      <div class="qty">${esc(num(q))}<small>${esc(st.unit)}</small></div>
      <div class="gauge ${state.gauge}"><span style="width:${pct}%"></span></div>
      <span class="qty-ctl">
        <button type="button" data-step="-${big}" data-id="${st.id}">−${big}</button>
        <button type="button" data-step="-1" data-id="${st.id}">−</button>
        <input type="number" min="0" step="any" value="${esc(st.quantity)}" data-qty="${st.id}" aria-label="Quantité de ${esc(st.name)}">
        <button type="button" data-step="1" data-id="${st.id}">+</button>
        <button type="button" data-step="${big}" data-id="${st.id}">+${big}</button>
      </span>
      <div class="foot"><span>Alerte sous ${esc(num(th))} ${esc(st.unit)}</span><button class="del" type="button" data-del="stock" data-id="${esc(st.id)}">Supprimer</button></div>
    </div>`;
  }
  function renderStock() {
    const cats = stockCats();
    if (stockFilter !== 'Tout' && stockFilter !== 'À racheter' && !cats.includes(stockFilter)) stockFilter = 'Tout';
    const low = lowStock();
    $('#stock-filters').innerHTML = ['Tout', ...cats, 'À racheter'].map((c) =>
      `<button type="button" data-sfilter="${esc(c)}" class="${c === stockFilter ? 'on' : ''}">${esc(c)}${c === 'À racheter' && low.length ? ` (${low.length})` : ''}</button>`).join('');
    const byName = (a, b) => a.name.localeCompare(b.name, 'fr');
    let html;
    if (stockFilter === 'À racheter') {
      html = low.length ? `<div class="stock-grid">${[...low].sort(byName).map(stockCard).join('')}</div>` : '<div class="empty">Rien à racheter. 👌</div>';
    } else {
      const shown = stockFilter === 'Tout' ? cats : [stockFilter];
      html = shown.map((c) => `<div class="stock-cat">${esc(c)}</div><div class="stock-grid">${
        data.stock.filter((st) => (st.category || 'Autre') === c).sort(byName).map(stockCard).join('')}</div>`).join('')
        || '<div class="empty">Aucun produit. Ajoutez-en un ci-dessous.</div>';
    }
    $('#stock-list').innerHTML = html;
    $('#stock-cats').innerHTML = [...new Set(['Food', 'Boissons', 'Matériel', ...cats])].map((c) => `<option>${esc(c)}</option>`).join('');
    $('#shopping').textContent = low.length
      ? low.map((st) => `${st.name} : ${Math.max(1, Number(st.threshold) * 2 - Number(st.quantity))} ${st.unit}`).join(' · ')
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

  // ---------- Où sont les membres ----------
  const knownPlaces = () => [...new Set([...data.events, ...data.food].map((x) => x.place)
    .concat(data.members.map((m) => m.location)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const sinceText = (iso) => {
    if (!iso) return 'Jamais mis à jour';
    const min = Math.round((Date.now() - new Date(iso)) / 60000);
    if (min < 1) return "Mis à jour à l'instant";
    if (min < 60) return `Mis à jour il y a ${min} min`;
    if (min < 24 * 60) return `Mis à jour il y a ${Math.floor(min / 60)} h`;
    return `Mis à jour ${new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}`;
  };
  function statusSummary() {
    const counts = {};
    data.members.forEach((m) => { counts[m.status] = (counts[m.status] || 0) + 1; });
    return Object.entries(STATUS).filter(([k]) => counts[k])
      .map(([k, v]) => `<span class="chip ${v.cls} dot">${counts[k]} ${esc(v.label.toLowerCase())}</span>`).join('');
  }
  function renderMembersAdmin() {
    $('#places').innerHTML = knownPlaces().map((pl) => `<option value="${esc(pl)}">`).join('');
    $('#members-summary').innerHTML = statusSummary();
    $('#members-list').innerHTML = data.members.map((m) => `
      <div class="admin-member">
        <div class="member-top">
          <div class="avatar ${esc(m.status)}" style="background:${avatarColor(m.name)}">${esc(initials(m.name))}</div>
          <div><h3 style="font:600 1rem/1.25 var(--sans)">${esc(m.name)}</h3><div class="role">${esc(m.role)}</div></div>
        </div>
        <div class="status-pills" role="group" aria-label="Statut de ${esc(m.name)}">${Object.entries(STATUS).map(([k, v]) =>
          `<button type="button" class="${m.status === k ? `on ${v.cls}` : ''}" data-mstatus="${k}" data-id="${m.id}">${esc(v.label.replace('Hors campus', 'Absent·e'))}</button>`).join('')}</div>
        <label class="loc-field">${ICON.pin}<input list="places" value="${esc(m.location)}" data-member="${m.id}" data-field="location" placeholder="Où es-tu ?" aria-label="Position de ${esc(m.name)}"></label>
        <div class="foot"><span>${esc(sinceText(m.updatedAt))}</span>
          <span style="display:flex;gap:8px;align-items:center"><input type="tel" value="${esc(m.phone)}" data-member="${m.id}" data-field="phone" placeholder="Téléphone" aria-label="Téléphone de ${esc(m.name)}">
          <button class="del" type="button" data-del="member" data-id="${esc(m.id)}" style="border:0;background:none;color:var(--ink-3);cursor:pointer;text-decoration:underline;font:0.76rem var(--sans)">Suppr.</button></span></div>
      </div>`).join('');
  }

  // ---------- Aperçu ----------
  function renderOverview() {
    // Stocks : d'abord ce qui manque, puis le reste
    const low = lowStock();
    const rest = data.stock.filter((st) => !low.includes(st)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const stockRows = [...low, ...rest].slice(0, 7).map((st) => {
      const state = stockState(st);
      return `<div class="ov-row"><div><b>${esc(st.name)}</b> ${state.cls ? state.chip : ''}<span class="sub">${esc(num(Number(st.quantity)))} ${esc(st.unit)} · alerte sous ${esc(num(Number(st.threshold)))}</span></div>
        <span class="qty-ctl"><button type="button" data-step="-1" data-id="${st.id}">−</button><button type="button" data-step="1" data-id="${st.id}">+</button></span></div>`;
    }).join('');
    $('#ov-stock').innerHTML = data.stock.length
      ? `<div class="ov-list">${stockRows}</div>${data.stock.length > 7 ? `<p class="faint" style="margin:10px 0 0">+ ${data.stock.length - 7} autres produits dans « Stocks food ».</p>` : ''}`
      : '<p class="ov-empty">Aucun produit en stock.</p>';

    // Équipe : statut et position modifiables directement
    const order = { dispo: 0, occupe: 1, pause: 2, absent: 3 };
    $('#ov-team').innerHTML = `<div class="team-bar" style="margin-bottom:6px">${statusSummary()}</div><div class="ov-list">` +
      [...data.members].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)).map((m) => `
      <div class="ov-person">
        <div class="avatar ${esc(m.status)}" style="background:${avatarColor(m.name)}">${esc(initials(m.name))}</div>
        <div><b style="font-weight:600;font-size:0.92rem">${esc(m.name)}</b>
          <input list="places" value="${esc(m.location)}" data-member="${m.id}" data-field="location" placeholder="Où es-tu ?" aria-label="Position de ${esc(m.name)}"></div>
        <select data-member="${m.id}" data-field="status" aria-label="Statut de ${esc(m.name)}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${m.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      </div>`).join('') + '</div>';

    // Food : les stands du jour, sinon le prochain
    let stands = data.food.filter((f) => f.date === todayIso).sort(byTime);
    let title = "Food aujourd'hui";
    if (!stands.length) {
      const next = data.food.filter((f) => f.date > todayIso).sort(byTime)[0];
      if (next) { stands = [next]; title = `Prochain stand · ${fmtLong(next.date)}`; }
    }
    $('#ov-food-title').textContent = title;
    $('#ov-food').innerHTML = stands.length ? '<div class="ov-list">' + stands.map((f) => {
      const lv = foodLevel(f);
      return `<div class="ov-row"><div><b>${esc(f.name)}</b> <span class="chip ${lv.cls || 'ok'} dot">${num(lv.left)} / ${num(f.planned)} restantes</span>
          <span class="sub">${esc(hours(f.start, f.end))} · ${esc(f.place)}</span></div>
        <span class="qty-ctl"><button type="button" data-serve="-10" data-id="${f.id}">−10</button><button type="button" data-serve="1" data-id="${f.id}">+1</button><button type="button" data-serve="10" data-id="${f.id}">+10 servies</button></span></div>`;
    }).join('') + '</div>' : '<p class="ov-empty">Aucun stand prévu.</p>';
  }

  function renderShopAdmin() {
    const f = $('#shop-form');
    if (!f.contains(document.activeElement)) {
      f.ordersOpen.checked = data.config.ordersOpen !== false;
      f.orderWebhook.value = data.config.orderWebhook || '';
      f.deliveryNote.value = data.config.deliveryNote || '';
    }
    $('#product-cats').innerHTML = [...new Set(['Boissons', 'Food', 'Services', ...productCats()])].map((c) => `<option>${esc(c)}</option>`).join('');
    $('#products-table').innerHTML = '<tr><th>Produit</th><th>Catégorie</th><th>Description</th><th>Max / commande</th><th>Dispo</th><th></th></tr>' + products().map((x) => `
      <tr><td><input value="${esc(x.name)}" data-product="${x.id}" data-field="name"></td>
        <td><input value="${esc(x.category)}" data-product="${x.id}" data-field="category" list="product-cats" style="width:120px"></td>
        <td><input value="${esc(x.desc)}" data-product="${x.id}" data-field="desc"></td>
        <td><input type="number" min="1" max="50" value="${esc(maxOf(x))}" data-product="${x.id}" data-field="max" style="width:80px"></td>
        <td><input type="checkbox" ${x.available !== false ? 'checked' : ''} data-product="${x.id}" data-field="available" aria-label="Disponible"></td>
        <td class="num">${delBtn('product', x.id)}</td></tr>`).join('');
  }

  function renderSettings() {
    const f = $('#settings-form');
    ['listName', 'tagline', 'campaignStart', 'campaignDays', 'contactEmail', 'instagram', 'signupWebhook'].forEach((k) => { f[k].value = data.config[k] ?? ''; });
    if (document.activeElement !== f.adminCode) f.adminCode.value = crypt ? crypt.code : '';
    const r = ghRepo();
    $('#github-repo').textContent = `${r.owner}/${r.repo}`;
    $('#github-state').textContent = token() ? 'Activée sur cet appareil.' : 'Désactivée sur cet appareil.';
    $('#github-off').hidden = !token();
    f.budgetCap.value = data.budgetCap ?? '';
  }

  function renderAdmin() {
    if (!isAdmin) return;
    // Ne pas écraser un champ en cours de saisie
    const active = document.activeElement;
    if (active && active.matches('#admin-app [data-member], #admin-app [data-qty], #admin-app [data-food], #admin-app [data-product]')) return;
    renderKpis(); renderOverview(); renderBudget(); renderStock(); renderEmails(); renderFoodAdmin(); renderShopAdmin(); renderEventsAdmin(); renderMembersAdmin(); renderSettings();
  }

  function renderPublic() {
    renderHeader(); renderHeroFacts(); renderDays(); renderAgenda(); renderFoodGrid(); renderServices(); renderMembersPublic(); renderShop(); renderQuick();
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
    data.stock.push({ id: uid('k'), ...d, category: d.category.trim() || 'Autre', quantity: Number(d.quantity), threshold: Number(d.threshold) });
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
    const t = e.target.closest('button') || e.target;
    if (t.dataset.retry) { publishNow(); return; }
    if (t.dataset.goto) { goTab(t.dataset.goto); window.scrollTo({ top: $('#admin-tabs').offsetTop - 80, behavior: 'smooth' }); return; }
    if (t.dataset.sfilter) { stockFilter = t.dataset.sfilter; renderStock(); return; }
    if (t.dataset.mstatus) {
      const m = findIn('members', t.dataset.id); m.status = t.dataset.mstatus; m.updatedAt = new Date().toISOString(); save(); return;
    }
    if (t.dataset.del) {
      const map = { budget: 'budget', stock: 'stock', food: 'food', event: 'events', service: 'services', member: 'members', campaign: 'campaigns', product: 'products' };
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
    if (t.dataset.product) {
      const x = findIn('products', t.dataset.product);
      x[t.dataset.field] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Math.max(1, Number(t.value) || 1) : t.value;
      t.blur(); save(); return;
    }
    if (t.dataset.qty) { findIn('stock', t.dataset.qty).quantity = Math.max(0, Number(t.value) || 0); t.blur(); save(); }
    if (t.dataset.food) { findIn('food', t.dataset.food)[t.dataset.field] = Math.max(0, Number(t.value) || 0); t.blur(); save(); }
    if (t.dataset.member) {
      const m = findIn('members', t.dataset.member); m[t.dataset.field] = t.value; m.updatedAt = new Date().toISOString(); t.blur(); save();
    }
  });

  $('#shop-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    data.config = { ...data.config, ordersOpen: f.ordersOpen.checked, orderWebhook: f.orderWebhook.value.trim(), deliveryNote: f.deliveryNote.value.trim() };
    save();
    $('#shop-status').textContent = token() ? 'Enregistré et publié.' : 'Enregistré sur cet appareil.';
  });
  $('#product-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(e.target);
    if (!Array.isArray(data.products)) data.products = [];
    data.products.push({ id: uid('p'), name: d.name.trim(), category: d.category.trim() || 'Autres', desc: d.desc.trim(), max: Math.max(1, Number(d.max) || 1), available: true });
    e.target.reset(); save();
  });

  $('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    // Nouveau code : on rechiffre la partie privée avec une nouvelle clé
    const newCode = (d.adminCode || '').trim(); delete d.adminCode;
    if (newCode && crypt && newCode !== crypt.code) {
      if (newCode.length < 8) { $('#settings-status').textContent = 'Le code doit faire au moins 8 caractères.'; return; }
      const salt = b64.fromBytes(crypto.getRandomValues(new Uint8Array(16)));
      crypt = { key: await deriveKey(newCode, salt), salt, code: newCode };
      try { sessionStorage.setItem(SESSION_KEY, newCode); } catch { /* ignore */ }
    }
    data.budgetCap = Number(d.budgetCap) || 0; delete d.budgetCap;
    data.config = { ...data.config, ...d, campaignDays: Number(d.campaignDays) };
    selectedDay = null; save();
    $('#settings-status').textContent = token() ? 'Réglages enregistrés et publiés.' : 'Réglages enregistrés sur cet appareil.';
  });
  $('#reset-btn').addEventListener('click', () => {
    if (!confirm('Effacer les modifications non publiées de cet appareil et revenir à la version en ligne ?')) return;
    clearDraft(); data = { ...clone(published), ...clone(publishedPrivate) }; selectedDay = null; renderAll();
    if (token()) pullRemote();
  });

  // Clé GitHub (propre à chaque appareil, jamais publiée)
  $('#github-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('#github-status');
    const value = e.target.token.value.trim();
    if (!value) return;
    storage.set(TOKEN_KEY, value);
    status.textContent = 'Vérification de la clé…';
    try {
      await gh('GET');
      e.target.reset();
      status.textContent = '✓ Clé valide. La publication automatique est activée sur cet appareil.';
      renderSettings(); await pullRemote();
      if (readDraft()) schedulePublish(0);
    } catch (err) {
      storage.remove(TOKEN_KEY);
      status.textContent = `Clé refusée : ${err.message}`;
    }
    renderSyncBanner();
  });
  $('#github-off').addEventListener('click', () => {
    storage.remove(TOKEN_KEY);
    $('#github-status').textContent = 'Publication automatique désactivée sur cet appareil.';
    renderSettings(); renderSyncBanner();
  });

  // Export / import
  $('#export-btn').addEventListener('click', async () => {
    const { text } = await buildFile(clone(data));
    download('data.js', text, 'text/javascript');
  });
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    try {
      let imported;
      if (text.includes('window.JE_DATA')) {
        const { pub, priv } = parseFile(text);
        imported = { ...pub, ...(priv ? await decryptPrivate(priv, (await deriveKey(crypt.code, priv.salt))) : {}) };
      } else {
        imported = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      }
      if (!imported.config || !Array.isArray(imported.events)) throw new Error();
      delete imported.publishedAt;
      data = { ...data, ...imported }; selectedDay = null; save();
      alert('Données importées.');
    } catch { alert("Fichier non reconnu : importez un data.js ou un .json exporté depuis l'Espace liste."); }
    e.target.value = '';
  });

  // Synchronisation entre onglets ouverts sur le même appareil (ex. tablette du stand)
  window.addEventListener('storage', (e) => {
    if (e.key !== STORE_KEY || !isAdmin) return;
    const draft = readDraft(); if (draft) { data = draft.data; renderAll(); }
  });

  // Les écrans publics se mettent à jour tout seuls quand la liste publie
  async function refreshPublished() {
    if (isAdmin || document.hidden) return;
    try {
      const res = await fetch(`data.js?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const text = await res.text();
      const { pub, priv } = parseFile(text);
      if (pub.publishedAt && pub.publishedAt !== published.publishedAt) {
        published = pub; window.JE_PRIVATE = priv || undefined;
        data = loadData(); renderPublic();
      }
    } catch { /* hors ligne : on réessaiera */ }
  }
  setInterval(refreshPublished, 90000);

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
  setInterval(() => { if (view === 'public') { renderAgenda(); renderQuick(); } }, 60000);
  setInterval(() => { if (view === 'public' && !document.hidden) renderCountdown(); }, 1000);

  renderAll();
  setView(view);
  if (savedCode) {
    login(savedCode).then(() => setView(view)).catch(() => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } });
  }
})();
