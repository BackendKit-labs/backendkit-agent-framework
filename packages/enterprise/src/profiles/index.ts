export { GENERAL_PROFILE }  from './general';
export { SUPPORT_PROFILE }  from './support';
export { HR_PROFILE }       from './hr';
export { SALES_PROFILE }    from './sales';
export { FINANCE_PROFILE }  from './finance';
export { OPS_PROFILE }      from './ops';
export { ENTERPRISE_TOOLS, VAULT_FOLDERS } from './constants';

import { GENERAL_PROFILE }  from './general';
import { SUPPORT_PROFILE }  from './support';
import { HR_PROFILE }       from './hr';
import { SALES_PROFILE }    from './sales';
import { FINANCE_PROFILE }  from './finance';
import { OPS_PROFILE }      from './ops';
import type { AgentProfile } from '@backendkit-labs/agent-core';

export const ALL_ENTERPRISE_PROFILES: AgentProfile[] = [
    GENERAL_PROFILE,
    SUPPORT_PROFILE,
    HR_PROFILE,
    SALES_PROFILE,
    FINANCE_PROFILE,
    OPS_PROFILE,
];
