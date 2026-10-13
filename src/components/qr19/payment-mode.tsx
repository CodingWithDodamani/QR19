"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
  type Variants,
} from "framer-motion";
import { Banknote, Check, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/upi";

export interface PaymentModePayment {
  amount: number;
  link: string;
  image: string;
}

export interface PaymentModeSnapshot {
  name: string;
  upi: string;
  total: number;
  note?: string;
  payments: PaymentModePayment[];
}

interface PaymentModeProps {
  snapshot: PaymentModeSnapshot;
  onClose: () => void;
  onNewCollection: () => void;
}

interface SwipeCardProps {
  payment: PaymentModePayment;
  displayIndex: number;
  total: number;
  name: string;
  upi: string;
  note?: string;
  direction: number;
  reduce: boolean;
  onConfirm: (direction: number) => void;
}

/**
 * Drag power (offset + flick velocity) needed for a swipe to count as
 * "payment received".
 */
const SWIPE_THRESHOLD = 110;

const cardVariants: Variants = {
  enter: (direction: number) => ({
    x: direction * -440,
    opacity: 0,
    scale: 0.94,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: { type: "spring", stiffness: 300, damping: 26 },
  },
  exit: (direction: number) => ({
    x: direction * 440,
    opacity: 0,
    scale: 0.94,
    transition: { duration: 0.3, ease: "easeIn" },
  }),
};

/**
 * One swipeable QR card. The card can be flicked left or right to mark the
 * payment as received; it also animates out automatically when the button or
 * keyboard confirmation is used.
 */
function SwipeCard({
  payment,
  displayIndex,
  total,
  name,
  upi,
  note,
  direction,
  reduce,
  onConfirm,
}: SwipeCardProps) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-240, 240], [-9, 9]);
  const stampLeftOpacity = useTransform(x, [-150, -70], [1, 0]);
  const stampRightOpacity = useTransform(x, [70, 150], [0, 1]);

  function handleDragEnd(
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) {
    const power = info.offset.x + info.velocity.x * 0.18;
    if (Math.abs(power) > SWIPE_THRESHOLD) {
      onConfirm(info.offset.x < 0 ? -1 : 1);
    }
  }

  return (
    <motion.div
      className="pm-card"
      style={{ x, rotate }}
      custom={direction}
      variants={
        reduce
          ? {
              enter: { opacity: 0 },
              center: { opacity: 1 },
              exit: { opacity: 0, transition: { duration: 0.15 } },
            }
          : cardVariants
      }
      initial="enter"
      animate="center"
      exit="exit"
      drag={reduce ? false : "x"}
      dragSnapToOrigin
      dragMomentum={false}
      onDragEnd={handleDragEnd}
    >
      <span className="pm-chip">
        Payment {displayIndex} of {total}
      </span>
      <h3 className="pm-amount">{formatINR(payment.amount)}</h3>
      <div className="pm-qr-wrap">
        <img
          src={payment.image}
          alt={`QR code for payment ${displayIndex} of ${total}: ${formatINR(payment.amount)} to ${name}`}
          width={218}
          height={218}
          draggable={false}
        />
      </div>
      <div className="pm-payee">
        <strong>{name}</strong>
        <span>{upi}</span>
      </div>
      {note && <p className="pm-note">{note}</p>}

      <motion.div
        className="pm-stamp pm-stamp-left"
        style={{ opacity: stampLeftOpacity }}
        aria-hidden="true"
      >
        <Check size={20} strokeWidth={3.2} /> PAID
      </motion.div>
      <motion.div
        className="pm-stamp pm-stamp-right"
        style={{ opacity: stampRightOpacity }}
        aria-hidden="true"
      >
        PAID <Check size={20} strokeWidth={3.2} />
      </motion.div>
    </motion.div>
  );
}

/**
 * Full-screen "payment mode": shows one QR at a time. Once a payment is
 * confirmed (button tap, card swipe left/right, or keyboard), the paid card
 * automatically swipes away and the next QR slides in — until every part of
 * the amount has been collected.
 */
