// Shared test environment.
// 1) register jest-dom matchers (toHaveClass, etc.) for vitest — pure-logic
//    suites don't need them, component suites do.
// 2) explicitly clean up rendered DOM between tests. RTL's auto-cleanup only
//    registers when vitest globals are on; we keep explicit imports, so wire
//    it here to avoid cross-test DOM accumulation.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
