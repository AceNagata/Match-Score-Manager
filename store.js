// Persistence for saved tournaments (roster + bracket).
//
//   STORE=firestore  Cloud Firestore (default on Cloud Run, where K_SERVICE is set)
//   STORE=file       JSON files under DATA_DIR (default ./.data) - the local default
//   STORE=memory     nothing is saved
//
// All stores share one interface so server.js doesn't care which is in use.

const fs = require('fs');
const path = require('path');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const isValidId = (id) => typeof id === 'string' && ID_RE.test(id);

function createMemoryStore() {
  return {
    mode: 'memory',
    async init() {},
    async listTournaments() { return []; },
    async loadTournament() { return null; },
    async saveTournament() {},
    async deleteTournament() {},
    async getActiveId() { return null; },
    async setActiveId() {},
  };
}

function createFileStore(dir) {
  const tournamentsDir = path.join(dir, 'tournaments');
  const activeFile = path.join(dir, 'active.json');
  const fileFor = (id) => path.join(tournamentsDir, `${id}.json`);

  async function readJson(file) {
    try {
      return JSON.parse(await fs.promises.readFile(file, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  // Write to a temp file then rename, so a crash mid-write can't leave a half-written save.
  async function writeJson(file, value) {
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(value));
    await fs.promises.rename(tmp, file);
  }

  return {
    mode: 'file',
    async init() {
      await fs.promises.mkdir(tournamentsDir, { recursive: true });
    },
    async listTournaments() {
      const out = [];
      for (const file of await fs.promises.readdir(tournamentsDir)) {
        if (!file.endsWith('.json')) continue;
        try {
          const doc = await readJson(path.join(tournamentsDir, file));
          if (doc && isValidId(doc.id)) out.push({ id: doc.id, name: doc.name, updatedAt: doc.updatedAt });
        } catch (err) {
          console.error(`Skipping unreadable save ${file}:`, err.message);
        }
      }
      return out;
    },
    async loadTournament(id) {
      return isValidId(id) ? readJson(fileFor(id)) : null;
    },
    async saveTournament(doc) {
      if (!isValidId(doc.id)) throw new Error('invalid tournament id');
      await writeJson(fileFor(doc.id), doc);
    },
    async deleteTournament(id) {
      if (isValidId(id)) await fs.promises.rm(fileFor(id), { force: true });
    },
    async getActiveId() {
      const active = await readJson(activeFile);
      return active && isValidId(active.id) ? active.id : null;
    },
    async setActiveId(id) {
      await writeJson(activeFile, { id });
    },
  };
}

function createFirestoreStore() {
  // Loaded lazily so local/file mode never pays for (or needs) the Firestore client.
  const { Firestore } = require('@google-cloud/firestore');
  const db = new Firestore({ ignoreUndefinedProperties: true });
  const tournaments = db.collection(process.env.TOURNAMENTS_COLLECTION || 'tournaments');
  const activeDoc = db.collection('settings').doc('active');

  return {
    mode: 'firestore',
    // A cheap read, so a missing database or missing permission shows up at boot.
    async init() {
      await activeDoc.get();
    },
    // Projected to name + updatedAt so listing never pulls every tournament's logos.
    async listTournaments() {
      const snap = await tournaments.select('name', 'updatedAt').get();
      return snap.docs.map((d) => ({ id: d.id, name: d.get('name'), updatedAt: d.get('updatedAt') }));
    },
    async loadTournament(id) {
      if (!isValidId(id)) return null;
      const snap = await tournaments.doc(id).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    },
    async saveTournament(doc) {
      if (!isValidId(doc.id)) throw new Error('invalid tournament id');
      const { id, ...fields } = doc;
      await tournaments.doc(id).set(fields);
    },
    async deleteTournament(id) {
      if (isValidId(id)) await tournaments.doc(id).delete();
    },
    async getActiveId() {
      const snap = await activeDoc.get();
      const id = snap.exists ? snap.get('id') : null;
      return isValidId(id) ? id : null;
    },
    async setActiveId(id) {
      await activeDoc.set({ id });
    },
  };
}

function createStore() {
  const mode = process.env.STORE || (process.env.K_SERVICE ? 'firestore' : 'file');
  if (mode === 'firestore') return createFirestoreStore();
  if (mode === 'memory') return createMemoryStore();
  return createFileStore(process.env.DATA_DIR || path.join(__dirname, '.data'));
}

module.exports = { createStore, createMemoryStore, isValidId };
