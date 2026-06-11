import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { ToolCallBadge } from './ToolCallBadge';
import type { ChatMessage } from '@/hooks/useAgentSession';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === 'system') {
    return (
      <div className="flex justify-center py-1">
        <span className="text-xs text-muted-foreground px-3">{message.content}</span>
      </div>
    );
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  // assistant
  if (message.toolCalls?.length) {
    return (
      <div className="flex flex-col gap-1.5">
        {message.toolCalls.map(tc => (
          <ToolCallBadge key={tc.id} toolCall={tc} />
        ))}
      </div>
    );
  }

  if (!message.content) return null;

  return (
    <div className="flex gap-3 items-start">
      {(message.agentIcon || message.agentName) && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs mt-0.5">
          {message.agentIcon ?? message.agentName?.[0] ?? '◆'}
        </div>
      )}
      <div className="flex-1 min-w-0">
        {message.agentName && (
          <p className="text-xs text-muted-foreground mb-1">{message.agentName}</p>
        )}
        <div className={cn(
          'prose prose-invert prose-sm max-w-none',
          'prose-p:leading-relaxed prose-p:my-1',
          'prose-pre:bg-secondary prose-pre:text-secondary-foreground prose-pre:text-xs',
          'prose-code:bg-secondary prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono',
          'prose-headings:text-foreground prose-headings:font-semibold',
          'prose-strong:text-foreground',
          'prose-li:my-0',
          message.isStreaming && 'after:content-["▋"] after:ml-0.5 after:animate-pulse after:text-muted-foreground',
        )}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
