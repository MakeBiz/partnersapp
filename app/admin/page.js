'use client';
/**
 * Админка партнёрки: список партнёров, статус заведения, мастер «Новый партнёр».
 * Роли admin и assistant. Данные из /api/admin/partners.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LOGO_SVG } from '../_ui/logo.js';
import '../ui.css';

const AUDIT_LABELS = {
  create_partner: 'завёл партнёра',
  new_invite: 'новая ссылка-приглашение',
  retry_jobs: 'повтор шагов',
};

const nf = new Intl.NumberFormat('ru-RU');
const money = (v) => `${nf.format(Math.round(Number(v) || 0))} ₽`;
const date = (d) => (d ? new Date(d).toLocaleDateString('ru-RU') : '');

const STEP_LABEL = { crm: 'CRM', chat: 'Чат', email: 'Письмо', cabinet: 'Вход' };
const STEP_TITLE = {
  crm: 'Контакт в Битриксе',
  chat: 'Группа в Telegram',
  email: 'Письмо с приглашением',
  cabinet: 'Партнёр вошёл в кабинет',
};
const ICON = { done: '✓', failed: '!', pending: '…', running: '…', none: '–', skipped: '–', waiting: '–' };
const STATE_TEXT = {
  done: 'готово', failed: 'ошибка', pending: 'в очереди', running: 'выполняется',
  none: 'не запускалось', skipped: 'пропущено', waiting: 'ещё не входил',
};
// «Вход» — не задача очереди, а ожидание партнёра
const shown = (k, s) => (k === 'cabinet' && s === 'pending' ? 'waiting' : s);

async function api(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (r.status === 401) { window.location.href = '/login?next=/admin'; throw new Error('unauthorized'); }
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: j };
}

function Chips({ onboarding }) {
  return (
    <div className="chips">
      {Object.entries(STEP_LABEL).map(([k, label]) => {
        const s = shown(k, onboarding?.[k]?.state || 'none');
        return <span key={k} className={`chip ${s}`} title={STATE_TEXT[s]}>{ICON[s]} {label}</span>;
      })}
    </div>
  );
}

function CopyField({ value }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mb-copy">
      <input className="mb-input" readOnly value={value} onFocus={(e) => e.target.select()} />
      <button className="mb-btn sm" type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ }
      }}>{done ? 'Скопировано' : 'Копировать'}</button>
    </div>
  );
}

function Steps({ onboarding }) {
  return (
    <div className="steps">
      {Object.keys(STEP_TITLE).map((k) => {
        const s = onboarding?.[k] || { state: 'none' };
        const st = shown(k, s.state);
        let detail = STATE_TEXT[st];
        if (k === 'chat' && s.result?.inviteLink) detail = `ссылка в группу: ${s.result.inviteLink}`;
        if (k === 'chat' && s.result?.notAdded?.length) detail += ` · не добавились сами: ${s.result.notAdded.join(', ')} (им ушла ссылка)`;
        if (k === 'crm' && s.result?.contactId) detail = `контакт #${s.result.contactId}${s.result.dealId ? `, сделка #${s.result.dealId}` : ''}`;
        if (st === 'failed' && s.error) detail = `ошибка: ${s.error}`;
        if (st === 'pending' && s.attempts > 0 && s.error) detail = `повтор, прошлая попытка: ${s.error}`;
        return (
          <div key={k} className={`step ${st}`}>
            <div className="ic">{ICON[st]}</div>
            <div><b>{STEP_TITLE[k]}</b><div className="d">{detail}</div></div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Мастер «Новый партнёр» ---------------- */

const EMPTY = {
  name: '', phone: '', email: '', telegram: '', portal: 'main', payer: 'Физлицо (карта)',
  uplineRefcode: '', note: '', createChat: true, sendEmail: true,
};

