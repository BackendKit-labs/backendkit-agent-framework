"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { VaultDocument, VaultCategory } from "@/lib/types";

// ═════════════════════════════════════════════════════════════════════════
// 1.  Types
// ═════════════════════════════════════════════════════════════════════════

/** A node in the vault tree */
interface VaultTreeNode {
  id: string;
  label: string;
  type: "directory" | "document";
  children?: VaultTreeNode[];
  meta?: {
    extension: string;
    updatedAt?: string;
    category?: string;
    country?: string;
  };
}

/** Document detail loaded from the vault */
interface DocumentDetail {
  path: string;
  title: string;
  content: string;
  category: string;
  country: string;
  updatedAt: string;
}

// ═════════════════════════════════════════════════════════════════════════
// 2.  Constants — vault tree built from the actual vault/colombia directory
// ═════════════════════════════════════════════════════════════════════════

const VAULT_TREE: VaultTreeNode = {
  id: "vault",
  label: "Vault Colombia",
  type: "directory",
  children: [
    {
      id: "colombia",
      label: "Colombia",
      type: "directory",
      children: [
        {
          id: "colombia/contabilidad",
          label: "Contabilidad",
          type: "directory",
          children: [
            {
              id: "colombia/contabilidad/normas-niif",
              label: "Normas NIIF",
              type: "document",
              meta: { extension: "md", category: "contabilidad", country: "colombia" },
            },
          ],
        },
        {
          id: "colombia/impuestos",
          label: "Impuestos",
          type: "directory",
          children: [
            {
              id: "colombia/impuestos/retencion-en-la-fuente",
              label: "Retención en la Fuente",
              type: "document",
              meta: { extension: "md", category: "impuestos", country: "colombia" },
            },
          ],
        },
        {
          id: "colombia/indicadores",
          label: "Indicadores",
          type: "directory",
          children: [
            {
              id: "colombia/indicadores/smlv-2024",
              label: "SMLV 2024",
              type: "document",
              meta: { extension: "md", category: "indicadores", country: "colombia" },
            },
          ],
        },
        {
          id: "colombia/laboral",
          label: "Laboral",
          type: "directory",
          children: [
            {
              id: "colombia/laboral/cesantias",
              label: "Cesantías",
              type: "document",
              meta: { extension: "md", category: "laboral", country: "colombia" },
            },
            {
              id: "colombia/laboral/prestaciones-sociales",
              label: "Prestaciones Sociales",
              type: "document",
              meta: { extension: "md", category: "laboral", country: "colombia" },
            },
            {
              id: "colombia/laboral/prima-servicios",
              label: "Prima de Servicios",
              type: "document",
              meta: { extension: "md", category: "laboral", country: "colombia" },
            },
          ],
        },
        {
          id: "colombia/normativa",
          label: "Normativa",
          type: "directory",
          children: [
            {
              id: "colombia/normativa/reforma-tributaria-2024",
              label: "Reforma Tributaria 2024",
              type: "document",
              meta: { extension: "md", category: "normativa", country: "colombia" },
            },
          ],
        },
        {
          id: "colombia/plantillas",
          label: "Plantillas",
          type: "directory",
          children: [
            {
              id: "colombia/plantillas/reporte-balance-general",
              label: "Reporte Balance General",
              type: "document",
              meta: { extension: "md", category: "plantillas", country: "colombia" },
            },
            {
              id: "colombia/plantillas/reporte-estado-resultados",
              label: "Reporte Estado Resultados",
              type: "document",
              meta: { extension: "md", category: "plantillas", country: "colombia" },
            },
            {
              id: "colombia/plantillas/reporte-flujo-caja",
              label: "Reporte Flujo de Caja",
              type: "document",
              meta: { extension: "md", category: "plantillas", country: "colombia" },
            },
          ],
        },
      ],
    },
    {
      id: "normativas",
      label: "Normativas",
      type: "directory",
      children: [
        {
          id: "normativas/colombia",
          label: "Colombia",
          type: "directory",
          children: [
            {
              id: "normativas/colombia/dian-regulaciones",
              label: "DIAN Regulaciones",
              type: "document",
              meta: { extension: "md", category: "normativas", country: "colombia" },
            },
            {
              id: "normativas/colombia/iva",
              label: "IVA",
              type: "document",
              meta: { extension: "md", category: "normativas", country: "colombia" },
            },
            {
              id: "normativas/colombia/impuestos/industria-y-comercio",
              label: "Industria y Comercio",
              type: "document",
              meta: { extension: "md", category: "impuestos", country: "colombia" },
            },
            {
              id: "normativas/colombia/indicadores/uvt-2024",
              label: "UVT 2024",
              type: "document",
              meta: { extension: "md", category: "indicadores", country: "colombia" },
            },
          ],
        },
      ],
    },
  ],
};

