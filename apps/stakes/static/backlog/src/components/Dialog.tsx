import { useEffect, useRef, type ReactNode } from 'react';
import { token } from '@atlaskit/tokens';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  labelledBy: string;
  onClose: () => void;
  closeDisabled?: boolean;
  drawer?: boolean;
  children: ReactNode;
}

export default function Dialog({
  labelledBy,
  onClose,
  closeDisabled = false,
  drawer = false,
  children,
}: DialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const disabledRef = useRef(closeDisabled);
  closeRef.current = onClose;
  disabledRef.current = closeDisabled;

  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !disabledRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        justifyContent: drawer ? 'flex-end' : 'center',
        alignItems: drawer ? 'stretch' : 'flex-start',
        padding: drawer ? 0 : '10vh 16px 16px',
        background: token('color.blanket'),
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={{
          width: drawer ? 'min(560px, 100%)' : 'min(640px, 100%)',
          maxHeight: drawer ? '100%' : '80vh',
          height: drawer ? '100%' : undefined,
          overflowY: 'auto',
          color: token('color.text'),
          background: token('elevation.surface.overlay'),
          borderRadius: drawer ? 0 : 12,
          boxShadow: token('elevation.shadow.overlay'),
        }}
      >
        {children}
      </section>
    </div>
  );
}
