import ExcelJS from 'exceljs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCHOOL_SLUG = process.env.SCHOOL_SLUG || 'gesamtschule-nord';
export const SHEET_PATH = path.join(__dirname, '..', 'data', `arbeitszeit_${SCHOOL_SLUG}.xlsx`);
const SHEET_NAME = 'Rohdaten';
const HEADERS = ['#', 'Pseudonym', 'Datum', 'Kategorie', 'Minuten', 'Stundenmaß'];

// Single in-process write queue — this app has one writer process, so a promise
// chain is enough to stop concurrent syncs from racing on the same workbook file.
let queue = Promise.resolve();
function serialize(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

async function loadWorkbook() {
  const wb = new ExcelJS.Workbook();
  if (existsSync(SHEET_PATH)) {
    await wb.xlsx.readFile(SHEET_PATH);
  }
  let sheet = wb.getWorksheet(SHEET_NAME);
  if (!sheet) {
    sheet = wb.addWorksheet(SHEET_NAME);
    sheet.addRow(HEADERS);
    sheet.getRow(1).font = { bold: true };
    sheet.columns = [
      { width: 6 }, { width: 14 }, { width: 12 }, { width: 22 }, { width: 10 }, { width: 12 },
    ];
  }
  return { wb, sheet };
}

function renumber(sheet) {
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    sheet.getRow(r).getCell(1).value = r;
  }
}

/**
 * Upserts one row per (pseudonym, date, category): re-syncing a day overwrites
 * that day's minutes instead of accumulating duplicate rows.
 */
export async function upsertRows({ pseudonym, date, deputat, rows }) {
  return serialize(async () => {
    const { wb, sheet } = await loadWorkbook();
    const stundenmass = `${deputat} %`;

    for (const { category, minutes } of rows) {
      let matched = null;
      for (let r = 2; r <= sheet.rowCount; r += 1) {
        const row = sheet.getRow(r);
        if (row.getCell(2).value === pseudonym && row.getCell(3).value === date && row.getCell(4).value === category) {
          matched = row;
          break;
        }
      }
      if (matched) {
        matched.getCell(5).value = minutes;
        matched.getCell(6).value = stundenmass;
      } else {
        sheet.addRow(['', pseudonym, date, category, minutes, stundenmass]);
      }
    }

    renumber(sheet);
    await wb.xlsx.writeFile(SHEET_PATH);
    return { rowsWritten: rows.length, totalRows: sheet.rowCount - 1 };
  });
}

export async function distinctParticipantCount() {
  return serialize(async () => {
    const { sheet } = await loadWorkbook();
    const ids = new Set();
    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const v = sheet.getRow(r).getCell(2).value;
      if (v) ids.add(v);
    }
    return ids.size;
  });
}
