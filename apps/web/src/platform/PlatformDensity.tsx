import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

export type PlatformDensityMode = "comfortable" | "dense";

type PlatformDensityContextValue = {
  density: PlatformDensityMode;
  setDensity: (density: PlatformDensityMode) => void;
  isDense: boolean;
};

const STORAGE_KEY = "qpilot.platformDensity";

const PlatformDensityContext = createContext<PlatformDensityContextValue | null>(null);

export const PlatformDensityProvider = ({ children }: { children: ReactNode }) => {
  const [density, setDensity] = useState<PlatformDensityMode>("comfortable");

  const updateDensity = (nextDensity: PlatformDensityMode) => {
    setDensity(nextDensity);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, nextDensity);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextDensity = window.localStorage.getItem(STORAGE_KEY);
    if (nextDensity === "comfortable" || nextDensity === "dense") {
      setDensity(nextDensity);
    }
  }, []);

  const value = useMemo(
    () => ({
      density,
      setDensity: updateDensity,
      isDense: density === "dense"
    }),
    [density]
  );

  return (
    <PlatformDensityContext.Provider value={value}>
      {children}
    </PlatformDensityContext.Provider>
  );
};

export const usePlatformDensity = () => {
  const context = useContext(PlatformDensityContext);
  if (!context) {
    throw new Error("usePlatformDensity must be used within PlatformDensityProvider.");
  }

  return context;
};
