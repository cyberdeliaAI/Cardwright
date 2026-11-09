'use strict';

function applicationUrl(value, origin) {
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password
      && ['/', '/index.html'].includes(url.pathname) && !url.search;
  } catch { return false; }
}

function externalUrl(value) {
  try {
    const url = new URL(value);
    return value.length <= 8192 && url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function permissionAllowed(contents, permission, requestingUrl, details, origin) {
  return !!contents && applicationUrl(contents.getURL(), origin)
    && applicationUrl(requestingUrl, origin) && details?.isMainFrame !== false
    && ['fullscreen', 'clipboard-sanitized-write'].includes(permission);
}

const contentPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
module.exports = { applicationUrl, externalUrl, permissionAllowed, contentPolicy };