function NewPartner({ portals, payers, onClose, onCreated }) {
  const [f, setF] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [dups, setDups] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });

  async function submit(force = false) {
    setBusy(true); setErrors({}); setFail('');
    try {
      const { ok, status, data } = await api('/api/admin/partners', {
        method: 'POST', body: JSON.stringify({ ...f, force }),
      });
      if (ok) { onCreated(data); return; }
      if (status === 422) setErrors(data.fields || {});
      else if (status === 409 && data.duplicates) setDups(data.duplicates);
      else if (status === 409) setFail('Такой партнёр уже есть (совпала почта или логин)');
      else setFail('Не получилось завести партнёра. Попробуйте ещё раз');
    } finally { setBusy(false); }
  }

  const E = ({ k }) => (errors[k] ? <div className="mb-err">{errors[k]}</div> : null);

  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <aside className="drawer">
        <div className="hd"><h2>Новый партнёр</h2><button className="x" onClick={onClose}>×</button></div>
        <div className="bd">
          <label className="mb-label">Где ведём партнёра</label>
          <div className="mb-seg">
            {Object.entries(portals).map(([k, label]) => (
              <button key={k} type="button" className={f.portal === k ? 'on' : ''} onClick={() => set('portal')(k)}>{label}</button>
            ))}
          </div>

          <label className="mb-label">Имя и фамилия</label>
          <input className="mb-input" value={f.name} onChange={set('name')} placeholder="Игорь Соколов" autoFocus />
          <E k="name" />

          <div className="row2">
            <div>
              <label className="mb-label">Телефон</label>
              <input className="mb-input" value={f.phone} onChange={set('phone')} placeholder="+7 916 123-45-67" />
              <E k="phone" />
            </div>
            <div>
              <label className="mb-label">Ник в Telegram</label>
              <input className="mb-input" value={f.telegram} onChange={set('telegram')} placeholder="@username" />
              <E k="telegram" />
            </div>
          </div>

          <label className="mb-label">Почта <span className="opt">(на неё уйдёт приглашение в кабинет)</span></label>
          <input className="mb-input" value={f.email} onChange={set('email')} placeholder="partner@company.ru" />
          <E k="email" /><E k="contact" />

          <div className="row2">
            <div>
              <label className="mb-label">Форма выплаты</label>
              <select className="mb-select" value={f.payer} onChange={set('payer')}>
                {payers.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-label">Кто пригласил <span className="opt">(реф-код)</span></label>
              <input className="mb-input" value={f.uplineRefcode} onChange={set('uplineRefcode')} placeholder="MKB-ISOK-4213" />
              <E k="uplineRefcode" />
            </div>
          </div>

          <label className="mb-label">Заметка <span className="opt">(видна только команде)</span></label>
          <textarea className="mb-textarea" value={f.note} onChange={set('note')} placeholder="Откуда пришёл, с какими клиентами работает" />

          <label className="check"><input type="checkbox" checked={f.createChat} onChange={set('createChat')} /> Создать группу в Telegram (ты, ассистент, бот, партнёр)</label>
          <label className="check"><input type="checkbox" checked={f.sendEmail} onChange={set('sendEmail')} /> Отправить приглашение в кабинет на почту</label>

          {dups && (
            <div className="mb-alert warn">
              Похожий партнёр уже есть:
              {dups.map((d) => (
                <div key={d.id} className="dup"><b>{d.name}</b> · {d.refcode}<br />
                  <span style={{ color: 'var(--muted)' }}>{[d.phone, d.email, d.telegram_username && `@${d.telegram_username}`].filter(Boolean).join(' · ')}</span>
                </div>
              ))}
              <button className="mb-btn sm" style={{ marginTop: 10 }} disabled={busy} onClick={() => submit(true)}>Всё равно завести</button>
            </div>
          )}
          {fail && <div className="mb-alert err">{fail}</div>}
        </div>
        <div className="ft">
          <button className="mb-btn" onClick={onClose}>Отмена</button>
          <button className="mb-btn primary" disabled={busy} onClick={() => submit(false)}>{busy ? 'Заводим…' : 'Завести партнёра'}</button>
        </div>
      </aside>
    </>
  );
}

