import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import DataTable, { Column } from '../data-table';

interface TestItem {
  id: string;
  name: string;
  email: string;
  role: string;
}

const mockColumns: Column<TestItem>[] = [
  { key: 'name', header: 'Nombre', sortable: true },
  { key: 'email', header: 'Email' },
  { key: 'role', header: 'Rol', sortable: true },
];

const mockData: TestItem[] = [
  { id: '1', name: 'Juan Pérez', email: 'juan@example.com', role: 'Admin' },
  { id: '2', name: 'María García', email: 'maria@example.com', role: 'User' },
  { id: '3', name: 'Carlos López', email: 'carlos@example.com', role: 'Editor' },
];

const defaultProps = {
  columns: mockColumns,
  data: mockData,
  total: 25,
  page: 1,
  limit: 10,
  totalPages: 3,
  onPageChange: jest.fn(),
  keyExtractor: (item: TestItem) => item.id,
};

describe('DataTable', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders table with data', () => {
    render(<DataTable {...defaultProps} />);
    
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
    expect(screen.getByText('María García')).toBeInTheDocument();
    expect(screen.getByText('Carlos López')).toBeInTheDocument();
  });

  it('renders column headers', () => {
    render(<DataTable {...defaultProps} />);
    
    expect(screen.getByText('Nombre')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Rol')).toBeInTheDocument();
  });

  it('shows pagination info', () => {
    render(<DataTable {...defaultProps} />);
    
    expect(screen.getByText(/Mostrando 1-10 de 25 registros/)).toBeInTheDocument();
  });

  it('calls onPageChange when clicking next page', () => {
    const onPageChange = jest.fn();
    render(<DataTable {...defaultProps} onPageChange={onPageChange} />);
    
    const nextButton = screen.getByLabelText('Página siguiente');
    fireEvent.click(nextButton);
    
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('calls onPageChange when clicking previous page', () => {
    const onPageChange = jest.fn();
    render(<DataTable {...defaultProps} page={2} onPageChange={onPageChange} />);
    
    const prevButton = screen.getByLabelText('Página anterior');
    fireEvent.click(prevButton);
    
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('disables first/prev buttons on first page', () => {
    render(<DataTable {...defaultProps} page={1} />);
    
    expect(screen.getByLabelText('Primera página')).toBeDisabled();
    expect(screen.getByLabelText('Página anterior')).toBeDisabled();
  });

  it('disables next/last buttons on last page', () => {
    render(<DataTable {...defaultProps} page={3} totalPages={3} />);
    
    expect(screen.getByLabelText('Página siguiente')).toBeDisabled();
    expect(screen.getByLabelText('Última página')).toBeDisabled();
  });

  it('calls onSearch when typing in search input', () => {
    const onSearch = jest.fn();
    render(<DataTable {...defaultProps} onSearch={onSearch} />);
    
    const searchInput = screen.getByLabelText('Buscar registros');
    fireEvent.change(searchInput, { target: { value: 'Juan' } });
    
    expect(onSearch).toHaveBeenCalledWith('Juan');
  });

  it('clears search when clicking clear button', () => {
    const onSearch = jest.fn();
    render(<DataTable {...defaultProps} onSearch={onSearch} searchValue="test" />);
    
    const clearButton = screen.getByLabelText('Limpiar búsqueda');
    fireEvent.click(clearButton);
    
    expect(onSearch).toHaveBeenCalledWith('');
  });

  it('shows loading state', () => {
    render(<DataTable {...defaultProps} isLoading={true} />);
    
    expect(screen.getByText('Cargando datos...')).toBeInTheDocument();
  });

  it('shows empty message when no data', () => {
    render(<DataTable {...defaultProps} data={[]} total={0} totalPages={0} />);
    
    expect(screen.getByText('No se encontraron registros')).toBeInTheDocument();
  });

  it('shows custom empty message', () => {
    render(
      <DataTable
        {...defaultProps}
        data={[]}
        total={0}
        totalPages={0}
        emptyMessage="No hay usuarios disponibles"
      />
    );
    
    expect(screen.getByText('No hay usuarios disponibles')).toBeInTheDocument();
  });

  it('calls onSort when clicking sortable column header', () => {
    const onSort = jest.fn();
    render(<DataTable {...defaultProps} onSort={onSort} />);
    
    const nameHeader = screen.getByText('Nombre');
    fireEvent.click(nameHeader);
    
    expect(onSort).toHaveBeenCalledWith('name', 'asc');
  });

  it('toggles sort direction on second click', () => {
    const onSort = jest.fn();
    render(<DataTable {...defaultProps} onSort={onSort} sortKey="name" sortDirection="asc" />);
    
    const nameHeader = screen.getByText('Nombre');
    fireEvent.click(nameHeader);
    
    expect(onSort).toHaveBeenCalledWith('name', 'desc');
  });

  it('renders custom cell renderer', () => {
    const columnsWithRender: Column<TestItem>[] = [
      {
        key: 'name',
        header: 'Nombre',
        render: (item) => <strong>{item.name}</strong>,
      },
    ];
    
    render(<DataTable {...defaultProps} columns={columnsWithRender} />);
    
    expect(screen.getByText('Juan Pérez').tagName).toBe('STRONG');
  });

  it('calls onLimitChange when changing page size', () => {
    const onLimitChange = jest.fn();
    render(<DataTable {...defaultProps} onLimitChange={onLimitChange} />);
    
    const select = screen.getByLabelText('Registros por página');
    fireEvent.change(select, { target: { value: '20' } });
    
    expect(onLimitChange).toHaveBeenCalledWith(20);
  });

  it('renders pagination page buttons', () => {
    render(<DataTable {...defaultProps} totalPages={5} />);
    
    expect(screen.getByLabelText('Ir a página 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Ir a página 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Ir a página 3')).toBeInTheDocument();
  });

  it('highlights current page button', () => {
    render(<DataTable {...defaultProps} page={2} />);
    
    const currentPageButton = screen.getByLabelText('Ir a página 2');
    expect(currentPageButton).toHaveClass('bg-blue-600 text-white');
  });
});