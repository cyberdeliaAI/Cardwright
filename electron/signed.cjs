'use strict';
const build = require('../package.json').build;
const mac = { ...build.mac };
delete mac.identity;
module.exports = { ...build, forceCodeSigning: true,
  mac: { ...mac, type: 'distribution', hardenedRuntime: true,
    entitlements: 'electron/entitlements.mac.plist', entitlementsInherit: 'electron/entitlements.mac.plist', notarize: true } };
