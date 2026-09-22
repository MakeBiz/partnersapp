'use client';
/** Приглашение: партнёр сам задаёт пароль и сразу попадает в кабинет. */
import { useEffect, useState } from 'react';
import { LOGO_SVG } from '../../_ui/logo.js';
import '../../ui.css';

const STATE = {
  used: 'Эта ссылка уже использована. Войдите с паролем, который вы задали.',
  expired: 'Срок ссылки истёк. Попросите менеджера MakeBiz прислать новую.',
  not_found: 'Ссылка недействительна. Попросите менеджера MakeBiz прислать новую.',
};

export default function InvitePage({ params }) {
  const [info, setInfo] = useState(null);
  const [bad, setBad] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/invite/${params.token}`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (r.ok) setInfo(j); else setBad(STATE[j.error] || STATE.not_found);
    });
  }, [params.token]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (pw.length < 8) return setError('Пароль должен быть не короче 8 символов');
    if (pw !== pw2) return setError('Пароли не совпадают');
    setBusy(true);
    try {
      const r = await fetch(`/api/invite/${params.token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setError(STATE[j.error] || 'Не получилось сохранить пароль');
      window.location.href = j.redirect || '/';
    } finally { setBusy(false); }
  }

  return (
    <section className="auth">
      <div className="auth-card">
        <div className="mb-logo" dangerouslySetInnerHTML={{ __html: LOGO_SVG }} />
        {bad && (<><h1>Ссылка не работает</h1><div className="mb-alert warn">{bad}</div>
          <a className="mb-btn block" style={{ marginTop: 18 }} href="/login">Ко входу</a></>)}
        {!bad && !info && <p className="sub" style={{ marginTop: 24 }}>Проверяем ссылку…</p>}
        {info && (
          <form onSubmit={submit}>
            <h1>Добро пожаловать, {info.name?.split(' ')[0] || 'партнёр'}</h1>
            <p className="sub">Задайте пароль для входа в личный кабинет партнёра MakeBiz.
              {info.email ? <> Логин для входа: <b>{info.email}</b></> : null}</p>
            <label className="mb-label" htmlFor="pw">Пароль <span className="opt">(от 8 символов)</span></label>
            <input id="pw" type="password" className="mb-input" autoComplete="new-password"
                   value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            <label className="mb-label" htmlFor="pw2">Повторите пароль</label>
            <input id="pw2" type="password" className="mb-input" autoComplete="new-password"
                   value={pw2} onChange={(e) => setPw2(e.target.value)} />
            {error && <div className="mb-alert err">{error}</div>}
            <button className="mb-btn primary block" style={{ marginTop: 20 }} disabled={busy}>
              {busy ? 'Сохраняем…' : 'Сохранить и войти'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
