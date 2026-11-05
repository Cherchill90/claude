// Nur im CI-Build (VITE_SELFTEST=1) enthalten: koppelt die native App automatisch mit einer Mac-App,
// synchronisiert in beide Richtungen und schreibt das Ergebnis nach Documents/selftest-result.json.
// In normalen Builds wird diese Datei nicht eingebunden (kein URL-Schema, kein Code).
import { App } from '@capacitor/app';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { readJson } from './storage.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gradesOnDevice() {
  const raw = readJson('data');
  const k = raw?.data?.klassen?.find((x) => x.name === 'Beispielklasse');
  if (!k) return null;
  const a = k.arbeiten.find((x) => x.title === '1. Klassenarbeit');
  const sid = (n) => k.schueler.find((s) => s.last === n)?.id;
  return { s01: a?.results[sid('Schüler 01')]?.grade, s02: a?.results[sid('Schüler 02')]?.grade, klassen: raw.data.klassen.length };
}

export function startSelftest(storeRef) {
  let running = false;
  const run = async (url) => {
    if (running || !url || !url.startsWith('notenapp://selftest')) return;
    running = true;
    const q = new URL(url.replace('notenapp://', 'http://x/')).searchParams;
    const log = [];
    const step = (m) => log.push(`${new Date().toISOString()} ${m}`);
    const result = { ok: false, log, platform: navigator.userAgent };
    try {
      step(`isSecureContext=${window.isSecureContext} subtle=${!!crypto?.subtle} randomUUID=${typeof crypto.randomUUID}`);
      const p = await storeRef.current.pair({ host: q.get('host'), port: Number(q.get('port')), code: q.get('code'), deviceName: 'iPhone-Simulator' });
      step(`gekoppelt mit ${p.macName}`);
      await storeRef.current.syncNow();
      result.afterSync1 = gradesOnDevice();
      step(`sync1 ${JSON.stringify(result.afterSync1)}`);
      storeRef.current.update((d) => {
        const k = d.klassen.find((x) => x.name === 'Beispielklasse');
        const a = k.arbeiten.find((x) => x.title === '1. Klassenarbeit');
        const s = k.schueler.find((x) => x.last === 'Schüler 01');
        a.results[s.id] = { ...(a.results[s.id] || {}), grade: '5' };
      });
      step('iPhone: Schüler 01 → 5');
      await sleep(Number(q.get('wait') || 10000));
      await storeRef.current.syncNow();
      result.afterSync2 = gradesOnDevice();
      step(`sync2 ${JSON.stringify(result.afterSync2)}`);
      result.ok = true;
    } catch (e) {
      result.error = String(e?.message || e);
      step('FEHLER ' + result.error);
    }
    await Filesystem.writeFile({ path: 'selftest-result.json', directory: Directory.Documents, data: JSON.stringify(result, null, 1), encoding: Encoding.UTF8 });
  };
  App.getLaunchUrl().then((r) => run(r?.url));
  App.addListener('appUrlOpen', (e) => run(e.url));
}
