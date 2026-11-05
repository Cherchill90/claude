// Läuft auf einem macOS-Runner (GitHub Actions):
// echte Mac-App (Electron) ⇄ native iPhone-App im iOS-Simulator, Kopplung + Abgleich in beide Richtungen.
const { _electron: electron } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'ci-out');
const UDID = process.env.SIM_UDID;
const BUNDLE = 'de.notenapp.ios';
const PORT = 12980;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c, t = 60000) => execSync(c, { encoding: 'utf8', timeout: t }).trim();
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
let mwGlobal = null;
async function diagnose(reason) {
  log('DIAGNOSE:', reason);
  try { sh(`xcrun simctl io ${UDID} screenshot "${path.join(OUT, 'fehler-iphone.png')}"`); } catch (e) { log('kein Simulator-Screenshot', e.message); }
  try { await mwGlobal?.screenshot({ path: path.join(OUT, 'fehler-mac.png'), timeout: 5000 }); } catch {}
  try {
    const c = sh(`xcrun simctl get_app_container ${UDID} ${BUNDLE} data`);
    const f = path.join(c, 'Documents', 'selftest-result.json');
    log('iPhone-Protokoll:', fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '(keine Datei)');
  } catch (e) { log('Container nicht lesbar', e.message); }
  try { log('iPhone-Systemlog:\n' + sh(`xcrun simctl spawn ${UDID} log show --last 10m --style compact --predicate 'process == "App"' | tail -60`, 60000)); } catch (e) { log('kein Systemlog', e.message); }
}
setTimeout(async () => { await diagnose('Gesamt-Zeitlimit (9 min) überschritten'); process.exit(2); }, 9 * 60000).unref();
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('Zeitüberschreitung: ' + what);
    await sleep(1000);
  }
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notenapp-mac-'));
  const mac = await electron.launch({ executablePath: require(path.join(APP, 'node_modules/electron')), args: [APP], env: { ...process.env, NOTENAPP_DATA_DIR: dataDir }, cwd: APP });
  log('Mac-App gestartet');
  const mw = await mac.firstWindow();
  mwGlobal = mw;
  const errs = [];
  mw.on('pageerror', (e) => errs.push(e.message));
  mw.on('dialog', (d) => d.accept());

  // Mac: Beispielklasse, Synchronisation einschalten, Kopplung starten
  await mw.click('text=Beispielklasse laden');
  await mw.waitForSelector('text=✓ Gespeichert');
  await mw.click('.sync-btn');
  await mw.click('text=Synchronisation erlauben');
  await mw.waitForSelector('text=● aktiv');
  await mw.click('text=iPhone/iPad koppeln');
  const code = (await mw.locator('.pair-code').textContent()).replace(/[^A-Z0-9]/g, '');
  log('Mac: Sync-Server aktiv, Kopplungscode', code);
  await mw.screenshot({ path: path.join(OUT, '1-mac-kopplung.png') });

  // iPhone (Simulator): native App per URL starten → koppelt und synchronisiert selbst
  const status = () => mw.evaluate(() => window.notenappDesktop.syncStatus());
  sh(`xcrun simctl terminate ${UDID} ${BUNDLE} || true`);
  const cont = sh(`xcrun simctl get_app_container ${UDID} ${BUNDLE} data`);
  fs.mkdirSync(path.join(cont, 'Documents'), { recursive: true });
  fs.writeFileSync(path.join(cont, 'Documents', 'selftest.json'), JSON.stringify({ host: '127.0.0.1', port: PORT, code, wait: 20000 }));
  log('iPhone: Selbsttest-Auftrag abgelegt, starte App');
  sh(`xcrun simctl launch ${UDID} ${BUNDLE}`);
  const first = await until(async () => (await status()).devices[0]?.lastSync, 150000, 'erste Synchronisation des iPhones');
  log('Mac: iPhone gekoppelt und 1. Synchronisation empfangen:', (await status()).devices[0].name);

  // Mac: Schüler 02 in „1. Klassenarbeit“ auf 1 setzen (über die Oberfläche)
  await mw.click('.modal header button');
  await mw.click('.sidebar .list li:has-text("1. Klassenarbeit")');
  await mw.locator('.entry-list input.grade').nth(1).fill('1');
  await mw.waitForSelector('text=✓ Gespeichert');
  log('Mac: Schüler 02 → 1');

  await until(async () => ((await status()).devices[0]?.lastSync || 0) > first, 150000, 'zweite Synchronisation des iPhones');
  await sleep(1500);
  const macGrades = [await mw.locator('.entry-list input.grade').nth(0).inputValue(), await mw.locator('.entry-list input.grade').nth(1).inputValue()];
  log('Mac nach 2. Synchronisation: Schüler 01 =', macGrades[0], '| Schüler 02 =', macGrades[1]);
  await mw.screenshot({ path: path.join(OUT, '2-mac-nach-sync.png') });

  // Ergebnis der nativen App aus dem Simulator lesen
  const container = sh(`xcrun simctl get_app_container ${UDID} ${BUNDLE} data`);
  const resFile = path.join(container, 'Documents', 'selftest-result.json');
  await until(() => fs.existsSync(resFile) && JSON.parse(fs.readFileSync(resFile, 'utf8')).done, 60000, 'Ergebnisdatei der iPhone-App');
  const res = JSON.parse(fs.readFileSync(resFile, 'utf8'));
  log('iPhone-App Protokoll:\n  ' + res.log.join('\n  '));
  const dataFile = path.join(container, 'Library', 'Notenapp', 'notenapp-daten.json');
  log('iPhone-App Datendatei vorhanden:', fs.existsSync(dataFile), fs.existsSync(dataFile) ? fs.statSync(dataFile).size + ' Bytes' : '');
  sh(`xcrun simctl io ${UDID} screenshot "${path.join(OUT, '3-iphone.png')}"`);

  const checks = {
    'iPhone hat Klasse vom Mac erhalten (Sync 1)': res.afterSync1?.s01 === '1' && res.afterSync1?.s02 === '2+',
    'Änderung vom iPhone ist am Mac angekommen (Schüler 01 = 5)': macGrades[0] === '5',
    'Änderung vom Mac ist auf dem iPhone angekommen (Schüler 02 = 1)': res.afterSync2?.s02 === '1',
    'iPhone behält eigene Änderung (Schüler 01 = 5)': res.afterSync2?.s01 === '5',
    'Selbsttest ohne Fehler': res.ok === true,
    'keine JS-Fehler in der Mac-App': errs.length === 0,
    'iPhone speichert in Library/Notenapp': fs.existsSync(dataFile),
  };
  let ok = true;
  for (const [k, v] of Object.entries(checks)) {
    log((v ? '✅ ' : '❌ ') + k);
    ok = ok && v;
  }
  fs.writeFileSync(path.join(OUT, 'ergebnis.json'), JSON.stringify({ checks, macGrades, iphone: res, errs }, null, 1));
  const closed = mac.waitForEvent('close');
  await mac.evaluate(({ app }) => app.quit());
  await closed;
  log('Mac-Backup beim Beenden:', fs.readdirSync(path.join(dataDir, 'Backups')));
  process.exit(ok ? 0 : 1);
})().catch(async (e) => {
  console.error('FEHLER', e);
  await diagnose(e.message);
  process.exit(1);
});
