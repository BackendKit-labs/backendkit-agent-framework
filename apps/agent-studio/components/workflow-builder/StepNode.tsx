'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Settings, Box } from 'lucide-react';
import { cn } from '@/components/ui';

export interface StepNodeData extends Record<string, unknown> {
  order: number;
  deployableName: string | null;
  hasConfig: boolean;
  selected: boolean;
}

function StepNodeComponent({ data, selected }: NodeProps) {
  const d = data as StepNodeData;
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border !border-border !w-2 !h-2" />

      <div className={cn(
        'min-w-[140px] rounded-xl border bg-card px-4 py-3 shadow-sm transition-all',
        selected ? 'border-primary shadow-primary/20 shadow-md' : 'border-border hover:border-border/80',
      )}>
        <div className="flex items-center gap-2">
          <span className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
            selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}>
            {d.order}
          </span>
          <div className="min-w-0 flex-1">
            {d.deployableName ? (
              <div className="flex items-center gap-1.5">
                <Box className="h-3 w-3 shrink-0 text-primary/70" />
                <span className="truncate text-xs font-medium text-foreground">{d.deployableName}</span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground italic">Sin deployable</span>
            )}
          </div>
          {d.hasConfig && (
            <Settings className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="!bg-border !border-border !w-2 !h-2" />
    </>
  );
}

export const StepNode = memo(StepNodeComponent);
StepNode.displayName = 'StepNode';