/** Category metadata for the filter bar */
const CATEGORIES: VaultCategory[] = [
  { name: "contabilidad", label: "Contabilidad", documentCount: 1 },
  { name: "impuestos", label: "Impuestos", documentCount: 2 },
  { name: "indicadores", label: "Indicadores", documentCount: 2 },
  { name: "laboral", label: "Laboral", documentCount: 3 },
  { name: "normativa", label: "Normativa", documentCount: 1 },
  { name: "normativas", label: "Normativas Generales", documentCount: 2 },
  { name: "plantillas", label: "Plantillas", documentCount: 3 },
];

// ═════════════════════════════════════════════════════════════════════════
// 3.  State types & reducer
// ═════════════════════════════════════════════════════════════════════════

interface VaultPageState {
  /** Currently selected document id */
  selectedDocId: string | null;
  /** Loaded document detail */
  document: DocumentDetail | null;
  /** Whether the document is loading */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Search query */
  searchQuery: string;
  /** Active category filter */
  activeCategory: string | null;
  /** Expanded directory ids */
  expandedIds: Set<string>;
}

type VaultPageAction =
  | { type: "SELECT_DOCUMENT"; docId: string }
  | { type: "DOCUMENT_LOADED"; document: DocumentDetail }
  | { type: "DOCUMENT_ERROR"; error: string }
  | { type: "SET_SEARCH"; query: string }
  | { type: "SET_CATEGORY"; category: string | null }
  | { type: "TOGGLE_EXPAND"; id: string }
  | { type: "EXPAND_PATH"; ids: string[] }
  | { type: "CLEAR_DOCUMENT" };

function vaultReducer(
  state: VaultPageState,
  action: VaultPageAction,
): VaultPageState {
  switch (action.type) {
    case "SELECT_DOCUMENT":
      return { ...state, selectedDocId: action.docId, loading: true, error: null };
    case "DOCUMENT_LOADED":
      return { ...state, document: action.document, loading: false };
    case "DOCUMENT_ERROR":
      return { ...state, loading: false, error: action.error };
    case "SET_SEARCH":
      return { ...state, searchQuery: action.query };
    case "SET_CATEGORY":
      return { ...state, activeCategory: action.category };
    case "TOGGLE_EXPAND": {
      const next = new Set(state.expandedIds);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, expandedIds: next };
    }
    case "EXPAND_PATH": {
      const next = new Set(state.expandedIds);
      for (const id of action.ids) next.add(id);
      return { ...state, expandedIds: next };
    }
    case "CLEAR_DOCUMENT":
      return { ...state, document: null, selectedDocId: null };
    default:
      return state;
  }
}

const INITIAL_STATE: VaultPageState = {
  selectedDocId: null,
  document: null,
  loading: false,
  error: null,
  searchQuery: "",
  activeCategory: null,
  expandedIds: new Set(["vault", "colombia"]),
};

// ═════════════════════════════════════════════════════════════════════════
// 4.  Utility functions
// ═════════════════════════════════════════════════════════════════════════

/** Flatten tree to a list of nodes */
function flattenTree(node: VaultTreeNode): VaultTreeNode[] {
  const result: VaultTreeNode[] = [node];
  if (node.children) {
    for (const child of node.children) {
      result.push(...flattenTree(child));
    }
  }
  return result;
}

