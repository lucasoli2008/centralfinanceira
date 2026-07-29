import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Sem `globals: true`, o React Testing Library não desmonta automaticamente
// entre os testes — o que faria queries encontrarem elementos de testes anteriores.
afterEach(() => {
  cleanup();
});
