import { createContext, useContext, type ReactNode } from "react";
import type { DataClient } from "./client";
const DataContext = createContext<DataClient | null>(null);
const DataEnvironment = createContext({
  mode: "api" as "mock" | "api",
  revision: 0,
});
export function DataProvider({
  client,
  children,
  mode = "api",
  revision = 0,
}: {
  client: DataClient;
  children: ReactNode;
  mode?: "mock" | "api";
  revision?: number;
}) {
  return (
    <DataEnvironment.Provider value={{ mode, revision }}>
      <DataContext.Provider value={client}>{children}</DataContext.Provider>
    </DataEnvironment.Provider>
  );
}
export const useDataEnvironment = () => useContext(DataEnvironment);
export function useDataClient() {
  const value = useContext(DataContext);
  if (!value) throw Error("No se inicializaron los servicios del cliente.");
  return value;
}
