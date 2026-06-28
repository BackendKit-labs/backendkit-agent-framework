import React from 'react';
export interface Column<T> {
    key: string;
    header: string;
    sortable?: boolean;
    render?: (item: T) => React.ReactNode;
    className?: string;
}
export interface DataTableProps<T> {
    columns: Column<T>[];
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    onLimitChange?: (limit: number) => void;
    onSearch?: (search: string) => void;
    searchValue?: string;
    isLoading?: boolean;
    emptyMessage?: string;
    keyExtractor: (item: T) => string;
    onSort?: (key: string, direction: 'asc' | 'desc') => void;
    sortKey?: string;
    sortDirection?: 'asc' | 'desc';
    className?: string;
}
declare function DataTable<T extends Record<string, unknown>>({ columns, data, total, page, limit, totalPages, onPageChange, onLimitChange, onSearch, searchValue, isLoading, emptyMessage, keyExtractor, onSort, sortKey, sortDirection, className, }: DataTableProps<T>): any;
export default DataTable;
