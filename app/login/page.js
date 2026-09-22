'use client';
/** Вход: команда MakeBiz (логин) и партнёры (почта) — одна форма. */
import { useState } from 'react';
import { LOGO_SVG } from '../_ui/logo.js';
import '../ui.css';

const ERR = {
  invalid_credentials: 'Неверный логин или пароль',
  missing_credentials: 'Введите логин и пароль',
};

export default function LoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(ERR[j.error] || 'Не получилось войти, попробуйте ещё раз'); return; }
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.href = j.type === 'admin' && next && next.startsWith('/') ? next : j.redirect;
    } finally { setBusy(false); }
  }

  return (
    <section className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="mb-logo" dangerouslySetInnerHTML={{ __html: LOGO_SVG }} />
        <h1>Вход в кабинет</h1>
        <p className="sub">Партнёрам — почта из приглашения. Команде MakeBiz — рабочий логин.</p>
        <label className="mb-label" htmlFor="login">Почта или логин</label>
        <input id="login" className="mb-input" autoComplete="username" value={login}
               onChange={(e) => setLogin(e.target.value)} autoFocus />
        <label className="mb-label" htmlFor="pw">Пароль</label>
        <input id="pw" type="password" className="mb-input" autoComplete="current-password"
               value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="mb-alert err">{error}</div>}
        <button className="mb-btn primary block" style={{ marginTop: 20 }} disabled={busy}>
          {busy ? 'Входим…' : 'Войти'}
        </button>
        <p className="hint">Нет пароля? Ссылку для входа присылает ваш менеджер MakeBiz в чат или на почту.</p>
      </form>
    </section>
  );
}
