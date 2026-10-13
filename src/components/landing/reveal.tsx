"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

const TAGS = {
  div: motion.div,
  li: motion.li,
  span: motion.span,
  article: motion.article,
} as const;

interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  once?: boolean;
  /** HTML tag to render (defaults to div; use "li" inside lists for valid semantics). */
  as?: keyof typeof TAGS;
}

/** Scroll-triggered reveal: fades + slides content in the first time it enters the viewport. */
export function Reveal({ children, className, delay = 0, y = 26, once = true, as = "div" }: RevealProps) {
  const Tag = TAGS[as];

  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: "-70px" }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Tag>
  );
}
