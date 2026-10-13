"use client";

import { animate, useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";

interface CounterProps {
  to: number;
  /** Formats the interpolated value; defaults to en-IN grouping. */
  format?: (value: number) => string;
  duration?: number;
  className?: string;
}

/** Counts up from 0 to `to` the first time it scrolls into view. */
export function Counter({ to, format, duration = 1.7, className }: CounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, to, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setValue(latest),
    });
    return () => controls.stop();
  }, [inView, to, duration]);

  return (
    <span ref={ref} className={className}>
      {format ? format(value) : Math.round(value).toLocaleString("en-IN")}
    </span>
  );
}
