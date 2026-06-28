/** Grupos de tools del Director para el workspace editor */
export const DIRECTOR_TOOL_GROUPS: { label: string; tools: string[] }[] = [
    {
        label: 'Vault (lectura)',
        tools: ['search_vault', 'vault_status', 'read_note'],
    },
    {
        label: 'Vault (escritura)',
        tools: ['curate_path', 'curate_link', 'clone_vault', 'init_embedder', 'reindex_vault', 'reset_vault'],
    },
    {
        label: 'Coder (SDD)',
        tools: ['orchestrator_design', 'orchestrator_sdd', 'orchestrator_run', 'orchestrator_approve', 'orchestrator_status', 'orchestrator_list_agents', 'orchestrator_list_runs', 'orchestrator_reflect', 'orchestrator_reflect_promote', 'orchestrator_reflect_demote'],
    },
    {
        label: 'Proyectos (Workspace)',
        tools: ['project_list', 'project_current', 'project_get_root', 'project_get_agent_config', 'project_agent_exists', 'project_switch', 'project_create', 'project_update', 'project_duplicate', 'project_delete'],
    },
    {
        label: 'Flows de negocio',
        tools: ['run_flow', 'start_flow', 'run_task', 'run_status', 'list_runs'],
    },
    {
        label: 'Scheduler',
        tools: ['schedule_task', 'list_scheduled', 'cancel_task', 'reschedule', 'task_status', 'get_current_time', 'get_user_timezone'],
    },
    {
        label: 'Health',
        tools: ['system_health', 'check_agent', 'check_environment', 'check_messaging', 'check_scheduler', 'check_vault', 'end_to_end_test'],
    },
    {
        label: 'Configuración',
        tools: ['get_config', 'list_configs', 'get_config_schema', 'validate_config', 'diff_config', 'set_config', 'set_secret', 'import_config', 'restore_config', 'commit_config', 'reload_config', 'detect_env', 'serve_config_ui'],
    },
    {
        label: 'Deploy (Fleet)',
        tools: ['deploy_agent', 'stop_agent', 'list_deployments', 'deploy_settings', 'fleet_health'],
    },
    {
        label: 'Notificaciones',
        tools: ['notify_user', 'send_notification', 'notify_scheduled', 'user_channels', 'list_channels', 'register_device', 'unregister_device', 'test_channel', 'get_notification_history', 'register_user_channels', 'list_devices'],
    },
];

export const ALL_TOOLS = DIRECTOR_TOOL_GROUPS.flatMap(g => g.tools);

/** Tools por defecto según el rol (refleja director.yaml) */
export const ROLE_DEFAULT_TOOLS: Record<string, string[]> = {
    admin:       ALL_TOOLS,
    development: ['search_vault','vault_status','read_note','curate_path','curate_link','clone_vault','init_embedder','reindex_vault','orchestrator_design','orchestrator_sdd','orchestrator_run','orchestrator_approve','orchestrator_status','orchestrator_list_agents','orchestrator_list_runs','orchestrator_reflect','project_list','project_current','project_get_root','project_get_agent_config','project_agent_exists','project_switch','project_create','project_update','project_duplicate','run_flow','start_flow','run_task','run_status','list_runs','schedule_task','list_scheduled','task_status','cancel_task','system_health','check_agent','check_environment','check_vault','get_config','validate_config','list_deployments','fleet_health','notify_user','notify_scheduled'],
    devops:      ['search_vault','vault_status','read_note','curate_path','clone_vault','reindex_vault','run_flow','start_flow','run_task','run_status','schedule_task','list_scheduled','task_status','cancel_task','system_health','check_agent','check_environment','check_messaging','check_scheduler','check_vault','get_config','validate_config','deploy_agent','stop_agent','list_deployments','fleet_health','notify_user'],
    hr:          ['search_vault','vault_status','read_note','run_flow','start_flow','run_task','run_status','schedule_task','list_scheduled','task_status','cancel_task','system_health','check_agent','notify_user','send_notification','notify_scheduled','user_channels','list_channels'],
    sales:       ['search_vault','vault_status','read_note','run_flow','start_flow','run_task','run_status','schedule_task','list_scheduled','task_status','cancel_task','system_health','notify_user','send_notification','notify_scheduled'],
    finance:     ['search_vault','vault_status','read_note','run_flow','start_flow','run_task','run_status','schedule_task','list_scheduled','task_status','cancel_task','system_health','notify_user','send_notification','notify_scheduled'],
    viewer:      ['search_vault','vault_status','read_note','system_health'],
};

export const VAULT_NAMESPACES = ['finanzas/', 'rh/', 'ventas/', 'backend/', 'infra/', 'config/'];
