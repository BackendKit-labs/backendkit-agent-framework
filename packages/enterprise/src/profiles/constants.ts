/** Tool names registered by createEnterpriseSetup(). */
export const ENTERPRISE_TOOLS = {
    SEARCH_GENERAL:    'search_knowledge',
    SEARCH_SUPPORT:    'search_support_kb',
    SEARCH_HR:         'search_hr_kb',
    SEARCH_SALES:      'search_sales_kb',
    SEARCH_FINANCE:    'search_finance_kb',
    SEARCH_OPS:        'search_ops_kb',
    WRITE_KNOWLEDGE:   'write_knowledge',
    ASK_AGENT:         'ask_agent',
} as const;

/** Vault subfolder for each department. */
export const VAULT_FOLDERS = {
    GENERAL:     'general',
    SUPPORT:     'soporte',
    HR:          'rrhh',
    SALES:       'ventas',
    FINANCE:     'finanzas',
    OPS:         'operaciones',
    AGENTS:      'agentes',
    /** Business policies — indexed by all dept RAGs so agents can query them. */
    POLICIES:    'politicas',
} as const;
