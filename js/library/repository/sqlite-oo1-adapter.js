function normalizeBindings(bindings) {
  if (bindings.length === 0) return undefined;
  if (bindings.length === 1 && Array.isArray(bindings[0])) return bindings[0];
  if (bindings.length === 1 && bindings[0] && typeof bindings[0] === 'object' && !ArrayBuffer.isView(bindings[0])) {
    return bindings[0];
  }
  return bindings;
}

class Oo1StatementSync {
  constructor(database, sql) {
    this.database = database;
    this.statement = database.raw.prepare(sql);
  }

  #resetAndBind(bindings) {
    const values = normalizeBindings(bindings);
    this.statement.reset(true);
    if (values !== undefined) this.statement.bind(values);
  }

  all(...bindings) {
    this.#resetAndBind(bindings);
    try {
      const rows = [];
      while (this.statement.step()) rows.push(this.statement.get({}));
      return rows;
    } finally {
      this.statement.reset(true);
    }
  }

  get(...bindings) {
    this.#resetAndBind(bindings);
    try {
      return this.statement.step() ? this.statement.get({}) : undefined;
    } finally {
      this.statement.reset(true);
    }
  }

  run(...bindings) {
    this.#resetAndBind(bindings);
    try {
      this.statement.step();
      return {
        changes: Number(this.database.raw.changes(false, true)),
        lastInsertRowid: this.database.sqlite3.capi.sqlite3_last_insert_rowid(this.database.raw.pointer)
      };
    } finally {
      this.statement.reset(true);
    }
  }
}

export class Oo1DatabaseSyncAdapter {
  constructor(rawDatabase, sqlite3) {
    this.raw = rawDatabase;
    this.sqlite3 = sqlite3;
    this.statements = new Map();
  }

  exec(sql) {
    this.raw.exec(sql);
  }

  prepare(sql) {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = new Oo1StatementSync(this, sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  close() {
    this.statements.clear();
    this.raw.close();
  }
}
