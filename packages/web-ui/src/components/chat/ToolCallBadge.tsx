import { cn } from '@/lib/utils';
import { Loader2, CheckCircle2, XCircle, Wrench } from 'lucide-react';
import type { ToolCall } from '@/hooks/useAgentSession';

interface ToolCallBadgeProps {
  toolCall: ToolCall;
}

export function ToolCallBadge({ toolCall }: ToolCallBadgeProps) {
  return (
    <div className={cn(
      'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium',
      toolCall.status === 'pending' && 'border-indigo-800/60 bg-indigo-950/40 text-indigo-300',
      toolCall.status === 'done'    && 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300',
      toolCall.status === 'error'   && 'border-red-800/60 bg-red-950/40 text-red-300',
    )}>
      {toolCall.status === 'pending' && <Loader2 className="h-3 w-3 animate-spin" />}
      {toolCall.status === 'done'    && <CheckCircle2 className="h-3 w-3" />}
      {toolCall.status === 'error'   && <XCircle className="h-3 w-3" />}
      <Wrench className="h-3 w-3 opacity-60" />
      <span>{toolCall.name}</span>
      {toolCall.argsPreview && (
        <span className="opacity-60 truncate max-w-[200px]">— {toolCall.argsPreview}</span>
      )}
    </div>
  );
}
