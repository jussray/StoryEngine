// lib/sqliteTransaction.js
// node:sqlite's DatabaseSync has no better-sqlite3-style `.transaction()` helper,
// but the rest of this codebase is written against that API. Patch it onto the
// shared prototype once so every DatabaseSync instance (production or test) gets it.

import { DatabaseSync } from 'node:sqlite';

if (typeof DatabaseSync.prototype.transaction !== 'function') {
  DatabaseSync.prototype.transaction = function transaction(fn) {
    const db = this;
    return function (...args) {
      const startedHere = !db.isTransaction;
      if (startedHere) db.exec('BEGIN');
      try {
        const result = fn(...args);
        if (startedHere) db.exec('COMMIT');
        return result;
      } catch (error) {
        if (startedHere) {
          try { db.exec('ROLLBACK'); } catch { /* best-effort rollback */ }
        }
        throw error;
      }
    };
  };
}
