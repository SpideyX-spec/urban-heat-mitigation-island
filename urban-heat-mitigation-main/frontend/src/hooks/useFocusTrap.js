import { useEffect, useRef } from 'react';

/**
 * useFocusTrap
 * Traps keyboard focus within a modal dialog or drawer while open,
 * handles Escape key dismissal, and restores focus to the previously
 * focused element when closed.
 *
 * @param {boolean} isOpen - Whether the modal or drawer is active.
 * @param {Function} onClose - Callback invoked when Escape key is pressed.
 * @returns {React.RefObject} - Ref to attach to the dialog / drawer container.
 */
export function useFocusTrap(isOpen, onClose) {
  const containerRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    // Save element that had focus before modal opened
    previousFocusRef.current = document.activeElement;

    const container = containerRef.current;
    if (!container) return;

    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    // Move initial focus into dialog
    const timer = setTimeout(() => {
      const focusableEls = container.querySelectorAll(focusableSelector);
      if (focusableEls.length > 0) {
        focusableEls[0].focus();
      } else {
        container.focus();
      }
    }, 50);

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof onClose === 'function') {
          onClose();
        }
        return;
      }

      if (e.key === 'Tab') {
        const focusableEls = Array.from(container.querySelectorAll(focusableSelector));
        if (focusableEls.length === 0) {
          e.preventDefault();
          return;
        }

        const firstEl = focusableEls[0];
        const lastEl = focusableEls[focusableEls.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstEl || !container.contains(document.activeElement)) {
            e.preventDefault();
            lastEl.focus();
          }
        } else {
          if (document.activeElement === lastEl || !container.contains(document.activeElement)) {
            e.preventDefault();
            firstEl.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown, true);
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  return containerRef;
}
