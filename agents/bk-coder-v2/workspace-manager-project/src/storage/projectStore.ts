import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ProjectsFile, Project } from '../types.js';

// ── Path ──────────────────────────────────────────────────────────────────────

const BK_HOME = join(homedir(), '.backendkit');
const PROJECTS_PATH = join(BK_HOME, 'projects.json');

function ensureDir(): void {
  if (!existsSync(BK_HOME)) {
    mkdirSync(BK_HOME, { recursive: true });
  }
}

function emptyFile(): ProjectsFile {
  return { version: '1.0', current: null, projects: {} };
}

// ── Read / Write ──────────────────────────────────────────────────────────────

export function readProjects(): ProjectsFile {
  ensureDir();
  if (!existsSync(PROJECTS_PATH)) {
    const empty = emptyFile();
    writeFileSync(PROJECTS_PATH, JSON.stringify(empty, null, 2), 'utf-8');
    return empty;
  }
  const raw = readFileSync(PROJECTS_PATH, 'utf-8');
  try {
    return JSON.parse(raw) as ProjectsFile;
  } catch {
    // Corrupted file — reset
    const empty = emptyFile();
    writeFileSync(PROJECTS_PATH, JSON.stringify(empty, null, 2), 'utf-8');
    return empty;
  }
}

export function writeProjects(data: ProjectsFile): void {
  ensureDir();
  writeFileSync(PROJECTS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getProject(name: string): Project | undefined {
  const data = readProjects();
  return data.projects[name];
}

export function getCurrentProject(): Project | undefined {
  const data = readProjects();
  if (!data.current) return undefined;
  return data.projects[data.current];
}

export function getCurrentProjectName(): string | null {
  const data = readProjects();
  // If current points to a deleted project, clean it
  if (data.current && !data.projects[data.current]) {
    data.current = null;
    writeProjects(data);
  }
  return data.current;
}

export function saveProject(name: string, project: Project): void {
  const data = readProjects();
  data.projects[name] = project;
  writeProjects(data);
}

export function deleteProject(name: string): boolean {
  const data = readProjects();
  if (!data.projects[name]) return false;
  delete data.projects[name];
  // If the deleted project was current, clear current
  if (data.current === name) {
    data.current = null;
  }
  writeProjects(data);
  return true;
}

export function setCurrent(name: string | null): void {
  const data = readProjects();
  data.current = name;
  writeProjects(data);
}

export function projectExists(name: string): boolean {
  const data = readProjects();
  return name in data.projects;
}

export function listProjectNames(): string[] {
  const data = readProjects();
  return Object.keys(data.projects);
}