/** Find a node by id in the tree */
function findNodeById(
  node: VaultTreeNode,
  id: string,
): VaultTreeNode | null {
  if (node.id === id) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNodeById(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** Get the path segments for a node id */
function getPathSegments(id: string): string[] {
  return id.split("/");
}

/** Simulate loading document content from the vault */
async function loadDocumentContent(docId: string): Promise<DocumentDetail> {
  // In a real app, this would fetch from the backend API
  // For now, we simulate loading with a delay and return structured metadata
  const node = findNodeById(VAULT_TREE, docId);
  if (!node || node.type !== "document") {
    throw new Error("Documento no encontrado");
  }

  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 300));

  const segments = getPathSegments(docId);
  const category = segments.length >= 2 ? segments[segments.length - 2] : "general";
  const country = segments[0] || "colombia";

  return {
    path: docId,
    title: node.label,
    content: `# ${node.label}\n\n*Documento del vault de conocimiento — Categoría: ${category}*\n\nEste documento contiene información detallada sobre **${node.label}** en el contexto de la normativa colombiana.\n\n## Contenido\n\nEl contenido completo de este documento se cargará desde el vault. Por ahora, esta es una vista previa de la estructura.\n\n### Secciones\n\n1. **Introducción** — Contexto y alcance del documento\n2. **Marco Legal** — Normas y regulaciones aplicables\n3. **Detalles** — Información específica del tema\n4. **Ejemplos** — Casos prácticos de aplicación\n5. **Referencias** — Fuentes y normativa relacionada\n\n---\n\n*Documento actualizado: ${new Date().toLocaleDateString("es-CO", { dateStyle: "long" })}*`,
    category,
    country,
    updatedAt: new Date().toISOString(),
  };
}

// ═════════════════════════════════════════════════════════════════════════
// 5.  Sub-components
// ═════════════════════════════════════════════════════════════════════════

/* ─── Icons ─────────────────────────────────────────────────────────── */

function FolderIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 transition-colors ${
        expanded ? "text-primary-600" : "text-gray-400"
      }`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      {expanded ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l3 3h7a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"
        />
      ) : (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
        />
      )}
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-blue-500"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
      />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${
        expanded ? "rotate-90" : ""
      }`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      className="h-4 w-4 text-gray-400"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      className="h-5 w-5 animate-spin text-primary-600"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

/* ─── Tree node ─────────────────────────────────────────────────────── */

