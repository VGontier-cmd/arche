import { isValidElement } from "react";
import type { ReactNode } from "react";

/** Collapse React nodes to plain text (for tests). */
export function extractPlainText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractPlainText).join("");
  }
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return extractPlainText(props.children ?? null);
  }
  return "";
}
