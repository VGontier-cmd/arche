/**
 * Uppercase tracked-caps heading used to label content sections inside the
 * detail pane (Details / Plan / Timeline / Tasks / Actions / etc). Replaces
 * a dozen duplicated inline-styled `<h3>` blocks across the components.
 */

import type { ReactNode } from "react";

interface SectionHeadingProps {
  /** DOM id — pair this with `aria-labelledby` on the parent <section>. */
  id?: string;
  /** Trailing element (e.g., a count badge, a small action button). */
  trailing?: ReactNode;
  /** Heading level — defaults to h3 since the page-level h1/h2 live above. */
  as?: "h2" | "h3" | "h4";
  children: ReactNode;
}

export function SectionHeading({
  id,
  trailing,
  as: Tag = "h3",
  children,
}: SectionHeadingProps) {
  const headingNode = (
    <Tag
      id={id}
      style={{
        fontSize: "var(--text-label-md)",
        fontWeight: 700,
        color: "var(--c-fog-300)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        margin: 0,
      }}
    >
      {children}
    </Tag>
  );

  if (!trailing) {
    return <div style={{ marginBottom: 8 }}>{headingNode}</div>;
  }

  return (
    <div
      className="flex items-center justify-between"
      style={{ marginBottom: 8, gap: 8 }}
    >
      {headingNode}
      {trailing}
    </div>
  );
}
