'use client';
import { useEffect, useRef } from 'react';
import { BODY_HTML, APP_SCRIPT } from './_cabinet.js';

export default function Page() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const s = document.createElement('script');
    s.textContent = APP_SCRIPT;
    document.body.appendChild(s);
  }, []);
  return <div id="cabinet-root" dangerouslySetInnerHTML={{ __html: BODY_HTML }} />;
}
