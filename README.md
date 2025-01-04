# LLM TDD

Test driven development is the practice of writing tests before the implementation and iterating on the
implementation until it passes the test. This repo is a twist on the idea: you write the test, but let
an LLM iterate on attempting to write the implementation.

## Usage

Write a test file in the tdd directory (in the form of \*.test.ts) and run `deno task gen <your-test>`. You'll
need a `.env` file in the root of the repo with `OPENAI_API_KEY` defined.

## How it works

The test file is read and passed with a prompt to the LLM that asks it to generate the implementation. The
generated code is written to disk and the tests are ran against it. If the tests fail, the results of the failure
are passed to the LLM (along with the original prompt) with a request to fix the failures. This loops a few times
until the tests pass or a maximum number of attempts is reached (3 currently).

## Further improvements

One of the biggest challenges is ensuring the LLM gets enough feedback on test failures. Most test reporters rely on line numbers for the user to lookup where the test failed in context. Instead of that, the test results should be massaged such that all the context is returned. 

