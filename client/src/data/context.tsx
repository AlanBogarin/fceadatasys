import { createContext, useContext, type ReactNode } from "react";
import type { DataClient } from "./mockClient";
const DataContext = createContext<DataClient | null>(null);
export function DataProvider({
  client,
  children,
}: {
  client: DataClient;
  children: ReactNode;
}) {
  return <DataContext.Provider value={client}>{children}</DataContext.Provider>;
}
export function useDataClient() {
  const value = useContext(DataContext);
  if (!value) throw Error("No se inicializaron los servicios del cliente.");
  return value;
}
