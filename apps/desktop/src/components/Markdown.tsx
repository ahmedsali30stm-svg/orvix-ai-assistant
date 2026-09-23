import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ── Markdown renderer for assistant bubbles ───────────────────────────────
// GFM: bold, lists, tables, strikethrough. Code blocks get a copy button.
// Styling is hand-rolled (no typography plugin) to match the Orvix theme.

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md-body text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noreferrer" className="text-cyan-300 underline decoration-cyan-400/40 hover:decoration-cyan-300 break-all" />,
          code: (props) => {
            const { className, children } = props;
            const isBlock = /language-/.test(className ?? "");
            if (!isBlock) {
              return <code className="mono rounded bg-white/10 px-1.5 py-0.5 text-[0.85em] text-cyan-200">{children}</code>;
            }
            return <CodeBlock className={className}>{children}</CodeBlock>;
          },
          pre: (props) => <>{props.children}</>,
          table: (props) => (
            <div className="my-2 overflow-x-auto rounded-xl border border-edge">
              <table {...props} className="w-full text-xs" />
            </div>
          ),
          thead: (props) => <thead {...props} className="bg-white/5" />,
          th: (props) => <th {...props} className="border-b border-edge px-2.5 py-1.5 text-left font-semibold text-slate-300" />,
          td: (props) => <td {...props} className="border-b border-edge/50 px-2.5 py-1.5 align-top" />,
          ul: (props) => <ul {...props} className="my-1.5 list-disc pl-5 space-y-0.5" />,
          ol: (props) => <ol {...props} className="my-1.5 list-decimal pl-5 space-y-0.5" />,
          li: (props) => <li {...props} className="marker:text-cyan-400/70" />,
          p: (props) => <p {...props} className="my-1 first:mt-0 last:mb-0" />,
          h1: (props) => <h1 {...props} className="my-2 text-base font-semibold text-slate-100" />,
          h2: (props) => <h2 {...props} className="my-2 text-[15px] font-semibold text-slate-100" />,
          h3: (props) => <h3 {...props} className="my-1.5 text-sm font-semibold text-slate-200" />,
          blockquote: (props) => <blockquote {...props} className="my-2 border-l-2 border-cyan-400/40 pl-3 text-slate-300 italic" />,
          hr: () => <hr className="my-3 border-edge" />,
          strong: (props) => <strong {...props} className="font-semibold text-slate-100" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = String(children ?? "").replace(/\n$/, "");
  return (
    <div className="relative my-2 group">
      <button
        onClick={() => {
          navigator.clipboard?.writeText(code).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            },
            () => {},
          );
        }}
        className="absolute right-2 top-2 rounded-lg glass px-2 py-1 text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 hover:text-cyan-300 transition"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
      <pre className="overflow-x-auto rounded-xl border border-edge bg-black/40 p-3 text-xs">
        <code className={`mono text-cyan-100/90 ${className ?? ""}`}>{code}</code>
      </pre>
    </div>
  );
}
