// Fast isolated printing. The node is cloned into a hidden same-origin iframe
// and the iframe window is printed, so the browser only lays out the tiny
// printable element instead of the whole app. This makes the print preview
// appear almost instantly even with a large product grid on screen.
export function printNode(node: HTMLElement | null | undefined, opts?: { skipWebFonts?: boolean }): void {
  if (typeof window === 'undefined') return;
  if (!node) {
    window.print();
    return;
  }
  // iOS Safari cannot print from a hidden iframe; fall back to the main window,
  // where the @media print visibility rules still isolate the receipt.
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
  // rules apply identically. The rules are inlined as text — cloning the
  // <link> tags would race the stylesheet fetch and print an unstyled page.
  copyStyles(doc, opts?.skipWebFonts ?? false);

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

function copyStyles(doc: Document, skipWebFonts: boolean): void {
  for (const sheet of Array.from(document.styleSheets)) {
    const href = sheet.href ?? '';
    if (skipWebFonts && href.includes('fonts.googleapis.com')) continue;
    let css = '';
    try {
      for (const rule of Array.from(sheet.cssRules)) css += rule.cssText + '\n';
    } catch {
      // Cross-origin sheet (Google Fonts) is not readable via CSSOM — load it
      // as a normal <link>; fonts swap in once fetched.
      if (href) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        doc.head.appendChild(link);
      }
      continue;
    }
    if (css) {
      const style = document.createElement('style');
      style.textContent = css;
      doc.head.appendChild(style);
    }
  }
}