/* ---------------- Карточка партнёра ---------------- */

function PartnerCard({ id, portals, onClose, onChanged, justCreated }) {
  const [d, setD] = useState(null);
  const [invite, setInvite] = useState(justCreated?.inviteUrl || null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { ok, data } = await api(`/api/admin/partners/${id}`);
    if (ok) setD(data);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Пока что-то в очереди, обновляем статусы раз в 3 секунды
  const inFlight = d && Object.values(d.onboarding).some((s) => s.state === 'pending' || s.state === 'running');
  useEffect(() => {
    if (!inFlight) return undefined;
    const t = setInterval(() => { load(); onChanged(); }, 3000);
    return () => clearInterval(t);
  }, [inFlight, load, onChanged]);

  async function retry() {
    setBusy(true);
    await api(`/api/admin/partners/${id}/retry`, { method: 'POST' });
    await load(); onChanged(); setBusy(false);
  }
  async function newInvite(sendEmail) {
    setBusy(true);
    const { ok, data } = await api(`/api/admin/partners/${id}/invite`, { method: 'POST', body: JSON.stringify({ sendEmail }) });
    if (ok) setInvite(data.inviteUrl);
    await load(); setBusy(false);
  }

  const p = d?.partner;
  const hasFailed = d && Object.values(d.onboarding).some((s) => s.state === 'failed');

  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <aside className="drawer">
        <div className="hd"><h2>{p ? p.name : 'Партнёр'}</h2><button className="x" onClick={onClose}>×</button></div>
        <div className="bd">
          {!d && <p className="lead">Загружаем…</p>}
          {justCreated && <div className="mb-alert ok">Партнёр заведён. CRM, чат и письмо делаются в фоне, статусы ниже обновляются сами</div>}
          {p && (
            <>
              <div className="kv">
                <span className="k">Реф-код</span><b>{p.refcode}</b>
                <span className="k">Портал</span><span><span className={`tag ${p.bitrix_portal}`}>{portals[p.bitrix_portal]}</span></span>
                <span className="k">Телефон</span><span>{p.phone || '—'}</span>
                <span className="k">Почта</span><span>{p.email || '—'}</span>
                <span className="k">Telegram</span><span>{p.telegram_username ? `@${p.telegram_username}` : '—'}</span>
                <span className="k">Выплата</span><span>{p.payer} · коэф. {p.pay_ratio}</span>
                <span className="k">Пригласил</span><span>{p.upline_name ? `${p.upline_name} (${p.upline_refcode})` : '—'}</span>
                {p.note && (<><span className="k">Заметка</span><span>{p.note}</span></>)}
              </div>

              <div className="sect">Заведение</div>
              <Steps onboarding={d.onboarding} />
              {hasFailed && <button className="mb-btn sm" style={{ marginTop: 12 }} disabled={busy} onClick={retry}>Повторить упавшие шаги</button>}
              {p.telegram_invite && (<><div className="sect">Ссылка в группу</div><CopyField value={p.telegram_invite} /></>)}

              <div className="sect">Приглашение в кабинет</div>
              {invite
                ? (<><p className="lead" style={{ fontSize: 13 }}>Ссылку можно отправить партнёру вручную, действует 7 дней</p><CopyField value={invite} /></>)
                : <p className="lead" style={{ fontSize: 13 }}>{d.onboarding.cabinet.state === 'done' ? 'Партнёр уже задал пароль и входит сам' : 'Ссылка отправлена. Если потерялась, сделайте новую'}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="mb-btn sm" disabled={busy} onClick={() => newInvite(false)}>Новая ссылка</button>
                {p.email && <button className="mb-btn sm" disabled={busy} onClick={() => newInvite(true)}>Новая ссылка + письмо</button>}
              </div>

              {d.audit.length > 0 && (
                <>
                  <div className="sect">Журнал</div>
                  <div className="audit">
                    {d.audit.map((a, i) => <div key={i}>{new Date(a.created_at).toLocaleString('ru-RU')} · {a.admin_name || 'система'} · {AUDIT_LABELS[a.action] || a.action}</div>)}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

/* ---------------- Страница ---------------- */

export default function AdminPage() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [created, setCreated] = useState(null);
  const qRef = useRef(q);
  qRef.current = q;

  const load = useCallback(async () => {
    const qs = qRef.current ? `?q=${encodeURIComponent(qRef.current)}` : '';
    const { ok, data: j } = await api(`/api/admin/partners${qs}`);
    if (ok) setData(j);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [q, load]);

  const s = data?.stats;
  const kpis = useMemo(() => (s ? [
    [s.partners, 'партнёров'],
    [s.new_30d, 'новых за 30 дней'],
    [s.active_90d, 'с лидами за 90 дней'],
    [s.productive_90d, 'со сделками за 90 дней'],
    [money(s.payable), 'к выплате'],
    [s.failed_jobs, 'ошибок заведения', s.failed_jobs > 0],
  ] : []), [s]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <div className="adm">
      <header className="adm-top">
        <div className="in">
          <span className="mb-logo" dangerouslySetInnerHTML={{ __html: LOGO_SVG }} />
          <span className="title">Партнёрская программа</span>
          <span className="sp" />
          {data?.me && <span className="who"><b>{data.me.name || data.me.login}</b> · {data.me.role === 'admin' ? 'админ' : 'ассистент'}</span>}
          <button className="mb-btn sm ghost" onClick={logout}>Выйти</button>
        </div>
      </header>

      <main className="adm-main">
        <h1>Партнёры</h1>
        <p className="lead">Заведение, статусы и результаты партнёров по обоим порталам</p>

        <div className="kpi-row">
          {kpis.map(([n, l, bad]) => <div key={l} className={`kpi ${bad ? 'bad' : ''}`}><div className="n">{n}</div><div className="l">{l}</div></div>)}
        </div>

        <div className="toolbar">
          <input className="mb-input" placeholder="Поиск: имя, реф-код, почта, телефон, @ник" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="sp" />
          <button className="mb-btn primary" onClick={() => setShowNew(true)}>+ Новый партнёр</button>
        </div>

        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Партнёр</th><th>Контакты</th><th>Портал</th><th>Заведение</th><th>Лиды</th><th>Сделки</th><th>Заработал</th><th>Добавлен</th></tr>
            </thead>
            <tbody>
              {data?.partners.map((p) => (
                <tr key={p.id} onClick={() => { setCreated(null); setOpenId(p.id); }}>
                  <td><div className="nm">{p.name || '—'}</div><div className="mb-sub">{p.refcode}{p.upline_name ? ` · от ${p.upline_name}` : ''}</div></td>
                  <td><div>{p.phone || '—'}</div><div className="mb-sub">{[p.email, p.telegram_username && `@${p.telegram_username}`].filter(Boolean).join(' · ')}</div></td>
                  <td><span className={`tag ${p.bitrix_portal}`}>{data.portals[p.bitrix_portal]}</span></td>
                  <td><Chips onboarding={p.onboarding} /></td>
                  <td className="mb-num">{p.leads}</td>
                  <td className="mb-num">{p.deals}</td>
                  <td className="mb-num">{money(p.earned)}</td>
                  <td className="mb-num">{date(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.partners.length === 0 && <div className="empty">{q ? 'Никого не нашли' : 'Партнёров пока нет. Заведите первого кнопкой «Новый партнёр»'}</div>}
          {!data && <div className="empty">Загружаем…</div>}
        </div>
      </main>

      {showNew && data && (
        <NewPartner portals={data.portals} payers={data.payers} onClose={() => setShowNew(false)}
          onCreated={(res) => { setShowNew(false); setCreated(res); setOpenId(res.partner.id); load(); }} />
      )}
      {openId && data && (
        <PartnerCard id={openId} portals={data.portals} justCreated={created}
          onClose={() => { setOpenId(null); setCreated(null); }} onChanged={load} />
      )}
    </div>
  );
}
