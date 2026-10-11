import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const failure = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
let task;
try {
  task = getDocument({ data: new Uint8Array(workerData.bytes), stopAtErrors: true, useSystemFonts: false });
  const pdf = await task.promise;
  if (pdf.numPages > 20) throw failure('TOO_MANY_PAGES', 'Maximum 20 pages par document.', 413);
  const pages = [];
  let total = 0;
  for (let page = 1; page <= pdf.numPages; page++) {
    const content = await (await pdf.getPage(page)).getTextContent();
    const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
    total += text.length;
    if (text.length > 200000 || total > 500000) throw failure('TOO_MUCH_TEXT', 'Document trop complexe.', 413);
    pages.push({ page, text });
  }
  parentPort.postMessage({ pages });
} catch (error) {
  parentPort.postMessage({ error: { code: error.code || 'INVALID_PDF', status: error.status || 400, message: error.code ? error.message : 'PDF illisible ou protégé : utilisez un document PDF texte valide.' } });
} finally {
  await task?.destroy();
}
