import {
  createContext,
  type PropsWithChildren,
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import type { AuthMe, MaintenanceStatus } from "@qpilot/shared";
import {
  api,
  isMaintenanceError,
  isUnauthorizedError,
  maintenanceEventName
} from "../lib/api";

type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "maintenance";

interface AuthContextValue {
  auth: AuthMe | null;
  maintenance: MaintenanceStatus | null;
  status: AuthStatus;
  refresh: () => Promise<AuthMe | null>;
  login: (payload: { email: string; password: string }) => Promise<AuthMe>;
  register: (payload: {
    email: string;
    password: string;
    displayName?: string;
    tenantName?: string;
  }) => Promise<AuthMe>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [auth, setAuth] = useState<AuthMe | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceStatus | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  const setAuthenticated = (next: AuthMe) => {
    startTransition(() => {
      setAuth(next);
      setMaintenance(null);
      setStatus("authenticated");
    });
  };

  const setUnauthenticated = () => {
    startTransition(() => {
      setAuth(null);
      setMaintenance(null);
      setStatus("unauthenticated");
    });
  };

  const setMaintenanceMode = (next: MaintenanceStatus) => {
    startTransition(() => {
      setAuth(null);
      setMaintenance(next);
      setStatus("maintenance");
    });
  };

  const refresh = async (): Promise<AuthMe | null> => {
    setStatus((current) => (current === "authenticated" ? current : "loading"));
    try {
      const next = await api.getMe();
      setAuthenticated(next);
      return next;
    } catch (error) {
      if (isMaintenanceError(error) && error.maintenance) {
        setMaintenanceMode(error.maintenance);
        return null;
      }
      if (isUnauthorizedError(error)) {
        setUnauthenticated();
        return null;
      }
      setUnauthenticated();
      throw error;
    }
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const next = await api.getMe();
        if (cancelled) {
          return;
        }
        setAuthenticated(next);
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (isMaintenanceError(error) && error.maintenance) {
          setMaintenanceMode(error.maintenance);
          return;
        }
        if (isUnauthorizedError(error)) {
          setUnauthenticated();
          return;
        }
        setUnauthenticated();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleMaintenance = (event: Event) => {
      const detail = (event as CustomEvent<MaintenanceStatus>).detail;
      if (detail?.active) {
        setMaintenanceMode(detail);
      }
    };

    window.addEventListener(maintenanceEventName, handleMaintenance);
    return () => {
      window.removeEventListener(maintenanceEventName, handleMaintenance);
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      auth,
      maintenance,
      status,
      refresh,
      login: async (payload) => {
        const next = await api.login(payload);
        setAuthenticated(next);
        return next;
      },
      register: async (payload) => {
        const next = await api.register(payload);
        setAuthenticated(next);
        return next;
      },
      logout: async () => {
        try {
          await api.logout();
        } finally {
          setUnauthenticated();
        }
      }
    }),
    [auth, maintenance, status]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return context;
};
