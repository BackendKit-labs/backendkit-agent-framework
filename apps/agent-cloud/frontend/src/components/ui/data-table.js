"use strict";
'use client';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = __importStar(require("react"));
const lucide_react_1 = require("lucide-react");
const input_1 = require("./input");
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];
function DataTable({ columns, data, total, page, limit, totalPages, onPageChange, onLimitChange, onSearch, searchValue = '', isLoading = false, emptyMessage = 'No se encontraron registros', keyExtractor, onSort, sortKey, sortDirection = 'asc', className = '', }) {
    const [searchInput, setSearchInput] = (0, react_1.useState)(searchValue);
    const [isSearchFocused, setIsSearchFocused] = (0, react_1.useState)(false);
    const handleSearchChange = (0, react_1.useCallback)((e) => {
        const value = e.target.value;
        setSearchInput(value);
        if (onSearch) {
            onSearch(value);
        }
    }, [onSearch]);
    const handleSearchClear = (0, react_1.useCallback)(() => {
        setSearchInput('');
        if (onSearch) {
            onSearch('');
        }
    }, [onSearch]);
    const handleSort = (0, react_1.useCallback)((key) => {
        if (!onSort)
            return;
        const newDirection = sortKey === key && sortDirection === 'asc' ? 'desc' : 'asc';
        onSort(key, newDirection);
    }, [onSort, sortKey, sortDirection]);
    const getSortIndicator = (0, react_1.useCallback)((key) => {
        if (sortKey !== key)
            return null;
        return sortDirection === 'asc' ? ' ▲' : ' ▼';
    }, [sortKey, sortDirection]);
    const startRecord = total === 0 ? 0 : (page - 1) * limit + 1;
    const endRecord = Math.min(page * limit, total);
    const renderPaginationButtons = (0, react_1.useMemo)(() => {
        const buttons = [];
        const maxVisiblePages = 5;
        let startPage = Math.max(1, page - Math.floor(maxVisiblePages / 2));
        const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
        if (endPage - startPage + 1 < maxVisiblePages) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }
        for (let i = startPage; i <= endPage; i++) {
            buttons.push(<button key={i} onClick={() => onPageChange(i)} className={`px-3 py-1 text-sm rounded-md transition-colors ${i === page
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'}`} aria-label={`Ir a página ${i}`} aria-current={i === page ? 'page' : undefined}>
          {i}
        </button>);
        }
        return buttons;
    }, [page, totalPages, onPageChange]);
    if (isLoading) {
        return (<div className={`flex flex-col items-center justify-center py-12 ${className}`}>
        <lucide_react_1.Loader2 className="h-8 w-8 animate-spin text-blue-600"/>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Cargando datos...</p>
      </div>);
    }
    return (<div className={`space-y-4 ${className}`}>
      
      {onSearch && (<div className="relative max-w-sm">
          <lucide_react_1.Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"/>
          <input_1.Input type="text" placeholder="Buscar..." value={searchInput} onChange={handleSearchChange} onFocus={() => setIsSearchFocused(true)} onBlur={() => setIsSearchFocused(false)} className="pl-10 pr-8" aria-label="Buscar registros"/>
          {searchInput && (<button onClick={handleSearchClear} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" aria-label="Limpiar búsqueda">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>)}
        </div>)}

      
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              {columns.map((column) => (<th key={column.key} className={`px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider ${column.sortable ? 'cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-700' : ''} ${column.className || ''}`} onClick={() => column.sortable && handleSort(column.key)} aria-sort={sortKey === column.key
                ? sortDirection === 'asc'
                    ? 'ascending'
                    : 'descending'
                : undefined}>
                  <div className="flex items-center gap-1">
                    {column.header}
                    {column.sortable && (<span className="text-gray-400 dark:text-gray-500">
                        {getSortIndicator(column.key)}
                      </span>)}
                  </div>
                </th>))}
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
            {data.length === 0 ? (<tr>
                <td colSpan={columns.length} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                  {emptyMessage}
                </td>
              </tr>) : (data.map((item) => (<tr key={keyExtractor(item)} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  {columns.map((column) => (<td key={`${keyExtractor(item)}-${column.key}`} className={`px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 ${column.className || ''}`}>
                      {column.render ? column.render(item) : item[column.key] || '-'}
                    </td>))}
                </tr>)))}
          </tbody>
        </table>
      </div>

      
      {total > 0 && (<div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <span>
              Mostrando {startRecord}-{endRecord} de {total} registros
            </span>
            {onLimitChange && (<select value={limit} onChange={(e) => onLimitChange(Number(e.target.value))} className="ml-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" aria-label="Registros por página">
                {PAGE_SIZE_OPTIONS.map((size) => (<option key={size} value={size}>
                    {size} / pág
                  </option>))}
              </select>)}
          </div>

          <div className="flex items-center gap-1">
            <button onClick={() => onPageChange(1)} disabled={page === 1} className="p-2 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed" aria-label="Primera página">
              <lucide_react_1.ChevronsLeft className="h-4 w-4"/>
            </button>
            <button onClick={() => onPageChange(page - 1)} disabled={page === 1} className="p-2 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed" aria-label="Página anterior">
              <lucide_react_1.ChevronLeft className="h-4 w-4"/>
            </button>

            {renderPaginationButtons}

            <button onClick={() => onPageChange(page + 1)} disabled={page === totalPages} className="p-2 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed" aria-label="Página siguiente">
              <lucide_react_1.ChevronRight className="h-4 w-4"/>
            </button>
            <button onClick={() => onPageChange(totalPages)} disabled={page === totalPages} className="p-2 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed" aria-label="Última página">
              <lucide_react_1.ChevronsRight className="h-4 w-4"/>
            </button>
          </div>
        </div>)}
    </div>);
}
exports.default = DataTable;
//# sourceMappingURL=data-table.js.map