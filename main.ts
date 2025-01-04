import strip from "npm:strip-ansi";
import {
  Configuration,
  OpenAIApi,
  type CreateChatCompletionRequest,
} from "npm:openai";
import { exists } from "jsr:@std/fs";
import { basename } from "jsr:@std/path";
import { dedent } from "jsr:@qnighy/dedent";
import { parse, type Details, type TestSuites } from "jsr:@kesin11/junit2json";
import { Project, Node, ts, SourceFile } from "npm:ts-morph";

const configuration = new Configuration({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});
const openai = new OpenAIApi(configuration);

function sourceFromFailure(testFileName: string, failure: Details): string {
  const inner = failure.inner!;
  const lines = inner
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith("at ") && line.includes(testFileName))
    .map((line) => line.replace(/^at\s+/, ""));

  const lastLine = lines.at(-1);
  if (!lastLine) return "";

  const match = lastLine.match(/file:\/\/\/(.+):(\d+):(\d+)/);
  if (!match) return lastLine;

  const [, filePath, line, column] = match;
  const lineNumber = parseInt(line, 10);
  const columnNumber = parseInt(column, 10);

  const project = new Project();
  const sourceFile = project.addSourceFileAtPath("/" + filePath);

  const node = findNodeAtPosition(sourceFile, lineNumber, columnNumber);
  if (!node) return lastLine;

  return node.getText();
}

function findNodeAtPosition(
  sourceFile: SourceFile,
  line: number,
  column: number
): Node | undefined {
  const position = sourceFile.compilerNode.getPositionOfLineAndCharacter(
    line - 1,
    column - 1
  );

  function findNode(node: Node): Node | undefined {
    const children = node.getChildren();
    for (const child of children) {
      if (child.getStart() <= position && position < child.getEnd()) {
        return findNode(child);
      }
    }
    return node.getParent();
  }

  return findNode(sourceFile);
}

async function formatTestResults(testResults: string) {
  const results = (await parse(testResults)) as TestSuites;
  if (!results?.failures) {
    return [];
  }

  const failedTests = results
    .testsuite!.filter((suite) => suite.failures)
    .flatMap((suite) => suite.testcase!)
    .filter((test) => "failure" in test);

  const failures = failedTests
    .flatMap((test) => test.failure?.map((f) => ({ name: test.name, ...f })))
    .filter(Boolean)
    .map((failure) => ({
      name: failure?.name,
      message: failure?.message,
      source: sourceFromFailure(
        basename(failedTests[0].classname ?? ""),
        failure!
      ),
    }))
    .map(
      (f) => dedent`
      The test "${f.name}" failed because of this part of the code:

      \`\`\`typescript
      ${f.source}
      \`\`\`

      with the following error:

      \`\`\`
      ${f.message}
      \`\`\`
    `
    );

  return failures;
}

const logPrompt = async (
  prompt: CreateChatCompletionRequest
): Promise<CreateChatCompletionRequest> => {
  for (const message of prompt.messages) {
    await log(`\n## role: ${message.role}\n`);
    await log(message.content + "\n\n");
  }
  await log("---\n\n");
  return prompt;
};

interface ModuleResults {
  responseCode: string;
  testResults: string;
}

const genModuleFromTest = async (
  modulePath: string,
  testFile: string,
  results?: ModuleResults | null
) => {
  const response = await openai.createChatCompletion(
    await logPrompt({
      model: "gpt-4o",
      messages: [
        {
          role: "system" as const,
          content: dedent`
            You are tasked with creating the code for a Deno module that passes the following tests.
            Return only the code for the module, do not return any other text. Assume the name of the module
            you generate is imported from \`${modulePath}\`. Return only the code.
          `.trim(),
        },
        {
          role: "user" as const,
          content: dedent`
          Here are the tests:

          \`\`\`typescript
          ${testFile}
          \`\`\`
        `.trim(),
        },
      ].concat(
        !results
          ? []
          : [
              {
                role: "assistant" as "system",
                content: dedent`
                  \`\`\`typescript
                  ${results.responseCode}
                  \`\`\`
                `.trim(),
              },
              {
                role: "user" as const,
                content: dedent`
                The tests failed with the following output:

                ${results.testResults}

                Please correct the code and return the updated code.
              `.trim(),
              },
            ]
      ),
    })
  );
  return response.data.choices[0].message?.content
    ?.replace(/^```(typescript|ts|javascript|js)?\n/, "")
    .replace(/\n```$/, "");
};

interface TestResult {
  status: "pass" | "fail";
  testResults?: string;
}

const runTests = async (testFilePath: string): Promise<TestResult> => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["test", "--allow-import", "--reporter", "junit", testFilePath],
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (result.success) {
    return {
      status: "pass",
    };
  }

  return {
    status: "fail",
    // Strip any ANSI escape codes in the output.
    testResults: strip(new TextDecoder().decode(result.stdout)).replaceAll(
      /\\u\w{4}\[\d+m/g,
      ""
    ),
  };
};

const testFilePath = Deno.args[0];
if (!testFilePath || !(await exists(testFilePath))) {
  throw new Error(`Test file not found: ${testFilePath}`);
}

const modulePath = testFilePath.replace(/\.test\.ts$/, ".ts");
const logPath = testFilePath.replace(/\.test\.ts$/, ".log.md");

async function log(message: string): Promise<void> {
  try {
    await Deno.writeTextFile(logPath, message, { append: true });
  } catch (error) {
    console.error(`Error writing to log file: ${error}`);
  }
}

const testFile = await Deno.readTextFile(testFilePath);

let lastResult: ModuleResults | null = null;
if (await exists(modulePath)) {
  const result = await runTests(testFilePath);
  if (result.status === "pass") {
    console.log("Module already passes tests");
    Deno.exit(0);
  } else {
    lastResult = {
      responseCode: Deno.readTextFileSync(modulePath),
      testResults: (await formatTestResults(result.testResults!)).join("\n"),
    };
  }
}

let attempts = 0;
while (true) {
  if (attempts++ >= 3) {
    throw new Error(`Failed to generate code after ${attempts} attempts`);
  }

  const code = await genModuleFromTest(modulePath, testFile, lastResult);

  if (!code) {
    throw new Error("No code generated");
  }

  Deno.writeTextFileSync(modulePath, code);

  const result = await runTests(testFilePath);
  if (result.status === "pass") {
    console.log("Tests passed!");
    break;
  } else {
    if (!result.testResults) {
      throw new Error("No test results");
    }
    lastResult = {
      responseCode: code!,
      testResults: result.testResults!,
    };
  }
}
