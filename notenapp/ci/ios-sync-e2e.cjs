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
const sh = (c) => execSync(c, { encoding: 'utf8' }).trim();
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
  const mw = await mac.firstWindow();
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
  console.log('Mac: Sync-Server aktiv, Kopplungscode', code);
  await mw.screenshot({ path: path.join(OUT, '1-mac-kopplung.png') });

  // iPhone (Simulator): native App per URL starten → koppelt und synchronisiert selbst
  const status = () => mw.evaluate(() => window.notenappDesktop.syncStatus());
  sh(`xcrun simctl terminate ${UDID} ${BUNDLE} || true`);
  sh(`xcrun simctl openurl ${UDID} "notenapp://selftest?host=127.0.0.1&port=${PORT}&code=${code}&wait=20000"`);
  const first = await until(async () => (await status()).devices[0]?.lastSync, 180000, 'erste Synchronisation des iPhones');
  console.log('Mac: iPhone gekoppelt und 1. Synchronisation empfangen:', (await status()).devices[0].name);

  // Mac: Schüler 02 in „1. Klassenarbeit“ auf 1 setzen (über die Oberfläche)
  await mw.click('.modal header button');
  await mw.click('.sidebar .list li:has-text("1. Klassenarbeit")');
  await mw.locator('.entry-list input.grade').nth(1).fill('1');
  await mw.waitForSelector('text=✓ Gespeichert');
  console.log('Mac: Schüler 02 → 1');

  await until(async () => ((await status()).devices[0]?.lastSync || 0) > first, 180000, 'zweite Synchronisation des iPhones');
  await sleep(1500);
  const macGrades = [await mw.locator('.entry-list input.grade').nth(0).inputValue(), await mw.locator('.entry-list input.grade').nth(1).inputValue()];
  console.log('Mac nach 2. Synchronisation: Schüler 01 =', macGrades[0], '| Schüler 02 =', macGrades[1]);
  await mw.screenshot({ path: path.join(OUT, '2-mac-nach-sync.png') });

  // Ergebnis der nativen App aus dem Simulator lesen
  const container = sh(`xcrun simctl get_app_container ${UDID} ${BUNDLE} data`);
  const resFile = path.join(container, 'Documents', 'selftest-result.json');
  await until(() => fs.existsSync(resFile), 60000, 'Ergebnisdatei der iPhone-App');
  const res = JSON.parse(fs.readFileSync(resFile, 'utf8'));
  console.log('iPhone-App Protokoll:\n  ' + res.log.join('\n  '));
  const dataFile = path.join(container, 'Library', 'Notenapp', 'notenapp-daten.json');
  console.log('iPhone-App Datendatei vorhanden:', fs.existsSync(dataFile), fs.existsSync(dataFile) ? fs.statSync(dataFile).size + ' Bytes' : '');
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
    console.log((v ? '✅ ' : '❌ ') + k);
    ok = ok && v;
  }
  fs.writeFileSync(path.join(OUT, 'ergebnis.json'), JSON.stringify({ checks, macGrades, iphone: res, errs }, null, 1));
  const closed = mac.waitForEvent('close');
  await mac.evaluate(({ app }) => app.quit());
  await closed;
  console.log('Mac-Backup beim Beenden:', fs.readdirSync(path.join(dataDir, 'Backups')));
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('FEHLER', e);
  process.exit(1);
});
