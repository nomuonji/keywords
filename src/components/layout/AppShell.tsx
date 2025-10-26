import type { PropsWithChildren } from 'react';

interface AppShellProps extends PropsWithChildren {
  title: string;
}

export function AppShell({ title, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
            SEO Automation Dashboard
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
