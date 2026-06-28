interface AgentFormData {
    name: string;
    description: string;
    type: 'chat' | 'task' | 'monitor' | 'custom';
    status: 'idle' | 'active' | 'error' | 'stopped';
    config: string;
    projectId: string;
    model: string;
}
interface Agent {
    id: string;
    name: string;
    description?: string;
    type: 'chat' | 'task' | 'monitor' | 'custom';
    status: 'idle' | 'active' | 'error' | 'stopped';
    config?: Record<string, unknown>;
    projectId?: string;
    model?: string;
    createdAt: string;
    updatedAt: string;
}
interface Project {
    id: string;
    name: string;
}
interface AgentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: AgentFormData) => Promise<void>;
    agent?: Agent | null;
    projects: Project[];
}
export default function AgentModal({ isOpen, onClose, onSave, agent, projects, }: AgentModalProps): any;
export {};