function TreeNode({
  node,
  depth,
  selectedId,
  onSelect,
  expandedIds,
  onToggle,
  searchQuery,
}: {
  node: VaultTreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  searchQuery: string;
}) {
  const isDirectory = node.type === "directory";
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;

  const isHighlighted =
    searchQuery &&
    (node.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.id.toLowerCase().includes(searchQuery.toLowerCase()));

  const handleClick = useCallback(() => {
    if (isDirectory) {
      onToggle(node.id);
    } else {
      onSelect(node.id);
    }
  }, [isDirectory, node.id, onSelect, onToggle]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
      if (e.key === "ArrowRight" && isDirectory && !isExpanded) {
        e.preventDefault();
        onToggle(node.id);
      }
      if (e.key === "ArrowLeft" && isDirectory && isExpanded) {
        e.preventDefault();
        onToggle(node.id);
      }
    },
    [handleClick, isDirectory, isExpanded, node.id, onToggle],
  );

  return (
    <div role="treeitem" aria-expanded={isDirectory ? isExpanded : undefined} aria-selected={isSelected}>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${isDirectory ? "Carpeta" : "Documento"}: ${node.label}`}
        className={`
          flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm
          transition-colors duration-100
          focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1
          ${
            isSelected
              ? "bg-primary-50 text-primary-900 font-medium"
              : isHighlighted
                ? "bg-yellow-50 text-gray-900"
                : "text-gray-700 hover:bg-gray-100"
          }
        `}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        {/* Chevron */}
        {isDirectory ? (
          <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
            <ChevronIcon expanded={isExpanded} />
          </span>
        ) : (
          <span className="w-4" aria-hidden="true" />
        )}

        {/* Icon */}
        {isDirectory ? <FolderIcon expanded={isExpanded} /> : <DocumentIcon />}

        {/* Label */}
        <span className="truncate">{node.label}</span>

        {/* Extension badge */}
        {!isDirectory && node.meta?.extension && (
          <span className="ml-auto text-xs uppercase text-gray-400">
            .{node.meta.extension}
          </span>
        )}
      </div>

      {/* Children */}
      {isDirectory && isExpanded && node.children && node.children.length > 0 && (
        <div role="group">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              expandedIds={expandedIds}
              onToggle={onToggle}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Category filter pills ─────────────────────────────────────────── */

function CategoryFilter({
  categories,
  activeCategory,
  onSelect,
}: {
  categories: VaultCategory[];
  activeCategory: string | null;
  onSelect: (category: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por categoría">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`
          rounded-full px-3 py-1 text-xs font-medium transition-colors
          focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1
          ${
            activeCategory === null
              ? "bg-primary-900 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }
        `}
        aria-pressed={activeCategory === null}
      >
        Todas
      </button>
      {categories.map((cat) => (
        <button
          key={cat.name}
          type="button"
          onClick={() => onSelect(cat.name)}
          className={`
            rounded-full px-3 py-1 text-xs font-medium transition-colors
            focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1
            ${
              activeCategory === cat.name
                ? "bg-primary-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }
          `}
          aria-pressed={activeCategory === cat.name}
        >
          {cat.label}
          <span className="ml-1 text-xs opacity-60">({cat.documentCount})</span>
        </button>
      ))}
    </div>
  );
}

/* ─── Document viewer ───────────────────────────────────────────────── */

function DocumentViewer({
  document,
  loading,
  error,
  onClose,
}: {
  document: DocumentDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const viewerId = useId();

  /* ── Loading state ──────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="card flex flex-col gap-4" aria-label="Cargando documento">
        <div className="flex items-center gap-2">
          <Spinner />
          <span className="text-sm text-gray-500">Cargando documento...</span>
        </div>
        <div className="space-y-3 animate-pulse">
          <div className="h-8 w-3/4 rounded bg-gray-200" />
          <div className="h-4 w-1/2 rounded bg-gray-100" />
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-4 rounded bg-gray-100"
                style={{ width: `${60 + Math.random() * 40}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── Error state ────────────────────────────────────────────────── */
  if (error) {
    return (
      <div className="card" role="alert">
        <div className="flex items-start gap-3">
          <svg
            className="mt-0.5 h-5 w-5 shrink-0 text-red-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
          <div className="flex-1">
            <p className="font-medium text-red-800">Error al cargar el documento</p>
            <p className="mt-1 text-sm text-red-600">{error}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500 rounded"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  /* ── Empty state ────────────────────────────────────────────────── */
  if (!document) {
    return (
      <div className="card flex flex-col items-center justify-center gap-4 py-16 text-gray-400">
        <svg
          className="h-12 w-12"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
        <div className="text-center">
          <p className="text-sm font-medium">Selecciona un documento</p>
          <p className="text-xs mt-1">
            Explora el vault y haz clic en un documento para ver su contenido.
          </p>
        </div>
      </div>
    );
  }

  /* ── Render document ────────────────────────────────────────────── */
  return (
    <div className="card animate-fade-in" role="region" aria-label={document.title}>
      {/* Document header */}
      <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-gray-900 truncate">
            {document.title}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-primary-700 font-medium">
              {document.category}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">
              {document.country}
            </span>
            <span>
              Actualizado:{" "}
              {new Date(document.updatedAt).toLocaleDateString("es-CO", {
                dateStyle: "long",
              })}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
          aria-label="Cerrar documento"
        >
          <svg
            className="h-5 w-5"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Document content */}
      <div className="mt-4 max-h-[70vh] overflow-y-auto scrollbar-thin">
        <div className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-headings:font-semibold prose-p:text-gray-700 prose-a:text-primary-700">
          {/* Render markdown-like content as structured HTML */}
          {document.content.split("\n").map((line, idx) => {
            if (line.startsWith("# ")) {
              return (
                <h1 key={idx} className="text-2xl font-bold text-gray-900 mt-6 mb-4 first:mt-0">
                  {line.slice(2)}
                </h1>
              );
            }
            if (line.startsWith("## ")) {
              return (
                <h2 key={idx} className="text-lg font-semibold text-gray-900 mt-5 mb-3">
                  {line.slice(3)}
                </h2>
              );
            }
            if (line.startsWith("### ")) {
              return (
                <h3 key={idx} className="text-base font-medium text-gray-900 mt-4 mb-2">
                  {line.slice(4)}
                </h3>
              );
            }
            if (line.startsWith("---")) {
              return <hr key={idx} className="my-6 border-gray-200" />;
            }
            if (line.startsWith("*") && line.endsWith("*")) {
              return (
                <p key={idx} className="text-sm text-gray-500 italic my-2">
                  {line.slice(1, -1)}
                </p>
              );
            }
            if (line.trim() === "") {
              return <div key={idx} className="h-2" />;
            }
            if (line.startsWith("1. ") || line.startsWith("2. ") || line.startsWith("3. ") || line.startsWith("4. ") || line.startsWith("5. ")) {
              return (
                <p key={idx} className="text-sm text-gray-700 ml-4 my-1">
                  {line}
                </p>
              );
            }
            if (line.startsWith("**") && line.endsWith("**")) {
              return (
                <p key={idx} className="text-sm font-semibold text-gray-800 my-2">
                  {line.slice(2, -2)}
                </p>
              );
            }
            return (
              <p key={idx} className="text-sm text-gray-700 my-1 leading-relaxed">
                {line}
              </p>
            );
          })}
        </div>
      </div>

      {/* Footer metadata */}
      <div className="mt-4 border-t border-gray-100 pt-3 flex items-center justify-between text-xs text-gray-400">
        <span>Ruta: {document.path}</span>
        <span className="font-mono">.md</span>
      </div>
    </div>
  );
}

/* ─── Tree skeleton ─────────────────────────────────────────────────── */

function TreeSkeleton() {
  return (
    <div className="flex flex-col gap-2 animate-pulse" aria-label="Cargando árbol">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-7 rounded-md bg-gray-100"
          style={{ marginLeft: `${(i % 3) * 16}px`, width: `${70 - i * 5}%` }}
        />
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 6.  Main VaultPage component
// ═════════════════════════════════════════════════════════════════════════

/**
 * VaultPage — explore the Colombia knowledge vault.
 *
 * Layout:
 * 1. Page header with title and description
 * 2. Category filter pills
 * 3. Two-column layout:
 *    - Left: tree explorer with search
 *    - Right: document viewer
 *
 * Features:
 * - Expandable/collapsible directory tree
 * - Document selection with content viewer
 * - Search/filter with auto-expand
 * - Category filter pills
 * - Loading, error, and empty states
 * - Full keyboard navigation and screen reader support
 */
export default function VaultPage() {
  const [state, dispatch] = useReducer(vaultReducer, INITIAL_STATE);
  const treeId = useId();
  const searchInputId = useId();
  const viewerRef = useRef<HTMLDivElement>(null);

  /* ── Load document when selected ─────────────────────────────────── */

  useEffect(() => {
    if (!state.selectedDocId) return;

    let cancelled = false;

    async function loadDoc() {
      try {
        const doc = await loadDocumentContent(state.selectedDocId!);
        if (!cancelled) {
          dispatch({ type: "DOCUMENT_LOADED", document: doc });
          // Scroll to viewer
          setTimeout(() => {
            viewerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 100);
        }
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: "DOCUMENT_ERROR",
            error: (err as Error).message || "Error al cargar el documento.",
          });
        }
      }
    }

    loadDoc();
    return () => { cancelled = true; };
  }, [state.selectedDocId]);

  /* ── Auto-expand to reveal selected document ─────────────────────── */

  useEffect(() => {
    if (!state.selectedDocId) return;

    const segments = state.selectedDocId.split("/");
    const ids: string[] = [];
    let path = "";
    for (const seg of segments) {
      path = path ? `${path}/${seg}` : seg;
      ids.push(path);
    }
    dispatch({ type: "EXPAND_PATH", ids });
  }, [state.selectedDocId]);

  /* ── Filtered tree for search ────────────────────────────────────── */

  const matchingNodeIds = useMemo(() => {
    if (!state.searchQuery.trim()) return null;

    const allNodes = flattenTree(VAULT_TREE);
    const query = state.searchQuery.toLowerCase();
    const ids = new Set(
      allNodes
        .filter(
          (n) =>
            n.label.toLowerCase().includes(query) ||
            n.id.toLowerCase().includes(query),
        )
        .map((n) => n.id),
    );

    // Include parents
    for (const node of allNodes) {
      if (ids.has(node.id)) {
        const segments = node.id.split("/");
        let path = "";
        for (const seg of segments.slice(0, -1)) {
          path = path ? `${path}/${seg}` : seg;
          ids.add(path);
        }
      }
    }

    return ids;
  }, [state.searchQuery]);

  /* ── Filtered tree by category ───────────────────────────────────── */

  const filteredTree = useMemo(() => {
    if (!state.activeCategory) return VAULT_TREE;

    function filterNode(node: VaultTreeNode): VaultTreeNode | null {
      if (node.type === "document") {
        return node.meta?.category === state.activeCategory ? node : null;
      }

      const filteredChildren = node.children
        ?.map(filterNode)
        .filter((n): n is VaultTreeNode => n !== null);

      if (filteredChildren && filteredChildren.length > 0) {
        return { ...node, children: filteredChildren };
      }

      return null;
    }

    return filterNode(VAULT_TREE) ?? VAULT_TREE;
  }, [state.activeCategory]);

  /* ── Handlers ────────────────────────────────────────────────────── */

  const handleSelectDocument = useCallback((docId: string) => {
    dispatch({ type: "SELECT_DOCUMENT", docId });
  }, []);

  const handleCloseDocument = useCallback(() => {
    dispatch({ type: "CLEAR_DOCUMENT" });
  }, []);

  const handleToggleExpand = useCallback((id: string) => {
    dispatch({ type: "TOGGLE_EXPAND", id });
  }, []);

  /* ── Stats ───────────────────────────────────────────────────────── */

  const stats = useMemo(() => {
    const allNodes = flattenTree(VAULT_TREE);
    const docs = allNodes.filter((n) => n.type === "document").length;
    const dirs = allNodes.filter((n) => n.type === "directory").length;
    return { docs, dirs };
  }, []);

  /* ── Render ──────────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col gap-8">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
          Vault de Conocimiento — Colombia
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Explora la base de conocimiento con normativas, indicadores, guías
          laborales y plantillas de reportes financieros para Colombia.
        </p>
      </header>

      {/* ── Category filter ─────────────────────────────────────────── */}
      <CategoryFilter
        categories={CATEGORIES}
        activeCategory={state.activeCategory}
        onSelect={(cat) => dispatch({ type: "SET_CATEGORY", category: cat })}
      />

      {/* ── Two-column layout ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* ── Left: Tree explorer ───────────────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="card flex flex-col gap-4">
            {/* Header */}
            <header>
              <h2 className="text-lg font-semibold text-gray-900">
                Explorador
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {stats.docs} documentos &middot; {stats.dirs} carpetas
              </p>
            </header>

            {/* Search */}
            <div className="relative">
              <label htmlFor={searchInputId} className="sr-only">
                Buscar en el vault
              </label>
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <SearchIcon />
              </div>
              <input
                id={searchInputId}
                type="search"
                value={state.searchQuery}
                onChange={(e) =>
                  dispatch({ type: "SET_SEARCH", query: e.target.value })
                }
                placeholder="Buscar documentos..."
                className="input pl-9"
                aria-describedby={`${treeId}-results-count`}
              />
            </div>

            {/* Results count (sr-only) */}
            <div
              id={`${treeId}-results-count`}
              className="sr-only"
              aria-live="polite"
            >
              {state.searchQuery.trim() && matchingNodeIds
                ? `${matchingNodeIds.size} resultados para "${state.searchQuery}"`
                : `${stats.docs} documentos disponibles`}
            </div>

            {/* Tree */}
            <nav aria-label="Explorador del vault">
              <div
                id={treeId}
                role="tree"
                aria-label="Árbol del vault de conocimiento"
                className="flex flex-col gap-0.5 overflow-y-auto scrollbar-thin"
                style={{ maxHeight: "65vh" }}
              >
                {filteredTree.children?.map((child) => (
                  <TreeNode
                    key={child.id}
                    node={child}
                    depth={0}
                    selectedId={state.selectedDocId}
                    onSelect={handleSelectDocument}
                    expandedIds={state.expandedIds}
                    onToggle={handleToggleExpand}
                    searchQuery={state.searchQuery}
                  />
                ))}
              </div>
            </nav>

            {/* Footer */}
            <footer className="border-t border-gray-100 pt-3 text-xs text-gray-400">
              {stats.docs} documentos &middot; {stats.dirs} carpetas
            </footer>
          </div>
        </div>

        {/* ── Right: Document viewer ────────────────────────────────── */}
        <div ref={viewerRef} className="lg:col-span-3" tabIndex={-1}>
          <DocumentViewer
            document={state.document}
            loading={state.loading}
            error={state.error}
            onClose={handleCloseDocument}
          />
        </div>
      </div>
    </div>
  );
}
