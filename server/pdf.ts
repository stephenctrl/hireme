import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, rgb } from 'pdf-lib';
import type { ResumeDocument } from '../shared/types.js';
import { HttpError } from './errors.js';
import { hasContent } from './validation.js';

interface FontSource {
  name: string;
  bytes: Uint8Array;
  characters: Set<number>;
  bold: boolean;
}
interface Block {
  text: string;
  size: number;
  bold?: boolean;
  indent?: number;
  before?: number;
  after?: number;
  keepNext?: boolean;
}
interface Run { text: string; font: PDFFont }

let fontSources: Promise<FontSource[]> | undefined;
function loadFonts(): Promise<FontSource[]> {
  fontSources ??= (async () => {
    const require = createRequire(import.meta.url);
    const directory = dirname(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'));
    const names = (await readdir(directory))
      .filter(name => /^noto-sans-.+-(400|700)-normal\.woff$/.test(name))
      .sort((left, right) => Number(!left.includes('-latin-')) - Number(!right.includes('-latin-')) || left.localeCompare(right));
    return Promise.all(names.map(async name => {
      const bytes = await readFile(join(directory, name));
      return { name, bytes, characters: new Set(fontkit.create(bytes).characterSet), bold: name.includes('-700-') };
    }));
  })();
  return fontSources;
}

function blocksFor(document: ResumeDocument): Block[] {
  const blocks: Block[] = [];
  const add = (text: string, options: Partial<Block> = {}) => {
    if (text.trim()) blocks.push({ text, size: 10.5, after: 3, ...options });
  };
  const heading = (text: string) => add(text, { size: 12, bold: true, before: 13, after: 6, keepNext: true });
  const bullet = (text: string) => {
    if (text.trim()) add(`• ${text}`, { indent: 10, after: 3 });
  };
  const dates = (start: string, end: string) => [start, end].filter(value => value.trim()).join(' – ');
  const { contact } = document;
  add(contact.fullName, { size: 23, bold: true, after: 5, keepNext: true });
  add(contact.headline, { size: 12, after: 7 });
  add([contact.email, contact.phone, contact.location, contact.website, contact.linkedin].filter(value => value.trim()).join(' | '), { size: 9.5, after: 5 });
  if (document.summary.trim()) {
    heading('Summary');
    add(document.summary);
  }
  const experiences = document.experience.filter(hasContent);
  if (experiences.length) {
    heading('Experience');
    for (const entry of experiences) {
      add([entry.role, entry.employer].filter(value => value.trim()).join(' — '), { bold: true, before: 5, keepNext: true });
      add([entry.location, dates(entry.startDate, entry.endDate)].filter(value => value.trim()).join(' | '), { size: 9.5 });
      entry.highlights.forEach(bullet);
    }
  }
  const education = document.education.filter(hasContent);
  if (education.length) {
    heading('Education');
    for (const entry of education) {
      add([entry.qualification, entry.institution].filter(value => value.trim()).join(' — '), { bold: true, before: 5, keepNext: true });
      add([entry.location, dates(entry.startDate, entry.endDate)].filter(value => value.trim()).join(' | '), { size: 9.5 });
      entry.details.forEach(bullet);
    }
  }
  if (document.skills.some(hasContent)) {
    heading('Skills');
    document.skills.forEach(bullet);
  }
  const projects = document.projects.filter(hasContent);
  if (projects.length) {
    heading('Projects');
    for (const entry of projects) {
      add(entry.name, { bold: true, before: 5, keepNext: true });
      add(entry.link, { size: 9.5 });
      add(entry.description);
      entry.highlights.forEach(bullet);
    }
  }
  if (document.certifications.some(hasContent)) {
    heading('Certifications');
    document.certifications.forEach(bullet);
  }
  if (document.languages.some(hasContent)) {
    heading('Languages');
    document.languages.forEach(bullet);
  }
  for (const entry of document.extraSections.filter(hasContent)) {
    heading(entry.title.trim() ? entry.title : 'Additional information');
    entry.items.forEach(bullet);
  }
  return blocks;
}

export async function renderPdf(document: ResumeDocument): Promise<Uint8Array> {
  try {
    const blocks = blocksFor(document);
    const sources = await loadFonts();
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    pdf.setTitle('Application document');
    pdf.setCreator('Hireme');
    const embedded = new Map<FontSource, PDFFont>();
    const choices = new Map<string, FontSource>();
    // Resolve and check every character before drawing. IDs never enter the renderer.
    for (const block of [...blocks, { text: 'Page 0123456789 of', size: 9 }]) {
      for (const character of block.text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')) {
        if (character === '\n') continue;
        const key = `${block.bold ? 'b' : 'r'}${character}`;
        if (choices.has(key)) continue;
        const codepoint = character.codePointAt(0)!;
        const source = sources.find(font => font.bold === Boolean(block.bold) && font.characters.has(codepoint));
        if (!source) {
          throw new HttpError(422, 'PDF_EXPORT_FAILED', `The bundled Noto Sans fonts do not support character U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}. Replace that character or use a supported script, then export again. No characters have been silently removed.`);
        }
        choices.set(key, source);
        if (!embedded.has(source)) embedded.set(source, await pdf.embedFont(source.bytes, { subset: true }));
      }
    }
    const makeRuns = (text: string, bold: boolean): Run[] => {
      const runs: Run[] = [];
      for (const character of text) {
        const source = choices.get(`${bold ? 'b' : 'r'}${character}`)!;
        const font = embedded.get(source)!;
        const last = runs.at(-1);
        if (last?.font === font) last.text += character;
        else runs.push({ text: character, font });
      }
      return runs;
    };
    const measure = (text: string, size: number, bold: boolean) => makeRuns(text, bold)
      .reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, size), 0);
    const width = 595.28;
    const height = 841.89;
    const margin = 48;
    const bottom = 52;
    let page = pdf.addPage([width, height]);
    let y = height - margin;
    const ensureSpace = (needed: number) => {
      if (y - needed < bottom) {
        page = pdf.addPage([width, height]);
        y = height - margin;
      }
    };
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const wrap = (text: string, size: number, bold: boolean, available: number): string[] => {
      const lines: string[] = [];
      for (const paragraph of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
        let line = '';
        let used = 0;
        for (const token of paragraph.match(/\S+|[^\S\n]+/gu) ?? []) {
          const tokenWidth = measure(token, size, bold);
          if (used + tokenWidth <= available) {
            line += token;
            used += tokenWidth;
            continue;
          }
          if (line) {
            lines.push(line.trimEnd());
            line = '';
            used = 0;
          }
          if (!token.trim()) continue;
          if (tokenWidth <= available) {
            line = token;
            used = tokenWidth;
            continue;
          }
          // Split even unbroken URLs/tokens without cutting a Unicode grapheme.
          for (const { segment } of segmenter.segment(token)) {
            const segmentWidth = measure(segment, size, bold);
            if (used + segmentWidth > available && line) {
              lines.push(line);
              line = '';
              used = 0;
            }
            if (segmentWidth > available) throw new HttpError(422, 'PDF_EXPORT_FAILED', 'A text cluster is too wide to fit the PDF page. Simplify the affected text and try again.');
            line += segment;
            used += segmentWidth;
          }
        }
        lines.push(line.trimEnd());
      }
      return lines;
    };
    const draw = (text: string, size: number, bold: boolean, x: number, baseline: number) => {
      for (const run of makeRuns(text, bold)) {
        page.drawText(run.text, { x, y: baseline, size, font: run.font, color: rgb(0.12, 0.14, 0.16) });
        x += run.font.widthOfTextAtSize(run.text, size);
      }
    };
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      const leading = block.size * 1.48;
      const lines = wrap(block.text, block.size, Boolean(block.bold), width - margin * 2 - (block.indent ?? 0));
      const next = block.keepNext ? blocks[index + 1] : undefined;
      const nextLeading = next ? next.size * 1.48 + (next.before ?? 0) + (block.after ?? 0) : 0;
      const headingHeight = (block.before ?? 0) + lines.length * leading + nextLeading;
      ensureSpace(block.keepNext && headingHeight <= height - margin - bottom
        ? headingHeight
        : (block.before ?? 0) + Math.min(lines.length, 2) * leading + nextLeading);
      y -= block.before ?? 0;
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        ensureSpace(leading + (lineIndex === lines.length - 1 ? nextLeading : 0));
        y -= leading;
        draw(lines[lineIndex], block.size, Boolean(block.bold), margin + (block.indent ?? 0), y);
      }
      y -= block.after ?? 0;
    }
    const pages = pdf.getPages();
    for (let index = 0; index < pages.length; index++) {
      page = pages[index];
      const label = `Page ${index + 1} of ${pages.length}`;
      draw(label, 8.5, false, (width - measure(label, 8.5, false)) / 2, 27);
    }
    return await pdf.save();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, 'PDF_EXPORT_FAILED', 'The PDF could not be rendered with the bundled fonts. Check unusual characters or simplify the text and try again.');
  }
}
