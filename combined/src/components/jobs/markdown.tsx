import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cx } from "@/utils/cx";

/** Render markdown text with GitHub-flavored extensions, styled via semantic tokens. */
export function Markdown({ children, className }: { children: string; className?: string }) {
    return (
        <div
            className={cx(
                "text-sm leading-relaxed text-secondary",
                "[&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-primary",
                "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-primary",
                "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:text-primary",
                "[&_p]:my-2 [&_ul]:my-2 [&_ul]:ml-5 [&_ul]:list-disc [&_ol]:my-2 [&_ol]:ml-5 [&_ol]:list-decimal",
                "[&_a]:text-brand-secondary [&_a]:underline [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs",
                "[&_blockquote]:border-l-2 [&_blockquote]:border-secondary [&_blockquote]:pl-3 [&_blockquote]:text-tertiary [&_table]:my-2 [&_th]:text-left [&_th]:pr-4 [&_td]:pr-4",
                className,
            )}
        >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
        </div>
    );
}
