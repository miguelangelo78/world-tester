"use client";

import { MobileMenuButton } from "./sidebar";

interface PageHeaderProps {
  left: React.ReactNode;
  right?: React.ReactNode;
}

export function PageHeader({ left, right }: PageHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-border px-3 sm:px-4 py-2 sm:py-3 gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <MobileMenuButton />
        {left}
      </div>
      {right}
    </header>
  );
}
