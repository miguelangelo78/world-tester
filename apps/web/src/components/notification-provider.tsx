"use client";

import { useState, useCallback, createContext, useContext } from "react";
import { X, AlertCircle, CheckCircle, Info } from "lucide-react";

export type NotificationType = "success" | "error" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number; // ms, 0 = never auto-dismiss
}

interface NotificationContextType {
  notifications: Notification[];
  notify: (type: NotificationType, title: string, message?: string, duration?: number) => void;
  dismiss: (id: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const notify = useCallback(
    (type: NotificationType, title: string, message?: string, duration = 6000) => {
      const id = `${Date.now()}-${Math.random()}`;
      const notification: Notification = { id, type, title, message, duration };

      setNotifications((prev) => [...prev, notification]);

      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
    },
    []
  );

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const success = useCallback((title: string, message?: string) => {
    notify("success", title, message, 6000);
  }, [notify]);

  const error = useCallback((title: string, message?: string) => {
    notify("error", title, message, 8000);
  }, [notify]);

  const info = useCallback((title: string, message?: string) => {
    notify("info", title, message, 5000);
  }, [notify]);

  return (
    <NotificationContext.Provider value={{ notifications, notify, dismiss, success, error, info }}>
      {children}
      <NotificationContainer />
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotification must be used within NotificationProvider");
  }
  return context;
}

function NotificationContainer() {
  const { notifications, dismiss } = useNotification();

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 space-y-2 max-w-md">
      {notifications.map((notification) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          onDismiss={() => dismiss(notification.id)}
        />
      ))}
    </div>
  );
}

function NotificationItem({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: () => void;
}) {
  const bgColor = {
    success: "bg-green-500/20 border border-green-500/30",
    error: "bg-red-500/20 border border-red-500/30",
    info: "bg-blue-500/20 border border-blue-500/30",
  }[notification.type];

  const textColor = {
    success: "text-green-400",
    error: "text-red-400",
    info: "text-blue-400",
  }[notification.type];

  const Icon = {
    success: CheckCircle,
    error: AlertCircle,
    info: Info,
  }[notification.type];

  return (
    <div className={`${bgColor} rounded-lg p-4 flex gap-3 items-start`}>
      <Icon className={`${textColor} h-5 w-5 shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <p className={`${textColor} font-semibold text-sm`}>{notification.title}</p>
        {notification.message && (
          <p className="text-muted-foreground text-sm mt-1">{notification.message}</p>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
