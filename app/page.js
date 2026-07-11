'use client';
import { useEffect, useRef } from 'react';
import { BODY_HTML, APP_SCRIPT } from './_cabinet.js';

export default function Page() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    let cancelled = false;
    (async () => {
      try {
        const [me, dl] = await Promise.all([
          fetch('/api/me').then((r) => r.json()),
          fetch('/api/deals').then((r) => r.json()),
        ]);
        if (!cancelled) window.__DATA__ = { partner: me, deals: dl };
      } catch (e) { /* fall back to embedded data */ }
      if (cancelled) return;
      const s = document.createElement('script');
      s.textContent = APP_SCRIPT;
      document.body.appendChild(s);
    })();
    return () => { cancelled = true; };
  }, []);
  return <div id="cabinet-root" dangerouslySetInnerHTML={{ __html: BODY_HTML }} />;
}
