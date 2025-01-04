import * as mod from "./math";
import { assertEquals } from "jsr:@std/assert";

Deno.test("add", () => {
  assertEquals(mod.add(1, 2), 3);
});

Deno.test("subtract", () => {
  assertEquals(mod.subtract(1, 2), -1);
});

Deno.test("multiply", () => {
  assertEquals(mod.multiply(2, 3), 6);
});
Deno.test("divide", () => {
  assertEquals(mod.divide(6, 3), 2);
});
