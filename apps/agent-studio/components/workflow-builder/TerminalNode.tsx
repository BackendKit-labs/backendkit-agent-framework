'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/components/ui';

export interface TerminalNodeData extends Record<string, unknown> {
  label: string;
  kind: 'start' | 'end';
}

function TerminalNodeComponent({ data }: NodeProps) {
  const d = data as TerminalNodeData;
  const isStart = d.kind === 'start';
  return (
    <>
      {!isStart && (
        <Handle type="target" position={Position.Left} className="!bg-border !border-border !w-2 !h-2" />
      )}

      <div className={cn(
        'rounded-full border px-4 py-2 text-xs font-semibold',
        isStart
          ? 'border-emerald-700/40 bg-emerald-950/30 text-emerald-400'
          : 'border-sky-700/40 bg-sky-950/30 text-sky-400',
      )}>
        {d.label}
      </div>

      {isStart && (
        <Handle type="source" position={Position.Right} className="!bg-border !border-border !w-2 !h-2" />
      )}
    </>
  );
}

export const TerminalNode = memo(TerminalNodeComponent);
TerminalNode.displayName = 'TerminalNode';
