import { bad } from './http.js';

export interface CsvRow {
  /** 1-based row number, as a spreadsheet would show it */
  line: number;
  cells: string[];
}

function detectDelimiter(text: string) {
  const first = text.slice(0, text.search(/\r?\n|$/));
  const count = (d: string) => first.split(d).length;
  return [',', ';', '\t'].reduce((best, d) => (count(d) > count(best) ? d : best), ',');
}

/**
 * RFC 4180 parser. Blank rows and rows whose first cell starts with `#`
 * (the hint and example rows in templates) are dropped; line numbers are kept.
 */
export function parseCsv(input: string): CsvRow[] {
  const text = input.replace(/^﻿/, '');
  if (text.includes('�')) throw bad('This file is not UTF-8. In Excel use Save As → "CSV UTF-8 (Comma delimited)" and try again.');
  const delimiter = detectDelimiter(text);

  const records: string[][] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) { cells.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cells.push(cell);
      records.push(cells);
      cells = [];
      cell = '';
    } else cell += ch;
  }
  if (quoted) throw bad('The file has an unclosed quote ("). Check it and try again.');
  if (cell !== '' || cells.length) { cells.push(cell); records.push(cells); }

  return records
    .map((c, i) => ({ line: i + 1, cells: c }))
    .filter((r) => r.cells.some((c) => c.trim() !== '') && !r.cells[0].trim().startsWith('#'));
}
