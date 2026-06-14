'use client';
import { useState } from 'react';
import { FileText, Sparkles, Copy, Check } from 'lucide-react';
import { Button, Tabs, TabsList, TabsTrigger, TabsContent, cn } from '@/components/ui';

interface DiffViewerProps {
    sourceText:       string;
    generatedContent: string;
    generatedTitle:   string;
    onEdit?: (content: string) => void;
}

export function DiffViewer({ sourceText, generatedContent, generatedTitle, onEdit }: DiffViewerProps) {
    const [copiedSource, setCopiedSource]    = useState(false);
    const [copiedGenerated, setCopiedGenerated] = useState(false);
    const [editMode, setEditMode]            = useState(false);
    const [editValue, setEditValue]          = useState(generatedContent);

    function copyToClipboard(text: string, which: 'source' | 'generated') {
        navigator.clipboard.writeText(text);
        if (which === 'source') { setCopiedSource(true); setTimeout(() => setCopiedSource(false), 2000); }
        else { setCopiedGenerated(true); setTimeout(() => setCopiedGenerated(false), 2000); }
    }

    function handleSaveEdit() {
        onEdit?.(editValue);
        setEditMode(false);
    }

    return (
        <Tabs defaultValue="split" className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between">
                <TabsList className="h-8">
                    <TabsTrigger value="split"     className="text-xs px-3">Vista dividida</TabsTrigger>
                    <TabsTrigger value="source"    className="text-xs px-3">Fuente original</TabsTrigger>
                    <TabsTrigger value="generated" className="text-xs px-3">Nota generada</TabsTrigger>
                </TabsList>
                {!editMode && (
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setEditMode(true)}>
                        <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                        Editar nota
                    </Button>
                )}
                {editMode && (
                    <div className="flex gap-2">
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditMode(false); setEditValue(generatedContent); }}>Cancelar</Button>
                        <Button size="sm" className="h-7 text-xs" onClick={handleSaveEdit}>Guardar cambios</Button>
                    </div>
                )}
            </div>

            {/* Split view */}
            <TabsContent value="split" className="flex-1 min-h-0 mt-3">
                <div className="grid grid-cols-2 gap-3 h-full">
                    <PanelView
                        label="Fuente original"
                        icon={<FileText className="h-3.5 w-3.5 text-muted-foreground" />}
                        content={sourceText}
                        onCopy={() => copyToClipboard(sourceText, 'source')}
                        copied={copiedSource}
                        variant="source"
                    />
                    <PanelView
                        label={generatedTitle}
                        icon={<Sparkles className="h-3.5 w-3.5 text-indigo-400" />}
                        content={editMode ? editValue : generatedContent}
                        onCopy={() => copyToClipboard(generatedContent, 'generated')}
                        copied={copiedGenerated}
                        variant="generated"
                        editable={editMode}
                        onEditChange={setEditValue}
                    />
                </div>
            </TabsContent>

            {/* Source only */}
            <TabsContent value="source" className="flex-1 min-h-0 mt-3">
                <PanelView
                    label="Fuente original"
                    icon={<FileText className="h-3.5 w-3.5 text-muted-foreground" />}
                    content={sourceText}
                    onCopy={() => copyToClipboard(sourceText, 'source')}
                    copied={copiedSource}
                    variant="source"
                    full
                />
            </TabsContent>

            {/* Generated only */}
            <TabsContent value="generated" className="flex-1 min-h-0 mt-3">
                <PanelView
                    label={generatedTitle}
                    icon={<Sparkles className="h-3.5 w-3.5 text-indigo-400" />}
                    content={editMode ? editValue : generatedContent}
                    onCopy={() => copyToClipboard(generatedContent, 'generated')}
                    copied={copiedGenerated}
                    variant="generated"
                    editable={editMode}
                    onEditChange={setEditValue}
                    full
                />
            </TabsContent>
        </Tabs>
    );
}

interface PanelViewProps {
    label:         string;
    icon:          React.ReactNode;
    content:       string;
    onCopy:        () => void;
    copied:        boolean;
    variant:       'source' | 'generated';
    editable?:     boolean;
    onEditChange?: (val: string) => void;
    full?:         boolean;
}

function PanelView({ label, icon, content, onCopy, copied, variant, editable, onEditChange, full }: PanelViewProps) {
    return (
        <div className={cn('flex flex-col rounded-xl border min-h-0', variant === 'source' ? 'border-border/50' : 'border-indigo-800/50 bg-indigo-950/10', full && 'h-full')}>
            {/* Panel header */}
            <div className={cn('flex items-center justify-between border-b px-4 py-2.5', variant === 'source' ? 'border-border/50' : 'border-indigo-800/30')}>
                <div className="flex items-center gap-2">
                    {icon}
                    <span className="text-xs font-medium truncate max-w-[200px]">{label}</span>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCopy}>
                    {copied
                        ? <Check className="h-3 w-3 text-emerald-400" />
                        : <Copy className="h-3 w-3 text-muted-foreground" />
                    }
                </Button>
            </div>
            {/* Content */}
            {editable ? (
                <textarea
                    className="flex-1 resize-none bg-transparent p-4 font-mono text-xs text-foreground outline-none min-h-[300px]"
                    value={content}
                    onChange={e => onEditChange?.(e.target.value)}
                />
            ) : (
                <pre className="flex-1 overflow-auto p-4 font-mono text-xs text-muted-foreground whitespace-pre-wrap break-words">
                    {content}
                </pre>
            )}
        </div>
    );
}
