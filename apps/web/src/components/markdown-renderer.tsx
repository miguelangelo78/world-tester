"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const components: Components = {
  h1: ({ children }) => (
    <span className="block text-foreground font-bold text-sm mt-2 mb-1">{children}</span>
  ),
  h2: ({ children }) => (
    <span className="block text-foreground font-bold text-xs mt-2 mb-0.5">{children}</span>
  ),
  h3: ({ children }) => (
    <span className="block text-foreground font-semibold text-xs mt-1.5 mb-0.5">{children}</span>
  ),
  h4: ({ children }) => (
    <span className="block text-foreground font-semibold text-xs mt-1">{children}</span>
  ),
  p: ({ children }) => <span className="block my-0.5">{children}</span>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic text-foreground/80">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 underline hover:text-blue-300"
    >
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <code className="block my-1 rounded bg-card border border-border px-2 py-1.5 text-[10px] text-emerald-400 overflow-x-auto whitespace-pre">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-card border border-border px-1 py-px text-[10px] text-emerald-400">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <div className="my-1">{children}</div>,
  ul: ({ children }) => <ul className="ml-3 my-0.5 list-disc list-outside">{children}</ul>,
  ol: ({ children }) => <ol className="ml-3 my-0.5 list-decimal list-outside">{children}</ol>,
  li: ({ children }) => <li className="my-px">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-primary/50 pl-2 my-1 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border my-2" />,
  table: ({ children }) => (
    <div className="my-1 overflow-x-auto">
      <table className="border-collapse text-[10px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
  th: ({ children }) => (
    <th className="px-2 py-1 text-left font-semibold text-foreground">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-0.5 border-t border-border/50">{children}</td>
  ),
};

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
