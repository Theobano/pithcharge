'use client';

import { LoaderCircle } from 'lucide-react';

export function ActionLoadingOverlay({ message }: { message: string }) {
  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex min-w-56 flex-col items-center gap-3 border bg-card px-8 py-6 text-center shadow-lg">
        <LoaderCircle className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm font-medium">{message}</p>
        <p className="text-xs text-muted-foreground">Please wait while the charger responds.</p>
      </div>
    </div>
  );
}
