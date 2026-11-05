// Nur im CI-Build (VITE_SELFTEST=1) enthalten: koppelt die native App automatisch mit einer Mac-App,
// synchronisiert in beide Richtungen und schreibt das Ergebnis nach Documents/selftest-result.json.
// Parameter kommen aus Documents/selftest.json (legt das Testskript vor dem Start in den App-Container).
// In normalen Builds wird diese Datei nicht eingebunden.
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

export async function startSelftest(storeRef) {
  let q;
  try {
    q = JSON.parse((await Filesystem.readFile({ path: 'selftest.json', directory: Directory.Documents, encoding: Encoding.UTF8 })).data);
    await Filesystem.deleteFile({ path: 'selftest.json', directory: Directory.Documents });
  } catch {
    return; // kein Selbsttest angefordert
  }
  const log = [];
  const result = { ok: false, log, platform: navigator.userAgent };
  const save = () =>
    Filesystem.writeFile({ path: 'selftest-result.json', directory: Directory.Documents, data: JSON.stringify(result, null, 1), encoding: Encoding.UTF8 }).catch(() => {});
  const step = async (m) => {
    log.push(`${new Date().toISOString()} ${m}`);
    await save();
  };
  try {
    await step(`gestartet; isSecureContext=${window.isSecureContext} subtle=${!!crypto?.subtle} randomUUID=${typeof crypto.randomUUID}`);
    const p = await storeRef.current.pair({ host: q.host, port: Number(q.port), code: q.code, deviceName: 'iPhone-Simulator' });
    await step(`gekoppelt mit ${p.macName}`);
    await storeRef.current.syncNow();
    result.afterSync1 = gradesOnDevice();
    await step(`sync1 ${JSON.stringify(result.afterSync1)}`);
    storeRef.current.update((d) => {
      const k = d.klassen.find((x) => x.name === 'Beispielklasse');
      const a = k.arbeiten.find((x) => x.title === '1. Klassenarbeit');
      const s = k.schueler.find((x) => x.last === 'Schüler 01');
      a.results[s.id] = { ...(a.results[s.id] || {}), grade: '5' };
    });
    await step('iPhone: Schüler 01 → 5');
    await sleep(Number(q.wait || 20000));
    await storeRef.current.syncNow();
    result.afterSync2 = gradesOnDevice();
    await step(`sync2 ${JSON.stringify(result.afterSync2)}`);
    result.ok = true;
  } catch (e) {
    result.error = String(e?.message || e);
    log.push('FEHLER ' + result.error);
  }
  result.done = true;
  await save();
}
