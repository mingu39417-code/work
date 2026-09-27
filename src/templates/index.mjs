// Template entry point used by tools/build.mjs.
// Each function is a pure function of its view model (see build spec §4) and returns a full HTML document
// that starts with '<!doctype html>'.
export { renderHome } from './home.mjs';
export { renderWork } from './work.mjs';
export { render404 } from './notfound.mjs';
export { escapeHtml } from './util.mjs';
