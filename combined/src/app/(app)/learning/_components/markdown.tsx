"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cx } from "@/utils/cx";

/**
 * Render quiz/learning markdown with GitHub-flavored extensions (code blocks,
 * tables, links, blockquotes, images), styled with semantic tokens. Code blocks
 * render in a mono bg-secondary block per the design guidance.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
    return (
        <div
            className={cx(
                "text-sm leading-relaxed text-secondary break-words",
                "[&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-primary",
                "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-primary",
                "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:text-primary",
                "[&_p]:my-2 first:[&_p]:mt-0 last:[&_p]:mb-0",
                "[&_ul]:my-2 [&_ul]:ml-5 [&_ul]:list-disc [&_ol]:my-2 [&_ol]:ml-5 [&_ol]:list-decimal [&_li]:my-0.5",
                "[&_strong]:font-semibold [&_strong]:text-primary",
                "[&_a]:text-brand-secondary [&_a]:underline",
                // inline code
                "[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-secondary [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-xs [&_:not(pre)>code]:font-mono",
                // fenced code blocks
                "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-secondary [&_pre]:p-3 [&_pre]:text-xs [&_pre>code]:font-mono [&_pre>code]:text-secondary",
                "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-secondary [&_blockquote]:pl-3 [&_blockquote]:text-tertiary [&_blockquote]:italic",
                "[&_img]:my-2 [&_img]:rounded-lg [&_img]:max-w-full",
                "[&_table]:my-2 [&_table]:w-full [&_table]:text-xs [&_th]:border [&_th]:border-secondary [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-primary [&_td]:border [&_td]:border-secondary [&_td]:px-2 [&_td]:py-1",
                "[&_hr]:my-3 [&_hr]:border-secondary",
                className,
            )}
        >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
        </div>
    );
}
