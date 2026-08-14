// Fast isolated printing. The node is cloned into a hidden same-origin iframe
// and the iframe window is printed, so the browser only lays out the printable
// report instead of the whole admin app. This makes the print preview appear
// almost instantly.
export function printNode(node: HTMLElement | null | undefined, opts?: { skipWebFonts?: boolean }): void {
  if (typeof window === 'undefined') return;
  if (!node) {
    window.print();
    return;
  }
  // iOS Safari cannot print from a hidden iframe; fall back to the main window,
  // where the @media print visibility rules still isolate the report.
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) {
    window.print();
    return;
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  const done = () => iframe.remove();
  if (!doc || !win) {
    done();
    window.print();
    return;
  }

  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8"><title></title></head><body></body></html>');
  doc.close();

  const orientation = document.documentElement.getAttribute('data-print-orientation');
  if (orientation) doc.documentElement.setAttribute('data-print-orientation', orientation);

  // Copy the app's styles so Tailwind utility classes and the @media print
  // rules apply identically. Web fonts (Sarabun) are kept for the reports.
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((el) => {
    if (el instanceof HTMLStyleElement) {
      doc.head.appendChild(el.cloneNode(true));
    } else if (el instanceof HTMLLinkElement) {
      if (opts?.skipWebFonts && el.href.includes('fonts.googleapis.com')) return;
      doc.head.appendChild(el.cloneNode(true));
    }
  });

  doc.body.appendChild(node.cloneNode(true));

  win.addEventListener('afterprint', done, { once: true });
  try {
    win.print();
  } catch {
    done();
    window.print();
    return;
  }
  // Guard for engines where print() returns immediately: give the preview time
  // to capture the cloned content before tearing the iframe down.
  window.setTimeout(done, 3000);
}
