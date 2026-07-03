"use client";

import {
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

/* ─── Types ─────────────────────────────────────────────────────────── */

/** A single node in the vault tree */
export interface VaultTreeNode {
  /** Unique identifier (path segments joined by "/") */
  id: string;
  /** Display label */
  label: string;
  /** Whether this node is a directory (has children) or a document (leaf) */
  type: "directory" | "document";
  /** Child nodes (only for directories) */
  children?: VaultTreeNode[];
  /** Optional metadata for documents */
  meta?: {
    /** File extension (e.g. "md", "pdf") */
    extension: string;
    /** Last modified timestamp */
    updatedAt?: string;
    /** Document category */
    category?: string;
    /** Country scope */
    country?: string;
  };
}

/** Props for the VaultExplorer component */
interface VaultExplorerProps {
  /** The root tree node of the vault */
  tree: VaultTreeNode;
  /** Currently selected document id (if any) */
  selectedDocumentId?: string | null;
  /** Called when a document is selected */
  onSelectDocument?: (node: VaultTreeNode) => void;
  /** Whether the vault data is loading */
  loading?: boolean;
  /** Error message to display */
  error?: string | null;
  /** Additional CSS classes */
  className?: string;
}

/* ─── Icons ─────────────────────────────────────────────────────────── */

function FolderIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 transition-transform duration-150 ${
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

function DocumentIcon({ extension }: { extension: string }) {
  const color =
    extension === "md"
      ? "text-blue-500"
      : extension === "pdf"
        ? "text-red-500"
        : "text-gray-400";

  return (
    <svg
      className={`h-4 w-4 shrink-0 ${color}`}
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
      className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform duration-150 ${
        expanded ? "rotate-90" : ""
      }`}
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
        d="M9 5l7 7-7 7"
      />
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

function SpinnerIcon() {
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

/* ─── Tree node component ───────────────────────────────────────────── */

interface TreeNodeProps {
  node: VaultTreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (node: VaultTreeNode) => void;
  expandedIds: Set<string>;
  setExpandedIds: Dispatch<SetStateAction<Set<string>>>;
  searchQuery: string;
}

function TreeNode({
  node,
  depth,
  selectedId,
  onSelect,
  expandedIds,
  setExpandedIds,
  searchQuery,
}: TreeNodeProps) {
  const isDirectory = node.type === "directory";
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;
  const nodeRef = useRef<HTMLDivElement>(null);

  /* Auto-expand parent of a matching search result */
  useEffect(() => {
    if (searchQuery && !isExpanded && isDirectory) {
      const hasMatchingChild = node.children?.some(
        (child) =>
          child.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          child.id.toLowerCase().includes(searchQuery.toLowerCase()),
      );
      if (hasMatchingChild) {
        setExpandedIds((prev) => new Set(prev).add(node.id));
      }
    }
  }, [searchQuery, isExpanded, isDirectory, node, setExpandedIds]);

  const handleToggle = useCallback(() => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) {
        next.delete(node.id);
      } else {
        next.add(node.id);
      }
      return next;
    });
  }, [node.id, setExpandedIds]);

  const handleSelect = useCallback(() => {
    if (!isDirectory) {
      onSelect(node);
    }
  }, [isDirectory, node, onSelect]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (isDirectory) {
          handleToggle();
        } else {
          handleSelect();
        }
      }
      if (e.key === "ArrowRight" && isDirectory && !isExpanded) {
        e.preventDefault();
        handleToggle();
      }
      if (e.key === "ArrowLeft" && isDirectory && isExpanded) {
        e.preventDefault();
        handleToggle();
      }
    },
    [isDirectory, handleToggle, handleSelect, isExpanded],
  );

  const isHighlighted =
    searchQuery &&
    (node.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.id.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div role="treeitem" aria-expanded={isDirectory ? isExpanded : undefined} aria-selected={isSelected}>
      {/* Node row */}
      <div
        ref={nodeRef}
        role={isDirectory ? "button" : "button"}
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
        onClick={() => {
          if (isDirectory) handleToggle();
          else handleSelect();
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Chevron for directories */}
        {isDirectory ? (
          <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
            <ChevronIcon expanded={isExpanded} />
          </span>
        ) : (
          <span className="w-4" aria-hidden="true" />
        )}

        {/* Folder / Document icon */}
        {isDirectory ? (
          <FolderIcon expanded={isExpanded} />
        ) : (
          <DocumentIcon extension={node.meta?.extension ?? "md"} />
        )}

        {/* Label */}
        <span className="truncate">{node.label}</span>

        {/* Extension badge for documents */}
        {!isDirectory && node.meta?.extension && (
          <span className="ml-auto text-xs uppercase text-gray-400">
            .{node.meta.extension}
          </span>
        )}
      </div>

      {/* Children (only for expanded directories) */}
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
              setExpandedIds={setExpandedIds}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Flatten tree for search ───────────────────────────────────────── */

function flattenTree(node: VaultTreeNode): VaultTreeNode[] {
  const result: VaultTreeNode[] = [node];
  if (node.children) {
    for (const child of node.children) {
      result.push(...flattenTree(child));
    }
  }
  return result;
}

/* ─── VaultExplorer Component ───────────────────────────────────────── */

/**
 * VaultExplorer — an accessible tree explorer for the vault knowledge base.
 *
 * Features:
 * - Expandable/collapsible directory tree
 * - Document selection with visual highlight
 * - Search/filter with auto-expand of matching parents
 * - Full keyboard navigation (Enter, Space, Arrow keys)
 * - Loading skeleton and error states
 * - Screen reader support via ARIA tree role
 *
 * @example
 * ```tsx
 * <VaultExplorer
 *   tree={vaultTree}
 *   selectedDocumentId="colombia/impuestos/retencion-en-la-fuente"
 *   onSelectDocument={(node) => console.log(node.id)}
 * />
 * ```
 */
export function VaultExplorer({
  tree,
  selectedDocumentId = null,
  onSelectDocument,
  loading = false,
  error = null,
  className = "",
}: VaultExplorerProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set([tree.id]),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const treeId = useId();
  const searchInputId = useId();

  /* Auto-expand to reveal the selected document */
  useEffect(() => {
    if (!selectedDocumentId) return;

    const segments = selectedDocumentId.split("/");
    const newExpanded = new Set(expandedIds);
    let path = "";
    for (const seg of segments.slice(0, -1)) {
      path = path ? `${path}/${seg}` : seg;
      newExpanded.add(path);
    }
    setExpandedIds(newExpanded);
    // Only on mount / when selectedDocumentId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDocumentId]);

  /* Filtered tree for search — returns a Set of matching node ids */
  const matchingNodeIds = useMemo(() => {
    if (!searchQuery.trim()) return null;

    const allNodes = flattenTree(tree);
    const query = searchQuery.toLowerCase();
    const ids = new Set(
      allNodes
        .filter(
          (n) =>
            n.label.toLowerCase().includes(query) ||
            n.id.toLowerCase().includes(query),
        )
        .map((n) => n.id),
    );

    // Include all parents of matching nodes
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
  }, [searchQuery, tree]);

  /* ── Loading state ─────────────────────────────────────────────── */
  if (loading) {
    return (
      <div
        className={`card flex flex-col gap-3 ${className}`}
        aria-label="Cargando explorador del vault"
      >
        <div className="flex items-center gap-2">
          <SpinnerIcon />
          <span className="text-sm text-gray-500">Cargando vault...</span>
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-7 animate-pulse rounded-md bg-gray-100"
              style={{ marginLeft: `${(i % 3) * 16}px`, width: `${80 - i * 8}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  /* ── Error state ───────────────────────────────────────────────── */
  if (error) {
    return (
      <div
        className={`card flex flex-col gap-3 ${className}`}
        role="alert"
      >
        <div className="flex items-center gap-2 text-red-600">
          <svg
            className="h-5 w-5 shrink-0"
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
          <span className="text-sm font-medium">Error al cargar el vault</span>
        </div>
        <p className="text-sm text-gray-600">{error}</p>
      </div>
    );
  }

  /* ── Empty tree ────────────────────────────────────────────────── */
  if (!tree.children || tree.children.length === 0) {
    return (
      <div className={`card flex flex-col items-center gap-3 py-8 ${className}`}>
        <FolderIcon expanded={false} />
        <p className="text-sm text-gray-400">El vault está vacío</p>
      </div>
    );
  }

  /* ── Render ────────────────────────────────────────────────────── */
  return (
    <div className={`card flex flex-col gap-4 ${className}`}>
      {/* Header */}
      <header>
        <h2 className="text-lg font-semibold text-gray-900">Vault</h2>
        <p className="mt-1 text-sm text-gray-500">
          Base de conocimiento — documentos y normativas
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
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
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
        {searchQuery.trim() && matchingNodeIds
          ? `${matchingNodeIds.size} resultados para "${searchQuery}"`
          : `${flattenTree(tree).filter((n) => n.type === "document").length} documentos disponibles`}
      </div>

      {/* Tree */}
      <nav aria-label="Explorador del vault">
        <div
          id={treeId}
          role="tree"
          aria-label="Árbol del vault"
          className="flex flex-col gap-0.5 overflow-y-auto scrollbar-thin"
          style={{ maxHeight: "60vh" }}
        >
          {tree.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={0}
              selectedId={selectedDocumentId}
              onSelect={(node) => onSelectDocument?.(node)}
              expandedIds={expandedIds}
              setExpandedIds={setExpandedIds}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      </nav>

      {/* Footer stats */}
      <footer className="border-t border-gray-100 pt-3 text-xs text-gray-400">
        {(() => {
          const docs = flattenTree(tree).filter((n) => n.type === "document").length;
          const dirs = flattenTree(tree).filter((n) => n.type === "directory").length;
          return `${docs} documentos · ${dirs} carpetas`;
        })()}
      </footer>
    </div>
  );
}