export function PaymentMode({
  snapshot,
  onClose,
  onNewCollection,
}: PaymentModeProps) {
  const [mounted, setMounted] = useState(false);
  const [remaining, setRemaining] = useState(snapshot.payments);
  const [completed, setCompleted] = useState<PaymentModePayment[]>([]);
  const [direction, setDirection] = useState(-1);
  const [celebrate, setCelebrate] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion() ?? false;

  const total = snapshot.payments.length;
  const current = remaining[0];
  const collectedPaise = completed.reduce((sum, p) => sum + p.amount, 0);

  useEffect(() => setMounted(true), []);

  // Let the final swipe-out animation finish before the celebration appears.
  useEffect(() => {
    if (remaining.length > 0) {
      setCelebrate(false);
      return;
    }
    const timer = setTimeout(() => setCelebrate(true), 520);
    return () => clearTimeout(timer);
  }, [remaining.length]);

  const confirmPayment = useCallback(
    (dir: number) => {
      if (!remaining.length) return;
      const head = remaining[0];
      setDirection(dir);
      setCompleted((done) => [...done, head]);
      setRemaining((rest) => rest.slice(1));
      navigator.vibrate?.(35);
    },
    [remaining]
  );

  const undo = useCallback(() => {
    if (!completed.length) return;
    const last = completed[completed.length - 1];
    setDirection(1);
    setCompleted((done) => done.slice(0, -1));
    setRemaining((rest) => [last, ...rest]);
    confirmButtonRef.current?.focus({ preventScroll: true });
    navigator.vibrate?.(18);
  }, [completed]);

  // Keyboard shortcuts + focus trap.
  useEffect(() => {
    function handleTab(event: KeyboardEvent) {
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex='-1'])"
        )
      ).filter((el) => el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !panel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        handleTab(event);
        return;
      }
      if (celebrate || remaining.length === 0) return;
      const target = event.target;
      const onWidget =
        target instanceof HTMLElement &&
        !!target.closest("input, textarea, select, button, a, [role='button']");
      if (event.code === "Space" || event.key === "Enter") {
        // On a focused control, let native activation handle it (avoids
        // double-firing); elsewhere Space/Enter confirm the payment.
        if (onWidget) return;
        event.preventDefault();
        confirmPayment(-1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        confirmPayment(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        confirmPayment(1);
      } else if (
        (event.key === "z" || event.key === "Z" || event.key === "Backspace") &&
        !(
          target instanceof HTMLElement &&
          target.closest("input, textarea, select")
        )
      ) {
        event.preventDefault();
        undo();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [celebrate, remaining.length, confirmPayment, undo, onClose]);

  // Scroll lock + initial focus.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = setTimeout(
      () => confirmButtonRef.current?.focus({ preventScroll: true }),
      90
    );
    return () => {
      document.body.style.overflow = previousOverflow;
      clearTimeout(timer);
    };
  }, []);

  const confettiPieces = useMemo(() => {
    if (!celebrate) return [];
    const colors = ["#635bff", "#2bb673", "#16754b", "#c86dd7", "#f5b942", "#9d7bff"];
    return Array.from({ length: 46 }, (_, index) => ({
      id: index,
      left: `${Math.random() * 100}%`,
      delay: `${Math.random() * 1.4}s`,
      duration: `${2.4 + Math.random() * 1.8}s`,
      color: colors[index % colors.length],
      size: 5 + Math.round(Math.random() * 6),
      drift: `${(Math.random() - 0.5) * 180}px`,
      round: Math.random() > 0.5,
    }));
  }, [celebrate]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="pm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Collect payments one by one"
    >
      <div className="pm-backdrop" onClick={onClose} aria-hidden="true" />

      {celebrate && (
        <div className="pm-confetti" aria-hidden="true">
          {confettiPieces.map((piece) => (
            <span
              key={piece.id}
              style={
                {
                  left: piece.left,
                  width: piece.size,
                  height: piece.round ? piece.size : Math.round(piece.size * 0.45),
                  background: piece.color,
                  borderRadius: piece.round ? "999px" : "2px",
                  animationDelay: piece.delay,
                  animationDuration: piece.duration,
                  "--drift": piece.drift,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}

      <motion.div
        ref={panelRef}
        className="pm-panel"
        initial={{ opacity: 0, y: 26, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
      >
        <header className="pm-header">
          <div>
            <span className="pm-eyebrow">Collecting for {snapshot.name}</span>
            <strong className="pm-total">{formatINR(snapshot.total)}</strong>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="pm-close"
            onClick={onClose}
            aria-label="Close payment mode"
          >
            <X size={18} aria-hidden="true" />
          </Button>
        </header>

        <div className="pm-progress-row">
          <span className="pm-collected">
            <Banknote size={14} aria-hidden="true" />
            {formatINR(collectedPaise)} collected
          </span>
          <span className="pm-count">
            {completed.length} of {total} paid
          </span>
        </div>
        <div
          className="pm-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed.length}
          aria-label="Payments completed"
        >
          <div
            className="pm-progress-fill"
            style={{ width: `${total ? (completed.length / total) * 100 : 0}%` }}
          />
        </div>

        {!celebrate ? (
          <>
            <div className="pm-stage">
              {remaining.slice(1, 3).map((payment, index) => {
                const absoluteIndex = completed.length + 1 + index;
                return (
                  <div
                    key={payment.link}
                    className="pm-deck-card"
                    aria-hidden="true"
                    style={{
                      transform: `translateY(${(index + 1) * 14}px) scale(${1 - (index + 1) * 0.05})`,
                      opacity: index === 0 ? 0.5 : 0.28,
                      zIndex: 1 - index,
                    }}
                  >
                    <span className="pm-deck-top">
                      Payment {absoluteIndex + 1} of {total}
                    </span>
                    <h3 className="pm-deck-amount">
                      {formatINR(payment.amount)}
                    </h3>
                    <img
                      src={payment.image}
                      alt=""
                      width={218}
                      height={218}
                      draggable={false}
                    />
                  </div>
                );
              })}
              <AnimatePresence custom={direction} initial={false}>
                {current && (
                  <SwipeCard
                    key={current.link}
                    payment={current}
                    displayIndex={completed.length + 1}
                    total={total}
                    name={snapshot.name}
                    upi={snapshot.upi}
                    note={snapshot.note}
                    direction={direction}
                    reduce={reduce}
                    onConfirm={confirmPayment}
                  />
                )}
              </AnimatePresence>
            </div>

            <div className="pm-actions">
              <Button
                type="button"
                variant="outline"
                className="pm-undo"
                onClick={undo}
                disabled={!completed.length}
                aria-label="Undo last payment"
              >
                <RotateCcw size={16} aria-hidden="true" />
              </Button>
              <Button
                type="button"
                ref={confirmButtonRef}
                className="pm-confirm"
                onClick={() => confirmPayment(-1)}
                disabled={!remaining.length}
              >
                <Check size={18} strokeWidth={3} aria-hidden="true" />
                Payment received
              </Button>
            </div>
            <p className="pm-hint">
              After each successful scan, swipe the card left or right — or
              press <kbd>Space</kbd>, <kbd>←</kbd>, <kbd>→</kbd>. Press{" "}
              <kbd>Z</kbd> to undo.
            </p>
          </>
        ) : (
          <motion.div
            className="pm-complete"
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
          >
            <svg viewBox="0 0 72 72" className="pm-check" aria-hidden="true">
              <circle className="pm-check-circle" cx="36" cy="36" r="33" />
              <path
                className="pm-check-mark"
                d="M22.5 37.5 32 47 50.5 27.5"
              />
            </svg>
            <h3>All payments received</h3>
            <p>
              <strong>{formatINR(snapshot.total)}</strong> collected in {total}{" "}
              {total === 1 ? "payment" : "payments"} from {snapshot.name}.
            </p>
            <div className="pm-complete-actions">
              <Button type="button" variant="outline" onClick={onClose}>
                View all QR codes
              </Button>
              <Button type="button" onClick={onNewCollection}>
                Start new collection
              </Button>
            </div>
            {completed.length > 0 && (
              <button type="button" className="pm-complete-undo" onClick={undo}>
                <RotateCcw size={12} aria-hidden="true" /> Undo last payment
              </button>
            )}
          </motion.div>
        )}

        {completed.length > 0 && (
          <div className="pm-done-row" aria-hidden="true">
            {completed.map((payment, index) => (
              <span
                key={`${payment.link}-${index}`}
                className="pm-done-chip"
              >
                <Check size={11} strokeWidth={3.2} /> {formatINR(payment.amount)}
              </span>
            ))}
          </div>
        )}

        <p role="status" aria-live="polite" className="sr-only">
          {celebrate
            ? `All ${total} payments received. ${formatINR(snapshot.total)} collected.`
            : current
              ? `Payment ${completed.length + 1} of ${total}. Amount ${formatINR(current.amount)}.`
              : ""}
        </p>
      </motion.div>
    </div>,
    document.body
  );
}
