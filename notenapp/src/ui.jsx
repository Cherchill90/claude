import { useEffect, useRef } from 'react';

export function Modal({ title, onClose, children, wide, footer }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Schließen">✕</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export const fullName = (s) => `${s.last}${s.first ? ', ' + s.first : ''}`;

export const sortSchueler = (list) =>
  [...list].sort((a, b) => (a.last + a.first).localeCompare(b.last + b.first, 'de'));

export const fmtDate = (iso) => (iso ? new Date(iso + 'T00:00').toLocaleDateString('de-DE') : '');

export const today = () => new Date().toISOString().slice(0, 10);

/** CSV (Excel-kompatibel: Semikolon + BOM) herunterladen. */
export function downloadCsv(filename, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
  download(filename, new Blob([text], { type: 'text/csv;charset=utf-8' }));
}

export function download(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Bild verkleinern und als JPEG-DataURL zurückgeben. */
export function readPhoto(file, size = 192) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const r = Math.min(size / img.width, size / img.height, 1);
      c.width = Math.round(img.width * r);
      c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function Avatar({ s, size = 36 }) {
  const initials = ((s.first?.[0] || '') + (s.last?.[0] || '')).toUpperCase();
  return s.photo ? (
    <img className="avatar" src={s.photo} alt="" style={{ width: size, height: size }} />
  ) : (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials}</span>
  );
}

export function PrintButton() {
  return (
    <button onClick={() => window.print()} title="Drucken oder als PDF sichern">
      🖨 Drucken / PDF
    </button>
  );
}

export function useAutoFocus() {
  const r = useRef(null);
  useEffect(() => r.current?.focus(), []);
  return r;
}
