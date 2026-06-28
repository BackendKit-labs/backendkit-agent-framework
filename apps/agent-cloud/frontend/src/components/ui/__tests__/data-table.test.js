"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = __importDefault(require("react"));
const react_2 = require("@testing-library/react");
require("@testing-library/jest-dom");
const data_table_1 = __importDefault(require("../data-table"));
const mockColumns = [
    { key: 'name', header: 'Nombre', sortable: true },
    { key: 'email', header: 'Email' },
    { key: 'role', header: 'Rol', sortable: true },
];
const mockData = [
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
    keyExtractor: (item) => item.id,
};
describe('DataTable', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('renders table with data', () => {
        (0, react_2.render)(<data_table_1.default {...defaultProps}/>);
        expect(react_2.screen.getByText('Juan Pérez')).toBeInTheDocument();
        expect(react_2.screen.getByText('María García')).toBeInTheDocument();
        expect(react_2.screen.getByText('Carlos López')).toBeInTheDocument();
    });
    it('renders column headers', () => {
        (0, react_2.render)(<data_table_1.default {...defaultProps}/>);
        expect(react_2.screen.getByText('Nombre')).toBeInTheDocument();
        expect(react_2.screen.getByText('Email')).toBeInTheDocument();
        expect(react_2.screen.getByText('Rol')).toBeInTheDocument();
    });
    it('shows pagination info', () => {
        (0, react_2.render)(<data_table_1.default {...defaultProps}/>);
        expect(react_2.screen.getByText(/Mostrando 1-10 de 25 registros/)).toBeInTheDocument();
    });
    it('calls onPageChange when clicking next page', () => {
        const onPageChange = jest.fn();
        (0, react_2.render)(<data_table_1.default {...defaultProps} onPageChange={onPageChange}/>);
        const nextButton = react_2.screen.getByLabelText('Página siguiente');
        react_2.fireEvent.click(nextButton);
        expect(onPageChange).toHaveBeenCalledWith(2);
    });
    it('calls onPageChange when clicking previous page', () => {
        const onPageChange = jest.fn();
        (0, react_2.render)(<data_table_1.default {...defaultProps} page={2} onPageChange={onPageChange}/>);
        const prevButton = react_2.screen.getByLabelText('Página anterior');
        react_2.fireEvent.click(prevButton);
        expect(onPageChange).toHaveBeenCalledWith(1);
    });
    it('disables first/prev buttons on first page', () => {
        (0, react_2.render)(<data_table_1.default {...defaultProps} page={1}/>);
        expect(react_2.screen.getByLabelText('Primera página')).toBeDisabled();
        expect(react_2.screen.getByLabelText('Página anterior')).toBeDisabled();
    });
    it('disables next/last buttons on last page', () => {
        (0, react_2.render)(<data_table_1.default {...defaultProps} page={3} totalPages={3}/>);
        expect(react_2.screen.getByLabelText('Página siguiente')).toBeDisabled();
        expect(react_2.screen.getByLabelText('Última página')).toBeDisabled();
    });
    it('calls onSearch when typing in search input', () => {
        const onSearch = jest.fn();
        (0, react_2.render)(<data_table_1.default {...defaultProps} onSearch={onSearch}/>);
        const searchInput = react_2.screen.getByLabelText('Buscar registros');
        react_2.fireEvent.change(searchInput, { target: { value: 'Juan' } });
        expect(onSearch).toHaveBeenCalledWith('Juan');
    });
    it('clears search when clicking clear button', () => {
        const onSearch = jest.fn();
        (0, react_2.render)(<data_table_1.default {...defaultProps} onSearch={onSearch} searchValue="test"/>);
        const clearButton = react_2.screen.getByLabelText('Limpiar búsqueda');
        react_2.fireEvent.click(clearButton);
        expect(onSearch).toHaveBeenCalledWith('');
    });
    it('shows loading state', () => {
        (0, react_2.render)(<data_table_1.default {...defaultProps} isLoading={true}/>);
        expect(react_2.screen.getByText('Cargando datos...')).toBeInTheDocument();
    });
    it('shows empty message when no data', () => {
        (0, react_2.render)(<data_table_1.default {...defaultProps} data={[]} total={0} totalPages={0}/>);
        expect(react_2.screen.getByText('No se encontraron registros')).toBeInTheDocument();
    });
    it('shows custom empty message', () => {
        (0, react_2.render)(<data_table_1.default {...defaultProps} data={[]} total={0} totalPages={0} emptyMessage="No hay usuarios disponibles"/>);
        expect(react_2.screen.getByText('No hay usuarios disponibles')).toBeInTheDocument();
    });
    it('calls onSort when clicking sortable column header', () => {
        const onSort = jest.fn();
        (0, react_2.render)(<data_table_1.default {...defaultProps} onSort={onSort}/>);
        const nameHeader = react_2.screen.getByText('Nombre');
        react_2.fireEvent.click(nameHeader);
        expect(onSort).toHaveBeenCalledWith('name', 'asc');
    });
    it('toggles sort direction on second click', () => {
        const onSort = jest.fn();
        (0, react_2.render)(<data_table_1.default {...defaultProps} onSort={onSort} sortKey="name" sortDirection="asc"/>);
        const nameHeader = react_2.screen.getByText('Nombre');
        react_2.fireEvent.click(nameHeader);
        expect(onSort).toHaveBeenCalledWith('name', 'desc');
    });
    it('renders custom cell renderer', () => {
        const columnsWithRender = [
            {
                key: 'name',
                header: 'Nombre',
                render: (item) => <strong>{item.name}</strong>,
            },
        ];
        (0, react_2.render)(<data_table_1.default {...defaultProps} columns={columnsWithRender}/>);
        expect(react_2.screen.getByText('Juan Pérez').tagName).toBe('STRONG');
    });
    it('calls onLimitChange when changing page size', () => {
        const onLimitChange = jest.fn();
        (0, react_2.render)(<data_table_1.default {...defaultProps} onLimitChange={onLimitChange}/>);
        const select = react_2.screen.getByLabelText('Registros por página');
        react_2.fireEvent.change(select, { target: { value: '20' } });
        expect(onLimitChange).toHaveBeenCalledWith(20);
    });
    it('renders pagination page buttons', () => {
        (0, react_2.render)(<data_table_1.default {...defaultProps} totalPages={5}/>);
        expect(react_2.screen.getByLabelText('Ir a página 1')).toBeInTheDocument();
        expect(react_2.screen.getByLabelText('Ir a página 2')).toBeInTheDocument();
        expect(react_2.screen.getByLabelText('Ir a página 3')).toBeInTheDocument();
    });
    it('highlights current page button', () => {
        (0, react_2.render)(<data_table_1.default {...defaultProps} page={2}/>);
        const currentPageButton = react_2.screen.getByLabelText('Ir a página 2');
        expect(currentPageButton).toHaveClass('bg-blue-600 text-white');
    });
});
//# sourceMappingURL=data-table.test.js.map