'use strict';

async function startBackend({ startServer, version, port = 8787, onShutdown, probe = async origin => {
  const response = await fetch(origin + '/api/config', { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('The existing server is not available.');
  return response.json();
} }) {
  try {
    const server = await startServer({ port, host: '127.0.0.1', onShutdown });
    return { owned: true, origin: `http://127.0.0.1:${server.address().port}`, stop() {
      server.close();
      server.closeAllConnections?.();
    } };
  } catch (error) {
    if (error.code !== 'EADDRINUSE' || port === 0) throw error;
    const origin = `http://127.0.0.1:${port}`;
    let info;
    try { info = await probe(origin); } catch { /* Report the conflict without stopping another process. */ }
    if (info?.app !== 'Cardwright' || info.version !== version || info.desktopProtocol !== 1) {
      throw new Error(`Port ${port} is in use by another program or a different Cardwright version. Close that server before opening Cardwright.`);
    }
    return { owned: false, origin, stop() {} };
  }
}
module.exports = { startBackend };
