// FTPBD (BDIX) — Emby server at media.ftpbd.net:8096
// Port of Niloy-Sarker/niloy-cloudstream FTPBD.
import { createEmby } from '../common/emby.js';
import { createProvider } from '../common/stream.js';

const ID = 'ftpbd';

// Public guest account shipped with the original CloudStream extension
const run = createEmby({
  id: ID,
  label: 'BDIX | FTPBD',
  base: 'http://media.ftpbd.net:8096',
  username: 'BNET- -USER',
  password: '',
});

export const getStreams = createProvider(ID, run);
