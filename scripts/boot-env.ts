import { env } from '../src/config/env';

console.log(`BOOTED mode=${env.appMode} db=${env.configuredDatabase.database || '(none)'}`);
