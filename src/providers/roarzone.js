// RoarZone (BDIX) — Emby server at play.roarzone.info
// Port of Niloy-Sarker/niloy-cloudstream Roarzone.
import { createEmby } from '../common/emby.js';
import { createProvider } from '../common/stream.js';

const ID = 'roarzone';

// Public guest account shipped with the original CloudStream extension
const run = createEmby({
  id: ID,
  label: 'BDIX | RoarZone',
  base: 'https://play.roarzone.info',
  username: 'RoarZone_Guest',
  password: '',
});

export const getStreams = createProvider(ID, run);
