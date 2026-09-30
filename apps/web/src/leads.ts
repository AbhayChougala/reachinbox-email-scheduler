import Papa from 'papaparse';
import { normalizeAndValidateRecipients, type ParsedRecipients } from '@reachinbox/shared/browser';

export function parseLeadText(text: string): ParsedRecipients {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  if (parsed.errors.length && parsed.data.length === 0) throw new Error(parsed.errors[0]?.message ?? 'Unable to parse file');
  const rows = parsed.data.map((row) => row.map((cell) => String(cell).trim()));
  const header = rows[0]?.map((cell) => cell.toLowerCase().replace(/[ _-]/g, '')) ?? [];
  const emailIndex = header.findIndex((cell) => ['email', 'emailaddress', 'mail'].includes(cell));
  const values = emailIndex >= 0
    ? rows.slice(1).map((row) => row[emailIndex] ?? '').filter(Boolean)
    : rows.flatMap((row) => row).flatMap((cell) => cell.split(/[;\n]/)).map((cell) => cell.trim()).filter(Boolean);
  return normalizeAndValidateRecipients(values);
}
