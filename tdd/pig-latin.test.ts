import * as mod from "./pig-latin.ts";

import { assertEquals } from "jsr:@std/assert";

Deno.test(
  "Should export a function called `translate` which takes a string and returns a string",
  () => {
    assertEquals(typeof mod.translate, "function");
    assertEquals(typeof mod.translate("hello"), "string");
  }
);

Deno.test("Should translate an english word to pig latin", () => {
  assertEquals(mod.translate("hello"), "ellohay");
});

Deno.test("Should translate a word beginning with a vowel", () => {
  assertEquals(mod.translate("apple"), "appleay");
});
