"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { X, AlertTriangle } from "lucide-react";

interface ConfirmationOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDangerous?: boolean;
}

interface ConfirmationContextType {
  confirm: (options: ConfirmationOptions) => Promise<boolean>;
}

const ConfirmationContext = createContext<ConfirmationContextType | undefined>(
  undefined
);

export function ConfirmationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const [resolvePromise, setResolvePromise] = useState<
    ((value: boolean) => void) | null
  >(null);

  const confirm = useCallback(
    (opts: ConfirmationOptions): Promise<boolean> => {
      return new Promise((resolve) => {
        setOptions(opts);
        setResolvePromise(() => resolve);
        setIsOpen(true);
      });
    },
    []
  );

  const handleConfirm = () => {
    if (resolvePromise) {
      resolvePromise(true);
    }
    setIsOpen(false);
    setResolvePromise(null);
    setOptions(null);
  };

  const handleCancel = () => {
    if (resolvePromise) {
      resolvePromise(false);
    }
    setIsOpen(false);
    setResolvePromise(null);
    setOptions(null);
  };

  return (
    <ConfirmationContext.Provider value={{ confirm }}>
      {children}
      {isOpen && options && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="max-w-sm w-full mx-4 rounded-lg border border-border bg-card shadow-lg">
            {/* Header */}
            <div
              className={`flex items-start gap-3 px-6 py-4 border-b border-border ${
                options.isDangerous ? "bg-destructive/5" : ""
              }`}
            >
              {options.isDangerous && (
                <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                {options.title && (
                  <h2 className="text-sm font-semibold text-foreground">
                    {options.title}
                  </h2>
                )}
                <p
                  className={`text-sm ${
                    options.title
                      ? "text-muted-foreground mt-1"
                      : "text-foreground"
                  }`}
                >
                  {options.message}
                </p>
              </div>
              <button
                onClick={handleCancel}
                className="flex-shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-4">
              <button
                onClick={handleCancel}
                className="px-4 py-2 rounded-md border border-input text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                {options.cancelLabel || "Cancel"}
              </button>
              <button
                onClick={handleConfirm}
                className={`px-4 py-2 rounded-md text-sm font-medium text-white transition-colors ${
                  options.isDangerous
                    ? "bg-destructive hover:bg-destructive/90"
                    : "bg-primary hover:bg-primary/90"
                }`}
              >
                {options.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmationContext.Provider>
  );
}

export function useConfirmation() {
  const context = useContext(ConfirmationContext);
  if (!context) {
    throw new Error("useConfirmation must be used within ConfirmationProvider");
  }
  return context;
}
