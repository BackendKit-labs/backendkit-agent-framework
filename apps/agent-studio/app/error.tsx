'use client';

export default function Error({ reset }: { reset: () => void }) {
    return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
            <h1 className="text-4xl font-bold">Error</h1>
            <p className="text-muted-foreground">Something went wrong</p>
            <button
                onClick={reset}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
            >
                Try again
            </button>
        </div>
    );
}
