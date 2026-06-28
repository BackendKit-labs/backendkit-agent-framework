import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import fs from "node:fs";
import path from "node:path";
import type { ScheduledTask, TaskStatus } from "../types/task.js";

export class TaskRepository {
  private db!: SqlJsDatabase;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const SQL = await initSqlJs();

    // Load existing DB or create new one
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this.db.run("PRAGMA journal_mode = WAL");
    this.initializeSchema();
    this.save();
  }

  private initializeSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'active',
        nextRunAt TEXT,
        createdBy TEXT NOT NULL,
        data TEXT NOT NULL
      )
    `);

    // Create indexes (ignore if already exist)
    try {
      this.db.run("CREATE INDEX IF NOT EXISTS idx_tasks_status ON scheduled_tasks(status)");
      this.db.run("CREATE INDEX IF NOT EXISTS idx_tasks_nextRunAt ON scheduled_tasks(nextRunAt)");
      this.db.run("CREATE INDEX IF NOT EXISTS idx_tasks_createdBy ON scheduled_tasks(createdBy)");
    } catch {
      // Indexes may already exist, ignore
    }
  }

  private save(): void {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  close(): void {
    this.save();
    this.db.close();
  }

  create(task: ScheduledTask): ScheduledTask {
    this.db.run(
      "INSERT INTO scheduled_tasks (id, status, nextRunAt, createdBy, data) VALUES (?, ?, ?, ?, ?)",
      [task.id, task.status, task.nextRunAt ?? null, task.createdBy, JSON.stringify(task)]
    );
    this.save();
    return task;
  }

  findById(id: string): ScheduledTask | null {
    const stmt = this.db.prepare("SELECT data FROM scheduled_tasks WHERE id = ?");
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as { data: string };
      stmt.free();
      return JSON.parse(row.data) as ScheduledTask;
    }
    stmt.free();
    return null;
  }

  findByStatus(status: TaskStatus): ScheduledTask[] {
    const stmt = this.db.prepare("SELECT data FROM scheduled_tasks WHERE status = ?");
    stmt.bind([status]);
    const tasks: ScheduledTask[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as { data: string };
      tasks.push(JSON.parse(row.data) as ScheduledTask);
    }
    stmt.free();
    return tasks;
  }

  findDueTasks(now: string): ScheduledTask[] {
    const stmt = this.db.prepare(
      "SELECT data FROM scheduled_tasks WHERE status = 'active' AND nextRunAt IS NOT NULL AND nextRunAt <= ?"
    );
    stmt.bind([now]);
    const tasks: ScheduledTask[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as { data: string };
      tasks.push(JSON.parse(row.data) as ScheduledTask);
    }
    stmt.free();
    return tasks;
  }

  update(task: ScheduledTask): ScheduledTask {
    this.db.run(
      "UPDATE scheduled_tasks SET status = ?, nextRunAt = ?, data = ? WHERE id = ?",
      [task.status, task.nextRunAt ?? null, JSON.stringify(task), task.id]
    );
    this.save();
    return task;
  }

  delete(id: string): boolean {
    this.db.run("DELETE FROM scheduled_tasks WHERE id = ?", [id]);
    this.save();
    // Check if any row was affected by trying to find it
    return this.findById(id) === null;
  }

  list(filters: {
    status?: TaskStatus;
    type?: string;
    createdBy?: string;
    limit: number;
    offset: number;
  }): { total: number; tasks: ScheduledTask[] } {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filters.status) {
      conditions.push("status = ?");
      params.push(filters.status);
    }

    if (filters.createdBy) {
      conditions.push("createdBy = ?");
      params.push(filters.createdBy);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count total
    const countStmt = this.db.prepare(
      `SELECT COUNT(*) as count FROM scheduled_tasks ${whereClause}`
    );
    countStmt.bind([...params]);
    countStmt.step();
    const countRow = countStmt.getAsObject() as { count: number };
    countStmt.free();

    // Fetch rows
    const selectStmt = this.db.prepare(
      `SELECT data FROM scheduled_tasks ${whereClause} ORDER BY nextRunAt ASC LIMIT ? OFFSET ?`
    );
    selectStmt.bind([...params, filters.limit, filters.offset]);

    const tasks: ScheduledTask[] = [];
    while (selectStmt.step()) {
      const row = selectStmt.getAsObject() as { data: string };
      tasks.push(JSON.parse(row.data) as ScheduledTask);
    }
    selectStmt.free();

    // If type filter is provided, filter in memory (not indexed)
    const filteredTasks = filters.type
      ? tasks.filter((t) => t.type === filters.type)
      : tasks;

    return {
      total: countRow.count,
      tasks: filteredTasks,
    };
  }
}
