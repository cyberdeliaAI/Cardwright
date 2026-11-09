'use strict';
const path = require('node:path');
module.exports = async function harden(context) {
  const { flipFuses, FuseVersion, FuseV1Options } = await import('@electron/fuses');
  const name = context.packager.appInfo.productFilename;
  const executable = path.join(context.appOutDir, name + (context.electronPlatformName === 'darwin' ? '.app' : context.electronPlatformName === 'win32' ? '.exe' : ''));
  await flipFuses(executable, { version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false, [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false, [FuseV1Options.OnlyLoadAppFromAsar]: true });
};
